import React, { createContext, useContext, useState, useMemo, useEffect, useRef } from "react";
import type { DataViewRules, XlsxAnchor, XlsxTemplate } from "@pdf-extractor/types";
import { applyDataViewRules } from "@pdf-extractor/rules";
import { cn } from "@pdf-extractor/utils";
import { Select } from "@pdf-extractor/ui/select";
import { Label } from "@pdf-extractor/ui/label";
import { DataTable } from "@pdf-extractor/data-table";
import { RulesPanel } from "@pdf-extractor/rules-panel";
import { parseXlsxFile } from "@pdf-extractor/xlsx-import";

// --- Types ---

type AvailableTable = { label: string; rows: string[][] };

// --- Data Context (changes rarely: on import/table select) ---

type DataContextValue = {
  activeData: string[][];
  setActiveData: (data: string[][]) => void;
  dataSource: string;
  setDataSource: (source: string) => void;
  maxCols: number;
  availableTables: AvailableTable[];
  anchors: XlsxAnchor[];
  setAnchors: React.Dispatch<React.SetStateAction<XlsxAnchor[]>>;
  anchorMode: boolean;
  setAnchorMode: (mode: boolean) => void;
  onXlsxTemplateSave?: (template: XlsxTemplate) => void;
  templateName?: string;
};

const DataContext = createContext<DataContextValue | null>(null);

function useDataContext() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("DataView components must be used within DataView.Root");
  return ctx;
}

// --- Rules Context (changes often: on every keystroke in rules) ---

type RulesContextValue = {
  rules: DataViewRules;
  setRules: (rules: DataViewRules) => void;
  filteredData: string[][];
};

const RulesContext = createContext<RulesContextValue | null>(null);

function useRulesContext() {
  const ctx = useContext(RulesContext);
  if (!ctx) throw new Error("DataView components must be used within DataView.Root");
  return ctx;
}

// Combined hook for external consumers
function useDataView() {
  const data = useDataContext();
  const rules = useRulesContext();
  return { ...data, ...rules };
}

// --- Root ---

type RootProps = {
  availableTables?: AvailableTable[];
  className?: string;
  children?: React.ReactNode;
  onXlsxTemplateSave?: (template: XlsxTemplate) => void;
  templateName?: string;
  initialAnchors?: XlsxAnchor[];
  initialData?: string[][];
  initialDataSource?: string;
};

function Root({ availableTables = [], className, children, onXlsxTemplateSave, templateName, initialAnchors, initialData, initialDataSource }: RootProps) {
  const [activeData, setActiveData] = useState<string[][]>(initialData ?? []);
  const [dataSource, setDataSource] = useState<string>(initialDataSource ?? "");
  const [anchors, setAnchors] = useState<XlsxAnchor[]>(initialAnchors ?? []);
  const [anchorMode, setAnchorMode] = useState(false);

  const maxCols = useMemo(() => {
    let max = 0;
    for (const row of activeData) {
      if (row.length > max) max = row.length;
    }
    return max;
  }, [activeData]);

  const dataCtx = useMemo<DataContextValue>(() => ({
    activeData,
    setActiveData,
    dataSource,
    setDataSource,
    maxCols,
    availableTables,
    anchors,
    setAnchors,
    anchorMode,
    setAnchorMode,
    onXlsxTemplateSave,
    templateName,
  }), [activeData, dataSource, maxCols, availableTables, anchors, anchorMode, onXlsxTemplateSave, templateName]);

  const [rules, setRules] = useState<DataViewRules>({ rules: [] });
  const [filteredData, setFilteredData] = useState<string[][]>(activeData);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilteredData(applyDataViewRules(activeData, rules));
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [activeData, rules]);

  const rulesCtx = useMemo<RulesContextValue>(() => ({
    rules,
    setRules,
    filteredData,
  }), [rules, filteredData]);

  return (
    <DataContext.Provider value={dataCtx}>
      <RulesContext.Provider value={rulesCtx}>
        <div className={cn("h-full w-full flex flex-col", className)}>
          {children ?? (
            <>
              <SourceBar />
              <Content />
            </>
          )}
        </div>
      </RulesContext.Provider>
    </DataContext.Provider>
  );
}

// --- SourceBar ---

type SourceBarProps = {
  className?: string;
};

function SourceBar({ className }: SourceBarProps) {
  const { availableTables, setActiveData, setDataSource, activeData, dataSource, anchors, setAnchors, anchorMode, setAnchorMode, onXlsxTemplateSave, templateName } = useDataContext();
  const { rules } = useRulesContext();

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
      <button
        className={cn(
          "px-2.5 py-1 text-sm rounded",
          anchorMode
            ? "bg-violet-100 text-violet-700"
            : "bg-gray-100 hover:bg-gray-200 text-gray-600"
        )}
        onClick={() => setAnchorMode(!anchorMode)}
      >
        Anchor
      </button>
      {anchors.length > 0 && (
        <span className="text-xs text-violet-600">{anchors.length} anchor(s)</span>
      )}
      {onXlsxTemplateSave && (
        <button
          className="px-2.5 py-1 text-sm rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-40"
          disabled={activeData.length === 0}
          onClick={() => {
            const template: XlsxTemplate = {
              type: "xlsx",
              name: templateName ?? "template",
              anchors,
              source: { sheetIndex: 0 },
              rules: rules.rules,
            };
            onXlsxTemplateSave(template);
          }}
        >
          Save Template
        </button>
      )}
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

// --- InputTable (only subscribes to DataContext — not affected by rule changes) ---

type InputTableProps = {
  className?: string;
};

function InputTable({ className }: InputTableProps) {
  const { activeData, maxCols, anchors, setAnchors, anchorMode } = useDataContext();

  function handleCellClick(row: number, col: number) {
    if (!anchorMode) return;
    const text = activeData[row]?.[col] ?? "";
    const isDuplicate = anchors.some((a) => a.row === row && a.col === col);
    if (isDuplicate) {
      setAnchors((prev) => prev.filter((a) => !(a.row === row && a.col === col)));
    } else {
      setAnchors((prev) => [...prev, { text, row, col }]);
    }
  }

  return (
    <div className={cn("flex-1 overflow-auto border-b border-gray-200", className)}>
      {activeData.length > 0 ? (
        <DataTable
          data={activeData}
          maxCols={maxCols}
          onCellClick={anchorMode ? handleCellClick : undefined}
          highlightedCells={anchors.map((a) => ({ row: a.row, col: a.col }))}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-gray-400 text-sm">
          Select a table or import an XLSX file
        </div>
      )}
    </div>
  );
}

// --- OutputTable (subscribes to RulesContext for filteredData) ---

type OutputTableProps = {
  className?: string;
};

function OutputTable({ className }: OutputTableProps) {
  const { activeData, maxCols } = useDataContext();
  const { filteredData } = useRulesContext();

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
  const { activeData } = useDataContext();
  const { rules, setRules, filteredData } = useRulesContext();

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
  onXlsxTemplateSave?: (template: XlsxTemplate) => void;
  templateName?: string;
  initialAnchors?: XlsxAnchor[];
  initialData?: string[][];
  initialDataSource?: string;
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
  useDataView,
});
