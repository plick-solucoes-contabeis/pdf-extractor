import React, { useState, useMemo, useEffect, useCallback } from "react";
import type { Word, TableAnnotation, IgnoreAnnotation, FooterAnnotation, HeaderAnnotation } from "@pdf-extractor/types";
import { extractFullTableData } from "@pdf-extractor/extract";
import { cn } from "@pdf-extractor/utils";

type PageWords = {
  pdf_id: number;
  page_num: number;
  page_width: number;
  page_height: number;
  words: Word[];
};

type Props = {
  pdfId: number;
  numPages: number;
  tables: TableAnnotation[];
  ignores: IgnoreAnnotation[];
  footers: FooterAnnotation[];
  headers: HeaderAnnotation[];
  onSendToDataView?: (label: string, rows: string[][]) => void;
  /** Base URL for the word extraction API. Defaults to VITE_PDF_EXTRACTOR_API_URL env var or "/api". */
  apiUrl?: string;
};

export function OutputPanel(props: Props) {
  const [wordsCache, setWordsCache] = useState<Map<number, { words: Word[]; pageHeight: number }>>(
    () => new Map()
  );
  const [loadingPages, setLoadingPages] = useState<Set<number>>(() => new Set());
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  // Determine which pages we need words for
  const neededPages = useMemo(() => {
    const pages = new Set<number>();
    for (const t of props.tables) {
      const end = t.endPage ?? t.startPage;
      for (let p = t.startPage; p <= end; p++) {
        pages.add(p);
      }
    }
    return pages;
  }, [props.tables]);

  const baseUrl = props.apiUrl ?? ((typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_PDF_EXTRACTOR_API_URL) || "/api");

  // Fetch missing pages
  useEffect(() => {
    for (const page of neededPages) {
      if (!wordsCache.has(page) && !loadingPages.has(page)) {
        setLoadingPages((prev) => {
          const next = new Set(prev);
          next.add(page);
          return next;
        });

        fetch(`${baseUrl}/pdfs/${props.pdfId}/pages/${page - 1}/words`)
          .then((res) => res.json())
          .then((data: PageWords) => {
            setWordsCache((prev) => {
              const next = new Map(prev);
              next.set(page, { words: data.words, pageHeight: data.page_height });
              return next;
            });
          })
          .catch(() => {})
          .finally(() => {
            setLoadingPages((prev) => {
              const next = new Set(prev);
              next.delete(page);
              return next;
            });
          });
      }
    }
  }, [neededPages, props.pdfId]);

  const getFullTableData = useCallback(
    (table: TableAnnotation): { rows: string[][]; numCols: number } => {
      const firstEntry = wordsCache.values().next().value;
      const pageHeight = firstEntry?.pageHeight ?? 792;
      const rows = extractFullTableData(
        table,
        props.ignores,
        props.footers,
        (page) => wordsCache.get(page)?.words ?? null,
        pageHeight,
        props.headers
      );
      return { rows, numCols: table.columns.length + 1 };
    },
    [wordsCache, props.ignores, props.footers, props.headers]
  );

  const isLoading = loadingPages.size > 0;

  return (
    <div className="h-full flex flex-col bg-white border-l border-gray-200">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2 shrink-0">
        <span className="text-sm font-medium text-gray-700">Saída</span>
        {isLoading && (
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
              isLoading={isLoading}
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
