import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  PARSE_KQL_TOOL_NAME,
  PARSE_KQL_DESCRIPTION,
  ParseKqlInput,
  runParseKql,
} from "./server/tools/parse-kql.js";
import {
  NORMALIZE_TOOL_NAME,
  NORMALIZE_DESCRIPTION,
  NormalizeInput,
  runNormalize,
} from "./server/tools/normalize.js";
import {
  GATHER_REPO_CONTEXT_TOOL_NAME,
  GATHER_REPO_CONTEXT_DESCRIPTION,
  GatherRepoContextInput,
  runGatherRepoContext,
} from "./server/tools/gather-repo-context.js";
import {
  CORRELATE_TOOL_NAME,
  CORRELATE_DESCRIPTION,
  CorrelateInput,
  runCorrelate,
} from "./server/tools/correlate.js";
import {
  INVESTIGATE_TOOL_NAME,
  INVESTIGATE_DESCRIPTION,
  InvestigateInput,
  runInvestigate,
} from "./server/tools/investigate.js";
import { fail } from "./errors.js";

const SERVER_NAME = "lograft";

function readPackageVersion(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(thisDir, "..", "package.json"),
    join(thisDir, "..", "..", "package.json"),
  ]) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
      if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
    } catch {
      continue;
    }
  }
  return "0.0.0-unknown";
}

const SERVER_VERSION = readPackageVersion();

export const log = {
  info: (...args: unknown[]): void => {
    console.error("[lograft]", ...args);
  },
  error: (...args: unknown[]): void => {
    console.error("[lograft] ERROR", ...args);
  },
};

let sdkOwnsStdout = false;

function installStdoutGuard(): void {
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((...args: Parameters<typeof originalWrite>) => {
    if (!sdkOwnsStdout) {
      throw new Error(
        "[lograft] stdout write outside SDK transport — would corrupt MCP JSON-RPC",
      );
    }
    return originalWrite(...args);
  }) as typeof process.stdout.write;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  run: (input: unknown) => Promise<unknown>;
}

function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // Use Zod v4's built-in JSON Schema converter — produces draft-2020-12.
  // We strip the $schema field (MCP clients don't need / want it) and ensure
  // the root is always { type: "object" } as required by the MCP spec
  // (tools/list[].inputSchema MUST be an object schema).
  const generated = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete generated.$schema;
  if (generated.type !== "object") {
    // Defensive fallback: every tool input should be a zod object. If somehow
    // it isn't, wrap it so MCP clients don't reject the tools list.
    return { type: "object", properties: {}, additionalProperties: false };
  }
  return generated;
}

function buildToolRegistry(): Map<string, ToolDefinition> {
  const registry = new Map<string, ToolDefinition>();

  registry.set(PARSE_KQL_TOOL_NAME, {
    name: PARSE_KQL_TOOL_NAME,
    description: PARSE_KQL_DESCRIPTION,
    inputSchema: ParseKqlInput,
    run: (input) => runParseKql(input as ParseKqlInput),
  });

  registry.set(NORMALIZE_TOOL_NAME, {
    name: NORMALIZE_TOOL_NAME,
    description: NORMALIZE_DESCRIPTION,
    inputSchema: NormalizeInput,
    run: (input) => runNormalize(input as NormalizeInput),
  });

  registry.set(GATHER_REPO_CONTEXT_TOOL_NAME, {
    name: GATHER_REPO_CONTEXT_TOOL_NAME,
    description: GATHER_REPO_CONTEXT_DESCRIPTION,
    inputSchema: GatherRepoContextInput,
    run: (input) =>
      runGatherRepoContext(input as GatherRepoContextInput),
  });

  registry.set(CORRELATE_TOOL_NAME, {
    name: CORRELATE_TOOL_NAME,
    description: CORRELATE_DESCRIPTION,
    inputSchema: CorrelateInput,
    run: (input) => runCorrelate(input as CorrelateInput),
  });

  registry.set(INVESTIGATE_TOOL_NAME, {
    name: INVESTIGATE_TOOL_NAME,
    description: INVESTIGATE_DESCRIPTION,
    inputSchema: InvestigateInput,
    run: (input) => runInvestigate(input as InvestigateInput),
  });

  return registry;
}

export async function startServer(): Promise<void> {
  installStdoutGuard();

  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const registry = buildToolRegistry();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Array.from(registry.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toJsonSchema(tool.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = registry.get(name);
    if (!tool) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              fail("INPUT_INVALID", `unknown tool: ${name}`, {
                hint: `available: ${Array.from(registry.keys()).join(", ")}`,
                retryable: false,
              }),
            ),
          },
        ],
        isError: true,
      };
    }

    const parsed = tool.inputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              fail("INPUT_INVALID", `invalid input for ${name}`, {
                hint: parsed.error.message,
                retryable: false,
              }),
            ),
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await tool.run(parsed.data);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    } catch (err) {
      log.error(`tool ${name} threw:`, err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              fail("INTERNAL", (err as Error).message ?? "unknown error", {
                hint: "tool handler threw; see lograft stderr",
                retryable: false,
              }),
            ),
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  log.info(`starting ${SERVER_NAME}@${SERVER_VERSION} on stdio transport`);

  sdkOwnsStdout = true;
  try {
    await server.connect(transport);
  } catch (err) {
    sdkOwnsStdout = false;
    throw err;
  }
}
