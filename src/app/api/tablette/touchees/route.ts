import { NextResponse } from "next/server";
import { refus } from "@/lib/comptes/api";
import { lirePublic } from "@/lib/db/lecture";
import { fonctionSql } from "@/lib/db/serveur";
import { jourGeneveDe } from "@/lib/heures";
import { exigerPersonnel } from "@/lib/personnel/session";
import { fileTablette } from "@/lib/tablette";
import { commandesTouchees, type Touchee } from "@/components/tablette/ruptures";

// Commandes en cours qui contiennent un plat épuisé, un poste en panne ou une catégorie (vague 3, P1 de
// produit-gestion). Base de bo-carte : commandes_touchees(p_slugs, p_cible, p_jusqu_au). Tant qu'elle n'est pas dans
// main, repli calculé ici sur la file de la tablette (commandes à accepter, acceptées, en préparation jusqu'à la date).
// GET ?slug=pizza-margherita ou ?cible=poste:pizza|poste:cuisine|categorie:<slug>, &jusqu_au=AAAA-MM-JJ facultatif.
const SANS_CACHE = { "Cache-Control": "no-store" };

export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const q = new URL(requete.url).searchParams;
  const slug = q.get("slug");
  const cible = q.get("cible");
  const jusqu = q.get("jusqu_au") ?? jourGeneveDe(new Date());
  if (slug !== null && !/^[a-z0-9-]{1,80}$/.test(slug)) return refus("Plat inconnu.", 404);
  if (cible !== null && !/^(poste:(pizza|cuisine)|categorie:[a-z0-9-]{1,40})$/.test(cible)) return refus("Cible inconnue.", 404);
  if ((slug === null) === (cible === null) || !/^\d{4}-\d{2}-\d{2}$/.test(jusqu)) return refus("Requête illisible.", 400);
  try {
    const r = await fonctionSql<Touchee[]>("commandes_touchees", { p_slugs: slug ? [slug] : [], p_cible: cible, p_jusqu_au: jusqu });
    return NextResponse.json(r, { headers: SANS_CACHE });
  } catch {
    // Repli : noms des plats visés, puis la file de la tablette.
    const carte = await lirePublic<{ slug: string; nom: string; categorie_slug: string; station: string }>("carte_publique");
    const noms = new Set(
      carte
        .filter((p) => (slug ? p.slug === slug : cible!.startsWith("categorie:") ? p.categorie_slug === cible!.slice(10) : p.station === cible!.slice(6)))
        .map((p) => p.nom),
    );
    const station = cible?.startsWith("poste:") ? (cible.slice(6) as "pizza" | "cuisine") : null;
    return NextResponse.json(commandesTouchees(await fileTablette(), { noms, station, jusqu }), { headers: SANS_CACHE });
  }
}
