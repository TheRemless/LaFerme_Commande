// Alertes du back-office (vague 3, bo-socle) : la partie pure, lisible côté navigateur et côté serveur.
// Chaque alerte a une catégorie ; le gérant choisit, appareil par appareil, celles qui le préviennent hors de
// l'accueil (notification du navigateur). À ne pas confondre avec les types des alertes par e-mail
// (src/lib/alertes-types.ts, bo-operations, côté serveur seulement) : réglés au restaurant, pas par appareil.

export type CategorieAlerte = "acceptation" | "tablette" | "pause" | "impression" | "retard" | "livreurs" | "remboursements" | "courriels" | "comptoir";

export const CATEGORIES_ALERTE: { type: CategorieAlerte; libelle: string }[] = [
  { type: "acceptation", libelle: "Commande pas acceptée à temps" },
  { type: "tablette", libelle: "Tablette qui ne répond plus" },
  { type: "pause", libelle: "Commandes en ligne en pause" },
  { type: "impression", libelle: "Imprimante hors ligne, ticket pas imprimé" },
  { type: "retard", libelle: "Commandes après l'heure promise" },
  { type: "livreurs", libelle: "Aucun livreur prévu" },
  { type: "remboursements", libelle: "Remboursement échoué ou bloqué" },
  { type: "courriels", libelle: "Limite d'e-mails du jour" },
  { type: "comptoir", libelle: "Commandes au comptoir pas encaissées" },
];

/** Commande citée par une alerte : son jour, car les numéros repartent à 1 chaque jour. */
export type CommandeAlerte = { id: string; numero: number; jour: string };

export type Alerte = {
  cle: string;
  /** Facultatif pour les alertes construites ailleurs (sans-livreur de bo-operations, PR #189) : sans type,
   *  l'alerte prévient toujours quand les notifications sont demandées. */
  type?: CategorieAlerte;
  /** « bloquant » : le service en souffre maintenant. « attention » : à régler aujourd'hui. */
  niveau: "bloquant" | "attention";
  titre: string;
  detail?: string;
  depuis?: string;
  geste?: { href: string; texte: string };
  /** Les commandes en cause : un clic ouvre leur fiche. */
  commandes?: CommandeAlerte[];
  /** La liste des commandes déjà filtrée (filtres lus depuis l'adresse par la rubrique Commandes). */
  liste?: { href: string; texte: string };
};

/** Préférences d'un appareil : notifications du navigateur, et types qui en déclenchent une. */
export type PreferencesAlertes = { notifier: boolean; types: Record<CategorieAlerte, boolean> };

// Par défaut, ce qui ne peut pas attendre la fin du service : le reste se lit sur l'accueil.
export const PREFERENCES_PAR_DEFAUT: PreferencesAlertes = {
  notifier: false,
  types: {
    acceptation: true,
    tablette: true,
    pause: true,
    impression: true,
    retard: true,
    livreurs: true,
    remboursements: false,
    courriels: true,
    comptoir: false,
  },
};

/** Préférences lues d'un appareil (stockage local) : tout ce qui manque ou est mal formé reprend la valeur par défaut. */
export function lirePreferences(brut: unknown): PreferencesAlertes {
  const p = brut && typeof brut === "object" ? (brut as Partial<PreferencesAlertes>) : {};
  const types = { ...PREFERENCES_PAR_DEFAUT.types };
  if (p.types && typeof p.types === "object")
    for (const t of CATEGORIES_ALERTE) if (typeof (p.types as Record<string, unknown>)[t.type] === "boolean") types[t.type] = (p.types as Record<string, boolean>)[t.type];
  return { notifier: p.notifier === true, types };
}

/** Alertes qui méritent une notification : nouvelles depuis la dernière lecture, d'un type choisi. */
export function aNotifier(alertes: Alerte[], dejaVues: ReadonlySet<string>, prefs: PreferencesAlertes): Alerte[] {
  if (!prefs.notifier) return [];
  return alertes.filter((a) => !dejaVues.has(a.cle) && (a.type === undefined || prefs.types[a.type]));
}

/** Titre de l'onglet avec le nombre d'alertes devant : « (3) Commandes ». Retire un ancien compteur. */
export function titreAvecCompteur(titre: string, n: number): string {
  const nu = titre.replace(/^\(\d+\) /, "");
  return n > 0 ? `(${n}) ${nu}` : nu;
}
