export type Word = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fontname: string;
  size: number;
};

export type PageWords = {
  pdf_id: number;
  page_num: number;
  page_width: number;
  page_height: number;
  words: Word[];
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

export type TableAnnotation = {
  id: string;
  region: Rect; // normalized 0-1 (x, w are fixed; y, h are for startPage)
  columns: number[]; // normalized x positions of column dividers (relative to region)
  startPage: number;
  endPage: number | null; // null = same as startPage (single page)
  endY: number | null; // normalized y on endPage where table ends (null = bottom of page)
  endMatchWords: MatchWord[] | null; // words pattern that marks end of table (text + horizontal position)
};

export type IgnoreAnnotation = {
  id: string;
  region: Rect; // normalized 0-1
  startPage: number;
  endPage: number | null;
  endY: number | null;
};

export type FooterAnnotation = {
  id: string;
  mode: "line" | "match";
  y: number; // normalized Y where footer starts (everything below = footer)
  matchRegion: Rect | null; // for match mode: the area whose text must match
  matchWords: MatchWord[] | null; // for match mode: words with text + x positions
};

export type Tool = "select" | "table" | "ignore" | "footer";
