import "server-only";
import { adresseOfficielle, retrouverAdresse } from "@/lib/adresse-serveur";
import { zonePour, type ConfigService, type Zone } from "@/lib/service";
import { MESSAGE_REGISTRE_EN_PANNE } from "@/lib/registre-panne";

// Zone d'une adresse décidée par le serveur. Avec un identifiant du registre fédéral, l'adresse
// officielle fait foi. Sans (saisie à la main), seul le NPA compte.

const LONGUEUR_MAX = 120;

export function champ(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 && v.length <= LONGUEUR_MAX ? v.trim() : null;
}

export type AdresseRetenue = { rue: string; numero: string; npa: string; localite: string; featureId?: string };

export type ResultatZoneServeur =
  | { statut: "livrable"; zone: Zone; verifiee: boolean; adresse: AdresseRetenue }
  | { statut: "hors-zone"; verifiee: boolean }
  // Zone fermée jusqu'à une heure (neige, livreur malade) : la livraison reprend à jusqua. Une zone désactivée
  // sans date reste « hors zone ».
  | { statut: "zone-fermee"; verifiee: boolean; jusqua: string }
  | { erreur: string; code: 422 | 503 };

// exigerRegistre : au paiement, une adresse saisie à la main doit être retrouvée dans le registre fédéral,
// sinon un client pourrait annoncer le NPA d'une zone moins chère que la sienne.
export async function zoneServeur(config: ConfigService, adresse: unknown, exigerRegistre = false): Promise<ResultatZoneServeur> {
  const a = (adresse && typeof adresse === "object" ? adresse : {}) as Record<string, unknown>;
  let featureId = champ(a.featureId);
  if (!featureId && exigerRegistre) {
    const rue = champ(a.rue);
    const numero = champ(a.numero) ?? "";
    const npa = champ(a.npa);
    const localite = champ(a.localite) ?? "";
    if (!rue || !npa || !/^\d{4}$/.test(npa)) return { erreur: "Indiquez la rue, le numéro et le NPA.", code: 422 };
    try {
      featureId = await retrouverAdresse({ rue, numero, npa, localite });
    } catch {
      return { erreur: MESSAGE_REGISTRE_EN_PANNE, code: 503 };
    }
    if (!featureId) {
      return { erreur: "Nous ne trouvons pas cette adresse. Vérifiez\u2011la, ou appelez\u2011nous au 022\u00a0792\u00a016\u00a089.", code: 422 };
    }
  }
  let npa: string | null;
  let localite: string | null;
  let verifiee = false;
  let retenue: AdresseRetenue | null = null;
  if (featureId) {
    let officielle;
    try {
      officielle = await adresseOfficielle(featureId);
    } catch {
      return { erreur: MESSAGE_REGISTRE_EN_PANNE, code: 503 };
    }
    if (!officielle) return { erreur: "Adresse introuvable dans le registre fédéral.", code: 422 };
    if (officielle.canton !== "GE") return { statut: "hors-zone", verifiee: true };
    npa = officielle.npa;
    localite = officielle.localite;
    verifiee = true;
    // L'adresse officielle fait foi : c'est elle qui est enregistrée, pas celle tapée par le client.
    retenue = { rue: officielle.rue, numero: officielle.numero, npa: officielle.npa, localite: officielle.localite, featureId };
  } else {
    npa = champ(a.npa);
    localite = champ(a.localite);
    if (!npa || !/^\d{4}$/.test(npa) || !localite) return { erreur: "Indiquez un NPA à quatre chiffres et une localité.", code: 422 };
  }
  const r = zonePour(config, npa, localite);
  retenue ??= { rue: champ(a.rue) ?? "", numero: champ(a.numero) ?? "", npa, localite };
  if (r.statut === "livrable") return { statut: "livrable", zone: r.zone, verifiee, adresse: retenue };
  if (r.statut === "zone-fermee" && r.jusqua) return { statut: "zone-fermee", verifiee, jusqua: r.jusqua };
  return { statut: "hors-zone", verifiee };
}
