import React, { useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { Word } from "@pdf-extractor/types";
import { DataView } from "@pdf-extractor/data-view";
import { PDFViewer } from "@pdf-extractor/pdf-viewer";

// Override worker path to use the copy in /public
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type PageWordsEntry = {
  words: Word[];
  pageHeight: number;
  pageWidth: number;
};

type PdfState = {
  filename: string;
  numPages: number;
  blobUrl: string;
  allWords: Map<number, PageWordsEntry>;
};

function App() {
  const [tab, setTab] = useState<"xlsx" | "pdf">("xlsx");
  const [pdfState, setPdfState] = useState<PdfState | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handlePdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const blobUrl = URL.createObjectURL(file);

      // Send to backend for word extraction (stateless)
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/extract-words", { method: "POST", body: formData });
      if (res.ok) {
        const data = await res.json();
        const allWords = new Map<number, PageWordsEntry>();
        for (const page of data.pages) {
          allWords.set(page.page_num + 1, {
            words: page.words,
            pageHeight: page.page_height,
            pageWidth: page.page_width,
          });
        }

        if (pdfState?.blobUrl) URL.revokeObjectURL(pdfState.blobUrl);
        setPdfState({
          filename: data.filename,
          numPages: data.num_pages,
          blobUrl,
          allWords,
        });
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-white">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-4">
        <h1 className="text-lg font-semibold text-gray-800">Extractor Playground</h1>
        <div className="flex items-center gap-1 bg-gray-200 rounded-lg p-0.5">
          <button
            className={`px-3 py-1 text-sm rounded-md transition-colors ${tab === "xlsx" ? "bg-white shadow-sm font-medium" : "text-gray-600 hover:text-gray-800"}`}
            onClick={() => setTab("xlsx")}
          >
            XLSX
          </button>
          <button
            className={`px-3 py-1 text-sm rounded-md transition-colors ${tab === "pdf" ? "bg-white shadow-sm font-medium" : "text-gray-600 hover:text-gray-800"}`}
            onClick={() => setTab("pdf")}
          >
            PDF
          </button>
        </div>

        {tab === "pdf" && (
          <>
            <label className="px-3 py-1 bg-indigo-600 text-white text-sm rounded cursor-pointer hover:bg-indigo-700">
              {uploading ? "Extraindo..." : "Abrir PDF"}
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handlePdfUpload}
                disabled={uploading}
              />
            </label>
            {pdfState && (
              <span className="text-sm text-gray-500">
                {pdfState.filename} — {pdfState.numPages} páginas
              </span>
            )}
          </>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "xlsx" ? (
          <DataView />
        ) : pdfState ? (
          <PDFViewer
            pdfUrl={pdfState.blobUrl}
            numPages={pdfState.numPages}
            allWords={pdfState.allWords}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Abra um PDF para começar
          </div>
        )}
      </div>
    </div>
  );
}

export { App };
