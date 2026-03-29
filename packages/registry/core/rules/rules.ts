import type { DataViewRules, PipelineRule, MergePatternPreset, MergeLineCondition, TransformAction, VariableTransformAction, MatchCondition } from "@pdf-extractor/types";

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
  { value: "has_value", label: "Tem valor" },
  { value: "date", label: "Data" },
  { value: "decimal", label: "Decimal" },
  { value: "integer", label: "Inteiro" },
  { value: "currency", label: "Moeda" },
  { value: "regex", label: "Regex personalizado" },
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

// --- Merge line above/below ---

function rowMatchesAllConditionsForMerge(row: string[], conditions: MatchCondition[], rowIndex: number): boolean {
  if (conditions.length === 0) return true; // no conditions = always match
  return conditions.every(c => matchesCondition(row, c.column, c.matchType, c.value, c.caseInsensitive, rowIndex));
}

function applyMergeLineAbove(data: string[][], sourceConditions: MatchCondition[], targetConditions: MatchCondition[], separator: string): string[][] {
  if (data.length === 0) return data;

  const consumed = new Set<number>();

  for (let i = 1; i < data.length; i++) {
    if (consumed.has(i)) continue;
    const targetIdx = i - 1;
    if (consumed.has(targetIdx)) continue;

    if (rowMatchesAllConditionsForMerge(data[i], sourceConditions, i) &&
        rowMatchesAllConditionsForMerge(data[targetIdx], targetConditions, targetIdx)) {
      data[targetIdx] = mergeRows([data[targetIdx], data[i]], separator || " ");
      consumed.add(i);
    }
  }

  return data.filter((_, i) => !consumed.has(i));
}

function applyMergeLineBelow(data: string[][], sourceConditions: MatchCondition[], targetConditions: MatchCondition[], separator: string): string[][] {
  if (data.length === 0) return data;

  const consumed = new Set<number>();

  for (let i = 0; i < data.length - 1; i++) {
    if (consumed.has(i)) continue;
    const targetIdx = i + 1;
    if (consumed.has(targetIdx)) continue;

    if (rowMatchesAllConditionsForMerge(data[i], sourceConditions, i) &&
        rowMatchesAllConditionsForMerge(data[targetIdx], targetConditions, targetIdx)) {
      data[i] = mergeRows([data[i], data[targetIdx]], separator || " ");
      consumed.add(targetIdx);
    }
  }

  return data.filter((_, i) => !consumed.has(i));
}

// --- Extract variable ---

export function applyVariableTransforms(value: string, transforms: VariableTransformAction[]): string {
  let result = value;
  for (const transform of transforms) {
    switch (transform.action) {
      case "set": result = transform.value; break;
      case "append_prefix": result = transform.value + result; break;
      case "append_suffix": result = result + transform.value; break;
      case "replace": result = result.split(transform.search).join(transform.replace); break;
      case "trim": result = result.trim(); break;
      case "uppercase": result = result.toUpperCase(); break;
      case "lowercase": result = result.toLowerCase(); break;
      case "substring": result = result.slice(transform.start, transform.end); break;
      case "regex_extract": {
        try {
          const flags = "";
          const regex = new RegExp(transform.regex, flags);
          const found = regex[Symbol.match](result);
          result = found?.[transform.group] ?? "";
        } catch {
          result = "";
        }
        break;
      }
    }
  }
  return result;
}

// --- Set column ---

function applySetColumnValue(data: string[][], column: number, mode: "set" | "prepend" | "append", value: string, separator: string): string[][] {
  return data.map(row => {
    const newRow = [...row];
    while (newRow.length <= column) newRow.push("");
    const current = newRow[column] ?? "";
    switch (mode) {
      case "set": newRow[column] = value; break;
      case "prepend": newRow[column] = value + (separator ?? "") + current; break;
      case "append": newRow[column] = current + (separator ?? "") + value; break;
    }
    return newRow;
  });
}

function applySetColumn(data: string[][], rule: PipelineRule & { type: "set_column" }, variables: Record<string, string>): string[][] {
  const value = rule.value.replace(/\{\{(\w+)\}\}/g, (_, name) => variables[name] ?? "");

  if (rule.mode === "insert_before" || rule.mode === "insert_after") {
    const insertAt = rule.mode === "insert_before" ? rule.column : rule.column + 1;
    return data.map(row => {
      const newRow = [...row];
      while (newRow.length < insertAt) newRow.push("");
      newRow.splice(insertAt, 0, value);
      return newRow;
    });
  }

  return applySetColumnValue(data, rule.column, rule.mode as "set" | "prepend" | "append", value, rule.separator);
}

// --- Pipeline ---

export type PipelineResult = {
  data: string[][];
  variables: Record<string, string>;
};

