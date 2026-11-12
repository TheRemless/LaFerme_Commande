// Rend les supports en PDF (avec fond perdu, pour l'imprimeur) et en JPEG (pour relire).
// Depuis la racine du dépôt : node docs/lancement/supports/rendre.mjs
// Option : QR=https://exemple.ch/?ref=flyer-a5 node docs/lancement/supports/rendre.mjs
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const dossier = path.dirname(fileURLToPath(import.meta.url));
const sortie = path.join(dossier, "rendus");
fs.mkdirSync(sortie, { recursive: true });

const supports = [
  { fichier: "flyer.html", nom: "flyer-a5", pages: ["recto", "verso"] },
  { fichier: "autocollant.html", nom: "autocollant-80mm", pages: ["rond"] },
];

const navigateur = await chromium.launch({ channel: "chrome" });
const page = await navigateur.newPage({ deviceScaleFactor: 3 });
for (const s of supports) {
  const url = pathToFileURL(path.join(dossier, s.fichier));
  if (process.env.QR) url.searchParams.set("qr", process.env.QR);
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.documentElement.dataset.pret === "1");
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: path.join(sortie, `${s.nom}.pdf`), preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: "screen" });
  const feuilles = await page.locator(".feuille").all();
  for (let i = 0; i < feuilles.length; i++) {
    await feuilles[i].screenshot({ path: path.join(sortie, `${s.nom}-${s.pages[i]}.jpg`), type: "jpeg", quality: 88 });
  }
}
await navigateur.close();
console.log("Rendus dans", sortie);
