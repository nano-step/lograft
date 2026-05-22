#!/usr/bin/env node
import { startServer } from "../src/server.js";

startServer().catch((err) => {
  console.error("[lograft] fatal:", err);
  process.exit(1);
});
