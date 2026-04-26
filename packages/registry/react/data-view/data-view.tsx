import React, { createContext, useContext, useState, useMemo, useEffect, useRef, useCallback } from "react";
import type { DataViewRules, XlsxAnchor, XlsxTemplate, Word } from "@pdf-extractor/types";
import { applyDataViewRules, type PipelineResult } from "@pdf-extractor/rules";
import { cn } from "@pdf-extractor/utils";
import { Select } from "@pdf-extractor/ui/select";
import { Label } from "@pdf-extractor/ui/label";
import { DataTable } from "@pdf-extractor/data-table";
import { RulesPanel } from "@pdf-extractor/rules-panel";
import { parseXlsxFileSheets, type XlsxSheet } from "@pdf-extractor/xlsx-import";

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
  onXlsxTemplateSave?: (template: XlsxTemplate) => void;
  templateName?: string;
  headerRow: number | null;
  setHeaderRow: (row: number | null) => void;
};

const DataContext = createContext<DataContextValue | null>(null);

function useDataContext() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("DataView components must be used within DataView.Root");
  return ctx;
}

// --- Anchor Context (separate to avoid re-rendering OutputTable/Rules on anchor changes) ---

type AnchorContextValue = {
  anchors: XlsxAnchor[];
  setAnchors: React.Dispatch<React.SetStateAction<XlsxAnchor[]>>;
  anchorMode: boolean;
  setAnchorMode: (mode: boolean) => void;
  cellPickActive: boolean;
  startCellPick: (cb: (row: number, col: number, value: string) => void) => void;
};

const AnchorContext = createContext<AnchorContextValue | null>(null);

function useAnchorContext() {
  const ctx = useContext(AnchorContext);
  if (!ctx) throw new Error("DataView components must be used within DataView.Root");
  return ctx;
}

// --- Sheets Context (for multi-sheet XLSX support) ---

type SheetsContextValue = {
  sheets: XlsxSheet[];
  activeSheetIndex: number;
  setActiveSheetIndex: (index: number) => void;
  setSheets: (sheets: XlsxSheet[]) => void;
};

const SheetsContext = createContext<SheetsContextValue | null>(null);

function useSheetsContext() {
  const ctx = useContext(SheetsContext);
  if (!ctx) throw new Error("DataView components must be used within DataView.Root");
  return ctx;
}

// --- Rules Context (only changes when filteredData updates after debounce) ---

type RulesContextValue = {
  setRules: (rules: DataViewRules) => void;
  filteredData: string[][];
  variables: Record<string, string>;
  externalVars: Record<string, string>;
  getRules: () => DataViewRules;
  rulesVersion: number;
  localRules: DataViewRules;
  setLocalRules: (rules: DataViewRules) => void;
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
  const anchorCtx = useAnchorContext();
  const sheetsCtx = useSheetsContext();
  const rulesCtx = useRulesContext();
  return { ...data, ...anchorCtx, ...sheetsCtx, ...rulesCtx, rules: rulesCtx.getRules() };
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
  initialSheets?: XlsxSheet[];
  initialSheetIndex?: number;
  /** External variables injected from outside (e.g., PDF region variables). Overrides event-based approach. */
  externalVars?: Record<string, string>;
  /** Words per page (1-based key) for resolving extract_variable rules with source: "pdf_region". */
  pageWords?: Record<number, Word[]>;
};

