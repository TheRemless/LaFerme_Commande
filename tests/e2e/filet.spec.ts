import { expect, test } from "@playwright/test";

// Route lue par le service de disponibilité (docs/filet.md) : jamais en cache, aucune donnée personnelle.
test("la route de santé répond 200 avec l'état de la base, de la surveillance et de la tablette", async ({ request }) => {
  // Sur le poste et sur GitHub, la base embarquée démarre à sa première lecture (migrations rejouées : 2 s à
  // vide, plus de 5 s sous charge) et la route répondait 503. Une première lecture la démarre ; Supabase,
  // lui, tourne déjà.
  await expect.poll(async () => (await request.get("/api/sante")).status(), { timeout: 30_000 }).toBe(200);
  const r = await request.get("/api/sante");
  expect(r.status()).toBe(200);
  expect(r.headers()["cache-control"]).toBe("no-store");
  const corps = await r.json();
  expect(corps.etat).toBe("ok");
  expect(corps.base.ok).toBe(true);
  expect(Object.keys(corps).sort()).toEqual(["base", "contexte", "etat", "heure", "service", "surveillance", "tablette", "version"]);
  expect(JSON.stringify(corps)).not.toMatch(/@|\+41|07\d \d{3}|laferme\.test/);
});

// Base injoignable : le serveur répond une erreur sans JSON. Le client doit lire le numéro du restaurant,
// pas « vérifiez le réseau » (docs/pannes.md, « La base ne répond plus »).
test("commande refusée par une erreur du serveur : le client voit le téléphone du restaurant", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" }] }));
  });
  await page.route("**/api/commandes", (route) => route.fulfill({ status: 500, contentType: "text/html", body: "<h1>Internal Server Error</h1>" }));
  await page.goto("/commande");
  await page.getByLabel("Prénom").fill("Test");
  await page.getByLabel("Nom", { exact: true }).fill("Panne");
  await page.getByLabel("Téléphone").fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill("panne@exemple.ch");
  await page.getByText("Au comptoir").click();
  await page.getByRole("button", { name: "Commander, je paie au comptoir" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "022 792 16 89" })).toContainText("La commande n'est pas passée.");
  await expect(page.getByText("Vérifiez le réseau")).toHaveCount(0);
});
