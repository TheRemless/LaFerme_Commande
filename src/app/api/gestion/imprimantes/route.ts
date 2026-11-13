import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { empreinte, nouveauJeton } from "@/lib/comptes/securite";
import { lirePublic } from "@/lib/db/lecture";
import { fonctionSql } from "@/lib/db/serveur";
import { etatImpression } from "@/lib/impression/service";
import { imprimerTicketTest } from "@/lib/impression/test";
import { origineSure } from "@/lib/origine";
import { exigerGerant } from "@/lib/personnel/session";

type ResumeImprimante = {
  id: number;
  dernier_ticket_le: string | null;
  en_attente: number;
  plus_ancien_en_attente_le: string | null;
  imprimes_aujourdhui: number;
  echecs_aujourdhui: number;
};

// Imprimantes du restaurant. L'URL CloudPRNT contient le jeton en clair : elle n'est montrée qu'une fois,
// à la création ou au renouvellement du jeton, puis seule son empreinte reste en base.

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const [etat, reglages, resume] = await Promise.all([
    etatImpression(),
    lirePublic<{ cle: string; valeur: unknown }>("reglages"),
    // Dernier ticket sorti, tickets en attente, échecs du jour (vague 3). Absent tant que la base n'est pas migrée.
    fonctionSql<ResumeImprimante[]>("resume_imprimantes", {}).catch(() => null),
  ]);
  const alerte = Number(reglages.find((r) => r.cle === "alerte_acceptation_minutes")?.valeur ?? 5);
  const imprimantes = etat.imprimantes.map((i) => ({ ...i, resume: resume?.find((r) => r.id === i.id) ?? null }));
  return NextResponse.json({ imprimantes, alerte_minutes: alerte }, { headers: { "Cache-Control": "no-store" } });
}

// { type: "ajouter", nom, station } | { type: "jeton", id } | { type: "actif", id, actif } | { type: "alerte", minutes }
// | { type: "test", id } (ticket de test, vague 3)
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
  if (c.type === "test") {
    if (!id) return refus("Imprimante inconnue.", 404);
    // Base revérifie le gérant et l'imprimante active, et journalise (ticket_de_test, session tablette).
    const r = await imprimerTicketTest(id, g.personnel);
    return r.ok ? NextResponse.json({ enregistre: true, tache: r.tache }, { headers: { "Cache-Control": "no-store" } }) : refus(r.erreur);
  }
  if (c.type === "alerte") {
    if (!Number.isInteger(c.minutes) || (c.minutes as number) < 2 || (c.minutes as number) > 60) return refus("Délai entre 2 et 60 minutes.");
    await fonctionSql("regler_alerte", { p_minutes: c.minutes, p_personnel: qui });
    return NextResponse.json({ enregistre: true });
  }
  return refus("Type inconnu.");
}
