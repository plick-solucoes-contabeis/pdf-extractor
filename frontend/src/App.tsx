import { createSignal, createMemo, Show, For } from "solid-js";
import { PDFViewer } from "./components/PDFViewer";
import { DataView } from "./components/DataView";

type PDFInfo = {
  id: number;
  filename: string;
  num_pages: number;
};

type ExtractResult = {
  pdf: { filename: string; numPages: number };
  tables: {
    tableId: string;
    startPage: number;
    endPage: number;
    columns: number;
    rows: string[][];
  }[];
};

const TEMPLATE_SERVICE_URL = "http://localhost:3002";

function App() {
  const [pdfInfo, setPdfInfo] = createSignal<PDFInfo | null>(null);
  const [pdfUrl, setPdfUrl] = createSignal<string | null>(null);
  const [uploading, setUploading] = createSignal(false);

  // Apply template state
  const [showApply, setShowApply] = createSignal(false);
  const [applyPdf, setApplyPdf] = createSignal<File | null>(null);
  const [applyTemplate, setApplyTemplate] = createSignal<File | null>(null);
  const [applying, setApplying] = createSignal(false);
  const [applyResult, setApplyResult] = createSignal<ExtractResult | null>(null);
  const [applyError, setApplyError] = createSignal<string | null>(null);

  // Navigation
  const [activeView, setActiveView] = createSignal<"pdf" | "data">("pdf");

  // Tables sent from PDF View to Data View
  const [sentTables, setSentTables] = createSignal<{ label: string; rows: string[][] }[]>([]);

  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setUploading(true);

    const localUrl = URL.createObjectURL(file);

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

  async function handleApply() {
    const pdf = applyPdf();
    const template = applyTemplate();
    if (!pdf || !template) return;

    setApplying(true);
    setApplyError(null);
    setApplyResult(null);

    const form = new FormData();
    form.append("pdf", pdf);
    form.append("template", template);

    try {
      const res = await fetch(`${TEMPLATE_SERVICE_URL}/api/extract`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data: ExtractResult = await res.json();
      setApplyResult(data);
    } catch (err: any) {
      setApplyError(err.message);
    } finally {
      setApplying(false);
    }
  }

  const availableTables = createMemo(() => {
    const tables: { label: string; rows: string[][] }[] = [];

    // From Apply Template
    const result = applyResult();
    if (result) {
      for (const t of result.tables) {
        tables.push({
          label: `${result.pdf.filename} — Table p${t.startPage}${t.endPage !== t.startPage ? "–" + t.endPage : ""} (${t.rows.length} rows)`,
          rows: t.rows,
        });
      }
    }

    // From PDF View "Send to Data View"
    for (const t of sentTables()) {
      tables.push(t);
    }

    return tables;
  });

  function handleSendToDataView(label: string, rows: string[][]) {
    setSentTables((prev) => [...prev, { label, rows }]);
    setActiveView("data");
  }

  function closeApply() {
    setShowApply(false);
    setApplyPdf(null);
    setApplyTemplate(null);
    setApplyResult(null);
    setApplyError(null);
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
        <button
          class="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700"
          onClick={() => setShowApply(true)}
        >
          Apply Template
        </button>

        <div class="flex border border-gray-300 rounded overflow-hidden ml-2">
          <button
            class={`px-3 py-1 text-sm ${activeView() === "pdf" ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}
            onClick={() => setActiveView("pdf")}
          >
            PDF View
          </button>
          <button
            class={`px-3 py-1 text-sm ${activeView() === "data" ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}
            onClick={() => setActiveView("data")}
          >
            Data View
          </button>
        </div>

        <Show when={activeView() === "pdf" && pdfInfo()}>
          <span class="text-sm text-gray-500">
            {pdfInfo()!.filename} — {pdfInfo()!.num_pages} pages
          </span>
        </Show>
      </header>

      <main class="flex-1 overflow-hidden relative">
        <div class="absolute inset-0" style={{ display: activeView() === "pdf" ? "block" : "none" }}>
          <Show
            when={pdfUrl() && pdfInfo()}
            fallback={
              <div class="flex items-center justify-center h-full text-gray-400">
                Open a PDF to start
              </div>
            }
          >
            <PDFViewer pdfUrl={pdfUrl()!} pdfId={pdfInfo()!.id} numPages={pdfInfo()!.num_pages} onSendToDataView={handleSendToDataView} />
          </Show>
        </div>
        <div class="absolute inset-0" style={{ display: activeView() === "data" ? "flex" : "none" }}>
          <DataView availableTables={availableTables()} />
        </div>
      </main>

      {/* Apply Template Modal */}
      <Show when={showApply()}>
        <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={closeApply}>
          <div
            class="bg-white rounded-lg shadow-xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 class="text-base font-semibold text-gray-800">Apply Template</h2>
              <button class="text-gray-400 hover:text-gray-600 text-lg" onClick={closeApply}>
                ✕
              </button>
            </div>

            <div class="p-4 flex flex-col gap-3">
              <div class="flex gap-4">
                <label class="flex-1">
                  <span class="text-sm text-gray-600 block mb-1">PDF File</span>
                  <input
                    type="file"
                    accept=".pdf"
                    class="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                    onChange={(e) => setApplyPdf(e.currentTarget.files?.[0] ?? null)}
                  />
                </label>
                <label class="flex-1">
                  <span class="text-sm text-gray-600 block mb-1">Template JSON</span>
                  <input
                    type="file"
                    accept=".json"
                    class="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                    onChange={(e) => setApplyTemplate(e.currentTarget.files?.[0] ?? null)}
                  />
                </label>
              </div>

              <button
                class="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50 self-start"
                disabled={!applyPdf() || !applyTemplate() || applying()}
                onClick={handleApply}
              >
                {applying() ? "Extracting..." : "Extract"}
              </button>

              <Show when={applyError()}>
                <div class="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">
                  {applyError()}
                </div>
              </Show>
            </div>

            {/* Results */}
            <Show when={applyResult()}>
              <div class="flex-1 overflow-auto border-t border-gray-200 p-4">
                <div class="text-sm text-gray-500 mb-3">
                  {applyResult()!.pdf.filename} — {applyResult()!.pdf.numPages} pages
                </div>

                <For each={applyResult()!.tables}>
                  {(table) => (
                    <div class="mb-4">
                      <div class="text-sm font-medium text-gray-700 mb-1">
                        Table p{table.startPage}
                        {table.endPage !== table.startPage ? `–${table.endPage}` : ""}
                        <span class="text-gray-400 ml-2">
                          {table.rows.length} rows × {table.columns} cols
                        </span>
                      </div>
                      <div class="overflow-auto max-h-72 border border-gray-200 rounded">
                        <table class="w-full text-xs border-collapse">
                          <tbody>
                            <For each={table.rows}>
                              {(row) => (
                                <tr class="border-b border-gray-100 hover:bg-gray-50">
                                  <For each={row}>
                                    {(cell) => (
                                      <td class="px-2 py-1 border-r border-gray-100 last:border-r-0 whitespace-nowrap">
                                        {cell || "-"}
                                      </td>
                                    )}
                                  </For>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default App;
