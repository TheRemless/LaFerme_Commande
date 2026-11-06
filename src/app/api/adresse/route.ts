import { NextResponse } from "next/server";
import { adresseOfficielle } from "@/lib/adresse-serveur";
import { chargerConfigService } from "@/lib/config-service";
import { zonePour } from "@/lib/service";

// Contrôle de zone côté serveur. Le navigateur affiche déjà son propre calcul, celui-ci fait foi.
// Rien n'est enregistré : l'adresse sert au calcul puis disparaît.

const LONGUEUR_MAX = 120;

function champ(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 && v.length <= LONGUEUR_MAX ? v.trim() : null;
}

export async function POST(requete: Request) {
  let corps: Record<string, unknown>;
  try {
    corps = await requete.json();
  } catch {
    return NextResponse.json({ erreur: "Requête illisible." }, { status: 400 });
  }

  let npa: string | null;
  let localite: string | null;
  let verifiee = false;
  const featureId = champ(corps.featureId);
  if (featureId) {
    let officielle;
    try {
      officielle = await adresseOfficielle(featureId);
    } catch {
      return NextResponse.json({ erreur: "Le service fédéral des adresses ne répond pas. Réessayez dans un instant." }, { status: 503 });
    }
    if (!officielle) return NextResponse.json({ erreur: "Adresse introuvable dans le registre fédéral." }, { status: 422 });
    if (officielle.canton !== "GE") return NextResponse.json({ statut: "hors-zone", verifiee: true });
    npa = officielle.npa;
    localite = officielle.localite;
    verifiee = true;
  } else {
    // Saisie à la main (immeuble récent absent du registre) : seul le NPA compte.
    npa = champ(corps.npa);
    localite = champ(corps.localite);
    if (!npa || !/^\d{4}$/.test(npa) || !localite) {
      return NextResponse.json({ erreur: "Indiquez un NPA à quatre chiffres et une localité." }, { status: 422 });
    }
  }

  const config = await chargerConfigService();
  const resultat = zonePour(config, npa, localite);
  if (resultat.statut !== "livrable") return NextResponse.json({ statut: "hors-zone", verifiee });
  const { numero, frais_centimes, minimum_centimes, delai_min, delai_max } = resultat.zone;
  return NextResponse.json({ statut: "livrable", verifiee, zone: { numero, frais_centimes, minimum_centimes, delai_min, delai_max } });
}
