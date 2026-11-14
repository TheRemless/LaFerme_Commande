import type { PageLegale } from "@/lib/legal/types";

// Ébauche du 8.11.2026, à faire relire (nLPD art. 19 : responsable, finalités, destinataires, pays étrangers
// et garanties). Faits sur les prestataires : pages officielles lues le 8.11.2026, détail dans docs/legal-sources.md.
// Ce qui est décrit est ce que le code fait aujourd'hui (données collectées, durées techniques).
export const CONFIDENTIALITE: PageLegale = {
  titre: "Déclaration de confidentialité",
  misAJour: "Ébauche du 8 novembre 2026",
  sections: [
    {
      titre: "Responsable",
      contenu: ["Restaurant La Ferme Sàrl, Route de Chancy 132, 1213 Onex. Téléphone 022 792 16 89. E-mail [adresse e-mail du restaurant]."],
    },
    {
      titre: "Ce que nous enregistrons",
      contenu: [
        [
          "Pour une commande : prénom, nom, téléphone, e-mail, adresse de livraison et ses compléments (étage, sonnette, code, instructions), plats choisis, notes, heure et montant.",
          "Si vous la signalez, une allergie ou une intolérance pour toute la commande. C'est une donnée de santé. Elle sert à la cuisine et n'est jamais recopiée dans votre compte ni dans un e-mail.",
          "Pour un compte client, si vous en créez un : e-mail, coordonnées, adresses de livraison enregistrées et historique des commandes.",
          "Pendant une livraison : la position du livreur, arrondie à une dizaine de mètres. Seul le client de la livraison en cours la voit sur sa page de suivi, jamais les autres clients de la même tournée.",
          "Pour la sécurité de la connexion : la date des connexions et un court extrait chiffré de l'adresse IP, sans votre adresse IP complète.",
          "Le paiement est traité par Stripe. Le site ne reçoit ni ne garde vos données de carte.",
        ],
        "Le site n'utilise ni outil de mesure d'audience ni publicité. Votre navigateur garde votre panier et votre choix de livraison pour vous éviter de les ressaisir. Un cookie de session n'est posé que si vous vous connectez à votre compte.",
      ],
    },
    {
      titre: "Pourquoi",
      contenu: ["Préparer, livrer ou remettre votre commande, l'encaisser, vous confirmer l'heure, gérer votre compte si vous en avez un, protéger les comptes contre les abus, tenir la comptabilité du restaurant."],
    },
    {
      titre: "Qui y a accès",
      contenu: [
        "Le personnel du restaurant et ses livreurs, pour préparer et livrer la commande.",
        [
          "Supabase : base de données hébergée à Zurich, en Suisse. Contractant Supabase Pte. Ltd, Singapour.",
          "Netlify, Inc., États-Unis : hébergement du site et traitements du serveur. [Région de calcul des fonctions : États-Unis (Ohio) aujourd'hui, Francfort possible avec le plan Pro de Netlify.]",
          "Stripe : paiement en ligne. Contractant pour la Suisse Stripe Payments Europe, Limited. Stripe, Inc. (États-Unis) traite aussi des données.",
          "Infomaniak Network SA, Les Acacias (Genève), Suisse : envoi des e-mails de commande et des codes de connexion, depuis la boîte e-mail du restaurant. [Lieu d'hébergement des e-mails à vérifier par le relecteur.]",
          "geo.admin.ch, service de la Confédération : quand vous tapez une adresse, votre navigateur l'envoie à ce service pour proposer les adresses officielles. Pendant la livraison, il y charge aussi la carte autour du livreur.",
          "Apple Plans ou Google Maps (ou l'application de navigation choisie sur Android) : quand le livreur ouvre l'itinéraire sur son téléphone, seule l'adresse de livraison part vers cette application, sans nom, téléphone ni code d'entrée. [Apple et Google la traitent selon leurs propres règles, aussi aux États-Unis. À vérifier par le relecteur.]",
        ],
      ],
    },
    {
      titre: "Données envoyées hors de Suisse",
      contenu: [
        "Vers les États-Unis : Netlify, Inc. et Stripe, Inc. sont certifiés au Swiss-U.S. Data Privacy Framework, que le Conseil fédéral reconnaît comme une protection adéquate pour les entreprises certifiées depuis le 15 septembre 2024.",
        "Vers Singapour (Supabase Pte. Ltd) : clauses contractuelles types avec un avenant suisse. Les données de la base restent hébergées à Zurich.",
        "[Liste et garanties à vérifier par le relecteur avec les contrats signés (DPA) de chaque prestataire.]",
      ],
    },
    {
      titre: "Combien de temps",
      contenu: [
        [
          "Commandes : [durée à fixer avec la fiduciaire pour la part comptable].",
          "Compte client : jusqu'à sa suppression, que vous pouvez faire vous-même dans votre espace. Les commandes déjà passées restent alors dans la comptabilité, sans lien avec un compte.",
          "Allergie ou intolérance : effacée 30 jours après la commande, sur la commande et sur les tickets de cuisine. Elle reste au plus 30 jours de plus dans les copies de sauvegarde chiffrées.",
          "Position du livreur : effacée dès que la commande est remise ou retirée de sa tournée, au plus tard 15 minutes après le dernier relevé. Aucun historique des trajets n'est gardé.",
          "Codes de connexion : valables 10 minutes, effacés ensuite lors du nettoyage régulier de la base. Sessions : valables 30 jours au plus. Journal des connexions : effacé après 6 mois, lors du même nettoyage.",
        ],
      ],
    },
    {
      titre: "Vos droits",
      contenu: [
        "Vous pouvez demander quelles données nous gardons sur vous, les faire corriger ou supprimer. Avec un compte, l'espace client permet de télécharger toutes vos données et de supprimer le compte vous-même. Sinon, écrivez à [adresse e-mail du restaurant] ou appelez le 022 792 16 89.",
        "Vous pouvez aussi vous adresser au Préposé fédéral à la protection des données et à la transparence (PFPDT).",
      ],
    },
    {
      titre: "Sécurité",
      contenu: ["Les échanges avec le site sont chiffrés. Les données des commandes et des comptes ne sont accessibles qu'au serveur du site et au personnel du restaurant connecté à la tablette ou au back-office. Les codes de connexion et les sessions ne sont gardés que sous forme d'empreinte."],
    },
  ],
};
