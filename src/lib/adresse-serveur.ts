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
  if (rep.status === 404 || rep.status === 400) return null;
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

function normaliser(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Adresse saisie à la main : on la cherche dans l'index fédéral et on ne la garde que si la rue,
// le numéro et le NPA correspondent exactement. Sinon, pas de livraison sans appel au restaurant.
export async function retrouverAdresse(a: { rue: string; numero: string; npa: string; localite: string }): Promise<string | null> {
  const { lireLibelle } = await import("@/lib/adresse");
  const params = new URLSearchParams({ searchText: `${a.rue} ${a.numero} ${a.npa}`, type: "locations", origins: "address", limit: "10", sr: "4326" });
  const rep = await fetch(`${RECHERCHE}?${params}`, { signal: AbortSignal.timeout(4000) });
  if (!rep.ok) throw new Error(`geo.admin a répondu ${rep.status}`);
  const corps = (await rep.json()) as { results?: { attrs: { label: string; featureId?: string } }[] };
  for (const r of corps.results ?? []) {
    const trouvee = lireLibelle(r.attrs.label, r.attrs.featureId);
    if (
      trouvee?.featureId &&
      trouvee.npa === a.npa.trim() &&
      normaliser(trouvee.rue) === normaliser(a.rue) &&
      normaliser(trouvee.numero) === normaliser(a.numero)
    ) {
      return trouvee.featureId;
    }
  }
  return null;
}
