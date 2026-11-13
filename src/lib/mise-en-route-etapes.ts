// Mise en route du back-office (vague 3, bo-socle ; demande de Jérémy du 13.11.2026 : « paramétrer pour lancer le
// service dans 10 minutes »). Partie pure, lisible côté navigateur : les étapes, cochées d'après l'état réel, avec
// leur mode d'emploi. Chaque phrase vient d'un guide du dépôt (impression.md, tablette.md, livreurs.md,
// mise-en-ligne.md) ; ce qui touche aux comptes externes (Infomaniak, Stripe, Netlify) renvoie au guide de mise en
// service (docs/mise-en-service.md, produit-gestion), jamais à un réglage inventé ici.

export type EtatMiseEnRoute = {
  equipe: number;
  tablette_vue_le: string | null;
  /** Identifiants des imprimantes dont un ticket de test est sorti. */
  imprimantes_testees: number[];
  zones_actives: number;
  zones_a_valider: number;
  horaires: number;
  horaires_a_valider: number;
  plats_bloquants: number;
  livreurs: number;
  livreurs_connectes: number;
  courriels_envoyes: number;
  evenements_paiement: number;
  essai_rembourse: boolean;
};

/** Ce que la base ne sait pas : état des imprimantes (serveur d'impression), variables présentes (sans leur valeur). */
export type EtatServeur = {
  imprimantes: { id: number; nom: string; station: "pizza" | "cuisine"; actif: boolean; en_ligne: boolean }[];
  courriel_branche: boolean;
  paiement_branche: boolean;
  alertes_adresse: boolean;
};

export type Lien = { href: string; texte: string };
export type Etape = {
  cle: string;
  titre: string;
  faite: boolean;
  /** Où on en est, en une phrase (« 2 zones encore en proposition. »). */
  etat: string;
  /** Pas à pas, dans l'ordre. */
  marche: string[];
  liens: Lien[];
  /** Renvoi au guide pour ce qui se règle hors du site (comptes, matériel). */
  guide?: string;
};

export type MiseEnRoute = { etapes: Etape[]; faites: number; total: number; finie: boolean };

/** Espaces insécables de la typographie française : un guillemet ou un deux-points ne passe jamais seul à la ligne. */
export const insecables = (t: string) => t.replace(/« /g, "«\u00a0").replace(/ »/g, "\u00a0»").replace(/ ([:?!;])/g, "\u00a0$1");

const NB = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;
const GUIDE = "Guide de mise en service (docs/mise-en-service.md)";

function imprimante(station: "pizza" | "cuisine", e: EtatMiseEnRoute, s: EtatServeur): Etape {
  const poste = station === "pizza" ? "pizza" : "cuisine";
  const actives = s.imprimantes.filter((i) => i.station === station && i.actif);
  const testee = actives.find((i) => i.en_ligne && e.imprimantes_testees.includes(i.id));
  const enLigne = actives.find((i) => i.en_ligne);
  return {
    cle: `imprimante-${station}`,
    titre: `Brancher l'imprimante ${poste}`,
    faite: Boolean(testee),
    etat: testee
      ? `${testee.nom} est en ligne et son ticket de test est sorti.`
      : enLigne
        ? `${enLigne.nom} est en ligne. Il reste à imprimer un ticket de test.`
        : actives.length
          ? `${actives[0].nom} est ajoutée mais hors ligne.`
          : `Aucune imprimante active pour le poste ${poste}.`,
    marche: [
      "Imprimante conseillée : Star mC-Print3, référence MCP31CI BK, la version Ethernet. Prévoir des rouleaux thermiques de 80 mm et un câble Ethernet.",
      "Branchez l'imprimante en Ethernet au switch du restaurant, puis allumez-la.",
      `Dans Imprimantes, ajoutez-la au poste ${poste} seulement maintenant qu'elle est branchée et allumée, puis copiez son adresse tout de suite. L'adresse n'est montrée qu'une fois.`,
      "Ouvrez la page de réglages de l'imprimante (son adresse IP dans un navigateur), rubrique CloudPRNT. Activez CloudPRNT en HTTP (pas MQTT), collez l'adresse dans « Server URL » et réglez l'intervalle d'interrogation à 10 secondes. Pas d'identifiant ni de mot de passe.",
      "Micrologiciel de l'imprimante : version 3.2 au moins, 3.5 ou plus récente conseillée.",
      "Dans la minute, l'imprimante passe « en ligne ». Touchez « Imprimer un ticket de test » dans Imprimantes. Le ticket doit sortir de cette imprimante.",
      "Si elle est en ligne mais que rien ne sort, touchez « Nouvelle adresse » dans Imprimantes, puis collez la nouvelle adresse dans ses réglages.",
    ],
    liens: [{ href: "/gestion/imprimantes", texte: "Ouvrir Imprimantes" }],
  };
}

