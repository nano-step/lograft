import { describe, it, expect } from "@jest/globals";

describe("scaffold smoke", () => {
  it("module entry exports the server bootstrap", async () => {
    const mod = await import("../src/index.js");
    expect(typeof mod.startServer).toBe("function");
    expect(typeof mod.log).toBe("object");
    expect(typeof mod.log.info).toBe("function");
    expect(typeof mod.log.error).toBe("function");
  });
});
