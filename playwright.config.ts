import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: `http://localhost:${PORT}`, channel: process.env.CI ? undefined : "chrome" },
  projects: [
    { name: "bureau", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Accueil, carte et panier sont mis en cache dès le build : il lit déjà la base embarquée.
    command: `BASE_LOCALE=1 npm run build && BASE_LOCALE=1 npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/carte`,
    timeout: 240_000,
    reuseExistingServer: false,
  },
});
