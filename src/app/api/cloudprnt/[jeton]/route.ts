import { NextResponse } from "next/server";
import { empreinte } from "@/lib/comptes/securite";
import { fonctionSql } from "@/lib/db/serveur";
import { pngTicket } from "@/lib/impression/png";
import { texteTicket, type LigneTicket } from "@/lib/impression/ticket";
import { alerter, executerSurveillance } from "@/lib/surveillance";

// Star CloudPRNT (HTTP), d'après la référence du protocole Star (manuel v2.6.0) :
// - POST : l'imprimante donne son état et demande s'il y a un ticket ({ jobReady, mediaTypes, jobToken }) ;
// - GET : elle télécharge le ticket dans le format choisi (image/png de préférence, text/plain en secours) ;
// - DELETE : elle confirme (code 200 OK) ou signale l'échec ; la tâche ne quitte la file qu'à ce moment.
// Une URL par imprimante, dont le jeton est le seul secret ; la MAC est liée au premier passage.

export const dynamic = "force-dynamic";

const JETON = /^[A-Za-z0-9_-]{43}$/;
const MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
const TACHE = /^[0-9a-f-]{36}$/;
const TYPES = ["image/png", "text/plain"] as const;

function mac(requete: Request, corps?: Record<string, unknown>): string | null {
  const brut = requete.headers.get("x-star-mac") ?? (typeof corps?.printerMAC === "string" ? corps.printerMAC : null) ?? new URL(requete.url).searchParams.get("mac");
  const m = brut?.trim().toLowerCase().replace(/-/g, ":") ?? null;
  return m && MAC.test(m) ? m : null;
}

async function cle(params: Promise<{ jeton: string }>): Promise<string | null> {
  const { jeton } = await params;
  return JETON.test(jeton) ? empreinte("imprimante", jeton) : null;
}

const refus = () => new NextResponse(null, { status: 403 });

export async function POST(requete: Request, { params }: { params: Promise<{ jeton: string }> }) {
  const hache = await cle(params);
  if (!hache) return refus();
  const texte = await requete.text();
  if (texte.length > 8000) return new NextResponse(null, { status: 400 });
  let corps: Record<string, unknown> = {};
  try {
    corps = JSON.parse(texte || "{}");
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  let statut: string | null = null;
  if (typeof corps.statusCode === "string") {
    try {
      statut = decodeURIComponent(corps.statusCode).slice(0, 40);
    } catch {
      statut = corps.statusCode.slice(0, 40);
    }
  }
  const r = await fonctionSql<{ imprimante: number; tache: string | null } | null>("passage_imprimante", {
    p_jeton_hache: hache,
    p_mac: mac(requete, corps),
    p_statut_code: statut,
  });
  if (!r) return refus();
  // L'imprimante passe toutes les 5 secondes : bon moment pour la surveillance (une fois par minute au plus).
  await executerSurveillance().catch((e) => console.error(`Surveillance : ${e instanceof Error ? e.message : e}`));
  return NextResponse.json(r.tache ? { jobReady: true, mediaTypes: TYPES, jobToken: r.tache } : { jobReady: false }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(requete: Request, { params }: { params: Promise<{ jeton: string }> }) {
  const hache = await cle(params);
  if (!hache) return refus();
  const q = new URL(requete.url).searchParams;
  const tache = q.get("token");
  if (!tache || !TACHE.test(tache)) return new NextResponse(null, { status: 404 });
  const type = q.get("type") ?? "image/png";
  if (!(TYPES as readonly string[]).includes(type)) return new NextResponse(null, { status: 415 });
  const contenu = await fonctionSql<LigneTicket[] | null>("tache_pour_imprimante", { p_jeton_hache: hache, p_mac: mac(requete), p_tache: tache });
  if (!contenu) return new NextResponse(null, { status: 404 });
  const entetes = { "Content-Type": type, "X-Star-Cut": "full; feed=true", "Cache-Control": "no-store" };
  // Texte de secours en ASCII seul (page de codes de l'imprimante inconnue) ; Content-Type identique au type demandé.
  if (type === "text/plain") return new NextResponse(texteTicket(contenu), { headers: entetes });
  return new NextResponse(Buffer.from(await pngTicket(contenu)), { headers: entetes });
}

export async function DELETE(requete: Request, { params }: { params: Promise<{ jeton: string }> }) {
  const hache = await cle(params);
  if (!hache) return refus();
  const q = new URL(requete.url).searchParams;
  const tache = q.get("token");
  if (!tache || !TACHE.test(tache)) return new NextResponse(null, { status: 200 });
  // URLSearchParams décode déjà « 200%20OK » en « 200 OK ».
  const code = (q.get("code") ?? "").slice(0, 40);
  const r = await fonctionSql<{ etat: string; station: string; imprimante: string; erreur: string | null; numero: number } | null>("confirmer_tache", {
    p_jeton_hache: hache,
    p_mac: mac(requete),
    p_tache: tache,
    p_code: code,
  });
  // Troisième échec : le ticket ne repartira plus seul, le restaurant est prévenu.
  if (r?.etat === "echec") {
    await alerter(`Ticket ${r.station} de la commande ${r.numero} non imprimé`, [
      `${r.imprimante} n'a pas pu imprimer le ticket ${r.station} de la commande ${r.numero} après trois essais (${r.erreur ?? "erreur inconnue"}).`,
      "Touchez « Ticket » sur la tablette pour le lire, ou « Réimprimer » une fois l'imprimante réparée.",
    ]).catch((e) => console.error(`Alerte non envoyée : ${e instanceof Error ? e.message : e}`));
  }
  return new NextResponse(null, { status: 200 });
}
