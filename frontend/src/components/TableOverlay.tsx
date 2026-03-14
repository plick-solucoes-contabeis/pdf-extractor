import { For, Show, createSignal, createMemo } from "solid-js";
import type { TableAnnotation, Rect, Word } from "../types";
import { extractTableData } from "../lib/extract";

type Props = {
  table: TableAnnotation;
  pageRegion: Rect; // adjusted region for this specific page
  canvasWidth: number;
  canvasHeight: number;
  words: Word[];
  ignoreRegions: Rect[];
  footerY: number | null;
  onUpdate: (table: TableAnnotation) => void;
  onDelete: (id: string) => void;
  selected: boolean;
  onSelect: () => void;
  isMultiPage: boolean;
  currentPage: number;
  interactive: boolean;
  pageHeight: number; // PDF page height in points
};

export function TableOverlay(props: Props) {
  const [draggingCol, setDraggingCol] = createSignal<number | null>(null);
  const [hoverColIdx, setHoverColIdx] = createSignal<number | null>(null);

  const px = (nx: number) => nx * props.canvasWidth;
  const py = (ny: number) => ny * props.canvasHeight;

  const regionPx = () => ({
    left: px(props.pageRegion.x),
    top: py(props.pageRegion.y),
    width: px(props.pageRegion.w),
    height: py(props.pageRegion.h),
  });

  function isWordInIgnoreZone(word: Word): boolean {
    const cx = (word.x0 + word.x1) / 2;
    const cy = (word.y0 + word.y1) / 2;
    return props.ignoreRegions.some(
      (ig) =>
        cx >= ig.x && cx <= ig.x + ig.w &&
        cy >= ig.y && cy <= ig.y + ig.h
    );
  }

  // Words that fall within the page-adjusted region, excluding ignored zones and footer
  const tableWords = createMemo(() => {
    const r = props.pageRegion;
    const fY = props.footerY;
    return props.words.filter(
      (w) =>
        w.x0 >= r.x - 0.001 &&
        w.x1 <= r.x + r.w + 0.001 &&
        w.y0 >= r.y - 0.001 &&
        w.y1 <= r.y + r.h + 0.001 &&
        !isWordInIgnoreZone(w) &&
        (fY === null || (w.y0 + w.y1) / 2 < fY)
    );
  });

  // Extract data by columns
  const extractedData = createMemo(() => {
    const words = tableWords();
    if (words.length === 0) return [];
    const gap = (props.table.lineMergeDistance ?? 0) / props.pageHeight;
    return extractTableData(words, props.pageRegion, props.table.columns, gap);
  });

  let tableRegionRef!: HTMLDivElement;

  function handleAddColumn(e: MouseEvent) {
    if (!props.selected) return;
    e.stopPropagation();

    const rect = tableRegionRef.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const normalizedX = clickX / rect.width;

    if (normalizedX > 0.02 && normalizedX < 0.98) {
      const newCols = [...props.table.columns, { position: normalizedX, splitPhrases: true }];
      props.onUpdate({ ...props.table, columns: newCols });
    }
  }

  function handleColMouseDown(idx: number, e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setDraggingCol(idx);

    const startX = e.clientX;
    const colObj = props.table.columns[idx];
    const startVal = typeof colObj === "number" ? colObj : colObj.position;
    const regionW = regionPx().width;

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const newVal = Math.max(0.02, Math.min(0.98, startVal + dx / regionW));
      const newCols = [...props.table.columns];
      const existing = newCols[idx];
      newCols[idx] = typeof existing === "number"
        ? { position: newVal, splitPhrases: true }
        : { ...existing, position: newVal };
      props.onUpdate({ ...props.table, columns: newCols });
    }

    function onUp() {
      setDraggingCol(null);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function handleRemoveColumn(idx: number, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const newCols = props.table.columns.filter((_, i) => i !== idx);
    props.onUpdate({ ...props.table, columns: newCols });
  }

  const isStartPage = () => props.currentPage === props.table.startPage;
  const isEndPage = () => props.currentPage === (props.table.endPage ?? props.table.startPage);

  const borderStyle = () => {
    const base = props.selected ? "border-blue-500" : "border-green-500";
    const bg = props.selected ? "bg-blue-500/5" : "bg-green-500/5";
    // Dashed borders for pages where the table continues beyond
    const style = props.isMultiPage ? "border-dashed" : "";
    return `${base} ${bg} ${style}`;
  };

  return (
    <>
      {/* Table region */}
      <div
        ref={tableRegionRef}
        class={`absolute border-2 ${props.interactive ? "pointer-events-auto" : "pointer-events-none"} ${borderStyle()}`}
        style={{
          left: `${regionPx().left}px`,
          top: `${regionPx().top}px`,
          width: `${regionPx().width}px`,
          height: `${regionPx().height}px`,
          cursor: props.selected ? "crosshair" : "pointer",
          // Visual hints for multi-page continuation
          "border-top-style": !isStartPage() ? "dashed" : undefined,
          "border-bottom-style": !isEndPage() ? "dashed" : undefined,
        }}
        onClick={(e) => {
          if (props.selected) {
            handleAddColumn(e);
          } else {
            e.stopPropagation();
            props.onSelect();
          }
        }}
      >
        {/* Column dividers */}
        <For each={props.table.columns}>
          {(col, idx) => {
            const pos = () => typeof col === "number" ? col : col.position;
            const split = () => typeof col === "number" ? true : col.splitPhrases;
            return (
            <div
              class={`absolute top-0 h-full w-0.5 ${
                hoverColIdx() === idx()
                  ? "bg-red-500"
                  : draggingCol() === idx()
                  ? "bg-blue-700"
                  : split()
                  ? "bg-blue-500"
                  : "bg-orange-500"
              }`}
              style={{
                left: `${pos() * 100}%`,
                cursor: "col-resize",
                "padding-left": "4px",
                "padding-right": "4px",
                "margin-left": "-4px",
              }}
              onMouseDown={(e) => handleColMouseDown(idx(), e)}
              onContextMenu={(e) => handleRemoveColumn(idx(), e)}
              onMouseEnter={() => setHoverColIdx(idx())}
              onMouseLeave={() => setHoverColIdx(null)}
            />
          );}}
        </For>

        {/* Label (only on start page) */}
        <Show when={isStartPage()}>
          <div
            class={`absolute -top-6 left-0 px-1.5 py-0.5 text-xs text-white rounded-t ${
              props.selected ? "bg-blue-500" : "bg-green-500"
            }`}
          >
            Table
            {props.isMultiPage ? ` (p${props.table.startPage}–${props.table.endPage})` : ""}
            <button
              class="ml-2 hover:text-red-200"
              onClick={(e) => {
                e.stopPropagation();
                props.onDelete(props.table.id);
              }}
            >
              x
            </button>
          </div>
        </Show>

        {/* Continuation indicator */}
        <Show when={props.isMultiPage && !isStartPage()}>
          <div class="absolute -top-5 left-0 text-xs text-gray-400">
            ...continues from p{props.table.startPage}
          </div>
        </Show>
        <Show when={props.isMultiPage && !isEndPage()}>
          <div class="absolute -bottom-5 left-0 text-xs text-gray-400">
            continues on next page...
          </div>
        </Show>

        {/* Hint when selected and no columns */}
        <Show when={props.selected && props.table.columns.length === 0}>
          <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span class="text-xs text-blue-500 bg-white/80 px-2 py-1 rounded">
              Click to add column dividers | Right-click divider to remove
            </span>
          </div>
        </Show>
      </div>

      {/* Extracted data preview */}
      <Show when={props.selected && extractedData().length > 0}>
        <div
          class="absolute bg-white border border-gray-300 rounded shadow-lg p-2 text-xs max-h-60 overflow-auto z-50 pointer-events-auto"
          style={{
            left: `${regionPx().left}px`,
            top: `${regionPx().top + regionPx().height + 8}px`,
            "min-width": `${Math.min(regionPx().width, 500)}px`,
          }}
        >
          <div class="text-gray-400 mb-1">
            Page {props.currentPage} — {extractedData().length} rows
          </div>
          <table class="w-full border-collapse">
            <tbody>
              <For each={extractedData()}>
                {(row) => (
                  <tr class="border-b border-gray-100">
                    <For each={row}>
                      {(cell) => (
                        <td class="px-2 py-1 border-r border-gray-100 last:border-r-0">
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
      </Show>
    </>
  );
}
