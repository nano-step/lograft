import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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
import { fail } from "./errors.js";

const SERVER_NAME = "lograft";
const SERVER_VERSION = "0.1.0-beta.0";

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
  // Pragmatic minimal converter for our handful of input schemas; we expose
  // the shape so MCP clients can build a tool form. Full JSON Schema
  // generation isn't worth a heavy dep at this stage.
  const def = (schema as { _def?: { typeName?: string } })._def;
  if (def?.typeName === "ZodObject") {
    const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, fieldSchema] of Object.entries(shape)) {
      properties[key] = toJsonSchema(fieldSchema);
      if (!(fieldSchema as { isOptional?: () => boolean }).isOptional?.()) {
        required.push(key);
      }
    }
    const result: Record<string, unknown> = {
      type: "object",
      properties,
      additionalProperties: false,
    };
    if (required.length > 0) result.required = required;
    return result;
  }
  if (def?.typeName === "ZodString") return { type: "string" };
  if (def?.typeName === "ZodNumber") return { type: "number" };
  if (def?.typeName === "ZodBoolean") return { type: "boolean" };
  if (def?.typeName === "ZodOptional") {
    const inner = (schema as unknown as { _def: { innerType: z.ZodTypeAny } })._def.innerType;
    return toJsonSchema(inner);
  }
  return {};
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
