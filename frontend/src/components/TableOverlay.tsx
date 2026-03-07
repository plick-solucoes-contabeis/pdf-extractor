import { For, Show, createSignal, createMemo } from "solid-js";
import type { TableAnnotation, Word } from "../types";

type Props = {
  table: TableAnnotation;
  canvasWidth: number;
  canvasHeight: number;
  words: Word[];
  onUpdate: (table: TableAnnotation) => void;
  onDelete: (id: string) => void;
  selected: boolean;
  onSelect: () => void;
};

export function TableOverlay(props: Props) {
  const [draggingCol, setDraggingCol] = createSignal<number | null>(null);
  const [hoverColIdx, setHoverColIdx] = createSignal<number | null>(null);

  const px = (nx: number) => nx * props.canvasWidth;
  const py = (ny: number) => ny * props.canvasHeight;

  const regionPx = () => ({
    left: px(props.table.region.x),
    top: py(props.table.region.y),
    width: px(props.table.region.w),
    height: py(props.table.region.h),
  });

  // Words that fall within the table region
  const tableWords = createMemo(() => {
    const r = props.table.region;
    return props.words.filter(
      (w) =>
        w.x0 >= r.x - 0.001 &&
        w.x1 <= r.x + r.w + 0.001 &&
        w.y0 >= r.y - 0.001 &&
        w.y1 <= r.y + r.h + 0.001
    );
  });

  // Extract data by columns
  const extractedData = createMemo(() => {
    const r = props.table.region;
    const cols = [0, ...props.table.columns.sort((a, b) => a - b), 1];
    const columnRanges: { start: number; end: number }[] = [];

    for (let i = 0; i < cols.length - 1; i++) {
      columnRanges.push({
        start: r.x + cols[i] * r.w,
        end: r.x + cols[i + 1] * r.w,
      });
    }

    // Group words into rows by y-position proximity
    const words = tableWords();
    if (words.length === 0) return [];

    const sorted = [...words].sort((a, b) => a.y0 - b.y0);
    const rows: Word[][] = [];
    let currentRow: Word[] = [sorted[0]];
    const rowThreshold = 0.005; // normalized threshold for same row

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].y0 - currentRow[0].y0 < rowThreshold) {
        currentRow.push(sorted[i]);
      } else {
        rows.push(currentRow);
        currentRow = [sorted[i]];
      }
    }
    rows.push(currentRow);

    // Assign words to columns per row
    return rows.map((rowWords) => {
      return columnRanges.map((col) => {
        const cellWords = rowWords
          .filter((w) => {
            const wordCenter = (w.x0 + w.x1) / 2;
            return wordCenter >= col.start && wordCenter < col.end;
          })
          .sort((a, b) => a.x0 - b.x0);
        return cellWords.map((w) => w.text).join(" ");
      });
    });
  });

  let tableRegionRef!: HTMLDivElement;

  function handleAddColumn(e: MouseEvent) {
    if (!props.selected) return;
    e.stopPropagation();

    const rect = tableRegionRef.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const normalizedX = clickX / rect.width;

    if (normalizedX > 0.02 && normalizedX < 0.98) {
      const newCols = [...props.table.columns, normalizedX];
      props.onUpdate({ ...props.table, columns: newCols });
    }
  }

  function handleColMouseDown(idx: number, e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setDraggingCol(idx);

    const startX = e.clientX;
    const startVal = props.table.columns[idx];
    const regionW = regionPx().width;

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const newVal = Math.max(0.02, Math.min(0.98, startVal + dx / regionW));
      const newCols = [...props.table.columns];
      newCols[idx] = newVal;
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

  return (
    <>
      {/* Table region */}
      <div
        ref={tableRegionRef}
        class={`absolute border-2 pointer-events-auto ${
          props.selected
            ? "border-blue-500 bg-blue-500/5"
            : "border-green-500 bg-green-500/5"
        }`}
        style={{
          left: `${regionPx().left}px`,
          top: `${regionPx().top}px`,
          width: `${regionPx().width}px`,
          height: `${regionPx().height}px`,
          cursor: props.selected ? "crosshair" : "pointer",
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
          {(col, idx) => (
            <div
              class={`absolute top-0 h-full w-0.5 ${
                hoverColIdx() === idx()
                  ? "bg-red-500"
                  : draggingCol() === idx()
                  ? "bg-blue-700"
                  : "bg-blue-500"
              }`}
              style={{
                left: `${col * 100}%`,
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
          )}
        </For>

        {/* Label */}
        <div
          class={`absolute -top-6 left-0 px-1.5 py-0.5 text-xs text-white rounded-t ${
            props.selected ? "bg-blue-500" : "bg-green-500"
          }`}
        >
          Table
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

        {/* Hint when selected */}
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
          class="absolute bg-white border border-gray-300 rounded shadow-lg p-2 text-xs max-h-60 overflow-auto z-50"
          style={{
            left: `${regionPx().left}px`,
            top: `${regionPx().top + regionPx().height + 8}px`,
            "min-width": `${Math.min(regionPx().width, 500)}px`,
          }}
        >
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
