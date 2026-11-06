import { expect, test, type Page } from "@playwright/test";

// Parcours complet avec la doublure de paiement (pas de clé Stripe en test) et la doublure de courriel.
async function preparer(page: Page, mode: "retrait" | "livraison", adresse?: Record<string, string>) {
  await page.addInitScript(
    ([mode, adresse]) => {
      if (localStorage.getItem("laferme.choix.v1")) return;
      localStorage.setItem(
        "laferme.choix.v1",
        JSON.stringify(
          mode === "livraison"
            ? {
                mode,
                adresse,
                details: { etage: "", sonnette: "Test", code: "", instructions: "" },
                zone: { numero: 1, frais_centimes: 0, minimum_centimes: 0, delai_min: 30, delai_max: 40 },
                quand: { type: "asap" },
                heureSimulee: "2026-11-10T19:05",
                enregistreLe: Date.now(),
              }
            : { mode, quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() },
        ),
      );
      localStorage.setItem(
        "laferme.panier.v1",
        JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] }),
      );
    },
    [mode, adresse] as const,
  );
}

async function remplir(page: Page) {
  await page.goto("/commande");
  await page.getByLabel("Prénom").fill("Test");
  await page.getByLabel("Nom", { exact: true }).fill("Essai");
  await page.getByLabel("Téléphone").fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill("test@exemple.ch");
}

test("à emporter, paiement au comptoir : suivi immédiat et panier vidé", async ({ page }) => {
  await preparer(page, "retrait");
  await remplir(page);
  await page.getByText("Au comptoir").click();
  await page.getByRole("button", { name: "Commander, je paie au comptoir" }).click();
  await expect(page).toHaveURL(/\/suivi\//);
  await expect(page.getByText("À payer au comptoir")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("laferme.panier.v1"))).toBeNull();
});

test("paiement en ligne réussi, puis courriel de confirmation", async ({ page }) => {
  await preparer(page, "retrait");
  await remplir(page);
  await page.getByRole("button", { name: /^Payer CHF/ }).click();
  await expect(page).toHaveURL(/\/paiement-test\//);
  await page.getByRole("button", { name: "Simuler un paiement réussi" }).click();
  await expect(page).toHaveURL(/\/suivi\//);
  await expect(page.getByText("Payée en ligne")).toBeVisible();
  const numero = (await page.locator(".suivi-num").innerText()).match(/Commande (\d+)/)![1];
  await page.getByRole("link", { name: /voir les courriels de test/ }).click();
  await expect(page.getByRole("heading", { name: `Commande ${numero} reçue, La Ferme` })).toBeVisible();
});

test("paiement refusé : retour à la commande, panier intact", async ({ page }) => {
  await preparer(page, "retrait");
  await remplir(page);
  await page.getByRole("button", { name: /^Payer CHF/ }).click();
  await page.getByRole("button", { name: "Simuler un refus de la banque" }).click();
  await expect(page).toHaveURL(/\/commande\?annule=1/);
  await expect(page.getByText("Paiement annulé. Votre panier est toujours là.")).toBeVisible();
});

test("adresse saisie à la main introuvable : livraison refusée", async ({ page }) => {
  await preparer(page, "livraison", { rue: "Rue Imaginaire", numero: "999", npa: "1213", localite: "Onex" });
  await remplir(page);
  await page.getByRole("button", { name: /^Payer CHF/ }).click();
  await expect(page.locator(".commande-form [role=alert]")).toContainText("Nous ne trouvons pas cette adresse");
});

test("le serveur refuse coordonnées invalides et paiement au comptoir en livraison", async ({ request }) => {
  const base = { cle: "cle-de-test-0000000001", lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" }], quand: { type: "asap" }, heure: "2026-11-10T19:05" };
  const mauvaisMail = await request.post("/api/commandes", { data: { ...base, mode: "retrait", moyen: "en_ligne", client: { prenom: "A", nom: "B", telephone: "079 000 00 00", email: "pas-un-mail" } } });
  expect(mauvaisMail.status()).toBe(422);
  const comptoirLivraison = await request.post("/api/commandes", { data: { ...base, mode: "livraison", moyen: "comptoir", client: { prenom: "A", nom: "B", telephone: "079 000 00 00", email: "a@b.ch" } } });
  expect(comptoirLivraison.status()).toBe(422);
});

test("un jeton inconnu donne une page introuvable", async ({ page }) => {
  const rep = await page.goto("/suivi/jeton-inexistant-0000000000");
  expect(rep?.status()).toBe(404);
});

test("les courriels de test exigent le jeton de la commande", async ({ page }) => {
  expect((await page.goto("/dev/courriels"))?.status()).toBe(404);
});
