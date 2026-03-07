import { createSignal, Show } from "solid-js";
import { PDFViewer } from "./components/PDFViewer";

type PDFInfo = {
  id: number;
  filename: string;
  num_pages: number;
};

function App() {
  const [pdfInfo, setPdfInfo] = createSignal<PDFInfo | null>(null);
  const [pdfUrl, setPdfUrl] = createSignal<string | null>(null);
  const [uploading, setUploading] = createSignal(false);

  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setUploading(true);

    // Create local URL for pdf.js rendering
    const localUrl = URL.createObjectURL(file);

    // Upload to backend for word extraction
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/pdfs/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setPdfInfo(data);
      setPdfUrl(localUrl);
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div class="h-screen flex flex-col bg-gray-50">
      <header class="flex items-center gap-4 px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <h1 class="text-lg font-semibold text-gray-800">PDF Extractor</h1>
        <label class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded cursor-pointer hover:bg-blue-700">
          {uploading() ? "Uploading..." : "Open PDF"}
          <input
            type="file"
            accept=".pdf"
            class="hidden"
            onChange={handleFileUpload}
            disabled={uploading()}
          />
        </label>
        <Show when={pdfInfo()}>
          <span class="text-sm text-gray-500">
            {pdfInfo()!.filename} — {pdfInfo()!.num_pages} pages
          </span>
        </Show>
      </header>

      <main class="flex-1 overflow-hidden">
        <Show
          when={pdfUrl() && pdfInfo()}
          fallback={
            <div class="flex items-center justify-center h-full text-gray-400">
              Open a PDF to start
            </div>
          }
        >
          <PDFViewer pdfUrl={pdfUrl()!} pdfId={pdfInfo()!.id} numPages={pdfInfo()!.num_pages} />
        </Show>
      </main>
    </div>
  );
}

export default App;
