// Contrôle des champs envoyés par le back-office. Tout ce qui n'est pas reconnu est ignoré ;
// une valeur douteuse rend une erreur claire. Fonctions pures, testées sans base.
import { PHOTOS } from "@/lib/photos";

export type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreur: string };

function texte(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/[ \t]+/g, " ");
  return t.length <= max ? t : null;
}

// « 18 », « 18.50 », « 18,50 » → 1850. Entre 0 et 500 francs (un prix de la carte), ou jusqu'à max francs.
export function centimes(v: unknown, max = 500): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim().replace(",", ".")) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  const c = Math.round(n * 100);
  return Math.abs(c - n * 100) < 0.01 ? c : null;
}

export function champsPlat(v: unknown): Resultat<Record<string, unknown>> {
  const c = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const p: Record<string, unknown> = {};
  if ("nom" in c) {
    const t = texte(c.nom, 80);
    if (!t) return { ok: false, erreur: "Nom vide ou trop long." };
    p.nom = t;
  }
  if ("description" in c) {
    const t = texte(c.description, 400);
    if (t === null) return { ok: false, erreur: "Description trop longue (400 caractères au plus)." };
    p.description = t;
  }
  if ("prix" in c) {
    const x = centimes(c.prix);
    if (x === null) return { ok: false, erreur: "Prix invalide : un montant en francs, par exemple 18 ou 4.50." };
    p.prix_centimes = x;
  }
  if ("prix_valide" in c) {
    if (typeof c.prix_valide !== "boolean") return { ok: false, erreur: "Validation du prix invalide." };
    p.prix_valide = c.prix_valide;
  }
  if ("commandable" in c) {
    if (typeof c.commandable !== "boolean") return { ok: false, erreur: "Disponibilité invalide." };
    p.commandable = c.commandable;
  }
  if ("station" in c) {
    if (c.station !== "pizza" && c.station !== "cuisine") return { ok: false, erreur: "Station : pizza ou cuisine." };
    p.station = c.station;
  }
  if ("photo" in c) {
    if (c.photo !== "" && !PHOTOS.includes(c.photo as (typeof PHOTOS)[number])) return { ok: false, erreur: "Photo inconnue." };
    p.photo = c.photo;
  }
  if ("provenance" in c) {
    const t = texte(c.provenance, 300);
    if (t === null) return { ok: false, erreur: "Provenance trop longue." };
    p.provenance = t;
  }
  if ("provenances_a_fournir" in c) {
    const l = c.provenances_a_fournir;
    if (!Array.isArray(l) || l.length > 20 || l.some((x) => typeof x !== "string" || x.length > 60)) return { ok: false, erreur: "Liste des provenances à fournir invalide." };
    p.provenances_a_fournir = l.map((x) => (x as string).trim()).filter(Boolean);
  }
  if ("allergenes" in c) {
    const t = texte(c.allergenes, 300);
    if (t === null) return { ok: false, erreur: "Allergènes : 300 caractères au plus." };
    p.allergenes = t;
  }
  return Object.keys(p).length ? { ok: true, valeur: p } : { ok: false, erreur: "Rien à changer." };
}

export function champsOption(v: unknown): Resultat<Record<string, unknown>> {
  const c = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const p: Record<string, unknown> = {};
  if ("prix" in c) {
    const x = centimes(c.prix);
    if (x === null) return { ok: false, erreur: "Prix invalide." };
    p.prix_centimes = x;
  }
  if ("prix_valide" in c) {
    if (typeof c.prix_valide !== "boolean") return { ok: false, erreur: "Validation invalide." };
    p.prix_valide = c.prix_valide;
  }
  if ("actif" in c) {
    if (typeof c.actif !== "boolean") return { ok: false, erreur: "Valeur invalide." };
    p.actif = c.actif;
  }
  return Object.keys(p).length ? { ok: true, valeur: p } : { ok: false, erreur: "Rien à changer." };
}

export function nomsRetraits(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > 30) return null;
  const noms = v.map((x) => texte(x, 60));
  if (noms.some((x) => !x)) return null;
  return [...new Set(noms as string[])];
}

