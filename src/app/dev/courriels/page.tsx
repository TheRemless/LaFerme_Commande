import { notFound } from "next/navigation";
import { EnTete } from "@/components/EnTete";
import { derniersCourriels } from "@/lib/db/serveur";

export const dynamic = "force-dynamic";

// Préversion seulement : les courriels gardés par la doublure (sans Resend), pour relire ce que reçoit le client.
export default async function Courriels() {
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") notFound();
  const liste = await derniersCourriels(10);
  return (
    <>
      <EnTete />
      <main className="page-suivi">
        <div className="suivi">
          <h1>Courriels de test</h1>
          {liste.length === 0 && <p>Aucun courriel pour l&apos;instant.</p>}
          {liste.map((c, i) => (
            <article key={i} className="courriel-test">
              <p className="suivi-num">
                {c.envoye_le.slice(0, 16).replace("T", " ")}, {c.fournisseur}, à {c.destinataire}
              </p>
              <h2>{c.sujet}</h2>
              <pre>{c.texte}</pre>
            </article>
          ))}
        </div>
      </main>
    </>
  );
}
