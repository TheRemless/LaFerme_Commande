import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnTete } from "@/components/EnTete";
import { BoutonsTest } from "@/components/suivi/BoutonsTest";
import { fonctionSql } from "@/lib/db/serveur";
import { doublureActive } from "@/lib/paiement/passerelle";
import { prixChf } from "@/lib/prix";
import { PRIVE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Paiement de test, La Ferme", robots: PRIVE };

// Doublure de la page Stripe pour le complément d'une commande modifiée (vague 3, bo-commandes). N'existe pas en
// production ni dès qu'une vraie clé Stripe est configurée.
export default async function PaiementComplementTest({ params }: { params: Promise<{ id: string }> }) {
  if (!doublureActive()) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const m = await fonctionSql<{ difference_centimes: number; numero: number } | null>("complement_doublure", { p_modification: id });
  if (!m) notFound();
  return (
    <>
      <EnTete />
      <main id="contenu" className="page-suivi">
        <div className="suivi paiement-test">
          <p className="suivi-num">Paiement de test, aucun montant n&apos;est débité</p>
          <h1>
            Complément de la commande {m.numero} <span className="montant-test">{prixChf(m.difference_centimes)}</span>
          </h1>
          <p className="suivi-change">Cette page remplace Stripe tant que le compte n&apos;existe pas. Choisissez l&apos;issue du paiement.</p>
          <BoutonsTest complement={id} />
        </div>
      </main>
    </>
  );
}
