import { EnTete } from "@/components/EnTete";
import { PiedDePage } from "@/components/PiedDePage";
import { ResumeChoix } from "@/components/ResumeChoix";
import { CarteCommande } from "@/components/carte/CarteCommande";
import { chargerCarte } from "@/lib/carte";
import { chargerCatalogue } from "@/lib/catalogue";

// La carte change dans le back-office sans redéploiement : lecture à chaque requête.
export const dynamic = "force-dynamic";

export default async function PageCarte() {
  const [{ categories, source }, catalogue] = await Promise.all([chargerCarte(), chargerCatalogue()]);
  const preversion = process.env.CONTEXTE_DEPLOIEMENT !== "production";
  const aValider = categories.some((c) => c.plats.some((p) => p.prix_a_valider));
  return (
    <>
      <EnTete>
        <ResumeChoix />
      </EnTete>
      {preversion && aValider && (
        <p className="bandeau-preversion" role="note">
          Préversion : prix proposés, en attente de validation.
        </p>
      )}
      {/* Sur les previews, data-source dit d'où vient la carte (Supabase ou base embarquée). */}
      <main className="page-carte" data-source={preversion ? source : undefined}>
        <CarteCommande categories={categories} catalogue={catalogue} preversion={preversion} />
      </main>
      <PiedDePage />
    </>
  );
}
