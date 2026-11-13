import AxeBuilder from "@axe-core/playwright";
import { SITE, connecterPersonnelApi, passage } from "./site";
import { expect, test, type Page } from "@playwright/test";

// Bannière des messages aux clients sur le site (vague 3, client-commande). Les messages sont programmés
// dans deux heures : les autres tests ne les voient jamais. Ici, l'horloge du navigateur avance de trois
// heures : la page sort du cache sans eux, puis le navigateur les montre à son heure. Retirés à la fin.
test.describe.configure({ mode: "serial" });

const CAPTURES = "docs/rendus/vague-3/client-commande";
// Textes d'essai, jamais lus par un client (base locale). Le suffixe distingue les passages.
const PARTOUT = `Message d'essai pour tout le site ${passage()}.`;
const ACCUEIL = `Message d'essai pour l'accueil ${passage()}.`;
const HEURE = 3600_000;

async function choisirEmporter(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, enregistreLe: Date.now() }));
  });
}

test("messages du gérant : à l'heure prévue, à leur place, puis partis", async ({ page, playwright }, info) => {
  test.skip(info.project.name !== "bureau", "messages communs à la base : projet bureau");
  // Au réessai, la connexion attend la fin du délai d'un code par e-mail (30 s).
  test.setTimeout(120_000);
  const gerant = await playwright.request.newContext({ baseURL: SITE, extraHTTPHeaders: { Origin: SITE } });
  await connecterPersonnelApi(gerant, "bandeau-client@laferme.test");
  const debut = Date.now() + 2 * HEURE;
  const ids: number[] = [];
  const ajouter = async (texte: string, emplacement: string) => {
    const r = await gerant.post("/api/gestion/messages", {
      data: { type: "ajouter", texte, emplacement, debut: new Date(debut).toISOString(), fin: new Date(debut + 2 * HEURE).toISOString() },
    });
    expect(r.status(), await r.text()).toBe(200);
    ids.push((await r.json()).id);
  };
  try {
    await ajouter(PARTOUT, "partout");
    await ajouter(ACCUEIL, "accueil");
    const bandeau = page.getByRole("region", { name: "Information du restaurant" });

    // Pas encore commencés : rien.
    await page.goto("/");
    await expect(page.getByRole("button", { name: /À emporter/ })).toBeVisible();
    await expect(bandeau).toHaveCount(0);

    // Trois heures plus tard : les deux sur l'accueil.
    await page.clock.setFixedTime(debut + HEURE);
    await page.goto("/");
    await expect(bandeau.getByText(PARTOUT, { exact: true })).toBeVisible();
    await expect(bandeau.getByText(ACCUEIL, { exact: true })).toBeVisible();
    const axe = await new AxeBuilder({ page }).include(".messages-clients").analyze();
    expect(axe.violations.map((v) => `${v.id} : ${v.nodes.length}`)).toEqual([]);
    for (const [nom, width, height] of [["bureau", 1280, 800], ["mobile", 375, 812], ["320", 320, 640]] as const) {
      await page.setViewportSize({ width, height });
      await page.reload();
      await expect(bandeau.getByText(PARTOUT, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      // Sur téléphone, le haut de la page seulement : l'en-tête, les messages et le bandeau de préversion.
      await page.screenshot({ path: `${CAPTURES}/messages-accueil-${nom}.png`, clip: nom === "bureau" ? undefined : { x: 0, y: 0, width, height: 260 } });
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // Carte, panier et paiement : seulement celui de tout le site.
    await choisirEmporter(page);
    for (const chemin of ["/carte", "/panier", "/commande"]) {
      await page.goto(chemin);
      await expect(bandeau.getByText(PARTOUT, { exact: true }), chemin).toBeVisible();
      await expect(bandeau.getByText(ACCUEIL, { exact: true }), chemin).toHaveCount(0);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/carte");
    await expect(bandeau.getByText(PARTOUT, { exact: true })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/messages-carte-mobile.png` });

    // Fin passée : partis, sans recharger la page (le navigateur retrie toutes les 30 secondes).
    await page.clock.setFixedTime(debut + 2 * HEURE + 60_000);
    await expect(bandeau).toHaveCount(0, { timeout: 40_000 });
  } finally {
    for (const id of ids) await gerant.post("/api/gestion/messages", { data: { type: "retirer", id } });
    await gerant.dispose();
  }
});
