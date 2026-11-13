import "server-only";
import type { Adresse } from "@/lib/adresse";

// Registre fédéral des bâtiments : le serveur relit l'adresse officielle au lieu de croire le navigateur.
const REGISTRE = "https://api3.geo.admin.ch/rest/services/ech/MapServer/ch.bfs.gebaeude_wohnungs_register";

type Attributs = { strname?: string[]; deinr?: string; dplz4?: number; dplzname?: string; gdekt?: string };

export async function adresseOfficielle(featureId: string): Promise<(Adresse & { canton: string }) | null> {
  if (!/^\d{1,12}_\d{1,3}$/.test(featureId)) return null;
  const rep = await fetch(`${REGISTRE}/${featureId}?returnGeometry=false`, {
    signal: AbortSignal.timeout(4000),
    next: { revalidate: 86400 },
  });
  // Une réponse 4xx tient à la demande (identifiant inconnu ou mal formé) : adresse introuvable. Seuls le délai,
  // le réseau et une réponse 5xx sont une panne (relecture de qualite, #222).
  if (rep.status >= 400 && rep.status < 500) return null;
  if (!rep.ok) throw new Error(`Registre des bâtiments indisponible (${rep.status})`);
  const a = ((await rep.json()) as { feature?: { attributes?: Attributs } }).feature?.attributes;
  if (!a?.dplz4 || !a.dplzname) return null;
  return {
    rue: a.strname?.[0] ?? "",
    numero: a.deinr ?? "",
    npa: String(a.dplz4),
    localite: a.dplzname,
    canton: a.gdekt ?? "",
    featureId,
  };
}

const RECHERCHE = "https://api3.geo.admin.ch/rest/services/api/SearchServer";

// Adresse saisie à la main : on la cherche dans l'index fédéral et on ne la garde que si le NPA est
// identique, le numéro identique (espaces et casse mis à part) et la rue la même aux abréviations près
// (« Av. » pour « Avenue »). Sinon, pas de livraison sans appel au restaurant.
export async function retrouverAdresse(a: { rue: string; numero: string; npa: string; localite: string }): Promise<string | null> {
  const { lireLibelle, memeNumero, memeRue } = await import("@/lib/adresse");
  const params = new URLSearchParams({ searchText: texteRecherche(a), type: "locations", origins: "address", limit: "10", sr: "4326" });
  const rep = await fetch(`${RECHERCHE}?${params}`, { signal: AbortSignal.timeout(4000) });
  // 4xx : la demande elle-même est refusée, l'adresse n'est pas retrouvée. 5xx : panne.
  if (rep.status >= 400 && rep.status < 500) return null;
  if (!rep.ok) throw new Error(`geo.admin a répondu ${rep.status}`);
  const corps = (await rep.json()) as { results?: { attrs: { label: string; featureId?: string } }[] };
  for (const r of corps.results ?? []) {
    const trouvee = lireLibelle(r.attrs.label, r.attrs.featureId);
    if (
      trouvee?.featureId &&
      trouvee.npa === a.npa.trim() &&
      memeRue(a.rue, trouvee.rue) &&
      memeNumero(a.numero, trouvee.numero)
    ) {
      return trouvee.featureId;
    }
  }
  return null;
}

// geo.admin.ch refuse (400) un searchText de plus de 10 mots. Rue, numéro et NPA tiennent en 10 mots : les mots
// vides de la rue partent d'abord (« Chemin de la Gravière » → « Chemin Gravière »), puis la fin de la rue. La
// comparaison qui suit (memeRue) se fait toujours sur la rue entière.
const MOTS_MAX = 10;
const MOTS_VIDES = new Set(["de", "du", "des", "la", "le", "les", "l", "d", "à", "a", "au", "aux", "en", "et", "sur", "sous"]);

export function texteRecherche(a: { rue: string; numero: string; npa: string }): string {
  const mots = (t: string) => t.split(/[\s']+/).filter(Boolean);
  const fin = [...mots(a.numero), ...mots(a.npa)].slice(0, 3);
  let rue = mots(a.rue);
  if (rue.length + fin.length > MOTS_MAX) rue = rue.filter((m) => !MOTS_VIDES.has(m.toLowerCase()));
  return [...rue.slice(0, MOTS_MAX - fin.length), ...fin].join(" ");
}

// Le registre est-il vraiment en panne ? Une erreur sur l'adresse d'un client ne suffit pas : le serveur
// interroge une adresse connue (celle du restaurant). Si elle répond, ce n'est pas une panne. Résultat gardé
// 60 secondes par instance, pour ne pas doubler chaque appel pendant une vraie panne.
const ADRESSE_TEMOIN = "Route de Chancy 132 1213";
let temoin: { le: number; repond: boolean } | null = null;

export async function registreRepond(): Promise<boolean> {
  if (temoin && Date.now() - temoin.le < 60_000) return temoin.repond;
  let repond = false;
  try {
    const params = new URLSearchParams({ searchText: ADRESSE_TEMOIN, type: "locations", origins: "address", limit: "1", sr: "4326" });
    const rep = await fetch(`${RECHERCHE}?${params}`, { signal: AbortSignal.timeout(4000) });
    repond = rep.ok && (((await rep.json()) as { results?: unknown[] }).results?.length ?? 0) > 0;
  } catch {
    repond = false;
  }
  temoin = { le: Date.now(), repond };
  return repond;
}

// Tests : oublier le témoin gardé.
export function oublierTemoinRegistre(): void {
  temoin = null;
}
