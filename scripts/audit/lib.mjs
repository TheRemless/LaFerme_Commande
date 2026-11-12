// Outils communs des scripts d'audit « samedi soir » (jetables, jamais lancés contre une préversion).
// Cible : l'instance locale sur base embarquée, http://localhost:3102 par défaut.

export const BASE = process.env.AUDIT_BASE ?? "http://localhost:3102";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Audit refusé hors instance locale : ${BASE}`);

export const ORIGINE = { Origin: BASE };
export const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));
export const t0 = Date.now();
export const depuis = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(7);

export const journal = [];
export function noter(type, detail) {
  const ligne = { t: Number(((Date.now() - t0) / 1000).toFixed(1)), type, ...detail };
  journal.push(ligne);
  console.log(`[${depuis()} s] ${type} ${JSON.stringify(detail)}`);
}

// Temps de réponse par geste.
export const mesures = {};
export function mesurer(nom, ms, ok = true) {
  (mesures[nom] ??= []).push({ ms, ok });
}
export function resumeMesures() {
  const r = {};
  for (const [nom, l] of Object.entries(mesures)) {
    const v = l.map((x) => x.ms).sort((a, b) => a - b);
    const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    r[nom] = { n: v.length, echecs: l.filter((x) => !x.ok).length, mediane: q(0.5), p95: q(0.95), max: v.at(-1) };
  }
  return r;
}

export async function http(methode, chemin, { corps, cookie, entetes = {}, nom } = {}) {
  const debut = performance.now();
  let rep;
  try {
    rep = await fetch(`${BASE}${chemin}`, {
      method: methode,
      headers: { ...ORIGINE, ...(corps !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...entetes },
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
  } catch (e) {
    if (nom) mesurer(nom, performance.now() - debut, false);
    return { status: 0, json: null, texte: String(e), entetes: new Headers() };
  }
  const brut = Buffer.from(await rep.arrayBuffer());
  const ms = performance.now() - debut;
  if (nom) mesurer(nom, ms, rep.ok);
  let json = null;
  const texte = brut.toString("utf8");
  try {
    json = JSON.parse(texte);
  } catch {}
  return { status: rep.status, json, texte, brut, entetes: rep.headers, ms };
}

// Connexion du personnel : la base embarquée renvoie le code à l'écran (pas de Resend).
export async function connecter(email) {
  const c = await http("POST", "/api/personnel/code", { corps: { email } });
  if (!c.json?.codePreversion) throw new Error(`Code non reçu pour ${email} : ${c.status} ${c.texte}`);
  const r = await fetch(`${BASE}/api/personnel/connexion`, {
    method: "POST",
    headers: { ...ORIGINE, "Content-Type": "application/json" },
    body: JSON.stringify({ email, code: c.json.codePreversion }),
  });
  const sc = r.headers.get("set-cookie") ?? "";
  const m = sc.match(/(laferme-personnel=[^;]+)/);
  if (!m) throw new Error(`Pas de cookie pour ${email} : ${r.status}`);
  return m[1];
}

// Lignes de panier types : options, retraits, accents et « œ ».
export const LIGNES = {
  margherita: { slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" },
  margheritaOptions: { slug: "pizza-margherita", qte: 2, choix: { "supplements-pizza": ["Ananas", "Anchois"] }, retraits: ["Origan"], note: "bien cuite" },
  prosciutto: { slug: "pizza-prosciutto", qte: 1, choix: {}, retraits: [], note: "" },
  lasagne: { slug: "lasagne-de-boeuf", qte: 1, choix: {}, retraits: [], note: "sans œufs, très chaud" },
  pesto: { slug: "pasta-al-pesto", qte: 1, choix: { "choix-pates": ["Penne"] }, retraits: [], note: "" },
  chevre: { slug: "salade-de-chevre-chaud", qte: 1, choix: {}, retraits: [], note: "" },
  gambas: { slug: "queues-de-gambas-decortiquees-poelees-a-la-creme-de-safran", qte: 1, choix: {}, retraits: [], note: "" },
};

export const ADRESSES = [
  { featureId: "1021714_1" }, // Route de Chancy 132, Onex (zone 1)
  { featureId: "1022055_0" }, // Avenue du Gros-Chêne 27, Onex (zone 1)
];

let suite = 0;
// Passe une commande comme le navigateur. Renvoie { id, numero?, statut, ms, erreur }.
export async function commander({ etiquette, mode = "retrait", moyen = "comptoir", lignes, quand = { type: "asap" }, cle }) {
  suite += 1;
  const corps = {
    cle: cle ?? `audit-${t0}-${suite}`,
    mode,
    moyen,
    quand,
    client: { prenom: etiquette, nom: "Audit", telephone: "079 000 00 00", email: `audit${suite}@laferme.test` },
    lignes,
    ...(mode === "livraison" ? { adresse: ADRESSES[suite % ADRESSES.length], details: { etage: "2e", sonnette: "Audit", code: "1234", instructions: "Porte à gauche" } } : {}),
  };
  const r = await http("POST", "/api/commandes", { corps, nom: `commande_${moyen}` });
  const redir = r.json?.redirection ?? "";
  const id = redir.match(/paiement-test\/([0-9a-f-]{36})/)?.[1] ?? null;
  return { status: r.status, redirection: redir, idPaiement: id, erreur: r.json?.erreur ?? null, ms: r.ms, cle: corps.cle };
}

export async function payer(idCommande, issue = "paye") {
  return http("POST", "/api/paiement-test", { corps: { commande: idCommande, issue }, nom: `paiement_${issue}` });
}
