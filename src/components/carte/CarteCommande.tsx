"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Categorie, LignePlat } from "@/lib/carte";
import { lireChoix, type Choix } from "@/lib/choix";
import type { Catalogue } from "@/lib/panier";
import { usePanier, usePrixServeur } from "@/lib/panier-local";
import { prixChf, prixCourt } from "@/lib/prix";
import { nomAffiche } from "@/components/Plat";
import { FichePlat } from "@/components/carte/FichePlat";
import { ContenuPanier } from "@/components/panier/ContenuPanier";

export function CarteCommande({ categories, catalogue, preversion }: { categories: Categorie[]; catalogue: Catalogue; preversion: boolean }) {
  const { lignes, charge, ajouter, quantite } = usePanier();
  const { reponse } = usePrixServeur(lignes, charge);
  const [choix, setChoix] = useState<Choix | null>(null);
  const [ouvert, setOuvert] = useState<LignePlat | null>(null);
  const fermer = useCallback(() => setOuvert(null), []);

  useEffect(() => setChoix(lireChoix()), []);

  // Après la dernière commande de la carte, seules les pizzas restent commandables pour l'heure choisie.
  const seulementPizzas = Boolean(choix?.pizzasSeulement);
  const nbArticles = lignes.reduce((s, l) => s + l.qte, 0);
  const total = reponse && !reponse.erreur ? reponse.total_centimes : null;

  return (
    <>
      <nav className="cats" aria-label="Catégories">
        {categories.map((c) => (
          <a key={c.slug} href={`#${c.slug}`}>
            {c.nom}
          </a>
        ))}
      </nav>
      <div className="carte-corps">
        <div className="carte-liste">
          {categories.map((c, i) => {
            const avecPhoto = c.plats.filter((p) => p.photo);
            const sansPhoto = c.plats.filter((p) => !p.photo);
            const rendre = (p: LignePlat, j: number) => {
              const motif = p.rupture_motif ?? (seulementPizzas && p.station !== "pizza" ? "Seulement les pizzas à cette heure" : null);
              return (
                <li key={p.slug} className={`plat ${p.photo ? "a-photo" : "sans-image"}${motif ? " epuise" : ""}`} data-slug={p.slug}>
                  <button type="button" className="plat-carte" onClick={() => setOuvert(p)} disabled={Boolean(motif)}>
                    {p.photo && (
                      <span className="plat-media">
                        <Image
                          src={`/plats/${p.photo}`}
                          alt=""
                          fill
                          sizes="(min-width: 1280px) 18vw, (min-width: 900px) 24vw, 50vw"
                          priority={i === 0 && j < 4}
                        />
                      </span>
                    )}
                    <span className="plat-txt">
                      <span className="plat-nom">{nomAffiche(p)}</span>
                      {p.description && <span className="plat-desc">{p.description}</span>}
                      {motif && <span className="plat-rupture">{motif}</span>}
                    </span>
                    <span className="plat-prix">{prixCourt(p.prix_centimes)}</span>
                    {!motif && (
                      <span className="plat-ajout" aria-hidden="true">
                        +
                      </span>
                    )}
                  </button>
                </li>
              );
            };
            return (
              <section key={c.slug} id={c.slug} className="categorie" aria-labelledby={`${c.slug}-titre`}>
                <h2 id={`${c.slug}-titre`}>{c.nom}</h2>
                {c.slug === "pizzas" && <p className="cat-note">Ajoutez ou retirez des ingrédients sur chaque pizza.</p>}
                {avecPhoto.length > 0 && <ul className="plats">{avecPhoto.map(rendre)}</ul>}
                {sansPhoto.length > 0 && <ul className="plats plats-texte">{sansPhoto.map(rendre)}</ul>}
              </section>
            );
          })}
        </div>
        <aside className="panier-col" aria-label="Votre commande">
          <h2 className="panier-titre">Votre commande</h2>
          <ContenuPanier lignes={lignes} quantite={quantite} catalogue={catalogue} choix={choix} reponse={reponse} preversion={preversion} />
        </aside>
      </div>
      {nbArticles > 0 && (
        <Link className="barre-panier" href="/panier">
          <span className="barre-nb">{nbArticles}</span>
          <span className="barre-txt">
            Voir le panier
            {reponse && reponse.manque_minimum_centimes > 0 && <small>Encore {prixChf(reponse.manque_minimum_centimes)} pour le minimum</small>}
          </span>
          <span className="barre-total">{total !== null ? prixChf(total) : ""}</span>
        </Link>
      )}
      {ouvert && <FichePlat plat={ouvert} catalogue={catalogue} preversion={preversion} onAjouter={ajouter} onFermer={fermer} />}
    </>
  );
}
