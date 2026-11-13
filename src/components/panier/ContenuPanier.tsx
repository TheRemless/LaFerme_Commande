"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { calculerPanier, platDe, type Catalogue, type LignePanier } from "@/lib/panier";
import type { CalculPanier, ReponsePanier, SuiviPanier } from "@/lib/panier-local";
import type { Choix } from "@/lib/choix";
import { prixChf, prixCourt } from "@/lib/prix";
import { nomAffiche } from "@/components/Plat";

// Liste du panier et montants. Les montants affichés sont ceux du serveur dès qu'ils arrivent ;
// avant, le même calcul fait dans le navigateur évite un panier vide pendant 300 ms.
export function ContenuPanier({
  lignes,
  quantite,
  catalogue,
  choix,
  reponse,
  sansBouton = false,
  suivi,
  calcul,
  onModifier,
}: {
  lignes: LignePanier[];
  quantite: (i: number, delta: number) => void;
  catalogue: Catalogue;
  choix: Choix | null;
  reponse: ReponsePanier | null;
  preversion?: boolean;
  sansBouton?: boolean;
  suivi?: SuiviPanier;
  calcul?: CalculPanier;
  // Rouvre la fiche du plat avec les choix de la ligne (absent : pas de bouton « Modifier »).
  onModifier?: (i: number) => void;
}) {
  const local = calculerPanier(catalogue, lignes, choix?.mode === "livraison" && choix.zone ? choix.zone : null);
  const t = reponse && !reponse.erreur ? reponse : local;
  const minimum = choix?.mode === "livraison" ? choix.zone?.minimum_centimes : undefined;

  const annonces = <AnnoncesPanier catalogue={catalogue} suivi={suivi} />;

  if (lignes.length === 0) {
    return (
      <>
        {annonces}
        <p className="panier-vide">Votre panier est vide. Touchez un plat pour l&apos;ajouter.</p>
      </>
    );
  }

  return (
    <>
      {annonces}
      <ul className="lignes">
        {lignes.map((l, i) => {
          const plat = catalogue.plats[l.slug];
          const calcul = t.lignes[i];
          const details = [
            ...Object.entries(l.choix).flatMap(([g, noms]) =>
              noms.map((n) => {
                const groupe = catalogue.groupes[g];
                const o = groupe?.options.find((x) => x.nom === n);
                return groupe?.choix_max === 1
                  ? { texte: n, prix: 0 }
                  : { texte: `+ ${n.toLowerCase()}`, prix: o?.prix_centimes ?? 0 };
              }),
            ),
            ...l.retraits.map((r) => ({ texte: `Sans ${r.toLowerCase()}`, prix: 0 })),
          ];
          return (
            <li className="ligne" key={i}>
              <div className="ligne-haut">
                <span className="ligne-nom">{plat ? nomAffiche({ nom: plat.nom, categorie_slug: plat.categorie_slug }) : "Plat indisponible"}</span>
                <span className="ligne-prix">{prixCourt(calcul?.total_centimes ?? 0)}</span>
              </div>
              {(details.length > 0 || l.note) && (
                <ul className="ligne-opts">
                  {details.map((d) => (
                    <li key={d.texte}>
                      {d.texte}
                      {d.prix > 0 && <span className="opt-prix"> {prixCourt(d.prix)}</span>}
                    </li>
                  ))}
                  {l.note && <li className="opt-note">« {l.note} »</li>}
                </ul>
              )}
              {onModifier && plat && (
                <button
                  type="button"
                  className="lien ligne-modifier"
                  onClick={() => onModifier(i)}
                  aria-label={`Modifier ${nomAffiche({ nom: plat.nom, categorie_slug: plat.categorie_slug })}`}
                >
                  Modifier
                </button>
              )}
              {calcul?.erreur && (
                <p className="ligne-erreur" role="alert">
                  {calcul.erreur}
                </p>
              )}
              <div className="qte" role="group" aria-label={`Quantité de ${plat?.nom ?? l.slug}`}>
                <button type="button" onClick={() => quantite(i, -1)} aria-label={l.qte === 1 ? "Retirer du panier" : "Un de moins"}>
                  −
                </button>
                {/* Annoncée à chaque changement : le lecteur d'écran confirme le geste. */}
                <span aria-live="polite" aria-atomic="true">
                  <span className="sr-only">Quantité : </span>
                  {l.qte}
                </span>
                <button type="button" onClick={() => quantite(i, 1)} aria-label="Un de plus">
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <dl className="sommes">
        <div>
          <dt>Sous-total</dt>
          <dd>{prixChf(t.sous_total_centimes)}</dd>
        </div>
        {choix?.mode === "livraison" && (
          <div>
            <dt>Livraison</dt>
            <dd>{prixChf(t.frais_centimes)}</dd>
          </div>
        )}
        <div className="somme-totale">
          <dt>Total</dt>
          <dd>{prixChf(t.total_centimes)}</dd>
        </div>
        <div className="tva">
          <dt>dont TVA {String(catalogue.tauxTvaPourcent).replace(".", ",")} %</dt>
          <dd>{prixChf(t.tva_centimes)}</dd>
        </div>
      </dl>

      {t.manque_minimum_centimes > 0 && minimum !== undefined && (
        <div className="minimum" role="status">
          <p>
            Encore <strong>{prixChf(t.manque_minimum_centimes)}</strong> de plats pour le minimum de livraison ({prixCourt(minimum)}).
          </p>
          <span className="jauge" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.round((t.sous_total_centimes / minimum) * 100))}%` }} />
          </span>
        </div>
      )}
      {reponse?.message_quand && (
        <p className="panier-alerte" role="alert">
          {reponse.message_quand} <Link href="/">Changer l&apos;heure</Link>
        </p>
      )}
      {reponse?.erreur && (
        <p className="panier-alerte" role="alert">
          {reponse.erreur} <Link href="/">Modifier</Link>
        </p>
      )}

      {!sansBouton && calcul && <EtatCalcul calcul={calcul} />}
      {!sansBouton &&
        (reponse?.valide ? (
          <Link className="bouton-principal" href="/commande">
            Commander, {prixChf(t.total_centimes)}
          </Link>
        ) : (
          <button type="button" className="bouton-principal" disabled>
            Commander, {prixChf(t.total_centimes)}
          </button>
        ))}
    </>
  );
}

// Pourquoi le bouton est gris quand le total n'est pas encore là : calcul lent ou réseau coupé.
export function EtatCalcul({ calcul }: { calcul: CalculPanier }) {
  if (calcul.reponse) return null;
  if (calcul.echec) {
    return (
      <p className="panier-alerte" role="alert">
        Le total n&apos;a pas pu être calculé. Vérifiez la connexion.
        {/* À la ligne : la cible de 44 px du bouton n'écarte pas les lignes du message. */}
        <br />
        <button type="button" className="lien" onClick={calcul.relancer}>
          Réessayer
        </button>
      </p>
    );
  }
  if (calcul.lent) {
    return (
      <p className="aide" role="status">
        Calcul du total en cours…
      </p>
    );
  }
  return null;
}

// Panier expiré (CM-15) et ligne retirée par « − » avec « Annuler » (CM-23).
function AnnoncesPanier({ catalogue, suivi }: { catalogue: Catalogue; suivi?: SuiviPanier }) {
  const expire = useRef<HTMLParagraphElement>(null);
  const montre = Boolean(suivi?.expire);
  const oublier = suivi?.oublierExpire;
  useEffect(() => {
    // Oublié seulement une fois vu : le panier de côté est caché sur téléphone, sur la carte.
    if (montre && expire.current?.getClientRects().length) oublier?.();
  }, [montre, oublier]);
  if (!suivi) return null;
  const plat = suivi.retiree ? platDe(catalogue, suivi.retiree.ligne.slug) : undefined;
  return (
    <>
      {suivi.expire && (
        <p className="panier-vide" role="status" ref={expire}>
          Votre panier précédent avait plus de 24 heures. Il a été vidé.
        </p>
      )}
      {suivi.retiree && (
        <p className="panier-vide" role="status">
          {plat ? nomAffiche({ nom: plat.nom, categorie_slug: plat.categorie_slug }) : "Le plat"} n&apos;est plus dans le panier.{" "}
          <button type="button" className="lien" onClick={suivi.annulerRetrait}>
            Annuler
          </button>
        </p>
      )}
    </>
  );
}
