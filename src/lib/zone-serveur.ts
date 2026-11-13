import "server-only";
import { adresseOfficielle, retrouverAdresse } from "@/lib/adresse-serveur";
import { chargerOptionsCommande } from "@/lib/options-commande";
import { zonePour, zonePourNpaSeul, type ConfigService, type Zone } from "@/lib/service";
import { MESSAGE_REGISTRE_EN_PANNE } from "@/lib/registre-panne";

// Zone d'une adresse décidée par le serveur. Avec un identifiant du registre fédéral, l'adresse
// officielle fait foi. Sans (saisie à la main), seul le NPA compte.

const LONGUEUR_MAX = 120;

export function champ(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 && v.length <= LONGUEUR_MAX ? v.trim() : null;
}

// nonVerifiee : acceptée sur son seul NPA pendant une panne du registre fédéral (C15). Enregistrée avec la
// commande : la tablette avertit l'équipe, qui contrôle la rue avant d'accepter.
export type AdresseRetenue = { rue: string; numero: string; npa: string; localite: string; featureId?: string; nonVerifiee?: true };

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
      return surLeNpaSeul(config, a);
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
      return surLeNpaSeul(config, a);
    }
    if (!officielle) return { erreur: "Adresse introuvable dans le registre fédéral.", code: 422 };
    if (officielle.canton !== "GE") return { statut: "hors-zone", verifiee: true };
    npa = officielle.npa;
    localite = officielle.localite;
    verifiee = true;
    // L'adresse officielle fait foi : c'est elle qui est enregistrée, pas celle tapée par le client.
    retenue = { rue: officielle.rue, numero: officielle.numero, npa: officielle.npa, localite: officielle.localite, featureId };
  } else if (a.nonVerifiee === true) {
    // Au panier (sans appel au registre) : une adresse acceptée sur son NPA pendant la panne garde le même
    // calcul, pour que le total ne change pas d'une page à l'autre. Le drapeau vient du navigateur, mais il ne
    // peut que rendre la livraison plus chère ; au paiement, le registre est de nouveau interrogé.
    return surLeNpaSeul(config, a);
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

// Registre fédéral muet (panne, délai dépassé). Réglage npa_seul_en_panne_actif (C15) : l'adresse tapée est
// acceptée sur son seul NPA, au prix de la zone la plus chère de ce NPA, et marquée « non vérifiée ». Éteint, ou
// adresse sans rue ni NPA lisibles : le client lit le message de panne (à emporter ou téléphone).
async function surLeNpaSeul(config: ConfigService, a: Record<string, unknown>): Promise<ResultatZoneServeur> {
  const panne = { erreur: MESSAGE_REGISTRE_EN_PANNE, code: 503 } as const;
  const rue = champ(a.rue);
  const npa = champ(a.npa);
  if (!rue || !npa || !/^\d{4}$/.test(npa)) return panne;
  if (!(await chargerOptionsCommande()).npa_seul_en_panne_actif) return panne;
  const r = zonePourNpaSeul(config, npa);
  if (r.statut === "zone-fermee" && r.jusqua) return { statut: "zone-fermee", verifiee: false, jusqua: r.jusqua };
  if (r.statut !== "livrable") return { statut: "hors-zone", verifiee: false };
  return {
    statut: "livrable",
    zone: r.zone,
    verifiee: false,
    // Sans l'identifiant du registre : rien ne la fait passer pour vérifiée plus loin.
    adresse: { rue, numero: champ(a.numero) ?? "", npa, localite: champ(a.localite) ?? "", nonVerifiee: true },
  };
}
