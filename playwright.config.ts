import { defineConfig, devices } from "@playwright/test";

// Port réglable : plusieurs worktrees peuvent lancer leurs tests en même temps sur le même poste.
const PORT = Number(process.env.PORT_E2E ?? 3200);

export default defineConfig({
  testDir: "tests/e2e",
  // Résultats à part par port : Playwright vide ce dossier au démarrage d'un passage.
  outputDir: process.env.PORT_E2E ? `test-results-${PORT}` : "test-results",
  // Sur GitHub (CI) : un test qui ne passe qu'au second essai est marqué « flaky » et fait échouer le passage.
  // On le voit et on le corrige, au lieu de le relancer jusqu'au vert.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  // Le runner d'un dépôt privé a deux processeurs : un délai d'attente plus large qu'un poste de travail.
  expect: { timeout: process.env.CI ? 10_000 : 5_000 },
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }], ["list"]] : "list",
  // Rien d'autre à séparer entre deux sessions : chaque worktree a son build (.next) et la base embarquée vit
  // dans la mémoire de chaque serveur. Deux passages du même worktree en même temps restent à éviter (même .next).
  use: { baseURL: `http://localhost:${PORT}`, channel: process.env.CI ? undefined : "chrome" },
  projects: [
    { name: "bureau", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Accueil, carte et panier sont mis en cache dès le build : il lit déjà la base embarquée.
    // SANS_LIMITE_COMPTOIR : les tests passent toutes leurs commandes au comptoir avec le même téléphone.
    // Cache de données de Next (unstable_cache : config du service, carte) vidé d'abord : il survit au
    // redémarrage alors que la base embarquée repart de zéro, et un passage interrompu laissait au suivant
    // une fermeture ou un réglage qui n'existe plus en base (signalé par bo-operations).
    command: `rm -rf .next/cache/fetch-cache && BASE_LOCALE=1 npm run build && BASE_LOCALE=1 SANS_LIMITE_COMPTOIR=1 npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/carte`,
    timeout: 240_000,
    reuseExistingServer: false,
  },
});
