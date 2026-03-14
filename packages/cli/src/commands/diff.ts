import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { createTwoFilesPatch } from "diff";
import { loadConfig, getProjectRoot } from "../utils/config.js";
import { fetchRegistry, fetchModuleFile } from "../utils/registry.js";
import { rewriteImports, resolveTargetPath } from "../utils/transformer.js";

export async function diffCommand(moduleName: string) {
  const config = loadConfig();
  const projectRoot = getProjectRoot();

  const registry = await fetchRegistry(config);
  const mod = registry.modules[moduleName];

  if (!mod) {
    console.error(pc.red(`Module "${moduleName}" not found in registry.`));
    process.exit(1);
  }

  let hasChanges = false;

  for (const file of mod.files) {
    const targetPath = resolveTargetPath(file.target, config, projectRoot);
    const relativePath = path.relative(projectRoot, targetPath);

    if (!fs.existsSync(targetPath)) {
      console.log(pc.yellow(`${relativePath}: not installed`));
      hasChanges = true;
      continue;
    }

    // Get registry version (with import rewriting applied)
    let registryContent = await fetchModuleFile(config, file.source);
    if (/\.(tsx?|jsx?|mts|mjs)$/.test(file.source)) {
      registryContent = rewriteImports(registryContent, targetPath, projectRoot, config);
    }

    const localContent = fs.readFileSync(targetPath, "utf-8");

    if (localContent === registryContent) {
      console.log(pc.green(`${relativePath}: no changes`));
    } else {
      hasChanges = true;
      const patch = createTwoFilesPatch(
        `registry/${file.source}`,
        `local/${relativePath}`,
        registryContent,
        localContent,
        "registry",
        "local"
      );
      console.log(patch);
    }
  }

  if (!hasChanges) {
    console.log(pc.green("\nAll files match the registry."));
  }
}
