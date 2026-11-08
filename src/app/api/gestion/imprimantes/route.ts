import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { empreinte, nouveauJeton } from "@/lib/comptes/securite";
import { lirePublic } from "@/lib/db/lecture";
import { fonctionSql } from "@/lib/db/serveur";
import { etatImpression } from "@/lib/impression/service";
import { origineSure } from "@/lib/origine";
import { exigerGerant } from "@/lib/personnel/session";

// Imprimantes du restaurant. L'URL CloudPRNT contient le jeton en clair : elle n'est montrée qu'une fois,
// à la création ou au renouvellement du jeton, puis seule son empreinte reste en base.

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const [etat, reglages] = await Promise.all([etatImpression(), lirePublic<{ cle: string; valeur: unknown }>("reglages")]);
  const alerte = Number(reglages.find((r) => r.cle === "alerte_acceptation_minutes")?.valeur ?? 5);
  return NextResponse.json({ imprimantes: etat.imprimantes, alerte_minutes: alerte }, { headers: { "Cache-Control": "no-store" } });
}

// { type: "ajouter", nom, station } | { type: "jeton", id } | { type: "actif", id, actif } | { type: "alerte", minutes }
export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const origine = origineSure(requete);
  const qui = g.personnel.id;
  const id = Number.isInteger(c.id) && (c.id as number) > 0 && (c.id as number) < 1000 ? (c.id as number) : null;
  const url = (jeton: string) => `${origine}/api/cloudprnt/${jeton}`;

  if (c.type === "ajouter") {
    const nom = typeof c.nom === "string" ? c.nom.trim() : "";
    if (nom.length < 2 || nom.length > 40) return refus("Donnez un nom à l'imprimante (40 caractères au plus).");
    if (c.station !== "pizza" && c.station !== "cuisine") return refus("Poste : pizza ou cuisine.");
    if (!origine) return refus("Adresse du site inconnue (URL_SITE).", 500);
    const jeton = nouveauJeton();
    await fonctionSql("ajouter_imprimante", { p_nom: nom, p_station: c.station, p_jeton_hache: empreinte("imprimante", jeton), p_personnel: qui });
    return NextResponse.json({ url: url(jeton) }, { headers: { "Cache-Control": "no-store" } });
  }
  if (c.type === "jeton") {
    if (!id) return refus("Imprimante inconnue.", 404);
    if (!origine) return refus("Adresse du site inconnue (URL_SITE).", 500);
    const jeton = nouveauJeton();
    const ok = await fonctionSql<boolean>("modifier_imprimante", { p_id: id, p_jeton_hache: empreinte("imprimante", jeton), p_actif: null, p_personnel: qui });
    return ok ? NextResponse.json({ url: url(jeton) }, { headers: { "Cache-Control": "no-store" } }) : refus("Imprimante inconnue.", 404);
  }
  if (c.type === "actif") {
    if (!id || typeof c.actif !== "boolean") return refus("Requête incomplète.");
    const ok = await fonctionSql<boolean>("modifier_imprimante", { p_id: id, p_jeton_hache: null, p_actif: c.actif, p_personnel: qui });
    return ok ? NextResponse.json({ enregistre: true }) : refus("Imprimante inconnue.", 404);
  }
  if (c.type === "alerte") {
    if (!Number.isInteger(c.minutes) || (c.minutes as number) < 2 || (c.minutes as number) > 60) return refus("Délai entre 2 et 60 minutes.");
    await fonctionSql("regler_alerte", { p_minutes: c.minutes, p_personnel: qui });
    return NextResponse.json({ enregistre: true });
  }
  return refus("Type inconnu.");
}
