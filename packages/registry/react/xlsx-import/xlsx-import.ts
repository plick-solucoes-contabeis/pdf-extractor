import * as XLSX from "xlsx";

export type XlsxSheet = {
  name: string;
  index: number;
  rows: string[][];
};

export type XlsxWorkbook = {
  sheets: XlsxSheet[];
};

function parseWorkbook(workbook: XLSX.WorkBook): XlsxWorkbook {
  const sheets: XlsxSheet[] = workbook.SheetNames.map((name, index) => {
    const sheet = workbook.Sheets[name];
    const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
    const rows = rawRows.map((row) => row.map((cell) => (cell != null ? String(cell) : "")));
    return { name, index, rows };
  });
  return { sheets };
}

/** Parse XLSX file and return all sheets */
export async function parseXlsxFileSheets(file: File): Promise<XlsxWorkbook> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
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
