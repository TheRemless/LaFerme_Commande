// Gestes de la vague 3 joués pendant une charge (npm run charge:vendredi en parallèle), contre le site LOCAL
// sur le jeu de rush : four en panne puis réparé, décalage des commandes en cours, coup de feu lancé puis fini.
// Chaque scène vérifie son effet et chronomètre le geste.
//
//   npx tsx scripts/charge/scenes.ts --site=http://localhost:3229
const SITE = process.argv.find((x) => x.startsWith("--site="))?.slice(7) ?? "http://localhost:3229";
if (!["localhost", "127.0.0.1"].includes(new URL(SITE).hostname)) {
  console.error("Scènes refusées : le site visé n'est pas ce poste.");
  process.exit(1);
}

const entete = (cookie: string, ip: string) => ({ Origin: SITE, "Content-Type": "application/json", "x-forwarded-for": ip, Cookie: cookie });
const resultats: { scene: string; ok: boolean; ms: number; detail: string }[] = [];

async function connecter(email: string, ip: string): Promise<string> {
  const c = await fetch(`${SITE}/api/personnel/code`, { method: "POST", headers: { Origin: SITE, "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email }) });
  const { codePreversion } = (await c.json()) as { codePreversion?: string };
  const r = await fetch(`${SITE}/api/personnel/connexion`, { method: "POST", headers: { Origin: SITE, "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email, code: codePreversion }) });
  return r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
}

async function appel(cookie: string, ip: string, url: string, corps?: unknown): Promise<{ ms: number; statut: number; json: Record<string, unknown> }> {
  const t = performance.now();
  const r = await fetch(`${SITE}${url}`, corps === undefined ? { headers: entete(cookie, ip) } : { method: "POST", headers: entete(cookie, ip), body: JSON.stringify(corps) });
  const texte = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(texte);
  } catch {}
  return { ms: Math.round(performance.now() - t), statut: r.status, json };
}

// Ce soir à 19h05 (heure de test des préversions) : en plein service, le jour de la panne posée « ce soir ».
const VENDREDI_SOIR = `${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date())}T19:05`;
let n = 0;
async function pizza(): Promise<{ ok: boolean; erreur?: string }> {
  n++;
  const r = await fetch(`${SITE}/api/commandes`, {
    method: "POST",
    headers: { Origin: SITE, "Content-Type": "application/json", "x-forwarded-for": `10.252.0.${n}` },
    body: JSON.stringify({
      cle: `scene-${Date.now()}-${n}`, mode: "retrait", moyen: "en_ligne", quand: { type: "asap" }, heure: VENDREDI_SOIR,
      client: { prenom: "Scene", nom: `Essai${n}`, telephone: `+41 00 000 98 ${String(n).padStart(2, "0")}`, email: `scene${n}-${Date.now()}@exemple.test` },
      lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" }],
    }),
  });
  const j = (await r.json()) as { erreur?: string };
  return { ok: r.ok, erreur: j.erreur };
}

function noter(scene: string, ok: boolean, ms: number, detail: string) {
  resultats.push({ scene, ok, ms, detail });
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${scene} (${ms} ms) ${detail}`);
}

async function main() {
  const gerant = await connecter("gerant.rush@exemple.test", "10.253.0.1");
  const ipG = "10.253.0.1";
  if (!gerant) throw new Error("Connexion du gérant factice impossible : le site tourne-t-il sur le jeu de rush ?");

  // 1. Four en panne : le poste pizza en rupture, une pizza est refusée ; puis réparé, elle passe.
  const avant = await pizza();
  const panne = await appel(gerant, ipG, "/api/tablette/pannes", { cible: "poste:pizza", jusqu: "ce-soir" });
  const pendant = await pizza();
  noter("four en panne : pizza refusée", panne.statut === 200 && !pendant.ok, panne.ms, `avant ${avant.ok ? "acceptée" : `refusée (${avant.erreur})`}, pendant : ${pendant.ok ? "acceptée !" : pendant.erreur}`);
  const leve = await appel(gerant, ipG, "/api/tablette/pannes", { cible: "poste:pizza", jusqu: null });
  const apres = await pizza();
  noter("four réparé : pizza de nouveau acceptée", leve.statut === 200 && apres.ok === avant.ok, leve.ms, `après : ${apres.ok ? "acceptée" : `refusée (${apres.erreur})`}`);

  // 2. Décalage des commandes en cours de 15 minutes, chaque client prévenu.
  const apercu = await appel(gerant, ipG, "/api/gestion/decalage");
  const decale = await appel(gerant, ipG, "/api/gestion/decalage", { minutes: 15, cle: `scene-decalage-${Date.now()}` });
  noter(
    "décalage +15 min",
    decale.statut === 200 && decale.json.deja === false,
    decale.ms,
    `aperçu ${JSON.stringify(apercu.json)}, décalées ${decale.json.commandes}, clients prévenus ${decale.json.prevenus}`,
  );

  // 3. Coup de feu lancé puis fini (retard minimal, pour ne rien laisser derrière).
  const lance = await appel(gerant, ipG, "/api/gestion/coup-de-feu", { action: "lancer", retard_minutes: 1, duree_minutes: 15 });
  const etat = await appel(gerant, ipG, "/api/gestion/coup-de-feu");
  const fini = await appel(gerant, ipG, "/api/gestion/coup-de-feu", { action: "finir" });
  noter("coup de feu lancé puis fini", lance.statut === 200 && fini.statut === 200, lance.ms + fini.ms, `en cours pendant : ${JSON.stringify(etat.json.en_cours ?? null).slice(0, 80)}`);

  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`${resultats.length - echecs} scènes sur ${resultats.length} réussies.`);
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
