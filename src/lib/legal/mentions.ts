import type { PageLegale } from "@/lib/legal/types";

// Ébauche du 8.11.2026, à faire relire. Sources : docs/recherche/obligations_legales.md (LCD art. 3 al. 1 let. s),
// pages officielles des prestataires lues le 8.11.2026 (docs/legal-sources.md).
export const MENTIONS: PageLegale = {
  titre: "Mentions légales",
  misAJour: "Ébauche du 8 novembre 2026",
  sections: [
    {
      titre: "Qui vend",
      contenu: [
        "Restaurant La Ferme Sàrl, société à responsabilité limitée.",
        "Route de Chancy 132, 1213 Onex, Suisse.",
        "Téléphone 022 792 16 89. E-mail [adresse e-mail du restaurant].",
        "Numéro IDE CHE-103.250.692. Numéro TVA CHE-103.250.692 TVA.",
      ],
    },
    {
      titre: "Comment se passe une commande",
      contenu: [
        [
          "Vous choisissez la livraison ou la vente à emporter, puis l'adresse et l'heure.",
          "Vous choisissez les plats et leurs options. Le panier reste modifiable jusqu'au paiement : quantités, options, plats retirés.",
          "Vous donnez vos coordonnées et vous payez en ligne, ou au comptoir pour une commande à emporter.",
          "Vous recevez tout de suite un e-mail qui confirme la commande, avec son détail et le lien de suivi.",
          "Le restaurant accepte la commande et fixe l'heure : un deuxième e-mail vous la donne. S'il ne peut pas la préparer, il la refuse et le montant payé en ligne vous est remboursé.",
        ],
      ],
    },
    {
      titre: "Hébergement",
      contenu: [
        "Site hébergé par Netlify, Inc., 101 2nd Street, San Francisco, CA 94105, États-Unis.",
        "Base de données hébergée à Zurich (Suisse) par Supabase, contractant Supabase Pte. Ltd, Singapour.",
      ],
    },
    {
      titre: "Photos",
      contenu: ["Les photos des plats viennent d'un shooting professionnel dont le restaurant détient les droits."],
    },
  ],
};
