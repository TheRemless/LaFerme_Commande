// Jeu de données de rush : remplit une base embarquée (PGlite) avec des volumes d'un vrai restaurant.
// Jamais une vraie base : ce module ne reçoit qu'une PGlite déjà migrée (scripts/donnees-rush.ts).
//
// Tout est factice et se reconnaît : e-mails en @exemple.test, téléphones en +41 00 000, rues inventées,
// paiements Stripe en cs_test_rush_ / pi_test_rush_. Même graine et même instant : mêmes données.
// Les montants passent par le vrai calcul du panier (src/lib/panier.ts) avec la carte de la base.
import type { PGlite } from "@electric-sql/pglite";
import { calculerPanier, memeLigne, prixChoix, type Catalogue, type LignePanier } from "../../src/lib/panier";

export type OptionsRush = {
  graine: number;
  // Instant de référence (« maintenant ») : la file en direct et les ruptures du jour en dépendent.
  maintenant: Date;
  // 1 = volumes complets. Les tests prennent 0,02.
  echelle: number;
  joursRecents: number;
  joursHistorique: number;
};

export const OPTIONS_PAR_DEFAUT = { graine: 20261113, echelle: 1, joursRecents: 30, joursHistorique: 365 } as const;

export type BilanRush = Record<string, number>;

// ---------- Hasard reproductible ----------

function mulberry32(graine: number) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Hasard {
  private r: () => number;
  constructor(graine: number) {
    this.r = mulberry32(graine);
  }
  nombre() {
    return this.r();
  }
  entier(min: number, max: number) {
    return min + Math.floor(this.r() * (max - min + 1));
  }
  vrai(p: number) {
    return this.r() < p;
  }
  un<T>(liste: readonly T[]): T {
    return liste[Math.floor(this.r() * liste.length)];
  }
  pondere<T>(liste: readonly (readonly [T, number])[]): T {
    const total = liste.reduce((s, [, p]) => s + p, 0);
    let x = this.r() * total;
    for (const [v, p] of liste) {
      x -= p;
      if (x < 0) return v;
    }
    return liste[liste.length - 1][0];
  }
  octets(n: number) {
    return Buffer.from(Array.from({ length: n }, () => Math.floor(this.r() * 256)));
  }
  uuid() {
    const b = this.octets(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
}

// ---------- Heure de Genève ----------

const FORMAT_GENEVE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function partsGeneve(d: Date) {
  const p = Object.fromEntries(FORMAT_GENEVE.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), secondes: Number(p.second) };
}

export function dateGeneve(d: Date): string {
  return partsGeneve(d).date;
}

// Instant d'une heure locale de Genève (minutes depuis minuit) un jour donné, été comme hiver.
function instant(date: string, minutes: number, secondes = 0): Date {
  const [a, m, j] = date.split("-").map(Number);
  const voulu = Date.UTC(a, m - 1, j, 0, minutes, secondes);
  let t = voulu;
  for (let i = 0; i < 2; i++) {
    const p = partsGeneve(new Date(t));
    const [pa, pm, pj] = p.date.split("-").map(Number);
    const vu = Date.UTC(pa, pm - 1, pj, 0, p.minutes, p.secondes);
    t += voulu - vu;
  }
  return new Date(t);
}

function decaler(date: string, jours: number): string {
  const [a, m, j] = date.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j + jours)).toISOString().slice(0, 10);
}

// Jour ISO : 1 = lundi … 7 = dimanche (comme la table horaires).
function jourIso(date: string): number {
  const [a, m, j] = date.split("-").map(Number);
  return ((new Date(Date.UTC(a, m - 1, j)).getUTCDay() + 6) % 7) + 1;
}

function ecartJours(de: string, a: string) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);

// ---------- Données factices ----------

const PRENOMS = [
  "Léa", "Lucas", "Emma", "Noah", "Chloé", "Gabriel", "Sara", "Luca", "Inès", "Nathan", "Camille", "Hugo", "Mia", "Louis",
  "Elena", "Matteo", "Zoé", "Adam", "Alice", "Samuel", "Julia", "Tiago", "Nina", "Elias", "Laura", "David", "Lina", "Rafael",
  "Manon", "Yanis", "Clara", "Marco", "Anaïs", "Leo", "Maya", "Diego", "Eva", "Arthur", "Sofia", "Jonas", "Lou", "Enzo",
  "Ana", "Malik", "Jade", "Nicolas", "Aya", "Paolo", "Margaux", "Ibrahim", "Lisa", "Thomas", "Amira", "Pedro", "Céline",
] as const;
// Noms de famille fabriqués (syllabes) : aucun n'est choisi pour ressembler à quelqu'un.
const DEBUTS = ["Bel", "Cor", "Dum", "Fav", "Gal", "Lan", "Mor", "Pel", "Ros", "Ver", "Zan", "Tor", "Bon", "Cal", "Fer", "Mal", "Sor", "Vil"] as const;
const FINS = ["az", "ini", "oud", "eta", "elli", "ion", "ondo", "ardi", "uz", "oni", "ex", "ago"] as const;
const RUES = [
  "Chemin des Essais", "Rue du Rush", "Avenue de l'Exemple", "Route Fictive", "Rue de la Démo", "Chemin du Test",
  "Place Imaginaire", "Rue des Pointes", "Chemin de la Simulation", "Avenue du Vendredi Soir",
] as const;
const MOTIFS_REFUS = [
  "Rupture de stock sur un plat",
  "Trop de commandes, délai trop long",
  "Adresse introuvable",
  "Fermeture anticipée de la cuisine",
] as const;
const NOTES = ["Bien cuite", "Coupée en 8", "Peu de sel", "Sauce à part", "Pour un enfant"] as const;
const INSTRUCTIONS = ["", "", "", "Sonner deux fois", "Derrière le bâtiment", "Ne pas sonner, bébé qui dort", "Appeler en arrivant"] as const;

