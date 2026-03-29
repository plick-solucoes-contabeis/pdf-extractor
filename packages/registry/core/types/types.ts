export type Word = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fontname: string;
  size: number;
};

export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type MatchWord = {
  text: string;
  x0: number;
  x1: number;
};

export type ColumnDivider = {
  position: number; // normalized 0-1 relative to region width
  splitPhrases: boolean; // true = split words by column, false = keep phrase in start column
};

export type TableAnnotation = {
  id: string;
  region: Rect;
  columns: ColumnDivider[];
  startPage: number;
  endPage: number | null;
  endY: number | null;
  endMatchWords: MatchWord[] | null;
  startMatchWords: MatchWord[] | null;
  lineMergeDistance?: number; // distance in PDF points to merge nearby lines into one row (0 = overlap only)
};

export type IgnoreAnnotation = {
  id: string;
  region: Rect;
  startPage: number;
  endPage: number | null;
  endY: number | null;
};

export type FooterAnnotation = {
  id: string;
  mode: "line" | "match";
  y: number;
  matchRegion: Rect | null;
  matchWords: MatchWord[] | null;
};

export type HeaderAnnotation = {
  id: string;
  mode: "line" | "match";
  y: number;
  matchRegion: Rect | null;
  matchWords: MatchWord[] | null;
};

export type Phrase = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type PdfExtraction = {
  tables: TableAnnotation[];
  ignores: IgnoreAnnotation[];
  footers: FooterAnnotation[];
  headers: HeaderAnnotation[];
};

/** @deprecated Use PdfExtraction instead */
export type Template = PdfExtraction;

// --- Anchors ---

export type PdfAnchor = {
  text: string;
  x0: number; // normalized 0-1
  y0: number;
  x1: number;
  y1: number;
};

export type XlsxAnchor = {
  text: string;
  row: number; // 0-based
  col: number; // 0-based
};

// --- XLSX source config ---

export type XlsxSourceConfig = {
  sheetIndex: number;
  sheetName?: string;
  headerRow?: number;
  dataStartRow?: number;
};

// --- Templates ---

export type PdfTemplate = {
  type: "pdf";
  name: string;
  anchors: PdfAnchor[];
  extraction: PdfExtraction;
  rules: PipelineRule[];
};

export type XlsxTemplate = {
  type: "xlsx";
  name: string;
  anchors: XlsxAnchor[];
  source: XlsxSourceConfig;
  rules: PipelineRule[];
};

export type IgnoreLineMatchType = "contains" | "not_contains" | "starts_with" | "ends_with" | "equals" | "not_equals" | "regex" | "is_empty" | "is_not_empty" | "index_eq" | "index_lt" | "index_lte" | "index_gt" | "index_gte";

export type TransformAction =
  | { action: "set"; value: string }
  | { action: "append_prefix"; value: string }
  | { action: "append_suffix"; value: string }
  | { action: "replace"; search: string; replace: string };

export type VariableTransformAction =
  | { action: "replace"; search: string; replace: string }
  | { action: "append_prefix"; value: string }
  | { action: "append_suffix"; value: string }
  | { action: "set"; value: string }
  | { action: "regex_extract"; regex: string; group: number }
  | { action: "trim" }
  | { action: "substring"; start: number; end?: number }
  | { action: "uppercase" }
  | { action: "lowercase" };

export type MergePatternPreset = "date" | "decimal" | "integer" | "currency" | "has_value";

export type MergeLineCondition = {
  column: number;
  pattern: MergePatternPreset | "regex";
  regexValue?: string;
};

export type MatchCondition = {
  column: number;
  matchType: IgnoreLineMatchType;
  value: string;
  caseInsensitive: boolean;
};

export type PipelineRule =
  | { type: "ignore_empty_lines"; id: string }
  | { type: "ignore_line"; id: string; conditions: MatchCondition[]; logic: "or" | "and" }
  | { type: "merge_lines"; id: string; conditions: MergeLineCondition[]; logic: "or" | "and"; separator: string }
  | { type: "carry_forward"; id: string; column: number }
  | { type: "transform_value"; id: string; conditionColumn: number; matchType: IgnoreLineMatchType; matchValue: string; caseInsensitive: boolean; targetColumn: number; transform: TransformAction }
  | { type: "ignore_before_match"; id: string; conditions: MatchCondition[]; inclusive: boolean }
  | { type: "ignore_after_match"; id: string; conditions: MatchCondition[]; inclusive: boolean }
  | { type: "remove_empty_columns"; id: string }
  | { type: "merge_line_above"; id: string; sourceConditions: MatchCondition[]; targetConditions: MatchCondition[]; separator: string }
  | { type: "merge_line_below"; id: string; sourceConditions: MatchCondition[]; targetConditions: MatchCondition[]; separator: string }
  | { type: "extract_variable"; id: string; name: string; row: number; col: number; transforms: VariableTransformAction[] }
  | { type: "set_column"; id: string; column: number; mode: "set" | "prepend" | "append" | "insert_before" | "insert_after"; value: string; separator: string };

export type DataViewRules = {
  rules: PipelineRule[];
};

export type DocumentVariable = {
  name: string;
  row: number;
  col: number;
  transforms: VariableTransformAction[];
};

