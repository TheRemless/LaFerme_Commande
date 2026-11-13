import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnTete } from "@/components/EnTete";
import { Icone } from "@/components/Icone";
import { PiedDePage } from "@/components/PiedDePage";
import { Actualiser } from "@/components/suivi/Actualiser";
import { CreerCompte } from "@/components/suivi/CreerCompte";
import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { estimationAsap } from "@/lib/estimation";
import { heureTexte } from "@/lib/service";
import { reconcilier } from "@/lib/commandes";
import { detailsLigne, quandTexte } from "@/lib/courriel/modeles";
import { commandeParJeton } from "@/lib/db/serveur";
import { nomClient } from "@/lib/nom-plat";
import { prixChf, prixCourt } from "@/lib/prix";
import { PRIVE } from "@/lib/site";
import { enRetard, libellePaiement, PHRASE_RETARD, phraseRemboursement, remboursementsSuivi, resteComptoir } from "@/lib/suivi";
import { MOTIF_CLIENT_ABSENT } from "@/lib/livraisons-textes";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Suivi de commande, La Ferme", robots: PRIVE };

const ETAPES = {
  livraison: ["Reçue", "Acceptée", "En préparation", "En route", "Livrée"],
  retrait: ["Reçue", "Acceptée", "En préparation", "Prête au comptoir", "Retirée"],
} as const;

const POSITION: Record<string, number> = { nouvelle: 0, acceptee: 1, en_preparation: 2, prete: 3, partie: 3, terminee: 4 };

// « CHF 5.00 » et le numéro de téléphone ne se coupent pas en fin de ligne sur un petit écran.
function insecable(t: string): string {
  return t.replace(/CHF /g, "CHF\u00a0").replace(/(\d{3}) (\d{3}) (\d{2}) (\d{2})/g, "$1\u00a0$2\u00a0$3\u00a0$4");
}

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
  const estimation = c.heure_confirmee ? null : await chargerConfigService().then((config) => estimationAsap(config, c!)).catch(() => null);

  // Livraison close, client absent : pas « Livrée » (décision de Jérémy du 12.11.2026).
  const nonRemise = c.statut === "terminee" && c.motif === MOTIF_CLIENT_ABSENT;
  const position = nonRemise ? -1 : (POSITION[c.statut] ?? -1);
  const termine = ["terminee", "refusee", "annulee"].includes(c.statut);
  const enregistree = c.statut !== "paiement_en_attente" && c.statut !== "annulee";
  const remboursements = enregistree ? await remboursementsSuivi(c.id) : [];
  const paiement = libellePaiement(c, remboursements);
  const reste = resteComptoir(c, remboursements);
  const retard = enRetard(c);
  // Un remboursement attendu chez Stripe garde la page à jour, même commande terminée.
  const attente = remboursements.some((r) => r.moyen === "stripe" && r.statut === "en_cours");

  return (
    <>
      <EnTete />
      <main id="contenu" className="page-suivi">
        <Actualiser actif={!termine || attente} commandeEnregistree={enregistree} />
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
                {c.statut_paiement === "rembourse" && remboursements.length === 0 ? " Le montant vous est remboursé." : ""}
              </p>
            </>
          )}
          {nonRemise && (
            <>
              <h1>Commande non remise</h1>
              <p className="suivi-change">Notre livreur est passé chez vous avec votre commande. Personne n&apos;a répondu et il est reparti avec la commande.</p>
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
                  {c.quand_type === "asap"
                    ? `Demandée dès que possible${estimation !== null ? `, vers ${heureTexte(estimation)}` : ""}.`
                    : `Demandée pour ${quandTexte(c)}.`} Le restaurant confirme l&apos;heure en acceptant la commande.
                </p>
              )}
              <ol className="etapes">
                {ETAPES[c.mode].map((t, i) => (
                  <li key={t} className={i < position ? "fait" : i === position ? "en-cours" : ""} aria-current={i === position ? "step" : undefined}>
                    <span className="puce" aria-hidden="true">
                      {i < position && <Icone nom="ok" />}
                    </span>
                    <span className="etape-t">{t}</span>
                  </li>
                ))}
              </ol>
              {retard ? (
                <p className="suivi-retard" role="status">
                  {PHRASE_RETARD}
                </p>
              ) : (
                <p className="suivi-info">Un e-mail vous prévient si l&apos;heure change.</p>
              )}
            </>
          )}
          {remboursements.length > 0 && (
            <section className="suivi-remboursements" aria-labelledby="titre-remboursements">
              <h2 id="titre-remboursements">{remboursements.length > 1 ? "Remboursements" : "Remboursement"}</h2>
              <ul>
                {remboursements.map((r) => {
                  const p = phraseRemboursement(r);
                  return (
                    <li key={r.cree_le} className={`remb-${p.etat}`}>
                      {insecable(p.texte)}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {c.compte_demande && enregistree && <CreerCompte jeton={c.jeton_suivi} rattachee={Boolean(c.compte_id)} />}
          <section className="suivi-detail">
            <h2>{c.mode === "livraison" && c.adresse ? `Livraison à ${c.adresse.localite}` : "À emporter, Route de Chancy 132, Onex"}</h2>
            <ul className="lignes">
              {c.lignes.map((l) => (
                <li className="ligne" key={l.position}>
                  <div className="ligne-haut">
                    <span className="ligne-nom">
                      {l.qte} × {nomClient(l.nom, l.station === "pizza")}
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
              {reste !== null && (
                <div>
                  <dt>Reste à payer au comptoir</dt>
                  <dd>{prixChf(reste)}</dd>
                </div>
              )}
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
