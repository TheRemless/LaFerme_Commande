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
