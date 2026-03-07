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

type UploadResponse = {
  id: number;
  filename: string;
  num_pages: number;
  file_hash: string;
};

const app = new Hono();
app.use("*", cors());

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

async function uploadPdf(pdfFile: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", pdfFile);
  const res = await fetch(`${BACKEND_URL}/api/pdfs/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Failed to upload PDF: ${res.status}`);
  return res.json();
}

async function fetchPageWords(pdfId: number, page: number): Promise<Word[]> {
  const res = await fetch(`${BACKEND_URL}/api/pdfs/${pdfId}/pages/${page - 1}/words`);
  if (!res.ok) throw new Error(`Failed to fetch words for page ${page}: ${res.status}`);
  const data: PageWords = await res.json();
  return data.words;
}

app.post("/api/extract", async (c) => {
  const body = await c.req.parseBody();
  const templateFile = body["template"];
  const pdfFile = body["pdf"];

  if (!templateFile || !(templateFile instanceof File)) {
    return c.json({ error: "template JSON file is required" }, 400);
  }
  if (!pdfFile || !(pdfFile instanceof File)) {
    return c.json({ error: "pdf file is required" }, 400);
  }

  const template: Template = JSON.parse(await templateFile.text());

  // Upload PDF to backend (returns existing if already uploaded)
  const pdfInfo = await uploadPdf(pdfFile);

  // Determine which pages are needed
  const neededPages = new Set<number>();
  for (const t of template.tables) {
    const end = t.endPage ?? t.startPage;
    for (let p = t.startPage; p <= end; p++) {
      neededPages.add(p);
    }
  }

  // Fetch all needed pages in parallel (cached in backend DB)
  const wordsCache = new Map<number, Word[]>();
  await Promise.all(
    [...neededPages].map(async (p) => {
      const words = await fetchPageWords(pdfInfo.id, p);
      wordsCache.set(p, words);
    })
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

  return c.json({
    pdf: {
      filename: pdfInfo.filename,
      numPages: pdfInfo.num_pages,
    },
    tables: results,
  });
});

app.get("/health", (c) => c.json({ status: "ok" }));

const port = Number(process.env.PORT ?? 3002);
console.log(`Template service running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
