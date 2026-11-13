// Zones de livraison, créneaux et état du restaurant. Fonctions pures : mêmes calculs dans le
// navigateur (réponse immédiate) et sur le serveur (contrôle). Heures locales de Genève.

export type Mode = "livraison" | "retrait";

export type Zone = {
  numero: number;
  nom: string;
  frais_centimes: number;
  minimum_centimes: number;
  delai_min: number;
  delai_max: number;
  active: boolean;
  proposition: boolean;
  // Services où la zone est livrée (absent : les deux). Zone fermée jusqu'à une heure (ISO), avec son motif
  // (vague 3, migration 20261130110000) : elle rouvre seule à l'heure dite.
  services?: ("midi" | "soir")[];
  fermee_jusqu_a?: string | null;
  fermee_motif?: string | null;
};
export type ZoneNpa = { npa: string; localite: string; zone_numero: number };
export type Horaire = {
  jour: number;
  service: "midi" | "soir";
  premiere_heure: string;
  derniere_heure: string;
  derniere_commande: string;
  derniere_commande_pizzas: string;
};
// Sans service : la journée entière. Avec : seulement ce service (audit du gérant, vague 2).
export type Fermeture = { debut: string; fin: string; motif: string; service?: "midi" | "soir" | null };
// Service ouvert un jour donné, avec ses heures : jour normalement fermé, ou heures différentes ce jour-là.
export type Ouverture = { jour: string; service: "midi" | "soir"; premiere_heure: string; derniere_heure: string; derniere_commande: string; derniere_commande_pizzas: string };
// preparation_minutes et les délais des zones comprennent déjà le retard du soir et l'allongement dû à la
// file (config-service.ts).
// impression_avance : les tickets d'une commande acceptée sortent ce temps avant l'heure promise, par mode (SS-11).
export type Reglages = {
  preparation_minutes: number;
  creneau_minutes: number;
  avance_jours: number;
  preparation_base?: number;
  retard_minutes?: number;
  impression_avance?: { livraison: number; retrait: number };
  // Heure promise réaliste (vague 3, src/lib/heure-reelle.ts) : allongement dû à la file réelle des postes,
  // déjà compris dans preparation_minutes et les délais des zones, comme retard_minutes. Le détail par poste
  // (Charge) reste sur le serveur : chargeDuMoment() dans src/lib/heure-reelle-serveur.ts.
  allongement_minutes?: number;
  fourchette?: { livraison: number; retrait: number };
  // Annulation par le client depuis son suivi (vague 3, C1) : faux par défaut, décision de Jérémy.
  annulation_client_active?: boolean;
};

export type Charge = {
  pizza: { articles: number; file_minutes: number; compte: boolean };
  cuisine: { articles: number; file_minutes: number; compte: boolean };
  preparation_minutes: number;
  plafond_minutes: number;
  allongement_minutes: number;
};

export type ConfigService = {
  zones: Zone[];
  npa: ZoneNpa[];
  horaires: Horaire[];
  fermetures: Fermeture[];
  ouvertures?: Ouverture[];
  reglages: Reglages;
  // Réglé depuis la tablette : pause des commandes en ligne (jusqu'à une heure, ou sans fin) et livraison fermée.
  pause?: { jusqua: string | null; active: boolean; livraisonFermee: boolean; auto?: boolean };
};

// ---------- Zones ----------

export type ResultatZone =
  | { statut: "livrable"; zone: Zone }
  | { statut: "hors-zone" }
  // jusqua : fermée jusqu'à cette heure (ISO), puis rouvre seule ; absent : zone fermée sans date.
  | { statut: "zone-fermee"; zone: Zone; jusqua?: string; motif?: string | null };

function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Zone fermée jusqu'à une heure encore à venir : cette heure (ISO), sinon null. Comparée à l'heure réelle,
// comme la pause : l'heure simulée des préversions (?heure=) ne la lève pas.
export function zoneFermeeJusqua(zone: Zone, reel = Date.now()): string | null {
  return zone.fermee_jusqu_a && new Date(zone.fermee_jusqu_a).getTime() > reel ? zone.fermee_jusqu_a : null;
}

