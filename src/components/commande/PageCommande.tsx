"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { lireChoix, type Choix } from "@/lib/choix";
import type { Catalogue } from "@/lib/panier";
import { usePanier, usePrixServeur } from "@/lib/panier-local";
import { prixChf } from "@/lib/prix";
import { heureTexte, jourTexte } from "@/lib/service";
import { ContenuPanier } from "@/components/panier/ContenuPanier";

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

type CompteConnu = { email: string; prenom: string; nom: string; telephone: string } | null;

export function PageCommande({ catalogue, preversion, compte }: { catalogue: Catalogue; preversion: boolean; compte: CompteConnu }) {
  const ids = useId();
  const annule = useSearchParams().get("annule") === "1";
  const { lignes, charge, quantite } = usePanier();
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

  useEffect(() => setChoix(lireChoix()), []);

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
        ? "Dès que possible"
        : "Heure à choisir";
  const total = reponse && !reponse.erreur ? reponse.total_centimes : null;
  const pret = Boolean(reponse?.valide) && !envoi;

  async function commander(e: React.FormEvent) {
    e.preventDefault();
    if (!choix || !pret) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const rep = await fetch("/api/commandes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cle: cleCommande(JSON.stringify([lignes, choix, moyen, client])),
          lignes,
          mode: choix.mode,
          adresse: choix.adresse,
          details: choix.details,
          quand: choix.quand,
          heure: choix.heureSimulee,
          client,
          moyen: choix.mode === "retrait" ? moyen : "en_ligne",
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
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setClient({ ...client, [cle]: e.target.value }),
    required: true,
  });

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
                      {[choix.details.etage && `${choix.details.etage} étage`, `sonnette ${choix.details.sonnette}`, choix.details.code && `code ${choix.details.code}`]
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
              </div>
              <div className="champ">
                <label htmlFor={`${ids}-nom`}>Nom</label>
                <input {...champ("nom")} autoComplete="family-name" maxLength={60} />
              </div>
              <div className="champ">
                <label htmlFor={`${ids}-telephone`}>Téléphone</label>
                <input {...champ("telephone")} type="tel" autoComplete="tel" maxLength={20} />
                <p className="aide">
                  Pour vous joindre au sujet de la commande.
                </p>
              </div>
              <div className="champ">
                <label htmlFor={`${ids}-email`}>E-mail</label>
                <input {...champ("email")} type="email" autoComplete="email" maxLength={120} />
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
                  <strong>Créer mon compte avec cet e-mail</strong>
                  <br />
                  Pour retrouver vos adresses et vos commandes. On vous envoie un code pour le confirmer.
                </span>
              </label>
            )}
          </section>

          <section className="etape">
            <h2>
              <span className="etape-n">3</span> Paiement
            </h2>
            <fieldset className="paiements">
              <legend className="sr-only">Moyen de paiement</legend>
              <label className="option paiement">
                <input type="radio" name={`${ids}-moyen`} checked={moyen === "en_ligne" || choix?.mode !== "retrait"} onChange={() => setMoyen("en_ligne")} />
                <span>
                  <strong>En ligne</strong>
                  <br />
                  TWINT ou carte bancaire
                </span>
              </label>
              {choix?.mode === "retrait" && (
                <label className="option paiement">
                  <input type="radio" name={`${ids}-moyen`} checked={moyen === "comptoir"} onChange={() => setMoyen("comptoir")} />
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
            <p className="aide">Préversion : paiement de test, aucun montant n&apos;est débité. Conditions générales et confidentialité à venir.</p>
          )}
          {erreur && (
            <p className="panier-alerte" role="alert">
              {erreur}
            </p>
          )}
          <button type="submit" className="bouton-principal" disabled={!pret}>
            {envoi
              ? "Un instant…"
              : moyen === "comptoir" && choix?.mode === "retrait"
                ? `Commander, je paie au comptoir`
                : `Payer ${total !== null ? prixChf(total) : ""}`}
          </button>
        </form>

        <aside className="commande-recap" aria-label="Récapitulatif">
          <h2>Récapitulatif</h2>
          <ContenuPanier lignes={lignes} quantite={quantite} catalogue={catalogue} choix={choix} reponse={reponse} preversion={false} sansBouton />
          <Link className="lien" href="/carte">
            Modifier la commande
          </Link>
        </aside>
      </div>
    </div>
  );
}