/** Les étapes dans l'ordre du lancement, cochées d'après l'état réel. Pur : tests/unit/mise-en-route.test.ts. */
export function etapesMiseEnRoute(e: EtatMiseEnRoute, s: EtatServeur): MiseEnRoute {
  const etapes: Etape[] = [
    {
      cle: "equipe",
      titre: "Ajouter l'équipe de la tablette",
      faite: e.equipe > 0,
      etat: e.equipe > 0 ? `${NB(e.equipe, "personne a", "personnes ont")} accès à la tablette.` : "Personne d'autre que le gérant n'a accès à la tablette.",
      marche: [
        "Dans Équipe, ajoutez chaque personne avec son e-mail et l'accès « Tablette ».",
        "Chacun se connecte avec son adresse e-mail et le code à 8 chiffres qu'il reçoit.",
      ],
      liens: [{ href: "/gestion/equipe", texte: "Ouvrir Équipe" }],
    },
    {
      cle: "tablette",
      titre: "Connecter la tablette et démarrer le service",
      faite: e.tablette_vue_le !== null,
      etat: e.tablette_vue_le ? "Un appareil a déjà démarré le service." : "Aucun appareil n'a encore démarré le service.",
      marche: [
        "Sur la tablette du comptoir, ouvrez l'adresse /tablette du site et connectez-vous avec votre e-mail et le code reçu.",
        "Ajoutez la page à l'écran d'accueil. Elle s'ouvre alors en plein écran.",
        "Touchez « Démarrer le service ». Le son s'active et l'écran reste allumé.",
        "Pendant un service, sans signe de vie d'un appareil qui a démarré le service depuis 3 minutes, le site met les commandes en ligne en pause et envoie une alerte.",
      ],
      liens: [{ href: "/tablette", texte: "Ouvrir la tablette" }],
      guide: `Quel appareil utiliser ? Voir le ${GUIDE.charAt(0).toLowerCase()}${GUIDE.slice(1)}.`,
    },
    imprimante("pizza", e, s),
    imprimante("cuisine", e, s),
    {
      cle: "horaires",
      titre: "Valider les horaires et les zones",
      faite: e.zones_actives > 0 && e.horaires > 0 && e.zones_a_valider === 0 && e.horaires_a_valider === 0,
      etat:
        e.zones_actives === 0
          ? "Aucune zone de livraison active."
          : e.zones_a_valider + e.horaires_a_valider > 0
            ? `Encore en proposition : ${[e.zones_a_valider ? NB(e.zones_a_valider, "zone", "zones") : "", e.horaires_a_valider ? NB(e.horaires_a_valider, "horaire", "horaires") : ""].filter(Boolean).join(" et ")}.`
            : "Zones et horaires validés.",
      marche: [
        "Dans Livraison et horaires, relisez chaque zone (frais, minimum, délais) et chaque horaire, ainsi que les fermetures.",
        "Enregistrer une valeur la valide.",
      ],
      liens: [{ href: "/gestion/horaires", texte: "Ouvrir Livraison et horaires" }],
    },
    {
      cle: "carte",
      titre: "Carte sans plat bloquant",
      faite: e.plats_bloquants === 0,
      etat: e.plats_bloquants === 0 ? "Rien ne bloque la mise en ligne." : `${NB(e.plats_bloquants, "plat bloque", "plats bloquent")} la mise en ligne.`,
      marche: [
        "Remplissez les cases jaunes du tableau de validation de la carte (prix, commandable, poste, provenance, allergènes).",
        "Importez-le dans « Importer le tableau », qui le vérifie avant de l'appliquer.",
        "Tant qu'un plat commandable a un prix à valider, la mise en ligne est refusée.",
      ],
      liens: [
        { href: "/gestion/carte", texte: "Ouvrir la Carte" },
        { href: "/gestion/import", texte: "Importer le tableau" },
      ],
    },
    {
      cle: "livreurs",
      titre: "Ajouter les livreurs",
      faite: e.livreurs > 0 && e.livreurs_connectes > 0,
      etat:
        e.livreurs === 0
          ? "Aucun livreur dans l'équipe."
          : `${NB(e.livreurs, "livreur", "livreurs")}, ${e.livreurs_connectes > 0 ? `dont ${e.livreurs_connectes} déjà connecté${e.livreurs_connectes > 1 ? "s" : ""}` : "aucun encore connecté"}.`,
      marche: [
        "Dans Équipe, ajoutez chaque livreur avec l'accès « Livreur ».",
        "Sur son téléphone, il ouvre l'adresse /livreur du site et se connecte avec son e-mail et le code reçu. Sa session dure 12 heures.",
        "Il y voit ses livraisons dans l'ordre et touche « Je pars » puis « Livrée ». Sur la tablette, l'onglet « Livraisons » lui donne les commandes.",
        "Qui livre quel soir se règle dans Livreurs.",
      ],
      liens: [
        { href: "/gestion/equipe", texte: "Ouvrir Équipe" },
        { href: "/gestion/livreurs", texte: "Ouvrir Livreurs" },
      ],
    },
    {
      cle: "alertes",
      titre: "Choisir l'adresse des alertes",
      faite: s.alertes_adresse,
      etat: s.alertes_adresse ? "Les alertes du service ont une adresse." : "Aucune adresse ne reçoit les alertes du service.",
      marche: ["Dans Réglages généraux, saisissez l'adresse qui reçoit les alertes du service (commande pas acceptée à temps, tablette muette)."],
      liens: [{ href: "/gestion/reglages", texte: "Ouvrir Réglages généraux" }],
    },
    {
      cle: "courriels",
      titre: "Brancher l'envoi des e-mails",
      faite: s.courriel_branche && e.courriels_envoyes > 0,
      etat: !s.courriel_branche
        ? "L'envoi n'est pas branché. Aucun e-mail ne part."
        : e.courriels_envoyes > 0
          ? `${NB(e.courriels_envoyes, "e-mail est parti", "e-mails sont partis")}.`
          : "L'envoi est branché, aucun e-mail n'est encore parti.",
      marche: [
        "L'adresse d'envoi se crée chez Infomaniak, puis ses réglages se saisissent dans Netlify. Les mots de passe ne passent jamais par une conversation.",
        "Une fois l'envoi branché, demander un code de connexion suffit pour vérifier qu'un e-mail part.",
      ],
      liens: [],
      guide: GUIDE,
    },
    {
      cle: "paiement",
      titre: "Brancher le paiement en ligne",
      faite: s.paiement_branche && e.evenements_paiement > 0,
      etat: !s.paiement_branche
        ? "Le paiement en ligne n'est pas branché."
        : e.evenements_paiement > 0
          ? "Stripe a déjà prévenu le site d'un paiement."
          : "Les clés sont posées, aucun paiement n'est encore arrivé.",
      marche: [
        "Le compte Stripe (TWINT, cartes) et son webhook se règlent avec le guide. Les clés se saisissent dans Netlify, jamais dans une conversation.",
      ],
      liens: [],
      guide: GUIDE,
    },
    {
      cle: "essai",
      titre: "Passer une commande d'essai et la rembourser",
      faite: e.essai_rembourse,
      etat: e.essai_rembourse ? "Une commande payée en ligne a été remboursée." : "Aucune commande payée en ligne n'a encore été remboursée.",
      marche: [
        "Passez une commande de faible montant payée en ligne, puis refusez-la sur la tablette.",
        "Le remboursement doit arriver. Vérifiez aussi les tickets et les e-mails.",
      ],
      liens: [{ href: "/tablette", texte: "Ouvrir la tablette" }],
      guide: GUIDE,
    },
  ];
  const faites = etapes.filter((x) => x.faite).length;
  const propres = etapes.map((x) => ({ ...x, titre: insecables(x.titre), etat: insecables(x.etat), marche: x.marche.map(insecables), guide: x.guide && insecables(x.guide) }));
  return { etapes: propres, faites, total: etapes.length, finie: faites === etapes.length };
}
