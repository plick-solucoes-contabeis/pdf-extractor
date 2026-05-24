import * as XLSX from "xlsx";

export type XlsxSheet = {
  name: string;
  index: number;
  rows: string[][];
};

export type XlsxWorkbook = {
  sheets: XlsxSheet[];
};

/** Parse XLSX file and return all sheets */
export async function parseXlsxFileSheets(file: File): Promise<XlsxWorkbook> {
  const buffer = await file.arrayBuffer();
  // CSV: SheetJS auto-detect interpreta "05/03/2026" como m/d/yyyy (US) e troca dia/mês.
  // raw:true preserva strings literais (sem coerção pra Date), respeitando o formato BR do arquivo.
  const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
  const workbook = isCsv
    ? XLSX.read(buffer, { type: "array", raw: true })
    : XLSX.read(buffer, { type: "array", cellDates: true });
  return parseWorkbook(workbook);
}

/** Parse XLSX from ArrayBuffer and return all sheets */
export async function parseXlsxFromArrayBufferSheets(buffer: ArrayBuffer): Promise<XlsxWorkbook> {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  return parseWorkbook(workbook);
}

/** @deprecated Use parseXlsxFileSheets instead */
export async function parseXlsxFile(file: File): Promise<string[][]> {
  const wb = await parseXlsxFileSheets(file);
  return wb.sheets[0]?.rows ?? [];
}

/** @deprecated Use parseXlsxFromArrayBufferSheets instead */
export async function parseXlsxFromArrayBuffer(buffer: ArrayBuffer): Promise<string[][]> {
  const wb = await parseXlsxFromArrayBufferSheets(buffer);
  return wb.sheets[0]?.rows ?? [];
}

/**
 * Some banks (e.g. Itaú) export XLSX files where the declared !ref (e.g. "A1:F13") is
 * smaller than the actual cell data present in the sheet. SheetJS respects !ref and silently
 * ignores all cells outside it. Recalculating !ref from the real cell keys forces SheetJS
 * to read every row that is physically present.
 *
 * Origin stays anchored at A1: bumping `minR/minC` to the first physical cell would shift
 * indices when the file has empty rows/cols at the top (e.g. Itaú statements where row 1
 * is visually blank), breaking anchors saved against the original layout.
 */
function fixSheetRef(sheet: XLSX.WorkSheet): void {
  let maxR = -Infinity, maxC = -Infinity;
  for (const key of Object.keys(sheet)) {
    if (key.startsWith("!")) continue;
    const addr = XLSX.utils.decode_cell(key);
    if (addr.r > maxR) maxR = addr.r;
    if (addr.c > maxC) maxC = addr.c;
  }
  if (maxR === -Infinity) return;
  sheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
}

function parseWorkbook(workbook: XLSX.WorkBook): XlsxWorkbook {
  const wb = workbook as unknown as { Preamble?: XLSX.WorkSheet } & XLSX.WorkBook;

  const sheets: XlsxSheet[] = workbook.SheetNames.map((name, index) => {
    // Some .xls (BIFF8) files put sheet data in Preamble instead of Sheets
    const sheet = workbook.Sheets[name] ?? (index === 0 ? wb.Preamble : undefined);
    if (sheet) fixSheetRef(sheet);
    const rows: string[][] = sheet
      ? (XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
          raw: false,
        }) as string[][])
      : [];
    return { name, index, rows };
  });
  return { sheets };
}
