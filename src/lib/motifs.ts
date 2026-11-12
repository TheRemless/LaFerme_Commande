// Motifs d'annulation partagés par la tablette et les courriels.
// Quand c'est le client qui annule (audit du gérant, G09), le courriel ne dit pas que le restaurant ne peut pas.
export const MOTIF_DEMANDE_CLIENT = "Annulée à votre demande.";

// [texte du bouton sur la tablette, motif envoyé au client]
export const MOTIFS_REFUS: [string, string][] = [
  ["À la demande du client", MOTIF_DEMANDE_CLIENT],
  ["La cuisine est complète pour ce service.", "La cuisine est complète pour ce service."],
  ["Un des plats commandés est épuisé.", "Un des plats commandés est épuisé."],
  ["Nous fermons plus tôt aujourd'hui.", "Nous fermons plus tôt aujourd'hui."],
];
