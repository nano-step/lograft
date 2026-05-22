/**
 * Jest config (ESM, no ts-node dependency).
 *
 * Uses ts-jest's ESM preset because package.json declares `"type": "module"`.
 * `node --experimental-vm-modules` (in the test script) is required for Jest
 * to load ESM modules.
 */

/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    // NodeNext requires .js suffix in TS imports — map back to .ts for Jest.
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testMatch: ["<rootDir>/test/**/*.test.ts", "<rootDir>/src/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.test.json",
      },
    ],
  },
  clearMocks: true,
};

export default config;