export function champsZone(v: unknown): Resultat<Record<string, unknown>> {
  const c = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const p: Record<string, unknown> = {};
  for (const [cle, dest] of [["frais", "frais_centimes"], ["minimum", "minimum_centimes"]] as const) {
    if (cle in c) {
      const x = centimes(c[cle]);
      if (x === null) return { ok: false, erreur: "Montant invalide." };
      p[dest] = x;
    }
  }
  for (const cle of ["delai_min", "delai_max"] as const) {
    if (cle in c) {
      if (!Number.isInteger(c[cle]) || (c[cle] as number) < 5 || (c[cle] as number) > 180) return { ok: false, erreur: "Délai entre 5 et 180 minutes." };
      p[cle] = c[cle];
    }
  }
  if ("active" in c) {
    if (typeof c.active !== "boolean") return { ok: false, erreur: "Valeur invalide." };
    p.active = c.active;
  }
  const min = (p.delai_min ?? c.delai_min_actuel) as number | undefined;
  const max = (p.delai_max ?? c.delai_max_actuel) as number | undefined;
  if (min !== undefined && max !== undefined && min > max) return { ok: false, erreur: "Le délai minimum dépasse le maximum." };
  return Object.keys(p).length ? { ok: true, valeur: p } : { ok: false, erreur: "Rien à changer." };
}

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function champsHoraire(v: unknown): Resultat<Record<string, unknown>> {
  const c = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const cles = ["premiere_heure", "derniere_heure", "derniere_commande", "derniere_commande_pizzas"] as const;
  const p: Record<string, string> = {};
  for (const k of cles) {
    if (k in c) {
      if (typeof c[k] !== "string" || !HEURE.test(c[k] as string)) return { ok: false, erreur: "Heure au format 18:45." };
      p[k] = c[k] as string;
    }
  }
  if (Object.keys(p).length !== cles.length) return { ok: false, erreur: "Les quatre heures sont nécessaires." };
  if (!(p.premiere_heure < p.derniere_heure)) return { ok: false, erreur: "La première heure doit précéder la dernière." };
  if (!(p.derniere_commande <= p.derniere_commande_pizzas)) return { ok: false, erreur: "La dernière commande des pizzas ne peut pas précéder celle de la carte." };
  return { ok: true, valeur: p };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function dateValide(v: unknown): string | null {
  return typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null;
}

// ---------- Export comptable ----------

export type Vente = {
  jour: string;
  numero: number;
  heure: string;
  mode: string;
  paiement: string;
  sous_total_centimes: number;
  frais_centimes: number;
  total_centimes: number;
  taux_tva_pourcent: number;
  tva_centimes: number;
  stripe_payment_intent: string | null;
};

export type Remboursement = {
  jour: string;
  heure: string;
  numero: number;
  jour_vente: string;
  mode: string;
  paiement: string;
  montant_centimes: number;
  taux_tva_pourcent: number;
  tva_centimes: number;
  reference: string | null;
};

const chf = (c: number) => (c / 100).toFixed(2);

// CSV pour la fiduciaire : séparateur « ; » (Excel suisse), une ligne par vente, puis les remboursements
// faits sur la période (en négatif, au jour du remboursement), puis le total net par taux de TVA.
// Aucune donnée personnelle : ni nom, ni téléphone, ni adresse, ni motif.
export function csvVentes(ventes: Vente[], remboursements: Remboursement[] = []): string {
  const lignes = [["Jour", "Numéro", "Heure", "Mode", "Paiement", "Sous-total CHF", "Livraison CHF", "Total TTC CHF", "Taux TVA %", "TVA CHF", "Référence Stripe"]];
  for (const v of ventes) {
    lignes.push([
      String(v.jour).slice(0, 10),
      String(v.numero),
      v.heure,
      v.mode,
      v.paiement,
      chf(v.sous_total_centimes),
      chf(v.frais_centimes),
      chf(v.total_centimes),
      String(v.taux_tva_pourcent),
      chf(v.tva_centimes),
      v.stripe_payment_intent ?? "",
    ]);
  }
  if (remboursements.length) {
    lignes.push([]);
    lignes.push(["Remboursements"]);
    lignes.push(["Jour", "Numéro", "Heure", "Mode", "Paiement", "Jour de la vente", "Remboursé CHF", "Taux TVA %", "TVA CHF", "Référence Stripe"]);
    for (const r of remboursements) {
      lignes.push([
        String(r.jour).slice(0, 10),
        String(r.numero),
        r.heure,
        r.mode,
        r.paiement,
        String(r.jour_vente).slice(0, 10),
        chf(-r.montant_centimes),
        String(r.taux_tva_pourcent),
        chf(-r.tva_centimes),
        r.reference ?? "",
      ]);
    }
  }
  const parTaux = new Map<string, { total: number; tva: number; n: number; rembourse: number; tvaRemb: number }>();
  const taux = (t: number) => parTaux.get(String(t)) ?? { total: 0, tva: 0, n: 0, rembourse: 0, tvaRemb: 0 };
  for (const v of ventes) {
    const t = taux(v.taux_tva_pourcent);
    parTaux.set(String(v.taux_tva_pourcent), { ...t, total: t.total + v.total_centimes, tva: t.tva + v.tva_centimes, n: t.n + 1 });
  }
  for (const r of remboursements) {
    const t = taux(r.taux_tva_pourcent);
    parTaux.set(String(r.taux_tva_pourcent), { ...t, rembourse: t.rembourse + r.montant_centimes, tvaRemb: t.tvaRemb + r.tva_centimes });
  }
  lignes.push([]);
  lignes.push(["Taux TVA %", "Ventes", "Total TTC CHF", "Remboursé CHF", "Net TTC CHF", "TVA nette CHF", "Hors TVA net CHF"]);
  for (const [t, x] of parTaux) {
    const net = x.total - x.rembourse;
    const tva = x.tva - x.tvaRemb;
    lignes.push([t, String(x.n), chf(x.total), chf(-x.rembourse), chf(net), chf(tva), chf(net - tva)]);
  }
  // Une cellule qui commence par = + - @ serait lue comme une formule par Excel : on la neutralise.
  const cellule = (x: string) => {
    const s = /^[=+\-@]/.test(x) && !/^-?\d/.test(x) ? `'${x}` : x;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\uFEFF" + lignes.map((l) => l.map(cellule).join(";")).join("\r\n") + "\r\n";
}
