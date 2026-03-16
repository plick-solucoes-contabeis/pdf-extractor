import type { DataViewRules, PipelineRule, MergePatternPreset, MergeLineCondition, TransformAction, MatchCondition } from "@pdf-extractor/types";

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

export function matchesCondition(row: string[], column: number, matchType: string, value: string, caseInsensitive: boolean, rowIndex?: number): boolean {
  // Line number matches (1-based)
  if (matchType.startsWith("index_")) {
    if (value.trim() === "") return false;
    const parsed = parseInt(value);
    if (isNaN(parsed)) return false;
    const threshold = parsed;
    const idx = (rowIndex ?? 0);
    switch (matchType) {
      case "index_eq": return idx === threshold;
      case "index_lt": return idx < threshold;
      case "index_lte": return idx <= threshold;
      case "index_gt": return idx > threshold;
      case "index_gte": return idx >= threshold;
      default: return false;
    }
  }

  const cell = row[column] ?? "";

  if (matchType === "is_empty") {
    return isCellEmpty(cell);
  }

  if (matchType === "is_not_empty") {
    return !isCellEmpty(cell);
  }

  if (matchType === "regex") {
    try {
      const flags = caseInsensitive ? "i" : "";
      return new RegExp(value, flags).test(cell);
    } catch {
      return false;
    }
  }

  const a = caseInsensitive ? cell.toLowerCase() : cell;
  const b = caseInsensitive ? value.toLowerCase() : value;

  switch (matchType) {
    case "contains":
      return a.includes(b);
    case "not_contains":
      return !a.includes(b);
    case "starts_with":
      return a.startsWith(b);
    case "ends_with":
      return a.endsWith(b);
    case "equals":
      return a === b;
    case "not_equals":
      return a !== b;
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

function isNewRowStart(row: string[], conditions: MergeLineCondition[], logic: "or" | "and"): boolean {
  if (conditions.length === 0) return false;
  return logic === "and"
    ? conditions.every((cond) => matchesMergeCondition(row, cond))
    : conditions.some((cond) => matchesMergeCondition(row, cond));
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

export function applyMergeRule(data: string[][], conditions: MergeLineCondition[], logic: "or" | "and", separator: string): string[][] {
  if (conditions.length === 0) return data;
  if (data.length === 0) return data;

  const groups: string[][][] = [];
  let currentGroup: string[][] = [];

  for (const row of data) {
    if (isNewRowStart(row, conditions, logic)) {
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

// --- Transform value ---

function applyTransformAction(cell: string, transform: TransformAction): string {
  switch (transform.action) {
    case "set":
      return transform.value;
    case "append_prefix":
      return transform.value + cell;
    case "append_suffix":
      return cell + transform.value;
    case "replace":
      return cell.split(transform.search).join(transform.replace);
  }
}

function applyTransformValue(data: string[][], rule: PipelineRule & { type: "transform_value" }): string[][] {
  return data.map((row, rowIndex) => {
    if (!matchesCondition(row, rule.conditionColumn, rule.matchType, rule.matchValue, rule.caseInsensitive, rowIndex)) {
      return row;
    }
    const newRow = [...row];
    while (newRow.length <= rule.targetColumn) newRow.push("");
    newRow[rule.targetColumn] = applyTransformAction(newRow[rule.targetColumn] ?? "", rule.transform);
    return newRow;
  });
}

// --- Ignore before/after match ---

function rowMatchesAllConditions(row: string[], conditions: MatchCondition[], rowIndex: number): boolean {
  if (conditions.length === 0) return false;
  return conditions.every(c => matchesCondition(row, c.column, c.matchType, c.value, c.caseInsensitive, rowIndex));
}

function applyIgnoreBeforeMatch(data: string[][], conditions: MatchCondition[], inclusive: boolean): string[][] {
  const idx = data.findIndex((row, i) => rowMatchesAllConditions(row, conditions, i));
  if (idx === -1) return data;
  return data.slice(inclusive ? idx + 1 : idx);
}

function applyIgnoreAfterMatch(data: string[][], conditions: MatchCondition[], inclusive: boolean): string[][] {
  const idx = data.findIndex((row, i) => rowMatchesAllConditions(row, conditions, i));
  if (idx === -1) return data;
  return data.slice(0, inclusive ? idx : idx + 1);
}

// --- Pipeline ---

function applyRule(data: string[][], rule: PipelineRule): string[][] {
  switch (rule.type) {
    case "ignore_empty_lines":
      return data.filter(row => !isRowEmpty(row));
    case "ignore_line":
      return data.filter((row, rowIndex) => {
        if (rule.conditions.length === 0) return true;
        const match = rule.logic === "and"
          ? rule.conditions.every(c => matchesCondition(row, c.column, c.matchType, c.value, c.caseInsensitive, rowIndex))
          : rule.conditions.some(c => matchesCondition(row, c.column, c.matchType, c.value, c.caseInsensitive, rowIndex));
        return !match;
      });
    case "merge_lines":
      return applyMergeRule(data, rule.conditions, rule.logic, rule.separator);
    case "carry_forward":
      return applyCarryForward(data, rule.column);
    case "transform_value":
      return applyTransformValue(data, rule);
    case "ignore_before_match":
      return applyIgnoreBeforeMatch(data, rule.conditions, rule.inclusive);
    case "ignore_after_match":
      return applyIgnoreAfterMatch(data, rule.conditions, rule.inclusive);
    case "remove_empty_columns": {
      if (data.length === 0) return data;
      const colCount = Math.max(...data.map(r => r.length));
      const nonEmpty = new Set<number>();
      for (const row of data) {
        for (let c = 0; c < colCount; c++) {
          const v = (row[c] ?? "").trim();
          if (v !== "" && v !== "-") nonEmpty.add(c);
        }
      }
      if (nonEmpty.size === colCount) return data;
      const keep = Array.from(nonEmpty).sort((a, b) => a - b);
      return data.map(row => keep.map(c => row[c] ?? ""));
    }
  }
}

export function applyDataViewRules(data: string[][], rules: DataViewRules): string[][] {
  let result = data;
  for (const rule of rules.rules) {
    result = applyRule(result, rule);
  }
  return result;
}