function applyRule(
  data: string[][],
  rule: PipelineRule,
  rawData: string[][],
  variables: Record<string, string>,
): PipelineResult {
  switch (rule.type) {
    case "ignore_empty_lines":
      return { data: data.filter(row => !isRowEmpty(row)), variables };
    case "ignore_line":
      return {
        data: data.filter((row, rowIndex) => {
          if (rule.conditions.length === 0) return true;
          const match = rule.logic === "and"
            ? rule.conditions.every(c => matchesCondition(row, c.column, c.matchType, c.value, c.caseInsensitive, rowIndex))
            : rule.conditions.some(c => matchesCondition(row, c.column, c.matchType, c.value, c.caseInsensitive, rowIndex));
          return !match;
        }),
        variables,
      };
    case "merge_lines":
      return { data: applyMergeRule(data, rule.conditions, rule.logic, rule.separator), variables };
    case "carry_forward":
      return { data: applyCarryForward(data, rule.column), variables };
    case "transform_value":
      return { data: applyTransformValue(data, rule), variables };
    case "ignore_before_match":
      return { data: applyIgnoreBeforeMatch(data, rule.conditions, rule.inclusive), variables };
    case "ignore_after_match":
      return { data: applyIgnoreAfterMatch(data, rule.conditions, rule.inclusive), variables };
    case "remove_empty_columns": {
      if (data.length === 0) return { data, variables };
      const colCount = Math.max(...data.map(r => r.length));
      const nonEmpty = new Set<number>();
      for (const row of data) {
        for (let c = 0; c < colCount; c++) {
          const v = (row[c] ?? "").trim();
          if (v !== "" && v !== "-") nonEmpty.add(c);
        }
      }
      if (nonEmpty.size === colCount) return { data, variables };
      const keep = Array.from(nonEmpty).sort((a, b) => a - b);
      return { data: data.map(row => keep.map(c => row[c] ?? "")), variables };
    }
    case "merge_line_above":
      return { data: applyMergeLineAbove(data, rule.sourceConditions, rule.targetConditions, rule.separator), variables };
    case "merge_line_below":
      return { data: applyMergeLineBelow(data, rule.sourceConditions, rule.targetConditions, rule.separator), variables };
    case "extract_variable": {
      const rawValue = (rawData[rule.row]?.[rule.col] ?? "").trim();
      const resolved = applyVariableTransforms(rawValue, rule.transforms);
      return { data, variables: { ...variables, [rule.name]: resolved } };
    }
    case "set_column":
      return { data: applySetColumn(data, rule, variables), variables };
    case "variable_to_column": {
      const rawValue = (rawData[rule.row]?.[rule.col] ?? "").trim();
      const resolved = applyVariableTransforms(rawValue, rule.transforms);
      const newVariables = { ...variables, [rule.name]: resolved };
      const newData = applySetColumnValue(data, rule.targetColumn, rule.mode, resolved, rule.separator);
      return { data: newData, variables: newVariables };
    }
    case "capture_group_value": {
      let currentValue = "";
      const headerLinesToRemove = new Set<number>();

      const result = data.map((row, rowIndex) => {
        const isHeader = rule.headerConditions.length > 0 && (
          rule.headerConditionsLogic === "and"
            ? rule.headerConditions.every(c => matchesCondition(row, c.column, c.matchType, c.value, c.caseInsensitive, rowIndex))
            : rule.headerConditions.some(c => matchesCondition(row, c.column, c.matchType, c.value, c.caseInsensitive, rowIndex))
        );

        if (isHeader) {
          const raw = (row[rule.sourceColumn] ?? "").trim();
          currentValue = applyVariableTransforms(raw, rule.transforms);
          if (rule.removeHeaderLine) headerLinesToRemove.add(rowIndex);
          return row;
        }

        if (!currentValue) return row;

        const isTarget = rule.targetConditions.length === 0 || (
          rule.targetConditionsLogic === "and"
            ? rule.targetConditions.every(c => matchesCondition(row, c.column, c.matchType, c.value, c.caseInsensitive, rowIndex))
            : rule.targetConditions.some(c => matchesCondition(row, c.column, c.matchType, c.value, c.caseInsensitive, rowIndex))
        );

        if (!isTarget) return row;

        return applySetColumnValue([row], rule.targetColumn, rule.mode, currentValue, rule.separator)[0];
      });

      return {
        data: rule.removeHeaderLine ? result.filter((_, i) => !headerLinesToRemove.has(i)) : result,
        variables,
      };
    }
  }
}

export function applyDataViewRules(data: string[][], rules: DataViewRules): PipelineResult {
  let current = data;
  let variables: Record<string, string> = {};
  for (const rule of rules.rules) {
    const result = applyRule(current, rule, data, variables);
    current = result.data;
    variables = result.variables;
  }
  return { data: current, variables };
}
