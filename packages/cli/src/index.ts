#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { addCommand } from "./commands/add.js";
import { diffCommand } from "./commands/diff.js";
import { listCommand } from "./commands/list.js";

const program = new Command();

program
  .name("pdf-extractor")
  .description("Install pdf-extractor modules into your project (shadcn-style)")
  .version("1.0.0");

program
  .command("init")
  .description("Initialize pdf-extractor config in your project")
  .action(initCommand);

program
  .command("add <module...>")
  .description("Add module(s) to your project")
  .option("--force", "Overwrite existing files without confirmation")
  .action(addCommand);

program
  .command("diff <module>")
  .description("Show diff between local files and registry version")
  .action(diffCommand);

program
  .command("list")
  .description("List all available modules")
  .action(listCommand);

program.parse();
