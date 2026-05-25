import { describe, it, expect } from "@jest/globals";
import { spawn } from "node:child_process";
import { join } from "node:path";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface ToolListEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

async function callToolsList(binPath: string): Promise<ToolListEntry[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [binPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("timeout waiting for tools/list response"));
    }, 8000);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcMessage;
          if (msg.id === 2 && msg.result) {
            clearTimeout(timer);
            proc.kill();
            resolve((msg.result as { tools: ToolListEntry[] }).tools);
            return;
          }
        } catch {
          continue;
        }
      }
    });

    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });

    const init: JsonRpcMessage = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        clientInfo: { name: "schema-regression", version: "0.1" },
        capabilities: {},
      },
    };
    const inited: JsonRpcMessage = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };
    const list: JsonRpcMessage = { jsonrpc: "2.0", id: 2, method: "tools/list" };

    proc.stdin.write(JSON.stringify(init) + "\n");
    setTimeout(() => proc.stdin.write(JSON.stringify(inited) + "\n"), 80);
    setTimeout(() => proc.stdin.write(JSON.stringify(list) + "\n"), 160);
  });
}

describe("tools/list inputSchema (MCP spec compliance — regression for TASK-14)", () => {
  it("every tool's inputSchema is a valid MCP object schema", async () => {
    const binPath = join(process.cwd(), "dist", "bin", "lograft.js");
    const tools = await callToolsList(binPath);

    expect(tools.length).toBeGreaterThan(0);

    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.inputSchema.properties).toBe("object");
      expect(tool.inputSchema.$schema).toBeUndefined();
    }
  }, 15_000);
});
