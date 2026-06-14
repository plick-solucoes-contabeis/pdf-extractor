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

// Número monetário/decimal: aceita milhar com . ou , e decimal com , ou .
// Ex: "1.234,56", "1234.56", "-1.234,56", "R$ 1.234,56", "(1.234,56)"
const CURRENCY_RE = /^[(\-]?\s*(?:r\$|\$|€)?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,})?\)?$|^[(\-]?\s*(?:r\$|\$|€)?\s*\d+(?:[.,]\d+)?\)?$/i;
// Data: dd/mm/aaaa, dd-mm-aaaa, aaaa-mm-dd (com 2 ou 4 dígitos no ano)
const DATE_RE = /^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/;
// Número genérico (qualquer numérico, com sinal e decimal opcional)
const NUMBER_RE = /^[+\-]?\d+(?:[.,]\d+)?$/;

/**
 * Avalia se o valor de uma célula casa com o formato esperado pela âncora.
 * Retorna o resultado por texto exato quando `format` está ausente (legado).
 */
function matchXlsxAnchorCell(anchor: XlsxAnchor, cellValue: string): boolean {
  const value = cellValue.trim();

  switch (anchor.format) {
    case "currency":
      return value !== "" && CURRENCY_RE.test(value);
    case "number":
      return value !== "" && NUMBER_RE.test(value);
    case "date":
      return value !== "" && DATE_RE.test(value);
    case "non_empty":
      return value !== "";
    case "enum": {
      const expected = anchor.expected ?? [];
      if (expected.length === 0) return false;
      const normalized = value.toLowerCase();
      return expected.some((e) => e.trim().toLowerCase() === normalized);
    }
    default:
      // Sem formato: comportamento legado (texto exato, sem trim para preservar semântica original).
      return cellValue === anchor.text;
  }
}

/**
 * Match XLSX anchors against spreadsheet data (2D string array).
 * Each anchor matches if data[row][col] equals the anchor text (legacy),
 * or matches the configured `format` when present.
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
      matched: matchXlsxAnchorCell(anchor, cellValue),
    };
  });

  const matchedCount = matches.filter((m) => m.matched).length;
  return {
    matches,
    score: matchedCount / anchors.length,
  };
}
