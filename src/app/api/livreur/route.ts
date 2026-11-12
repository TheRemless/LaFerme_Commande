import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { gesteLivreur, livraisonsDuLivreur, type Geste, type Probleme } from "@/lib/livreur";
import { exigerLivreur } from "@/lib/personnel/session";

// Téléphone du livreur : ses livraisons en cours (GET) et ses gestes (POST). Rien n'est mis en cache.
const SANS_CACHE = { "Cache-Control": "no-store, private" };
const GESTES = new Set<Geste>(["partie", "livree", "probleme", "compris"]);
const PROBLEMES = new Set<Probleme>(["client_absent", "adresse_introuvable", "autre"]);

export async function GET(requete: Request) {
  const g = await exigerLivreur(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await livraisonsDuLivreur(g.personnel), { headers: SANS_CACHE });
}

// { cle, commande, geste, motif?, detail? } ; la clé vient du téléphone et rend un geste renvoyé sans effet.
export async function POST(requete: Request) {
  const g = await exigerLivreur(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c || typeof c.cle !== "string" || !/^[A-Za-z0-9-]{16,64}$/.test(c.cle)) return refus("Geste illisible.", 400);
  if (typeof c.commande !== "string" || !/^[0-9a-f-]{36}$/.test(c.commande)) return refus("Commande inconnue.", 404);
  if (typeof c.geste !== "string" || !GESTES.has(c.geste as Geste)) return refus("Geste inconnu.");
  const geste = c.geste as Geste;
  let motif: Probleme | undefined;
  let detail: string | undefined;
  if (geste === "probleme") {
    if (typeof c.motif !== "string" || !PROBLEMES.has(c.motif as Probleme)) return refus("Choisissez le problème.");
    motif = c.motif as Probleme;
    if (c.detail !== undefined && c.detail !== null) {
      if (typeof c.detail !== "string" || c.detail.length > 200) return refus("Le mot fait 200 caractères au plus.");
      detail = c.detail;
    }
  }
  const r = await gesteLivreur(g.personnel, { cle: c.cle, commande: c.commande, geste, motif, detail });
  return NextResponse.json(r, { status: r.ok ? 200 : 409, headers: SANS_CACHE });
}
