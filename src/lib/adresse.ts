// Recherche d'adresses suisses par l'API fédérale geo.admin.ch (appel direct depuis le navigateur).

export type Adresse = {
  rue: string;
  numero: string;
  npa: string;
  localite: string;
  // Identifiant du bâtiment dans le registre fédéral, absent pour une adresse saisie à la main.
  featureId?: string;
  // Acceptée sur son seul NPA par le serveur pendant une panne du registre fédéral (C15).
  nonVerifiee?: true;
};

export type Details = { etage: string; sonnette: string; code: string; instructions: string };

const RECHERCHE = "https://api3.geo.admin.ch/rest/services/api/SearchServer";

type ResultatGeoAdmin = { attrs: { label: string; featureId?: string; origin: string } };

// « Avenue du Gros-Chêne 20 <b>1213 Onex</b> » → rue, numéro, NPA, localité.
export function lireLibelle(libelle: string, featureId?: string): Adresse | null {
  const m = libelle.match(/^(.*?)\s*<b>\s*(\d{4})\s+(.+?)\s*<\/b>\s*$/);
  if (!m) return null;
  const [, rueNumero, npa, localite] = m;
  const n = rueNumero.match(/^(.*\S)\s+(\d+\s?[a-zA-Z]?)$/);
  return { rue: n ? n[1] : rueNumero.trim(), numero: n ? n[2].replace(/\s/g, "") : "", npa, localite, featureId };
}

export async function chercherAdresses(texte: string, signal?: AbortSignal): Promise<Adresse[]> {
  const params = new URLSearchParams({ searchText: texte, type: "locations", origins: "address", limit: "8", sr: "4326" });
  const rep = await fetch(`${RECHERCHE}?${params}`, { signal });
  if (!rep.ok) throw new Error(`geo.admin a répondu ${rep.status}`);
  const corps = (await rep.json()) as { results?: ResultatGeoAdmin[] };
  const liste = (corps.results ?? [])
    .map((r) => lireLibelle(r.attrs.label, r.attrs.featureId))
    .filter((a): a is Adresse => a !== null);
  return trierSuggestions(liste, texte);
}

// ---------- Comparaison tolérante (saisie à la main) ----------

function mots(t: string): string[] {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// Abréviations courantes des rues suisses romandes, ramenées au mot entier.
const ABREVIATIONS: Record<string, string> = {
  av: "avenue",
  ave: "avenue",
  ch: "chemin",
  chem: "chemin",
  rte: "route",
  r: "rue",
  bd: "boulevard",
  bld: "boulevard",
  boul: "boulevard",
  pl: "place",
  imp: "impasse",
  prom: "promenade",
  sq: "square",
  pass: "passage",
  st: "saint",
  ste: "sainte",
};
const ARTICLES = new Set(["de", "du", "des", "la", "le", "les", "l", "d"]);

function cleRue(rue: string): string {
  return mots(rue)
    .map((m) => ABREVIATIONS[m] ?? m)
    .filter((m) => !ARTICLES.has(m))
    .join(" ");
}

// Même rue malgré les abréviations, la casse, les accents, les tirets et les articles.
// Le NPA et le numéro restent comparés à part, à l'identique : la zone vient toujours du registre.
export function memeRue(saisie: string, officielle: string): boolean {
  const a = cleRue(saisie);
  return a !== "" && a === cleRue(officielle);
}

export function memeNumero(saisi: string, officiel: string): boolean {
  return mots(saisi).join("") === mots(officiel).join("");
}

// Numéro de maison dans une recherche : le dernier mot isolé d'un à trois chiffres, avec une lettre éventuelle
// (« Chemin des 3 Communes 5 » donne 5). « 1213 » (un NPA) et « 31-Décembre » (un nom de rue) ne comptent pas.
export function numeroTape(texte: string): string | null {
  const mots = texte.toLowerCase().split(/\s+/).filter((m) => /^\d{1,3}[a-z]?$/.test(m));
  return mots.at(-1) ?? null;
}

// Le numéro tapé passe en tête, puis ses variantes (10a, 10b), puis le reste dans l'ordre reçu.
export function trierSuggestions(liste: Adresse[], texte: string): Adresse[] {
  const n = numeroTape(texte);
  if (!n) return liste;
  const rang = (a: Adresse) => {
    const num = a.numero.toLowerCase();
    return num === n ? 0 : /^\d+$/.test(n) && num.startsWith(n) && /^[a-z]$/.test(num.slice(n.length)) ? 1 : 2;
  };
  return liste.map((a, i) => ({ a, i })).sort((x, y) => rang(x.a) - rang(y.a) || x.i - y.i).map((x) => x.a);
}

export function adresseTexte(a: Pick<Adresse, "rue" | "numero" | "npa" | "localite">): string {
  return `${a.rue}${a.numero ? ` ${a.numero}` : ""}, ${a.npa} ${a.localite}`;
}