export function zonePour(config: Pick<ConfigService, "zones" | "npa">, npa: string, localite: string, reel = Date.now()): ResultatZone {
  const lignes = config.npa.filter((l) => l.npa === npa.trim());
  let numero = lignes.find((l) => normaliser(l.localite) === normaliser(localite))?.zone_numero;
  // Localité écrite autrement (saisie à la main) : le NPA suffit s'il ne désigne qu'une zone.
  if (numero === undefined && lignes.length > 0 && new Set(lignes.map((l) => l.zone_numero)).size === 1) {
    numero = lignes[0].zone_numero;
  }
  const zone = config.zones.find((z) => z.numero === numero);
  if (!zone) return { statut: "hors-zone" };
  if (!zone.active) return { statut: "zone-fermee", zone };
  const jusqua = zoneFermeeJusqua(zone, reel);
  return jusqua ? { statut: "zone-fermee", zone, jusqua, motif: zone.fermee_motif ?? null } : { statut: "livrable", zone };
}

// ---------- Temps ----------

export type Instant = { date: string; jour: number; minutes: number };

const FORMAT_ZURICH = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function instantGeneve(maintenant: Date): Instant {
  const p = Object.fromEntries(FORMAT_ZURICH.formatToParts(maintenant).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, jour: jourIso(date), minutes: Number(p.hour) * 60 + Number(p.minute) };
}

// « 2026-11-10T19:05 » à l'heure de Genève → instant, heure d'été comprise.
export function depuisHeureGeneve(texte: string): Date | null {
  const m = texte.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  for (const decalage of ["+01:00", "+02:00"]) {
    const d = new Date(`${texte}:00${decalage}`);
    const ici = instantGeneve(d);
    if (ici.date === m[1] && ici.minutes === Number(m[2]) * 60 + Number(m[3])) return d;
  }
  return null;
}

export function jourIso(date: string): number {
  const j = new Date(`${date}T12:00:00Z`).getUTCDay();
  return j === 0 ? 7 : j;
}