const LIVREURS = [
  ["Alba", "alba.rush@exemple.test"],
  ["Dario", "dario.rush@exemple.test"],
  ["Elio", "elio.rush@exemple.test"],
  ["Nora", "nora.rush@exemple.test"],
  ["Samir", "samir.rush@exemple.test"],
] as const;
const SERVICE = [
  ["Léa (rush)", "lea.rush@exemple.test", "service"],
  ["Tom (rush)", "tom.rush@exemple.test", "service"],
  ["Yanis (rush)", "yanis.rush@exemple.test", "service"],
  ["Gérant rush", "gerant.rush@exemple.test", "gerant"],
] as const;

// ---------- Volumes ----------

// Commandes par service selon le jour (2 = mardi … 6 = samedi), avant le bruit : environ 300 par jour en moyenne.
const VOLUME_JOUR: Record<number, { midi: number; soir: number }> = {
  2: { midi: 92, soir: 186 },
  3: { midi: 94, soir: 188 },
  4: { midi: 96, soir: 192 },
  5: { midi: 100, soir: 212 },
  6: { midi: 98, soir: 214 },
};
// Poids par quart d'heure de commande. Soir : 19h-21h ≈ 4,8/16,7 du service, soit environ 60 à l'heure le vendredi.
const QUARTS_MIDI: [number, number][] = [
  [660, 0.3], [675, 0.5], [690, 0.9], [705, 1.3], [720, 1.6], [735, 1.5], [750, 1.1], [765, 0.7], [780, 0.4],
];
const QUARTS_SOIR: [number, number][] = [
  [1080, 0.6], [1095, 0.7], [1110, 0.9], [1125, 1.0], [1140, 1.2], [1155, 1.2], [1170, 1.2], [1185, 1.2], [1200, 1.2],
  [1215, 1.2], [1230, 1.2], [1245, 1.2], [1260, 1.0], [1275, 0.9], [1290, 0.8], [1305, 0.6], [1320, 0.4], [1335, 0.2],
];

type Personne = { id: string; nom: string; email: string; role: string };
type Client = {
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  compteId: string | null;
  adresse: { rue: string; numero: string; npa: string; localite: string; zone: number };
  details: { sonnette: string; etage: string; code: string; instructions: string };
  poids: number;
  creeLe?: Date;
};

type Ligne = Record<string, unknown>;

