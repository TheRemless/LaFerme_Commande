import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { slugDe } from "@/lib/gestion";
import { champsMenu, etapesMenu } from "@/lib/gestion-menus";
import { exigerGerant } from "@/lib/personnel/session";
import { rafraichirCaches } from "@/lib/tablette";

// Menus et formules au back-office (gérant), construits désactivés : l'interrupteur menus_actifs reste faux
// tant que Jérémy n'a pas décidé de vendre des menus. Chaque fonction SQL revérifie le gérant et journalise.

const SLUG = /^[a-z0-9-]{1,80}$/;
const ERREURS: Record<string, string> = {
  categorie_inconnue: "Catégorie inconnue.",
  plat_inconnu: "Plat inconnu ou archivé.",
  etapes_invalides: "Six étapes au plus.",
  menu_archive: "Ce menu est archivé : remettez-le d'abord.",
  slug_invalide: "Nom illisible : utilisez des lettres ou des chiffres.",
  menus_prix_centimes_check: "Prix invalide : un montant en francs plus grand que zéro.",
  menu_etapes_check: "Minimum et maximum incohérents.",
  "Réservé au gérant": "Réservé au gérant.",
};

function erreurConnue(e: unknown): string | null {
  const m = e instanceof Error ? e.message : String(e);
  const incomplet = /menu_incomplet: ([^\n"]+)/.exec(m);
  if (incomplet) return `Pas en vente tant qu'il reste : ${incomplet[1].trim()}.`;
  const cle = Object.keys(ERREURS).find((k) => m.includes(k));
  return cle ? ERREURS[cle] : null;
}

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await fonctionSql("menus_gestion", {}), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const qui = g.personnel.id;
  const menu = typeof c.menu === "string" && SLUG.test(c.menu) ? c.menu : null;
  let donnees: Record<string, unknown> = {};
  try {
    switch (c.action) {
      case "creer": {
        const champs = champsMenu(c.champs, true);
        if (!champs.ok) return refus(champs.erreur);
        const base = slugDe(String(champs.valeur.nom), 56);
        if (!base) return refus(ERREURS.slug_invalide);
        donnees = { menu: await fonctionSql<string>("creer_menu", { p_slug: base, p: champs.valeur, p_personnel: qui }) };
        break;
      }
      case "modifier": {
        const champs = champsMenu(c.champs, false);
        if (!menu) return refus("Menu inconnu.", 404);
        if (!champs.ok) return refus(champs.erreur);
        if (!(await fonctionSql<boolean>("modifier_menu", { p_slug: menu, p: champs.valeur, p_personnel: qui }))) return refus("Menu inconnu.", 404);
        break;
      }
      case "etapes": {
        const etapes = etapesMenu(c.etapes);
        if (!menu) return refus("Menu inconnu.", 404);
        if (!etapes.ok) return refus(etapes.erreur);
        if (!(await fonctionSql<boolean>("regler_etapes", { p_slug: menu, p_etapes: etapes.valeur, p_personnel: qui }))) return refus("Menu inconnu.", 404);
        break;
      }
      case "archiver": {
        if (!menu || typeof c.archiver !== "boolean") return refus("Menu inconnu.", 404);
        if (!(await fonctionSql<boolean>("archiver_menu", { p_slug: menu, p_archiver: c.archiver, p_personnel: qui }))) return refus("Menu inconnu.", 404);
        break;
      }
      case "interrupteur": {
        if (typeof c.actif !== "boolean") return refus("Requête illisible.", 400);
        await fonctionSql<boolean>("activer_menus", { p_actif: c.actif, p_personnel: qui });
        break;
      }
      default:
        return refus("Action inconnue.");
    }
  } catch (e) {
    const message = erreurConnue(e);
    if (message) return refus(message);
    throw e;
  }
  rafraichirCaches("catalogue");
  return NextResponse.json({ enregistre: true, ...donnees });
}
