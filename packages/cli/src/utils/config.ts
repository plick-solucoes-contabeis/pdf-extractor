import fs from "node:fs";
import path from "node:path";

export type PdfExtractorConfig = {
  aliases: {
    coreDir: string;
    componentsDir: string;
    libDir: string;
    uiDir: string;
    pythonDir: string;
  };
  registry: string;
};

const CONFIG_FILENAME = "pdf-extractor.json";

export function findConfig(cwd: string = process.cwd()): string | null {
  let dir = cwd;
  while (true) {
    const configPath = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(configPath)) return configPath;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadConfig(cwd: string = process.cwd()): PdfExtractorConfig {
  const configPath = findConfig(cwd);
  if (!configPath) {
    throw new Error(
      `No ${CONFIG_FILENAME} found. Run "npx pdf-extractor init" first.`
    );
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw);
}

export function saveConfig(config: PdfExtractorConfig, cwd: string = process.cwd()): string {
  const configPath = path.join(cwd, CONFIG_FILENAME);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return configPath;
}

export function getProjectRoot(cwd: string = process.cwd()): string {
  const configPath = findConfig(cwd);
  if (!configPath) return cwd;
  return path.dirname(configPath);
}
