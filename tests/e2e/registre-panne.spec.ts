import { expect, test, type Page } from "@playwright/test";
import { MESSAGE_REGISTRE_EN_PANNE } from "@/lib/registre-panne";

// Vague 3, client-commande (P1 de produit-client) : le service fédéral des adresses ne répond pas. Le panier
// et le paiement ne peuvent pas revérifier l'adresse ; le client garde deux issues, à emporter ou le téléphone.
// La panne est simulée dans le navigateur (réponse 503 du serveur) : le serveur, lui, a son test unitaire.

const CAPTURES = "docs/rendus/vague-3/client-commande";
const L = (slug: string, qte = 1) => ({ slug, qte, choix: {}, retraits: [], note: "" });
const onex = {
  mode: "livraison",
  adresse: { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" },
  details: { etage: "", sonnette: "Test", code: "", instructions: "" },
  zone: { numero: 1, frais_centimes: 0, minimum_centimes: 0, delai_min: 30, delai_max: 40 },
  quand: { type: "asap" },
  heureSimulee: "2026-11-10T19:05",
};

async function poser(page: Page) {
  await page.addInitScript(
    ([choix, lignes]) => {
      if (sessionStorage.getItem("pose")) return;
      sessionStorage.setItem("pose", "1");
      localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...choix, enregistreLe: Date.now() }));
      localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes }));
    },
    [onex, [L("pizza-margherita", 4)]] as const,
  );
}

const enPanne = (page: Page, chemin: string) => page.route(chemin, (r) => r.fulfill({ status: 503, json: { erreur: MESSAGE_REGISTRE_EN_PANNE } }));

test("panier : le message propose « Commander à emporter », qui garde le panier et passe à emporter", async ({ page }, info) => {
  await poser(page);
  await enPanne(page, "**/api/panier");
  await page.goto("/panier");
  const alerte = page.locator(".panier-alerte").filter({ hasText: "Le service fédéral des adresses ne répond pas." });
  await expect(alerte).toContainText(/appelez.nous au 022.792.16.89/);
  await expect(alerte.getByRole("link", { name: "Modifier" })).toHaveCount(0);
  await expect(alerte.getByRole("link", { name: /022.792.16.89/ })).toHaveAttribute("href", "tel:+41227921689");
  await alerte.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${CAPTURES}/registre-panne-panier-${info.project.name}.png` });
  await alerte.getByRole("link", { name: "Commander à emporter" }).click();
  await expect(page).toHaveURL((u) => u.pathname === "/");
  await expect(page.getByRole("button", { name: /À emporter/ })).toHaveAttribute("aria-pressed", "true");
  const stocke = await page.evaluate(() => ({
    choix: JSON.parse(localStorage.getItem("laferme.choix.v1") ?? "null"),
    panier: JSON.parse(localStorage.getItem("laferme.panier.v1") ?? "null"),
  }));
  expect(stocke.choix).toMatchObject({ mode: "retrait", quand: { type: "asap" } });
  expect(stocke.panier.lignes).toHaveLength(1);
});

test("paiement : la raison au-dessus de « Payer », puis le refus du serveur, donnent la même issue", async ({ page }, info) => {
  await poser(page);
  await enPanne(page, "**/api/panier");
  await page.goto("/commande");
  const raison = page.locator(".commande-form .panier-alerte");
  await expect(raison).toContainText("Le service fédéral des adresses ne répond pas.");
  await expect(raison.getByRole("link", { name: "Commander à emporter" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Payer/ })).toBeDisabled();
  await raison.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${CAPTURES}/registre-panne-paiement-${info.project.name}.png` });

  // Le panier passe, le paiement tombe sur la panne : même message, même lien.
  await page.unroute("**/api/panier");
  await enPanne(page, "**/api/commandes");
  await page.reload();
  await page.getByLabel("Prénom").fill("Test");
  await page.getByLabel("Nom", { exact: true }).fill("Registre");
  await page.getByLabel("Téléphone").fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill("registre@laferme.test");
  await page.getByRole("button", { name: /^Payer CHF/ }).click();
  const refus = page.locator(".panier-alerte[role=alert]");
  await expect(refus).toContainText("Commandez à emporter, ou appelez");
  await refus.getByRole("link", { name: "Commander à emporter" }).click();
  await expect(page).toHaveURL((u) => u.pathname === "/");
});
