import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnTete } from "@/components/EnTete";
import { commandeParJeton, courrielsDeCommande } from "@/lib/db/serveur";
import { PRIVE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Courriels de test, La Ferme", robots: PRIVE };

// Préversion seulement : les courriels d'une commande gardés par la doublure (sans serveur d'envoi).
// Le jeton de suivi est exigé : on ne voit que les courriels de sa propre commande.
export default async function Courriels({ searchParams }: { searchParams: Promise<{ jeton?: string }> }) {
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") notFound();
  const { jeton } = await searchParams;
  if (!jeton || !/^[A-Za-z0-9_-]{20,64}$/.test(jeton)) notFound();
  const c = await commandeParJeton(jeton);
  if (!c) notFound();
  const liste = await courrielsDeCommande(c.id);
  return (
    <>
      <EnTete />
      <main id="contenu" className="page-suivi">
        <div className="suivi">
          <h1>Courriels de test, commande {c.numero}</h1>
          {liste.length === 0 && <p>Aucun courriel pour cette commande.</p>}
          {liste.map((m, i) => (
            <article key={i} className="courriel-test">
              <p className="suivi-num">
                {m.envoye_le.slice(0, 16).replace("T", " ")}, {m.fournisseur}, à {m.destinataire}
              </p>
              <h2>{m.sujet}</h2>
              <pre>{m.texte}</pre>
            </article>
          ))}
        </div>
      </main>
    </>
  );
}
