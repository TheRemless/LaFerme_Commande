import AxeBuilder from "@axe-core/playwright";
import { SITE, adresseDuCompte, codeDuPersonnel, passage } from "./site";
import { expect, test, type Page } from "@playwright/test";

// Rubrique Messages aux clients du back-office (vague 3, bo-operations). Le message est programmé pour
// après-demain puis retiré : il ne paraît jamais sur le site des autres fichiers de tests.
test.describe.configure({ mode: "serial", timeout: 90_000 });

const CAPTURES = "docs/rendus/vague-3/bo-operations";
const TEXTE = `Essai de l'écran ${passage()} : fermé le lundi de Pâques.`;

async function connecter(page: Page, email: string) {
  await adresseDuCompte(page, email);
  await page.goto("/gestion/messages");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByLabel("Code à 8 chiffres")).toHaveCount(0);
}

test("messages aux clients : programmer, erreurs, retirer", async ({ page }, info) => {
  test.skip(info.project.name !== "bureau", "messages communs à la base : projet bureau");
  await page.setViewportSize({ width: 1024, height: 900 });
  await connecter(page, "ecran-messages@laferme.test");
  try {
    await expect(page.getByRole("heading", { name: "Programmer un message" })).toBeVisible();

    // Modèles : le modèle remplit le champ ; tant qu'un crochet reste, rien ne part (écran et route).
    await page.getByRole("button", { name: "Vacances", exact: true }).click();
    await expect(page.getByLabel("Texte lu par les clients")).toHaveValue(/^Le restaurant est en vacances du \[premier jour\]/);
    await expect(page.getByLabel("Tout le site : accueil, carte, panier et paiement")).toBeChecked();
    await page.screenshot({ path: `${CAPTURES}/messages-modeles-1024.png` });
    await page.getByRole("button", { name: "Programmer le message" }).click();
    await expect(page.getByText("Remplacez les passages entre crochets ([jour], [localité]…) avant de programmer.")).toBeVisible();
    const crochets = await page.request.post("/api/gestion/messages", {
      headers: { Origin: SITE },
      data: { type: "ajouter", texte: "Fermé le [jour].", fin: new Date(Date.now() + 3600_000).toISOString() },
    });
    expect(crochets.status()).toBe(422);
    // Un autre modèle par-dessus un texte saisi : confirmation avant de remplacer.
    await page.getByRole("button", { name: "Zone fermée", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remplacer" }).click();
    await expect(page.getByLabel("Texte lu par les clients")).toHaveValue(/^Pas de livraison à \[localité\] ce soir\./);
    await expect(page.getByLabel("L'accueil seulement")).toBeChecked();
    await page.getByLabel("Texte lu par les clients").fill("");

    // Erreurs : texte trop court, fin avant le début.
    await page.getByLabel("Texte lu par les clients").fill("Oui");
    await page.getByRole("button", { name: "Programmer le message" }).click();
    await expect(page.getByText("De 5 à 200 caractères.")).toBeVisible();
    await expect(page.getByLabel("Texte lu par les clients")).toBeFocused();

    const apresDemain = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("Texte lu par les clients").fill(TEXTE);
    await expect(page.getByText(`${TEXTE.length} sur 200 caractères`)).toBeVisible();
    await page.getByLabel("Tout le site : accueil, carte, panier et paiement").check();
    await page.getByLabel("Une date et une heure").check();
    await page.getByLabel("Jour du début").fill(apresDemain);
    await page.getByLabel("Heure du début").fill("11:00");
    await page.getByLabel("Jour de fin").fill(apresDemain);
    await page.getByLabel("Heure de fin").fill("10:00");
    await page.getByRole("button", { name: "Programmer le message" }).click();
    await expect(page.getByText("Une fin après le début.")).toBeVisible();

    await page.getByLabel("Heure de fin").fill("23:00");
    await expect(page.getByText(/^Visible sur l'accueil, la carte, le panier et le paiement\. .* de 11h00 à 23h00\.$/)).toBeVisible();
    await page.getByRole("button", { name: "Programmer le message" }).click();
    await expect(page.getByText("Message programmé.")).toBeVisible();
    const ligne = page.locator(".bo-msg-ligne").filter({ hasText: TEXTE });
    await expect(ligne).toContainText("À venir");
    await expect(ligne).toContainText("Tout le site");
    // Le formulaire repart vide.
    await expect(page.getByLabel("Texte lu par les clients")).toHaveValue("");

    const axe = await new AxeBuilder({ page }).include(".bo-contenu").analyze();
    expect(axe.violations.map((v) => `${v.id} : ${v.nodes.length}`)).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${CAPTURES}/messages-1024.png`, fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await expect(ligne).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/messages-375.png`, fullPage: true });
    await page.setViewportSize({ width: 1024, height: 900 });

    await ligne.getByRole("button", { name: /^Retirer le message/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Retirer le message" }).click();
    await expect(page.getByText("Message retiré du site.")).toBeVisible();
    await expect(page.locator(".bo-msg-liste-passes .bo-msg-ligne").filter({ hasText: TEXTE }).first()).toContainText("Retiré");
  } finally {
    // Filet : tout message de ce test encore prévu est retiré.
    const r = await page.request.get("/api/gestion/messages");
    if (r.ok()) {
      const { messages } = (await r.json()) as { messages: { id: number; texte: string; retire_le: string | null }[] };
      for (const m of messages.filter((x) => x.texte === TEXTE && !x.retire_le)) {
        await page.request.post("/api/gestion/messages", { headers: { Origin: SITE }, data: { type: "retirer", id: m.id } });
      }
    }
  }
});
