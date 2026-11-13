// Performance mobile (vague 3, client-commande) : Chrome en 4G lente (1,6 Mbit/s, 150 ms) et processeur
// ralenti 4 fois, comme le profil mobile de Lighthouse. Build de production local seulement :
// BASE_LOCALE=1 npm run build && BASE_LOCALE=1 npx next start -p 3226, puis
// AUDIT_BASE=http://localhost:3226 node scripts/audit/perf-mobile.mjs
// Mesures : LCP, octets transférés (dont JavaScript), délai avant que l'accueil réponde au doigt.
import { chromium, devices } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3226";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Refusé hors instance locale : ${BASE}`);
const navigateur = await chromium.launch({ channel: "chrome" });
const resultats = [];

for (const chemin of ["/", "/carte", "/panier", "/commande"]) {
  const mesures = [];
  for (let essai = 0; essai < 3; essai++) {
    const opts = { ...devices["Moto G4"] };
    delete opts.defaultBrowserType;
    const ctx = await navigateur.newContext({ ...opts, locale: "fr-CH" });
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, enregistreLe: Date.now() }));
      localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] }));
      window.__lcp = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    let octets = 0;
    let js = 0;
    cdp.on("Network.loadingFinished", (e) => (octets += e.encodedDataLength));
    const types = new Map();
    cdp.on("Network.responseReceived", (e) => types.set(e.requestId, e.type));
    cdp.on("Network.loadingFinished", (e) => {
      if (types.get(e.requestId) === "Script") js += e.encodedDataLength;
    });
    const t0 = Date.now();
    await p.goto(`${BASE}${chemin}`, { waitUntil: "load", timeout: 90_000 });
    let pret = null;
    if (chemin === "/") {
      await p.waitForFunction(() => window.__laFermePret === true, null, { timeout: 60_000 });
      pret = Date.now() - t0;
    }
    await p.waitForTimeout(1500);
    const lcp = await p.evaluate(() => window.__lcp);
    mesures.push({ lcp, octets, js, pret });
    await ctx.close();
  }
  const med = (k) => {
    const v = mesures.map((m) => m[k]).filter((x) => x !== null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  resultats.push({ page: chemin, lcp_ms: Math.round(med("lcp")), ko: Math.round(med("octets") / 1024), js_ko: Math.round(med("js") / 1024), reactif_ms: med("pret") });
}
await navigateur.close();
console.table(resultats);
console.log(JSON.stringify(resultats));
