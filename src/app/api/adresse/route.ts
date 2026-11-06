import { NextResponse } from "next/server";
import { chargerConfigService } from "@/lib/config-service";
import { zoneServeur } from "@/lib/zone-serveur";

// Contrôle de zone côté serveur. Le navigateur affiche déjà son propre calcul, celui-ci fait foi.
// Rien n'est enregistré : l'adresse sert au calcul puis disparaît.
export async function POST(requete: Request) {
  let corps: unknown;
  try {
    corps = await requete.json();
  } catch {
    return NextResponse.json({ erreur: "Requête illisible." }, { status: 400 });
  }
  const r = await zoneServeur(await chargerConfigService(), corps);
  if ("erreur" in r) return NextResponse.json({ erreur: r.erreur }, { status: r.code });
  if (r.statut !== "livrable") return NextResponse.json({ statut: "hors-zone", verifiee: r.verifiee });
  const { numero, frais_centimes, minimum_centimes, delai_min, delai_max } = r.zone;
  return NextResponse.json({ statut: "livrable", verifiee: r.verifiee, zone: { numero, frais_centimes, minimum_centimes, delai_min, delai_max } });
}
