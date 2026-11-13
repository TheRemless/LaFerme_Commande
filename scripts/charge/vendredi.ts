// Charge d'un vendredi soir contre un site LOCAL qui tourne sur le jeu de rush (docs/charge.md).
//
//   npm run charge:vendredi -- --site=http://localhost:3229 --minutes=5 --tablettes=15 --relecture=5
//   (--sans-version : la tablette redemande toujours la file complète, comme avant la file allégée)
//
// Simule en même temps : des tablettes qui relisent la file et les livraisons, des clients qui suivent leur
// commande (rafraîchissement toutes les 20 s), des livreurs, deux back-offices, et des commandes passées,
// payées (paiement de test) puis acceptées au rythme demandé. Affiche, par route, les temps (médiane, p95,
// p99, max), la taille des réponses et les erreurs.
// Refuse toute adresse qui n'est pas ce poste : aucune charge vers une préversion ni vers Supabase.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const arg = (nom: string, defaut: string) => process.argv.find((x) => x.startsWith(`--${nom}=`))?.slice(nom.length + 3) ?? defaut;
const SITE = arg("site", "http://localhost:3229");
const MINUTES = Number(arg("minutes", "5"));
const TABLETTES = Number(arg("tablettes", "15"));
const SUIVIS = Number(arg("suivis", "40"));
const LIVREURS = Number(arg("livreurs", "5"));
const BACK_OFFICES = Number(arg("back-offices", "2"));
const COMMANDES_HEURE = Number(arg("commandes-heure", "60"));
const RELECTURE_S = Number(arg("relecture", "5"));
const INSTANTANE = path.resolve(arg("instantane", ".pglite/rush.tar.gz"));
const AVEC_VERSION = !process.argv.includes("--sans-version");

const hote = new URL(SITE).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hote)) {
  console.error(`Charge refusée : ${SITE} n'est pas ce poste. Le test ne vise que le site local sur le jeu de rush.`);
  process.exit(1);
}

type Mesure = { ms: number; octets: number; statut: number };
const mesures = new Map<string, Mesure[]>();
let fin = 0;

async function appel(nom: string, url: string, init: RequestInit = {}): Promise<Response | null> {
  const t = performance.now();
  try {
    const r = await fetch(`${SITE}${url}`, { ...init, redirect: "manual" });
    const corps = await r.arrayBuffer();
    const m = { ms: performance.now() - t, octets: corps.byteLength, statut: r.status };
    mesures.set(nom, [...(mesures.get(nom) ?? []), m]);
    return new Response(corps, { status: r.status, headers: r.headers });
  } catch {
    mesures.set(nom, [...(mesures.get(nom) ?? []), { ms: performance.now() - t, octets: 0, statut: 0 }]);
    return null;
  }
}

const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const enTete = (ip: string, cookie?: string): Record<string, string> => ({
  Origin: SITE,
  "Content-Type": "application/json",
  "x-forwarded-for": ip,
  ...(cookie ? { Cookie: cookie } : {}),
});

async function connecter(email: string, ip: string): Promise<string> {
  const c = await fetch(`${SITE}/api/personnel/code`, { method: "POST", headers: enTete(ip), body: JSON.stringify({ email }) });
  const { codePreversion } = (await c.json()) as { codePreversion?: string };
  if (!codePreversion) throw new Error(`Pas de code pour ${email} (${c.status}) : le site tourne-t-il en local sur le jeu de rush ?`);
  const r = await fetch(`${SITE}/api/personnel/connexion`, { method: "POST", headers: enTete(ip), body: JSON.stringify({ email, code: codePreversion }) });
  const cookie = r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  if (!r.ok || !cookie) throw new Error(`Connexion refusée pour ${email} (${r.status})`);
  return cookie;
}

// Boucle qui répète une action à intervalle fixe, décalée au hasard au départ (les appareils ne sont pas synchrones).
async function boucle(intervalleMs: number, action: () => Promise<void>) {
  await attendre(Math.random() * intervalleMs);
  while (Date.now() < fin) {
    const t = Date.now();
    await action();
    await attendre(Math.max(0, intervalleMs - (Date.now() - t)));
  }
}

