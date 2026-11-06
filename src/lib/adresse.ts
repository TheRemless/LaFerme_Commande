// Recherche d'adresses suisses par l'API fédérale geo.admin.ch (appel direct depuis le navigateur).

export type Adresse = {
  rue: string;
  numero: string;
  npa: string;
  localite: string;
  // Identifiant du bâtiment dans le registre fédéral, absent pour une adresse saisie à la main.
  featureId?: string;
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
  return (corps.results ?? [])
    .map((r) => lireLibelle(r.attrs.label, r.attrs.featureId))
    .filter((a): a is Adresse => a !== null);
}

export function adresseTexte(a: Pick<Adresse, "rue" | "numero" | "npa" | "localite">): string {
  return `${a.rue}${a.numero ? ` ${a.numero}` : ""}, ${a.npa} ${a.localite}`;
}
