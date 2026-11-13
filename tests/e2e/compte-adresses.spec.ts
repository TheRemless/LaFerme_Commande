import { expect, test } from "@playwright/test";
import { SITE } from "./site";

// Vague 3, client-compte : le client corrige les consignes d'une adresse enregistrée depuis son compte.
// Adresse posée par une commande en livraison passée connecté (l'adresse s'enregistre à la commande).
test("consignes d'une adresse : modifiées depuis le compte, refusées sans sonnette", async ({ page }, info) => {
  const email = `adr-${info.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@laferme.test`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.31.${info.project.name === "bureau" ? 1 : 2}.${Math.floor(Math.random() * 250)}` });
  await page.goto(`${SITE}/compte`);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const note = page.locator(".note-preversion strong");
  await expect(note).toHaveText(/^\d{6}$/);
  await page.getByLabel("Code à 6 chiffres").fill(await note.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("heading", { name: "Vos commandes" })).toBeVisible();
  // Une livraison payée, passée connecté : l'adresse s'enregistre dans le compte, comme en vrai.
  const rep = await page.request.post(`${SITE}/api/commandes`, {
    headers: { Origin: SITE },
    data: {
      cle: `adr-${info.project.name}-${Date.now()}`,
      mode: "livraison",
      moyen: "en_ligne",
      adresse: { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" },
      details: { etage: "", sonnette: "Rossi", code: "", instructions: "" },
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom: "Adèle", nom: "Essai", telephone: "079 000 00 00", email },
      lignes: [{ slug: "pizza-margherita", qte: 4, choix: {}, retraits: [], note: "" }],
    },
  });
  expect(rep.ok(), await rep.text()).toBe(true);
  const id = ((await rep.json()) as { redirection: string }).redirection.match(/paiement-test\/([0-9a-f-]+)/)![1];
  await page.request.post(`${SITE}/api/paiement-test`, { data: { commande: id, issue: "paye" } });

  await page.goto(`${SITE}/compte`);
  const adresse = page.locator(".adresses li").first();
  await expect(adresse).toContainText("sonnette Rossi");
  await adresse.getByRole("button", { name: /^Modifier les consignes/ }).click();
  await adresse.getByLabel("Nom sur la sonnette").fill("");
  await adresse.getByLabel("Code d'entrée").fill("4521");
  await adresse.getByRole("button", { name: "Enregistrer" }).click();
  // Le navigateur exige la sonnette (required) ; le serveur aussi.
  expect(await adresse.getByLabel("Nom sur la sonnette").evaluate((e) => (e as HTMLInputElement).validity.valueMissing)).toBe(true);
  await adresse.getByLabel("Nom sur la sonnette").fill("Rossi-Muller");
  await adresse.getByLabel("Étage").fill("3e");
  await adresse.getByLabel("Pour le livreur").fill("Porte de gauche.");
  await adresse.getByRole("button", { name: "Enregistrer" }).click();
  await expect(adresse).toContainText("étage 3e, sonnette Rossi-Muller, code 4521");
  await expect(adresse).toContainText("Porte de gauche.");
  await page.locator(".espace-bloc", { has: page.getByRole("heading", { name: "Vos adresses" }) }).screenshot({ path: "docs/rendus/vague-3/client-compte/compte-adresse.png" });
  // Le serveur refuse une sonnette vide, même sans le navigateur.
  const refus = await page.request.post(`${SITE}/api/compte/adresses`, {
    headers: { Origin: SITE },
    data: { modifier: "00000000-0000-0000-0000-000000000000", details: { etage: "", sonnette: "", code: "", instructions: "" } },
  });
  expect(refus.status()).toBe(422);
});
