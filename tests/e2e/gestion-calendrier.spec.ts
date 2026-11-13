import AxeBuilder from "@axe-core/playwright";
import { SITE, adresseDuCompte } from "./site";
import { expect, test, type Page } from "@playwright/test";

// Rubrique Calendrier du back-office (vague 3, bo-operations). Ferme le midi d'un mardi dans deux mois (aucun
// autre test ne commande si loin), puis retire la fermeture, même après un échec.
test.describe.configure({ mode: "serial", timeout: 90_000 });

const ORIGINE = { Origin: SITE };
const CAPTURES = "docs/rendus/vague-3/bo-operations";
const MOTIF = "Essai e2e du calendrier";

async function connecter(page: Page, email: string) {
  await adresseDuCompte(page, email);
  await page.goto("/gestion/calendrier");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = page.locator(".note-preversion strong");
  // Premier appel après le démarrage du serveur : la page compile, d'où un délai plus large.
  await expect(code).toHaveText(/^\d{8}$/, { timeout: 20_000 });
  await page.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByLabel("Code à 8 chiffres")).toHaveCount(0);
}

// Retire les fermetures de ce test et vide le cache de la config. Appelée avant et après : ce cache vit dans
// .next/cache et survit au redémarrage du serveur, alors que la base embarquée repart de zéro ; un passage
// interrompu laisserait sinon sa fermeture visible au suivant.
async function nettoyer(page: Page) {
  const d = await (await page.request.get("/api/gestion/service")).json();
  // La base est neuve à chaque serveur mais pas le cache : réécrire un réglage à sa valeur le vide.
  await page.request.post("/api/gestion/service", { headers: ORIGINE, data: { type: "reglage-general", cle: "avance_jours", valeur: d.generaux?.avance_jours ?? 7 } });
  for (const f of (d.fermetures ?? []) as { id: number; motif: string }[]) {
    if (f.motif === MOTIF) await page.request.post("/api/gestion/service", { headers: ORIGINE, data: { type: "fermeture-suppr", id: f.id } });
  }
}

// Un mardi entre 56 et 62 jours d'ici (date de Genève approchée par l'UTC, sans effet à cet écart).
function mardiDansDeuxMois(): string {
  const d = new Date(Date.now() + 56 * 86_400_000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const moisEntre = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

test("calendrier : fermeture annuelle, fermer un midi, axe", async ({ page }, info) => {
  test.skip(info.project.name !== "bureau", "fermetures communes à la base : projet bureau");
  await page.setViewportSize({ width: 1024, height: 1000 });
  await connecter(page, "ecran-calendrier@laferme.test");
  const jour = mardiDansDeuxMois();
  await nettoyer(page);
  await page.reload();
  try {
    await expect(page.locator(".bo-cal-jour").first()).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/calendrier-1024.png`, fullPage: true });

    // Avancer jusqu'au mois du mardi choisi.
    const aujourdHui = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < moisEntre(aujourdHui, jour); i++) await page.getByRole("button", { name: "Mois suivant" }).click();
    const cellule = page.getByRole("button", { name: new RegExp(`^mardi ${Number(jour.slice(8))} `) });
    await expect(cellule).toBeVisible();
    await cellule.click();
    const fiche = page.getByRole("dialog");
    await fiche.getByLabel("Quoi").selectOption("midi");
    await fiche.getByLabel("Motif, lu par les clients").fill(MOTIF);
    await fiche.getByRole("button", { name: "Fermer", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Fermer le midi" }).click();
    await expect(page.getByText("Fermé.", { exact: true })).toBeVisible();
    // La fiche se ferme après l'enregistrement, et ne se rouvre pas.
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5_000 });
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(cellule).toContainText(`fermé : ${MOTIF}`);

    const axe = await new AxeBuilder({ page }).include(".bo-contenu").analyze();
    expect(axe.violations.map((v) => `${v.id} : ${v.nodes.length}`)).toEqual([]);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await expect(page.locator(".bo-cal-jour").first()).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/calendrier-375.png` });
  } finally {
    await nettoyer(page);
  }
});
