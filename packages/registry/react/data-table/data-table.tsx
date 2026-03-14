import React, { createContext, useContext } from "react";
import { cn } from "@pdf-extractor/utils";

// --- Context ---

type DataTableContextValue = {
  data: string[][];
  maxCols: number;
  headerBg: string;
  hoverBg: string;
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
};

function Root({ data, maxCols, headerBg = "bg-gray-100", hoverBg = "hover:bg-gray-50", className, children }: RootProps) {
  return (
    <DataTableContext.Provider value={{ data, maxCols, headerBg, hoverBg }}>
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
  const { hoverBg } = useDataTable();
  return (
    <tr className={cn("border-b border-gray-100", hoverBg, className)}>
      <td className="px-2 py-1 border-r border-gray-100 text-gray-400">{index}</td>
      {row.map((cell, cellIdx) => (
        <Cell key={cellIdx} value={cell} />
      ))}
    </tr>
  );
}

// --- Cell ---

type CellProps = {
  value: string;
  className?: string;
};

function Cell({ value, className }: CellProps) {
  return (
    <td className={cn("px-2 py-1 border-r border-gray-100 last:border-r-0 whitespace-nowrap", className)}>
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
