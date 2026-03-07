import { For, Show, createSignal, createEffect, createMemo } from "solid-js";
import type {
  Word,
  PageWords,
  Rect,
  TableAnnotation,
  IgnoreAnnotation,
  FooterAnnotation,
  MatchWord,
} from "../types";
import { getTableWords, extractTableData } from "../lib/extract";

type Props = {
  pdfId: number;
  numPages: number;
  tables: TableAnnotation[];
  ignores: IgnoreAnnotation[];
  footers: FooterAnnotation[];
};

const X_TOLERANCE = 0.01;

function findMatchWordsInWords(
  words: Word[],
  pattern: MatchWord[]
): number | null {
  if (pattern.length === 0) return null;
  const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const first = pattern[0];
  for (let i = 0; i <= sorted.length - pattern.length; i++) {
    if (sorted[i].text !== first.text) continue;
    if (Math.abs(sorted[i].x0 - first.x0) > X_TOLERANCE) continue;
    let allMatch = true;
    for (let j = 1; j < pattern.length; j++) {
      if (
        sorted[i + j].text !== pattern[j].text ||
        Math.abs(sorted[i + j].x0 - pattern[j].x0) > X_TOLERANCE
      ) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return sorted[i].y0;
  }
  return null;
}

function getIgnoreRegionsForPage(
  ignores: IgnoreAnnotation[],
  page: number
): Rect[] {
  return ignores
    .filter((ig) => {
      const end = ig.endPage ?? ig.startPage;
      return page >= ig.startPage && page <= end;
    })
    .map((ig) => ig.region);
}

function getFooterYForPage(
  footers: FooterAnnotation[],
  words: Word[]
): number | null {
  let minY: number | null = null;
  for (const f of footers) {
    if (f.mode === "line") {
      minY = minY === null ? f.y : Math.min(minY, f.y);
    } else if (f.mode === "match" && f.matchWords) {
      const foundY = findMatchWordsInWords(words, f.matchWords);
      if (foundY !== null) {
        minY = minY === null ? foundY : Math.min(minY, foundY);
      }
    }
  }
  return minY;
}

function getTableRegionForPage(
  table: TableAnnotation,
  page: number
): { y: number; h: number } | null {
  const start = table.startPage;
  const end = table.endPage ?? table.startPage;
  if (page < start || page > end) return null;
  if (start === end) return { y: table.region.y, h: table.region.h };
  if (page === start) return { y: table.region.y, h: 1 - table.region.y };
  if (page === end) {
    const endY = table.endY ?? 1;
    return { y: 0, h: endY };
  }
  return { y: 0, h: 1 };
}

export function OutputPanel(props: Props) {
  const [wordsCache, setWordsCache] = createSignal<Map<number, Word[]>>(
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
              next.set(page, data.words);
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

  // Extract full data for a table across all its pages
  function getFullTableData(table: TableAnnotation): {
    rows: string[][];
    numCols: number;
    pageCount: number;
  } {
    const cache = wordsCache();
    const end = table.endPage ?? table.startPage;
    const allRows: string[][] = [];
    const numCols = table.columns.length + 1;
    let pageCount = 0;

    for (let page = table.startPage; page <= end; page++) {
      const pageWords = cache.get(page);
      if (!pageWords) continue;
      pageCount++;

      const regionResult = getTableRegionForPage(table, page);
      if (!regionResult) continue;

      let tY = regionResult.y;
      let tBottom = regionResult.y + regionResult.h;

      // End match text
      if (table.endMatchWords) {
        const foundY = findMatchWordsInWords(pageWords, table.endMatchWords);
        if (foundY !== null && foundY > tY && foundY < tBottom) {
          tBottom = foundY;
        }
      }

      // Footer
      const footerY = getFooterYForPage(props.footers, pageWords);
      if (footerY !== null && tBottom > footerY) {
        tBottom = footerY;
        if (tBottom <= tY) continue;
      }

      // Ignore regions
      const igRegions = getIgnoreRegionsForPage(props.ignores, page);

      // Adjust for ignore overlap
      for (const ig of igRegions) {
        if (ig.x >= table.region.x + table.region.w || ig.x + ig.w <= table.region.x) continue;
        const igBottom = ig.y + ig.h;
        if (ig.y >= tBottom || igBottom <= tY) continue;
        if (ig.y <= tY && igBottom >= tBottom) { tY = tBottom; break; }
        const igMid = (ig.y + igBottom) / 2;
        const tMid = (tY + tBottom) / 2;
        if (igMid < tMid) tY = Math.max(tY, igBottom);
        else tBottom = Math.min(tBottom, ig.y);
      }

      if (tBottom - tY < 0.01) continue;

      const adjustedRegion: Rect = {
        ...table.region,
        y: tY,
        h: tBottom - tY,
      };

      const words = getTableWords(pageWords, adjustedRegion, igRegions, footerY);
      const rows = extractTableData(words, adjustedRegion, table.columns);
      allRows.push(...rows);
    }

    return { rows: allRows, numCols, pageCount };
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
