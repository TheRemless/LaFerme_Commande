"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { lireChoix, type Choix } from "@/lib/choix";
import type { Catalogue } from "@/lib/panier";
import { usePanier, usePrixServeur } from "@/lib/panier-local";
import { comptoirPermis } from "@/lib/plafond-comptoir";
import { prixChf, prixCourt, prixPhrase } from "@/lib/prix";
import { heureTexte, jourTexte } from "@/lib/service";
import { ContenuPanier } from "@/components/panier/ContenuPanier";
import { champClientInvalide, MESSAGE_CHAMP, type ChampClient } from "@/lib/validation";

type Moyen = "en_ligne" | "comptoir";

// Une clé par contenu de panier : un double clic ou un rechargement ne crée pas deux commandes.
function cleCommande(contenu: string): string {
  try {
    const memo = JSON.parse(sessionStorage.getItem("laferme.cle-commande") ?? "null") as { contenu: string; cle: string } | null;
    if (memo?.contenu === contenu) return memo.cle;
    const cle = crypto.randomUUID();
    sessionStorage.setItem("laferme.cle-commande", JSON.stringify({ contenu, cle }));
    return cle;
  } catch {
    return crypto.randomUUID();
  }
}

// Pourquoi le bouton de paiement reste gris : la même raison que dans le récapitulatif, répétée juste
// au-dessus du bouton, car sur téléphone le récapitulatif est bien plus bas (rapport client mystère, CM-02).
function raisonBlocage(
  reponse: ReturnType<typeof usePrixServeur>,
  catalogue: Catalogue,
  choix: Choix | null,
): { texte: string; lien: string; action: string } | null {
  if (!reponse || reponse.valide) return null;
  if (reponse.erreur) return { texte: reponse.erreur, lien: "/", action: "Modifier" };
  if (reponse.message_quand) return { texte: reponse.message_quand, lien: "/", action: "Changer l'heure" };
  const ligne = reponse.lignes.find((l) => l.erreur);
  if (ligne) {
    const texte = catalogue.plats[ligne.slug] ? `${ligne.nom}. ${ligne.erreur}` : (ligne.erreur ?? "");
    return { texte, lien: "/panier", action: "Modifier le panier" };
  }
  const minimum = choix?.mode === "livraison" ? choix.zone?.minimum_centimes : undefined;
  if (reponse.manque_minimum_centimes > 0 && minimum !== undefined) {
    return {
      texte: `Encore ${prixChf(reponse.manque_minimum_centimes)} de plats pour le minimum de livraison (${prixCourt(minimum)}).`,
      lien: "/carte",
      action: "Ajouter un plat",
    };
  }
  return null;
}

const CLE_COORDONNEES = "laferme.coordonnees";

type CompteConnu = { email: string; prenom: string; nom: string; telephone: string } | null;

