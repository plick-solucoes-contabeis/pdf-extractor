import React, { createContext, useContext, useRef, useMemo, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@pdf-extractor/utils";

// --- Context ---

type DataTableContextValue = {
  data: string[][];
  maxCols: number;
  headerBg: string;
  hoverBg: string;
  highlightSet: Set<string>;
  interactive: boolean;
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

// --- Root ---

type HighlightedCell = { row: number; col: number };

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
  const highlightSet = useMemo(() => {
    const set = new Set<string>();
    if (highlightedCells) {
      for (const h of highlightedCells) {
        set.add(cellKey(h.row, h.col));
      }
    }
    return set;
  }, [highlightedCells]);

  const interactive = !!onCellClick;

  const ctx = useMemo<DataTableContextValue>(() => ({
    data, maxCols, headerBg, hoverBg, highlightSet, interactive,
  }), [data, maxCols, headerBg, hoverBg, highlightSet, interactive]);

  // Event delegation: single click handler on the container
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!onCellClick) return;
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>("[data-row][data-col]");
    if (!cell) return;
    const row = parseInt(cell.dataset.row!, 10);
    const col = parseInt(cell.dataset.col!, 10);
    if (!isNaN(row) && !isNaN(col)) {
      onCellClick(row, col);
    }
  }, [onCellClick]);

  return (
    <DataTableContext.Provider value={ctx}>
      <div className={cn("w-full text-xs", className)} onClick={handleClick}>
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
  const { maxCols, headerBg } = useDataTable();
  return (
    <div className={cn("sticky top-0 z-10 flex", headerBg, className)}>
      <div className="px-2 py-1 border-r border-b border-gray-200 text-left text-gray-500 font-medium w-12 shrink-0">#</div>
      {Array.from({ length: maxCols }, (_, i) => (
        <div key={i} className="px-2 py-1 border-r border-b border-gray-200 text-left text-gray-500 font-medium flex-1 min-w-[80px]">
          Col {i}
        </div>
      ))}
    </div>
  );
}

// --- VirtualBody ---

const ROW_HEIGHT = 28;

function VirtualBody({ className }: { className?: string }) {
  const { data } = useDataTable();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  return (
    <div ref={parentRef} className={cn("overflow-auto flex-1", className)} style={{ maxHeight: '100%' }}>
      <Header />
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(virtualRow => (
          <div
            key={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: ROW_HEIGHT,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <MemoRow row={data[virtualRow.index]} index={virtualRow.index} />
          </div>
        ))}
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
  const { data } = useDataTable();
  return (
    <div className={className}>
      {data.map((row, index) =>
        children ? children(row, index) : <MemoRow key={index} row={row} index={index} />
      )}
    </div>
  );
}

// --- Row ---

type RowProps = {
  row: string[];
  index: number;
  className?: string;
};

function Row({ row, index, className }: RowProps) {
  const { maxCols, hoverBg, highlightSet, interactive } = useDataTable();
  return (
    <div className={cn("flex border-b border-gray-100", hoverBg, className)}>
      <div className="px-2 py-1 border-r border-gray-100 text-gray-400 w-12 shrink-0">{index}</div>
      {Array.from({ length: maxCols }, (_, cellIdx) => {
        const cell = row[cellIdx] ?? "";
        const isHighlighted = highlightSet.has(cellKey(index, cellIdx));
        return (
          <div
            key={cellIdx}
            data-row={interactive ? index : undefined}
            data-col={interactive ? cellIdx : undefined}
            className={cn(
              "px-2 py-1 border-r border-gray-100 last:border-r-0 whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-[80px]",
              isHighlighted && "bg-violet-100 border-violet-300",
              interactive && "cursor-pointer hover:bg-violet-50"
            )}
          >
            {cell || "-"}
          </div>
        );
      })}
    </div>
  );
}

const MemoRow = React.memo(Row);

// --- Cell (standalone, for compound component usage) ---

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
        "px-2 py-1 border-r border-gray-100 last:border-r-0 whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-[80px]",
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
