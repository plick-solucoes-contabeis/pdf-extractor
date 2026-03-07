import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import * as pdfjsLib from "pdfjs-dist";
import type { Word, PageWords, Tool, TableAnnotation } from "../types";
import { TableOverlay } from "./TableOverlay";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type Props = {
  pdfUrl: string;
  pdfId: number;
  numPages: number;
};

let nextId = 1;

export function PDFViewer(props: Props) {
  const [currentPage, setCurrentPage] = createSignal(1);
  const [scale, setScale] = createSignal(1.5);
  const [words, setWords] = createSignal<PageWords | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [showWords, setShowWords] = createSignal(false);
  const [hoveredWord, setHoveredWord] = createSignal<Word | null>(null);
  const [activeTool, setActiveTool] = createSignal<Tool>("select");
  const [tables, setTables] = createSignal<TableAnnotation[]>([]);
  const [selectedTableId, setSelectedTableId] = createSignal<string | null>(null);

  // Drawing state (two-click: first click = start, second click = end)
  const [drawStart, setDrawStart] = createSignal<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = createSignal<{ x: number; y: number } | null>(null);

  let canvasRef!: HTMLCanvasElement;
  let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  let overlayRef!: HTMLDivElement;
  let scrollContainerRef!: HTMLDivElement;
  let lastClientX = 0;
  let lastClientY = 0;

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
    if (e.key === "Escape") {
      if (drawStart()) {
        // Cancel current drawing
        setDrawStart(null);
        setDrawCurrent(null);
      } else {
        setActiveTool("select");
        setSelectedTableId(null);
      }
    }
    if (e.key === "Delete" && selectedTableId()) {
      handleDeleteTable(selectedTableId()!);
    }
  }

  createEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  // --- Drawing handlers ---
  function getNormalizedPos(e: MouseEvent) {
    const w = canvasRef.width;
    const h = canvasRef.height;
    const rect = canvasRef.getBoundingClientRect();
    // Map from screen coords to normalized 0-1 using canvas pixel dimensions
    const scaleX = w / rect.width;
    const scaleY = h / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    return {
      x: Math.max(0, Math.min(1, px / w)),
      y: Math.max(0, Math.min(1, py / h)),
    };
  }

  function handleOverlayClick(e: MouseEvent) {
    if (activeTool() !== "table") {
      // Deselect when clicking on canvas or empty area
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "CANVAS" || tag === "DIV") {
        setSelectedTableId(null);
      }
      return;
    }
    if (e.button !== 0) return;

    const pos = getNormalizedPos(e);

    if (!drawStart()) {
      // First click: set start point
      setDrawStart(pos);
      setDrawCurrent(pos);
      setSelectedTableId(null);
    } else {
      // Second click: create table
      const start = drawStart()!;
      const x = Math.min(start.x, pos.x);
      const y = Math.min(start.y, pos.y);
      const w = Math.abs(pos.x - start.x);
      const h = Math.abs(pos.y - start.y);

      // Minimum size check
      if (w < 0.02 || h < 0.02) {
        setDrawStart(null);
        setDrawCurrent(null);
        return;
      }

      const newTable: TableAnnotation = {
        id: `table-${nextId++}`,
        region: { x, y, w, h },
        columns: [],
        page: currentPage(),
      };

      setTables([...tables(), newTable]);
      setSelectedTableId(newTable.id);
      setActiveTool("select");
      setDrawStart(null);
      setDrawCurrent(null);
      stopAutoScroll();
    }
  }

  function handleOverlayMouseMove(e: MouseEvent) {
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    if (activeTool() === "table" && drawStart()) {
      updateDrawCurrent();
    }
  }

  function handleScroll() {
    if (drawStart()) {
      updateDrawCurrent();
    }
  }

  function handleWheel(e: WheelEvent) {
    if (drawStart() && scrollContainerRef) {
      scrollContainerRef.scrollBy(0, e.deltaY);
      updateDrawCurrent();
      e.preventDefault();
    }
  }

  function updateDrawCurrent() {
    const cRect = canvasRef.getBoundingClientRect();
    const w = canvasRef.width;
    const h = canvasRef.height;
    const scaleX = w / cRect.width;
    const scaleY = h / cRect.height;
    setDrawCurrent({
      x: Math.max(0, Math.min(1, ((lastClientX - cRect.left) * scaleX) / w)),
      y: Math.max(0, Math.min(1, ((lastClientY - cRect.top) * scaleY) / h)),
    });
  }

  function handleUpdateTable(updated: TableAnnotation) {
    setTables(tables().map((t) => (t.id === updated.id ? updated : t)));
  }

  function handleDeleteTable(id: string) {
    setTables(tables().filter((t) => t.id !== id));
    if (selectedTableId() === id) setSelectedTableId(null);
  }

  // Current page tables
  const pageTables = () => tables().filter((t) => t.page === currentPage());

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

        {/* Tools */}
        <div class="flex items-center gap-1">
          <button
            class={`px-2.5 py-1 text-sm rounded ${
              activeTool() === "select"
                ? "bg-blue-100 text-blue-700"
                : "bg-gray-100 hover:bg-gray-200 text-gray-600"
            }`}
            onClick={() => setActiveTool("select")}
          >
            Select
          </button>
          <button
            class={`px-2.5 py-1 text-sm rounded ${
              activeTool() === "table"
                ? "bg-blue-100 text-blue-700"
                : "bg-gray-100 hover:bg-gray-200 text-gray-600"
            }`}
            onClick={() => setActiveTool("table")}
          >
            Table
          </button>
        </div>

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

        <Show when={pageTables().length > 0}>
          <span class="text-xs text-gray-400 ml-auto">
            {pageTables().length} table(s)
            {words() ? ` | ${words()!.words.length} words` : ""}
          </span>
        </Show>
      </div>

      {/* Hint bar */}
      <Show when={activeTool() === "table"}>
        <div class="px-4 py-1 bg-blue-50 text-xs text-blue-600 border-b border-blue-100 shrink-0">
          {drawStart()
            ? "Click to set the second corner. Press Escape to cancel."
            : "Click to set the first corner of the table area."}
        </div>
      </Show>
      <Show when={selectedTableId()}>
        <div class="px-4 py-1 bg-green-50 text-xs text-green-600 border-b border-green-100 shrink-0">
          Click inside the table to add column dividers. Right-click a divider to remove it. Press Delete to remove table.
        </div>
      </Show>

      {/* PDF + overlay */}
      <div class="flex-1 overflow-auto bg-gray-100 flex justify-center p-4" ref={scrollContainerRef} onScroll={handleScroll}>
        <div
          class="relative inline-block shadow-lg"
          style={{
            cursor: activeTool() === "table" ? "crosshair" : "default",
          }}
          onClick={handleOverlayClick}
          onMouseMove={handleOverlayMouseMove}
          onWheel={handleWheel}
        >
          <canvas ref={canvasRef} class="block" />

          {/* Overlay layer (pointer-events: none so scroll works through it) */}
          <div
            ref={overlayRef}
            class="absolute top-0 left-0 pointer-events-none"
            style={{
              width: `${canvasRef?.width ?? 0}px`,
              height: `${canvasRef?.height ?? 0}px`,
            }}
          >
            {/* Word boxes */}
            <Show when={showWords() && words()}>
              <For each={words()!.words}>
                {(word) => (
                  <div
                    class="absolute border border-red-400/50 bg-red-500/5 pointer-events-auto hover:bg-blue-500/20 hover:border-blue-500/60 transition-colors"
                    style={{
                      left: `${word.x0 * canvasRef.width}px`,
                      top: `${word.y0 * canvasRef.height}px`,
                      width: `${(word.x1 - word.x0) * canvasRef.width}px`,
                      height: `${(word.y1 - word.y0) * canvasRef.height}px`,
                    }}
                    onMouseEnter={() => setHoveredWord(word)}
                    onMouseLeave={() => setHoveredWord(null)}
                    title={word.text}
                  />
                )}
              </For>
            </Show>

            {/* Drawing preview */}
            <Show when={drawStart() && drawCurrent()}>
              {(() => {
                const s = drawStart()!;
                const c = drawCurrent()!;
                const x = Math.min(s.x, c.x);
                const y = Math.min(s.y, c.y);
                const w = Math.abs(c.x - s.x);
                const h = Math.abs(c.y - s.y);
                return (
                  <div
                    class="absolute border-2 border-dashed border-blue-500 bg-blue-500/10 pointer-events-none"
                    style={{
                      left: `${x * canvasRef.width}px`,
                      top: `${y * canvasRef.height}px`,
                      width: `${w * canvasRef.width}px`,
                      height: `${h * canvasRef.height}px`,
                    }}
                  />
                );
              })()}
            </Show>

            {/* Table annotations */}
            <For each={pageTables()}>
              {(table) => (
                <TableOverlay
                  table={table}
                  canvasWidth={canvasRef?.width ?? 0}
                  canvasHeight={canvasRef?.height ?? 0}
                  words={words()?.words ?? []}
                  onUpdate={handleUpdateTable}
                  onDelete={handleDeleteTable}
                  selected={selectedTableId() === table.id}
                  onSelect={() => setSelectedTableId(table.id)}
                />
              )}
            </For>
          </div>
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
