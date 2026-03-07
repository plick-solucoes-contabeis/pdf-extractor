from sqlalchemy import Integer, String, Text, JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class PDFDocument(Base):
    __tablename__ = "pdf_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(500))
    file_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    file_path: Mapped[str] = mapped_column(Text)
    num_pages: Mapped[int] = mapped_column(Integer)


class PageCache(Base):
    __tablename__ = "page_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pdf_id: Mapped[int] = mapped_column(Integer, index=True)
    page_num: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSON)
