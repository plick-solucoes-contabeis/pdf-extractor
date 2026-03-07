import type { Word, Phrase, Rect } from "../types";

/** Filter words inside a region, excluding ignore zones and below footer */
export function getTableWords(
  words: Word[],
  region: Rect,
  ignoreRegions: Rect[],
  footerY: number | null
): Word[] {
  return words.filter((w) => {
    if (w.x0 < region.x - 0.001 || w.x1 > region.x + region.w + 0.001) return false;
    if (w.y0 < region.y - 0.001 || w.y1 > region.y + region.h + 0.001) return false;
    if (footerY !== null && (w.y0 + w.y1) / 2 >= footerY) return false;

    const cx = (w.x0 + w.x1) / 2;
    const cy = (w.y0 + w.y1) / 2;
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
      // Average height of the two words as font size proxy
      const avgHeight = ((prev.y1 - prev.y0) + (curr.y1 - curr.y0)) / 2;
      // Gap threshold: ~50% of font height (roughly one space character width)
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

/** Extract rows × columns from words given column dividers */
export function extractTableData(
  words: Word[],
  region: Rect,
  columns: number[]
): string[][] {
  const cols = [0, ...columns.sort((a, b) => a - b), 1];
  const columnRanges: { start: number; end: number }[] = [];
  for (let i = 0; i < cols.length - 1; i++) {
    columnRanges.push({
      start: region.x + cols[i] * region.w,
      end: region.x + cols[i + 1] * region.w,
    });
  }

  if (words.length === 0) return [];

  const rows = groupIntoRows(words, 0.005);

  return rows.map((rowWords) =>
    columnRanges.map((col) => {
      const cellWords = rowWords
        .filter((w) => {
          const cx = (w.x0 + w.x1) / 2;
          return cx >= col.start && cx < col.end;
        })
        .sort((a, b) => a.x0 - b.x0);
      return cellWords.map((w) => w.text).join(" ");
    })
  );
}

// --- Column auto-detection ---

type AlignmentEdge = { pos: number; type: "x0" | "x1" | "cx" };

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
export function detectColumns(words: Word[], region: Rect): number[] {
  const phrases = mergeWordsIntoPhrases(words);
  if (phrases.length === 0) return [];

  const phraseRows = groupIntoRows(phrases, 0.005);
  const multiPhraseRows = phraseRows.filter((r) => r.length > 1);
  if (multiPhraseRows.length < 2) return [];

  // Collect all phrase intervals from multi-phrase rows
  const intervals = multiPhraseRows.flat();

  // Sweep line: find x ranges where no phrase from multi-phrase rows exists
  type Event = { x: number; delta: number };
  const events: Event[] = [];
  for (const p of intervals) {
    events.push({ x: p.x0, delta: 1 });
    events.push({ x: p.x1, delta: -1 });
  }
  // Sort by x; at same x, process starts (+1) before ends (-1) to avoid false gaps
  events.sort((a, b) => a.x - b.x || b.delta - a.delta);

  let depth = 0;
  let gapStart: number | null = null;
  const gaps: { start: number; end: number }[] = [];

  for (const e of events) {
    depth += e.delta;
    if (depth === 0 && e.delta === -1) {
      // All phrases ended — gap starts here
      gapStart = e.x;
    } else if (depth > 0 && gapStart !== null) {
      // A phrase starts — gap ends here
      gaps.push({ start: gapStart, end: e.x });
      gapStart = null;
    }
  }

  // Place dividers in the middle of each gap
  const dividers: number[] = [];
  for (const gap of gaps) {
    if (gap.end - gap.start < 0.003) continue;

    const dividerX = (gap.start + gap.end) / 2;
    const relative = (dividerX - region.x) / region.w;
    if (relative > 0.02 && relative < 0.98) {
      dividers.push(relative);
    }
  }

  return dividers.sort((a, b) => a - b);
}
