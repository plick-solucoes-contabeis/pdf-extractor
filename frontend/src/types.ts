export type {
  Word,
  Rect,
  MatchWord,
  ColumnDivider,
  TableAnnotation,
  IgnoreAnnotation,
  FooterAnnotation,
  Phrase,
  Template,
} from "../../shared/types";

import type { Word } from "../../shared/types";

export type PageWords = {
  pdf_id: number;
  page_num: number;
  page_width: number;
  page_height: number;
  words: Word[];
};

export type Tool = "select" | "table" | "ignore" | "footer";
