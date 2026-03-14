import type { PdfAnchor, XlsxAnchor, Word } from "@pdf-extractor/types";

// --- Match result types ---

export type PdfAnchorMatch = {
  anchor: PdfAnchor;
  matched: boolean;
  distance: number; // 0 = exact
};

export type XlsxAnchorMatch = {
  anchor: XlsxAnchor;
  matched: boolean;
};

export type MatchResult<T> = {
  matches: T[];
  score: number; // 0-1 (matchedCount / totalAnchors)
};

// --- PDF anchor matching ---

const DEFAULT_TOLERANCE = { x: 0.02, y: 0.02 };

/**
 * Match PDF anchors against page words.
 * Each anchor is matched to the closest word with the same text within tolerance.
 */
export function matchPdfAnchors(
  anchors: PdfAnchor[],
  words: Word[],
  tolerance: { x: number; y: number } = DEFAULT_TOLERANCE
): MatchResult<PdfAnchorMatch> {
  if (anchors.length === 0) return { matches: [], score: 0 };

  const matches: PdfAnchorMatch[] = anchors.map((anchor) => {
    let bestDistance = Infinity;
    let found = false;

    for (const word of words) {
      if (word.text !== anchor.text) continue;

      const dx0 = Math.abs(word.x0 - anchor.x0);
      const dy0 = Math.abs(word.y0 - anchor.y0);
      const dx1 = Math.abs(word.x1 - anchor.x1);
      const dy1 = Math.abs(word.y1 - anchor.y1);

      if (dx0 <= tolerance.x && dy0 <= tolerance.y && dx1 <= tolerance.x && dy1 <= tolerance.y) {
        const distance = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dx1 * dx1 + dy1 * dy1);
        if (distance < bestDistance) {
          bestDistance = distance;
          found = true;
        }
      }
    }

    return {
      anchor,
      matched: found,
      distance: found ? bestDistance : Infinity,
    };
  });

  const matchedCount = matches.filter((m) => m.matched).length;
  return {
    matches,
    score: matchedCount / anchors.length,
  };
}

// --- XLSX anchor matching ---

/**
 * Match XLSX anchors against spreadsheet data (2D string array).
 * Each anchor matches if data[row][col] equals the anchor text.
 */
export function matchXlsxAnchors(
  anchors: XlsxAnchor[],
  data: string[][]
): MatchResult<XlsxAnchorMatch> {
  if (anchors.length === 0) return { matches: [], score: 0 };

  const matches: XlsxAnchorMatch[] = anchors.map((anchor) => {
    const row = data[anchor.row];
    const cellValue = row?.[anchor.col] ?? "";
    return {
      anchor,
      matched: cellValue === anchor.text,
    };
  });

  const matchedCount = matches.filter((m) => m.matched).length;
  return {
    matches,
    score: matchedCount / anchors.length,
  };
}
