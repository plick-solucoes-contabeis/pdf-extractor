import React, { createContext, useContext, useRef, useMemo, useCallback, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@pdf-extractor/utils";

// --- Constants ---

const DEFAULT_COL_WIDTH = 120;
const MIN_COL_WIDTH = 40;
const ROW_NUM_WIDTH = 48;
const ROW_HEIGHT = 28;

// --- Context ---

type HighlightedCell = { row: number; col: number; color?: "violet" | "amber" };

type DataTableContextValue = {
  data: string[][];
  maxCols: number;
  headerBg: string;
  hoverBg: string;
  highlightMap: Map<string, "violet" | "amber">;
  interactive: boolean;
  columnWidths: number[];
  onColumnResize: (colIdx: number, width: number) => void;
};

const DataTableContext = createContext<DataTableContextValue | null>(null);

function useDataTable() {
  const ctx = useContext(DataTableContext);
  if (!ctx) throw new Error("DataTable compound components must be used within DataTable.Root");
  return ctx;
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

function getRowHighlights(rowIndex: number, maxCols: number, highlightMap: Map<string, "violet" | "amber">): ("violet" | "amber" | false)[] | null {
  if (highlightMap.size === 0) return null;
  let hasAny = false;
  const mask = Array.from({ length: maxCols }, (_, col) => {
    const color = highlightMap.get(cellKey(rowIndex, col));
    if (color) hasAny = true;
    return color ?? false as false;
  });
  return hasAny ? mask : null;
}

// --- Root ---

type RootProps = {
  data: string[][];
  maxCols: number;
  headerBg?: string;
  hoverBg?: string;
  className?: string;
  children?: React.ReactNode;
  onCellClick?: (row: number, col: number) => void;
  highlightedCells?: HighlightedCell[];
};

function Root({ data, maxCols, headerBg = "bg-gray-100", hoverBg = "hover:bg-gray-50", className, children, onCellClick, highlightedCells }: RootProps) {
  const highlightMap = useMemo(() => {
    const map = new Map<string, "violet" | "amber">();
    if (highlightedCells) {
      for (const h of highlightedCells) {
        map.set(cellKey(h.row, h.col), h.color ?? "violet");
      }
    }
    return map;
  }, [highlightedCells]);

  const interactive = !!onCellClick;

  const [columnWidths, setColumnWidths] = useState<number[]>(
    () => Array.from({ length: maxCols }, () => DEFAULT_COL_WIDTH)
  );
  const tableRef = useRef<HTMLDivElement>(null);

  // Sync column count
  const prevMaxCols = useRef(maxCols);
  if (maxCols !== prevMaxCols.current) {
    prevMaxCols.current = maxCols;
    setColumnWidths(prev => {
      if (prev.length === maxCols) return prev;
      return Array.from({ length: maxCols }, (_, i) => prev[i] ?? DEFAULT_COL_WIDTH);
    });
  }

  // Commit a column resize (called on mouseup from Header)
  const onColumnResize = useCallback((colIdx: number, width: number) => {
    setColumnWidths(prev => {
      const next = [...prev];
      next[colIdx] = width;
      return next;
    });
  }, []);

  const ctx = useMemo<DataTableContextValue>(() => ({
    data, maxCols, headerBg, hoverBg, highlightMap, interactive, columnWidths, onColumnResize,
  }), [data, maxCols, headerBg, hoverBg, highlightMap, interactive, columnWidths, onColumnResize]);

  // Event delegation
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!onCellClick) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-resize-handle]")) return;
    const cell = target.closest<HTMLElement>("[data-row][data-col]");
    if (!cell) return;
    const row = parseInt(cell.dataset.row!, 10);
    const col = parseInt(cell.dataset.col!, 10);
    if (!isNaN(row) && !isNaN(col)) {
      onCellClick(row, col);
    }
  }, [onCellClick]);

  // CSS variables for column widths
  const cssVars = useMemo(() => {
    const vars: Record<string, string> = {};
    for (let i = 0; i < columnWidths.length; i++) {
      vars[`--col-${i}-w`] = `${columnWidths[i]}px`;
    }
    return vars;
  }, [columnWidths]);

  return (
    <DataTableContext.Provider value={ctx}>
      <div
        ref={tableRef}
        className={cn("w-full h-full text-xs flex flex-col", className)}
        onClick={handleClick}
        style={cssVars as React.CSSProperties}
      >
        {children ?? <VirtualBody />}
      </div>
    </DataTableContext.Provider>
  );
}

// --- Header ---

type HeaderProps = {
  className?: string;
};

