import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { champsOption, champsPlat, nomsRetraits } from "@/lib/gestion";
import { exigerGerant } from "@/lib/personnel/session";
import { rafraichirCaches } from "@/lib/tablette";

const SLUG = /^[a-z0-9-]{1,80}$/;

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await fonctionSql("gestion_carte", {}), { headers: { "Cache-Control": "no-store" } });
}

// { type: "plat", slug, champs } | { type: "retraits", slug, noms } | { type: "option", groupe, nom, champs }
export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const qui = g.personnel.id;
  let ok = false;
  if (c.type === "plat") {
    if (typeof c.slug !== "string" || !SLUG.test(c.slug)) return refus("Plat inconnu.", 404);
    const champs = champsPlat(c.champs);
    if (!champs.ok) return refus(champs.erreur);
    ok = (await fonctionSql<unknown>("modifier_plat", { p_slug: c.slug, p: champs.valeur, p_personnel: qui })) !== null;
  } else if (c.type === "retraits") {
    const noms = nomsRetraits(c.noms);
    if (typeof c.slug !== "string" || !SLUG.test(c.slug) || !noms) return refus("Liste de retraits invalide.");
    ok = await fonctionSql<boolean>("modifier_retraits", { p_slug: c.slug, p_noms: noms, p_personnel: qui });
  } else if (c.type === "option") {
    if (typeof c.groupe !== "string" || !SLUG.test(c.groupe) || typeof c.nom !== "string" || c.nom.length > 80) return refus("Option inconnue.", 404);
    const champs = champsOption(c.champs);
    if (!champs.ok) return refus(champs.erreur);
    ok = await fonctionSql<boolean>("modifier_option", { p_groupe: c.groupe, p_nom: c.nom, p: champs.valeur, p_personnel: qui });
  } else return refus("Type inconnu.");
  if (!ok) return refus("Introuvable.", 404);
  rafraichirCaches("catalogue");
  return NextResponse.json({ enregistre: true });
}