export function ajouterJours(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function enMinutes(heure: string): number {
  const [h, m] = heure.split(":").map(Number);
  return h * 60 + m;
}

export function heureTexte(minutes: number): string {
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

const FORMAT_JOUR = new Intl.DateTimeFormat("fr-CH", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export function jourTexte(date: string): string {
  return FORMAT_JOUR.format(new Date(`${date}T12:00:00Z`));
}

function arrondir(minutes: number, pas: number): number {
  return Math.ceil(minutes / pas) * pas;
}

// Premier jour de service après une fermeture (60 jours au plus).
function reouvertureApres(config: ConfigService, fermeture: Fermeture): string | null {
  for (let d = 1; d <= 60; d++) {
    const date = ajouterJours(fermeture.fin, d);
    if (servicesDu(config, date).length) return date;
  }
  return null;
}

// Fermeture de la journée entière (une fermeture d'un seul service n'en est pas une).
export function fermeturePour(config: Pick<ConfigService, "fermetures">, date: string): Fermeture | undefined {
  return config.fermetures.find((f) => !f.service && f.debut <= date && date <= f.fin);
}

// Services ouverts un jour donné, fermetures et ouvertures exceptionnelles comprises (exportée pour le
// calendrier du back-office, src/lib/calendrier.ts).
export function servicesDu(config: ConfigService, date: string): Horaire[] {
  if (fermeturePour(config, date)) return [];
  const fermes = new Set(config.fermetures.filter((f) => f.service && f.debut <= date && date <= f.fin).map((f) => f.service));
  const ouverts = (config.ouvertures ?? []).filter((o) => o.jour === date);
  const jour = jourIso(date);
  // Une ouverture remplace les horaires habituels du même service ce jour-là.
  const services: Horaire[] = [
    ...config.horaires.filter((h) => h.jour === jour && !ouverts.some((o) => o.service === h.service)),
    ...ouverts.map(({ service, premiere_heure, derniere_heure, derniere_commande, derniere_commande_pizzas }) => ({
      jour,
      service,
      premiere_heure,
      derniere_heure,
      derniere_commande,
      derniere_commande_pizzas,
    })),
  ];
  return services.filter((h) => !fermes.has(h.service)).sort((a, b) => enMinutes(a.premiere_heure) - enMinutes(b.premiere_heure));
}

// Services d'un jour pour ce mode : en livraison, seulement ceux où la zone est livrée.
function servicesPour(config: ConfigService, date: string, mode: Mode, zone?: Zone): Horaire[] {
  const tous = servicesDu(config, date);
  return mode === "livraison" && zone?.services ? tous.filter((h) => zone.services!.includes(h.service)) : tous;
}

// Temps entre la commande et la remise : préparation au retrait, délai le plus court de la zone en livraison.
function delaiMinimum(config: ConfigService, mode: Mode, zone?: Zone): number {
  return mode === "livraison" && zone ? zone.delai_min : config.reglages.preparation_minutes;
}

function delaiMaximum(config: ConfigService, mode: Mode, zone?: Zone): number {
  return mode === "livraison" && zone ? zone.delai_max : config.reglages.preparation_minutes;
}

// Bornes d'un service. Panier 100 % poste pizza : commande jusqu'à derniere_commande_pizzas,
// remise jusqu'à la fin du service. Sinon commande jusqu'à derniere_commande, remise au plus tard
// le temps de préparer et de livrer une commande passée à cette heure-là.
function bornes(config: ConfigService, h: Horaire, mode: Mode, zone: Zone | undefined, pizzas: boolean) {
  const finService = enMinutes(h.derniere_heure);
  if (pizzas) return { finCommande: enMinutes(h.derniere_commande_pizzas), finRemise: finService };
  const finCommande = enMinutes(h.derniere_commande);
  return { finCommande, finRemise: Math.min(finService, finCommande + delaiMaximum(config, mode, zone)) };
}

// ---------- Créneaux ----------

export type Creneau = { date: string; minutes: number; service: Horaire["service"] };

export function creneaux(config: ConfigService, maintenant: Date, mode: Mode, zone?: Zone, pizzas = false): Creneau[] {
  const ici = instantGeneve(maintenant);
  const delai = delaiMinimum(config, mode, zone);
  const pas = config.reglages.creneau_minutes;
  const liste: Creneau[] = [];
  for (let d = 0; d <= config.reglages.avance_jours; d++) {
    const date = ajouterJours(ici.date, d);
    for (const h of servicesPour(config, date, mode, zone)) {
      const { finCommande, finRemise } = bornes(config, h, mode, zone, pizzas);
      let debut = enMinutes(h.premiere_heure);
      if (d === 0) {
        // Aujourd'hui : la commande doit partir avant la dernière commande du service.
        if (ici.minutes > finCommande) continue;
        debut = Math.max(debut, arrondir(ici.minutes + delai, pas));
      }
      for (let m = debut; m <= finRemise; m += pas) liste.push({ date, minutes: m, service: h.service });
    }
  }
  return liste;
}

// Créneau plein pour un mode (capacité atteinte, SS-02) : lu par l'accueil, jamais proposé au client.
export type CreneauPlein = { date: string; mode: Mode; minutes: number };

// Même texte au panier (vu dès le calcul) et au paiement (refus de creer_commande sous verrou).
export const MESSAGE_CRENEAU_COMPLET = "Ce créneau est complet. Choisissez une autre heure ou appelez-nous au 022\u00a0792\u00a016\u00a089.";

export function creneauxLibres(liste: Creneau[], pleins: CreneauPlein[], mode: Mode): Creneau[] {
  if (!pleins.length) return liste;
  const plein = new Set(pleins.filter((p) => p.mode === mode).map((p) => `${p.date} ${p.minutes}`));
  return liste.filter((c) => !plein.has(`${c.date} ${c.minutes}`));
}

export type EtatService =
  | { etat: "pause"; jusqua: string | null }
  | { etat: "livraison-fermee" }
  | { etat: "ouvert"; desQuePossible: number }
  | { etat: "ferme"; prochain: Creneau }
  | { etat: "fermeture"; fermeture: Fermeture; reouverture: string | null }
  | { etat: "aucun-creneau" };

// Pause en cours ? Une pause datée se lève seule à son heure ; sans heure, elle dure jusqu'à la reprise.
// La pause se compare toujours à l'heure réelle : l'heure simulée des préversions (?heure=) ne la lève pas.
export function pauseEnCours(config: ConfigService, _maintenant: Date, mode: Mode, reel = Date.now()): EtatService | null {
  const p = config.pause;
  if (!p) return null;
  if (p.active && (!p.jusqua || new Date(p.jusqua).getTime() > reel)) return { etat: "pause", jusqua: p.jusqua };
  if (mode === "livraison" && p.livraisonFermee) return { etat: "livraison-fermee" };
  return null;
}

// Phrase pour le client quand la commande en ligne est suspendue (accueil, panier, paiement).
export function messagePause(etat: EtatService): string | null {
  if (etat.etat === "pause") {
    return etat.jusqua
      ? `Les commandes en ligne reprennent à ${heureTexte(instantGeneve(new Date(etat.jusqua)).minutes)}. En attendant, commandez par téléphone au 022 792 16 89.`
      : "Les commandes en ligne sont en pause. Commandez par téléphone au 022 792 16 89.";
  }
  if (etat.etat === "livraison-fermee") {
    return "La livraison est fermée pour le moment. Vous pouvez commander à emporter, ou nous appeler au 022 792 16 89.";
  }
  return null;
}

export function etatService(config: ConfigService, maintenant: Date, mode: Mode, zone?: Zone, pizzas = false): EtatService {
  const suspendu = pauseEnCours(config, maintenant, mode);
  if (suspendu) return suspendu;
  const ici = instantGeneve(maintenant);
  const fermeture = fermeturePour(config, ici.date);
  if (fermeture) {
    return { etat: "fermeture", fermeture, reouverture: reouvertureApres(config, fermeture) };
  }
  const delai = delaiMinimum(config, mode, zone);
  for (const h of servicesPour(config, ici.date, mode, zone)) {
    const { finCommande, finRemise } = bornes(config, h, mode, zone, pizzas);
    // « Dès que possible » quand la cuisine peut lancer la commande maintenant.
    // Le retard du soir allonge l'heure promise, pas la fenêtre d'avant service (revue du lot gérant).
    // L'allongement dû à la file non plus.
    const ouvertDes = enMinutes(h.premiere_heure) - (delai - (config.reglages.retard_minutes ?? 0) - (config.reglages.allongement_minutes ?? 0));
    if (ici.minutes >= ouvertDes && ici.minutes <= finCommande) {
      const moyen = mode === "livraison" && zone ? Math.round((zone.delai_min + zone.delai_max) / 2) : delai;
      const promise = Math.max(enMinutes(h.premiere_heure), arrondir(ici.minutes + moyen, 5));
      // Une heure promise après la dernière remise possible ne se propose pas.
      if (promise <= finRemise) return { etat: "ouvert", desQuePossible: promise };
    }
  }
  const liste = creneaux(config, maintenant, mode, zone, pizzas);
  return liste.length ? { etat: "ferme", prochain: liste[0] } : { etat: "aucun-creneau" };
}

// Fermeture qui commence avant la fin des jours où l'on peut commander à l'avance (ou en cours),
// avec le premier jour de service qui suit. Sert à l'expliquer au client plutôt qu'« aucun créneau ».
export function fermetureProche(config: ConfigService, maintenant: Date): { fermeture: Fermeture; reouverture: string | null } | null {
  const ici = instantGeneve(maintenant);
  const limite = ajouterJours(ici.date, config.reglages.avance_jours);
  const fermeture = config.fermetures
    .filter((f) => !f.service && f.fin >= ici.date && f.debut <= limite)
    .sort((a, b) => (a.debut < b.debut ? -1 : 1))[0];
  if (!fermeture) return null;
  return { fermeture, reouverture: reouvertureApres(config, fermeture) };
}

// Un service du jour a-t-il commencé sans être fini ? (« trop tard pour dès que possible » contre « pas encore ouvert »)
export function serviceEnCours(config: ConfigService, maintenant: Date): boolean {
  const ici = instantGeneve(maintenant);
  return servicesDu(config, ici.date).some((h) => enMinutes(h.premiere_heure) <= ici.minutes && ici.minutes <= enMinutes(h.derniere_heure));
}

// Phrase quand le client n'a aucun moment possible (panier, paiement) : la fermeture si c'en est une.
export function messageSansCreneau(config: ConfigService, maintenant: Date): string {
  const f = fermetureProche(config, maintenant);
  if (!f) return "La commande en ligne est fermée en ce moment.";
  const dates = `Fermé du ${jourTexte(f.fermeture.debut)} au ${jourTexte(f.fermeture.fin)}.`;
  return f.reouverture ? `${dates} On rouvre le ${jourTexte(f.reouverture)}.` : dates;
}

// Le moment demandé est-il encore possible pour ce panier ? Contrôle serveur avant paiement.
export type Quand = { type: "asap" } | { type: "creneau"; date: string; minutes: number } | { type: "aucun" };

export function quandPossible(config: ConfigService, maintenant: Date, mode: Mode, zone: Zone | undefined, pizzas: boolean, quand: Quand): boolean {
  if (pauseEnCours(config, maintenant, mode)) return false;
  if (quand.type === "asap") return etatService(config, maintenant, mode, zone, pizzas).etat === "ouvert";
  if (quand.type === "creneau") {
    return creneaux(config, maintenant, mode, zone, pizzas).some((c) => c.date === quand.date && c.minutes === quand.minutes);
  }
  return false;
}
