// Droits fins de l'équipe (vague 3, bo-socle, décision D1). Le tableau vit en base (droit_personnel) : ici,
// seulement les noms des actions et leur libellé, pour l'écran Équipe, le menu et la documentation.
// Rôle « responsable de service » DÉSACTIVÉ tant que le réglage role_responsable_actif n'est pas à true.

export const ACTIONS_DROIT = {
  annuler_apres_prete: "Annuler après « Prête » ou une livraison partie",
  rembourser: "Rembourser après coup, jusqu'au montant de la commande",
  client_absent: "Client absent : rendre tout, une partie ou rien",
  modifier_commande: "Modifier une commande acceptée",
  voir_commandes: "Voir les commandes passées et retrouver un client",
  deconnecter_appareil: "Déconnecter un téléphone perdu (livreur, tablette)",
  fermer_service: "Fermer le service du jour (panne, coup dur)",
} as const;

export type ActionDroit = keyof typeof ACTIONS_DROIT;

/** Le gérant fait tout ; le reste du back-office (prix, carte, zones, équipe, chiffres, imprimantes) lui est réservé. */
export const RESERVE_AU_GERANT = [
  "Prix, carte, plat du jour, suppléments",
  "Zones, frais, horaires habituels, plafond du comptoir",
  "Ajouter ou retirer un employé, changer un accès",
  "Ventes, export comptable, clôture",
  "Imprimantes (adresse, désactiver), annuler depuis le journal",
] as const;
