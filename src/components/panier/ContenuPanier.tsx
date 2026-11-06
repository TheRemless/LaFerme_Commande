"use client";

import Link from "next/link";
import { calculerPanier, type Catalogue, type LignePanier } from "@/lib/panier";
import type { ReponsePanier } from "@/lib/panier-local";
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
}: {
  lignes: LignePanier[];
  quantite: (i: number, delta: number) => void;
  catalogue: Catalogue;
  choix: Choix | null;
  reponse: ReponsePanier | null;
  preversion?: boolean;
  sansBouton?: boolean;
}) {
  const local = calculerPanier(catalogue, lignes, choix?.mode === "livraison" && choix.zone ? choix.zone : null);
  const t = reponse && !reponse.erreur ? reponse : local;
  const minimum = choix?.mode === "livraison" ? choix.zone?.minimum_centimes : undefined;

  if (lignes.length === 0) {
    return <p className="panier-vide">Votre panier est vide. Touchez un plat pour l&apos;ajouter.</p>;
  }

  return (
    <>
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
                <span className="ligne-nom">{plat ? nomAffiche({ nom: plat.nom, categorie_slug: plat.categorie_slug }) : l.slug}</span>
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
              {calcul?.erreur && (
                <p className="ligne-erreur" role="alert">
                  {calcul.erreur}
                </p>
              )}
              <div className="qte" aria-label={`Quantité de ${plat?.nom ?? l.slug}`}>
                <button type="button" onClick={() => quantite(i, -1)} aria-label={l.qte === 1 ? "Retirer du panier" : "Un de moins"}>
                  −
                </button>
                <span>{l.qte}</span>
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
            Encore <strong>{prixChf(t.manque_minimum_centimes)}</strong> pour le minimum de livraison ({prixCourt(minimum)}).
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
