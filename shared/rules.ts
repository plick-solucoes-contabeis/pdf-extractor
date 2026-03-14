import type { DataViewRules, PipelineRule, MergePatternPreset, MergeLineCondition } from "./types";

function isCellEmpty(cell: string): boolean {
  const trimmed = cell.trim();
  return trimmed === "" || trimmed === "-";
}

function isRowEmpty(row: string[]): boolean {
  return row.every((cell) => isCellEmpty(cell));
}

// --- Preset patterns for merge rules ---

const PRESET_PATTERNS: Record<MergePatternPreset, { label: string; regex: RegExp }> = {
  date: {
    label: "Date",
    regex: new RegExp(
      [
        // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (with 2 or 4 digit year)
        "\\d{1,2}[/\\-.]\\d{1,2}[/\\-.]\\d{2,4}",
        // yyyy-mm-dd, yyyy/mm/dd
        "\\d{4}[/\\-.]\\d{1,2}[/\\-.]\\d{1,2}",
        // Portuguese months: 10 de janeiro de 2025, jan/2025, janeiro 2025
        "(?:janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[./\\s]+\\d{2,4}",
        "\\d{1,2}\\s+(?:de\\s+)?(?:janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)",
        // English months: January 10, 2025 / 10 Jan 2025 / Jan 2025
        "(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[./\\s]+\\d{1,4}",
        "\\d{1,2}\\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)",
      ].join("|"),
      "i"
    ),
  },
  decimal: {
    label: "Decimal",
    // 1.234,56 or 1,234.56 or 123,45 or 123.45 or single digit
    regex: /^-?\d[\d.,]*[\d]$|^-?\d$/,
  },
  integer: {
    label: "Integer",
    // 1234 or 1.234 (thousand sep) — no comma/decimal
    regex: /^-?\d[\d.]*$/,
  },
  currency: {
    label: "Currency",
    regex: /(?:R\$|US\$|\$|€|£|¥)\s*-?\d|^-?\d[\d.,]*\s*[CDcd]$/,
  },
  has_value: {
    label: "Has value",
    regex: /./, // placeholder, actual logic uses isCellEmpty
  },
};

export const MERGE_PATTERN_OPTIONS: { value: MergePatternPreset | "regex"; label: string }[] = [
  { value: "has_value", label: "Has value" },
  { value: "date", label: "Date" },
  { value: "decimal", label: "Decimal" },
  { value: "integer", label: "Integer" },
  { value: "currency", label: "Currency" },
  { value: "regex", label: "Custom regex" },
];

// --- Ignore rules ---

export function matchesIgnoreRule(row: string[], rule: { column: number; matchType: string; value: string; caseInsensitive: boolean }): boolean {
  const cell = row[rule.column] ?? "";
  const value = rule.value;

  if (rule.matchType === "regex") {
    try {
      const flags = rule.caseInsensitive ? "i" : "";
      return new RegExp(value, flags).test(cell);
    } catch {
      return false;
    }
  }

  const a = rule.caseInsensitive ? cell.toLowerCase() : cell;
  const b = rule.caseInsensitive ? value.toLowerCase() : value;

  switch (rule.matchType) {
    case "contains":
      return a.includes(b);
    case "starts_with":
      return a.startsWith(b);
    case "ends_with":
      return a.endsWith(b);
    case "equals":
      return a === b;
    default:
      return false;
  }
}

// --- Merge rules ---

function matchesMergeCondition(row: string[], condition: MergeLineCondition): boolean {
  const cell = (row[condition.column] ?? "").trim();

  if (condition.pattern === "has_value") {
    return !isCellEmpty(cell);
  }

  if (condition.pattern === "regex") {
    if (!condition.regexValue) return false;
    try {
      return new RegExp(condition.regexValue).test(cell);
    } catch {
      return false;
    }
  }

  return PRESET_PATTERNS[condition.pattern].regex.test(cell);
}

function isNewRowStart(row: string[], conditions: MergeLineCondition[]): boolean {
  return conditions.some((cond) => matchesMergeCondition(row, cond));
}

function mergeRows(group: string[][], separator: string): string[] {
  if (group.length === 1) return group[0];

  const maxCols = Math.max(...group.map((r) => r.length));
  const merged: string[] = [];

  for (let col = 0; col < maxCols; col++) {
    const parts: string[] = [];
    for (const row of group) {
      const cell = (row[col] ?? "").trim();
      if (!isCellEmpty(cell)) {
        parts.push(cell);
      }
    }
    merged.push(parts.join(separator));
  }
  return merged;
}

export function applyMergeRule(data: string[][], conditions: MergeLineCondition[], separator: string): string[][] {
  if (conditions.length === 0) return data;
  if (data.length === 0) return data;

  const groups: string[][][] = [];
  let currentGroup: string[][] = [];

  for (const row of data) {
    if (isNewRowStart(row, conditions)) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = [row];
    } else {
      if (currentGroup.length === 0) {
        currentGroup = [row];
      } else {
        currentGroup.push(row);
      }
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups.map((g) => mergeRows(g, separator || " "));
}

// --- Carry forward ---

function applyCarryForward(data: string[][], column: number): string[][] {
  let carry = "";
  return data.map(row => {
    const cell = (row[column] ?? "").trim();
    if (!isCellEmpty(cell)) {
      carry = cell;
      return row;
    }
    if (carry) {
      const newRow = [...row];
      while (newRow.length <= column) newRow.push("");
      newRow[column] = carry;
      return newRow;
    }
    return row;
  });
}

// --- Pipeline ---

function applyRule(data: string[][], rule: PipelineRule): string[][] {
  switch (rule.type) {
    case "ignore_empty_lines":
      return data.filter(row => !isRowEmpty(row));
    case "ignore_line":
      return data.filter(row => !matchesIgnoreRule(row, rule));
    case "merge_lines":
      return applyMergeRule(data, rule.conditions, rule.separator);
    case "carry_forward":
      return applyCarryForward(data, rule.column);
  }
}

export function applyDataViewRules(data: string[][], rules: DataViewRules): string[][] {
  let result = data;
  for (const rule of rules.rules) {
    result = applyRule(result, rule);
  }
  return result;
}
