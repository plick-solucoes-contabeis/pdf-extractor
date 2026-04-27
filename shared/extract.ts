import type {
  Word,
  Phrase,
  Rect,
  ColumnDivider,
  MatchWord,
  TableAnnotation,
  IgnoreAnnotation,
  FooterAnnotation,
  HeaderAnnotation,
} from "./types";

/** Filter words inside a region, excluding ignore zones, below footer, and above header */
export function getTableWords(
  words: Word[],
  region: Rect,
  ignoreRegions: Rect[],
  footerY: number | null,
  headerY: number | null = null
): Word[] {
  return words.filter((w) => {
    if (w.x0 < region.x - 0.001 || w.x1 > region.x + region.w + 0.001) return false;
    if (w.y0 < region.y - 0.001 || w.y1 > region.y + region.h + 0.001) return false;
    const cy = (w.y0 + w.y1) / 2;
    if (footerY !== null && cy >= footerY) return false;
    if (headerY !== null && cy <= headerY) return false;

    const cx = (w.x0 + w.x1) / 2;
    for (const ig of ignoreRegions) {
      if (cx >= ig.x && cx <= ig.x + ig.w && cy >= ig.y && cy <= ig.y + ig.h) return false;
    }
    return true;
  });
}

/** Group words into rows by y-proximity */
function groupIntoRows<T extends { y0: number; x0: number }>(
  items: T[],
  threshold: number
): T[][] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const rows: T[][] = [];
  let currentRow: T[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y0 - currentRow[0].y0 < threshold) {
      currentRow.push(sorted[i]);
    } else {
      rows.push(currentRow);
      currentRow = [sorted[i]];
    }
  }
  rows.push(currentRow);
  return rows;
}

/**
 * Merge adjacent words on the same line into phrases.
 * Uses word height (font size proxy) to determine spacing threshold.
 */
export function mergeWordsIntoPhrases(words: Word[]): Phrase[] {
  if (words.length === 0) return [];

  const rows = groupIntoRows(words, 0.005);
  const phrases: Phrase[] = [];

  for (const row of rows) {
    const rowSorted = [...row].sort((a, b) => a.x0 - b.x0);
    let group: Word[] = [rowSorted[0]];

    for (let i = 1; i < rowSorted.length; i++) {
      const prev = rowSorted[i - 1];
      const curr = rowSorted[i];
      const gap = curr.x0 - prev.x1;
      const avgHeight = ((prev.y1 - prev.y0) + (curr.y1 - curr.y0)) / 2;
      const threshold = avgHeight * 0.5;

      if (gap <= threshold) {
        group.push(curr);
      } else {
        phrases.push(buildPhrase(group));
        group = [curr];
      }
    }
    phrases.push(buildPhrase(group));
  }

  return phrases;
}

function buildPhrase(words: Word[]): Phrase {
  return {
    text: words.map((w) => w.text).join(" "),
    x0: Math.min(...words.map((w) => w.x0)),
    y0: Math.min(...words.map((w) => w.y0)),
    x1: Math.max(...words.map((w) => w.x1)),
    y1: Math.max(...words.map((w) => w.y1)),
  };
}

/** Group items into rows by vertical overlap (transitive chaining) */
function groupIntoRowsByOverlap<T extends { y0: number; y1: number; x0: number }>(
  items: T[],
  gap: number = 0 // normalized distance (0-1) to merge nearby lines
): T[][] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const rows: T[][] = [];
  let currentRow: T[] = [sorted[0]];
  let groupBottom = sorted[0].y1;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y0 < groupBottom + gap) {
      currentRow.push(sorted[i]);
      groupBottom = Math.max(groupBottom, sorted[i].y1);
    } else {
      rows.push(currentRow);
      currentRow = [sorted[i]];
      groupBottom = sorted[i].y1;
    }
  }
  rows.push(currentRow);
  return rows;
}

/** Normalize column dividers — supports legacy number[] format */
function normalizeDividers(columns: (ColumnDivider | number)[]): ColumnDivider[] {
  return columns.map((c) =>
    typeof c === "number" ? { position: c, splitPhrases: true } : c
  );
}

