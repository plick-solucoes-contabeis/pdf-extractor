import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
  },
  optimizeDeps: {
    include: ["@tanstack/react-virtual", "xlsx"],
  },
  resolve: {
    alias: {
      "@pdf-extractor/types": path.resolve(__dirname, "../registry/core/types/types.ts"),
      "@pdf-extractor/rules": path.resolve(__dirname, "../registry/core/rules/rules.ts"),
      "@pdf-extractor/matching": path.resolve(__dirname, "../registry/core/matching/matching.ts"),
      "@pdf-extractor/utils": path.resolve(__dirname, "src/lib/cn.ts"),
      "@pdf-extractor/data-table": path.resolve(__dirname, "../registry/react/data-table/data-table.tsx"),
      "@pdf-extractor/rules-panel": path.resolve(__dirname, "../registry/react/rules-panel/rules-panel.tsx"),
      "@pdf-extractor/data-view": path.resolve(__dirname, "../registry/react/data-view/data-view.tsx"),
      "@pdf-extractor/xlsx-import": path.resolve(__dirname, "../registry/react/xlsx-import/xlsx-import.ts"),
      "@pdf-extractor/ui/select": path.resolve(__dirname, "src/lib/ui/select.tsx"),
      "@pdf-extractor/ui/input": path.resolve(__dirname, "src/lib/ui/input.tsx"),
      "@pdf-extractor/ui/label": path.resolve(__dirname, "src/lib/ui/label.tsx"),
      "@pdf-extractor/ui/checkbox": path.resolve(__dirname, "src/lib/ui/checkbox.tsx"),
    },
  },
});
