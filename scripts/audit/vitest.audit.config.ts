import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests d'audit « samedi soir » (jetables) : reproduisent des constats sur la base embarquée.
// Lancer : npx vitest run --config scripts/audit/vitest.audit.config.ts
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../src"),
      "server-only": path.resolve(__dirname, "../../tests/unit/server-only-vide.ts"),
    },
  },
  test: {
    root: path.resolve(__dirname, "../.."),
    include: ["scripts/audit/**/*.audit.test.ts"],
    testTimeout: 60000,
  },
});
