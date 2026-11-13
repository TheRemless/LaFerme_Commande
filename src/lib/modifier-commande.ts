import "server-only";
import { chargerConfigService } from "@/lib/config-service";
import { courrielModification } from "@/lib/courriel/modeles";
import { envoyerCourriel } from "@/lib/courriel/envoi";
import { commandeParId, fonctionSql } from "@/lib/db/serveur";
import { auteur, type Personnel } from "@/lib/personnel/session";
import { signalerTablette } from "@/lib/tablette";
import { detailsValides, telephoneValide } from "@/lib/validation";
import { zoneServeur } from "@/lib/zone-serveur";

// Modifier une commande acceptée sans toucher au montant (vague 3, bo-commandes, PR B, lot n°1) : prénom,
// nom, téléphone, consignes de livraison, adresse dans la même zone. Appelée par le back-office et, avec
// ses propres gestes, par la tablette. La base revérifie l'auteur, l'état et la zone (modifier_commande).

export type DemandeModification = {
  prenom?: unknown;
  nom?: unknown;
  telephone?: unknown;
  details?: unknown;
  adresse?: unknown;
};
export type ResultatModification = { ok: boolean; message: string; champs?: string[] };

const ERREURS: Record<string, string> = {
  personnel_inactif: "Votre accès a été retiré. Reconnectez-vous.",
  commande_inconnue: "Commande introuvable.",
  deja_change: "Cette commande a déjà changé. La liste se met à jour.",
  reserve_gerant: "Commande prête ou partie : seul le gérant peut la modifier.",
  statut_non_modifiable: "Une commande terminée ou annulée ne se modifie plus.",
  pas_une_livraison: "C'est une commande à emporter : pas d'adresse à modifier.",
  zone_differente: "Cette adresse est dans une autre zone, avec d'autres frais. Elle ne peut pas être changée ici.",
  champ_invalide: "Un champ est vide ou trop long.",
};

function texte(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length >= 1 && t.length <= max ? t : null;
}

// Contrôle de forme, sans base. Ce qui n'est pas demandé n'est pas envoyé.
export function champsModification(d: DemandeModification): { ok: true; p: Record<string, unknown> } | { ok: false; erreur: string } {
  const p: Record<string, unknown> = {};
  if (d.prenom !== undefined) {
    const t = texte(d.prenom, 60);
    if (!t) return { ok: false, erreur: "Indiquez le prénom." };
    p.client_prenom = t;
  }
  if (d.nom !== undefined) {
    const t = texte(d.nom, 60);
    if (!t) return { ok: false, erreur: "Indiquez le nom." };
    p.client_nom = t;
  }
  if (d.telephone !== undefined) {
    const t = texte(d.telephone, 20);
    if (!t || !telephoneValide(t)) return { ok: false, erreur: "Vérifiez le numéro de téléphone, il faut au moins neuf chiffres." };
    p.client_telephone = t;
  }
  if (d.details !== undefined) {
    const det = detailsValides(d.details);
    if (!det) return { ok: false, erreur: "Indiquez au moins le nom sur la sonnette (étage, code et instructions courts)." };
    p.details_livraison = det;
  }
  if (Object.keys(p).length === 0 && d.adresse === undefined) return { ok: false, erreur: "Rien à modifier." };
  return { ok: true, p };
}

// depuis : « gestion » pour le back-office (auteur « gestion:Nom », comme les remboursements), sinon la tablette.
export async function modifierCommande(
  commandeId: string,
  d: DemandeModification,
  personnel: Personnel,
  options: { de?: string; depuis?: "gestion" | "tablette" } = {},
): Promise<ResultatModification> {
  const f = champsModification(d);
  if (!f.ok) return { ok: false, message: f.erreur };
  const avant = await commandeParId(commandeId);
  if (!avant) return { ok: false, message: ERREURS.commande_inconnue };
  const p = f.p;
  if (d.adresse !== undefined) {
    if (avant.mode !== "livraison") return { ok: false, message: ERREURS.pas_une_livraison };
    // Même contrôle qu'au paiement : registre fédéral, puis zone décidée par le serveur, jamais par l'écran.
    const z = await zoneServeur(await chargerConfigService(), d.adresse, true);
    if ("erreur" in z) return { ok: false, message: z.erreur };
    if (z.statut !== "livrable") return { ok: false, message: "Cette adresse est hors de notre zone de livraison." };
    if (z.zone.numero !== avant.zone_numero) return { ok: false, message: ERREURS.zone_differente };
    p.adresse = z.adresse;
    p.zone_numero = z.zone.numero;
  }
  let r: { modifie: boolean; champs: string[] };
  try {
    r = await fonctionSql("modifier_commande", { p_commande: commandeId, p, p_personnel: personnel.id, p_par: options.depuis === "gestion" ? `gestion:${personnel.nom}` : auteur(personnel), p_de: options.de ?? null });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const cle = Object.keys(ERREURS).find((k) => m.includes(k));
    if (cle) return { ok: false, message: ERREURS[cle] };
    throw e;
  }
  if (!r.modifie) return { ok: true, message: "Rien n'a changé.", champs: [] };
  const apres = await commandeParId(commandeId);
  if (apres) {
    await envoyerCourriel({ commandeId, destinataire: apres.client_email, ...courrielModification(apres, r.champs) }).catch((e) =>
      console.error(`Courriel de modification non envoyé pour la commande ${apres.numero} : ${e instanceof Error ? e.message : e}`),
    );
  }
  await signalerTablette();
  return { ok: true, message: "Commande modifiée. Le client reçoit le nouveau récapitulatif par e-mail.", champs: r.champs };
}
