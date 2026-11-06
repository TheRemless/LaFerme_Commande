import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { exigerPersonnel } from "@/lib/personnel/session";
import { agir, heureValide, type Action } from "@/lib/tablette";

const STATUTS = new Set(["en_preparation", "prete", "partie", "terminee"]);

function actionValide(c: Record<string, unknown>): Action | null {
  switch (c.action) {
    case "accepter":
    case "heure": {
      const heure = heureValide(c.heure);
      return heure ? { action: c.action, heure } : null;
    }
    case "refuser": {
      if (typeof c.motif !== "string") return null;
      const m = c.motif.trim().replace(/\s+/g, " ");
      if (m.length < 3 || m.length > 200) return null;
      return { action: "refuser", motif: /[.!?]$/.test(m) ? m : `${m}.` };
    }
    case "statut":
      return typeof c.vers === "string" && STATUTS.has(c.vers) ? { action: "statut", vers: c.vers as "prete" } : null;
    case "encaisser":
    case "rembourser":
      return { action: c.action };
    default:
      return null;
  }
}

export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const corps = await corpsJson(requete);
  if (!corps || typeof corps.commande !== "string" || !/^[0-9a-f-]{36}$/.test(corps.commande)) return refus("Commande inconnue.", 404);
  const action = actionValide(corps);
  if (!action) return refus(corps.action === "accepter" || corps.action === "heure" ? "Choisissez une heure à venir." : "Action incomplète.");
  const r = await agir(corps.commande, action, g.personnel);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
