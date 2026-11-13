// Captures du grisage d'un plat indisponible sur la carte (vague 3, client-commande), 375 et 320 px.
// Disponibilité simulée dans la page servie (lasagnes réservées à la livraison), client à emporter.
// Instance locale seulement : AUDIT_BASE=http://localhost:3226 node scripts/audit/captures-grisage.mjs <dossier> <prefixe>
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3226";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Refusé hors instance locale : ${BASE}`);
const [dossier = "captures", prefixe = "apres"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const navigateur = await chromium.launch({ channel: "chrome" });

for (const largeur of [375, 320]) {
  const opts = { ...devices["iPhone 13"], viewport: { width: largeur, height: 812 } };
  delete opts.defaultBrowserType;
  const ctx = await navigateur.newContext({ ...opts, locale: "fr-CH" });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "creneau", date: "2026-11-10", minutes: 1230 }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
  });
  await p.route("**/carte", async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    const html = (await rep.text()).replace(/(\\"slug\\":\\"lasagne-de-boeuf\\"[^}]*?\\"dispo\\":)null/g, '$1{\\"service\\":null,\\"mode\\":\\"livraison\\",\\"jours\\":null}');
    await r.fulfill({ response: rep, body: html });
  });
  await p.goto(`${BASE}/carte`);
  await p.waitForTimeout(1500);
  await p.locator('li[data-slug="lasagne-de-boeuf"]').evaluate((e) => e.scrollIntoView({ block: "center" }));
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${dossier}/${prefixe}-grisage-${largeur}.png` });
  await ctx.close();
}
await navigateur.close();
