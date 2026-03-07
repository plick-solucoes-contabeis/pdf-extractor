import { createSignal, createEffect, onCleanup, For, Show, createResource } from "solid-js";
import * as pdfjsLib from "pdfjs-dist";
import type { Word, PageWords, Tool, TableAnnotation, IgnoreAnnotation, FooterAnnotation, Rect } from "../types";
import { TableOverlay } from "./TableOverlay";
import { IgnoreOverlay } from "./IgnoreOverlay";

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

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

export function PDFViewer(props: Props) {
  const [currentPage, setCurrentPage] = createSignal(1);
  const [scale, setScale] = createSignal(1.5);
  const [words, setWords] = createSignal<PageWords | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [showWords, setShowWords] = createSignal(false);
  const [hoveredWord, setHoveredWord] = createSignal<Word | null>(null);
  const [activeTool, setActiveTool] = createSignal<Tool>("select");
  const [tables, setTables] = createSignal<TableAnnotation[]>([]);
  const [ignores, setIgnores] = createSignal<IgnoreAnnotation[]>([]);
  const [footers, setFooters] = createSignal<FooterAnnotation[]>([]);
  const [selectedId, setSelectedId] = createSignal<{ type: "table" | "ignore" | "footer"; id: string } | null>(null);

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
        setDrawStart(null);
        setDrawCurrent(null);
      } else {
        setActiveTool("select");
        setSelectedId(null);
      }
    }
    if (e.key === "Delete" && selectedId()) {
      const sel = selectedId()!;
      if (sel.type === "table") handleDeleteTable(sel.id);
      else if (sel.type === "ignore") handleDeleteIgnore(sel.id);
      else if (sel.type === "footer") handleDeleteFooter(sel.id);
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
    const tool = activeTool();

    // Footer tool: single click = line, two clicks = match area
    if (tool === "footer") {
      if (e.button !== 0) return;
      const pos = getNormalizedPos(e);

      if (!drawStart()) {
        setDrawStart(pos);
        setDrawCurrent(pos);
        setSelectedId(null);
      } else {
        const start = drawStart()!;
        const w = Math.abs(pos.x - start.x);
        const h = Math.abs(pos.y - start.y);

        if (w < 0.02 || h < 0.02) {
          // Small area → line mode: use the first click's Y
          const newFooter: FooterAnnotation = {
            id: `footer-${nextId++}`,
            mode: "line",
            y: start.y,
            matchRegion: null,
            matchWords: null,
          };
          setFooters([...footers(), newFooter]);
          setSelectedId({ type: "footer", id: newFooter.id });
        } else {
          // Large area → match mode: capture text in region
          const x = Math.min(start.x, pos.x);
          const y = Math.min(start.y, pos.y);
          const region: Rect = { x, y, w, h };
          const capturedWords = getWordsInRegion(region);

          if (capturedWords.length === 0) {
            setDrawStart(null);
            setDrawCurrent(null);
            return;
          }

          const newFooter: FooterAnnotation = {
            id: `footer-${nextId++}`,
            mode: "match",
            y,
            matchRegion: region,
            matchWords: capturedWords,
          };
          setFooters([...footers(), newFooter]);
          setSelectedId({ type: "footer", id: newFooter.id });
        }

        setActiveTool("select");
        setDrawStart(null);
        setDrawCurrent(null);
      }
      return;
    }

    if (tool !== "table" && tool !== "ignore") {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "CANVAS" || tag === "DIV") {
        setSelectedId(null);
      }
      return;
    }
    if (e.button !== 0) return;

    const pos = getNormalizedPos(e);

    if (!drawStart()) {
      setDrawStart(pos);
      setDrawCurrent(pos);
      setSelectedId(null);
    } else {
      const start = drawStart()!;
      const x = Math.min(start.x, pos.x);
      const y = Math.min(start.y, pos.y);
      const w = Math.abs(pos.x - start.x);
      const h = Math.abs(pos.y - start.y);

      if (w < 0.02 || h < 0.02) {
        setDrawStart(null);
        setDrawCurrent(null);
        return;
      }

      const newRect: Rect = { x, y, w, h };
      const page = currentPage();

      if (tool === "table") {
        // Check overlap with ignore zones on this page
        const overlapsIgnore = ignores().some((ig) => {
          const igEnd = ig.endPage ?? ig.startPage;
          if (page < ig.startPage || page > igEnd) return false;
          return rectsOverlap(newRect, ig.region);
        });
        if (overlapsIgnore) {
          setDrawStart(null);
          setDrawCurrent(null);
          return;
        }
        const newTable: TableAnnotation = {
          id: `table-${nextId++}`,
          region: newRect,
          columns: [],
          startPage: page,
          endPage: null,
          endY: null,
        };
        setTables([...tables(), newTable]);
        setSelectedId({ type: "table", id: newTable.id });
      } else {
        // Check overlap with tables on this page
        const overlapsTable = tables().some((t) => {
          const tEnd = t.endPage ?? t.startPage;
          if (page < t.startPage || page > tEnd) return false;
          return rectsOverlap(newRect, t.region);
        });
        if (overlapsTable) {
          setDrawStart(null);
          setDrawCurrent(null);
          return;
        }
        const newIgnore: IgnoreAnnotation = {
          id: `ignore-${nextId++}`,
          region: newRect,
          startPage: page,
          endPage: null,
          endY: null,
        };
        setIgnores([...ignores(), newIgnore]);
        setSelectedId({ type: "ignore", id: newIgnore.id });
      }

      setActiveTool("select");
      setDrawStart(null);
      setDrawCurrent(null);
    }
  }

  function handleOverlayMouseMove(e: MouseEvent) {
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    if ((activeTool() === "table" || activeTool() === "ignore" || activeTool() === "footer") && drawStart()) {
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
    const sel = selectedId();
    if (sel?.type === "table" && sel.id === id) setSelectedId(null);
  }

  // Get space-joined text of words whose center falls inside a region
  function getWordsInRegion(region: Rect): string {
    const w = words();
    if (!w) return "";
    return w.words
      .filter((word) => {
        const cx = (word.x0 + word.x1) / 2;
        const cy = (word.y0 + word.y1) / 2;
        return cx >= region.x && cx <= region.x + region.w && cy >= region.y && cy <= region.y + region.h;
      })
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
      .map((w) => w.text)
      .join(" ");
  }

  function handleDeleteFooter(id: string) {
    setFooters(footers().filter((f) => f.id !== id));
    const sel = selectedId();
    if (sel?.type === "footer" && sel.id === id) setSelectedId(null);
  }

  // Search for a text sequence in the page words, return the Y of the first matched word or null
  function findTextOnPage(matchText: string): number | null {
    const w = words();
    if (!w || !matchText) return null;

    const sorted = [...w.words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const target = matchText;

    // Sliding window: try to find a contiguous sequence of words that joins to the target
    for (let i = 0; i < sorted.length; i++) {
      let joined = "";
      for (let j = i; j < sorted.length; j++) {
        joined += (j > i ? " " : "") + sorted[j].text;
        if (joined === target) {
          return sorted[i].y0; // Y of the first word in the match
        }
        if (joined.length >= target.length + 20) break; // no point continuing
      }
    }
    return null;
  }

  // Compute effective footer Y for the current page (null = no footer active)
  const footerYForPage = (): number | null => {
    let minY: number | null = null;

    for (const f of footers()) {
      if (f.mode === "line") {
        minY = minY === null ? f.y : Math.min(minY, f.y);
      } else if (f.mode === "match" && f.matchWords) {
        const foundY = findTextOnPage(f.matchWords);
        if (foundY !== null) {
          minY = minY === null ? foundY : Math.min(minY, foundY);
        }
      }
    }
    return minY;
  };

  const selectedFooter = () => {
    const sel = selectedId();
    if (sel?.type !== "footer") return null;
    return footers().find((f) => f.id === sel.id) ?? null;
  };

  function handleUpdateIgnore(updated: IgnoreAnnotation) {
    setIgnores(ignores().map((ig) => (ig.id === updated.id ? updated : ig)));
  }

  function handleDeleteIgnore(id: string) {
    setIgnores(ignores().filter((ig) => ig.id !== id));
    const sel = selectedId();
    if (sel?.type === "ignore" && sel.id === id) setSelectedId(null);
  }

  // Tables visible on current page (own page or multi-page span)
  function getTableRegionForPage(table: TableAnnotation, page: number): { y: number; h: number } | null {
    const start = table.startPage;
    const end = table.endPage ?? table.startPage;

    if (page < start || page > end) return null;

    if (start === end) {
      // Single page table
      return { y: table.region.y, h: table.region.h };
    }

    if (page === start) {
      // First page: from region.y to bottom
      return { y: table.region.y, h: 1 - table.region.y };
    }

    if (page === end) {
      // Last page: from top to endY
      const endY = table.endY ?? 1;
      return { y: 0, h: endY };
    }

    // Middle page: full height
    return { y: 0, h: 1 };
  }

  const pageTables = () => {
    const page = currentPage();
    const igRegions = pageIgnores().map((e) => e!.pageRegion);
    const fY = footerYForPage();

    return tables()
      .map((t) => {
        const region = getTableRegionForPage(t, page);
        if (!region) return null;

        let tY = region.y;
        let tBottom = region.y + region.h;

        // Clamp table bottom to footer line
        if (fY !== null && tBottom > fY) {
          tBottom = fY;
          if (tBottom <= tY) return null;
        }

        // Adjust table region to exclude overlapping ignore zones
        for (const ig of igRegions) {
          // Check horizontal overlap
          if (ig.x >= t.region.x + t.region.w || ig.x + ig.w <= t.region.x) continue;

          const igBottom = ig.y + ig.h;

          // Check vertical overlap
          if (ig.y >= tBottom || igBottom <= tY) continue;

          // Ignore fully contains the table
          if (ig.y <= tY && igBottom >= tBottom) return null;

          // Decide: push top down or bottom up based on which side the ignore is closer to
          const igMid = (ig.y + igBottom) / 2;
          const tMid = (tY + tBottom) / 2;
          if (igMid < tMid) {
            tY = Math.max(tY, igBottom);
          } else {
            tBottom = Math.min(tBottom, ig.y);
          }
        }

        const adjustedH = tBottom - tY;
        if (adjustedH < 0.01) return null;

        return {
          table: t,
          pageRegion: { ...t.region, y: tY, h: adjustedH },
        };
      })
      .filter((t) => t !== null);
  };

  // Ignore region for a given page — same rectangle replicated on every page in range
  function getIgnoreRegionForPage(ig: IgnoreAnnotation, page: number): { y: number; h: number } | null {
    const start = ig.startPage;
    const end = ig.endPage ?? ig.startPage;
    if (page < start || page > end) return null;
    return { y: ig.region.y, h: ig.region.h };
  }

  const pageIgnores = () => {
    const page = currentPage();
    return ignores()
      .map((ig) => {
        const region = getIgnoreRegionForPage(ig, page);
        if (!region) return null;
        return {
          ignore: ig,
          pageRegion: { ...ig.region, y: region.y, h: region.h },
        };
      })
      .filter((ig) => ig !== null);
  };

  const selectedTable = () => {
    const sel = selectedId();
    if (sel?.type !== "table") return null;
    return tables().find((t) => t.id === sel.id) ?? null;
  };

  const selectedIgnore = () => {
    const sel = selectedId();
    if (sel?.type !== "ignore") return null;
    return ignores().find((ig) => ig.id === sel.id) ?? null;
  };

  // Ignore regions on the current page (for filtering words in TableOverlay)
  const activeIgnoreRegions = () => pageIgnores().map((entry) => entry!.pageRegion);

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
          <button
            class={`px-2.5 py-1 text-sm rounded ${
              activeTool() === "ignore"
                ? "bg-red-100 text-red-700"
                : "bg-gray-100 hover:bg-gray-200 text-gray-600"
            }`}
            onClick={() => setActiveTool("ignore")}
          >
            Ignore
          </button>
          <button
            class={`px-2.5 py-1 text-sm rounded ${
              activeTool() === "footer"
                ? "bg-amber-100 text-amber-700"
                : "bg-gray-100 hover:bg-gray-200 text-gray-600"
            }`}
            onClick={() => setActiveTool("footer")}
          >
            Footer
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

        <span class="text-xs text-gray-400 ml-auto">
          {tables().length > 0 ? `${tables().length} table(s)` : ""}
          {ignores().length > 0 ? ` | ${ignores().length} ignore(s)` : ""}
          {footers().length > 0 ? ` | ${footers().length} footer(s)` : ""}
          {words() ? ` | ${words()!.words.length} words` : ""}
        </span>
      </div>

      {/* Hint bar */}
      <Show when={activeTool() === "table"}>
        <div class="px-4 py-1 bg-blue-50 text-xs text-blue-600 border-b border-blue-100 shrink-0">
          {drawStart()
            ? "Click to set the second corner. Press Escape to cancel."
            : "Click to set the first corner of the table area."}
        </div>
      </Show>
      <Show when={activeTool() === "footer"}>
        <div class="px-4 py-1 bg-amber-50 text-xs text-amber-600 border-b border-amber-100 shrink-0">
          {drawStart()
            ? "Click nearby for a line footer, or farther to select a match area. Escape to cancel."
            : "Click to set the footer line. Or click twice to select a text-match area."}
        </div>
      </Show>
      <Show when={selectedFooter()}>
        <div class="px-4 py-1 bg-amber-50 text-xs text-amber-600 border-b border-amber-100 shrink-0 flex items-center gap-3">
          <span>
            Footer ({selectedFooter()!.mode === "line" ? "line" : "text match"}) at {Math.round(selectedFooter()!.y * 100)}%.
            {selectedFooter()!.mode === "match" ? ` Text: "${selectedFooter()!.matchWords}"` : ""}
          </span>
          <button
            class="px-2 py-0.5 bg-red-500 text-white text-xs rounded hover:bg-red-600"
            onClick={() => handleDeleteFooter(selectedFooter()!.id)}
          >
            Delete
          </button>
        </div>
      </Show>
      <Show when={activeTool() === "ignore"}>
        <div class="px-4 py-1 bg-red-50 text-xs text-red-600 border-b border-red-100 shrink-0">
          {drawStart()
            ? "Click to set the second corner. Press Escape to cancel."
            : "Click to set the first corner of the ignore area."}
        </div>
      </Show>
      <Show when={selectedIgnore()}>
        <div class="px-4 py-1 bg-red-50 text-xs text-red-600 border-b border-red-100 shrink-0 flex items-center gap-3">
          <span>Ignore zone selected. Delete to remove.</span>
          <div class="w-px h-4 bg-red-200" />
          <Show
            when={selectedIgnore()!.endPage !== null}
            fallback={
              <button
                class="px-2 py-0.5 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                onClick={() => {
                  const ig = selectedIgnore()!;
                  // Check if extending would overlap with any table on any page
                  const wouldOverlap = tables().some((t) => {
                    const tEnd = t.endPage ?? t.startPage;
                    // Check if the page ranges would overlap
                    if (props.numPages < t.startPage || 1 > tEnd) return false;
                    return rectsOverlap(ig.region, t.region);
                  });
                  if (wouldOverlap) return; // silently block
                  handleUpdateIgnore({ ...ig, endPage: props.numPages });
                }}
              >
                Replicate on all pages
              </button>
            }
          >
            <span class="text-xs">
              Replicated on pages {selectedIgnore()!.startPage}–{selectedIgnore()!.endPage}
            </span>
            <button
              class="px-2 py-0.5 bg-gray-500 text-white text-xs rounded hover:bg-gray-600"
              onClick={() => {
                const ig = selectedIgnore()!;
                handleUpdateIgnore({ ...ig, endPage: null });
              }}
            >
              Single page only
            </button>
          </Show>
        </div>
      </Show>
      <Show when={selectedTable()}>
        <div class="px-4 py-1 bg-green-50 text-xs text-green-600 border-b border-green-100 shrink-0 flex items-center gap-3">
          <span>Click inside table to add column dividers. Right-click divider to remove. Delete to remove table.</span>
          <div class="w-px h-4 bg-green-200" />
          <Show
            when={selectedTable()!.endPage !== null}
            fallback={
              <button
                class="px-2 py-0.5 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                onClick={() => {
                  const t = selectedTable()!;
                  // Check if extending would overlap with any ignore on any page
                  const wouldOverlap = ignores().some((ig) => {
                    const igEnd = ig.endPage ?? ig.startPage;
                    if (props.numPages < ig.startPage || 1 > igEnd) return false;
                    return rectsOverlap(t.region, ig.region);
                  });
                  if (wouldOverlap) return;
                  handleUpdateTable({ ...t, endPage: props.numPages, endY: null });
                }}
              >
                Extend to all pages
              </button>
            }
          >
            <span class="text-xs">
              Pages {selectedTable()!.startPage}–{selectedTable()!.endPage}
              {selectedTable()!.endY !== null ? ` (ends at ${Math.round(selectedTable()!.endY! * 100)}%)` : ""}
            </span>
            <button
              class="px-2 py-0.5 bg-amber-600 text-white text-xs rounded hover:bg-amber-700"
              onClick={() => {
                const t = selectedTable()!;
                // Set end delimiter at current page, current position (middle as default)
                handleUpdateTable({ ...t, endPage: currentPage(), endY: 0.5 });
              }}
            >
              Set end here
            </button>
            <button
              class="px-2 py-0.5 bg-gray-500 text-white text-xs rounded hover:bg-gray-600"
              onClick={() => {
                const t = selectedTable()!;
                handleUpdateTable({ ...t, endPage: null, endY: null });
              }}
            >
              Single page
            </button>
          </Show>
        </div>
      </Show>

      {/* PDF + overlay */}
      <div class="flex-1 overflow-auto bg-gray-100 flex justify-center p-4" ref={scrollContainerRef} onScroll={handleScroll}>
        <div
          class="relative inline-block shadow-lg"
          style={{
            cursor: activeTool() !== "select" ? "crosshair" : "default",
          }}
          onClick={handleOverlayClick}
          onMouseMove={handleOverlayMouseMove}
          onWheel={handleWheel}
        >
          <canvas ref={canvasRef} class="block" />

          {/* Overlay layer */}
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
                const tool = activeTool();

                // Footer tool: show horizontal line at start Y, plus optional area if dragging
                if (tool === "footer") {
                  const w = Math.abs(c.x - s.x);
                  const h = Math.abs(c.y - s.y);
                  const isArea = w >= 0.02 && h >= 0.02;

                  return (
                    <>
                      {/* Always show the footer line at start Y */}
                      <div
                        class="absolute pointer-events-none"
                        style={{
                          left: "0px",
                          top: `${s.y * canvasRef.height - 1}px`,
                          width: `${canvasRef.width}px`,
                          height: "2px",
                          "background-color": "rgb(217, 119, 6)",
                        }}
                      />
                      <div
                        class="absolute pointer-events-none px-1.5 py-0.5 bg-amber-600 text-white text-xs rounded"
                        style={{
                          right: "0px",
                          top: `${s.y * canvasRef.height - 10}px`,
                        }}
                      >
                        Footer {isArea ? "(match)" : "(line)"}
                      </div>
                      {/* Show match area preview if large enough */}
                      <Show when={isArea}>
                        <div
                          class="absolute border-2 border-dashed border-amber-500 bg-amber-500/10 pointer-events-none"
                          style={{
                            left: `${Math.min(s.x, c.x) * canvasRef.width}px`,
                            top: `${Math.min(s.y, c.y) * canvasRef.height}px`,
                            width: `${w * canvasRef.width}px`,
                            height: `${h * canvasRef.height}px`,
                          }}
                        />
                      </Show>
                    </>
                  );
                }

                const x = Math.min(s.x, c.x);
                const y = Math.min(s.y, c.y);
                const w = Math.abs(c.x - s.x);
                const h = Math.abs(c.y - s.y);
                return (
                  <div
                    class={`absolute border-2 border-dashed pointer-events-none ${
                      tool === "ignore"
                        ? "border-red-500 bg-red-500/10"
                        : "border-blue-500 bg-blue-500/10"
                    }`}
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

            {/* Table annotations for current page */}
            <For each={pageTables()}>
              {(entry) => (
                <TableOverlay
                  table={entry!.table}
                  pageRegion={entry!.pageRegion}
                  canvasWidth={canvasRef?.width ?? 0}
                  canvasHeight={canvasRef?.height ?? 0}
                  words={words()?.words ?? []}
                  ignoreRegions={activeIgnoreRegions()}
                  footerY={footerYForPage()}
                  onUpdate={handleUpdateTable}
                  onDelete={handleDeleteTable}
                  selected={selectedId()?.type === "table" && selectedId()?.id === entry!.table.id}
                  onSelect={() => setSelectedId({ type: "table", id: entry!.table.id })}
                  isMultiPage={(entry!.table.endPage ?? entry!.table.startPage) !== entry!.table.startPage}
                  currentPage={currentPage()}
                />
              )}
            </For>

            {/* Table end delimiter line (draggable) */}
            <Show when={selectedTable() && selectedTable()!.endPage === currentPage() && selectedTable()!.endY !== null}>
              {(() => {
                const t = selectedTable()!;
                const y = t.endY! * canvasRef.height;
                return (
                  <div
                    class="absolute pointer-events-auto"
                    style={{
                      left: `${t.region.x * canvasRef.width}px`,
                      top: `${y - 2}px`,
                      width: `${t.region.w * canvasRef.width}px`,
                      height: "4px",
                      cursor: "row-resize",
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const startY = e.clientY;
                      const startEndY = t.endY!;
                      const cRect = canvasRef.getBoundingClientRect();
                      const scaleY = canvasRef.height / cRect.height;

                      function onMove(ev: MouseEvent) {
                        const dy = (ev.clientY - startY) * scaleY;
                        const newEndY = Math.max(0, Math.min(1, startEndY + dy / canvasRef.height));
                        handleUpdateTable({ ...t, endY: newEndY });
                      }
                      function onUp() {
                        document.removeEventListener("mousemove", onMove);
                        document.removeEventListener("mouseup", onUp);
                      }
                      document.addEventListener("mousemove", onMove);
                      document.addEventListener("mouseup", onUp);
                    }}
                  >
                    <div class="w-full h-0.5 bg-red-500" />
                    <div class="absolute -right-16 -top-2.5 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded whitespace-nowrap">
                      End
                    </div>
                  </div>
                );
              })()}
            </Show>

            {/* Ignore annotations for current page */}
            <For each={pageIgnores()}>
              {(entry) => (
                <IgnoreOverlay
                  ignore={entry!.ignore}
                  pageRegion={entry!.pageRegion}
                  canvasWidth={canvasRef?.width ?? 0}
                  canvasHeight={canvasRef?.height ?? 0}
                  selected={selectedId()?.type === "ignore" && selectedId()?.id === entry!.ignore.id}
                  onSelect={() => setSelectedId({ type: "ignore", id: entry!.ignore.id })}
                  onUpdate={handleUpdateIgnore}
                  onDelete={handleDeleteIgnore}
                  isMultiPage={(entry!.ignore.endPage ?? entry!.ignore.startPage) !== entry!.ignore.startPage}
                  currentPage={currentPage()}
                />
              )}
            </For>

            {/* Footer lines */}
            <For each={footers()}>
              {(f) => {
                // For match mode, find where the text appears on this page
                const effectiveY = () => {
                  if (f.mode === "line") return f.y;
                  if (f.mode === "match" && f.matchWords) {
                    return findTextOnPage(f.matchWords);
                  }
                  return null;
                };
                const isActive = () => effectiveY() !== null;
                const lineY = () => effectiveY() ?? f.y; // fallback to original Y for display
                const isSel = () => selectedId()?.type === "footer" && selectedId()?.id === f.id;

                return (
                  <>
                    {/* Footer line */}
                    <div
                      class="absolute pointer-events-auto"
                      style={{
                        left: "0px",
                        top: `${lineY() * (canvasRef?.height ?? 0) - 2}px`,
                        width: `${canvasRef?.width ?? 0}px`,
                        height: "4px",
                        cursor: "pointer",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId({ type: "footer", id: f.id });
                      }}
                    >
                      <div
                        class="w-full h-0.5"
                        style={{
                          "background-color": isActive()
                            ? isSel() ? "rgb(217, 119, 6)" : "rgb(245, 158, 11)"
                            : "rgb(209, 213, 219)",
                          "border-top": isSel() ? "1px dashed rgb(217, 119, 6)" : undefined,
                          "border-bottom": isSel() ? "1px dashed rgb(217, 119, 6)" : undefined,
                        }}
                      />
                    </div>
                    {/* Footer label */}
                    <div
                      class={`absolute pointer-events-auto px-1.5 py-0.5 text-xs text-white rounded cursor-pointer ${
                        isActive() ? "bg-amber-600" : "bg-gray-400"
                      }`}
                      style={{
                        right: "0px",
                        top: `${lineY() * (canvasRef?.height ?? 0) - 18}px`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId({ type: "footer", id: f.id });
                      }}
                    >
                      Footer {f.mode === "match" ? "(match)" : ""}
                      {!isActive() ? " ✗" : ""}
                      <button
                        class="ml-1.5 hover:text-red-200"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFooter(f.id);
                        }}
                      >
                        x
                      </button>
                    </div>
                    {/* Footer shaded area (below the line, when active) */}
                    <Show when={isActive()}>
                      <div
                        class="absolute pointer-events-none bg-amber-500/5"
                        style={{
                          left: "0px",
                          top: `${lineY() * (canvasRef?.height ?? 0)}px`,
                          width: `${canvasRef?.width ?? 0}px`,
                          height: `${(1 - lineY()) * (canvasRef?.height ?? 0)}px`,
                        }}
                      />
                    </Show>
                  </>
                );
              }}
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
