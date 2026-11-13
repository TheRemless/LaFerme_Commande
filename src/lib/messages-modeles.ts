// Modèles de messages aux clients (vague 3, bo-operations), écrits avec redaction-fr dans la voix du restaurant et
// seulement avec des faits du registre (téléphone, adresse, à emporter). Proposés au back-office, jamais affichés
// sans action du gérant : un modèle remplit le champ, le gérant complète les passages entre crochets, puis programme.
// Un texte qui garde un crochet est refusé (écran et route). À faire valider par Jérémy. Doc : docs/messages-clients.md.

export type ModeleMessage = { cle: string; titre: string; texte: string; emplacement: "accueil" | "partout" };

export const MODELES_MESSAGES: ModeleMessage[] = [
  {
    cle: "fermeture",
    titre: "Fermeture exceptionnelle",
    texte: "Le restaurant est fermé le [jour]. On reprend les commandes le [jour de réouverture]. Une question ? 022 792 16 89",
    emplacement: "partout",
  },
  {
    cle: "vacances",
    titre: "Vacances",
    texte: "Le restaurant est en vacances du [premier jour] au [dernier jour]. On reprend les commandes le [jour de réouverture].",
    emplacement: "partout",
  },
  {
    cle: "retard",
    titre: "Retard général",
    texte: "Beaucoup de commandes ce soir. Comptez environ [15] minutes de plus que d'habitude.",
    emplacement: "partout",
  },
  {
    cle: "zone",
    titre: "Zone fermée",
    texte: "Pas de livraison à [localité] ce soir. Vous pouvez commander à emporter, Route de Chancy 132 à Onex.",
    emplacement: "accueil",
  },
  {
    cle: "nouveaute",
    titre: "Nouveauté",
    texte: "[Nom du plat] arrive à la carte le [jour].",
    emplacement: "accueil",
  },
];

// Vrai si le texte garde un passage à compléter ([jour], [localité]…).
export const resteACompleter = (texte: string) => /[[\]]/.test(texte);
export const MESSAGE_A_COMPLETER = "Remplacez les passages entre crochets ([jour], [localité]…) avant de programmer.";
