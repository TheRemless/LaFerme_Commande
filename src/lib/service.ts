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
export type Fermeture = { debut: string; fin: string; motif: string };
export type Reglages = { preparation_minutes: number; creneau_minutes: number; avance_jours: number };

export type ConfigService = {
  zones: Zone[];
  npa: ZoneNpa[];
  horaires: Horaire[];
  fermetures: Fermeture[];
  reglages: Reglages;
};

// ---------- Zones ----------

export type ResultatZone =
  | { statut: "livrable"; zone: Zone }
  | { statut: "hors-zone" }
  | { statut: "zone-fermee"; zone: Zone };

function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function zonePour(config: Pick<ConfigService, "zones" | "npa">, npa: string, localite: string): ResultatZone {
  const lignes = config.npa.filter((l) => l.npa === npa.trim());
  let numero = lignes.find((l) => normaliser(l.localite) === normaliser(localite))?.zone_numero;
  // Localité écrite autrement (saisie à la main) : le NPA suffit s'il ne désigne qu'une zone.
  if (numero === undefined && lignes.length > 0 && new Set(lignes.map((l) => l.zone_numero)).size === 1) {
    numero = lignes[0].zone_numero;
  }
  const zone = config.zones.find((z) => z.numero === numero);
  if (!zone) return { statut: "hors-zone" };
  return zone.active ? { statut: "livrable", zone } : { statut: "zone-fermee", zone };
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

export function fermeturePour(config: Pick<ConfigService, "fermetures">, date: string): Fermeture | undefined {
  return config.fermetures.find((f) => f.debut <= date && date <= f.fin);
}

function servicesDu(config: ConfigService, date: string): Horaire[] {
  if (fermeturePour(config, date)) return [];
  return config.horaires
    .filter((h) => h.jour === jourIso(date))
    .sort((a, b) => enMinutes(a.premiere_heure) - enMinutes(b.premiere_heure));
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
    for (const h of servicesDu(config, date)) {
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

export type EtatService =
  | { etat: "ouvert"; desQuePossible: number }
  | { etat: "ferme"; prochain: Creneau }
  | { etat: "fermeture"; fermeture: Fermeture; reouverture: string | null }
  | { etat: "aucun-creneau" };

export function etatService(config: ConfigService, maintenant: Date, mode: Mode, zone?: Zone, pizzas = false): EtatService {
  const ici = instantGeneve(maintenant);
  const fermeture = fermeturePour(config, ici.date);
  if (fermeture) {
    let reouverture: string | null = null;
    for (let d = 1; d <= 60 && !reouverture; d++) {
      const date = ajouterJours(fermeture.fin, d);
      if (servicesDu(config, date).length) reouverture = date;
    }
    return { etat: "fermeture", fermeture, reouverture };
  }
  const delai = delaiMinimum(config, mode, zone);
  for (const h of servicesDu(config, ici.date)) {
    const { finCommande, finRemise } = bornes(config, h, mode, zone, pizzas);
    // « Dès que possible » quand la cuisine peut lancer la commande maintenant.
    const ouvertDes = enMinutes(h.premiere_heure) - delai;
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

// Le moment demandé est-il encore possible pour ce panier ? Contrôle serveur avant paiement.
export type Quand = { type: "asap" } | { type: "creneau"; date: string; minutes: number } | { type: "aucun" };

export function quandPossible(config: ConfigService, maintenant: Date, mode: Mode, zone: Zone | undefined, pizzas: boolean, quand: Quand): boolean {
  if (quand.type === "asap") return etatService(config, maintenant, mode, zone, pizzas).etat === "ouvert";
  if (quand.type === "creneau") {
    return creneaux(config, maintenant, mode, zone, pizzas).some((c) => c.date === quand.date && c.minutes === quand.minutes);
  }
  return false;
}
