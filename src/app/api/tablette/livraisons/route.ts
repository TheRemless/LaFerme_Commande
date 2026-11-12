import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { agirLivraison, livraisonsTablette, type ActionLivraison } from "@/lib/livreur";
import { exigerPersonnel } from "@/lib/personnel/session";

// Livraisons vues de la tablette : livreurs, attributions, ordre de passage, problèmes signalés.
const UUID = /^[0-9a-f-]{36}$/;
const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);

function actionValide(c: Record<string, unknown>): ActionLivraison | null {
  const commande = id(c.commande);
  const livreur = id(c.livreur);
  switch (c.action) {
    case "attribuer":
      return commande && livreur ? { action: "attribuer", commande, livreur } : null;
    case "retirer":
      return commande ? { action: "retirer", commande } : null;
    case "deplacer":
      return commande && livreur && (c.sens === 1 || c.sens === -1) ? { action: "deplacer", commande, livreur, sens: c.sens } : null;
    case "proposer":
      return livreur ? { action: "proposer", livreur } : null;
    case "regler_probleme":
      return commande ? { action: "regler_probleme", commande } : null;
    case "client_absent":
      return commande ? { action: "client_absent", commande } : null;
    default:
      return null;
  }
}

export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await livraisonsTablette(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const corps = await corpsJson(requete);
  const action = corps && actionValide(corps);
  if (!action) return refus("Action incomplète.");
  const r = await agirLivraison(action, g.personnel);
  return NextResponse.json(r, { status: r.ok ? 200 : 409, headers: { "Cache-Control": "no-store" } });
}
