import * as XLSX from "xlsx";

export async function parseXlsxFile(file: File): Promise<string[][]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false });
  return rows.map((row) => row.map((cell) => (cell != null ? String(cell) : "")));
}

export async function parseXlsxFromArrayBuffer(buffer: ArrayBuffer): Promise<string[][]> {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false });
  return rows.map((row) => row.map((cell) => (cell != null ? String(cell) : "")));
}
