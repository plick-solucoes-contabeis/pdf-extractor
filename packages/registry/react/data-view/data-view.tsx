import React, { createContext, useContext, useState, useMemo, useCallback } from "react";
import type { DataViewRules } from "@pdf-extractor/types";
import { applyDataViewRules } from "@pdf-extractor/rules";
import { cn } from "@pdf-extractor/utils";
import { Select } from "@pdf-extractor/ui/select";
import { Label } from "@pdf-extractor/ui/label";
import { DataTable } from "@pdf-extractor/data-table";
import { RulesPanel } from "@pdf-extractor/rules-panel";
import { parseXlsxFile } from "@pdf-extractor/xlsx-import";

// --- Types ---

type AvailableTable = { label: string; rows: string[][] };

// --- Context ---

type DataViewContextValue = {
  activeData: string[][];
  setActiveData: (data: string[][]) => void;
  dataSource: string;
  setDataSource: (source: string) => void;
  rules: DataViewRules;
  setRules: (rules: DataViewRules) => void;
  filteredData: string[][];
  maxCols: number;
  availableTables: AvailableTable[];
};

const DataViewContext = createContext<DataViewContextValue | null>(null);

function useDataView() {
  const ctx = useContext(DataViewContext);
  if (!ctx) throw new Error("DataView compound components must be used within DataView.Root");
  return ctx;
}

// --- Root ---

type RootProps = {
  availableTables?: AvailableTable[];
  className?: string;
  children?: React.ReactNode;
};

function Root({ availableTables = [], className, children }: RootProps) {
  const [activeData, setActiveData] = useState<string[][]>([]);
  const [dataSource, setDataSource] = useState<string>("");
  const [rules, setRules] = useState<DataViewRules>({ rules: [] });

  const filteredData = useMemo(() => applyDataViewRules(activeData, rules), [activeData, rules]);

  const maxCols = useMemo(() => {
    let max = 0;
    for (const row of activeData) {
      if (row.length > max) max = row.length;
    }
    return max;
  }, [activeData]);

  const ctx: DataViewContextValue = {
    activeData,
    setActiveData,
    dataSource,
    setDataSource,
    rules,
    setRules,
    filteredData,
    maxCols,
    availableTables,
  };

  return (
    <DataViewContext.Provider value={ctx}>
      <div className={cn("h-full w-full flex flex-col", className)}>
        {children ?? (
          <>
            <SourceBar />
            <Content />
          </>
        )}
      </div>
    </DataViewContext.Provider>
  );
}

// --- SourceBar ---

type SourceBarProps = {
  className?: string;
};

function SourceBar({ className }: SourceBarProps) {
  const { availableTables, setActiveData, setDataSource, activeData, dataSource } = useDataView();

  function loadTable(index: number) {
    const table = availableTables[index];
    if (!table) return;
    setActiveData(table.rows);
    setDataSource(table.label);
  }

  async function handleXlsxImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseXlsxFile(file);
      setActiveData(rows);
      setDataSource(file.name);
    } catch (err) {
      console.error("Failed to parse XLSX:", err);
    }
    e.target.value = "";
  }

  return (
    <div className={cn("px-4 py-2 bg-white border-b border-gray-200 flex items-center gap-3 shrink-0", className)}>
      {availableTables.length > 0 && (
        <Select
          className="text-sm border border-gray-300 rounded px-2 py-1"
          onChange={(e) => {
            const idx = parseInt((e.target as HTMLSelectElement).value);
            if (!isNaN(idx)) loadTable(idx);
          }}
        >
          <option value="">Select table...</option>
          {availableTables.map((t, i) => (
            <option key={i} value={i}>{t.label}</option>
          ))}
        </Select>
      )}
      <Label className="px-3 py-1 bg-indigo-600 text-white text-sm rounded cursor-pointer hover:bg-indigo-700">
        Import XLSX
        <input
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleXlsxImport}
        />
      </Label>
      {dataSource && (
        <span className="text-sm text-gray-500">
          {activeData.length} rows from <span className="font-medium">{dataSource}</span>
        </span>
      )}
    </div>
  );
}

// --- Content ---

type ContentProps = {
  className?: string;
  children?: React.ReactNode;
};

function Content({ className, children }: ContentProps) {
  return (
    <div className={cn("flex-1 flex overflow-hidden", className)}>
      {children ?? (
        <>
          <div className="flex-1 flex flex-col overflow-hidden">
            <InputTable />
            <OutputTable />
          </div>
          <Rules />
        </>
      )}
    </div>
  );
}

// --- InputTable ---

type InputTableProps = {
  className?: string;
};

function InputTable({ className }: InputTableProps) {
  const { activeData, maxCols } = useDataView();

  return (
    <div className={cn("flex-1 overflow-auto border-b border-gray-200", className)}>
      {activeData.length > 0 ? (
        <DataTable data={activeData} maxCols={maxCols} />
      ) : (
        <div className="flex items-center justify-center h-full text-gray-400 text-sm">
          Select a table or import an XLSX file
        </div>
      )}
    </div>
  );
}

// --- OutputTable ---

type OutputTableProps = {
  className?: string;
};

function OutputTable({ className }: OutputTableProps) {
  const { activeData, filteredData, maxCols } = useDataView();

  if (activeData.length === 0) return null;

  return (
    <>
      <div className="shrink-0 px-3 py-1.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Output</span>
        <span className="text-xs text-gray-500">
          {filteredData.length}/{activeData.length} rows
        </span>
      </div>
      <div className={cn("flex-1 overflow-auto", className)}>
        <DataTable data={filteredData} maxCols={maxCols} headerBg="bg-green-50" hoverBg="hover:bg-green-50" />
      </div>
    </>
  );
}

// --- Rules ---

type RulesProps = {
  className?: string;
};

function Rules({ className }: RulesProps) {
  const { rules, setRules, activeData, filteredData } = useDataView();

  return (
    <RulesPanel
      rules={rules}
      onRulesChange={setRules}
      inputCount={activeData.length}
      outputCount={filteredData.length}
      className={className}
    />
  );
}

// --- Convenience wrapper ---

type DataViewSimpleProps = {
  availableTables?: AvailableTable[];
  className?: string;
};

function DataViewSimple(props: DataViewSimpleProps) {
  return (
    <Root {...props}>
      <SourceBar />
      <Content />
    </Root>
  );
}

// --- Exports ---

export const DataView = Object.assign(DataViewSimple, {
  Root,
  SourceBar,
  Content,
  InputTable,
  OutputTable,
  Rules,
});
