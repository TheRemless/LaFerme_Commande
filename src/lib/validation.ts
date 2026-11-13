// Contrôle de forme des données envoyées par le navigateur. Le fond (prix, options, zone, heure)
// est vérifié ensuite contre la base. Toute valeur absente ou douteuse rend null.
import { LIMITES, type LignePanier } from "@/lib/panier";
import type { Details } from "@/lib/adresse";
import type { Quand } from "@/lib/service";

const CLES_INTERDITES = new Set(["__proto__", "constructor", "prototype"]);

export function lignesValides(v: unknown): LignePanier[] | null {
  if (!Array.isArray(v) || v.length > LIMITES.lignes) return null;
  const lignes: LignePanier[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") return null;
    const l = x as Record<string, unknown>;
    if (typeof l.slug !== "string" || l.slug.length > 80 || typeof l.qte !== "number") return null;
    const choix: Record<string, string[]> = {};
    if (l.choix && typeof l.choix === "object") {
      for (const [g, noms] of Object.entries(l.choix as Record<string, unknown>)) {
        if (CLES_INTERDITES.has(g) || g.length > 80) return null;
        if (!Array.isArray(noms) || noms.length > 40 || noms.some((n) => typeof n !== "string" || n.length > 80)) return null;
        choix[g] = noms as string[];
      }
    }
    const retraits = Array.isArray(l.retraits) ? l.retraits : [];
    if (retraits.length > 20 || retraits.some((r) => typeof r !== "string" || r.length > 80)) return null;
    const note = typeof l.note === "string" ? l.note : "";
    if (note.length > 500) return null;
    lignes.push({ slug: l.slug, qte: l.qte, choix, retraits: retraits as string[], note });
  }
  return lignes;
}

export function quandValide(v: unknown): Quand {
  const q = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (q.type === "asap") return { type: "asap" };
  if (q.type === "creneau" && typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) && Number.isInteger(q.minutes)) {
    return { type: "creneau", date: q.date, minutes: q.minutes as number };
  }
  return { type: "aucun" };
}

function texte(v: unknown, min: number, max: number): string | null {
  if (typeof v !== "string") return min === 0 ? "" : null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length >= min && t.length <= max ? t : null;
}

export type Client = { prenom: string; nom: string; telephone: string; email: string };

// E-mail sans espaces, en minuscules, de forme valable. Même règle pour la commande et le compte.
// Sont refusés les caractères qui écrivent une liste d'adresses, un nom affiché ou un commentaire
// (virgule, point-virgule, deux-points, chevrons, parenthèses, guillemets, crochets, barre oblique
// inverse) : un serveur d'envoi lirait « a,b@x.ch » comme l'adresse b@x.ch, sous une autre clé de limite.
const CARACTERE_ADRESSE = String.raw`[^\s@,;:<>()"\[\]\\]`;
const FORME_EMAIL = new RegExp(`^${CARACTERE_ADRESSE}+@${CARACTERE_ADRESSE}+\\.${CARACTERE_ADRESSE}{2,}$`);
export function emailNormalise(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length >= 5 && e.length <= 120 && FORME_EMAIL.test(e) ? e : null;
}

// Même règle dans le navigateur (avant l'envoi) et sur le serveur.
export function telephoneValide(t: string): boolean {
  const v = t.trim();
  return v.length >= 8 && v.length <= 20 && /^\+?[0-9 ().-]{8,20}$/.test(v) && (v.match(/\d/g) ?? []).length >= 9;
}

export type ChampClient = "prenom" | "nom" | "telephone" | "email";

export const MESSAGE_CHAMP: Record<ChampClient, string> = {
  prenom: "Indiquez votre prénom.",
  nom: "Indiquez votre nom.",
  telephone: "Vérifiez le numéro de téléphone, il faut au moins neuf chiffres.",
  email: "Vérifiez l'adresse e-mail.",
};

// Premier champ faux, pour le nommer au client (CM-09). null si tout est bon.
export function champClientInvalide(v: unknown): ChampClient | null {
  const c = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (!texte(c.prenom, 1, 60)) return "prenom";
  if (!texte(c.nom, 1, 60)) return "nom";
  const telephone = texte(c.telephone, 8, 20);
  if (!telephone || !telephoneValide(telephone)) return "telephone";
  if (!emailNormalise(c.email)) return "email";
  return null;
}

export function clientValide(v: unknown): Client | null {
  if (champClientInvalide(v)) return null;
  const c = v as Record<string, unknown>;
  return { prenom: texte(c.prenom, 1, 60)!, nom: texte(c.nom, 1, 60)!, telephone: texte(c.telephone, 8, 20)!, email: emailNormalise(c.email)! };
}

export function detailsValides(v: unknown): Details | null {
  const d = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const sonnette = texte(d.sonnette, 1, 60);
  const etage = texte(d.etage, 0, 30);
  const code = texte(d.code, 0, 30);
  const instructions = texte(d.instructions, 0, 140);
  if (!sonnette || etage === null || code === null || instructions === null) return null;
  return { sonnette, etage, code, instructions };
}

// Commande pour quelqu'un d'autre : la personne qui reçoit ou vient chercher la commande (vague 3).
// Absente : null (pour soi-même). Sinon le destinataire nettoyé, ou le nom du champ faux.
export type Destinataire = { nom: string; telephone: string };
export function destinataireValide(v: unknown): Destinataire | "nom" | "telephone" | null {
  if (v === undefined || v === null) return null;
  const d = (typeof v === "object" ? v : {}) as Record<string, unknown>;
  const nom = texte(d.nom, 1, 80);
  if (!nom) return "nom";
  const telephone = texte(d.telephone, 8, 20);
  if (!telephone || !telephoneValide(telephone)) return "telephone";
  return { nom, telephone };
}

// Allergie ou intolérance, pour toute la commande (vague 3) : 120 caractères au plus, imprimée en tête des
// tickets. Caractères de contrôle retirés (une imprimante de tickets les interprète). Absente : chaîne vide.
export const LIMITE_ALLERGIE = 120;
export function allergieValide(v: unknown): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  return texte(v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""), 0, LIMITE_ALLERGIE);
}

export function cleValide(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9-]{16,64}$/.test(v) ? v : null;
}
