import fs from "node:fs";
import path from "node:path";
import type { PdfExtractorConfig } from "./config.js";

export type ModuleFile = {
  source: string;
  target: string;
};

export type RegistryModule = {
  type: "core" | "react" | "python";
  files: ModuleFile[];
  dependencies: string[];
  peerDependencies?: Record<string, string>;
};

export type Registry = {
  version: string;
  modules: Record<string, RegistryModule>;
};

export async function fetchRegistry(config: PdfExtractorConfig): Promise<Registry> {
  const registryUrl = config.registry.replace(/\/$/, "") + "/registry.json";

  // If it looks like a local path, read from filesystem
  if (!registryUrl.startsWith("http://") && !registryUrl.startsWith("https://")) {
    const raw = fs.readFileSync(registryUrl, "utf-8");
    return JSON.parse(raw);
  }

  const response = await fetch(registryUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch registry: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<Registry>;
}

export async function fetchModuleFile(
  config: PdfExtractorConfig,
  sourcePath: string
): Promise<string> {
  const baseUrl = config.registry.replace(/\/$/, "");
  const fileUrl = `${baseUrl}/${sourcePath}`;

  // If it looks like a local path, read from filesystem
  if (!fileUrl.startsWith("http://") && !fileUrl.startsWith("https://")) {
    return fs.readFileSync(fileUrl, "utf-8");
  }

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sourcePath}: ${response.status}`);
  }
  return response.text();
}

/** Resolve all transitive dependencies for a set of module names */
export function resolveDependencies(
  registry: Registry,
  moduleNames: string[]
): string[] {
  const resolved = new Set<string>();
  const queue = [...moduleNames];

  while (queue.length > 0) {
    const name = queue.shift()!;
    if (resolved.has(name)) continue;

    const mod = registry.modules[name];
    if (!mod) {
      throw new Error(`Module "${name}" not found in registry`);
    }

    resolved.add(name);

    for (const dep of mod.dependencies) {
      if (!resolved.has(dep)) {
        queue.push(dep);
      }
    }
  }

  // Topological sort: deps before dependents
  const sorted: string[] = [];
  const visited = new Set<string>();

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const mod = registry.modules[name];
    if (mod) {
      for (const dep of mod.dependencies) {
        visit(dep);
      }
    }
    sorted.push(name);
  }

  for (const name of resolved) {
    visit(name);
  }

  return sorted;
}

/** Collect all peer dependencies across resolved modules */
export function collectPeerDependencies(
  registry: Registry,
  moduleNames: string[]
): Record<string, string> {
  const peers: Record<string, string> = {};
  for (const name of moduleNames) {
    const mod = registry.modules[name];
    if (mod?.peerDependencies) {
      Object.assign(peers, mod.peerDependencies);
    }
  }
  return peers;
}
