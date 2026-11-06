import { ChoixCommande } from "@/components/accueil/ChoixCommande";
import { EnTete } from "@/components/EnTete";
import { chargerConfigService } from "@/lib/config-service";
import { depuisHeureGeneve } from "@/lib/service";

// Horaires, fermetures et zones changent dans le back-office : lecture à chaque requête.
export const dynamic = "force-dynamic";

export default async function Accueil({ searchParams }: { searchParams: Promise<{ heure?: string }> }) {
  const config = await chargerConfigService();
  const preversion = process.env.CONTEXTE_DEPLOIEMENT !== "production";
  // Hors production, ?heure=2026-11-10T19:05 (heure de Genève) simule un autre moment pour tester les états.
  const { heure } = await searchParams;
  const simulee = preversion && heure ? depuisHeureGeneve(heure) : null;
  const maintenant = simulee ? simulee.getTime() : Date.now();
  const propositions = config.zones.some((z) => z.proposition);
  return (
    <>
      <EnTete />
      {preversion && propositions && (
        <p className="bandeau-preversion" role="note">
          Préversion : zones, frais, horaires et prix proposés, en attente de validation.
        </p>
      )}
      <main className="page-accueil">
        <ChoixCommande config={config} maintenantServeur={maintenant} />
      </main>
    </>
  );
}
