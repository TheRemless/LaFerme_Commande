import type { PageLegale } from "@/lib/legal/types";

// Ébauche du 8.11.2026, à faire relire par un professionnel. Les règles du site décrites ici sont celles
// du code (paiement, acceptation, remboursement). Les choix commerciaux non tranchés sont entre crochets.
export const CGV: PageLegale = {
  titre: "Conditions générales de vente",
  misAJour: "Ébauche du 8 novembre 2026",
  sections: [
    {
      titre: "À quoi elles s'appliquent",
      contenu: [
        "Ces conditions s'appliquent aux commandes de plats en livraison ou à emporter passées sur ce site auprès de Restaurant La Ferme Sàrl, Route de Chancy 132, 1213 Onex.",
      ],
    },
    {
      titre: "Commande et acceptation",
      contenu: [
        "La commande est enregistrée quand le paiement en ligne est confirmé, ou à son envoi pour un paiement au comptoir. Vous recevez aussitôt un e-mail de confirmation.",
        "Une commande passée par téléphone est enregistrée par l'équipe pendant l'appel. Si vous donnez votre adresse e-mail, vous recevez le récapitulatif et le lien de suivi.",
        "Le contrat est conclu quand le restaurant accepte la commande. L'heure de livraison ou de retrait s'affiche alors sur la page de suivi.",
        "Le restaurant peut refuser une commande, par exemple quand la cuisine est complète ou qu'un plat est épuisé. Le montant payé en ligne est alors remboursé en entier sur le moyen de paiement utilisé.",
      ],
    },
    {
      titre: "Prix",
      contenu: [
        "Les prix sont en francs suisses, TVA comprise. Ce sont ceux affichés au moment de la commande.",
        "Pour une livraison, les frais et le minimum de commande de votre zone sont affichés avant le paiement.",
      ],
    },
    {
      titre: "Paiement",
      contenu: [
        "En ligne, par TWINT ou carte bancaire, au moment de la commande. Le paiement est traité par Stripe. Le restaurant ne voit pas vos données de carte.",
        "Au comptoir, pour une commande à emporter. Pour une commande passée par téléphone, à la livraison ou au retrait, en espèces ou par carte.",
      ],
    },
    {
      // Cagnotte des clients (validée par Jérémy le 15.11.2026). Taux et seuil se règlent au back-office : la page
      // du compte affiche les valeurs en vigueur.
      titre: "Cagnotte",
      contenu: [
        "Avec un compte client, chaque commande livrée ou retirée vous rapporte 5 % du prix des plats dans votre cagnotte, ou le taux affiché dans votre compte s'il change. Les frais de livraison ne comptent pas. La part se calcule après code promo et cagnotte utilisée, arrondie au centime inférieur. Certains soirs annoncés par le restaurant, elle est doublée.",
        "Une commande refusée, annulée ou remboursée ne rapporte rien. Un remboursement partiel retire la part correspondante, au plus ce qui reste dans la cagnotte.",
        "Dès CHF 10, ou le montant affiché dans votre compte, vous déduisez la cagnotte au paiement en ligne, en tout ou en partie, jusqu'au prix des plats. CHF 0.50 au moins restent à payer en ligne. Elle ne sert ni au comptoir ni pour une commande passée par téléphone.",
        "La cagnotte utilisée réduit le prix de la commande. Elle revient dans votre cagnotte si la commande est refusée ou annulée, ou si le paiement échoue. Un remboursement rend l'argent payé, pas la cagnotte.",
        "Elle expire 12 mois après votre dernière commande. Un e-mail vous prévient 30 jours avant, sauf si vous avez décoché ce rappel dans votre compte.",
        "Parrainage. Votre compte vous donne un lien à envoyer à un proche qui n'a jamais commandé chez nous. Le proche crée son compte depuis ce lien avec une adresse e-mail encore inconnue du restaurant. Après sa première commande livrée ou retirée, vous recevez chacun CHF 10 dans votre cagnotte, ou le montant affiché dans votre compte.",
        "Rien n'est crédité si le téléphone ou l'adresse de livraison de cette commande sont les vôtres ou ont déjà servi pour une autre commande. Le crédit est repris si cette commande est remboursée en entier. Un proche n'a qu'un seul parrain. Un compte parraine au plus 10 proches par mois.",
      ],
    },
    {
      titre: "Livraison et retrait",
      contenu: [
        "La livraison est faite par les livreurs du restaurant, dans les zones et aux horaires affichés sur le site.",
        "L'heure annoncée est celle confirmée par le restaurant à l'acceptation. Si elle change, vous recevez un e-mail.",
        "Une commande à emporter se retire au restaurant, Route de Chancy 132 à Onex.",
        "[Ce qui se passe si le client est absent ou injoignable à la livraison, ou ne vient pas retirer sa commande (à décider par le restaurant).]",
      ],
    },
    {
      titre: "Annulation",
      contenu: [
        "[Si et comment le client peut annuler avant l'acceptation (à décider par le restaurant).]",
        "Le droit suisse ne prévoit pas de droit de rétractation pour un achat en ligne de ce type. [Point à faire confirmer par le relecteur.]",
      ],
    },
    {
      titre: "Allergènes et provenance",
      contenu: [
        "La provenance des viandes et des poissons est indiquée sur la fiche de chaque plat. Pour les allergènes, appelez-nous au 022 792 16 89 avant de commander.",
        // Vrai tant que la carte en ligne n'a pas d'alcool (liste de mise en ligne, docs/mise-en-ligne.md).
        "Le site ne vend pas de boissons alcoolisées.",
      ],
    },
    {
      titre: "Réclamations",
      contenu: ["Si un plat manque ou ne correspond pas à la commande, appelez le 022 792 16 89 dès la réception."],
    },
    {
      titre: "Données personnelles",
      contenu: ["Voir la déclaration de confidentialité."],
    },
    {
      titre: "Droit applicable",
      contenu: ["Droit suisse. [For juridique, à fixer par le relecteur en tenant compte des règles qui protègent les consommateurs.]"],
    },
  ],
};
