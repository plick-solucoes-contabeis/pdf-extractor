import io
import pdfplumber
from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(title="PDF Extractor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/extract-words")
async def extract_words(file: UploadFile):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    content = await file.read()

    try:
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            pages = []
            for page_num, page in enumerate(pdf.pages):
                words_raw = page.extract_words(extra_attrs=["fontname", "size"])
                page_width = float(page.width)
                page_height = float(page.height)
                words = [
                    {
                        "text": w["text"],
                        "x0": w["x0"] / page_width,
                        "y0": w["top"] / page_height,
                        "x1": w["x1"] / page_width,
                        "y1": w["bottom"] / page_height,
                        "fontname": w.get("fontname", ""),
                        "size": w.get("size", 0),
                    }
                    for w in words_raw
                ]
                pages.append({
                    "page_num": page_num,
                    "page_width": page_width,
                    "page_height": page_height,
                    "words": words,
                })

            return {
                "filename": file.filename,
                "num_pages": len(pdf.pages),
                "pages": pages,
            }
    except Exception as e:
        raise HTTPException(500, f"Failed to extract words: {str(e)}")
