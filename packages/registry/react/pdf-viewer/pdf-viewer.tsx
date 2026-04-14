import React, { useState, useEffect, useRef, useMemo } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type {
  Word,
  Phrase,
  Rect,
  ColumnDivider,
  MatchWord,
  TableAnnotation,
  IgnoreAnnotation,
  FooterAnnotation,
  HeaderAnnotation,
  PdfExtraction,
  PdfAnchor,
  PdfTemplate,
  PipelineRule,
  PdfRegion,
  VariableTransformAction,
} from "@pdf-extractor/types";
import { getTableWords, detectColumns, mergeWordsIntoPhrases, extractFullTableData } from "@pdf-extractor/extract";
import { cn } from "@pdf-extractor/utils";
import { TableOverlay } from "@pdf-extractor/table-overlay";
import { IgnoreOverlay } from "@pdf-extractor/ignore-overlay";
import { OutputPanel } from "@pdf-extractor/output-panel";
import { DataView } from "@pdf-extractor/data-view";
import { VariableTransformPipeline } from "@pdf-extractor/rules-panel";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type PageWords = {
  pdf_id: number;
  page_num: number;
  page_width: number;
  page_height: number;
  words: Word[];
};

type Tool = "select" | "table" | "ignore" | "footer" | "header" | "anchor" | "variable";

type PageWordsEntry = {
  words: Word[];
  pageHeight: number;
  pageWidth: number;
};

type PDFViewerProps = {
  pdfUrl: string;
  numPages: number;
  onSendToDataView?: (label: string, rows: string[][]) => void;
  onTemplateSave?: (template: PdfTemplate) => void;
  /** Base URL for the word extraction API. Defaults to VITE_PDF_EXTRACTOR_API_URL env var or "/api". */
  apiUrl?: string;
  templateName?: string;
  initialAnchors?: PdfAnchor[];
  initialExtraction?: PdfExtraction;
  initialRules?: PipelineRule[];
  /** Pre-extracted words for all pages (1-based key). If provided, skips API calls. */
  allWords?: Map<number, PageWordsEntry>;
  /** Called whenever tables/ignores/footers/headers/rules change. */
  onExtractionChange?: (data: { anchors: PdfAnchor[]; extraction: PdfExtraction; rules: PipelineRule[]; resolvedVariables: Record<string, string> }) => void;
  /** Variable regions to render as orange overlays (from extract_variable pdf_region rules). */
  variableRegions?: Array<{ name: string; region: PdfRegion }>;
  /** Called when the user finishes drawing a variable region in "variable" tool mode. */
  onVariableRegionSelected?: (region: PdfRegion) => void;
  /**
   * Called once on mount with a `startVariablePick` function.
   * The parent can store this function and pass it as `onRegionPick` to RulesPanel,
   * allowing rule editors to activate the variable-draw mode from the viewer.
   */
  onVariablePickActivator?: (startPick: (cb: (region: PdfRegion) => void) => void) => void;
};

let nextId = 1;

// Inline helpers (avoid circular dependency with @pdf-extractor/rules)
function applyVariableTransformsInline(value: string, transforms: VariableTransformAction[]): string {
  let result = value;
  for (const t of transforms) {
    switch (t.action) {
      case "trim": result = result.trim(); break;
      case "uppercase": result = result.toUpperCase(); break;
      case "lowercase": result = result.toLowerCase(); break;
      case "set": result = t.value; break;
      case "append_prefix": result = t.value + result; break;
      case "append_suffix": result = result + t.value; break;
      case "replace": result = result.split(t.search).join(t.replace); break;
      case "regex_extract": {
        try {
          const m = result.match(new RegExp(t.regex));
          result = m ? (m[t.group] ?? "") : "";
        } catch { result = ""; }
        break;
      }
      case "substring": result = t.end !== undefined ? result.slice(t.start, t.end) : result.slice(t.start); break;
    }
  }
  return result;
}

