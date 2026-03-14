import fs from "node:fs";
import path from "node:path";
import prompts from "prompts";
import pc from "picocolors";
import { loadConfig, getProjectRoot } from "../utils/config.js";
import { fetchRegistry, fetchModuleFile, resolveDependencies, collectPeerDependencies } from "../utils/registry.js";
import { rewriteImports, resolveTargetPath } from "../utils/transformer.js";

export async function addCommand(moduleNames: string[], options: { force?: boolean }) {
  const config = loadConfig();
  const projectRoot = getProjectRoot();

  console.log(pc.dim("Fetching registry..."));
  const registry = await fetchRegistry(config);

  // Validate module names
  for (const name of moduleNames) {
    if (!registry.modules[name]) {
      console.error(pc.red(`Module "${name}" not found in registry.`));
      console.log(pc.dim(`Available: ${Object.keys(registry.modules).join(", ")}`));
      process.exit(1);
    }
  }

  // Resolve all dependencies
  const allModules = resolveDependencies(registry, moduleNames);
  const depOnly = allModules.filter((m) => !moduleNames.includes(m));

  if (depOnly.length > 0) {
    console.log(pc.dim(`\nDependencies resolved: ${depOnly.join(", ")}`));
  }
  console.log(pc.bold(`\nModules to install: ${allModules.join(", ")}\n`));

  // Check for existing files
  const existingFiles: string[] = [];
  for (const modName of allModules) {
    const mod = registry.modules[modName];
    for (const file of mod.files) {
      const targetPath = resolveTargetPath(file.target, config, projectRoot);
      if (fs.existsSync(targetPath)) {
        existingFiles.push(targetPath);
      }
    }
  }

  if (existingFiles.length > 0 && !options.force) {
    console.log(pc.yellow("The following files already exist:"));
    for (const f of existingFiles) {
      console.log(pc.dim(`  ${path.relative(projectRoot, f)}`));
    }
    const { proceed } = await prompts({
      type: "confirm",
      name: "proceed",
      message: "Overwrite existing files?",
      initial: false,
    });
    if (!proceed) {
      console.log(pc.yellow("Aborted."));
      return;
    }
  }

  // Install each module
  for (const modName of allModules) {
    const mod = registry.modules[modName];
    console.log(pc.cyan(`Installing ${modName}...`));

    for (const file of mod.files) {
      const targetPath = resolveTargetPath(file.target, config, projectRoot);
      const targetDir = path.dirname(targetPath);

      // Fetch source
      let content = await fetchModuleFile(config, file.source);

      // Rewrite imports for TypeScript/JavaScript files
      if (/\.(tsx?|jsx?|mts|mjs)$/.test(file.source)) {
        content = rewriteImports(content, targetPath, projectRoot, config);
      }

      // Write file
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(targetPath, content, "utf-8");
      console.log(pc.dim(`  ${path.relative(projectRoot, targetPath)}`));
    }
  }

  // Report peer dependencies
  const peers = collectPeerDependencies(registry, allModules);
  const peerNames = Object.keys(peers);
  if (peerNames.length > 0) {
    console.log(pc.yellow("\nPeer dependencies needed:"));
    for (const [pkg, version] of Object.entries(peers)) {
      console.log(pc.dim(`  ${pkg}: ${version}`));
    }
    console.log(pc.dim("\nInstall with: npm install " + peerNames.join(" ")));
  }

  console.log(pc.green("\nDone!"));
}
