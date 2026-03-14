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

export type Template = {
  tables: TableAnnotation[];
  ignores: IgnoreAnnotation[];
  footers: FooterAnnotation[];
  headers: HeaderAnnotation[];
};

export type IgnoreLineMatchType = "contains" | "starts_with" | "ends_with" | "equals" | "regex";

export type MergePatternPreset = "date" | "decimal" | "integer" | "currency" | "has_value";

export type MergeLineCondition = {
  column: number;
  pattern: MergePatternPreset | "regex";
  regexValue?: string;
};

export type PipelineRule =
  | { type: "ignore_empty_lines"; id: string }
  | { type: "ignore_line"; id: string; column: number; matchType: IgnoreLineMatchType; value: string; caseInsensitive: boolean }
  | { type: "merge_lines"; id: string; conditions: MergeLineCondition[]; separator: string }
  | { type: "carry_forward"; id: string; column: number };

export type DataViewRules = {
  rules: PipelineRule[];
};
