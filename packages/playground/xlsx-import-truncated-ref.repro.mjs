// Repro PLICK-1520 — NOT committed. Local-only TDD harness.
// Tests that parseWorkbook returns ALL rows when sheet !ref is truncated.

import * as XLSX from "xlsx";

// ---------- inline current registry implementation ----------
// Copied from packages/registry/react/xlsx-import/xlsx-import.ts
function fixSheetRef(sheet) {
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

function parseWorkbook(workbook) {
  const wb = workbook;
  const sheets = workbook.SheetNames.map((name, index) => {
    const sheet = workbook.Sheets[name] ?? (index === 0 ? wb.Preamble : undefined);
    if (sheet) fixSheetRef(sheet);
    const rows = sheet
      ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false })
      : [];
    return { name, index, rows };
  });
  return { sheets };
}

// ---------- assertions ----------
let pass = 0;
let fail = 0;
function assertEq(actual, expected, label) {
  if (actual === expected) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.log(`  FAIL  ${label}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
    fail++;
  }
}

// ---------- Case 1: XLSX com !ref truncado (simula Itaú) ----------
console.log("\nCase 1: XLSX com !ref truncado deve retornar todas as linhas reais");
{
  // Cria uma planilha com 10 linhas de dados reais e trunca o !ref diretamente em memória.
  // XLSX.write recalcularia o !ref ao serializar, então injetamos o workbook sem write/read
  // para simular exatamente como o Itaú exporta: células físicas presentes mas !ref mentindo.
  const data = Array.from({ length: 10 }, (_, i) => [`2026-01-${String(i + 1).padStart(2, "0")}`, `Lançamento ${i + 1}`, i * 100]);
  const ws = XLSX.utils.aoa_to_sheet([["Data", "Histórico", "Valor"], ...data]);
  ws["!ref"] = "A1:C3"; // Itaú declara só 3 linhas, mas há 11

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, ws, "Lançamentos");

  const result = parseWorkbook(workbook);
  const rowCount = result.sheets[0].rows.length;

  // Com !ref truncado, a implementação sem fix retorna só 3 linhas (bug)
  // Após o fix, deve retornar 11 linhas (header + 10 dados)
  assertEq(rowCount, 11, "XLSX com !ref truncado — deve retornar todas as 11 linhas (header + 10 dados)");
}

// ---------- Case 2: XLSX normal (sem !ref truncado) não deve regredir ----------
console.log("\nCase 2: XLSX normal (sem !ref truncado) deve continuar funcionando");
{
  const ws = XLSX.utils.aoa_to_sheet([["Data", "Valor"], ["2026-01-01", "100"], ["2026-01-02", "200"]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, ws, "Sheet1");

  const result = parseWorkbook(workbook);
  const rowCount = result.sheets[0].rows.length;

  assertEq(rowCount, 3, "XLSX normal — deve retornar 3 linhas sem regressão");
}

// ---------- Case 3: planilha sem células não deve quebrar ----------
console.log("\nCase 3: planilha sem células não deve quebrar");
{
  const ws = {}; // sem !ref e sem células — fixSheetRef deve retornar sem crash
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, ws, "Sheet1");

  let threw = false;
  try {
    parseWorkbook(workbook);
  } catch {
    threw = true;
  }
  assertEq(threw, false, "planilha sem células — não deve lançar exceção");
}

// ---------- Case 4: XLSX com primeiras linhas vazias (extrato Itaú real) ----------
// Bancos como Itaú exportam o extrato com a linha 1 visualmente vazia (sem células
// físicas no XML), mas o !ref começa em A1. fixSheetRef estava recalculando minR pela
// primeira célula real (row=1), deslocando a origem e fazendo "Atualização:" virar row=0
// no array — quando o backend, que lê com o !ref original, espera "Atualização:" em row=1.
console.log("\nCase 4: primeiras linhas vazias devem preservar a origem (A1)");
{
  const sheet = {
    "!ref": "A1:B3",
    A2: { t: "s", v: "Atualização:" },
    B2: { t: "s", v: "07/05/2026" },
    A3: { t: "s", v: "Nome:" },
    B3: { t: "s", v: "ELECON" },
  };
  const workbook = { SheetNames: ["Lançamentos"], Sheets: { Lançamentos: sheet } };

  const result = parseWorkbook(workbook);
  const rows = result.sheets[0].rows;

  assertEq(rows.length, 3, "linhas vazias no topo — array deve ter 3 linhas (incluindo a vazia inicial)");
  assertEq(rows[0]?.[0] ?? "", "", "row 0 deve permanecer vazia (preservar origem)");
  assertEq(rows[1]?.[0] ?? "", "Atualização:", "row 1 deve conter 'Atualização:'");
}

console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
