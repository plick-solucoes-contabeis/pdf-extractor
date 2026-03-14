import React, { createContext, useContext } from "react";
import { cn } from "@pdf-extractor/utils";

// --- Context ---

type HighlightedCell = { row: number; col: number };

type DataTableContextValue = {
  data: string[][];
  maxCols: number;
  headerBg: string;
  hoverBg: string;
  onCellClick?: (row: number, col: number) => void;
  highlightedCells?: HighlightedCell[];
};

const DataTableContext = createContext<DataTableContextValue | null>(null);

function useDataTable() {
  const ctx = useContext(DataTableContext);
  if (!ctx) throw new Error("DataTable compound components must be used within DataTable.Root");
  return ctx;
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
  return (
    <DataTableContext.Provider value={{ data, maxCols, headerBg, hoverBg, onCellClick, highlightedCells }}>
      <table className={cn("w-full text-xs border-collapse", className)}>
        {children ?? (
          <>
            <Header />
            <Body />
          </>
        )}
      </table>
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
    <thead className={cn("sticky top-0 z-10", headerBg, className)}>
      <tr>
        <th className="px-2 py-1 border-r border-b border-gray-200 text-left text-gray-500 font-medium">#</th>
        {Array.from({ length: maxCols }, (_, i) => (
          <th key={i} className="px-2 py-1 border-r border-b border-gray-200 text-left text-gray-500 font-medium">
            Col {i}
          </th>
        ))}
      </tr>
    </thead>
  );
}

// --- Body ---

type BodyProps = {
  className?: string;
  children?: (row: string[], index: number) => React.ReactNode;
};

function Body({ className, children }: BodyProps) {
  const { data } = useDataTable();
  return (
    <tbody className={className}>
      {data.map((row, index) =>
        children ? children(row, index) : <Row key={index} row={row} index={index} />
      )}
    </tbody>
  );
}

// --- Row ---

type RowProps = {
  row: string[];
  index: number;
  className?: string;
};

function Row({ row, index, className }: RowProps) {
  const { hoverBg, onCellClick, highlightedCells } = useDataTable();
  return (
    <tr className={cn("border-b border-gray-100", hoverBg, className)}>
      <td className="px-2 py-1 border-r border-gray-100 text-gray-400">{index}</td>
      {row.map((cell, cellIdx) => {
        const isHighlighted = highlightedCells?.some((h) => h.row === index && h.col === cellIdx);
        return (
          <Cell
            key={cellIdx}
            value={cell}
            highlighted={isHighlighted}
            onClick={onCellClick ? () => onCellClick(index, cellIdx) : undefined}
          />
        );
      })}
    </tr>
  );
}

// --- Cell ---

type CellProps = {
  value: string;
  className?: string;
  highlighted?: boolean;
  onClick?: () => void;
};

function Cell({ value, className, highlighted, onClick }: CellProps) {
  return (
    <td
      className={cn(
        "px-2 py-1 border-r border-gray-100 last:border-r-0 whitespace-nowrap",
        highlighted && "bg-violet-100 border-violet-300",
        onClick && "cursor-pointer hover:bg-violet-50",
        className
      )}
      onClick={onClick}
    >
      {value || "-"}
    </td>
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
      <Header />
      <Body />
    </Root>
  );
}

// --- Exports ---

export const DataTable = Object.assign(DataTableSimple, {
  Root,
  Header,
  Body,
  Row,
  Cell,
});
