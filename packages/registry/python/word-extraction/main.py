import hashlib
import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

import pdfplumber
from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .database import engine, async_session
from .models import Base, PDFDocument, PageCache
from sqlalchemy import select


UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/uploads"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    for attempt in range(10):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            break
        except Exception as e:
            print(f"DB connection attempt {attempt + 1}/10 failed: {e}")
            await asyncio.sleep(2)
    else:
        raise RuntimeError("Could not connect to database")
    yield
    await engine.dispose()


app = FastAPI(title="PDF Extractor API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def compute_file_hash(file_path: Path) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_page_words(pdf_path: Path, page_num: int) -> list[dict]:
    with pdfplumber.open(pdf_path) as pdf:
        if page_num < 0 or page_num >= len(pdf.pages):
            raise ValueError(f"Page {page_num} out of range")
        page = pdf.pages[page_num]
        words = page.extract_words(extra_attrs=["fontname", "size"])
        page_width = float(page.width)
        page_height = float(page.height)
        return [
            {
                "text": w["text"],
                "x0": w["x0"] / page_width,
                "y0": w["top"] / page_height,
                "x1": w["x1"] / page_width,
                "y1": w["bottom"] / page_height,
                "fontname": w.get("fontname", ""),
                "size": w.get("size", 0),
            }
            for w in words
        ], page_width, page_height


@app.post("/api/pdfs/upload")
async def upload_pdf(file: UploadFile):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    file_path = UPLOAD_DIR / file.filename
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    file_hash = compute_file_hash(file_path)

    # Check if already exists
    async with async_session() as session:
        existing = await session.execute(
            select(PDFDocument).where(PDFDocument.file_hash == file_hash)
        )
        doc = existing.scalar_one_or_none()
        if doc:
            os.remove(file_path)
            file_path = Path(doc.file_path)
        else:
            # Get page count
            with pdfplumber.open(file_path) as pdf:
                num_pages = len(pdf.pages)

            doc = PDFDocument(
                filename=file.filename,
                file_hash=file_hash,
                file_path=str(file_path),
                num_pages=num_pages,
            )
            session.add(doc)
            await session.commit()
            await session.refresh(doc)

    return {
        "id": doc.id,
        "filename": doc.filename,
        "num_pages": doc.num_pages,
        "file_hash": doc.file_hash,
    }


@app.get("/api/pdfs/{pdf_id}")
async def get_pdf(pdf_id: int):
    async with async_session() as session:
        doc = await session.get(PDFDocument, pdf_id)
        if not doc:
            raise HTTPException(404, "PDF not found")
        return {
            "id": doc.id,
            "filename": doc.filename,
            "num_pages": doc.num_pages,
            "file_hash": doc.file_hash,
        }


@app.get("/api/pdfs/{pdf_id}/pages/{page_num}/words")
async def get_page_words(pdf_id: int, page_num: int):
    async with async_session() as session:
        doc = await session.get(PDFDocument, pdf_id)
        if not doc:
            raise HTTPException(404, "PDF not found")

        # Check cache
        cached = await session.execute(
            select(PageCache).where(
                PageCache.pdf_id == pdf_id,
                PageCache.page_num == page_num,
            )
        )
        cache_entry = cached.scalar_one_or_none()
        if cache_entry:
            return cache_entry.data

        # Extract and cache
        try:
            words, page_width, page_height = extract_page_words(
                Path(doc.file_path), page_num
            )
        except ValueError as e:
            raise HTTPException(400, str(e))

        result = {
            "pdf_id": pdf_id,
            "page_num": page_num,
            "page_width": page_width,
            "page_height": page_height,
            "words": words,
        }

        cache = PageCache(pdf_id=pdf_id, page_num=page_num, data=result)
        session.add(cache)
        await session.commit()

        return result