export function PageCommande({ catalogue, preversion, compte }: { catalogue: Catalogue; preversion: boolean; compte: CompteConnu }) {
  const ids = useId();
  const annule = useSearchParams().get("annule") === "1";
  const panier = usePanier();
  const { lignes, charge, quantite } = panier;
  const reponse = usePrixServeur(lignes, charge);
  const [choix, setChoix] = useState<Choix | null>(null);
  const [client, setClient] = useState({
    prenom: compte?.prenom ?? "",
    nom: compte?.nom ?? "",
    telephone: compte?.telephone ?? "",
    email: compte?.email ?? "",
  });
  const [creerCompte, setCreerCompte] = useState(false);
  const [moyen, setMoyen] = useState<Moyen>("en_ligne");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [champFaux, setChampFaux] = useState<ChampClient | null>(null);

  useEffect(() => setChoix(lireChoix()), []);

  // Coordonnées gardées dans l'onglet : un paiement refusé ou un rechargement ne les efface plus (CM-04).
  // sessionStorage seulement, elles disparaissent avec l'onglet. Un client connecté a déjà les siennes.
  useEffect(() => {
    if (compte) return;
    try {
      const memo = JSON.parse(sessionStorage.getItem(CLE_COORDONNEES) ?? "null") as Partial<typeof client> | null;
      if (memo) setClient((c) => ({ ...c, ...memo }));
    } catch {
      // Stockage bloqué : rien à reprendre.
    }
  }, [compte]);

  if (!charge) return null;
  if (lignes.length === 0) {
    return (
      <div className="commande-vide">
        <p>Votre panier est vide.</p>
        <Link className="bouton-principal" href="/carte">
          Voir la carte
        </Link>
      </div>
    );
  }

  const quand =
    choix?.quand.type === "creneau"
      ? `Pour le ${jourTexte(choix.quand.date)} à ${heureTexte(choix.quand.minutes)}`
      : choix?.quand.type === "asap"
        ? `Dès que possible${choix.estimation !== undefined ? `, vers ${heureTexte(choix.estimation)}` : ""}`
        : "Heure à choisir";
  const total = reponse && !reponse.erreur ? reponse.total_centimes : null;
  const pret = Boolean(reponse?.valide) && !envoi;
  const raison = raisonBlocage(reponse, catalogue, choix);
  // Plafond du comptoir (réglage en base, renvoyé avec le prix du panier) : au-delà, en ligne seulement.
  const plafond = reponse?.plafond_comptoir_centimes ?? null;
  const comptoirFerme = Boolean(reponse && !reponse.erreur) && !comptoirPermis(total, plafond);
  const auComptoir = moyen === "comptoir" && choix?.mode === "retrait" && !comptoirFerme;

  async function commander(e: React.FormEvent) {
    e.preventDefault();
    if (!choix || !pret) return;
    const faux = champClientInvalide(client);
    if (faux) {
      setChampFaux(faux);
      document.getElementById(`${ids}-${faux}`)?.focus();
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      const rep = await fetch("/api/commandes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cle: cleCommande(JSON.stringify([lignes, choix, auComptoir, client])),
          lignes,
          mode: choix.mode,
          adresse: choix.adresse,
          details: choix.details,
          quand: choix.quand,
          heure: choix.heureSimulee,
          client,
          moyen: auComptoir ? "comptoir" : "en_ligne",
          creerCompte: !compte && creerCompte,
        }),
      });
      const r = (await rep.json()) as { redirection?: string; erreur?: string };
      if (r.redirection) {
        window.location.assign(r.redirection);
        return;
      }
      setErreur(r.erreur ?? "La commande n'est pas passée. Réessayez.");
    } catch {
      setErreur("Pas de connexion. Vérifiez le réseau et réessayez.");
    }
    setEnvoi(false);
  }

  const champ = (cle: keyof typeof client) => ({
    id: `${ids}-${cle}`,
    value: client[cle],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const suivant = { ...client, [cle]: e.target.value };
      setClient(suivant);
      if (champFaux === cle) setChampFaux(null);
      try {
        if (!compte) sessionStorage.setItem(CLE_COORDONNEES, JSON.stringify(suivant));
      } catch {
        // Stockage bloqué : tant pis, les champs restent remplis à l'écran.
      }
    },
    required: true,
    "aria-invalid": champFaux === cle ? true : undefined,
    "aria-describedby": champFaux === cle ? `${ids}-${cle}-erreur` : undefined,
  });
  const erreurChamp = (cle: ChampClient) =>
    champFaux === cle && (
      <p className="aide aide-erreur" id={`${ids}-${cle}-erreur`} role="alert">
        {MESSAGE_CHAMP[cle]}
      </p>
    );

  return (
    <div className="page-commande-contenu">
      <Link className="retour" href="/carte">
        ‹ Carte
      </Link>
      <h1>Finaliser la commande</h1>
      {annule && (
        <p className="panier-alerte" role="status">
          Paiement annulé. Votre panier est toujours là.
        </p>
      )}
      <div className="commande-grille">
        <form className="commande-form" onSubmit={commander}>
          <section className="etape">
            <h2>
              <span className="etape-n">1</span> {choix?.mode === "livraison" ? "Livraison" : "À emporter"}
            </h2>
            <div className="recap-mode">
              {choix?.mode === "livraison" && choix.adresse ? (
                <>
                  <p>
                    <strong>
                      {choix.adresse.rue} {choix.adresse.numero}, {choix.adresse.npa} {choix.adresse.localite}
                    </strong>
                  </p>
                  {choix.details && (
                    <p>
                      {[choix.details.etage && `étage ${choix.details.etage}`, `sonnette ${choix.details.sonnette}`, choix.details.code && `code ${choix.details.code}`]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  )}
                </>
              ) : (
                <p>
                  <strong>Route de Chancy 132, 1213 Onex</strong>
                </p>
              )}
              <p>{quand}</p>
              <Link href="/">Modifier</Link>
            </div>
          </section>

          <section className="etape">
            <h2>
              <span className="etape-n">2</span> Vos coordonnées
            </h2>
            <div className="details deux">
              <div className="champ">
                <label htmlFor={`${ids}-prenom`}>Prénom</label>
                <input {...champ("prenom")} autoComplete="given-name" maxLength={60} />
                {erreurChamp("prenom")}
              </div>
              <div className="champ">
                <label htmlFor={`${ids}-nom`}>Nom</label>
                <input {...champ("nom")} autoComplete="family-name" maxLength={60} />
                {erreurChamp("nom")}
              </div>
              <div className="champ">
                <label htmlFor={`${ids}-telephone`}>Téléphone</label>
                <input {...champ("telephone")} type="tel" autoComplete="tel" maxLength={20} />
                {erreurChamp("telephone")}
                <p className="aide">
                  Pour vous joindre au sujet de la commande.
                </p>
              </div>
              <div className="champ">
                <label htmlFor={`${ids}-email`}>E-mail</label>
                <input {...champ("email")} type="email" autoComplete="email" maxLength={120} />
                {erreurChamp("email")}
                <p className="aide">Pour la confirmation et le suivi de la commande.</p>
              </div>
            </div>
            {compte ? (
              <p className="aide">
                Connecté avec {compte.email}. La commande sera rangée dans votre compte.
              </p>
            ) : (
              <label className="option case-compte">
                <input type="checkbox" checked={creerCompte} onChange={(e) => setCreerCompte(e.target.checked)} />
                <span>
                  <strong>
                    Créer mon compte avec cet <span className="sans-coupure">e-mail</span>
                  </strong>
                  <br />
                  Pour retrouver vos adresses et vos commandes. Après la commande, vous demandez un code par e-mail pour le confirmer.
                </span>
              </label>
            )}
          </section>

          <section className="etape">
            <h2>
              <span className="etape-n">3</span> Paiement
            </h2>
            {choix?.mode === "retrait" && comptoirFerme && (
              <p className="aide" id={`${ids}-plafond`}>
                {plafond === null
                  ? "Le paiement au comptoir est indisponible pour le moment. Payez en ligne ou appelez-nous au 022 792 16 89."
                  : `Le paiement au comptoir est possible jusqu'à ${prixPhrase(plafond)}. Pour cette commande, payez en ligne.`}
              </p>
            )}
            <fieldset className="paiements">
              <legend className="sr-only">Moyen de paiement</legend>
              <label className="option paiement">
                <input type="radio" name={`${ids}-moyen`} checked={!auComptoir} onChange={() => setMoyen("en_ligne")} />
                <span>
                  <strong>En ligne</strong>
                  <br />
                  TWINT ou carte bancaire
                </span>
              </label>
              {choix?.mode === "retrait" && (
                <label className={`option paiement${comptoirFerme ? " bloque" : ""}`}>
                  <input
                    type="radio"
                    name={`${ids}-moyen`}
                    checked={auComptoir}
                    disabled={comptoirFerme}
                    aria-describedby={comptoirFerme ? `${ids}-plafond` : undefined}
                    onChange={() => setMoyen("comptoir")}
                  />
                  <span>
                    <strong>Au comptoir</strong>
                    <br />
                    en venant la chercher
                  </span>
                </label>
              )}
            </fieldset>
          </section>

          {preversion && (
            <p className="aide">
              Préversion : paiement de test, aucun montant n&apos;est débité. <Link href="/cgv">Conditions générales</Link> et{" "}
              <Link href="/confidentialite">confidentialité</Link> en ébauche, à faire relire.
            </p>
          )}
          {erreur && (
            <p className="panier-alerte" role="alert">
              {erreur}
            </p>
          )}
          {!erreur && raison && (
            <p className="panier-alerte" role="status">
              {raison.texte} <Link href={raison.lien}>{raison.action}</Link>
            </p>
          )}
          <button type="submit" className="bouton-principal" disabled={!pret}>
            {envoi
              ? "Un instant…"
              : auComptoir
                ? `Commander, je paie au comptoir`
                : `Payer ${total !== null ? prixChf(total) : ""}`}
          </button>
        </form>

        <aside className="commande-recap" aria-label="Récapitulatif">
          <h2>Récapitulatif</h2>
          <ContenuPanier lignes={lignes} quantite={quantite} catalogue={catalogue} choix={choix} reponse={reponse} preversion={false} sansBouton suivi={panier} />
          <Link className="lien" href="/carte">
            Modifier la commande
          </Link>
        </aside>
      </div>
    </div>
  );
}
