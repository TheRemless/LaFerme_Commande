import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { SITE } from "./site";

// Tablette du restaurant : connexion du personnel, file, accepter, statuts, refus et remboursement, rupture.
// Un membre d'équipe par projet (supabase/local/donnees-test.sql) : un seul code par e-mail toutes les 30 s.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };
let tablette: Page;

async function commander(request: APIRequestContext, prenom: string, moyen: "comptoir" | "en_ligne"): Promise<{ numero: string; suivi: string }> {
  const rep = await request.post("/api/commandes", {
    headers: ORIGINE,
    data: {
      cle: `tablette-${prenom}-${Date.now()}`,
      mode: "retrait",
      moyen,
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom, nom: "Test", telephone: "079 000 00 00", email: `${prenom.toLowerCase()}@laferme.test` },
      lignes: [
        { slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" },
        { slug: "pasta-alla-carbonara", qte: 1, choix: { "choix-pates": ["Penne"] }, retraits: [], note: "" },
      ],
    },
  });
  expect(rep.ok()).toBe(true);
  let { redirection } = (await rep.json()) as { redirection: string };
  if (moyen === "en_ligne") {
    const id = redirection.match(/paiement-test\/([0-9a-f-]+)/)![1];
    const p = await request.post("/api/paiement-test", { data: { commande: id, issue: "paye" } });
    redirection = ((await p.json()) as { redirection: string }).redirection;
  }
  const page = await (await request.get(redirection)).text();
  // Le HTML rendu glisse un commentaire React entre « Commande » et le numéro.
  return { numero: page.match(/Commande (?:<!-- -->)?(\d+)/)![1], suivi: redirection };
}

test.beforeAll(async ({ browser }, info) => {
  tablette = await browser.newPage({ baseURL: SITE });
  await tablette.goto("/tablette");
  await tablette.getByLabel("E-mail", { exact: true }).fill(`equipe-${info.project.name}@laferme.test`);
  await tablette.getByRole("button", { name: "Recevoir un code" }).click();
  const code = tablette.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await tablette.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await tablette.getByRole("button", { name: "Me connecter" }).click();
  await tablette.getByRole("button", { name: "Continuer sans son" }).click();
  await expect(tablette.getByRole("button", { name: /^À accepter/ })).toBeVisible();
});

test.afterAll(async () => {
  await tablette.close();
});

test("une commande arrive, on l'accepte, puis prête, retirée et payée", async ({ request }) => {
  const { numero, suivi } = await commander(request, "Alice", "comptoir");
  const carte = tablette.locator(".tab-commande", { has: tablette.locator(".tab-num", { hasText: new RegExp(`^${numero}$`) }) });
  await expect(carte).toBeVisible({ timeout: 10_000 });
  await expect(carte).toContainText("CHOIX Penne");
  await expect(carte).toContainText("À encaisser au comptoir");
  // Bandeau des commandes à accepter. Une imprimante laissée hors ligne par impression.spec.ts ajoute le sien.
  await expect(tablette.locator(".tab-attente", { hasText: /à accepter/ })).toBeVisible();

  await carte.getByRole("button", { name: "+15 min" }).click();
  await carte.getByRole("button", { name: /^Accepter pour/ }).click();
  await tablette.getByRole("button", { name: /^En cours/ }).click();
  await expect(carte).toContainText("Acceptée pour");
  // Le client voit l'heure confirmée sur son suivi.
  expect(await (await request.get(suivi)).text()).toContain("Prête vers");

  await carte.getByRole("button", { name: "Prête au comptoir" }).click();
  await expect(carte).toContainText("Prête au comptoir pour");
  // Retrait payé au comptoir : un seul geste, retirée et encaissée (audit du gérant, G01).
  await carte.getByRole("button", { name: "Retirée et payée" }).click();
  await tablette.getByRole("button", { name: /^Terminées/ }).click();
  await expect(carte).toContainText(/Retirée pour \d{2}h\d{2}/);
  await expect(carte).toContainText("Encaissée CHF");
});

test("refus d'une commande payée en ligne : remboursée, le client est prévenu", async ({ request }) => {
  const { numero, suivi } = await commander(request, "Bruno", "en_ligne");
  await tablette.getByRole("button", { name: /^À accepter/ }).click();
  const carte = tablette.locator(".tab-commande", { has: tablette.locator(".tab-num", { hasText: new RegExp(`^${numero}$`) }) });
  await expect(carte).toBeVisible({ timeout: 10_000 });
  await carte.getByRole("button", { name: "Refuser" }).click();
  const bouton = carte.getByRole("button", { name: /^Refuser et rembourser/ });
  await expect(bouton).toBeDisabled();
  await carte.getByRole("button", { name: "La cuisine est complète pour ce service." }).click();
  await bouton.click();
  await expect(tablette.locator(".tab-message")).toHaveText("Commande refusée et remboursée.");
  const page = await (await request.get(suivi)).text();
  expect(page).toContain("Commande refusée");
  expect(page).toContain("Remboursée");
});

test("rupture du jour : le plat est grisé sur la carte, puis revient", async ({ page }) => {
  await tablette.getByRole("button", { name: "Pause, délai, ruptures" }).click();
  await tablette.getByLabel("Chercher un plat").fill("miss Italia");
  const ligne = tablette.locator(".tab-plats li", { hasText: "Pizza miss Italia" });
  await ligne.getByRole("button", { name: "Disponible" }).click();
  await expect(ligne.getByRole("button", { name: "Épuisé" })).toBeVisible();
  await page.addInitScript(() =>
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() })),
  );
  await page.goto("/carte");
  await expect(page.getByText("Épuisé pour aujourd'hui.").first()).toBeVisible();
  await ligne.getByRole("button", { name: "Épuisé" }).click();
  await expect(ligne.getByRole("button", { name: "Disponible" })).toBeVisible();
  await tablette.getByRole("button", { name: "Fermer les réglages" }).click();
});

test("la tablette est fermée aux clients et aux autres sites", async ({ request }) => {
  expect((await request.get("/api/tablette/file")).status()).toBe(401);
  expect((await request.post("/api/tablette/action", { headers: ORIGINE, data: { commande: "00000000-0000-0000-0000-000000000000", action: "encaisser" } })).status()).toBe(401);
  // Même avec la session de la tablette, une requête d'un autre site est refusée.
  const cookies = await tablette.context().cookies();
  const session = cookies.find((c) => c.name === "laferme-personnel")!;
  const pirate = await request.post("/api/tablette/reglages", {
    headers: { Origin: "https://pirate.example", Cookie: `laferme-personnel=${session.value}` },
    data: { pause: "sans-fin" },
  });
  expect(pirate.status()).toBe(403);
  // Une session client ne donne pas accès à la tablette.
  expect((await request.get("/api/tablette/file", { headers: { Cookie: `laferme-session=${session.value}` } })).status()).toBe(401);
});

// Lot 8f : la file propose son rythme de relecture. Une commande en cours garde la tablette à 15 s.
test("rythme de relecture : 15 s tant qu'une commande est en cours", async ({ request }) => {
  await commander(request, "Rythme", "comptoir");
  const r = await (await tablette.request.get("/api/tablette/file")).json();
  expect(r.relecture_s).toBe(15);
});
