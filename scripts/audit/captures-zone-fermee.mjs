// Captures de la zone fermée à l'accueil (vague 3, client-commande), 375 et 320 px.
// Réponse de /api/adresse simulée (zone fermée deux heures). Instance locale seulement :
// AUDIT_BASE=http://localhost:3226 node scripts/audit/captures-zone-fermee.mjs <dossier> <prefixe>
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3226";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Refusé hors instance locale : ${BASE}`);
const [dossier = "captures", prefixe = "apres"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const navigateur = await chromium.launch({ channel: "chrome" });
// 21h00 à Genève le jour même (heure d'hiver, UTC+1) : une reprise lisible sur la capture.
const jourGeneve = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
const jusqua = `${jourGeneve}T20:00:00Z`;
for (const largeur of [375, 320]) {
  const opts = { ...devices["iPhone 13"], viewport: { width: largeur, height: 812 } };
  delete opts.defaultBrowserType;
  const ctx = await navigateur.newContext({ ...opts, locale: "fr-CH" });
  const p = await ctx.newPage();
  await p.route("**/api/adresse", (r) => r.fulfill({ json: { statut: prefixe === "avant" ? "hors-zone" : "zone-fermee", verifiee: true, jusqua } }));
  await p.goto(`${BASE}/?heure=2026-11-10T19:05`);
  await p.waitForFunction(() => window.__laFermePret === true);
  await p.getByLabel("Adresse de livraison").fill("Avenue du Gros-Chêne 20");
  await p.locator(".suggestions button").first().click();
  await p.waitForTimeout(1500);
  await p.locator(".verdict").first().evaluate((e) => e.scrollIntoView({ block: "center" }));
  await p.screenshot({ path: `${dossier}/${prefixe}-zone-fermee-${largeur}.png` });
  await ctx.close();
}
await navigateur.close();
