import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8120",
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ["@tanstack/react-virtual", "xlsx", "pdfjs-dist"],
  },
  resolve: {
    alias: {
      "@pdf-extractor/types": path.resolve(__dirname, "../registry/core/types/types.ts"),
      "@pdf-extractor/rules": path.resolve(__dirname, "../registry/core/rules/rules.ts"),
      "@pdf-extractor/extract": path.resolve(__dirname, "../registry/core/extract/extract.ts"),
      "@pdf-extractor/matching": path.resolve(__dirname, "../registry/core/matching/matching.ts"),
      "@pdf-extractor/utils": path.resolve(__dirname, "src/lib/cn.ts"),
      "@pdf-extractor/data-table": path.resolve(__dirname, "../registry/react/data-table/data-table.tsx"),
      "@pdf-extractor/rules-panel": path.resolve(__dirname, "../registry/react/rules-panel/rules-panel.tsx"),
      "@pdf-extractor/data-view": path.resolve(__dirname, "../registry/react/data-view/data-view.tsx"),
      "@pdf-extractor/xlsx-import": path.resolve(__dirname, "../registry/react/xlsx-import/xlsx-import.ts"),
      "@pdf-extractor/table-overlay": path.resolve(__dirname, "../registry/react/table-overlay/table-overlay.tsx"),
      "@pdf-extractor/ignore-overlay": path.resolve(__dirname, "../registry/react/ignore-overlay/ignore-overlay.tsx"),
      "@pdf-extractor/output-panel": path.resolve(__dirname, "../registry/react/output-panel/output-panel.tsx"),
      "@pdf-extractor/pdf-viewer": path.resolve(__dirname, "../registry/react/pdf-viewer/pdf-viewer.tsx"),
      "@pdf-extractor/ui/select": path.resolve(__dirname, "src/lib/ui/select.tsx"),
      "@pdf-extractor/ui/input": path.resolve(__dirname, "src/lib/ui/input.tsx"),
      "@pdf-extractor/ui/label": path.resolve(__dirname, "src/lib/ui/label.tsx"),
      "@pdf-extractor/ui/checkbox": path.resolve(__dirname, "src/lib/ui/checkbox.tsx"),
    },
  },
});
