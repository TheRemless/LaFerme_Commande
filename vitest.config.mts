import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Le paquet server-only refuse d'être importé hors du rendu serveur de Next.
      "server-only": path.resolve(__dirname, "tests/unit/server-only-vide.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    globalSetup: ["tests/unit/instantane-base.ts"],
    testTimeout: 30000,
    // La base embarquée se recharge dans les hooks : 10 s par défaut ne suffit pas sur un poste chargé.
    hookTimeout: 60000,
  },
});
