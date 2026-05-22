import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { parse as parseToml } from "smol-toml";

export const LograftConfig = z.object({
  joinPolicy: z
    .object({
      ticketRegex: z.string().optional(),
      serviceAllowlist: z.array(z.string()).optional(),
      operationIdField: z.string().default("operation_Id"),
      tiebreakerWindowMin: z.number().int().nonnegative().default(10),
    })
    .default({
      operationIdField: "operation_Id",
      tiebreakerWindowMin: 10,
    }),
  output: z
    .object({
      dir: z.string().optional(),
      ticketLinkBase: z.string().optional(),
      formats: z.array(z.enum(["md", "json", "html"])).default(["md", "json", "html"]),
    })
    .default({
      formats: ["md", "json", "html"],
    }),
  redaction: z
    .object({
      extraRules: z
        .array(
          z.object({
            name: z.string(),
            pattern: z.string(),
            flags: z.string().optional(),
            replacement: z.string().default("[REDACTED]"),
          }),
        )
        .default([]),
    })
    .default({ extraRules: [] }),
  repo: z
    .object({
      sinceDays: z.number().int().positive().max(365).default(14),
      maxCommits: z.number().int().positive().max(200).default(200),
    })
    .default({ sinceDays: 14, maxCommits: 200 }),
});
export type LograftConfig = z.infer<typeof LograftConfig>;

export const DEFAULT_CONFIG: LograftConfig = LograftConfig.parse({});

export interface LoadConfigResult {
  config: LograftConfig;
  source: "default" | "cwd-file" | "xdg-file" | "explicit-file";
  path?: string;
  warnings: string[];
}

async function tryReadToml(
  path: string,
): Promise<{ raw: unknown; warnings: string[] } | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    return { raw: parseToml(text), warnings: [] };
  } catch (err) {
    return {
      raw: {},
      warnings: [`TOML parse failed for ${path}: ${(err as Error).message}`],
    };
  }
}

export async function loadConfig(opts: {
  explicitPath?: string;
  cwd?: string;
} = {}): Promise<LoadConfigResult> {
  const warnings: string[] = [];

  if (opts.explicitPath) {
    const r = await tryReadToml(opts.explicitPath);
    if (!r) {
      warnings.push(
        `--config path not found: ${opts.explicitPath}. Falling back to defaults.`,
      );
    } else {
      warnings.push(...r.warnings);
      const parsed = LograftConfig.safeParse(r.raw);
      if (!parsed.success) {
        warnings.push(`config invalid: ${parsed.error.message}`);
        return {
          config: DEFAULT_CONFIG,
          source: "default",
          warnings,
        };
      }
      return {
        config: parsed.data,
        source: "explicit-file",
        path: opts.explicitPath,
        warnings,
      };
    }
  }

  const cwd = opts.cwd ?? process.cwd();
  const cwdPath = join(cwd, "lograft.config.toml");
  const cwdRead = await tryReadToml(cwdPath);
  if (cwdRead) {
    warnings.push(...cwdRead.warnings);
    const parsed = LograftConfig.safeParse(cwdRead.raw);
    if (parsed.success) {
      return {
        config: parsed.data,
        source: "cwd-file",
        path: cwdPath,
        warnings,
      };
    }
    warnings.push(`config invalid: ${parsed.error.message}`);
  }

  const xdgPath = join(homedir(), ".config", "lograft", "lograft.config.toml");
  const xdgRead = await tryReadToml(xdgPath);
  if (xdgRead) {
    warnings.push(...xdgRead.warnings);
    const parsed = LograftConfig.safeParse(xdgRead.raw);
    if (parsed.success) {
      return {
        config: parsed.data,
        source: "xdg-file",
        path: xdgPath,
        warnings,
      };
    }
    warnings.push(`config invalid: ${parsed.error.message}`);
  }

  return { config: DEFAULT_CONFIG, source: "default", warnings };
}

export function resolveOutDir(
  cwd: string,
  configured: string | undefined,
): string | { error: string } {
  if (configured) {
    if (configured.startsWith("/") || /^[A-Za-z]:[\\/]/.test(configured)) {
      return configured;
    }
    return join(cwd, configured);
  }
  if (cwd === "/" || cwd === "" || cwd === "\\") {
    return {
      error:
        "cannot resolve relative outDir when cwd is filesystem root — set output.dir to an absolute path in lograft.config.toml or pass an absolute outDir argument",
    };
  }
  return join(cwd, "reports");
}
