import { createSignal, createMemo, Show, For } from "solid-js";
import type { DataViewRules } from "../types";
import { applyDataViewRules } from "../lib/rules";
import { parseXlsxFile } from "../lib/xlsx";
import { DataTable } from "./DataTable";
import { RulesPanel } from "./RulesPanel";

type AvailableTable = { label: string; rows: string[][] };

type DataViewProps = {
  availableTables: AvailableTable[];
};

export function DataView(props: DataViewProps) {
  const [activeData, setActiveData] = createSignal<string[][]>([]);
  const [dataSource, setDataSource] = createSignal<string>("");
  const [rules, setRules] = createSignal<DataViewRules>({
    rules: [],
  });

  const filteredData = createMemo(() => applyDataViewRules(activeData(), rules()));

  const maxCols = createMemo(() => {
    let max = 0;
    for (const row of activeData()) {
      if (row.length > max) max = row.length;
    }
    return max;
  });

  function loadTable(index: number) {
    const table = props.availableTables[index];
    if (!table) return;
    setActiveData(table.rows);
    setDataSource(table.label);
  }

  async function handleXlsxImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const rows = await parseXlsxFile(file);
      setActiveData(rows);
      setDataSource(file.name);
    } catch (err) {
      console.error("Failed to parse XLSX:", err);
    }
    input.value = "";
  }

  return (
    <div class="h-full w-full flex flex-col">
      {/* Source Bar */}
      <div class="px-4 py-2 bg-white border-b border-gray-200 flex items-center gap-3 shrink-0">
        <Show when={props.availableTables.length > 0}>
          <select
            class="text-sm border border-gray-300 rounded px-2 py-1"
            onChange={(e) => {
              const idx = parseInt(e.currentTarget.value);
              if (!isNaN(idx)) loadTable(idx);
            }}
          >
            <option value="">Select table...</option>
            <For each={props.availableTables}>
              {(t, i) => <option value={i()}>{t.label}</option>}
            </For>
          </select>
        </Show>
        <label class="px-3 py-1 bg-indigo-600 text-white text-sm rounded cursor-pointer hover:bg-indigo-700">
          Import XLSX
          <input
            type="file"
            accept=".xlsx,.xls"
            class="hidden"
            onChange={handleXlsxImport}
          />
        </label>
        <Show when={dataSource()}>
          <span class="text-sm text-gray-500">
            {activeData().length} rows from <span class="font-medium">{dataSource()}</span>
          </span>
        </Show>
      </div>

      {/* Main content */}
      <div class="flex-1 flex overflow-hidden">
        {/* Left: Data Table + Output Table */}
        <div class="flex-1 flex flex-col overflow-hidden">
          {/* Original Data Table */}
          <div class="flex-1 overflow-auto border-b border-gray-200">
            <Show
              when={activeData().length > 0}
              fallback={
                <div class="flex items-center justify-center h-full text-gray-400 text-sm">
                  Select a table or import an XLSX file
                </div>
              }
            >
              <DataTable data={activeData()} maxCols={maxCols()} />
            </Show>
          </div>

          {/* Output Table */}
          <Show when={activeData().length > 0}>
            <div class="shrink-0 px-3 py-1.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
              <span class="text-sm font-medium text-gray-700">Output</span>
              <span class="text-xs text-gray-500">
                {filteredData().length}/{activeData().length} rows
              </span>
            </div>
            <div class="flex-1 overflow-auto">
              <DataTable data={filteredData()} maxCols={maxCols()} headerBg="bg-green-50" hoverBg="hover:bg-green-50" />
            </div>
          </Show>
        </div>

        {/* Right: Rules Panel */}
        <RulesPanel
          rules={rules()}
          onRulesChange={setRules}
          inputCount={activeData().length}
          outputCount={filteredData().length}
        />
      </div>
    </div>
  );
}
