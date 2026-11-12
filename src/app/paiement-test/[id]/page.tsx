import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnTete } from "@/components/EnTete";
import { BoutonsTest } from "@/components/suivi/BoutonsTest";
import { commandeParId } from "@/lib/db/serveur";
import { doublureActive } from "@/lib/paiement/passerelle";
import { prixChf } from "@/lib/prix";
import { PRIVE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Paiement de test, La Ferme", robots: PRIVE };

// Doublure de la page Stripe, pour les préversions sans compte Stripe. N'existe pas en production.
export default async function PaiementTest({ params }: { params: Promise<{ id: string }> }) {
  if (!doublureActive()) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const c = await commandeParId(id);
  if (!c || c.statut_paiement !== "en_attente") notFound();
  return (
    <>
      <EnTete />
      <main id="contenu" className="page-suivi">
        <div className="suivi paiement-test">
          <p className="suivi-num">Paiement de test, aucun montant n&apos;est débité</p>
          <h1>
            Commande {c.numero} <span className="montant-test">{prixChf(c.total_centimes)}</span>
          </h1>
          <p className="suivi-change">Cette page remplace Stripe tant que le compte n&apos;existe pas. Choisissez l&apos;issue du paiement.</p>
          <BoutonsTest commande={c.id} />
        </div>
      </main>
    </>
  );
}
