"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Categorie, LignePlat } from "@/lib/carte";
import { lireChoix, type Choix } from "@/lib/choix";
import { calculerPanier, type Catalogue } from "@/lib/panier";
import { usePanier, usePrixServeur } from "@/lib/panier-local";
import { prixChf, prixCourt } from "@/lib/prix";
import { nomAffiche } from "@/components/Plat";
import { Icone } from "@/components/Icone";
import { FichePlat } from "@/components/carte/FichePlat";
import { ContenuPanier } from "@/components/panier/ContenuPanier";

export function CarteCommande({ categories, catalogue, preversion }: { categories: Categorie[]; catalogue: Catalogue; preversion: boolean }) {
  const panier = usePanier();
  const { lignes, charge, ajouter, quantite } = panier;
  const reponse = usePrixServeur(lignes, charge);
  const [choix, setChoix] = useState<Choix | null>(null);
  const [ouvert, setOuvert] = useState<LignePlat | null>(null);
  const fermer = useCallback(() => setOuvert(null), []);
  // La fiche se ferme après l'ajout : on annonce aux lecteurs d'écran ce qui est entré dans le panier.
  const [annonce, setAnnonce] = useState("");
  // Recherche de plat (maquette Béton, docs/PROMPT.md §7) : nom et description, sans tenir compte des accents.
  const [recherche, setRecherche] = useState("");

  useEffect(() => setChoix(lireChoix()), []);

  // Après la dernière commande de la carte, seules les pizzas restent commandables pour l'heure choisie.
  const seulementPizzas = Boolean(choix?.pizzasSeulement);
  // Fermé sans créneau possible : la carte se consulte, rien ne s'ajoute (CM-08).
  const ferme = choix?.quand.type === "aucun";
  const nbArticles = lignes.reduce((s, l) => s + l.qte, 0);
  const local = calculerPanier(catalogue, lignes, choix?.mode === "livraison" && choix.zone ? choix.zone : null);
  const montants = reponse && !reponse.erreur ? reponse : local;
  const q = normaliserRecherche(recherche.trim());
  const visibles = q
    ? categories
        .map((c) => ({ ...c, plats: c.plats.filter((p) => normaliserRecherche(`${nomAffiche(p)} ${p.description ?? ""}`).includes(q)) }))
        .filter((c) => c.plats.length > 0)
    : categories;
  const trouves = visibles.reduce((s, c) => s + c.plats.length, 0);

  return (
    <>
      <nav className="cats" aria-label="Catégories">
        {visibles.map((c) => (
          <a key={c.slug} href={`#${c.slug}`}>
            {c.nom}
          </a>
        ))}
      </nav>
      <div className="carte-corps">
        <div className="carte-liste">
          <div className="carte-recherche" role="search">
            <label className="sr-only" htmlFor="recherche-plat">
              Chercher un plat
            </label>
            <span className="saisie-recherche">
              <Icone nom="loupe" />
              <input
                id="recherche-plat"
                type="search"
                placeholder="Chercher un plat"
                autoComplete="off"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
              {recherche && (
                <button type="button" className="recherche-effacer" aria-label="Effacer la recherche" onClick={() => setRecherche("")}>
                  <Icone nom="fermer" />
                </button>
              )}
            </span>
            <p className="recherche-resultat" role="status">
              {q ? (trouves === 0 ? `Aucun plat ne correspond à « ${recherche.trim()} ».` : `${trouves} plat${trouves > 1 ? "s" : ""}`) : ""}
            </p>
          </div>
          {ferme && (
            <p className="panier-alerte" role="status">
              La commande en ligne est fermée en ce moment. La carte reste à consulter. <Link href="/">Voir quand commander</Link>
            </p>
          )}
          {visibles.map((c, i) => {
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
                    {!motif && !ferme && (
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
                {c.slug === "pizzas" && !q && <p className="cat-note">Ajoutez ou retirez des ingrédients sur chaque pizza.</p>}
                {avecPhoto.length > 0 && <ul className="plats">{avecPhoto.map(rendre)}</ul>}
                {sansPhoto.length > 0 && <ul className="plats plats-texte">{sansPhoto.map(rendre)}</ul>}
              </section>
            );
          })}
        </div>
        <aside className="panier-col" aria-label="Votre commande">
          <h2 className="panier-titre">Votre commande</h2>
          <ContenuPanier lignes={lignes} quantite={quantite} catalogue={catalogue} choix={choix} reponse={reponse} preversion={preversion} suivi={panier} />
        </aside>
      </div>
      {nbArticles > 0 && (
        <Link className="barre-panier" href="/panier">
          <span className="barre-nb" key={nbArticles}>
            {nbArticles}
          </span>
          <span className="barre-txt">
            Voir le panier
            {montants.manque_minimum_centimes > 0 && <small>Encore {prixChf(montants.manque_minimum_centimes)} de plats pour le minimum</small>}
          </span>
          <span className="barre-total">{prixChf(montants.total_centimes)}</span>
        </Link>
      )}
      <p className="sr-only" role="status">
        {annonce}
      </p>
      {ouvert && (
        <FichePlat
          plat={ouvert}
          catalogue={catalogue}
          preversion={preversion}
          ferme={ferme}
          onAjouter={(ligne) => {
            ajouter(ligne);
            const total = nbArticles + ligne.qte;
            setAnnonce(`Dans le panier : ${nomAffiche(ouvert)}. ${total} article${total > 1 ? "s" : ""} en tout.`);
          }}
          onFermer={fermer}
        />
      )}
    </>
  );
}

function normaliserRecherche(t: string): string {
  return t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