export async function genererRush(db: PGlite, o: OptionsRush): Promise<BilanRush> {
  const h = new Hasard(o.graine);
  const maintenant = o.maintenant;
  const aujourdHui = dateGeneve(maintenant);
  const minutesMaintenant = partsGeneve(maintenant).minutes;
  const origine = "http://localhost:3000";

  // ----- Carte, zones et réglages lus dans la base -----
  const cat = await lireCatalogue(db);
  const plats = Object.values(cat.plats);
  const parCategorie = (c: string) => plats.filter((p) => p.categorie_slug === c);
  const principaux: [string, number][] = [
    ["pizzas", 40], ["pates", 30], ["entrees", 8], ["viandes", 5], ["poissons", 5],
  ];
  const zones = (await db.query<{ numero: number; frais_centimes: number; minimum_centimes: number; delai_min: number; delai_max: number }>(
    "select numero, frais_centimes, minimum_centimes, delai_min, delai_max from zones_livraison where active order by numero",
  )).rows;
  const npaParZone = (await db.query<{ npa: string; localite: string; zone_numero: number }>(
    "select npa, localite, zone_numero from zone_npa where zone_numero in (select numero from zones_livraison where active) order by npa, localite",
  )).rows;
  const plafond = Number((await db.query<{ v: string }>("select valeur #>> '{}' as v from reglages where cle = 'plafond_comptoir_centimes'")).rows[0]?.v ?? 0);
  const capacite = Object.fromEntries(
    (await db.query<{ cle: string; v: string }>("select cle, valeur #>> '{}' as v from reglages where cle like 'capacite_%'")).rows.map((r) => [r.cle, Number(r.v)]),
  );

  // ----- Personnel factice -----
  const personnel: Personne[] = [];
  for (const [nom, email] of LIVREURS) personnel.push({ id: h.uuid(), nom, email, role: "livreur" });
  for (const [nom, email, role] of SERVICE) personnel.push({ id: h.uuid(), nom, email, role });
  const livreurs = personnel.filter((p) => p.role === "livreur");
  const equipe = personnel.filter((p) => p.role === "service");
  const gerant = personnel.find((p) => p.role === "gerant")!;

  // ----- 2 000 clients : 150 fidèles, 450 réguliers, le reste occasionnels ; deux sur trois ont un compte -----
  const nbClients = Math.max(20, Math.round(2000 * Math.max(o.echelle, 0.01)));
  const clients: Client[] = [];
  const emails = new Set<string>();
  for (let i = 0; i < nbClients; i++) {
    const prenom = h.un(PRENOMS);
    const nom = h.un(DEBUTS) + h.un(FINS);
    let email = `${normaliser(prenom)}.${normaliser(nom)}@exemple.test`;
    for (let n = 2; emails.has(email); n++) email = `${normaliser(prenom)}.${normaliser(nom)}${n}@exemple.test`;
    emails.add(email);
    const z = h.pondere(zones.map((zz) => [zz.numero, zz.numero === 1 ? 65 : 35] as const));
    const lieu = h.un(npaParZone.filter((x) => x.zone_numero === z));
    const rang = i / nbClients;
    clients.push({
      prenom,
      nom,
      email,
      telephone: `+41 00 000 ${String(Math.floor(i / 100) % 100).padStart(2, "0")} ${String(i % 100).padStart(2, "0")}`,
      compteId: h.vrai(0.65) ? h.uuid() : null,
      adresse: { rue: h.un(RUES), numero: String(h.entier(1, 140)), npa: lieu.npa, localite: lieu.localite, zone: z },
      details: { sonnette: nom, etage: h.vrai(0.6) ? `${h.entier(0, 8)}e` : "", code: h.vrai(0.3) ? `${h.entier(1000, 9999)}` : "", instructions: h.un(INSTRUCTIONS) },
      poids: rang < 0.075 ? 2.5 : rang < 0.3 ? 1.2 : 1,
    });
  }
  const tirerClient = cumul(clients.map((c) => c.poids));

  // ----- Contenu d'une commande -----
  function tirerPlat(categorie: string) {
    return h.un(parCategorie(categorie));
  }
  function ligneDe(slug: string, qte: number): LignePanier {
    const p = cat.plats[slug];
    const choix: Record<string, string[]> = {};
    for (const g of p.groupes) {
      const groupe = cat.groupes[g];
      if (!groupe) continue;
      const noms = groupe.options.map((x) => x.nom);
      if (groupe.choix_min > 0) choix[g] = melanger(h, noms).slice(0, groupe.choix_min);
      else if (h.vrai(0.22)) choix[g] = melanger(h, noms).slice(0, h.entier(1, Math.min(2, groupe.choix_max)));
    }
    const retraits = p.retraits.length && h.vrai(0.12) ? [h.un(p.retraits).nom] : [];
    return { slug, qte, choix, retraits, note: h.vrai(0.04) ? h.un(NOTES) : "" };
  }
  function ajouter(lignes: LignePanier[], l: LignePanier) {
    const meme = lignes.find((x) => memeLigne(x, l));
    if (meme) meme.qte = Math.min(20, meme.qte + l.qte);
    else lignes.push(l);
  }
  function panier(zone: (typeof zones)[number] | undefined, plafondCentimes: number | null) {
    for (let essai = 0; essai < 20; essai++) {
      const lignes: LignePanier[] = [];
      const convives = h.pondere([[1, 30], [2, 35], [3, 15], [4, 12], [5, 5], [6, 3]] as const);
      for (let i = 0; i < convives; i++) ajouter(lignes, ligneDe(tirerPlat(h.pondere(principaux)).slug, 1));
      if (h.vrai(0.35)) ajouter(lignes, ligneDe(tirerPlat("boissons").slug, h.entier(1, Math.max(1, convives))));
      if (h.vrai(0.2)) ajouter(lignes, ligneDe(tirerPlat("desserts").slug, h.entier(1, 2)));
      if (h.vrai(0.12)) ajouter(lignes, ligneDe(tirerPlat("entrees").slug, 1));
      let t = calculerPanier(cat, lignes, zone ? { frais_centimes: zone.frais_centimes, minimum_centimes: zone.minimum_centimes } : null);
      while (t.manque_minimum_centimes > 0 && lignes.length < 12) {
        ajouter(lignes, ligneDe(tirerPlat(h.pondere(principaux)).slug, 1));
        t = calculerPanier(cat, lignes, zone ? { frais_centimes: zone.frais_centimes, minimum_centimes: zone.minimum_centimes } : null);
      }
      if (!t.valide) continue;
      if (plafondCentimes !== null && t.total_centimes > plafondCentimes) continue;
      return t;
    }
    return null;
  }

  // ----- Accumulateurs -----
  const commandes: Ligne[] = [];
  const lignesCmd: Ligne[] = [];
  const evenements: Ligne[] = [];
  const evPaiement: Ligne[] = [];
  const remboursements: Ligne[] = [];
  const livraisons: Ligne[] = [];
  const journalLivraisons: Ligne[] = [];
  const journal: Ligne[] = [];
  const parCommande = new Map<unknown, Ligne[]>();
  const noterEvenement = (e: Ligne) => {
    evenements.push(e);
    const l = parCommande.get(e.commande_id);
    if (l) l.push(e);
    else parCommande.set(e.commande_id, [e]);
  };
  const creneauxPris = new Map<string, number>();
  let nPaiement = 0;
  let nRemb = 0;
  const bilan: BilanRush = {};
  const compter = (cle: string, n = 1) => (bilan[cle] = (bilan[cle] ?? 0) + n);

  type Etat = "historique" | "recent" | "direct" | "avance";

  function creerCommande(jourService: string, minutesCible: number, etat: Etat, ageMinutes?: number) {
    const client = clients[tirerClient(h.nombre())];
    const mode: "livraison" | "retrait" = h.vrai(0.55) ? "livraison" : "retrait";
    const zone = mode === "livraison" ? zones.find((z) => z.numero === client.adresse.zone) : undefined;
    const comptoir = mode === "retrait" && h.vrai(0.28);
    const t = panier(zone, comptoir ? plafond : null);
    if (!t) return;
    // Créneau choisi à l'avance : une commande sur cinq, et toutes celles des jours à venir.
    let quandType: "asap" | "creneau" = etat === "avance" || (etat !== "direct" && h.vrai(0.2)) ? "creneau" : "asap";
    let quandMinutes: number | null = null;
    let creeLe: Date;
    if (quandType === "creneau") {
      quandMinutes = Math.ceil((minutesCible + 30) / 15) * 15;
      const cle = `${jourService}:${quandMinutes}:${mode}`;
      const cap = capacite[mode === "livraison" ? "capacite_livraisons_par_creneau" : "capacite_retraits_par_creneau"] ?? 0;
      if (cap > 0 && (creneauxPris.get(cle) ?? 0) >= cap) {
        if (etat === "avance") return;
        quandType = "asap";
        quandMinutes = null;
      } else creneauxPris.set(cle, (creneauxPris.get(cle) ?? 0) + 1);
    }
    if (etat === "direct") creeLe = plus(maintenant, -(ageMinutes ?? 0) - h.nombre());
    else if (quandType === "creneau") {
      const avance = etat === "avance" ? h.entier(60, 6 * 24 * 60) : h.pondere([[h.entier(20, 120), 70], [h.entier(600, 2000), 30]] as const);
      creeLe = plus(instant(jourService, minutesCible, h.entier(0, 59)), -avance);
      if (creeLe > maintenant) creeLe = plus(maintenant, -h.entier(5, 60));
    } else creeLe = instant(jourService, minutesCible + h.entier(0, 14), h.entier(0, 59));
    if (creeLe > maintenant) return;

    const id = h.uuid();
    const enLigne = !comptoir;
    const c: Ligne = {
      id,
      numero: 0,
      jour: dateGeneve(creeLe),
      jour_service: jourService,
      jeton_suivi: h.octets(24).toString("base64url"),
      cle_idempotence: `rush-${h.octets(12).toString("hex")}`,
      mode,
      statut: "terminee",
      statut_paiement: enLigne ? "paye" : "a_encaisser_retrait",
      moyen_paiement: enLigne ? "en_ligne" : "comptoir",
      client_prenom: client.prenom,
      client_nom: client.nom,
      client_telephone: client.telephone,
      client_email: client.email,
      adresse: mode === "livraison" ? { rue: client.adresse.rue, numero: client.adresse.numero, npa: client.adresse.npa, localite: client.adresse.localite } : null,
      details_livraison: mode === "livraison" ? client.details : null,
      zone_numero: zone?.numero ?? null,
      quand_type: quandType,
      quand_date: quandType === "creneau" ? jourService : null,
      quand_minutes: quandMinutes,
      pizzas_seulement: t.pizzas_seulement,
      sous_total_centimes: t.sous_total_centimes,
      frais_centimes: t.frais_centimes,
      total_centimes: t.total_centimes,
      tva_centimes: t.tva_centimes,
      taux_tva_pourcent: cat.tauxTvaPourcent,
      stripe_session_id: null,
      stripe_payment_intent: null,
      motif: null,
      origine,
      cree_le: creeLe.toISOString(),
      paye_le: null,
      rembourse_le: null,
      modifie_le: creeLe.toISOString(),
      compte_id: client.compteId,
      compte_demande: false,
      accepte_le: null,
      termine_le: null,
      alerte_le: null,
      heure_confirmee: null,
      avertissement: null,
      tickets_le: null,
    };
    if (client.compteId && (!client.creeLe || creeLe < client.creeLe)) client.creeLe = creeLe;
    t.lignes.forEach((l, i) => {
      lignesCmd.push({
        id: h.uuid(),
        commande_id: id,
        position: i,
        plat_slug: l.slug,
        nom: l.nom,
        station: cat.plats[l.slug].station,
        qte: l.qte,
        unitaire_centimes: l.unitaire_centimes,
        total_centimes: l.total_centimes,
        choix: l.choix,
        retraits: l.retraits,
        note: l.note,
        prix_choix: prixChoix(cat, l),
      });
    });
    const detaille = etat !== "historique";
    const ev = (de: string | null, vers: string, par: string, quand: Date, detail: string | null = null) => {
      if (detaille) noterEvenement({ commande_id: id, de, vers, par, detail, le: quand.toISOString() });
    };
    const tablette = `tablette:${h.un(equipe).nom}`;

    // Paiement en ligne : session Stripe de test, payée en moins de deux minutes.
    const statutDepart = "nouvelle";
    if (enLigne) {
      nPaiement++;
      c.stripe_session_id = `cs_test_rush_${o.graine}_${nPaiement}`;
      const payeLe = plus(creeLe, 0.3 + h.nombre() * 1.5);
      // Échec chez Stripe ou paiement abandonné.
      const sort = etat === "direct" || etat === "avance" ? "paye" : h.pondere([["paye", 975], ["echec", 15], ["abandon", 10]] as const);
      if (sort === "echec") {
        Object.assign(c, { statut: "annulee", statut_paiement: "echec", motif: "Paiement non abouti", modifie_le: payeLe.toISOString() });
        ev(null, "annulee", "stripe", payeLe, "Paiement non abouti");
        if (detaille) evPaiement.push({ id: `evt_test_rush_${o.graine}_${nPaiement}`, commande_id: id, type: "checkout.session.async_payment_failed", recu_le: payeLe.toISOString() });
        commandes.push(c);
        compter("paiement_echec");
        return;
      }
      if (sort === "abandon") {
        Object.assign(c, { statut: "annulee", statut_paiement: "echec", motif: "Paiement non abouti", modifie_le: plus(creeLe, 35).toISOString() });
        ev(null, "annulee", "stripe", plus(creeLe, 35), "Session de paiement expirée");
        commandes.push(c);
        compter("paiement_abandonne");
        return;
      }
      c.stripe_payment_intent = `pi_test_rush_${o.graine}_${nPaiement}`;
      c.paye_le = payeLe.toISOString();
      ev("paiement_en_attente", "nouvelle", "stripe", payeLe);
      if (detaille) evPaiement.push({ id: `evt_test_rush_${o.graine}_${nPaiement}`, commande_id: id, type: "checkout.session.completed", recu_le: payeLe.toISOString() });
    }

    const debut = new Date(c.paye_le ? String(c.paye_le) : creeLe.toISOString());
    // Pointe du vendredi et du samedi soir : on accepte un peu plus lentement.
    const pointe = jourIso(jourService) >= 5 && minutesCible >= 1140 && minutesCible < 1260;
    const accepteLe = plus(debut, (pointe ? 2 : 0.5) + h.nombre() * (pointe ? 8 : 4));
    const delai = zone ? h.entier(zone.delai_min, zone.delai_max) : h.entier(20, 30);
    const cible = quandType === "creneau" ? instant(jourService, quandMinutes!) : plus(accepteLe, delai);
    const heurePrete = plus(cible, zone ? -h.entier(10, 20) : -h.entier(0, 5));
    const terminee = plus(cible, h.entier(-6, pointe ? 18 : 10));

    // Refusée par la tablette à l'arrivée.
    if (etat !== "direct" && etat !== "avance" && h.vrai(0.03)) {
      const motif = h.un(MOTIFS_REFUS);
      // Comme changer_statut : une commande refusée est terminée à l'heure du refus.
      Object.assign(c, { statut: "refusee", motif, termine_le: accepteLe.toISOString(), modifie_le: accepteLe.toISOString() });
      ev(statutDepart, "refusee", tablette, accepteLe, motif);
      if (enLigne) {
        c.statut_paiement = "rembourse";
        c.rembourse_le = plus(accepteLe, 0.2).toISOString();
        rembourser(c, Number(c.total_centimes), motif, accepteLe, "tablette", null, null);
      }
      commandes.push(c);
      compter("refusee");
      return;
    }

    // Statut selon l'âge pour la file en direct et les commandes à l'avance.
    const etapes: [string, Date][] = [["acceptee", accepteLe], ["en_preparation", plus(accepteLe, h.entier(1, 6))], ["prete", heurePrete]];
    if (mode === "livraison") etapes.push(["partie", plus(heurePrete, h.entier(2, 8))]);
    etapes.push(["terminee", terminee]);
    let statut = statutDepart;
    for (const [vers, quand] of etapes) {
      if (quand > maintenant || etat === "avance") break;
      ev(statut, vers, tablette, quand, vers === "acceptee" ? cible.toISOString() : null);
      statut = vers;
    }
    c.statut = statut;
    if (statut !== "nouvelle") {
      c.accepte_le = accepteLe.toISOString();
      c.heure_confirmee = cible.toISOString();
      c.tickets_le = accepteLe.toISOString();
    }
    if (statut === "terminee") c.termine_le = terminee.toISOString();
    // Retrait payé au comptoir : encaissé à la remise, sauf quelques oublis à la caisse (terminé, jamais encaissé).
    if (!enLigne && statut === "terminee" && h.vrai(0.015)) compter("comptoir_non_encaisse");
    else if (!enLigne && statut === "terminee") {
      c.statut_paiement = "encaisse";
      ev(null, "encaisse", tablette, terminee);
    }
    c.modifie_le = [creeLe, ...etapes.map(([, q]) => q)].filter((q) => q <= maintenant).pop()!.toISOString();
    if (etat === "avance") compter("a_l_avance");
    if (etat === "direct") compter(`direct_${statut}`);

    // Livreur et tournée (détails seulement sur les 30 derniers jours et la file en direct).
    if (mode === "livraison" && detaille && ["prete", "partie", "terminee"].includes(statut)) {
      aLivrer.push({ c, heurePrete, tablette });
    }

    // Manque signalé (remboursement partiel) ou geste commercial (remboursement complet).
    if (statut === "terminee" && etat !== "historique") {
      if (h.vrai(0.025)) {
        const lignes = lignesCmd.filter((l) => l.commande_id === id);
        const l = h.un(lignes);
        const montant = Number(l.unitaire_centimes);
        const moyen = enLigne ? "stripe" : c.statut_paiement === "encaisse" ? "especes" : "deduction";
        rembourser(c, montant, `Manque : ${l.nom}`, plus(terminee, h.entier(5, 90)), "tablette", [{ ligne: l.position, qte: 1 }], { [String(l.position)]: montant }, moyen);
        compter("manque");
      } else if (enLigne && h.vrai(0.004)) {
        const quand = plus(terminee, h.entier(30, 600));
        c.statut_paiement = "rembourse";
        c.rembourse_le = quand.toISOString();
        rembourser(c, Number(c.total_centimes), "Geste commercial : commande arrivée froide", quand, "gestion", null, null);
        compter("geste_complet");
      }
    }
    commandes.push(c);
  }

  function rembourser(
    c: Ligne,
    montant: number,
    motif: string,
    quand: Date,
    source: "tablette" | "gestion",
    elements: unknown,
    montantsLignes: unknown,
    moyen = "stripe",
  ) {
    nRemb++;
    const qui = source === "gestion" ? gerant : h.un(equipe);
    const recent = maintenant.getTime() - quand.getTime() < 20 * 60_000;
    const statut = moyen !== "stripe" ? "fait" : recent ? "en_cours" : h.pondere([["fait", 96], ["echec", 4]] as const);
    if (quand > maintenant) quand = maintenant;
    remboursements.push({
      id: h.uuid(),
      commande_id: c.id,
      cle: `rush-remb-${o.graine}-${nRemb}`,
      montant_centimes: montant,
      motif,
      moyen,
      statut,
      stripe_refund_id: moyen === "stripe" ? `re_test_rush_${o.graine}_${nRemb}` : null,
      erreur: statut === "echec" ? "Remboursement refusé par la banque (données de rush)" : null,
      personnel_id: qui.id,
      personnel_nom: qui.nom,
      cree_le: quand.toISOString(),
      fait_le: statut === "fait" ? plus(quand, 0.5).toISOString() : null,
      elements,
      montants_lignes: montantsLignes,
    });
    if (elements) {
      noterEvenement({ commande_id: c.id, de: null, vers: "manque", par: `tablette:${qui.nom}`, detail: `${(montant / 100).toFixed(2)} CHF, ${motif}`, le: quand.toISOString() });
    } else if (source === "gestion") {
      noterEvenement({ commande_id: c.id, de: null, vers: "remboursement", par: `gestion:${qui.nom}`, detail: `${(montant / 100).toFixed(2)} CHF, ${motif}`, le: quand.toISOString() });
      journal.push({ personnel_id: qui.id, personnel_nom: qui.nom, objet: "remboursement", cle: "0", avant: null, apres: { montant_centimes: montant, motif }, le: quand.toISOString(), _commande: c.id });
    }
    compter(`remboursement_${statut}`);
  }

  const aLivrer: { c: Ligne; heurePrete: Date; tablette: string }[] = [];

  // ----- Jours -----
  const premier = decaler(aujourdHui, -o.joursHistorique);
  const vacances = [decaler(aujourdHui, -130), decaler(aujourdHui, -117)];
  for (let d = premier; d <= decaler(aujourdHui, 7); d = decaler(d, 1)) {
    const ji = jourIso(d);
    const vol = VOLUME_JOUR[ji];
    if (!vol) continue;
    if (d >= vacances[0] && d <= vacances[1]) continue;
    const recent = d >= decaler(aujourdHui, -o.joursRecents);
    const futur = d > aujourdHui;
    for (const [service, quarts] of [["midi", QUARTS_MIDI], ["soir", QUARTS_SOIR]] as const) {
      let n: number;
      // À l'avance : surtout le lendemain, de moins en moins ensuite.
      if (futur) n = ((service === "soir" ? 9 : 4) * o.echelle) / ecartJours(aujourdHui, d);
      else if (recent) n = vol[service] * (0.92 + h.nombre() * 0.16) * o.echelle;
      else n = (vol[service] / 7) * (0.8 + h.nombre() * 0.4) * saison(d) * o.echelle;
      const total = arrondiHasard(h, n);
      const tirer = cumul(quarts.map(([, p]) => p));
      for (let i = 0; i < total; i++) {
        const minutes = quarts[tirer(h.nombre())][0];
        creerCommande(d, minutes, futur ? "avance" : recent ? "recent" : "historique");
      }
    }
  }

  // ----- File en direct : 60 commandes à l'heure pendant l'heure qui précède « maintenant » -----
  // Toujours présente, même hors service, pour que la tablette et le suivi aient une vraie file à relire.
  const enService = [...QUARTS_MIDI, ...QUARTS_SOIR].some(([m]) => Math.abs(m - minutesMaintenant) <= 15) && Boolean(VOLUME_JOUR[jourIso(aujourdHui)]);
  if (!enService) {
    // Au moins 30 commandes même à petite échelle : c'est la file que relisent les tablettes.
    const nDirect = Math.max(30, arrondiHasard(h, 60 * o.echelle));
    for (let i = 0; i < nDirect; i++) creerCommande(aujourdHui, minutesMaintenant, "direct", (60 * i) / Math.max(1, nDirect));
  }

  // ----- Numéros du jour : dans l'ordre de passage, par jour de service -----
  commandes.sort((a, b) => String(a.cree_le).localeCompare(String(b.cree_le)));
  const compteurs = new Map<string, number>();
  for (const c of commandes) {
    const n = (compteurs.get(String(c.jour_service)) ?? 0) + 1;
    compteurs.set(String(c.jour_service), n);
    c.numero = n;
  }
  const parId = new Map(commandes.map((c) => [c.id, c]));
  for (const j of journal) {
    if (!j._commande) continue;
    const c = parId.get(j._commande);
    j.cle = String(c?.numero ?? 0);
    delete j._commande;
  }

  // ----- Tournées : par service, les livraisons prêtes partent par une à trois, même zone -----
  aLivrer.sort((a, b) => a.heurePrete.getTime() - b.heurePrete.getTime());
  const actifs = new Set<string>();
  for (let i = 0; i < aLivrer.length; ) {
    const premiere = aLivrer[i];
    const taille = h.pondere([[1, 45], [2, 40], [3, 15]] as const);
    const lot = [premiere];
    for (let j = i + 1; j < aLivrer.length && lot.length < taille; j++) {
      const x = aLivrer[j];
      if (x.c.jour_service !== premiere.c.jour_service || x.c.zone_numero !== premiere.c.zone_numero) break;
      if (x.heurePrete.getTime() - premiere.heurePrete.getTime() > 10 * 60_000) break;
      lot.push(x);
    }
    i += lot.length;
    const livreur = h.un(livreurs);
    lot.forEach((x, position) => {
      const c = x.c;
      const attribuee = plus(x.heurePrete, -h.entier(1, 5));
      if (attribuee > maintenant) return;
      const absent = c.statut === "terminee" && h.vrai(0.006);
      livraisons.push({
        id: h.uuid(),
        commande_id: c.id,
        livreur_id: livreur.id,
        position,
        ordre_manuel: false,
        attribuee_le: attribuee.toISOString(),
        attribuee_par: x.tablette,
        retiree_le: absent ? c.termine_le : null,
        raison_retrait: absent ? "client_absent" : null,
        retrait_vu_le: null,
        probleme: absent ? "client_absent" : null,
        probleme_detail: null,
        probleme_le: absent ? c.termine_le : null,
      });
      journalLivraisons.push({ commande_id: c.id, personnel_id: livreur.id, par: x.tablette, evenement: "attribuee", detail: null, le: attribuee.toISOString() });
      const vue = plus(attribuee, 0.5 + h.nombre() * 2);
      if (vue <= maintenant) journalLivraisons.push({ commande_id: c.id, personnel_id: livreur.id, par: `livreur:${livreur.nom}`, evenement: "vue", detail: null, le: vue.toISOString() });
      if (absent) {
        journalLivraisons.push({ commande_id: c.id, personnel_id: livreur.id, par: `livreur:${livreur.nom}`, evenement: "client_absent", detail: null, le: c.termine_le });
        const fin = (parCommande.get(c.id) ?? []).find((e) => e.vers === "terminee");
        if (fin) Object.assign(fin, { de: "partie", detail: "client absent" });
        compter("client_absent");
      }
      // L'auteur du passage à « terminée » d'une livraison est son livreur.
      for (const e of parCommande.get(c.id) ?? []) if ((e.vers === "terminee" || e.vers === "partie") && e.de !== null) e.par = `livreur:${livreur.nom}`;
      if (c.jour_service === aujourdHui) actifs.add(livreur.id);
      compter("livraison");
    });
  }

  // ----- Ruptures du jour et journal du back-office -----
  const enRupture = [h.un(parCategorie("pizzas")).slug, h.un(parCategorie("pates")).slug];
  const supplements = cat.groupes["supplements-pizza"]?.options ?? [];
  const optionRupture = supplements.length ? h.un(supplements).nom : null;
  for (let d = decaler(aujourdHui, -o.joursRecents); d <= aujourdHui; d = decaler(d, 1)) {
    if (!VOLUME_JOUR[jourIso(d)]) continue;
    const nb = arrondiHasard(h, 8 * Math.max(o.echelle, 0.25));
    for (let i = 0; i < nb; i++) {
      const quand = instant(d, h.entier(600, 1350), h.entier(0, 59));
      if (quand > maintenant) continue;
      const qui = h.vrai(0.6) ? gerant : h.un(equipe);
      const sorte = h.pondere([["plat", 50], ["reglage", 30], ["option", 15], ["horaire", 5]] as const);
      if (sorte === "plat") {
        const slug = h.un(plats).slug;
        const r = h.vrai(0.5);
        journal.push({ personnel_id: qui.id, personnel_nom: qui.nom, objet: "plat", cle: slug, avant: { rupture: !r }, apres: { rupture: r }, le: quand.toISOString() });
      } else if (sorte === "reglage") {
        const v = h.un([0, 10, 15, 20, 30]);
        journal.push({ personnel_id: qui.id, personnel_nom: qui.nom, objet: "reglage", cle: "retard_minutes", avant: 0, apres: v, le: quand.toISOString() });
      } else if (sorte === "option" && supplements.length) {
        const nom = h.un(supplements).nom;
        journal.push({ personnel_id: qui.id, personnel_nom: qui.nom, objet: "option", cle: nom, avant: { rupture: false }, apres: { rupture: true }, le: quand.toISOString() });
      } else {
        journal.push({ personnel_id: gerant.id, personnel_nom: gerant.nom, objet: "horaire", cle: `${jourIso(d)} soir`, avant: { derniere_commande: "21:30" }, apres: { derniere_commande: "21:45" }, le: quand.toISOString() });
      }
    }
  }
  const matin = instant(aujourdHui, Math.min(minutesMaintenant, 11 * 60), 0);
  for (const slug of enRupture) {
    journal.push({ personnel_id: equipe[0].id, personnel_nom: equipe[0].nom, objet: "plat", cle: slug, avant: { rupture: false }, apres: { rupture: true }, le: matin.toISOString() });
  }
  if (optionRupture) journal.push({ personnel_id: equipe[0].id, personnel_nom: equipe[0].nom, objet: "option", cle: optionRupture, avant: { rupture: false }, apres: { rupture: true }, le: matin.toISOString() });

  // ----- Écriture -----
  await db.exec("begin");
  try {
    await inserer(db, "personnel", personnel.map((p) => ({ id: p.id, email: p.email, nom: p.nom, role: p.role, actif: true, cree_le: plus(maintenant, -400 * 24 * 60).toISOString() })));
    await inserer(
      db,
      "comptes",
      clients
        .filter((c) => c.compteId && c.creeLe)
        .map((c) => ({ id: c.compteId, email: c.email, prenom: c.prenom, nom: c.nom, telephone: c.telephone, cree_le: plus(c.creeLe!, -h.entier(1, 30)).toISOString(), modifie_le: c.creeLe!.toISOString() })),
    );
    await inserer(db, "commandes", commandes);
    await inserer(db, "commande_lignes", lignesCmd);
    await inserer(db, "evenements_commande", evenements);
    await inserer(db, "evenements_paiement", evPaiement);
    await inserer(db, "remboursements", remboursements);
    await inserer(db, "livraisons", livraisons);
    await inserer(db, "journal_livraisons", journalLivraisons);
    await inserer(db, "journal_gestion", journal);
    await inserer(db, "activite_livreurs", [...actifs].map((id) => ({ personnel_id: id, vu_le: plus(maintenant, -h.entier(0, 3)).toISOString() })));
    // Compteurs du jour : la prochaine vraie commande locale prend le numéro suivant.
    await inserer(db, "compteurs_jour", [...compteurs].map(([jour, dernier]) => ({ jour, dernier })), "on conflict (jour) do update set dernier = greatest(compteurs_jour.dernier, excluded.dernier)");
    // Adresses des comptes : la même fonction que le site (dernière adresse utilisée en tête).
    await db.query(`
      select enregistrer_adresse(x.compte_id, x.adresse, x.details_livraison)
      from (
        select distinct on (compte_id, adresse) compte_id, adresse, details_livraison, cree_le
        from commandes where compte_id is not null and mode = 'livraison' and adresse is not null and cle_idempotence like 'rush-%'
        order by compte_id, adresse, cree_le desc
      ) x order by x.cree_le`);
    await db.query("update plats set rupture_jour = $1 where slug = any($2)", [aujourdHui, enRupture]);
    if (optionRupture) {
      await db.query("update options set rupture_jour = $1 where nom = $2 and groupe_id = (select id from groupes_options where slug = 'supplements-pizza')", [aujourdHui, optionRupture]);
    }
    await db.query("insert into fermetures (debut, fin, motif, service) values ($1, $2, 'Vacances (données de rush)', null)", vacances);
    await db.exec("commit");
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }

  bilan.commandes = commandes.length;
  bilan.lignes = lignesCmd.length;
  bilan.evenements = evenements.length;
  bilan.clients = clients.length;
  bilan.comptes = clients.filter((c) => c.compteId && c.creeLe).length;
  bilan.journal_gestion = journal.length;
  bilan.ruptures = enRupture.length + (optionRupture ? 1 : 0);
  return bilan;
}

