import pc from "picocolors";
import { loadConfig } from "../utils/config.js";
import { fetchRegistry } from "../utils/registry.js";

export async function listCommand() {
  const config = loadConfig();
  const registry = await fetchRegistry(config);

  console.log(pc.bold(`\npdf-extractor modules (v${registry.version})\n`));

  const types = { core: [] as string[], react: [] as string[], python: [] as string[] };

  for (const [name, mod] of Object.entries(registry.modules)) {
    const deps = mod.dependencies.length > 0
      ? pc.dim(` (deps: ${mod.dependencies.join(", ")})`)
      : "";
    const peers = mod.peerDependencies
      ? pc.dim(` [peers: ${Object.keys(mod.peerDependencies).join(", ")}]`)
      : "";
    const files = pc.dim(` (${mod.files.length} file${mod.files.length > 1 ? "s" : ""})`);
    types[mod.type as keyof typeof types]?.push(`  ${pc.cyan(name)}${files}${deps}${peers}`);
  }

  if (types.core.length > 0) {
    console.log(pc.bold("Core:"));
    types.core.forEach((l) => console.log(l));
    console.log();
  }
  if (types.react.length > 0) {
    console.log(pc.bold("React:"));
    types.react.forEach((l) => console.log(l));
    console.log();
  }
  if (types.python.length > 0) {
    console.log(pc.bold("Python:"));
    types.python.forEach((l) => console.log(l));
    console.log();
  }

  console.log(pc.dim('Install with: npx pdf-extractor add <module>\n'));
}