function Header({ className }: HeaderProps) {
  const { maxCols, headerBg, columnWidths, onColumnResize } = useDataTable();
  const tableElRef = useRef<HTMLDivElement | null>(null);

  // Find the table root element (for live CSS var updates during drag)
  const getTableEl = useCallback(() => {
    if (tableElRef.current) return tableElRef.current;
    // Walk up to find the root with CSS vars
    return null;
  }, []);

  const handleResizeStart = useCallback((colIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = columnWidths[colIdx];

    // Find root table element for live CSS var updates
    const headerEl = (e.target as HTMLElement).closest("[data-datatable-header]");
    const rootEl = headerEl?.parentElement?.closest("[style]") as HTMLElement | null;

    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(MIN_COL_WIDTH, startWidth + delta);
      // Live update via CSS var — no React re-render
      rootEl?.style.setProperty(`--col-${colIdx}-w`, `${newWidth}px`);
    }

    function onUp(ev: MouseEvent) {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      const delta = ev.clientX - startX;
      const newWidth = Math.max(MIN_COL_WIDTH, startWidth + delta);
      // Commit to React state
      onColumnResize(colIdx, newWidth);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [columnWidths, onColumnResize]);

  return (
    <div data-datatable-header className={cn("sticky top-0 z-10 flex", headerBg, className)}>
      <div className="px-2 py-1 border-r border-b border-gray-200 text-left text-gray-500 font-medium shrink-0" style={{ width: ROW_NUM_WIDTH }}>#</div>
      {Array.from({ length: maxCols }, (_, i) => (
        <div
          key={i}
          className="relative px-2 py-1 border-r border-b border-gray-200 text-left text-gray-500 font-medium shrink-0 overflow-hidden"
          style={{ width: `var(--col-${i}-w)` }}
        >
          Col {i}
          <div
            data-resize-handle
            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-400/30 active:bg-blue-500/40"
            onMouseDown={(e) => handleResizeStart(i, e)}
          />
        </div>
      ))}
    </div>
  );
}

// --- VirtualBody ---

function VirtualBody({ className }: { className?: string }) {
  const { data, maxCols, hoverBg, highlightMap, interactive } = useDataTable();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  return (
    <div ref={parentRef} className={cn("overflow-auto flex-1 min-h-0", className)}>
      <Header />
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(virtualRow => {
          const idx = virtualRow.index;
          return (
            <div
              key={idx}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: ROW_HEIGHT,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <MemoRow
                row={data[idx]}
                index={idx}
                maxCols={maxCols}
                hoverBg={hoverBg}
                highlights={getRowHighlights(idx, maxCols, highlightMap)}
                interactive={interactive}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Body (non-virtual, for small datasets) ---

type BodyProps = {
  className?: string;
  children?: (row: string[], index: number) => React.ReactNode;
};

function Body({ className, children }: BodyProps) {
  const { data, maxCols, hoverBg, highlightMap, interactive } = useDataTable();
  return (
    <div className={className}>
      {data.map((row, index) =>
        children ? children(row, index) : (
          <MemoRow
            key={index}
            row={row}
            index={index}
            maxCols={maxCols}
            hoverBg={hoverBg}
            highlights={getRowHighlights(index, maxCols, highlightMap)}
            interactive={interactive}
          />
        )
      )}
    </div>
  );
}

// --- Row (pure props, no context) ---

type RowProps = {
  row: string[];
  index: number;
  maxCols: number;
  hoverBg: string;
  highlights: ("violet" | "amber" | false)[] | null;
  interactive: boolean;
  className?: string;
};

function Row({ row, index, maxCols, hoverBg, highlights, interactive, className }: RowProps) {
  return (
    <div className={cn("flex border-b border-gray-100", hoverBg, className)}>
      <div className="px-2 py-1 border-r border-gray-100 text-gray-400 shrink-0" style={{ width: ROW_NUM_WIDTH }}>{index}</div>
      {Array.from({ length: maxCols }, (_, cellIdx) => {
        const cell = row[cellIdx] ?? "";
        const highlight = highlights?.[cellIdx] ?? false;
        return (
          <div
            key={cellIdx}
            data-row={interactive ? index : undefined}
            data-col={interactive ? cellIdx : undefined}
            className={cn(
              "px-2 py-1 border-r border-gray-100 last:border-r-0 whitespace-nowrap overflow-hidden text-ellipsis shrink-0",
              highlight === "violet" && "bg-violet-100 border-violet-300",
              highlight === "amber" && "bg-amber-100 border-amber-300",
              interactive && "cursor-pointer hover:bg-violet-50"
            )}
            style={{ width: `var(--col-${cellIdx}-w)` }}
          >
            {cell || "-"}
          </div>
        );
      })}
    </div>
  );
}

const MemoRow = React.memo(Row, (prev, next) => {
  if (prev.row !== next.row) return false;
  if (prev.index !== next.index) return false;
  if (prev.maxCols !== next.maxCols) return false;
  if (prev.hoverBg !== next.hoverBg) return false;
  if (prev.interactive !== next.interactive) return false;
  if (prev.highlights === next.highlights) return true;
  if (!prev.highlights || !next.highlights) return false;
  if (prev.highlights.length !== next.highlights.length) return false;
  for (let i = 0; i < prev.highlights.length; i++) {
    if (prev.highlights[i] !== next.highlights[i]) return false;
  }
  return true;
});

// --- Cell (standalone) ---

type CellProps = {
  value: string;
  className?: string;
  highlighted?: boolean;
  onClick?: () => void;
};

function Cell({ value, className, highlighted, onClick }: CellProps) {
  return (
    <div
      className={cn(
        "px-2 py-1 border-r border-gray-100 last:border-r-0 whitespace-nowrap overflow-hidden text-ellipsis shrink-0",
        highlighted && "bg-violet-100 border-violet-300",
        onClick && "cursor-pointer hover:bg-violet-50",
        className
      )}
      onClick={onClick}
    >
      {value || "-"}
    </div>
  );
}

// --- Convenience wrapper ---

type DataTableProps = {
  data: string[][];
  maxCols: number;
  headerBg?: string;
  hoverBg?: string;
  className?: string;
  onCellClick?: (row: number, col: number) => void;
  highlightedCells?: HighlightedCell[];
};

function DataTableSimple(props: DataTableProps) {
  return (
    <Root {...props}>
      <VirtualBody />
    </Root>
  );
}

// --- Exports ---

export const DataTable = Object.assign(DataTableSimple, {
  Root,
  Header,
  Body,
  VirtualBody,
  Row: MemoRow,
  Cell,
});