// ---------- Outils ----------

async function lireCatalogue(db: PGlite): Promise<Catalogue> {
  const plats = (await db.query<{ slug: string; nom: string; categorie_slug: string; prix_centimes: number; prix_a_valider: boolean; station: "pizza" | "cuisine" }>(`
    select p.slug, p.nom, c.slug as categorie_slug, p.prix_centimes, p.prix_a_valider, p.station::text as station
    from plats p join categories c on c.id = p.categorie_id
    where p.commandable and p.archive_le is null and p.origine <> 'jour' and p.prix_centimes > 0
    order by p.slug`)).rows;
  const liens = (await db.query<{ plat_slug: string; groupe_slug: string }>(`
    select p.slug as plat_slug, g.slug as groupe_slug from plat_groupes pg
    join plats p on p.id = pg.plat_id join groupes_options g on g.id = pg.groupe_id order by p.slug, pg.ordre, g.slug`)).rows;
  const options = (await db.query<{ groupe_slug: string; groupe_nom: string; choix_min: number; choix_max: number; nom: string; prix_centimes: number; prix_a_valider: boolean }>(`
    select g.slug as groupe_slug, g.nom as groupe_nom, g.choix_min, g.choix_max, o.nom, o.prix_centimes, o.prix_a_valider
    from options o join groupes_options g on g.id = o.groupe_id where o.actif order by g.slug, o.ordre, o.nom`)).rows;
  const retraits = (await db.query<{ plat_slug: string; nom: string; a_valider: boolean }>(`
    select p.slug as plat_slug, r.nom, r.a_valider from plat_retraits r join plats p on p.id = r.plat_id order by p.slug, r.ordre, r.nom`)).rows;
  const taux = Number((await db.query<{ v: string }>("select valeur #>> '{}' as v from reglages where cle = 'tva_emporter_pourcent'")).rows[0]?.v);
  if (!Number.isFinite(taux)) throw new Error("Réglage manquant : tva_emporter_pourcent");
  const cat: Catalogue = { plats: {}, groupes: {}, tauxTvaPourcent: taux };
  for (const o of options) {
    cat.groupes[o.groupe_slug] ??= { slug: o.groupe_slug, nom: o.groupe_nom, choix_min: o.choix_min, choix_max: o.choix_max, options: [] };
    cat.groupes[o.groupe_slug].options.push({ nom: o.nom, prix_centimes: o.prix_centimes, prix_a_valider: o.prix_a_valider, rupture: false });
  }
  for (const p of plats) {
    cat.plats[p.slug] = {
      ...p,
      rupture_motif: null,
      jour: null,
      groupes: liens.filter((l) => l.plat_slug === p.slug).map((l) => l.groupe_slug),
      retraits: retraits.filter((r) => r.plat_slug === p.slug).map((r) => ({ nom: r.nom, a_valider: r.a_valider })),
    };
  }
  return cat;
}