/** Extract rows × columns from words given column dividers */
export function extractTableData(
  words: Word[],
  region: Rect,
  columns: (ColumnDivider | number)[],
  lineMergeGap: number = 0 // normalized (0-1) distance for merging nearby lines
): string[][] {
  const sortedDividers = normalizeDividers(columns).sort((a, b) => a.position - b.position);
  const positions = sortedDividers.map((d) => d.position);
  const cols = [0, ...positions, 1];
  const columnRanges: { start: number; end: number }[] = [];
  for (let i = 0; i < cols.length - 1; i++) {
    columnRanges.push({
      start: region.x + cols[i] * region.w,
      end: region.x + cols[i + 1] * region.w,
    });
  }

  if (words.length === 0) return [];

  // Build set of non-splitting divider positions (absolute x)
  const nonSplitBoundaries = new Set<number>();
  for (let i = 0; i < sortedDividers.length; i++) {
    if (!sortedDividers[i].splitPhrases) {
      nonSplitBoundaries.add(i + 1); // index in columnRanges where this divider sits between col i and i+1
    }
  }

  const hasNonSplit = nonSplitBoundaries.size > 0;

  if (hasNonSplit) {
    // Phrase-aware extraction: merge words into phrases, then for phrases
    // that cross a non-splitting divider, keep them in the column where they start
    const phrases = mergeWordsIntoPhrases(words);
    const phraseRows = groupIntoRowsByOverlap(phrases, lineMergeGap);

    return phraseRows.map((rowPhrases) => {
      const result = columnRanges.map(() => "");

      for (const phrase of [...rowPhrases].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
        // Find which column the phrase starts in
        let startCol = columnRanges.length - 1;
        for (let i = 0; i < columnRanges.length; i++) {
          if (phrase.x0 < columnRanges[i].end) {
            startCol = i;
            break;
          }
        }

        // Find which column the phrase ends in
        let endCol = startCol;
        const cx = (phrase.x0 + phrase.x1) / 2;
        for (let i = startCol; i < columnRanges.length; i++) {
          if (cx < columnRanges[i].end) {
            endCol = i;
            break;
          }
        }

        if (startCol === endCol) {
          // Phrase fits in one column
          result[startCol] += (result[startCol] ? " " : "") + phrase.text;
        } else {
          // Phrase spans columns — check if any crossed divider is non-splitting
          let keepWhole = false;
          for (let d = startCol + 1; d <= endCol; d++) {
            if (nonSplitBoundaries.has(d)) {
              keepWhole = true;
              break;
            }
          }

          if (keepWhole) {
            // Keep entire phrase in start column
            result[startCol] += (result[startCol] ? " " : "") + phrase.text;
          } else {
            // Split: assign individual words by center position
            const phraseWords = words.filter(
              (w) => w.y0 >= phrase.y0 - 0.002 && w.y0 <= phrase.y1 &&
                     w.x0 >= phrase.x0 - 0.001 && w.x1 <= phrase.x1 + 0.001
            );
            for (const w of phraseWords) {
              const wcx = (w.x0 + w.x1) / 2;
              for (let i = 0; i < columnRanges.length; i++) {
                if (wcx >= columnRanges[i].start && wcx < columnRanges[i].end) {
                  result[i] += (result[i] ? " " : "") + w.text;
                  break;
                }
              }
            }
          }
        }
      }

      return result;
    });
  }

  // Default: all dividers split — assign each word by its center
  const rows = groupIntoRowsByOverlap(words, lineMergeGap);

  return rows.map((rowWords) =>
    columnRanges.map((col) => {
      const cellWords = rowWords
        .filter((w) => {
          const cx = (w.x0 + w.x1) / 2;
          return cx >= col.start && cx < col.end;
        })
        .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
      return cellWords.map((w) => w.text).join(" ");
    })
  );
}

// --- Column auto-detection ---

/** Cluster numeric values that are close together */
function clusterValues(
  values: number[],
  tolerance: number
): { center: number; count: number }[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: { sum: number; count: number }[] = [];

  for (const v of sorted) {
    const existing = clusters.find(
      (c) => Math.abs(c.sum / c.count - v) < tolerance
    );
    if (existing) {
      existing.sum += v;
      existing.count++;
    } else {
      clusters.push({ sum: v, count: 1 });
    }
  }

  return clusters.map((c) => ({ center: c.sum / c.count, count: c.count }));
}

/**
 * Auto-detect column dividers using sweep line projection.
 *
 * Projects all phrases from multi-phrase rows onto the X axis, then finds
 * vertical gaps where no phrase exists. Each gap = a column boundary.
 * Single-phrase rows are ignored (they may span multiple columns).
 *
 * Returns divider positions as normalized values (0-1) relative to region width.
 */
export function detectColumns(words: Word[], region: Rect): ColumnDivider[] {
  const phrases = mergeWordsIntoPhrases(words);
  if (phrases.length === 0) return [];

  const phraseRows = groupIntoRows(phrases, 0.005);
  const multiPhraseRows = phraseRows.filter((r) => r.length > 1);
  if (multiPhraseRows.length < 2) return [];

  const intervals = multiPhraseRows.flat();

  type Event = { x: number; delta: number };
  const events: Event[] = [];
  for (const p of intervals) {
    events.push({ x: p.x0, delta: 1 });
    events.push({ x: p.x1, delta: -1 });
  }
  events.sort((a, b) => a.x - b.x || b.delta - a.delta);
  let depth = 0;
  let gapStart: number | null = null;
  const gaps: { start: number; end: number }[] = [];

  for (const e of events) {
    depth += e.delta;
    if (depth === 0 && e.delta === -1) {
      gapStart = e.x;
    } else if (depth > 0 && gapStart !== null) {
      gaps.push({ start: gapStart, end: e.x });
      gapStart = null;
    }
  }

  // Filter gaps and create dividers
  const dividers: ColumnDivider[] = [];
  for (const gap of gaps) {
    if (gap.end - gap.start < 0.003) continue;

    const dividerX = (gap.start + gap.end) / 2;
    const relative = (dividerX - region.x) / region.w;
    if (relative > 0.02 && relative < 0.98) {
      dividers.push({ position: relative, splitPhrases: true });
    }
  }

  return dividers.sort((a, b) => a.position - b.position);
}

