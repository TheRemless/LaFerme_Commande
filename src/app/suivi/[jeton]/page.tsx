import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnTete } from "@/components/EnTete";
import { PiedDePage } from "@/components/PiedDePage";
import { Actualiser } from "@/components/suivi/Actualiser";
import { CreerCompte } from "@/components/suivi/CreerCompte";
import { chargerCatalogue } from "@/lib/catalogue";
import { reconcilier } from "@/lib/commandes";
import { detailsLigne, quandTexte } from "@/lib/courriel/modeles";
import { commandeParJeton } from "@/lib/db/serveur";
import { prixChf, prixCourt } from "@/lib/prix";
import { PRIVE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Suivi de commande, La Ferme", robots: PRIVE };

const ETAPES = {
  livraison: ["Reçue", "Acceptée", "En préparation", "En route", "Livrée"],
  retrait: ["Reçue", "Acceptée", "En préparation", "Prête au comptoir", "Retirée"],
} as const;

const POSITION: Record<string, number> = { nouvelle: 0, acceptee: 1, en_preparation: 2, prete: 3, partie: 3, terminee: 4 };

function heureLocale(iso: string): string {
  return new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(":", "h");
}

// Suivi par jeton : le lien de suivi suffit, sans compte. On n'affiche ni l'adresse complète ni le téléphone.
export default async function Suivi({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(jeton)) notFound();
  let c = await commandeParJeton(jeton);
  if (!c) notFound();
  c = await reconcilier(c);
  const cat = await chargerCatalogue().catch(() => null);

  const position = POSITION[c.statut] ?? -1;
  const termine = ["terminee", "refusee", "annulee"].includes(c.statut);
  const enregistree = c.statut !== "paiement_en_attente" && c.statut !== "annulee";
  const paiement =
    c.statut_paiement === "paye"
      ? "Payée en ligne"
      : c.statut_paiement === "a_encaisser_retrait"
        ? "À payer au comptoir"
        : c.statut_paiement === "rembourse"
          ? "Remboursée"
          : c.statut_paiement === "encaisse"
            ? "Payée au comptoir"
            : "Paiement en attente";

  return (
    <>
      <EnTete />
      <main id="contenu" className="page-suivi">
        <Actualiser actif={!termine} commandeEnregistree={enregistree} />
        <div className="suivi">
          <p className="suivi-num">
            Commande {c.numero}, {c.client_prenom}
          </p>
          {c.statut === "paiement_en_attente" && (
            <>
              <h1>Paiement en cours</h1>
              <p className="suivi-change">On attend la confirmation du paiement. Cette page se met à jour toute seule.</p>
            </>
          )}
          {c.statut === "annulee" && (
            <>
              <h1>Commande annulée</h1>
              <p className="suivi-change">{c.motif ?? "La commande a été annulée."} Rien n&apos;a été débité.</p>
            </>
          )}
          {c.statut === "refusee" && (
            <>
              <h1>Commande refusée</h1>
              <p className="suivi-change">
                {c.motif ?? "Le restaurant ne peut pas préparer cette commande."}
                {c.statut_paiement === "rembourse" ? " Le montant vous est remboursé." : ""}
              </p>
            </>
          )}
          {position >= 0 && (
            <>
              <h1>
                {c.heure_confirmee ? (
                  <>
                    {c.mode === "livraison" ? "Chez vous vers" : "Prête vers"} <span className="suivi-heure">{heureLocale(c.heure_confirmee)}</span>
                  </>
                ) : (
                  "Commande reçue"
                )}
              </h1>
              {!c.heure_confirmee && (
                <p className="suivi-change">
                  {c.quand_type === "asap" ? "Demandée dès que possible." : `Demandée pour ${quandTexte(c)}.`} Le restaurant confirme l&apos;heure en acceptant la commande.
                </p>
              )}
              <ol className="etapes">
                {ETAPES[c.mode].map((t, i) => (
                  <li key={t} className={i < position ? "fait" : i === position ? "en-cours" : ""} aria-current={i === position ? "step" : undefined}>
                    <span className="puce" aria-hidden="true" />
                    <span className="etape-t">{t}</span>
                  </li>
                ))}
              </ol>
              <p className="suivi-info">Un e-mail vous prévient si l&apos;heure change.</p>
            </>
          )}
          {c.compte_demande && enregistree && <CreerCompte jeton={c.jeton_suivi} rattachee={Boolean(c.compte_id)} />}
          <section className="suivi-detail">
            <h2>{c.mode === "livraison" && c.adresse ? `Livraison à ${c.adresse.localite}` : "À emporter, Route de Chancy 132, Onex"}</h2>
            <ul className="lignes">
              {c.lignes.map((l) => (
                <li className="ligne" key={l.position}>
                  <div className="ligne-haut">
                    <span className="ligne-nom">
                      {l.qte} × {l.nom}
                    </span>
                    <span className="ligne-prix">{prixCourt(l.total_centimes)}</span>
                  </div>
                  {detailsLigne(cat, l).length > 0 && (
                    <ul className="ligne-opts">
                      {detailsLigne(cat, l).map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            <dl className="sommes">
              {c.mode === "livraison" && (
                <div>
                  <dt>Livraison</dt>
                  <dd>{prixChf(c.frais_centimes)}</dd>
                </div>
              )}
              <div className="somme-totale">
                <dt>{paiement}</dt>
                <dd>{prixChf(c.total_centimes)}</dd>
              </div>
            </dl>
            <p>
              Une question ? <a href="tel:+41227921689">022 792 16 89</a>
            </p>
          </section>
          {process.env.CONTEXTE_DEPLOIEMENT !== "production" && (
            <p className="suivi-info">
              Préversion : <a href={`/dev/courriels?jeton=${c.jeton_suivi}`}>voir les courriels de test de cette commande</a>.
            </p>
          )}
        </div>
      </main>
      <PiedDePage />
    </>
  );
}
