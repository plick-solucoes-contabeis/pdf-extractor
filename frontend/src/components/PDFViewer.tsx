import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type Word = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fontname: string;
  size: number;
};

type PageWords = {
  pdf_id: number;
  page_num: number;
  page_width: number;
  page_height: number;
  words: Word[];
};

type Props = {
  pdfUrl: string;
  pdfId: number;
  numPages: number;
};

export function PDFViewer(props: Props) {
  const [currentPage, setCurrentPage] = createSignal(1);
  const [scale, setScale] = createSignal(1.5);
  const [words, setWords] = createSignal<PageWords | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [showWords, setShowWords] = createSignal(true);
  const [hoveredWord, setHoveredWord] = createSignal<Word | null>(null);

  let canvasRef!: HTMLCanvasElement;
  let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  let containerRef!: HTMLDivElement;

  // Load PDF document
  createEffect(async () => {
    const url = props.pdfUrl;
    pdfDoc = await pdfjsLib.getDocument(url).promise;
    renderPage(currentPage());
  });

  // Re-render when page or scale changes
  createEffect(() => {
    const page = currentPage();
    const s = scale();
    if (pdfDoc) renderPage(page);
  });

  async function renderPage(pageNum: number) {
    if (!pdfDoc) return;

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: scale() });

    canvasRef.width = viewport.width;
    canvasRef.height = viewport.height;

    const ctx = canvasRef.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Fetch words from backend
    fetchWords(pageNum);
  }

  async function fetchWords(pageNum: number) {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/pdfs/${props.pdfId}/pages/${pageNum - 1}/words`
      );
      const data: PageWords = await res.json();
      setWords(data);
    } catch (err) {
      console.error("Failed to fetch words:", err);
      setWords(null);
    } finally {
      setLoading(false);
    }
  }

  function goToPage(delta: number) {
    const next = currentPage() + delta;
    if (next >= 1 && next <= props.numPages) {
      setCurrentPage(next);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowLeft") goToPage(-1);
    if (e.key === "ArrowRight") goToPage(1);
  }

  // Keyboard navigation
  createEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <div class="h-full flex flex-col">
      {/* Toolbar */}
      <div class="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <button
          class="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-40"
          onClick={() => goToPage(-1)}
          disabled={currentPage() <= 1}
        >
          Previous
        </button>
        <span class="text-sm text-gray-600">
          Page {currentPage()} / {props.numPages}
        </span>
        <button
          class="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-40"
          onClick={() => goToPage(1)}
          disabled={currentPage() >= props.numPages}
        >
          Next
        </button>

        <div class="w-px h-5 bg-gray-300" />

        <label class="flex items-center gap-1.5 text-sm text-gray-600">
          Zoom:
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={scale()}
            onInput={(e) => setScale(parseFloat(e.currentTarget.value))}
            class="w-24"
          />
          <span class="w-10">{Math.round(scale() * 100)}%</span>
        </label>

        <div class="w-px h-5 bg-gray-300" />

        <label class="flex items-center gap-1.5 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showWords()}
            onChange={(e) => setShowWords(e.currentTarget.checked)}
          />
          Show words
        </label>

        <Show when={loading()}>
          <span class="text-xs text-amber-600">Extracting...</span>
        </Show>

        <Show when={words()}>
          <span class="text-xs text-gray-400 ml-auto">
            {words()!.words.length} words extracted
          </span>
        </Show>
      </div>

      {/* PDF + overlay */}
      <div class="flex-1 overflow-auto bg-gray-100 flex justify-center p-4" ref={containerRef}>
        <div class="relative inline-block shadow-lg">
          <canvas ref={canvasRef} class="block" />

          {/* Word overlay */}
          <Show when={showWords() && words()}>
            <div class="absolute inset-0">
              <For each={words()!.words}>
                {(word) => {
                  const canvasW = () => canvasRef.width;
                  const canvasH = () => canvasRef.height;

                  return (
                    <div
                      class="absolute border border-red-400/50 bg-red-500/5 cursor-pointer hover:bg-blue-500/20 hover:border-blue-500/60 transition-colors"
                      style={{
                        left: `${word.x0 * canvasW()}px`,
                        top: `${word.y0 * canvasH()}px`,
                        width: `${(word.x1 - word.x0) * canvasW()}px`,
                        height: `${(word.y1 - word.y0) * canvasH()}px`,
                      }}
                      onMouseEnter={() => setHoveredWord(word)}
                      onMouseLeave={() => setHoveredWord(null)}
                      title={word.text}
                    />
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>

      {/* Info bar */}
      <Show when={hoveredWord()}>
        <div class="px-4 py-1.5 bg-white border-t border-gray-200 text-sm text-gray-600 shrink-0">
          <span class="font-medium">"{hoveredWord()!.text}"</span>
          {" — "}
          x0: {hoveredWord()!.x0.toFixed(4)}, y0: {hoveredWord()!.y0.toFixed(4)},
          x1: {hoveredWord()!.x1.toFixed(4)}, y1: {hoveredWord()!.y1.toFixed(4)}
          {" | "}
          font: {hoveredWord()!.fontname}, size: {hoveredWord()!.size.toFixed(1)}
        </div>
      </Show>
    </div>
  );
}
