import prompts from "prompts";
import pc from "picocolors";
import { saveConfig, findConfig, type PdfExtractorConfig } from "../utils/config.js";

const DEFAULT_CONFIG: PdfExtractorConfig = {
  aliases: {
    coreDir: "src/lib/pdf-extractor",
    componentsDir: "src/components/pdf-extractor",
    libDir: "src/lib",
    uiDir: "src/components/ui",
    pythonDir: "backend",
  },
  registry: "https://raw.githubusercontent.com/user/pdf-extractor/main/packages/registry",
};

export async function initCommand() {
  const existing = findConfig();
  if (existing) {
    const { overwrite } = await prompts({
      type: "confirm",
      name: "overwrite",
      message: `pdf-extractor.json already exists at ${existing}. Overwrite?`,
      initial: false,
    });
    if (!overwrite) {
      console.log(pc.yellow("Aborted."));
      return;
    }
  }

  console.log(pc.bold("\nInitializing pdf-extractor...\n"));

  const response = await prompts([
    {
      type: "text",
      name: "coreDir",
      message: "Where to install core modules (types, rules, extract)?",
      initial: DEFAULT_CONFIG.aliases.coreDir,
    },
    {
      type: "text",
      name: "componentsDir",
      message: "Where to install React components?",
      initial: DEFAULT_CONFIG.aliases.componentsDir,
    },
    {
      type: "text",
      name: "uiDir",
      message: "Where are your UI primitives (Input, Select, Button)?",
      initial: DEFAULT_CONFIG.aliases.uiDir,
    },
    {
      type: "text",
      name: "pythonDir",
      message: "Where to install Python modules?",
      initial: DEFAULT_CONFIG.aliases.pythonDir,
    },
    {
      type: "text",
      name: "registry",
      message: "Registry URL (or local path)?",
      initial: DEFAULT_CONFIG.registry,
    },
    {
      type: "text",
      name: "cnPath",
      message: 'Do you already have a cn() utility? Enter path (or leave empty to install one)',
      initial: "",
    },
  ]);

  if (!response.coreDir) {
    console.log(pc.yellow("Aborted."));
    return;
  }

  const config: PdfExtractorConfig = {
    aliases: {
      coreDir: response.coreDir,
      componentsDir: response.componentsDir,
      libDir: "src/lib",
      uiDir: response.uiDir,
      pythonDir: response.pythonDir,
    },
    registry: response.registry,
  };

  const configPath = saveConfig(config);
  console.log(pc.green(`\nCreated ${configPath}`));

  if (response.cnPath) {
    console.log(pc.dim(`Using existing cn() at: ${response.cnPath}`));
    console.log(pc.dim("Note: Update the utils alias in pdf-extractor.json if needed."));
  } else {
    console.log(pc.dim('Run "npx pdf-extractor add utils" to install the cn() utility.'));
  }

  console.log(pc.dim('Run "npx pdf-extractor list" to see available modules.'));
  console.log(pc.dim('Run "npx pdf-extractor add <module>" to install a module.\n'));
}
