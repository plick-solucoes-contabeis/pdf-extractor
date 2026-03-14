import path from "node:path";
import type { PdfExtractorConfig } from "./config.js";

/**
 * Import alias mapping: @pdf-extractor/<alias> → resolved path
 *
 * The registry files use markers like:
 *   import { X } from "@pdf-extractor/types"
 *   import { Y } from "@pdf-extractor/ui/input"
 *
 * This transformer rewrites them to relative paths based on
 * the consumer's pdf-extractor.json aliases.
 */

type AliasMap = Record<string, string>;

function buildAliasMap(config: PdfExtractorConfig): AliasMap {
  return {
    "@pdf-extractor/types": `${config.aliases.coreDir}/types`,
    "@pdf-extractor/rules": `${config.aliases.coreDir}/rules`,
    "@pdf-extractor/extract": `${config.aliases.coreDir}/extract`,
    "@pdf-extractor/matching": `${config.aliases.coreDir}/matching`,
    "@pdf-extractor/utils": `${config.aliases.coreDir}/utils/cn`,
    "@pdf-extractor/data-table": `${config.aliases.componentsDir}/data-table/data-table`,
    "@pdf-extractor/rules-panel": `${config.aliases.componentsDir}/rules-panel/rules-panel`,
    "@pdf-extractor/xlsx-import": `${config.aliases.componentsDir}/xlsx-import/xlsx-import`,
    "@pdf-extractor/data-view": `${config.aliases.componentsDir}/data-view/data-view`,
    "@pdf-extractor/table-overlay": `${config.aliases.componentsDir}/table-overlay/table-overlay`,
    "@pdf-extractor/ignore-overlay": `${config.aliases.componentsDir}/ignore-overlay/ignore-overlay`,
    "@pdf-extractor/output-panel": `${config.aliases.componentsDir}/output-panel/output-panel`,
    "@pdf-extractor/pdf-viewer": `${config.aliases.componentsDir}/pdf-viewer/pdf-viewer`,
  };
}

function buildUiAliasPrefix(config: PdfExtractorConfig): string {
  return config.aliases.uiDir;
}

/**
 * Rewrite @pdf-extractor/* imports in source code to relative paths.
 *
 * @param source - The file source code
 * @param targetFilePath - The absolute target path for this file (to compute relative imports)
 * @param projectRoot - The project root directory
 * @param config - The pdf-extractor.json config
 */
export function rewriteImports(
  source: string,
  targetFilePath: string,
  projectRoot: string,
  config: PdfExtractorConfig
): string {
  const aliasMap = buildAliasMap(config);
  const uiPrefix = buildUiAliasPrefix(config);
  const targetDir = path.dirname(targetFilePath);

  return source.replace(
    /from\s+["'](@pdf-extractor\/[^"']+)["']/g,
    (match, importPath: string) => {
      // Handle UI imports: @pdf-extractor/ui/<component>
      if (importPath.startsWith("@pdf-extractor/ui/")) {
        const component = importPath.replace("@pdf-extractor/ui/", "");
        const absoluteTarget = path.join(projectRoot, uiPrefix, component);
        let relative = path.relative(targetDir, absoluteTarget);
        if (!relative.startsWith(".")) relative = "./" + relative;
        // Remove .tsx/.ts extension for import
        relative = relative.replace(/\.(tsx?|jsx?)$/, "");
        return `from "${relative}"`;
      }

      // Handle known module imports
      const resolved = aliasMap[importPath];
      if (resolved) {
        const absoluteTarget = path.join(projectRoot, resolved);
        let relative = path.relative(targetDir, absoluteTarget);
        if (!relative.startsWith(".")) relative = "./" + relative;
        // Remove extension
        relative = relative.replace(/\.(tsx?|jsx?)$/, "");
        return `from "${relative}"`;
      }

      // Check if it's a sub-path of a known module (e.g. @pdf-extractor/rules-panel/condition-editor)
      for (const [alias, target] of Object.entries(aliasMap)) {
        if (importPath.startsWith(alias + "/")) {
          const subPath = importPath.replace(alias + "/", "");
          const baseDir = path.dirname(path.join(projectRoot, target));
          const absoluteTarget = path.join(baseDir, subPath);
          let relative = path.relative(targetDir, absoluteTarget);
          if (!relative.startsWith(".")) relative = "./" + relative;
          relative = relative.replace(/\.(tsx?|jsx?)$/, "");
          return `from "${relative}"`;
        }
      }

      // If no match, return unchanged
      return match;
    }
  );
}

/**
 * Resolve a target path template like "{{coreDir}}/types.ts"
 * against the config aliases.
 */
export function resolveTargetPath(
  template: string,
  config: PdfExtractorConfig,
  projectRoot: string
): string {
  let resolved = template;
  for (const [key, value] of Object.entries(config.aliases)) {
    resolved = resolved.replace(`{{${key}}}`, value);
  }
  return path.join(projectRoot, resolved);
}