function extractTextFromRegion(words: Word[], region: PdfRegion, tolerance: number = 10): string {
  const { x, y, w, h } = region;
  const tol = tolerance / 1000;
  return words
    .filter((word) => {
      const cx = (word.x0 + word.x1) / 2;
      const cy = (word.y0 + word.y1) / 2;
      return cx >= x - tol && cx <= x + w + tol && cy >= y - tol && cy <= y + h + tol;
    })
    .sort((a, b) => a.x0 - b.x0)
    .map((word) => word.text)
    .join(" ")
    .trim();
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

const DEFAULT_API_URL = (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_PDF_EXTRACTOR_API_URL) || "/api";

export function PDFViewer({ pdfUrl, numPages, onSendToDataView, onTemplateSave, apiUrl, templateName, initialAnchors, initialExtraction, initialRules, allWords: externalWords, variableRegions, onVariableRegionSelected, onVariablePickActivator, onExtractionChange }: PDFViewerProps) {
  const baseUrl = apiUrl ?? DEFAULT_API_URL;
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [words, setWords] = useState<PageWords | null>(null);
  const [loading, setLoading] = useState(false);
  const [allWordsCache, setAllWordsCache] = useState<Map<number, PageWordsEntry>>(externalWords ?? new Map());
  const [showWords, setShowWords] = useState(false);
  const [hoveredWord, setHoveredWord] = useState<Word | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [tables, setTables] = useState<TableAnnotation[]>(initialExtraction?.tables ?? []);
  const [ignores, setIgnores] = useState<IgnoreAnnotation[]>(initialExtraction?.ignores ?? []);
  const [footers, setFooters] = useState<FooterAnnotation[]>(initialExtraction?.footers ?? []);
  const [headers, setHeaders] = useState<HeaderAnnotation[]>(initialExtraction?.headers ?? []);
  const [anchors, setAnchors] = useState<PdfAnchor[]>(initialAnchors ?? []);
  const [rules, setRules] = useState<PipelineRule[]>(initialRules ?? []);
  const [selectedId, setSelectedId] = useState<{ type: "table" | "ignore" | "footer" | "header" | "variable"; id: string } | null>(null);

  // Drawing state (two-click: first click = start, second click = end)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  // Special capture mode: selecting text area for table end match
  const [capturingEndText, setCapturingEndText] = useState(false);
  const [capturingStartText, setCapturingStartText] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [showDataView, setShowDataView] = useState(false);
  const [showPhrases, setShowPhrases] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const lastClientX = useRef(0);
  const lastClientY = useRef(0);

  // We need refs for state values used in event handlers to avoid stale closures
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const drawStartRef = useRef(drawStart);
  drawStartRef.current = drawStart;
  const capturingEndTextRef = useRef(capturingEndText);
  capturingEndTextRef.current = capturingEndText;
  const capturingStartTextRef = useRef(capturingStartText);
  capturingStartTextRef.current = capturingStartText;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const tablesRef = useRef(tables);
  tablesRef.current = tables;
  const ignoresRef = useRef(ignores);
  ignoresRef.current = ignores;
  const footersRef = useRef(footers);
  footersRef.current = footers;
  const headersRef = useRef(headers);
  headersRef.current = headers;

  // Notify parent whenever extraction state changes (useEffect is below resolvedPdfVariables useMemo)
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;
  const onExtractionChangeRef = useRef(onExtractionChange);
  onExtractionChangeRef.current = onExtractionChange;

  // Pending callback for programmatic variable region picking (triggered by RulesPanel)
  const variablePickCbRef = useRef<((region: PdfRegion) => void) | null>(null);

  // Expose startVariablePick to parent via onVariablePickActivator
  useEffect(() => {
    if (!onVariablePickActivator) return;
    const startVariablePick = (cb: (region: PdfRegion) => void) => {
      variablePickCbRef.current = cb;
      setActiveTool("variable");
      setDrawStart(null);
      setDrawCurrent(null);
    };
    onVariablePickActivator(startVariablePick);
  }, [onVariablePickActivator]);

  // Resolve PDF variable values from region rules (for DataView integration and previews)
  const resolvedPdfVariables = useMemo(() => {
    const resolved: Record<string, string> = {};
    for (const rule of rules) {
      if (rule.type !== "extract_variable") continue;
      if ((rule.source ?? "table_cell") !== "pdf_region" || !rule.region) continue;
      const pageEntry = allWordsCache.get(rule.region.page);
      if (pageEntry) {
        const raw = extractTextFromRegion(pageEntry.words, rule.region, rule.tolerance ?? 10);
        resolved[rule.name] = applyVariableTransformsInline(raw, rule.transforms ?? []);
      }
    }
    return resolved;
  }, [rules, allWordsCache]);

  // Notify parent whenever extraction state changes
  useEffect(() => {
    if (!onExtractionChangeRef.current) return;
    onExtractionChangeRef.current({ anchors, extraction: { tables, ignores, footers, headers }, rules, resolvedVariables: resolvedPdfVariables });
  }, [tables, ignores, footers, headers, anchors, rules, resolvedPdfVariables]);

  // Compute available tables from extracted PDF tables (for embedded DataView)
  const availableTables = useMemo(() => {
    if (tables.length === 0) return [];
    const firstEntry = allWordsCache.values().next().value as { pageHeight: number } | undefined;
    const pageHeight = firstEntry?.pageHeight ?? 792;
    return tables.map((table, idx) => {
      const rows = extractFullTableData(
        table,
        ignores,
        footers,
        (page) => allWordsCache.get(page)?.words ?? null,
        pageHeight,
        headers
      );
      const endPage = table.endPage ?? table.startPage;
      const label = `Tabela ${idx + 1} (p${table.startPage}${endPage !== table.startPage ? "–" + endPage : ""})`;
      return { label, rows };
    });
  }, [tables, ignores, footers, headers, allWordsCache]);

  function exportTemplate() {
    const pdfTemplate: PdfTemplate = {
      type: "pdf",
      name: templateName ?? "template",
      anchors,
      extraction: { tables, ignores, footers, headers },
      rules,
    };
    const blob = new Blob([JSON.stringify(pdfTemplate, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pdfTemplate.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importTemplate(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = JSON.parse(reader.result as string);
      // Support both old Template format and new PdfTemplate format
      if (raw.type === "pdf" && raw.extraction) {
        // New PdfTemplate format
        const pt = raw as PdfTemplate;
        setAnchors(pt.anchors ?? []);
        setRules(pt.rules ?? []);
        const ext = pt.extraction;
        ext.tables = ext.tables.map((t) => ({
          ...t,
          startMatchWords: t.startMatchWords ?? null,
        }));
        setTables(ext.tables);
        setIgnores(ext.ignores);
        setFooters(ext.footers);
        setHeaders(ext.headers ?? []);
      } else {
        // Old Template/PdfExtraction format (backward compat)
        const template = raw as PdfExtraction;
        template.tables = template.tables.map((t) => ({
          ...t,
          startMatchWords: t.startMatchWords ?? null,
        }));
        setTables(template.tables);
        setIgnores(template.ignores);
        setFooters(template.footers);
        setHeaders(template.headers ?? []);
        setAnchors([]);
        setRules([]);
      }
      setSelectedId(null);
      setActiveTool("select");
    };
    reader.readAsText(file);
  }

  function handleAddAnchor(word: Word) {
    const anchor: PdfAnchor = {
      text: word.text,
      x0: word.x0,
      y0: word.y0,
      x1: word.x1,
      y1: word.y1,
    };
    // Don't add duplicate anchors (same text + position)
    const isDuplicate = anchors.some(
      (a) => a.text === anchor.text && Math.abs(a.x0 - anchor.x0) < 0.001 && Math.abs(a.y0 - anchor.y0) < 0.001
    );
    if (!isDuplicate) {
      setAnchors((prev) => [...prev, anchor]);
    }
  }

  function handleRemoveAnchor(index: number) {
    setAnchors((prev) => prev.filter((_, i) => i !== index));
  }

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const doc = await pdfjsLib.getDocument(pdfUrl).promise;
      if (cancelled) return;
      pdfDocRef.current = doc;
      renderPage(currentPageRef.current);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  // Re-render when page or scale changes
  useEffect(() => {
    if (pdfDocRef.current) renderPage(currentPage);
  }, [currentPage, scale]);

  async function renderPage(pageNum: number) {
    if (!pdfDocRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const page = await pdfDocRef.current.getPage(pageNum);
    const viewport = page.getViewport({ scale: scaleRef.current });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    fetchWords(pageNum);
  }

  function fetchWords(pageNum: number) {
    // Use cached words if available
    const cached = allWordsCache.get(pageNum);
    if (cached) {
      setWords({
        pdf_id: 0,
        page_num: pageNum - 1,
        page_width: cached.pageWidth,
        page_height: cached.pageHeight,
        words: cached.words,
      });
      return;
    }

    // Fallback to per-page API
    setLoading(true);
    fetch(`${baseUrl}/pdfs/0/pages/${pageNum - 1}/words`)
      .then((res) => res.json())
      .then((data: PageWords) => setWords(data))
      .catch((err) => {
        console.error("Failed to fetch words:", err);
        setWords(null);
      })
      .finally(() => setLoading(false));
  }

  function goToPage(delta: number) {
    setCurrentPage((prev) => {
      const next = prev + delta;
      if (next >= 1 && next <= numPages) return next;
      return prev;
    });
  }

  // Get MatchWord[] for words whose center falls inside a region
  function getMatchWordsInRegion(region: Rect): MatchWord[] {
    if (!words) return [];
    const w = words;
    if (!w) return [];
    return w.words
      .filter((word) => {
        const cx = (word.x0 + word.x1) / 2;
        const cy = (word.y0 + word.y1) / 2;
        return cx >= region.x && cx <= region.x + region.w && cy >= region.y && cy <= region.y + region.h;
      })
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
      .map((word) => ({ text: word.text, x0: word.x0, x1: word.x1 }));
  }

  // Search page words for a MatchWord[] pattern matching text AND horizontal position
  const X_TOLERANCE = 0.01;

  function findMatchWordsOnPage(pattern: MatchWord[]): number | null {
    if (!words || pattern.length === 0) return null;

    const sorted = [...words.words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const first = pattern[0];

    for (let i = 0; i <= sorted.length - pattern.length; i++) {
      const candidate = sorted[i];
      if (candidate.text !== first.text) continue;
      if (Math.abs(candidate.x0 - first.x0) > X_TOLERANCE) continue;

      let allMatch = true;
      for (let j = 1; j < pattern.length; j++) {
        const cw = sorted[i + j];
        const pw = pattern[j];
        if (cw.text !== pw.text || Math.abs(cw.x0 - pw.x0) > X_TOLERANCE) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) return sorted[i].y0;
    }
    return null;
  }

  function handleUpdateTable(updated: TableAnnotation) {
    setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  function handleDeleteTable(id: string) {
    setTables((prev) => prev.filter((t) => t.id !== id));
    setSelectedId((prev) => (prev?.type === "table" && prev.id === id ? null : prev));
  }

  function handleDeleteFooter(id: string) {
    setFooters((prev) => prev.filter((f) => f.id !== id));
    setSelectedId((prev) => (prev?.type === "footer" && prev.id === id ? null : prev));
  }

  function handleDeleteHeader(id: string) {
    setHeaders((prev) => prev.filter((h) => h.id !== id));
    setSelectedId((prev) => (prev?.type === "header" && prev.id === id ? null : prev));
  }

  function handleUpdateIgnore(updated: IgnoreAnnotation) {
    setIgnores((prev) => prev.map((ig) => (ig.id === updated.id ? updated : ig)));
  }

  function handleDeleteIgnore(id: string) {
    setIgnores((prev) => prev.filter((ig) => ig.id !== id));
    setSelectedId((prev) => (prev?.type === "ignore" && prev.id === id ? null : prev));
  }

  // Compute effective footer Y for the current page
  const footerYForPage = useMemo((): number | null => {
    let minY: number | null = null;

    for (const f of footers) {
      if (f.mode === "line") {
        minY = minY === null ? f.y : Math.min(minY, f.y);
      } else if (f.mode === "match" && f.matchWords) {
        const foundY = findMatchWordsOnPage(f.matchWords);
        if (foundY !== null) {
          minY = minY === null ? foundY : Math.min(minY, foundY);
        }
      }
    }
    return minY;
  }, [footers, words]);

  const selectedFooter = useMemo(() => {
    if (selectedId?.type !== "footer") return null;
    return footers.find((f) => f.id === selectedId.id) ?? null;
  }, [selectedId, footers]);

  // Compute effective header Y for the current page
  const headerYForPage = useMemo((): number | null => {
    let maxY: number | null = null;

    for (const h of headers) {
      if (h.mode === "line") {
        maxY = maxY === null ? h.y : Math.max(maxY, h.y);
      } else if (h.mode === "match" && h.matchWords) {
        const foundY = findMatchWordsOnPage(h.matchWords);
        if (foundY !== null) {
          maxY = maxY === null ? foundY : Math.max(maxY, foundY);
        }
      }
    }
    return maxY;
  }, [headers, words]);

  const selectedHeader = useMemo(() => {
    if (selectedId?.type !== "header") return null;
    return headers.find((h) => h.id === selectedId.id) ?? null;
  }, [selectedId, headers]);

  const selectedTable = useMemo(() => {
    if (selectedId?.type !== "table") return null;
    return tables.find((t) => t.id === selectedId.id) ?? null;
  }, [selectedId, tables]);

  const selectedIgnore = useMemo(() => {
    if (selectedId?.type !== "ignore") return null;
    return ignores.find((ig) => ig.id === selectedId.id) ?? null;
  }, [selectedId, ignores]);

  const selectedVariableRule = useMemo(() => {
    if (selectedId?.type !== "variable") return null;
    const rule = rules.find((r) => r.id === selectedId.id);
    if (!rule || rule.type !== "extract_variable") return null;
    return rule;
  }, [selectedId, rules]);

  // Tables visible on current page
  function getTableRegionForPage(table: TableAnnotation, page: number): { y: number; h: number } | null {
    const start = table.startPage;
    const end = table.endPage ?? table.startPage;

    if (page < start || page > end) return null;

    if (start === end) {
      return { y: table.region.y, h: table.region.h };
    }

    if (page === start) {
      return { y: table.region.y, h: 1 - table.region.y };
    }

    if (page === end) {
      const endY = table.endY ?? 1;
      return { y: 0, h: endY };
    }

    return { y: 0, h: 1 };
  }

  // Ignore region for a given page
  function getIgnoreRegionForPage(ig: IgnoreAnnotation, page: number): { y: number; h: number } | null {
    const start = ig.startPage;
    const end = ig.endPage ?? ig.startPage;
    if (page < start || page > end) return null;
    return { y: ig.region.y, h: ig.region.h };
  }

  const pageIgnores = useMemo(() => {
    return ignores
      .map((ig) => {
        const region = getIgnoreRegionForPage(ig, currentPage);
        if (!region) return null;
        return {
          ignore: ig,
          pageRegion: { ...ig.region, y: region.y, h: region.h },
        };
      })
      .filter((ig): ig is NonNullable<typeof ig> => ig !== null);
  }, [ignores, currentPage]);

  const activeIgnoreRegions = useMemo(
    () => pageIgnores.map((entry) => entry.pageRegion),
    [pageIgnores]
  );

  const pageTables = useMemo(() => {
    const igRegions = activeIgnoreRegions;
    const fY = footerYForPage;
    const hY = headerYForPage;

    return tables
      .map((t) => {
        const region = getTableRegionForPage(t, currentPage);
        if (!region) return null;

        let tY = region.y;
        let tBottom = region.y + region.h;

        // Start match
        if (t.startMatchWords) {
          const foundY = findMatchWordsOnPage(t.startMatchWords);
          if (foundY !== null && foundY > tY && foundY < tBottom) {
            tY = foundY;
          }
        }

        // End match
        if (t.endMatchWords) {
          const foundY = findMatchWordsOnPage(t.endMatchWords);
          if (foundY !== null && foundY > tY && foundY < tBottom) {
            tBottom = foundY;
          }
        }

        // Clamp table bottom to footer line
        if (fY !== null && tBottom > fY) {
          tBottom = fY;
          if (tBottom <= tY) return null;
        }

        // Clamp table top to header line
        if (hY !== null && tY < hY) {
          tY = hY;
          if (tBottom <= tY) return null;
        }

        // Adjust table region to exclude overlapping ignore zones
        for (const ig of igRegions) {
          if (ig.x >= t.region.x + t.region.w || ig.x + ig.w <= t.region.x) continue;

          const igBottom = ig.y + ig.h;

          if (ig.y >= tBottom || igBottom <= tY) continue;

          if (ig.y <= tY && igBottom >= tBottom) return null;

          const igMid = (ig.y + igBottom) / 2;
          const tMid = (tY + tBottom) / 2;
          if (igMid < tMid) {
            tY = Math.max(tY, igBottom);
          } else {
            tBottom = Math.min(tBottom, ig.y);
          }
        }

        const adjustedH = tBottom - tY;
        if (adjustedH < 0.01) return null;

        return {
          table: t,
          pageRegion: { ...t.region, y: tY, h: adjustedH },
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);
  }, [tables, currentPage, activeIgnoreRegions, footerYForPage, headerYForPage, words]);

  // --- Drawing handlers ---
  function getNormalizedPos(e: React.MouseEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const w = canvas.width;
    const h = canvas.height;
    const rect = canvas.getBoundingClientRect();
    const scaleX = w / rect.width;
    const scaleY = h / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    return {
      x: Math.max(0, Math.min(1, px / w)),
      y: Math.max(0, Math.min(1, py / h)),
    };
  }

  function handleOverlayClick(e: React.MouseEvent) {
    const tool = activeTool;

    // Capturing start text for a table
    if (capturingStartText) {
      if (e.button !== 0) return;
      const pos = getNormalizedPos(e);

      if (!drawStart) {
        setDrawStart(pos);
        setDrawCurrent(pos);
      } else {
        const start = drawStart;
        const x = Math.min(start.x, pos.x);
        const y = Math.min(start.y, pos.y);
        const w = Math.abs(pos.x - start.x);
        const h = Math.abs(pos.y - start.y);

        setDrawStart(null);
        setDrawCurrent(null);
        setCapturingStartText(false);

        if (w < 0.02 || h < 0.02) return;

        const region: Rect = { x, y, w, h };
        const captured = getMatchWordsInRegion(region);
        if (captured.length === 0) return;

        if (selectedTable) {
          handleUpdateTable({ ...selectedTable, startMatchWords: captured });
        }
      }
      return;
    }

    // Capturing end text for a table
    if (capturingEndText) {
      if (e.button !== 0) return;
      const pos = getNormalizedPos(e);

      if (!drawStart) {
        setDrawStart(pos);
        setDrawCurrent(pos);
      } else {
        const start = drawStart;
        const x = Math.min(start.x, pos.x);
        const y = Math.min(start.y, pos.y);
        const w = Math.abs(pos.x - start.x);
        const h = Math.abs(pos.y - start.y);

        setDrawStart(null);
        setDrawCurrent(null);
        setCapturingEndText(false);

        if (w < 0.02 || h < 0.02) return;

        const region: Rect = { x, y, w, h };
        const captured = getMatchWordsInRegion(region);
        if (captured.length === 0) return;

        if (selectedTable) {
          handleUpdateTable({ ...selectedTable, endMatchWords: captured });
        }
      }
      return;
    }

    // Footer tool
    if (tool === "footer") {
      if (e.button !== 0) return;
      const pos = getNormalizedPos(e);

      if (!drawStart) {
        setDrawStart(pos);
        setDrawCurrent(pos);
        setSelectedId(null);
      } else {
        const start = drawStart;
        const w = Math.abs(pos.x - start.x);
        const h = Math.abs(pos.y - start.y);

        if (w < 0.02 || h < 0.02) {
          const newFooter: FooterAnnotation = {
            id: `footer-${nextId++}`,
            mode: "line",
            y: start.y,
            matchRegion: null,
            matchWords: null,
          };
          setFooters((prev) => [...prev, newFooter]);
          setSelectedId({ type: "footer", id: newFooter.id });
        } else {
          const x = Math.min(start.x, pos.x);
          const y = Math.min(start.y, pos.y);
          const region: Rect = { x, y, w, h };
          const capturedWords = getMatchWordsInRegion(region);

          if (capturedWords.length === 0) {
            setDrawStart(null);
            setDrawCurrent(null);
            return;
          }

          const newFooter: FooterAnnotation = {
            id: `footer-${nextId++}`,
            mode: "match",
            y,
            matchRegion: region,
            matchWords: capturedWords,
          };
          setFooters((prev) => [...prev, newFooter]);
          setSelectedId({ type: "footer", id: newFooter.id });
        }

        setActiveTool("select");
        setDrawStart(null);
        setDrawCurrent(null);
      }
      return;
    }

    // Header tool
    if (tool === "header") {
      if (e.button !== 0) return;
      const pos = getNormalizedPos(e);

      if (!drawStart) {
        setDrawStart(pos);
        setDrawCurrent(pos);
        setSelectedId(null);
      } else {
        const start = drawStart;
        const w = Math.abs(pos.x - start.x);
        const h = Math.abs(pos.y - start.y);

        if (w < 0.02 || h < 0.02) {
          const newHeader: HeaderAnnotation = {
            id: `header-${nextId++}`,
            mode: "line",
            y: start.y,
            matchRegion: null,
            matchWords: null,
          };
          setHeaders((prev) => [...prev, newHeader]);
          setSelectedId({ type: "header", id: newHeader.id });
        } else {
          const x = Math.min(start.x, pos.x);
          const y = Math.min(start.y, pos.y);
          const region: Rect = { x, y, w, h };
          const capturedWords = getMatchWordsInRegion(region);

          if (capturedWords.length === 0) {
            setDrawStart(null);
            setDrawCurrent(null);
            return;
          }

          const newHeader: HeaderAnnotation = {
            id: `header-${nextId++}`,
            mode: "match",
            y: y + h,
            matchRegion: region,
            matchWords: capturedWords,
          };
          setHeaders((prev) => [...prev, newHeader]);
          setSelectedId({ type: "header", id: newHeader.id });
        }

        setActiveTool("select");
        setDrawStart(null);
        setDrawCurrent(null);
      }
      return;
    }

    // Variable region tool
    if (tool === "variable") {
      if (e.button !== 0) return;
      const pos = getNormalizedPos(e);

      if (!drawStart) {
        setDrawStart(pos);
        setDrawCurrent(pos);
        setSelectedId(null);
      } else {
        const start = drawStart;
        const x = Math.min(start.x, pos.x);
        const y = Math.min(start.y, pos.y);
        const w = Math.abs(pos.x - start.x);
        const h = Math.abs(pos.y - start.y);

        setDrawStart(null);
        setDrawCurrent(null);

        if (w < 0.01 || h < 0.005) return;

        const region: PdfRegion = { page: currentPage, x, y, w, h };
        // If pick was triggered programmatically (from rule editor), call the pending callback
        if (variablePickCbRef.current) {
          variablePickCbRef.current(region);
          variablePickCbRef.current = null;
        } else if (onVariableRegionSelected) {
          onVariableRegionSelected(region);
        } else {
          // Default: create an extract_variable rule stored in the template
          const name = `var${nextId}`;
          const newRule: PipelineRule = {
            type: "extract_variable",
            id: `extract_variable-${nextId++}`,
            name,
            source: "pdf_region",
            row: 0,
            col: 0,
            region,
            tolerance: 10,
            transforms: [],
          };
          setRules((prev) => [...prev, newRule]);
        }
        setActiveTool("select");
      }
      return;
    }

    if (tool !== "table" && tool !== "ignore" && tool !== "anchor") {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "CANVAS" || tag === "DIV") {
        setSelectedId(null);
      }
      return;
    }
    if (e.button !== 0) return;

    const pos = getNormalizedPos(e);

    if (!drawStart) {
      setDrawStart(pos);
      setDrawCurrent(pos);
      setSelectedId(null);
    } else {
      const start = drawStart;
      const x = Math.min(start.x, pos.x);
      const y = Math.min(start.y, pos.y);
      const w = Math.abs(pos.x - start.x);
      const h = Math.abs(pos.y - start.y);

      if (w < 0.02 || h < 0.02) {
        setDrawStart(null);
        setDrawCurrent(null);
        return;
      }

      const newRect: Rect = { x, y, w, h };
      const page = currentPage;

      if (tool === "anchor") {
        // Select all words inside the drawn area as anchors
        if (words) {
          const newAnchors: PdfAnchor[] = [];
          for (const word of words.words) {
            const cx = (word.x0 + word.x1) / 2;
            const cy = (word.y0 + word.y1) / 2;
            if (cx >= x && cx <= x + w && cy >= y && cy <= y + h) {
              const isDuplicate = anchors.some(
                (a) => a.text === word.text && Math.abs(a.x0 - word.x0) < 0.001 && Math.abs(a.y0 - word.y0) < 0.001
              );
              if (!isDuplicate) {
                newAnchors.push({ text: word.text, x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 });
              }
            }
          }
          if (newAnchors.length > 0) {
            setAnchors((prev) => [...prev, ...newAnchors]);
          }
        }
        setDrawStart(null);
        setDrawCurrent(null);
        return;
      } else if (tool === "table") {
        const overlapsIgnore = ignores.some((ig) => {
          const igEnd = ig.endPage ?? ig.startPage;
          if (page < ig.startPage || page > igEnd) return false;
          return rectsOverlap(newRect, ig.region);
        });
        if (overlapsIgnore) {
          setDrawStart(null);
          setDrawCurrent(null);
          return;
        }
        const newTable: TableAnnotation = {
          id: `table-${nextId++}`,
          region: newRect,
          columns: [],
          startPage: page,
          endPage: null,
          endY: null,
          endMatchWords: null,
          startMatchWords: null,
        };
        setTables((prev) => [...prev, newTable]);
        setSelectedId({ type: "table", id: newTable.id });
      } else {
        const overlapsTable = tables.some((t) => {
          const tEnd = t.endPage ?? t.startPage;
          if (page < t.startPage || page > tEnd) return false;
          return rectsOverlap(newRect, t.region);
        });
        if (overlapsTable) {
          setDrawStart(null);
          setDrawCurrent(null);
          return;
        }
        const newIgnore: IgnoreAnnotation = {
          id: `ignore-${nextId++}`,
          region: newRect,
          startPage: page,
          endPage: null,
          endY: null,
        };
        setIgnores((prev) => [...prev, newIgnore]);
        setSelectedId({ type: "ignore", id: newIgnore.id });
      }

      setActiveTool("select");
      setDrawStart(null);
      setDrawCurrent(null);
    }
  }

  function updateDrawCurrent() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cRect = canvas.getBoundingClientRect();
    const w = canvas.width;
    const h = canvas.height;
    const scaleX = w / cRect.width;
    const scaleY = h / cRect.height;
    setDrawCurrent({
      x: Math.max(0, Math.min(1, ((lastClientX.current - cRect.left) * scaleX) / w)),
      y: Math.max(0, Math.min(1, ((lastClientY.current - cRect.top) * scaleY) / h)),
    });
  }

  function handleOverlayMouseMove(e: React.MouseEvent) {
    lastClientX.current = e.clientX;
    lastClientY.current = e.clientY;
    if ((activeTool !== "select" || capturingEndText || capturingStartText) && drawStart) {
      updateDrawCurrent();
    }
    if (activeTool === "variable" && drawStart) {
      updateDrawCurrent();
    }
  }

  function handleScroll() {
    if (drawStart) {
      updateDrawCurrent();
    }
  }

  function handleWheel(e: React.WheelEvent) {
    if (drawStart && scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy(0, e.deltaY);
      updateDrawCurrent();
      e.preventDefault();
    }
  }

  // Keydown handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") goToPage(-1);
      if (e.key === "ArrowRight") goToPage(1);
      if (e.key === "Escape") {
        if (capturingStartTextRef.current) {
          setCapturingStartText(false);
          setDrawStart(null);
          setDrawCurrent(null);
        } else if (capturingEndTextRef.current) {
          setCapturingEndText(false);
          setDrawStart(null);
          setDrawCurrent(null);
        } else if (drawStartRef.current) {
          setDrawStart(null);
          setDrawCurrent(null);
        } else {
          // Cancel any pending variable pick
          if (variablePickCbRef.current) {
            variablePickCbRef.current = null;
          }
          setActiveTool("select");
          setSelectedId(null);
        }
      }
      if (e.key === "Delete" && selectedIdRef.current) {
        const sel = selectedIdRef.current;
        if (sel.type === "table") handleDeleteTable(sel.id);
        else if (sel.type === "ignore") handleDeleteIgnore(sel.id);
        else if (sel.type === "footer") handleDeleteFooter(sel.id);
        else if (sel.type === "header") handleDeleteHeader(sel.id);
        else if (sel.type === "variable") {
          setRules((prev) => prev.filter((r) => r.id !== sel.id));
          setSelectedId(null);
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const canvasWidth = canvasRef.current?.width ?? 0;
  const canvasHeight = canvasRef.current?.height ?? 0;

  // Phrases memo
  const phrases = useMemo(
    () => (words ? mergeWordsIntoPhrases(words.words) : []),
    [words]
  );

  // Compute variable regions from internal rules (merged with external prop)
  const internalVariableRegions = useMemo(() => {
    const fromRules = rules
      .filter((r): r is Extract<PipelineRule, { type: "extract_variable" }> =>
        r.type === "extract_variable" && r.source === "pdf_region" && !!r.region
      )
      .map((r) => ({ name: r.name, region: r.region! }));
    return variableRegions ? [...variableRegions, ...fromRules] : fromRules;
  }, [rules, variableRegions]);

  // Drawing preview render helper
  function renderDrawingPreview() {
    if (!drawStart || !drawCurrent) return null;
    const s = drawStart;
    const c = drawCurrent;
    const cw = canvasRef.current?.width ?? 0;
    const ch = canvasRef.current?.height ?? 0;

    if (capturingStartText) {
      const x = Math.min(s.x, c.x);
      const y = Math.min(s.y, c.y);
      const w = Math.abs(c.x - s.x);
      const h = Math.abs(c.y - s.y);
      return (
        <div
          className="absolute border-2 border-dashed border-teal-500 bg-teal-500/10 pointer-events-none"
          style={{
            left: `${x * cw}px`,
            top: `${y * ch}px`,
            width: `${w * cw}px`,
            height: `${h * ch}px`,
          }}
        />
      );
    }

    if (capturingEndText) {
      const x = Math.min(s.x, c.x);
      const y = Math.min(s.y, c.y);
      const w = Math.abs(c.x - s.x);
      const h = Math.abs(c.y - s.y);
      return (
        <div
          className="absolute border-2 border-dashed border-purple-500 bg-purple-500/10 pointer-events-none"
          style={{
            left: `${x * cw}px`,
            top: `${y * ch}px`,
            width: `${w * cw}px`,
            height: `${h * ch}px`,
          }}
        />
      );
    }

    if (activeTool === "footer") {
      const w = Math.abs(c.x - s.x);
      const h = Math.abs(c.y - s.y);
      const isArea = w >= 0.02 && h >= 0.02;

      return (
        <>
          <div
            className="absolute pointer-events-none"
            style={{
              left: "0px",
              top: `${s.y * ch - 1}px`,
              width: `${cw}px`,
              height: "2px",
              backgroundColor: "rgb(217, 119, 6)",
            }}
          />
          <div
            className="absolute pointer-events-none px-1.5 py-0.5 bg-amber-600 text-white text-xs rounded"
            style={{
              right: "0px",
              top: `${s.y * ch - 10}px`,
            }}
          >
            Footer {isArea ? "(match)" : "(line)"}
          </div>
          {isArea && (
            <div
              className="absolute border-2 border-dashed border-amber-500 bg-amber-500/10 pointer-events-none"
              style={{
                left: `${Math.min(s.x, c.x) * cw}px`,
                top: `${Math.min(s.y, c.y) * ch}px`,
                width: `${w * cw}px`,
                height: `${h * ch}px`,
              }}
            />
          )}
        </>
      );
    }

    if (activeTool === "header") {
      const w = Math.abs(c.x - s.x);
      const h = Math.abs(c.y - s.y);
      const isArea = w >= 0.02 && h >= 0.02;

      return (
        <>
          <div
            className="absolute pointer-events-none"
            style={{
              left: "0px",
              top: `${s.y * ch - 1}px`,
              width: `${cw}px`,
              height: "2px",
              backgroundColor: "rgb(13, 148, 136)",
            }}
          />
          <div
            className="absolute pointer-events-none px-1.5 py-0.5 bg-teal-600 text-white text-xs rounded"
            style={{
              right: "0px",
              top: `${s.y * ch + 4}px`,
            }}
          >
            Header {isArea ? "(match)" : "(line)"}
          </div>
          {isArea && (
            <div
              className="absolute border-2 border-dashed border-teal-500 bg-teal-500/10 pointer-events-none"
              style={{
                left: `${Math.min(s.x, c.x) * cw}px`,
                top: `${Math.min(s.y, c.y) * ch}px`,
                width: `${w * cw}px`,
                height: `${h * ch}px`,
              }}
            />
          )}
        </>
      );
    }

    const x = Math.min(s.x, c.x);
    const y = Math.min(s.y, c.y);
    const w = Math.abs(c.x - s.x);
    const h = Math.abs(c.y - s.y);
    return (
      <div
        className={`absolute border-2 border-dashed pointer-events-none ${
          activeTool === "anchor"
            ? "border-violet-500 bg-violet-500/10"
            : activeTool === "ignore"
              ? "border-red-500 bg-red-500/10"
              : activeTool === "variable"
                ? "border-orange-500 bg-orange-500/10"
                : "border-blue-500 bg-blue-500/10"
        }`}
        style={{
          left: `${x * cw}px`,
          top: `${y * ch}px`,
          width: `${w * cw}px`,
          height: `${h * ch}px`,
        }}
      />
    );
  }

  // Footer line effective Y helper for rendering
  function getFooterEffectiveY(f: FooterAnnotation): number | null {
    if (f.mode === "line") return f.y;
    if (f.mode === "match" && f.matchWords) {
      return findMatchWordsOnPage(f.matchWords);
    }
    return null;
  }

  // Header line effective Y helper for rendering
  function getHeaderEffectiveY(h: HeaderAnnotation): number | null {
    if (h.mode === "line") return h.y;
    if (h.mode === "match" && h.matchWords) {
      return findMatchWordsOnPage(h.matchWords);
    }
    return null;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <button
          className="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-40"
          onClick={() => goToPage(-1)}
          disabled={currentPage <= 1}
        >
          Previous
        </button>
        <span className="text-sm text-gray-600">
          Page {currentPage} / {numPages}
        </span>
        <button
          className="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-40"
          onClick={() => goToPage(1)}
          disabled={currentPage >= numPages}
        >
          Next
        </button>

        <div className="w-px h-5 bg-gray-300" />

        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          Zoom:
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={scale}
            onChange={(e) => setScale(parseFloat((e.target as HTMLInputElement).value))}
            className="w-24"
          />
          <span className="w-10">{Math.round(scale * 100)}%</span>
        </label>

        <div className="w-px h-5 bg-gray-300" />

        {/* Tools */}
        <div className="flex items-center gap-1">
          <button
            className={`px-2.5 py-1 text-sm rounded ${
              activeTool === "select"
                ? "bg-blue-100 text-blue-700"
                : "bg-gray-100 hover:bg-gray-200 text-gray-600"
            }`}
            onClick={() => setActiveTool("select")}
          >
            Select
          </button>
          <button
            className={`px-2.5 py-1 text-sm rounded ${
              activeTool === "table"
                ? "bg-blue-100 text-blue-700"
                : "bg-gray-100 hover:bg-gray-200 text-gray-600"
            }`}
            onClick={() => setActiveTool("table")}
          >
            Table
          </button>
          <button
            className={`px-2.5 py-1 text-sm rounded ${
              activeTool === "ignore"
                ? "bg-red-100 text-red-700"
                : "bg-gray-100 hover:bg-gray-200 text-gray-600"
            }`}
            onClick={() => setActiveTool("ignore")}
          >
            Ignore
          </button>
          <button
            className={`px-2.5 py-1 text-sm rounded ${
              activeTool === "footer"
                ? "bg-amber-100 text-amber-700"
                : "bg-gray-100 hover:bg-gray-200 text-gray-600"
            }`}
            onClick={() => setActiveTool("footer")}
          >
            Footer
          </button>
          <button
            className={`px-2.5 py-1 text-sm rounded ${
              activeTool === "header"
                ? "bg-teal-100 text-teal-700"
                : "bg-gray-100 hover:bg-gray-200 text-gray-600"
            }`}
            onClick={() => setActiveTool("header")}
          >
            Header
          </button>
          <button
            className={`px-2.5 py-1 text-sm rounded ${
              activeTool === "anchor"
                ? "bg-violet-100 text-violet-700"
                : "bg-gray-100 hover:bg-gray-200 text-gray-600"
            }`}
            onClick={() => {
              setActiveTool("anchor");
              setShowWords(true);
            }}
          >
            Anchor
          </button>
          <button
            className={`px-2.5 py-1 text-sm rounded ${
              activeTool === "variable"
                ? "bg-orange-100 text-orange-700"
                : "bg-gray-100 hover:bg-gray-200 text-gray-600"
            }`}
            onClick={() => setActiveTool("variable")}
          >
            Variable
          </button>
        </div>

        <div className="w-px h-5 bg-gray-300" />

        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showWords}
            onChange={(e) => setShowWords((e.target as HTMLInputElement).checked)}
          />
          Show words
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showPhrases}
            onChange={(e) => setShowPhrases((e.target as HTMLInputElement).checked)}
          />
          Show phrases
        </label>

        <div className="w-px h-5 bg-gray-300" />

        <button
          className={`px-2.5 py-1 text-sm rounded ${
            showOutput
              ? "bg-purple-100 text-purple-700"
              : "bg-gray-100 hover:bg-gray-200 text-gray-600"
          }`}
          onClick={() => setShowOutput(!showOutput)}
        >
          Output
        </button>

        <button
          className={`px-2.5 py-1 text-sm rounded ${
            showDataView
              ? "bg-indigo-100 text-indigo-700"
              : "bg-gray-100 hover:bg-gray-200 text-gray-600"
          }`}
          onClick={() => setShowDataView(!showDataView)}
        >
          XLSX
        </button>

        <div className="w-px h-5 bg-gray-300" />

        <button
          className="px-2.5 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
          onClick={exportTemplate}
          disabled={tables.length === 0 && ignores.length === 0 && footers.length === 0 && headers.length === 0 && anchors.length === 0}
        >
          Export
        </button>
        {onTemplateSave && (
          <button
            className="px-2.5 py-1 text-sm rounded bg-green-600 hover:bg-green-700 text-white"
            onClick={() => {
              const pdfTemplate: PdfTemplate = {
                type: "pdf",
                name: templateName ?? "template",
                anchors,
                extraction: { tables, ignores, footers, headers },
                rules,
              };
              onTemplateSave(pdfTemplate);
            }}
            disabled={tables.length === 0 && ignores.length === 0 && footers.length === 0 && headers.length === 0 && anchors.length === 0}
          >
            Save Template
          </button>
        )}
        <button
          className="px-2.5 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
          onClick={() => templateInputRef.current?.click()}
        >
          Import
        </button>
        <input
          ref={templateInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) importTemplate(file);
            (e.target as HTMLInputElement).value = "";
          }}
        />

        {loading && (
          <span className="text-xs text-amber-600">Extracting...</span>
        )}

        <span className="text-xs text-gray-400 ml-auto">
          {tables.length > 0 ? `${tables.length} table(s)` : ""}
          {ignores.length > 0 ? ` | ${ignores.length} ignore(s)` : ""}
          {footers.length > 0 ? ` | ${footers.length} footer(s)` : ""}
          {headers.length > 0 ? ` | ${headers.length} header(s)` : ""}
          {anchors.length > 0 ? ` | ${anchors.length} anchor(s)` : ""}
          {words ? ` | ${words.words.length} words` : ""}
        </span>
      </div>

      {/* Hint bar */}
      {activeTool === "table" && (
        <div className="px-4 py-1 bg-blue-50 text-xs text-blue-600 border-b border-blue-100 shrink-0">
          {drawStart
            ? "Click to set the second corner. Press Escape to cancel."
            : "Click to set the first corner of the table area."}
        </div>
      )}
      {activeTool === "footer" && (
        <div className="px-4 py-1 bg-amber-50 text-xs text-amber-600 border-b border-amber-100 shrink-0">
          {drawStart
            ? "Click nearby for a line footer, or farther to select a match area. Escape to cancel."
            : "Click to set the footer line. Or click twice to select a text-match area."}
        </div>
      )}
      {activeTool === "header" && (
        <div className="px-4 py-1 bg-teal-50 text-xs text-teal-600 border-b border-teal-100 shrink-0">
          {drawStart
            ? "Click nearby for a line header, or farther to select a match area. Escape to cancel."
            : "Click to set the header line (ignores everything above). Or click twice to select a text-match area."}
        </div>
      )}
      {selectedFooter && (
        <div className="px-4 py-1 bg-amber-50 text-xs text-amber-600 border-b border-amber-100 shrink-0 flex items-center gap-3">
          <span>
            Footer ({selectedFooter.mode === "line" ? "line" : "text match"}) at {Math.round(selectedFooter.y * 100)}%.
            {selectedFooter.mode === "match" && selectedFooter.matchWords ? ` Text: "${selectedFooter.matchWords.map((w) => w.text).join(" ")}"` : ""}
          </span>
          <button
            className="px-2 py-0.5 bg-red-500 text-white text-xs rounded hover:bg-red-600"
            onClick={() => handleDeleteFooter(selectedFooter.id)}
          >
            Delete
          </button>
        </div>
      )}
      {selectedHeader && (
        <div className="px-4 py-1 bg-teal-50 text-xs text-teal-600 border-b border-teal-100 shrink-0 flex items-center gap-3">
          <span>
            Header ({selectedHeader.mode === "line" ? "line" : "text match"}) at {Math.round(selectedHeader.y * 100)}%.
            {selectedHeader.mode === "match" && selectedHeader.matchWords ? ` Text: "${selectedHeader.matchWords.map((w: MatchWord) => w.text).join(" ")}"` : ""}
          </span>
          <button
            className="px-2 py-0.5 bg-red-500 text-white text-xs rounded hover:bg-red-600"
            onClick={() => handleDeleteHeader(selectedHeader.id)}
          >
            Delete
          </button>
        </div>
      )}
      {activeTool === "anchor" && (
        <div className="px-4 py-1 bg-violet-50 text-xs text-violet-600 border-b border-violet-100 shrink-0">
          Clique em uma palavra ou arraste uma área para adicionar âncoras de detecção.
        </div>
      )}
      {activeTool === "variable" && (
        <div className="px-4 py-1 bg-orange-50 text-xs text-orange-600 border-b border-orange-100 shrink-0">
          {drawStart
            ? "Clique para definir o segundo canto da região. Escape para cancelar."
            : "Clique para definir o primeiro canto da região de variável."}
        </div>
      )}
      {activeTool === "ignore" && (
        <div className="px-4 py-1 bg-red-50 text-xs text-red-600 border-b border-red-100 shrink-0">
          {drawStart
            ? "Click to set the second corner. Press Escape to cancel."
            : "Click to set the first corner of the ignore area."}
        </div>
      )}
      {selectedIgnore && (
        <div className="px-4 py-1 bg-red-50 text-xs text-red-600 border-b border-red-100 shrink-0 flex items-center gap-3">
          <span>Ignore zone selected. Delete to remove.</span>
          <div className="w-px h-4 bg-red-200" />
          {selectedIgnore.endPage !== null ? (
            <>
              <span className="text-xs">
                Replicated on pages {selectedIgnore.startPage}–{selectedIgnore.endPage}
              </span>
              <button
                className="px-2 py-0.5 bg-gray-500 text-white text-xs rounded hover:bg-gray-600"
                onClick={() => {
                  handleUpdateIgnore({ ...selectedIgnore, endPage: null });
                }}
              >
                Single page only
              </button>
            </>
          ) : (
            <button
              className="px-2 py-0.5 bg-red-600 text-white text-xs rounded hover:bg-red-700"
              onClick={() => {
                const ig = selectedIgnore;
                const wouldOverlap = tables.some((t) => {
                  const tEnd = t.endPage ?? t.startPage;
                  if (numPages < t.startPage || 1 > tEnd) return false;
                  return rectsOverlap(ig.region, t.region);
                });
                if (wouldOverlap) return;
                handleUpdateIgnore({ ...ig, endPage: numPages });
              }}
            >
              Replicate on all pages
            </button>
          )}
        </div>
      )}
      {capturingStartText && (
        <div className="px-4 py-1 bg-teal-50 text-xs text-teal-600 border-b border-teal-100 shrink-0">
          {drawStart
            ? "Click to set the second corner. Escape to cancel."
            : "Select the text that marks the START of the table. Click the first corner."}
        </div>
      )}
      {capturingEndText && (
        <div className="px-4 py-1 bg-purple-50 text-xs text-purple-600 border-b border-purple-100 shrink-0">
          {drawStart
            ? "Click to set the second corner of the text area. Escape to cancel."
            : "Select the text that marks the end of the table. Click the first corner."}
        </div>
      )}
      {selectedTable && !capturingEndText && !capturingStartText && (
        <div className="px-4 py-1 bg-green-50 text-xs text-green-600 border-b border-green-100 shrink-0 flex items-center gap-3">
          <span>Click inside table to add column dividers. Right-click divider to remove. Delete to remove table.</span>
          <button
            className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
            onClick={() => {
              const t = selectedTable;
              if (!words) return;
              const pageRegion = pageTables.find((e) => e.table.id === t.id)?.pageRegion;
              if (!pageRegion) return;
              const tw = getTableWords(words.words, pageRegion, activeIgnoreRegions, footerYForPage, headerYForPage);
              const cols = detectColumns(tw, pageRegion);
              if (cols.length > 0) {
                handleUpdateTable({ ...t, columns: cols });
              }
            }}
          >
            Auto columns
          </button>
          <div className="w-px h-4 bg-green-200" />
          {selectedTable.endPage !== null ? (
            <>
              <span className="text-xs">
                Pages {selectedTable.startPage}–{selectedTable.endPage}
                {selectedTable.endY !== null ? ` (ends at ${Math.round(selectedTable.endY! * 100)}%)` : ""}
                {selectedTable.startMatchWords ? ` | start text: "${selectedTable.startMatchWords.map((w) => w.text).join(" ")}"` : ""}
                {selectedTable.endMatchWords ? ` | end text: "${selectedTable.endMatchWords.map((w) => w.text).join(" ")}"` : ""}
              </span>
              <button
                className="px-2 py-0.5 bg-amber-600 text-white text-xs rounded hover:bg-amber-700"
                onClick={() => {
                  handleUpdateTable({ ...selectedTable, endPage: currentPage, endY: 0.5 });
                }}
              >
                Set end here
              </button>
              <button
                className="px-2 py-0.5 bg-purple-600 text-white text-xs rounded hover:bg-purple-700"
                onClick={() => setCapturingEndText(true)}
              >
                Set end by text
              </button>
              {selectedTable.endMatchWords && (
                <button
                  className="px-2 py-0.5 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                  onClick={() => {
                    handleUpdateTable({ ...selectedTable, endMatchWords: null });
                  }}
                >
                  Clear end text
                </button>
              )}
              <button
                className="px-2 py-0.5 bg-teal-600 text-white text-xs rounded hover:bg-teal-700"
                onClick={() => setCapturingStartText(true)}
              >
                Set start by text
              </button>
              {selectedTable.startMatchWords && (
                <>
                  <span className="text-xs">start: "{selectedTable.startMatchWords.map((w) => w.text).join(" ")}"</span>
                  <button
                    className="px-2 py-0.5 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                    onClick={() => {
                      handleUpdateTable({ ...selectedTable, startMatchWords: null });
                    }}
                  >
                    Clear start text
                  </button>
                </>
              )}
              <button
                className="px-2 py-0.5 bg-gray-500 text-white text-xs rounded hover:bg-gray-600"
                onClick={() => {
                  handleUpdateTable({ ...selectedTable, endPage: null, endY: null, endMatchWords: null, startMatchWords: null });
                }}
              >
                Single page
              </button>
            </>
          ) : (
            <button
              className="px-2 py-0.5 bg-green-600 text-white text-xs rounded hover:bg-green-700"
              onClick={() => {
                const t = selectedTable;
                const wouldOverlap = ignores.some((ig) => {
                  const igEnd = ig.endPage ?? ig.startPage;
                  if (numPages < ig.startPage || 1 > igEnd) return false;
                  return rectsOverlap(t.region, ig.region);
                });
                if (wouldOverlap) return;
                handleUpdateTable({ ...t, endPage: numPages, endY: null });
              }}
            >
              Extend to all pages
            </button>
          )}
        </div>
      )}

      {/* XLSX DataView tab — replaces PDF view, state preserved via hidden */}
      <div className={showDataView ? "flex-1 min-h-0" : "hidden"}>
        <DataView.Root
          availableTables={availableTables}
          externalVars={resolvedPdfVariables}
          className="h-full"
        >
          <DataView.SourceBar />
          <DataView.SheetTabs />
          <DataView.Content />
        </DataView.Root>
      </div>

      {/* Main content: config panel + PDF viewer + output panel */}
      <div className={showDataView ? "hidden" : "flex-1 flex min-h-0"}>

        {/* Left config panel */}
        {selectedId && (
          <div className="w-56 shrink-0 bg-white border-r border-gray-200 overflow-auto">
            <div className="px-3 py-2 border-b border-gray-200">
              <span className="text-sm font-medium text-gray-700">Properties</span>
            </div>

            {/* Table config */}
            {selectedId.type === "table" && selectedTable && (
              <div className="p-3 flex flex-col gap-3">
                <div className="text-xs text-gray-500">
                  Table — p{selectedTable.startPage}
                  {(selectedTable.endPage ?? selectedTable.startPage) !== selectedTable.startPage ? `–${selectedTable.endPage}` : ""}
                </div>

                <div className="text-xs text-gray-500">
                  {selectedTable.columns.length} dividers — {selectedTable.columns.length + 1} columns
                </div>

                {selectedTable.columns.length > 0 && (
                  <>
                    <div className="text-xs font-medium text-gray-600 mt-1">Dividers</div>
                    <div className="flex flex-col gap-1">
                      {[...selectedTable.columns]
                        .sort((a, b) => {
                          const pa = typeof a === "number" ? a : a.position;
                          const pb = typeof b === "number" ? b : b.position;
                          return pa - pb;
                        })
                        .map((col, idx) => {
                          const pos = typeof col === "number" ? col : col.position;
                          const split = typeof col === "number" ? true : col.splitPhrases;
                          return (
                            <label key={pos} className="flex items-center gap-2 text-xs text-gray-700">
                              <input
                                type="checkbox"
                                checked={split}
                                onChange={(e) => {
                                  const newCols = selectedTable.columns.map((c) => {
                                    const cp = typeof c === "number" ? c : c.position;
                                    if (cp === pos) {
                                      return { position: cp, splitPhrases: (e.target as HTMLInputElement).checked };
                                    }
                                    return typeof c === "number" ? { position: c, splitPhrases: true } : c;
                                  });
                                  handleUpdateTable({ ...selectedTable, columns: newCols });
                                }}
                              />
                              <span
                                className={`w-2 h-2 rounded-full ${split ? "bg-blue-500" : "bg-orange-500"}`}
                              />
                              Col {idx + 1}|{idx + 2}
                              <span className="text-gray-400 ml-auto">{Math.round(pos * 100)}%</span>
                            </label>
                          );
                        })}
                    </div>
                    <p className="text-xs text-gray-400">
                      Uncheck to keep phrases intact across that divider. Orange = no split.
                    </p>
                  </>
                )}

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-600">Line merge distance (px)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={selectedTable.lineMergeDistance ?? 0}
                    className="w-full text-xs border rounded px-2 py-1"
                    onChange={(e) => {
                      handleUpdateTable({ ...selectedTable, lineMergeDistance: Number((e.target as HTMLInputElement).value) || 0 });
                    }}
                  />
                  <p className="text-xs text-gray-400">
                    Lines within this distance (PDF points) are merged into one row.
                  </p>
                </div>
              </div>
            )}

            {/* Ignore config */}
            {selectedId.type === "ignore" && (
              <div className="p-3">
                <div className="text-xs text-gray-500">Ignore zone</div>
              </div>
            )}

            {/* Footer config */}
            {selectedId.type === "footer" && (
              <div className="p-3">
                <div className="text-xs text-gray-500">Footer annotation</div>
              </div>
            )}

            {/* Header config */}
            {selectedId.type === "header" && (
              <div className="p-3">
                <div className="text-xs text-gray-500">Header annotation (ignores everything above)</div>
              </div>
            )}

            {/* Variable config */}
            {selectedId.type === "variable" && selectedVariableRule && (
              <div className="p-3 flex flex-col gap-3">
                <div className="text-xs text-gray-500">
                  Variável — p{selectedVariableRule.region?.page}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-600">Nome</label>
                  <input
                    type="text"
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono"
                    value={selectedVariableRule.name}
                    onChange={(e) => {
                      const newName = (e.target as HTMLInputElement).value.replace(/[^a-zA-Z0-9_]/g, "_");
                      setRules((prev) =>
                        prev.map((r) =>
                          r.id === selectedVariableRule.id ? { ...r, name: newName } : r
                        )
                      );
                    }}
                  />
                  <p className="text-[10px] text-gray-400">Use como {"{{"}{selectedVariableRule.name}{"}}"} nas regras</p>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-600">Preview</label>
                  <div className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-gray-50 text-gray-700 min-h-[28px] break-all">
                    {resolvedPdfVariables[selectedVariableRule.name]
                      ? <span className="text-orange-700 font-medium">"{resolvedPdfVariables[selectedVariableRule.name]}"</span>
                      : <span className="text-gray-400 italic">vazio</span>
                    }
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-600">Tolerância (px)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                    value={selectedVariableRule.tolerance ?? 10}
                    onChange={(e) => {
                      const tol = Number((e.target as HTMLInputElement).value) || 0;
                      setRules((prev) =>
                        prev.map((r) =>
                          r.id === selectedVariableRule.id ? { ...r, tolerance: tol } : r
                        )
                      );
                    }}
                  />
                  <p className="text-[10px] text-gray-400">Buffer para compensar variações de posição entre arquivos.</p>
                </div>

                <div className="border-t border-gray-100 pt-2">
                  <VariableTransformPipeline
                    transforms={selectedVariableRule.transforms ?? []}
                    onChange={(transforms) => {
                      setRules((prev) =>
                        prev.map((r) =>
                          r.id === selectedVariableRule.id ? { ...r, transforms } : r
                        )
                      );
                    }}
                  />
                </div>

                <button
                  className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                  onClick={() => {
                    setRules((prev) => prev.filter((r) => r.id !== selectedVariableRule.id));
                    setSelectedId(null);
                  }}
                >
                  Remover variável
                </button>
              </div>
            )}
          </div>
        )}

        {/* Anchors panel */}
        {anchors.length > 0 && (
          <div className="w-56 shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
            <div className="p-3 border-b border-gray-200">
              <div className="text-xs font-medium text-gray-700">Anchors ({anchors.length})</div>
            </div>
            <div className="flex flex-col">
              {anchors.map((anchor, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-gray-100 hover:bg-violet-50 group"
                >
                  <span className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
                  <span className="flex-1 truncate font-medium text-gray-700" title={anchor.text}>
                    "{anchor.text}"
                  </span>
                  <span className="text-gray-400 text-[10px]">
                    ({(anchor.x0 * 100).toFixed(0)},{(anchor.y0 * 100).toFixed(0)})
                  </span>
                  <button
                    className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleRemoveAnchor(idx)}
                    title="Remove anchor"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PDF + overlay */}
        <div
          className="flex-1 overflow-auto bg-gray-100 flex justify-center p-4"
          ref={scrollContainerRef}
          onScroll={handleScroll}
        >
          <div
            className="relative inline-block shadow-lg"
            style={{
              cursor: activeTool !== "select" || capturingEndText || capturingStartText ? "crosshair" : "default",
            }}
            onClick={handleOverlayClick}
            onMouseMove={handleOverlayMouseMove}
            onWheel={handleWheel}
          >
            <canvas ref={canvasRef} className="block" />

            {/* Overlay layer */}
            <div
              ref={overlayRef}
              className="absolute top-0 left-0 pointer-events-none"
              style={{
                width: `${canvasRef.current?.width ?? 0}px`,
                height: `${canvasRef.current?.height ?? 0}px`,
              }}
            >
              {/* Word boxes */}
              {showWords && words && words.words.map((word, idx) => {
                const isAnchored = anchors.some(
                  (a) => a.text === word.text && Math.abs(a.x0 - word.x0) < 0.001 && Math.abs(a.y0 - word.y0) < 0.001
                );
                return (
                  <div
                    key={idx}
                    className={`absolute pointer-events-auto transition-colors ${
                      isAnchored
                        ? "border-2 border-violet-500 bg-violet-500/20"
                        : activeTool === "anchor"
                          ? "border border-red-400/50 bg-red-500/5 hover:bg-violet-500/20 hover:border-violet-500/60 cursor-pointer"
                          : "border border-red-400/50 bg-red-500/5 hover:bg-blue-500/20 hover:border-blue-500/60"
                    }`}
                    style={{
                      left: `${word.x0 * (canvasRef.current?.width ?? 0)}px`,
                      top: `${word.y0 * (canvasRef.current?.height ?? 0)}px`,
                      width: `${(word.x1 - word.x0) * (canvasRef.current?.width ?? 0)}px`,
                      height: `${(word.y1 - word.y0) * (canvasRef.current?.height ?? 0)}px`,
                    }}
                    onMouseEnter={() => setHoveredWord(word)}
                    onMouseLeave={() => setHoveredWord(null)}
                    onClick={(e) => {
                      if (activeTool === "anchor") {
                        e.stopPropagation();
                        handleAddAnchor(word);
                      }
                    }}
                    title={word.text}
                  />
                );
              })}

              {/* Phrase boxes */}
              {showPhrases && words && phrases.map((phrase, idx) => (
                <div
                  key={idx}
                  className="absolute border border-cyan-500/60 bg-cyan-500/8 pointer-events-auto"
                  style={{
                    left: `${phrase.x0 * (canvasRef.current?.width ?? 0)}px`,
                    top: `${phrase.y0 * (canvasRef.current?.height ?? 0)}px`,
                    width: `${(phrase.x1 - phrase.x0) * (canvasRef.current?.width ?? 0)}px`,
                    height: `${(phrase.y1 - phrase.y0) * (canvasRef.current?.height ?? 0)}px`,
                  }}
                  title={phrase.text}
                />
              ))}

              {/* Drawing preview */}
              {renderDrawingPreview()}

              {/* Table annotations for current page */}
              {pageTables.map((entry) => (
                <TableOverlay
                  key={entry.table.id}
                  table={entry.table}
                  pageRegion={entry.pageRegion}
                  canvasWidth={canvasRef.current?.width ?? 0}
                  canvasHeight={canvasRef.current?.height ?? 0}
                  words={words?.words ?? []}
                  ignoreRegions={activeIgnoreRegions}
                  footerY={footerYForPage}
                  headerY={headerYForPage}
                  onUpdate={handleUpdateTable}
                  onDelete={handleDeleteTable}
                  selected={selectedId?.type === "table" && selectedId?.id === entry.table.id}
                  onSelect={() => setSelectedId({ type: "table", id: entry.table.id })}
                  isMultiPage={(entry.table.endPage ?? entry.table.startPage) !== entry.table.startPage}
                  currentPage={currentPage}
                  interactive={activeTool === "select" && !capturingEndText && !capturingStartText}
                  pageHeight={words?.page_height ?? 792}
                />
              ))}

              {/* Table end delimiter line (draggable) */}
              {selectedTable && selectedTable.endPage === currentPage && selectedTable.endY !== null && (() => {
                const t = selectedTable;
                const cw = canvasRef.current?.width ?? 0;
                const ch = canvasRef.current?.height ?? 0;
                const y = t.endY! * ch;
                return (
                  <div
                    className="absolute pointer-events-auto"
                    style={{
                      left: `${t.region.x * cw}px`,
                      top: `${y - 2}px`,
                      width: `${t.region.w * cw}px`,
                      height: "4px",
                      cursor: "row-resize",
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const startY = e.clientY;
                      const startEndY = t.endY!;
                      const canvas = canvasRef.current;
                      if (!canvas) return;
                      const cRect = canvas.getBoundingClientRect();
                      const scaleY = canvas.height / cRect.height;

                      function onMove(ev: MouseEvent) {
                        const canvas = canvasRef.current;
                        if (!canvas) return;
                        const dy = (ev.clientY - startY) * scaleY;
                        const newEndY = Math.max(0, Math.min(1, startEndY + dy / canvas.height));
                        handleUpdateTable({ ...t, endY: newEndY });
                      }
                      function onUp() {
                        document.removeEventListener("mousemove", onMove);
                        document.removeEventListener("mouseup", onUp);
                      }
                      document.addEventListener("mousemove", onMove);
                      document.addEventListener("mouseup", onUp);
                    }}
                  >
                    <div className="w-full h-0.5 bg-red-500" />
                    <div className="absolute -right-16 -top-2.5 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded whitespace-nowrap">
                      End
                    </div>
                  </div>
                );
              })()}

              {/* Ignore annotations for current page */}
              {pageIgnores.map((entry) => (
                <IgnoreOverlay
                  key={entry.ignore.id}
                  ignore={entry.ignore}
                  pageRegion={entry.pageRegion}
                  canvasWidth={canvasRef.current?.width ?? 0}
                  canvasHeight={canvasRef.current?.height ?? 0}
                  selected={selectedId?.type === "ignore" && selectedId?.id === entry.ignore.id}
                  onSelect={() => setSelectedId({ type: "ignore", id: entry.ignore.id })}
                  onUpdate={handleUpdateIgnore}
                  onDelete={handleDeleteIgnore}
                  isMultiPage={(entry.ignore.endPage ?? entry.ignore.startPage) !== entry.ignore.startPage}
                  currentPage={currentPage}
                  interactive={activeTool === "select" && !capturingEndText && !capturingStartText}
                />
              ))}

              {/* Variable region overlays */}
              {internalVariableRegions.length > 0 && internalVariableRegions
                .filter((v) => v.region.page === currentPage)
                .map((v, idx) => {
                  const cw = canvasRef.current?.width ?? 0;
                  const ch = canvasRef.current?.height ?? 0;
                  // Only rules-based variables (with id) are selectable
                  const ruleId = rules.find((r) => r.type === "extract_variable" && r.name === v.name && r.source === "pdf_region")?.id;
                  const isSelected = ruleId !== undefined && selectedId?.type === "variable" && selectedId.id === ruleId;
                  return (
                    <React.Fragment key={idx}>
                      <div
                        className={`absolute border-2 bg-orange-400/10 pointer-events-auto ${
                          isSelected ? "border-orange-600 ring-2 ring-orange-400" : "border-orange-400"
                        } ${ruleId ? "cursor-pointer hover:bg-orange-400/20" : "pointer-events-none"}`}
                        style={{
                          left: `${v.region.x * cw}px`,
                          top: `${v.region.y * ch}px`,
                          width: `${v.region.w * cw}px`,
                          height: `${v.region.h * ch}px`,
                        }}
                        onClick={(e) => {
                          if (ruleId) {
                            e.stopPropagation();
                            setSelectedId({ type: "variable", id: ruleId });
                          }
                        }}
                      />
                      <div
                        className={`absolute px-1 py-0.5 text-white text-[9px] rounded font-mono pointer-events-none ${
                          isSelected ? "bg-orange-600" : "bg-orange-500"
                        }`}
                        style={{
                          left: `${v.region.x * cw}px`,
                          top: `${Math.max(0, v.region.y * ch - 16)}px`,
                        }}
                      >
                        {"{{"}{v.name}{"}}"}
                      </div>
                    </React.Fragment>
                  );
                })}

              {/* Footer lines */}
              {footers.map((f) => {
                const effectiveY = getFooterEffectiveY(f);
                const isActive = effectiveY !== null;
                const lineY = effectiveY ?? f.y;
                const isSel = selectedId?.type === "footer" && selectedId?.id === f.id;
                const ch = canvasRef.current?.height ?? 0;
                const cw = canvasRef.current?.width ?? 0;

                return (
                  <React.Fragment key={f.id}>
                    {/* Footer line */}
                    <div
                      className="absolute pointer-events-auto"
                      style={{
                        left: "0px",
                        top: `${lineY * ch - 2}px`,
                        width: `${cw}px`,
                        height: "4px",
                        cursor: "pointer",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId({ type: "footer", id: f.id });
                      }}
                    >
                      <div
                        className="w-full h-0.5"
                        style={{
                          backgroundColor: isActive
                            ? isSel ? "rgb(217, 119, 6)" : "rgb(245, 158, 11)"
                            : "rgb(209, 213, 219)",
                          borderTop: isSel ? "1px dashed rgb(217, 119, 6)" : undefined,
                          borderBottom: isSel ? "1px dashed rgb(217, 119, 6)" : undefined,
                        }}
                      />
                    </div>
                    {/* Footer label */}
                    <div
                      className={`absolute pointer-events-auto px-1.5 py-0.5 text-xs text-white rounded cursor-pointer ${
                        isActive ? "bg-amber-600" : "bg-gray-400"
                      }`}
                      style={{
                        right: "0px",
                        top: `${lineY * ch - 18}px`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId({ type: "footer", id: f.id });
                      }}
                    >
                      Footer {f.mode === "match" ? "(match)" : ""}
                      {!isActive ? " \u2717" : ""}
                      <button
                        className="ml-1.5 hover:text-red-200"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFooter(f.id);
                        }}
                      >
                        x
                      </button>
                    </div>
                    {/* Footer shaded area */}
                    {isActive && (
                      <div
                        className="absolute pointer-events-none bg-amber-500/5"
                        style={{
                          left: "0px",
                          top: `${lineY * ch}px`,
                          width: `${cw}px`,
                          height: `${(1 - lineY) * ch}px`,
                        }}
                      />
                    )}
                  </React.Fragment>
                );
              })}

              {/* Header lines */}
              {headers.map((h) => {
                const effectiveY = getHeaderEffectiveY(h);
                const isActive = effectiveY !== null;
                const lineY = effectiveY ?? h.y;
                const isSel = selectedId?.type === "header" && selectedId?.id === h.id;
                const ch = canvasRef.current?.height ?? 0;
                const cw = canvasRef.current?.width ?? 0;

                return (
                  <React.Fragment key={h.id}>
                    {/* Header line */}
                    <div
                      className="absolute pointer-events-auto"
                      style={{
                        left: "0px",
                        top: `${lineY * ch - 2}px`,
                        width: `${cw}px`,
                        height: "4px",
                        cursor: "pointer",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId({ type: "header", id: h.id });
                      }}
                    >
                      <div
                        className="w-full h-0.5"
                        style={{
                          backgroundColor: isActive
                            ? isSel ? "rgb(13, 148, 136)" : "rgb(20, 184, 166)"
                            : "rgb(209, 213, 219)",
                          borderTop: isSel ? "1px dashed rgb(13, 148, 136)" : undefined,
                          borderBottom: isSel ? "1px dashed rgb(13, 148, 136)" : undefined,
                        }}
                      />
                    </div>
                    {/* Header label */}
                    <div
                      className={`absolute pointer-events-auto px-1.5 py-0.5 text-xs text-white rounded cursor-pointer ${
                        isActive ? "bg-teal-600" : "bg-gray-400"
                      }`}
                      style={{
                        right: "0px",
                        top: `${lineY * ch + 4}px`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId({ type: "header", id: h.id });
                      }}
                    >
                      Header {h.mode === "match" ? "(match)" : ""}
                      {!isActive ? " \u2717" : ""}
                      <button
                        className="ml-1.5 hover:text-red-200"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteHeader(h.id);
                        }}
                      >
                        x
                      </button>
                    </div>
                    {/* Header shaded area */}
                    {isActive && (
                      <div
                        className="absolute pointer-events-none bg-teal-500/5"
                        style={{
                          left: "0px",
                          top: "0px",
                          width: `${cw}px`,
                          height: `${lineY * ch}px`,
                        }}
                      />
                    )}
                  </React.Fragment>
                );
              })}

            </div>
          </div>
        </div>

        {/* Output panel */}
        {showOutput && (
          <div className="w-96 shrink-0">
            <OutputPanel
              tables={tables}
              ignores={ignores}
              footers={footers}
              headers={headers}
              allWords={allWordsCache}
              isLoading={loading}
              onSendToDataView={onSendToDataView}
            />
          </div>
        )}

      </div>

      {/* Info bar */}
      {hoveredWord && (
        <div className="px-4 py-1.5 bg-white border-t border-gray-200 text-sm text-gray-600 shrink-0">
          <span className="font-medium">"{hoveredWord.text}"</span>
          {" — "}
          x0: {hoveredWord.x0.toFixed(4)}, y0: {hoveredWord.y0.toFixed(4)},
          x1: {hoveredWord.x1.toFixed(4)}, y1: {hoveredWord.y1.toFixed(4)}
          {" | "}
          font: {hoveredWord.fontname}, size: {hoveredWord.size.toFixed(1)}
        </div>
      )}
    </div>
  );
}
