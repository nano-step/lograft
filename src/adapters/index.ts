import type { NormalizedRowset, RowsetSource } from "../types.js";
import { normalize } from "../normalize/index.js";

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string; installHint: string };

export interface AdapterCapabilities {
  live: boolean;
  paste: boolean;
}

export interface RawDataInput {
  kind: "raw";
  source: RowsetSource;
  data: string;
  rowCap?: number;
}

export interface AzmcpFetchInput {
  kind: "azmcp";
  workspaceId: string;
  subscriptionId: string;
  table: string;
  query: string;
  hours?: number;
  limit?: number;
  timeoutMs?: number;
}

export type AdapterInput = RawDataInput | AzmcpFetchInput;

export interface LogSourceAdapter {
  readonly id: string;
  readonly capabilities: AdapterCapabilities;
  validate(): Promise<ValidationResult>;
  fetch(input: AdapterInput, signal: AbortSignal): Promise<NormalizedRowset>;
}

export class RawDataAdapter implements LogSourceAdapter {
  readonly id = "raw";
  readonly capabilities: AdapterCapabilities = { live: false, paste: true };

  async validate(): Promise<ValidationResult> {
    return { ok: true };
  }

  async fetch(
    input: AdapterInput,
    _signal: AbortSignal,
  ): Promise<NormalizedRowset> {
    void _signal;
    if (input.kind !== "raw") {
      throw new Error(`RawDataAdapter cannot handle input kind=${input.kind}`);
    }
    return normalize(input.source, input.data, { rowCap: input.rowCap });
  }
}