// --- Template application helpers ---

const X_TOLERANCE = 0.01;

/** Search for a MatchWord[] pattern in words, return Y where found */
export function findMatchWordsInWords(
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

/** Search for a MatchWord[] pattern across a range of pages, return page + Y */
export function findStartAnchor(
  pattern: MatchWord[],
  fromPage: number,
  toPage: number,
  getPageWords: (page: number) => Word[] | null
): { page: number; y: number } | null {
  for (let page = fromPage; page <= toPage; page++) {
    const words = getPageWords(page);
    if (!words) continue;
    const foundY = findMatchWordsInWords(words, pattern);
    if (foundY !== null) return { page, y: foundY };
  }
  return null;
}

/** Get ignore regions active on a given page */
export function getIgnoreRegionsForPage(
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

/** Get the effective footer Y for a page */
export function getFooterYForPage(
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

/** Get the effective header Y for a page (ignore everything above this) */
export function getHeaderYForPage(
  headers: HeaderAnnotation[],
  words: Word[]
): number | null {
  let maxY: number | null = null;
  for (const h of headers) {
    if (h.mode === "line") {
      maxY = maxY === null ? h.y : Math.max(maxY, h.y);
    } else if (h.mode === "match" && h.matchWords) {
      const foundY = findMatchWordsInWords(words, h.matchWords);
      if (foundY !== null) {
        maxY = maxY === null ? foundY : Math.max(maxY, foundY);
      }
    }
  }
  return maxY;
}

/** Get the table region (y, h) for a specific page of a multi-page table */
export function getTableRegionForPage(
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

/** Extract all data for a single table across its pages */
export function extractFullTableData(
  table: TableAnnotation,
  ignores: IgnoreAnnotation[],
  footers: FooterAnnotation[],
  getPageWords: (page: number) => Word[] | null,
  pageHeight: number = 792, // PDF page height in points (default = US Letter)
  headers: HeaderAnnotation[] = []
): string[][] {
  const lineMergeGap = (table.lineMergeDistance ?? 0) / pageHeight;
  const end = table.endPage ?? table.startPage;

  // Dynamic start detection
  let effectiveTable = table;
  if (table.startMatchWords && table.startMatchWords.length > 0) {
    const anchor = findStartAnchor(table.startMatchWords, 1, end, getPageWords);
    if (anchor) {
      const originalBottom = table.region.y + table.region.h;
      effectiveTable = {
        ...table,
        startPage: anchor.page,
        region: { ...table.region, y: anchor.y, h: originalBottom - anchor.y },
      };
    }
  }

  const allRows: string[][] = [];

  for (let page = effectiveTable.startPage; page <= end; page++) {
    const pageWords = getPageWords(page);
    if (!pageWords) continue;

    const regionResult = getTableRegionForPage(effectiveTable, page);
    if (!regionResult) continue;

    let tY = regionResult.y;
    let tBottom = regionResult.y + regionResult.h;

    let endFound = false;
    if (effectiveTable.endMatchWords) {
      const foundY = findMatchWordsInWords(pageWords, effectiveTable.endMatchWords);
      if (foundY !== null && foundY > tY && foundY < tBottom) {
        tBottom = foundY;
        endFound = true;
      }
    }

    const footerY = getFooterYForPage(footers, pageWords);
    if (footerY !== null && tBottom > footerY) {
      tBottom = footerY;
      if (tBottom <= tY) continue;
    }

    const headerY = getHeaderYForPage(headers, pageWords);
    if (headerY !== null && tY < headerY) {
      tY = headerY;
      if (tBottom <= tY) continue;
    }

    const igRegions = getIgnoreRegionsForPage(ignores, page);

    for (const ig of igRegions) {
      if (ig.x >= effectiveTable.region.x + effectiveTable.region.w || ig.x + ig.w <= effectiveTable.region.x) continue;
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
      ...effectiveTable.region,
      y: tY,
      h: tBottom - tY,
    };

    const words = getTableWords(pageWords, adjustedRegion, igRegions, footerY, headerY);
    const rows = extractTableData(words, adjustedRegion, effectiveTable.columns, lineMergeGap);
    allRows.push(...rows);
    if (endFound) break;
  }

  return allRows;
}