function Root({ availableTables = [], className, children, onXlsxTemplateSave, templateName, initialAnchors, initialData, initialDataSource, initialSheets, initialSheetIndex, externalVars: externalVarsProp, pageWords }: RootProps) {
  const [activeData, setActiveData] = useState<string[][]>(initialData ?? []);
  const [dataSource, setDataSource] = useState<string>(initialDataSource ?? "");
  const [headerRow, setHeaderRow] = useState<number | null>(null);
  const [anchors, setAnchors] = useState<XlsxAnchor[]>(initialAnchors ?? []);
  const [anchorMode, setAnchorMode] = useState(false);
  const cellPickCbRef = useRef<((row: number, col: number, value: string) => void) | null>(null);
  const [cellPickActive, setCellPickActive] = useState(false);
  const startCellPick = useCallback((cb: (row: number, col: number, value: string) => void) => {
    cellPickCbRef.current = cb;
    setCellPickActive(true);
  }, []);

  useEffect(() => {
    function onPick(e: Event) {
      const { row, col, value } = (e as CustomEvent).detail;
      cellPickCbRef.current?.(row, col, value);
      cellPickCbRef.current = null;
      setCellPickActive(false);
    }
    document.addEventListener("__cellpick__", onPick);
    return () => document.removeEventListener("__cellpick__", onPick);
  }, []);

  useEffect(() => {
    if (!cellPickActive) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        cellPickCbRef.current = null;
        setCellPickActive(false);
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [cellPickActive]);
  const [sheets, setSheetsState] = useState<XlsxSheet[]>(initialSheets ?? []);
  const [activeSheetIndex, setActiveSheetIndexState] = useState(initialSheetIndex ?? 0);

  const setSheets = useCallback((newSheets: XlsxSheet[]) => {
    setSheetsState(newSheets);
    if (newSheets.length > 0) {
      setActiveSheetIndexState(0);
      setActiveData(newSheets[0].rows);
      setHeaderRow(null);
    }
  }, []);

  const setActiveSheetIndex = useCallback((index: number) => {
    setActiveSheetIndexState(index);
    const sheet = sheets[index];
    if (sheet) {
      setActiveData(sheet.rows);
    }
  }, [sheets]);

  const maxCols = useMemo(() => {
    let max = 0;
    for (const row of activeData) {
      if (row.length > max) max = row.length;
    }
    return max;
  }, [activeData]);

  // Auto-load first table when it becomes available and no data is loaded yet.
  // Condition on rows.length handles async allWordsCache: if words aren't ready yet, rows=[],
  // effect skips and re-fires when availableTables updates again once words arrive.
  useEffect(() => {
    const first = availableTables[0];
    if (!first || first.rows.length === 0 || sheets.length > 0) return;
    if (activeData.length === 0) {
      setActiveData(first.rows);
      setDataSource(first.label);
    }
  }, [availableTables]);

  // Data context — does NOT include anchors, so anchor changes don't re-render OutputTable/Rules
  const dataCtx = useMemo<DataContextValue>(() => ({
    activeData,
    setActiveData,
    dataSource,
    setDataSource,
    maxCols,
    availableTables,
    onXlsxTemplateSave,
    templateName,
    headerRow,
    setHeaderRow,
  }), [activeData, dataSource, maxCols, availableTables, onXlsxTemplateSave, templateName, headerRow]);

  // Anchor context — only InputTable and SourceBar subscribe
  const anchorCtx = useMemo<AnchorContextValue>(() => ({
    anchors,
    setAnchors,
    anchorMode,
    setAnchorMode,
    cellPickActive,
    startCellPick,
  }), [anchors, anchorMode, cellPickActive, startCellPick]);

  // Sheets context
  const sheetsCtx = useMemo<SheetsContextValue>(() => ({
    sheets,
    activeSheetIndex,
    setActiveSheetIndex,
    setSheets,
  }), [sheets, activeSheetIndex, setActiveSheetIndex, setSheets]);

  const rulesRef = useRef<DataViewRules>({ rules: [] });
  const [eventExternalVars, setEventExternalVars] = useState<Record<string, string>>({});
  // If externalVarsProp is provided, use it; otherwise fall back to event-based vars
  const externalVars = externalVarsProp ?? eventExternalVars;
  const [result, setResult] = useState<PipelineResult>({ data: activeData, variables: {} });
  const [rulesVersion, setRulesVersion] = useState(0);
  const [localRules, setLocalRulesState] = useState<DataViewRules>({ rules: [] });
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Listen for PDF variables broadcast via custom event (only when not using prop-based vars)
  useEffect(() => {
    if (externalVarsProp !== undefined) return;
    function onPdfVars(e: Event) {
      setEventExternalVars((e as CustomEvent<Record<string, string>>).detail);
    }
    document.addEventListener("__pdf_variables__", onPdfVars);
    return () => document.removeEventListener("__pdf_variables__", onPdfVars);
  }, [externalVarsProp]);

  const externalVarsRef = useRef(externalVars);
  externalVarsRef.current = externalVars;
  const pageWordsRef = useRef(pageWords);
  pageWordsRef.current = pageWords;

  const setRules = useCallback((newRules: DataViewRules) => {
    const deduped: DataViewRules = {
      ...newRules,
      rules: newRules.rules.filter((r, i) => newRules.rules.findIndex(x => x.id === r.id) === i),
    };
    rulesRef.current = deduped;
    setLocalRulesState(deduped);
    setResult(applyDataViewRules(activeData, deduped, pageWordsRef.current, externalVarsRef.current));
    setRulesVersion(v => v + 1);
  }, [activeData]);

  const setLocalRules = useCallback((newRules: DataViewRules) => {
    setLocalRulesState(newRules);
  }, []);

  useEffect(() => {
    setResult(applyDataViewRules(activeData, rulesRef.current, pageWordsRef.current, externalVarsRef.current));
  }, [activeData, externalVars, pageWords]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const getRules = useCallback(() => rulesRef.current, []);

  const rulesCtx = useMemo<RulesContextValue>(() => ({
    setRules,
    filteredData: result.data,
    variables: { ...externalVars, ...result.variables },
    externalVars,
    getRules,
    rulesVersion,
    localRules,
    setLocalRules,
  }), [setRules, result, externalVars, getRules, rulesVersion, localRules, setLocalRules]);

  return (
    <DataContext.Provider value={dataCtx}>
      <AnchorContext.Provider value={anchorCtx}>
        <SheetsContext.Provider value={sheetsCtx}>
          <RulesContext.Provider value={rulesCtx}>
            <div className={cn("h-full w-full flex flex-col", className)}>
              {children ?? (
                <>
                  <SourceBar />
                  <SheetTabs />
                  <Content />
                </>
              )}
            </div>
          </RulesContext.Provider>
        </SheetsContext.Provider>
      </AnchorContext.Provider>
    </DataContext.Provider>
  );
}

// --- HeaderRowControl ---

type HeaderRowControlProps = {
  className?: string;
};

function HeaderRowControl({ className }: HeaderRowControlProps) {
  const { activeData, headerRow, setHeaderRow } = useDataContext();
  if (activeData.length === 0) return null;
  return (
    <label className={cn("flex items-center gap-1.5 text-xs text-gray-500", className)}>
      Cabeçalho: linha
      <input
        type="number"
        min={0}
        max={activeData.length - 1}
        placeholder="auto"
        value={headerRow ?? ""}
        onChange={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setHeaderRow(v === "" ? null : Math.max(0, parseInt(v) || 0));
        }}
        className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-xs text-center"
      />
      {headerRow !== null && (
        <button
          className="text-gray-400 hover:text-gray-600"
          onClick={() => setHeaderRow(null)}
          title="Usar detecção automática"
        >
          ×
        </button>
      )}
    </label>
  );
}

// --- SourceBar ---

type SourceBarProps = {
  className?: string;
};

function SourceBar({ className }: SourceBarProps) {
  const { availableTables, setActiveData, setDataSource, activeData, dataSource, onXlsxTemplateSave, templateName } = useDataContext();
  const { anchors, setAnchors, anchorMode, setAnchorMode } = useAnchorContext();
  const { setSheets } = useSheetsContext();
  const { getRules } = useRulesContext();

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
      const workbook = await parseXlsxFileSheets(file);
      setSheets(workbook.sheets);
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
          <option value="">Selecionar tabela...</option>
          {availableTables.map((t, i) => (
            <option key={i} value={i}>{t.label}</option>
          ))}
        </Select>
      )}
      <Label className="px-3 py-1 bg-indigo-600 text-white text-sm rounded cursor-pointer hover:bg-indigo-700">
        Importar XLSX
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
        Âncora
      </button>
      {anchors.length > 0 && (
        <span className="text-xs text-violet-600">{anchors.length} âncora(s)</span>
      )}
      <HeaderRowControl />
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
              rules: getRules().rules,
            };
            onXlsxTemplateSave(template);
          }}
        >
          Salvar Template
        </button>
      )}
      {dataSource && (
        <span className="text-sm text-gray-500">
          {activeData.length} linhas de <span className="font-medium">{dataSource}</span>
        </span>
      )}
    </div>
  );
}

