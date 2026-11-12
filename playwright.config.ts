import { defineConfig, devices } from "@playwright/test";

// Port réglable : plusieurs worktrees peuvent lancer leurs tests en même temps sur le même poste.
const PORT = Number(process.env.PORT_E2E ?? 3200);

export default defineConfig({
  testDir: "tests/e2e",
  // Sur GitHub (CI) : un test qui ne passe qu'au second essai est marqué « flaky » et fait échouer le passage.
  // On le voit et on le corrige, au lieu de le relancer jusqu'au vert.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  // Le runner d'un dépôt privé a deux processeurs : un délai d'attente plus large qu'un poste de travail.
  expect: { timeout: process.env.CI ? 10_000 : 5_000 },
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }], ["list"]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, channel: process.env.CI ? undefined : "chrome" },
  projects: [
    { name: "bureau", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Accueil, carte et panier sont mis en cache dès le build : il lit déjà la base embarquée.
    // SANS_LIMITE_COMPTOIR : les tests passent toutes leurs commandes au comptoir avec le même téléphone.
    command: `BASE_LOCALE=1 npm run build && BASE_LOCALE=1 SANS_LIMITE_COMPTOIR=1 npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/carte`,
    timeout: 240_000,
    reuseExistingServer: false,
  },
});
