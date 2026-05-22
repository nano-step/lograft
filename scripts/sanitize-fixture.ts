#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import {
  buildCompiledRules,
  defaultRedactionRules,
  redactString,
} from "../src/redact/index.js";

async function main(): Promise<void> {
  const paths = argv.slice(2);
  if (paths.length === 0) {
    console.error("usage: sanitize-fixture <file> [<file> ...]");
    exit(2);
  }
  const compiled = buildCompiledRules(defaultRedactionRules);
  for (const path of paths) {
    const original = await readFile(path, "utf8");
    const redacted = redactString(original, compiled);
    if (redacted !== original) {
      await writeFile(path, redacted, "utf8");
      console.error(`[sanitize-fixture] redacted ${path}`);
    } else {
      console.error(`[sanitize-fixture] clean ${path}`);
    }
  }
}

main().catch((err) => {
  console.error("[sanitize-fixture] error:", err);
  exit(1);
});