// --- SheetTabs ---

type SheetTabsProps = {
  className?: string;
};

function SheetTabs({ className }: SheetTabsProps) {
  const { sheets, activeSheetIndex, setActiveSheetIndex } = useSheetsContext();

  if (sheets.length <= 1) return null;

  return (
    <div className={cn("flex items-center border-b border-gray-200 bg-gray-50 px-2 shrink-0 overflow-x-auto", className)}>
      {sheets.map((sheet, idx) => (
        <button
          key={idx}
          className={cn(
            "px-3 py-1.5 text-xs border-b-2 -mb-px transition-colors whitespace-nowrap",
            idx === activeSheetIndex
              ? "border-indigo-500 text-indigo-700 font-medium bg-white"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          )}
          onClick={() => setActiveSheetIndex(idx)}
        >
          {sheet.name}
        </button>
      ))}
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

// --- InputTable (subscribes to DataContext + AnchorContext — NOT RulesContext) ---

type InputTableProps = {
  className?: string;
};

function InputTable({ className }: InputTableProps) {
  const { activeData, maxCols } = useDataContext();
  const { anchors, setAnchors, anchorMode, cellPickActive } = useAnchorContext();
  const { localRules } = useRulesContext();

  const anchorModeRef = useRef(anchorMode);
  anchorModeRef.current = anchorMode;
  const cellPickActiveRef = useRef(cellPickActive);
  cellPickActiveRef.current = cellPickActive;

  const handleCellClick = useCallback((row: number, col: number) => {
    if (cellPickActiveRef.current) {
      const value = activeData[row]?.[col] ?? "";
      // We stored the callback in the context's internal ref via startCellPick
      // Trigger via a temporary event so Root can clear the state
      const evt = new CustomEvent("__cellpick__", { detail: { row, col, value } });
      document.dispatchEvent(evt);
      return;
    }
    if (!anchorModeRef.current) return;
    setAnchors((prev) => {
      const isDuplicate = prev.some((a) => a.row === row && a.col === col);
      if (isDuplicate) return prev.filter((a) => !(a.row === row && a.col === col));
      const text = activeData[row]?.[col] ?? "";
      return [...prev, { text, row, col }];
    });
  }, [activeData, setAnchors]);

  const highlightedCells = useMemo(() => {
    const cells: { row: number; col: number; color?: "violet" | "amber" }[] = anchors.map((a) => ({ row: a.row, col: a.col, color: "violet" as const }));
    for (const rule of localRules.rules) {
      if (rule.type === "extract_variable" || rule.type === "variable_to_column") {
        cells.push({ row: rule.row, col: rule.col, color: "amber" });
      }
    }
    return cells;
  }, [anchors, localRules]);

  return (
    <div className={cn("flex-1 overflow-auto border-b border-gray-200 relative", cellPickActive && "cursor-crosshair", className)}>
      {cellPickActive && (
        <div className="absolute inset-x-0 top-0 z-20 bg-purple-600/90 text-white text-xs px-3 py-1 text-center pointer-events-none">
          Clique em uma célula para capturar o valor · ESC para cancelar
        </div>
      )}
      {activeData.length > 0 ? (
        <DataTable
          data={activeData}
          maxCols={maxCols}
          onCellClick={handleCellClick}
          highlightedCells={highlightedCells}
          hoverBg={cellPickActive ? "hover:bg-purple-50" : undefined}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-gray-400 text-sm">
          Selecione uma tabela ou importe um arquivo XLSX
        </div>
      )}
    </div>
  );
}

// --- OutputTable (subscribes to DataContext + RulesContext — NOT AnchorContext) ---

type OutputTableProps = {
  className?: string;
};

function OutputTable({ className }: OutputTableProps) {
  const { activeData, maxCols } = useDataContext();
  const { filteredData } = useRulesContext();
  const { cellPickActive } = useAnchorContext();

  const cellPickActiveRef = useRef(cellPickActive);
  cellPickActiveRef.current = cellPickActive;

  const handleCellClick = useCallback((row: number, col: number) => {
    if (!cellPickActiveRef.current) return;
    const value = filteredData[row]?.[col] ?? "";
    const evt = new CustomEvent("__cellpick__", { detail: { row, col, value } });
    document.dispatchEvent(evt);
  }, [filteredData]);

  if (activeData.length === 0) return null;

  return (
    <>
      <div className="shrink-0 px-3 py-1.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Saída</span>
        <span className="text-xs text-gray-500">
          {filteredData.length}/{activeData.length} linhas
        </span>
      </div>
      <div className={cn("flex-1 overflow-auto relative", cellPickActive && "cursor-crosshair", className)}>
        {cellPickActive && (
          <div className="absolute inset-x-0 top-0 z-20 bg-purple-600/90 text-white text-xs px-3 py-1 text-center pointer-events-none">
            Clique em uma célula para capturar o valor · ESC para cancelar
          </div>
        )}
        <DataTable data={filteredData} maxCols={maxCols} headerBg="bg-green-50" hoverBg={cellPickActive ? "hover:bg-purple-50" : "hover:bg-green-50"} onCellClick={handleCellClick} />
      </div>
    </>
  );
}

// --- Rules ---

type RulesProps = {
  className?: string;
};

function Rules({ className }: RulesProps) {
  const { activeData, headerRow } = useDataContext();
  const { setRules, filteredData, getRules, setLocalRules, externalVars } = useRulesContext();
  const { startCellPick } = useAnchorContext();

  const externalVariableNames = useMemo(() => Object.keys(externalVars), [externalVars]);

  return (
    <RulesPanel
      rules={getRules()}
      onRulesChange={setRules}
      onLocalRulesChange={setLocalRules}
      inputCount={activeData.length}
      outputCount={filteredData.length}
      onCellPick={startCellPick}
      rawData={activeData}
      headerRow={headerRow}
      externalVariableNames={externalVariableNames}
      resolvedPdfVariables={externalVars}
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
  initialSheets?: XlsxSheet[];
  initialSheetIndex?: number;
};

function DataViewSimple(props: DataViewSimpleProps) {
  return (
    <Root {...props}>
      <SourceBar />
      <SheetTabs />
      <Content />
    </Root>
  );
}

// --- Exports ---

export const DataView = Object.assign(DataViewSimple, {
  Root,
  SourceBar,
  SheetTabs,
  Content,
  InputTable,
  OutputTable,
  Rules,
  HeaderRowControl,
  useDataView,
});
