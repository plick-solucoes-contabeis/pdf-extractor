import React, { useState, useMemo, useCallback } from "react";
import type { Word, TableAnnotation, IgnoreAnnotation, FooterAnnotation, HeaderAnnotation } from "@pdf-extractor/types";
import { extractFullTableData } from "@pdf-extractor/extract";
import { cn } from "@pdf-extractor/utils";

type PageWordsEntry = {
  words: Word[];
  pageHeight: number;
};

type Props = {
  tables: TableAnnotation[];
  ignores: IgnoreAnnotation[];
  footers: FooterAnnotation[];
  headers: HeaderAnnotation[];
  /** Pre-extracted words per page (1-based key) */
  allWords: Map<number, PageWordsEntry>;
  isLoading?: boolean;
  onSendToDataView?: (label: string, rows: string[][]) => void;
};

export function OutputPanel(props: Props) {
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  const getFullTableData = useCallback(
    (table: TableAnnotation): { rows: string[][]; numCols: number } => {
      const firstEntry = props.allWords.values().next().value;
      const pageHeight = firstEntry?.pageHeight ?? 792;
      const rows = extractFullTableData(
        table,
        props.ignores,
        props.footers,
        (page) => props.allWords.get(page)?.words ?? null,
        pageHeight,
        props.headers
      );
      return { rows, numCols: table.columns.length + 1 };
    },
    [props.allWords, props.ignores, props.footers, props.headers]
  );

  return (
    <div className="h-full flex flex-col bg-white border-l border-gray-200">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2 shrink-0">
        <span className="text-sm font-medium text-gray-700">Saída</span>
        {props.isLoading && (
          <span className="text-xs text-amber-600">Carregando...</span>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {props.tables.length > 0 ? (
          props.tables.map((table) => (
            <TableRow
              key={table.id}
              table={table}
              getFullTableData={getFullTableData}
              expandedTable={expandedTable}
              setExpandedTable={setExpandedTable}
              isLoading={props.isLoading ?? false}
              onSendToDataView={props.onSendToDataView}
            />
          ))
        ) : (
          <div className="p-4 text-sm text-gray-400 text-center">
            Nenhum bloco definido ainda.
          </div>
        )}
      </div>
    </div>
  );
}

function TableRow({
  table,
  getFullTableData,
  expandedTable,
  setExpandedTable,
  isLoading,
  onSendToDataView,
}: {
  table: TableAnnotation;
  getFullTableData: (table: TableAnnotation) => { rows: string[][]; numCols: number };
  expandedTable: string | null;
  setExpandedTable: React.Dispatch<React.SetStateAction<string | null>>;
  isLoading: boolean;
  onSendToDataView?: (label: string, rows: string[][]) => void;
}) {
  const data = useMemo(() => getFullTableData(table), [getFullTableData, table]);
  const isExpanded = expandedTable === table.id;
  const endPage = table.endPage ?? table.startPage;

  return (
    <div className="border-b border-gray-100">
      <button
        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50"
        onClick={() =>
          setExpandedTable(isExpanded ? null : table.id)
        }
      >
        <span
          className="text-xs transition-transform"
          style={{
            transform: isExpanded
              ? "rotate(90deg)"
              : "rotate(0deg)",
          }}
        >
          &#9654;
        </span>
        <span className="font-medium text-green-700">Tabela</span>
        <span className="text-gray-400">
          p{table.startPage}
          {endPage !== table.startPage
            ? `–${endPage}`
            : ""}
        </span>
        <span className="text-gray-400 ml-auto">
          {data.rows.length} linhas × {data.numCols} colunas
        </span>
      </button>
      {onSendToDataView && data.rows.length > 0 && (
        <button
          className="px-2 py-0.5 mx-2 text-[10px] bg-indigo-600 text-white rounded hover:bg-indigo-700"
          onClick={(e) => {
            e.stopPropagation();
            const label = `Tabela p${table.startPage}${endPage !== table.startPage ? "–" + endPage : ""} (${data.rows.length} linhas)`;
            onSendToDataView(label, data.rows);
          }}
        >
          Enviar para Visualização
        </button>
      )}

      {isExpanded && (
        <div className="px-2 pb-2 overflow-auto max-h-96">
          {data.rows.length > 0 ? (
            <table className="w-full text-xs border-collapse">
              <tbody>
                {data.rows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="border-b border-gray-50 hover:bg-gray-50">
                    {row.map((cell, cellIdx) => (
                      <td
                        key={cellIdx}
                        className="px-1.5 py-1 border-r border-gray-100 last:border-r-0 whitespace-nowrap"
                      >
                        {cell || "-"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-xs text-gray-400 px-2 py-1">
              {isLoading
                ? "Carregando dados da página..."
                : "Nenhum dado extraído."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
