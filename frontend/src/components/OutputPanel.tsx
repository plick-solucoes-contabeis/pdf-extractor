import { For, Show, createSignal, createEffect, createMemo } from "solid-js";
import type {
  Word,
  PageWords,
  TableAnnotation,
  IgnoreAnnotation,
  FooterAnnotation,
} from "../types";
import { extractFullTableData } from "../lib/extract";

type Props = {
  pdfId: number;
  numPages: number;
  tables: TableAnnotation[];
  ignores: IgnoreAnnotation[];
  footers: FooterAnnotation[];
};

export function OutputPanel(props: Props) {
  const [wordsCache, setWordsCache] = createSignal<Map<number, { words: Word[]; pageHeight: number }>>(
    new Map()
  );
  const [loadingPages, setLoadingPages] = createSignal<Set<number>>(new Set());
  const [expandedTable, setExpandedTable] = createSignal<string | null>(null);

  // Determine which pages we need words for
  const neededPages = createMemo(() => {
    const pages = new Set<number>();
    for (const t of props.tables) {
      const end = t.endPage ?? t.startPage;
      for (let p = t.startPage; p <= end; p++) {
        pages.add(p);
      }
    }
    return pages;
  });

  // Fetch missing pages
  createEffect(() => {
    const needed = neededPages();
    const cache = wordsCache();
    const loading = loadingPages();

    for (const page of needed) {
      if (!cache.has(page) && !loading.has(page)) {
        loading.add(page);
        setLoadingPages(new Set(loading));

        fetch(`/api/pdfs/${props.pdfId}/pages/${page - 1}/words`)
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
  });

  function getFullTableData(table: TableAnnotation): {
    rows: string[][];
    numCols: number;
  } {
    const cache = wordsCache();
    // Use page height from first cached page, fallback to US Letter
    const firstEntry = cache.values().next().value;
    const pageHeight = firstEntry?.pageHeight ?? 792;
    const rows = extractFullTableData(
      table,
      props.ignores,
      props.footers,
      (page) => cache.get(page)?.words ?? null,
      pageHeight
    );
    return { rows, numCols: table.columns.length + 1 };
  }

  const isLoading = () => loadingPages().size > 0;

  return (
    <div class="h-full flex flex-col bg-white border-l border-gray-200">
      <div class="px-3 py-2 border-b border-gray-200 flex items-center gap-2 shrink-0">
        <span class="text-sm font-medium text-gray-700">Output</span>
        <Show when={isLoading()}>
          <span class="text-xs text-amber-600">Loading...</span>
        </Show>
      </div>

      <div class="flex-1 overflow-auto">
        <Show
          when={props.tables.length > 0}
          fallback={
            <div class="p-4 text-sm text-gray-400 text-center">
              No blocks defined yet.
            </div>
          }
        >
          <For each={props.tables}>
            {(table) => {
              const data = createMemo(() => getFullTableData(table));
              const isExpanded = () => expandedTable() === table.id;
              const endPage = () => table.endPage ?? table.startPage;

              return (
                <div class="border-b border-gray-100">
                  <button
                    class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50"
                    onClick={() =>
                      setExpandedTable(isExpanded() ? null : table.id)
                    }
                  >
                    <span
                      class="text-xs transition-transform"
                      style={{
                        transform: isExpanded()
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                      }}
                    >
                      ▶
                    </span>
                    <span class="font-medium text-green-700">Table</span>
                    <span class="text-gray-400">
                      p{table.startPage}
                      {endPage() !== table.startPage
                        ? `–${endPage()}`
                        : ""}
                    </span>
                    <span class="text-gray-400 ml-auto">
                      {data().rows.length} rows × {data().numCols} cols
                    </span>
                  </button>

                  <Show when={isExpanded()}>
                    <div class="px-2 pb-2 overflow-auto max-h-96">
                      <Show
                        when={data().rows.length > 0}
                        fallback={
                          <div class="text-xs text-gray-400 px-2 py-1">
                            {isLoading()
                              ? "Loading page data..."
                              : "No data extracted."}
                          </div>
                        }
                      >
                        <table class="w-full text-xs border-collapse">
                          <tbody>
                            <For each={data().rows}>
                              {(row) => (
                                <tr class="border-b border-gray-50 hover:bg-gray-50">
                                  <For each={row}>
                                    {(cell) => (
                                      <td class="px-1.5 py-1 border-r border-gray-100 last:border-r-0 whitespace-nowrap">
                                        {cell || "-"}
                                      </td>
                                    )}
                                  </For>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </Show>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
}
