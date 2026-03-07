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

export type TableAnnotation = {
  id: string;
  region: Rect; // normalized 0-1
  columns: number[]; // normalized x positions of column dividers (relative to region)
  page: number;
};

export type Tool = "select" | "table";
