import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

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

/**
 * R6 Layer 2 — Runtime stdout guard.
 *
 * MCP servers communicate over stdio: stdout = JSON-RPC frames; stderr = logs.
 * A single stray `process.stdout.write` from a transitive dep (banner,
 * postinstall noise, debug print) will corrupt the protocol and break every
 * MCP client silently. Layer 1 (eslint) catches our own code; this layer is
 * the runtime backstop.
 *
 * Strategy: replace `process.stdout.write` with a wrapper that throws unless
 * the SDK transport is the active caller. We flip `sdkOwnsStdout = true`
 * immediately before handing stdout to the transport via `server.connect()`.
 * In practice `server.connect()` never resolves (it owns the process for the
 * server's lifetime), so the flag stays true thereafter.
 */
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
