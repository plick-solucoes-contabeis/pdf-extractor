import type { Word, Rect, TableAnnotation, IgnoreAnnotation, MatchWord } from "../types";

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

  const sorted = [...words].sort((a, b) => a.y0 - b.y0);
  const rows: Word[][] = [];
  let currentRow: Word[] = [sorted[0]];
  const rowThreshold = 0.005;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y0 - currentRow[0].y0 < rowThreshold) {
      currentRow.push(sorted[i]);
    } else {
      rows.push(currentRow);
      currentRow = [sorted[i]];
    }
  }
  rows.push(currentRow);

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