async function main() {
  // Jetons de suivi et plats commandables, lus dans l'instantané que le site a chargé.
  const db = await PGlite.create({ loadDataDir: new Blob([await readFile(INSTANTANE)]) });
  const jetons = (await db.query<{ j: string }>(
    `select jeton_suivi as j from commandes where jour_service = (now() at time zone 'Europe/Zurich')::date order by cree_le desc limit $1`,
    [SUIVIS],
  )).rows.map((r) => r.j);
  const pizzas = (await db.query<{ slug: string }>(
    `select p.slug from plats p join categories c on c.id = p.categorie_id
     where c.slug = 'pizzas' and p.commandable and p.archive_le is null and p.origine = 'carte'
       and (p.rupture_jour is null or p.rupture_jour <> (now() at time zone 'Europe/Zurich')::date) order by p.slug`,
  )).rows.map((r) => r.slug);
  await db.close();
  if (!jetons.length || !pizzas.length) throw new Error("Instantané sans commande du jour : relancer npm run donnees:rush.");

  const service = await connecter("lea.rush@exemple.test", "10.250.0.1");
  const livreur = await connecter("alba.rush@exemple.test", "10.250.0.2");
  const gerant = await connecter("gerant.rush@exemple.test", "10.250.0.3");
  const auj = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());

  console.log(
    `Charge : ${MINUTES} min, ${TABLETTES} tablettes (relecture ${RELECTURE_S} s), ${SUIVIS} suivis (20 s), ${LIVREURS} livreurs (15 s), ` +
      `${BACK_OFFICES} back-offices (30 s), ${COMMANDES_HEURE} commandes à l'heure, contre ${SITE}`,
  );
  const debut = Date.now();
  fin = debut + MINUTES * 60_000;
  const taches: Promise<void>[] = [];

  for (let i = 0; i < TABLETTES; i++) {
    // Comme la tablette : elle renvoie la version reçue (en-tête X-Version-File) ; 204 si rien n'a changé.
    // Sans cet en-tête (serveur plus ancien), la file complète à chaque fois. --sans-version force ce cas.
    let version: string | null = null;
    taches.push(
      boucle(RELECTURE_S * 1000, async () => {
        const [file] = await Promise.all([
          appel("tablette : file", `/api/tablette/file${version && AVEC_VERSION ? `?version=${encodeURIComponent(version)}` : ""}`, { headers: { Cookie: service } }),
          appel("tablette : livraisons", "/api/tablette/livraisons", { headers: { Cookie: service } }),
        ]);
        if (file?.status === 200) version = file.headers.get("x-version-file");
      }),
    );
  }
  for (let i = 0; i < SUIVIS; i++) {
    const jeton = jetons[i % jetons.length];
    // router.refresh() du suivi : la page en RSC.
    taches.push(boucle(20_000, async () => void (await appel("client : suivi", `/suivi/${jeton}`, { headers: { RSC: "1" } }))));
  }
  for (let i = 0; i < LIVREURS; i++) {
    taches.push(boucle(15_000, async () => void (await appel("livreur : tournée", "/api/livreur", { headers: { Cookie: livreur } }))));
  }
  for (let i = 0; i < BACK_OFFICES; i++) {
    taches.push(
      boucle(30_000, async () => {
        await appel("gestion : 7 jours", "/api/gestion/commandes", { method: "POST", headers: enTete("10.250.0.3", gerant), body: JSON.stringify({ action: "jours", debut: auj, fin: auj }) });
        await appel("gestion : liste du jour", "/api/gestion/commandes", { method: "POST", headers: enTete("10.250.0.3", gerant), body: JSON.stringify({ action: "liste", debut: auj, fin: auj }) });
      }),
    );
  }
  // Commandes : arrivées au hasard (loi de Poisson), payées puis acceptées par la tablette.
  let n = 0;
  taches.push(
    (async () => {
      while (Date.now() < fin) {
        await attendre(-Math.log(1 - Math.random()) * (3_600_000 / COMMANDES_HEURE));
        if (Date.now() >= fin) break;
        n++;
        const ip = `10.251.${Math.floor(n / 250)}.${(n % 250) + 1}`;
        void (async () => {
          const c = await appel("client : passer commande", "/api/commandes", {
            method: "POST",
            headers: enTete(ip),
            body: JSON.stringify({
              cle: `charge-${Date.now()}-${n}`,
              mode: "retrait",
              moyen: "en_ligne",
              quand: { type: "asap" },
              heure: "2026-11-10T19:05",
              client: { prenom: "Charge", nom: `Essai${n}`, telephone: "+41 00 000 99 99", email: `charge${n}@exemple.test` },
              lignes: [{ slug: pizzas[n % pizzas.length], qte: 1 + (n % 3), choix: {}, retraits: [], note: "" }],
            }),
          });
          const id = c?.ok ? ((await c.json()) as { redirection?: string }).redirection?.match(/paiement-test\/([0-9a-f-]+)/)?.[1] : undefined;
          if (!id) return;
          await appel("client : paiement (test)", "/api/paiement-test", { method: "POST", headers: enTete(ip), body: JSON.stringify({ commande: id, issue: "paye" }) });
          const f = await appel("tablette : file", "/api/tablette/file", { headers: { Cookie: service } });
          const file = f?.ok ? ((await f.json()) as { commandes: { id: string; heure_proposee: string }[] }) : null;
          const cmd = file?.commandes.find((x) => x.id === id);
          if (cmd) {
            await appel("tablette : accepter", "/api/tablette/action", {
              method: "POST",
              headers: enTete("10.250.0.1", service),
              body: JSON.stringify({ commande: id, action: "accepter", heure: cmd.heure_proposee, de: "nouvelle" }),
            });
          }
        })();
      }
    })(),
  );
  await Promise.all(taches);
  await attendre(3000);

  const duree = (Date.now() - debut) / 1000;
  const lignes = [...mesures].map(([nom, m]) => {
    const t = m.map((x) => x.ms).sort((a, b) => a - b);
    const q = (p: number) => Math.round(t[Math.min(t.length - 1, Math.floor(p * t.length))]);
    const erreurs = m.filter((x) => x.statut === 0 || x.statut >= 400).length;
    return {
      route: nom,
      requetes: m.length,
      "par s": (m.length / duree).toFixed(2),
      "médiane ms": q(0.5),
      "p95 ms": q(0.95),
      "p99 ms": q(0.99),
      "max ms": Math.round(t[t.length - 1]),
      "Ko moyen": Math.round(m.reduce((s, x) => s + x.octets, 0) / m.length / 1024),
      erreurs,
      statuts: [...new Set(m.map((x) => x.statut))].join(" "),
    };
  });
  console.table(lignes);
  const total = [...mesures.values()].flat();
  const ko = total.reduce((s, x) => s + x.octets, 0) / 1024;
  console.log(`${total.length} requêtes en ${duree.toFixed(0)} s (${(total.length / duree).toFixed(1)} par s), ${(ko / 1024).toFixed(1)} Mo servis, ${n} commandes tentées.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
