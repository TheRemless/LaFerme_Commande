import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import {
  champsNouveauPlat,
  champsOption,
  champsPlat,
  champsPlatDuJour,
  listeSlugs,
  nomCategorie,
  nomsRetraits,
  nouvelleOption,
  slugDe,
} from "@/lib/gestion";
import { exigerGerant } from "@/lib/personnel/session";
import { instantGeneve } from "@/lib/service";
import { rafraichirCaches } from "@/lib/tablette";

const SLUG = /^[a-z0-9-]{1,80}$/;
const slug = (v: unknown): v is string => typeof v === "string" && SLUG.test(v);

// Refus de la base traduits pour l'écran. « plat_incomplet » porte la liste de ce qui manque.
const ERREURS: Record<string, string> = {
  categorie_inconnue: "Catégorie inconnue.",
  categorie_existe: "Cette catégorie existe déjà.",
  groupe_inconnu: "Options inconnues.",
  option_existe: "Ce supplément existe déjà.",
  nom_invalide: "Nom vide ou trop long.",
  slug_invalide: "Nom illisible : utilisez des lettres ou des chiffres.",
  plat_archive: "Ce plat est archivé. Remettez-le à la carte d'abord.",
  photo_inconnue: "Photo inconnue.",
  jour_invalide: "Date invalide : aujourd'hui ou dans les 14 jours.",
  service_invalide: "Choisissez midi, soir ou les deux.",
  texte_trop_long: "Texte trop long.",
  "Réservé au gérant": "Réservé au gérant.",
};

function erreurConnue(e: unknown): string | null {
  const m = e instanceof Error ? e.message : String(e);
  const incomplet = /plat_incomplet: ([^\n"]+)/.exec(m);
  if (incomplet) return `Pas en vente tant qu'il reste : ${incomplet[1].trim()}.`;
  const cle = Object.keys(ERREURS).find((k) => m.includes(k));
  return cle ? ERREURS[cle] : null;
}

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await fonctionSql("gestion_carte", {}), { headers: { "Cache-Control": "no-store" } });
}

type Reponse = { ok: boolean; donnees?: Record<string, unknown> };

// Une action du back-office sur la carte. Chaque fonction SQL revérifie le gérant et journalise.
async function agir(c: Record<string, unknown>, qui: string): Promise<Reponse | NextResponse> {
  switch (c.type) {
    case "plat": {
      if (!slug(c.slug)) return refus("Plat inconnu.", 404);
      const champs = champsPlat(c.champs);
      if (!champs.ok) return refus(champs.erreur);
      return { ok: (await fonctionSql<unknown>("modifier_plat", { p_slug: c.slug, p: champs.valeur, p_personnel: qui })) !== null };
    }
    case "retraits": {
      const noms = nomsRetraits(c.noms);
      if (!slug(c.slug) || !noms) return refus("Liste de retraits invalide.");
      return { ok: await fonctionSql<boolean>("modifier_retraits", { p_slug: c.slug, p_noms: noms, p_personnel: qui }) };
    }
    case "option": {
      if (!slug(c.groupe) || typeof c.nom !== "string" || c.nom.length > 80) return refus("Option inconnue.", 404);
      const champs = champsOption(c.champs);
      if (!champs.ok) return refus(champs.erreur);
      return { ok: await fonctionSql<boolean>("modifier_option", { p_groupe: c.groupe, p_nom: c.nom, p: champs.valeur, p_personnel: qui }) };
    }
    case "nouvelle_option": {
      if (!slug(c.groupe)) return refus("Groupe inconnu.", 404);
      const o = nouvelleOption(c.champs);
      if (!o.ok) return refus(o.erreur);
      const p = { p_groupe: c.groupe, p_nom: o.valeur.nom, p_prix_centimes: o.valeur.prix_centimes, p_prix_valide: o.valeur.prix_valide, p_personnel: qui };
      return { ok: await fonctionSql<boolean>("ajouter_option", p) };
    }
    case "nouveau_plat": {
      const champs = champsNouveauPlat(c.champs);
      if (!champs.ok) return refus(champs.erreur);
      return { ok: true, donnees: await fonctionSql<Record<string, unknown>>("ajouter_plat", { p: champs.valeur, p_personnel: qui }) };
    }
    case "archiver": {
      if (!slug(c.slug) || typeof c.archiver !== "boolean") return refus("Plat inconnu.", 404);
      return { ok: await fonctionSql<boolean>("archiver_plat", { p_slug: c.slug, p_archiver: c.archiver, p_personnel: qui }) };
    }
    case "ordre_plats": {
      const liste = listeSlugs(c.slugs);
      if (!slug(c.categorie) || !liste) return refus("Ordre invalide.");
      return { ok: await fonctionSql<boolean>("ordonner_plats", { p_categorie: c.categorie, p_slugs: liste, p_personnel: qui }) };
    }
    case "nouvelle_categorie": {
      const nom = nomCategorie(c.nom);
      if (!nom) return refus("Indiquez le nom de la catégorie (40 caractères au plus).");
      const s = await fonctionSql<string>("ajouter_categorie", { p_slug: slugDe(nom, 40), p_nom: nom, p_personnel: qui });
      return { ok: true, donnees: { slug: s } };
    }
    case "renommer_categorie": {
      const nom = nomCategorie(c.nom);
      if (!slug(c.slug)) return refus("Catégorie inconnue.", 404);
      if (!nom) return refus("Indiquez le nom de la catégorie (40 caractères au plus).");
      return { ok: await fonctionSql<boolean>("renommer_categorie", { p_slug: c.slug, p_nom: nom, p_personnel: qui }) };
    }
    case "ordre_categories": {
      const liste = listeSlugs(c.slugs, 50);
      if (!liste) return refus("Ordre invalide.");
      return { ok: await fonctionSql<boolean>("ordonner_categories", { p_slugs: liste, p_personnel: qui }) };
    }
    case "plat_du_jour": {
      const champs = champsPlatDuJour(c.champs, instantGeneve(new Date()).date);
      if (!champs.ok) return refus(champs.erreur);
      return { ok: true, donnees: await fonctionSql<Record<string, unknown>>("ajouter_plat_du_jour", { p: champs.valeur, p_personnel: qui }) };
    }
    case "service_jour": {
      if (!slug(c.slug) || (c.service !== "midi" && c.service !== "soir" && c.service !== "journee")) return refus("Service inconnu.");
      return { ok: await fonctionSql<boolean>("modifier_service_jour", { p_slug: c.slug, p_service: c.service, p_personnel: qui }) };
    }
    default:
      return refus("Type inconnu.");
  }
}

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  let r: Reponse | NextResponse;
  try {
    r = await agir(c, g.personnel.id);
  } catch (e) {
    const message = erreurConnue(e);
    if (message) return refus(message);
    throw e;
  }
  if (r instanceof NextResponse) return r;
  if (!r.ok) return refus("Introuvable.", 404);
  // Carte, fiche et panier en cache : vidés aussitôt (docs/performance.md).
  rafraichirCaches("catalogue");
  return NextResponse.json({ enregistre: true, ...r.donnees });
}