// Insertion par paquets de 2 000 lignes : une requête par paquet, pas une par ligne.
async function inserer(db: PGlite, table: string, lignes: Ligne[], suite = "") {
  if (!lignes.length) return;
  const colonnes = Object.keys(lignes[0]);
  const liste = colonnes.map((c) => `"${c}"`).join(", ");
  for (let i = 0; i < lignes.length; i += 2000) {
    const paquet = lignes.slice(i, i + 2000);
    await db.query(`insert into ${table} (${liste}) select ${liste} from jsonb_populate_recordset(null::${table}, $1::jsonb) ${suite}`, [JSON.stringify(paquet)]);
  }
}

function cumul(poids: number[]) {
  const total = poids.reduce((s, p) => s + p, 0);
  const bornes: number[] = [];
  let s = 0;
  for (const p of poids) bornes.push((s += p / total));
  return (x: number) => {
    let bas = 0;
    let haut = bornes.length - 1;
    while (bas < haut) {
      const m = (bas + haut) >> 1;
      if (bornes[m] > x) haut = m;
      else bas = m + 1;
    }
    return bas;
  };
}

function melanger<T>(h: Hasard, liste: T[]): T[] {
  const l = [...liste];
  for (let i = l.length - 1; i > 0; i--) {
    const j = Math.floor(h.nombre() * (i + 1));
    [l[i], l[j]] = [l[j], l[i]];
  }
  return l;
}

function arrondiHasard(h: Hasard, x: number) {
  const n = Math.floor(x);
  return n + (h.vrai(x - n) ? 1 : 0);
}

// Un peu moins en hiver, un peu plus aux beaux jours (historique seulement).
function saison(date: string) {
  const mois = Number(date.slice(5, 7));
  return [0.85, 0.85, 0.9, 1, 1.05, 1.1, 1.1, 1.05, 1.05, 1, 0.95, 1][mois - 1];
}

function normaliser(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}
