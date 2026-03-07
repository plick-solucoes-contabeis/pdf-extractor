import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Template, Word } from "../../shared/types";
import { extractFullTableData } from "../../shared/extract";

type PageWords = {
  pdf_id: number;
  page_num: number;
  page_width: number;
  page_height: number;
  words: Word[];
};

const app = new Hono();
app.use("*", cors());

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

async function fetchPageWords(pdfId: number, page: number): Promise<Word[]> {
  const res = await fetch(`${BACKEND_URL}/api/pdfs/${pdfId}/pages/${page - 1}/words`);
  if (!res.ok) throw new Error(`Failed to fetch words for page ${page}: ${res.status}`);
  const data: PageWords = await res.json();
  return data.words;
}

app.post("/api/extract", async (c) => {
  const body = await c.req.parseBody();
  const templateFile = body["template"];
  const pdfIdRaw = body["pdf_id"];

  if (!templateFile || !(templateFile instanceof File)) {
    return c.json({ error: "template file is required" }, 400);
  }
  if (!pdfIdRaw) {
    return c.json({ error: "pdf_id is required" }, 400);
  }

  const pdfId = Number(pdfIdRaw);
  if (isNaN(pdfId)) {
    return c.json({ error: "pdf_id must be a number" }, 400);
  }

  const template: Template = JSON.parse(await templateFile.text());

  // Cache words per page to avoid duplicate fetches
  const wordsCache = new Map<number, Word[]>();
  async function getPageWords(page: number): Promise<Word[]> {
    if (wordsCache.has(page)) return wordsCache.get(page)!;
    const words = await fetchPageWords(pdfId, page);
    wordsCache.set(page, words);
    return words;
  }

  // Pre-fetch all needed pages
  const neededPages = new Set<number>();
  for (const t of template.tables) {
    const end = t.endPage ?? t.startPage;
    for (let p = t.startPage; p <= end; p++) {
      neededPages.add(p);
    }
  }

  await Promise.all(
    [...neededPages].map((p) => getPageWords(p))
  );

  // Extract data for each table
  const results = template.tables.map((table) => {
    const rows = extractFullTableData(
      table,
      template.ignores,
      template.footers,
      (page) => wordsCache.get(page) ?? null
    );
    return {
      tableId: table.id,
      startPage: table.startPage,
      endPage: table.endPage ?? table.startPage,
      columns: table.columns.length + 1,
      rows,
    };
  });

  return c.json({ tables: results });
});

app.get("/health", (c) => c.json({ status: "ok" }));

const port = Number(process.env.PORT ?? 3001);
console.log(`Template service running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
