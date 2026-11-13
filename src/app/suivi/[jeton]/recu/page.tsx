import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EnTete } from "@/components/EnTete";
import { PiedDePage } from "@/components/PiedDePage";
import { Imprimer } from "@/components/suivi/Imprimer";
import { chargerCatalogue } from "@/lib/catalogue";
import { commandeParJeton } from "@/lib/db/serveur";
import { donneesRecu, recuDisponible, VENDEUR } from "@/lib/recu";
import { PRIVE } from "@/lib/site";
import { remboursementsSuivi } from "@/lib/suivi";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reçu, La Ferme", robots: PRIVE };

// Reçu avec TVA d'une commande payée, par le même jeton que le suivi. Rien de plus que le suivi sur le client.
export default async function Recu({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(jeton)) notFound();
  const c = await commandeParJeton(jeton);
  if (!c) notFound();
  const disponible = recuDisponible(c);
  const r = disponible ? donneesRecu(c, await chargerCatalogue().catch(() => null), await remboursementsSuivi(c.id)) : null;

  return (
    <>
      <EnTete />
      <main id="contenu" className="page-recu">
        <div className="recu">
          {!r ? (
            <>
              <h1>Pas encore de reçu</h1>
              <p>Le reçu est prêt quand la commande est payée. Une commande annulée n&apos;en a pas.</p>
              <Link className="lien" href={`/suivi/${jeton}`}>
                Retour au suivi
              </Link>
            </>
          ) : (
            <>
              <h1>Reçu, commande {r.numero}</h1>
              <p className="recu-vendeur">
                {VENDEUR.raison}
                <br />
                {VENDEUR.adresse}
                <br />
                TVA {VENDEUR.tva}
              </p>
              <p className="recu-meta">
                {r.date}, {r.mode}
              </p>
              <table className="recu-table">
                <caption className="sr-only">Plats de la commande {r.numero}</caption>
                <thead>
                  <tr>
                    <th scope="col">Plat</th>
                    <th scope="col">CHF</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lignes.map((l, i) => (
                    <tr key={i}>
                      <td>
                        {l.titre}
                        {l.details.map((d) => (
                          <span key={d} className="recu-detail">
                            {d}
                          </span>
                        ))}
                      </td>
                      <td>{l.montant}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {r.sommes.map(([a, b]) => (
                    <tr key={a} className={a === "Total" ? "recu-total" : undefined}>
                      <th scope="row">{a}</th>
                      <td>{b}</td>
                    </tr>
                  ))}
                </tfoot>
              </table>
              <p>{r.paiement}.</p>
              {r.remboursements.map((t) => (
                <p key={t}>{t}</p>
              ))}
              <div className="recu-actions">
                <Imprimer />
                <Link className="lien" href={`/suivi/${jeton}`}>
                  Retour au suivi
                </Link>
              </div>
            </>
          )}
        </div>
      </main>
      <PiedDePage />
    </>
  );
}
