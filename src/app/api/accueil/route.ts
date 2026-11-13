import { NextResponse } from "next/server";
import type { AdresseEnregistree } from "@/components/accueil/ChoixCommande";
import type { DerniereCommande } from "@/components/accueil/RepriseCommande";
import { compteCourant } from "@/lib/comptes/session";
import { fonctionSql } from "@/lib/db/serveur";
import { ajouterJours, depuisHeureGeneve, instantGeneve, type CreneauPlein } from "@/lib/service";

export const dynamic = "force-dynamic";

// Ce que l'accueil ne peut pas mettre en cache : l'heure du serveur (celle d'un téléphone peut être
// fausse) et, pour un client connecté, ses adresses de livraison.
export async function GET(requete: Request) {
  // Hors production, ?heure=2026-11-10T19:05 (heure de Genève) simule un autre moment pour tester les états.
  const heure = new URL(requete.url).searchParams.get("heure");
  const simulee = process.env.CONTEXTE_DEPLOIEMENT !== "production" && heure ? depuisHeureGeneve(heure) : null;
  // Créneaux pleins des 8 prochains jours : le sélecteur d'heure ne les propose plus (SS-02, audit du gérant).
  const jour = instantGeneve(simulee ?? new Date()).date;
  // Client connecté : ses adresses et sa dernière commande (« Reprendre cette commande », vague 3).
  const compte = await compteCourant();
  const [adresses, derniere, pleins] = await Promise.all([
    compte ? fonctionSql<AdresseEnregistree[]>("adresses_compte_liste", { p_compte: compte.id }).catch(() => []) : ([] as AdresseEnregistree[]),
    compte ? fonctionSql<DerniereCommande | null>("derniere_commande_compte", { p_compte: compte.id }).catch(() => null) : null,
    fonctionSql<CreneauPlein[]>("creneaux_pleins", { p_debut: jour, p_fin: ajouterJours(jour, 8) }).catch(() => [] as CreneauPlein[]),
  ]);
  return NextResponse.json(
    { maintenant: (simulee ?? new Date()).getTime(), heureSimulee: simulee ? heure : null, adresses, derniere, pleins },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
