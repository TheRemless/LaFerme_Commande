import { expect, test, type Page } from "@playwright/test";

// Vague 3, client-commande : un plat indisponible pour le moment ou le mode choisis est grisé sur la carte,
// avec le texte que le serveur opposerait au panier (motifPlat, disponibilités de bo-carte).

const retrait = { mode: "retrait", quand: { type: "creneau", date: "2026-11-10", minutes: 1230 }, heureSimulee: "2026-11-10T19:05" };

async function poser(page: Page, choix: Record<string, unknown>) {
  await page.addInitScript((c) => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...c, enregistreLe: Date.now() }));
  }, choix);
}

// Le catalogue servi avec la page reçoit une disponibilité réservée à la livraison pour les lasagnes.
async function lasagneLivraisonSeulement(page: Page) {
  await page.route("**/carte", async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    const html = (await rep.text()).replace(
      /(\\"slug\\":\\"lasagne-de-boeuf\\"[^}]*?\\"dispo\\":)null/g,
      '$1{\\"service\\":null,\\"mode\\":\\"livraison\\",\\"jours\\":null}',
    );
    await r.fulfill({ response: rep, body: html });
  });
}

test("à emporter, un plat réservé à la livraison est grisé avec sa raison", async ({ page }) => {
  await poser(page, retrait);
  await lasagneLivraisonSeulement(page);
  await page.goto("/carte");
  const plat = page.locator('li[data-slug="lasagne-de-boeuf"]');
  await expect(plat).toHaveClass(/epuise/);
  await expect(plat).toContainText("Seulement en livraison.");
  await expect(plat.locator("button.plat-carte")).toBeDisabled();
  await expect(page.locator('li[data-slug="pizza-margherita"]')).not.toHaveClass(/epuise/);
});

test("le même plat reste commandable quand le mode correspond", async ({ page }) => {
  await poser(page, {
    mode: "livraison",
    adresse: { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" },
    details: { sonnette: "Test", etage: "", code: "", instructions: "" },
    zone: { numero: 1, frais_centimes: 290, minimum_centimes: 3000, delai_min: 30, delai_max: 45 },
    quand: retrait.quand,
    heureSimulee: retrait.heureSimulee,
  });
  await lasagneLivraisonSeulement(page);
  await page.goto("/carte");
  await expect(page.locator('li[data-slug="lasagne-de-boeuf"]')).not.toHaveClass(/epuise/);
});
