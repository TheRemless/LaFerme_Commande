"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Categorie, LignePlat } from "@/lib/carte";
import { lireChoix, type Choix } from "@/lib/choix";
import { PHOTOS_SERREES, urlPhoto } from "@/lib/photos";
import { calculerPanier, type Catalogue } from "@/lib/panier";
import { usePanier, useCalculPanier } from "@/lib/panier-local";
import { LIBELLE_SERVICE, momentDuChoix, motifPlat } from "@/lib/plat-du-jour";
import { instantGeneve } from "@/lib/service";
import { prixChf, prixCourt } from "@/lib/prix";
import { nomAffiche } from "@/components/Plat";
import { Icone } from "@/components/Icone";
import { FichePlat } from "@/components/carte/FichePlat";
import { ContenuPanier } from "@/components/panier/ContenuPanier";
import { platsPopulaires, suggestionPanier, type DonneesPopulaires } from "@/lib/suggestion";
import { retenirCodeDeLUrl } from "@/lib/code-client";

export function CarteCommande({
  categories,
  catalogue,
  preversion,
  populaires,
  prenomActif = false,
}: {
  categories: Categorie[];
  catalogue: Catalogue;
  preversion: boolean;
  // Plats les plus commandés et suggestion au panier : éteints tant que Jérémy n'a pas décidé (C7).
  populaires?: DonneesPopulaires;
  // Prénom par ligne (C5), éteint par défaut.
  prenomActif?: boolean;
}) {
  const panier = usePanier();
  const { lignes, charge, ajouter, quantite, remplacer } = panier;
  const calcul = useCalculPanier(lignes, charge);
  const { reponse } = calcul;
  const [choix, setChoix] = useState<Choix | null>(null);
  const [ouvert, setOuvert] = useState<LignePlat | null>(null);
  // Ligne du panier rouverte dans sa fiche (« Modifier ») : son rang dans le panier.
  const [edition, setEdition] = useState<number | null>(null);
  const fermer = useCallback(() => {
    setOuvert(null);
    setEdition(null);
  }, []);
  const modifier = useCallback(
    (i: number) => {
      const plat = categories.flatMap((c) => c.plats).find((p) => p.slug === lignes[i]?.slug);
      if (!plat) return;
      setEdition(i);
      setOuvert(plat);
    },
    [categories, lignes],
  );
  // La fiche se ferme après l'ajout : on annonce aux lecteurs d'écran ce qui est entré dans le panier.
  const [annonce, setAnnonce] = useState("");
  // Recherche de plat (maquette Béton, docs/PROMPT.md §7) : nom et description, sans tenir compte des accents.
  const [recherche, setRecherche] = useState("");
  const [seulementVege, setSeulementVege] = useState(false);

  // Code apporté par un QR (?code=) : gardé dans l'onglet, retiré de l'adresse.
  useEffect(() => {
    setChoix(lireChoix());
    retenirCodeDeLUrl();
  }, []);

  // Après la dernière commande de la carte, seules les pizzas restent commandables pour l'heure choisie.
  const seulementPizzas = Boolean(choix?.pizzasSeulement);
  // Fermé sans créneau possible : la carte se consulte, rien ne s'ajoute (CM-08).
  const ferme = choix?.quand.type === "aucun";
  const nbArticles = lignes.reduce((s, l) => s + l.qte, 0);
  const local = calculerPanier(catalogue, lignes, choix?.mode === "livraison" && choix.zone ? choix.zone : null);
  const montants = reponse && !reponse.erreur ? reponse : local;
  const q = normaliserRecherche(recherche.trim());
  const tousPlats = categories.flatMap((c) => c.plats);
  const enTete = platsPopulaires(populaires, tousPlats);
  // Filtre végétarien : seulement si le restaurant a étiqueté au moins un plat (bo-carte, étiquettes). Rien
  // n'est deviné : sans étiquette, un plat n'est pas végétarien pour le site. Végane compte comme végétarien.
  const vegetarien = (p: LignePlat) => (p.etiquettes ?? []).some((e) => e === "vegetarien" || e === "vegane");
  const filtreVegeDispo = tousPlats.some(vegetarien);
  const vege = filtreVegeDispo && seulementVege;
  const filtre = q || vege;
  const visibles = filtre
    ? categories
        .map((c) => ({
          ...c,
          plats: c.plats.filter((p) => (!q || normaliserRecherche(`${nomAffiche(p)} ${p.description ?? ""}`).includes(q)) && (!vege || vegetarien(p))),
        }))
        .filter((c) => c.plats.length > 0)
    : enTete.length > 0
      ? [{ slug: "populaires", nom: "Les plus commandés", plats: enTete }, ...categories]
      : categories;
  const suggestion = suggestionPanier(populaires, lignes, catalogue, tousPlats);
  const trouves = visibles.reduce((s, c) => s + c.plats.length, 0);
  // Plat du jour : seulement pour un moment de ce jour-là et de son service.
  // Disponibilités (service, mode, jours, rupture planifiée) : le même texte que le refus du serveur (motifPlat),
  // pour le moment et le mode choisis à l'accueil. Le plat reste visible, grisé avec sa raison.
  const aujourdhui = instantGeneve(new Date()).date;
  const momentJour = choix ? momentDuChoix(choix.quand, choix.estimation, aujourdhui) : null;
  const moment = momentJour && choix ? { ...momentJour, mode: choix.mode } : null;

  // Onglet de la catégorie lue (D20) : la section qui passe sous la barre des catégories devient active,
  // et son onglet glisse dans la barre sur téléphone.
  const [actif, setActif] = useState<string | null>(null);
  const barre = useRef<HTMLElement>(null);
  useEffect(() => {
    const sections = [...document.querySelectorAll<HTMLElement>("section.categorie")];
    if (sections.length === 0) return;
    let image = 0;
    // Dernière section dont le haut est passé sous l'en-tête et la barre des catégories.
    const lire = () => {
      image = 0;
      const limite = (barre.current?.getBoundingClientRect().bottom ?? 0) + 24;
      const passees = sections.filter((s) => s.getBoundingClientRect().top <= limite);
      setActif((passees.at(-1) ?? sections[0]).id);
    };
    const surDefilement = () => {
      if (!image) image = window.requestAnimationFrame(lire);
    };
    lire();
    window.addEventListener("scroll", surDefilement, { passive: true });
    return () => {
      window.removeEventListener("scroll", surDefilement);
      if (image) window.cancelAnimationFrame(image);
    };
  }, [visibles.length, q]);
  useEffect(() => {
    const lien = actif ? barre.current?.querySelector<HTMLElement>(`a[href="#${actif}"]`) : null;
    if (lien && barre.current) {
      const doux = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      barre.current.scrollTo({ left: lien.offsetLeft - 12, behavior: doux ? "smooth" : "auto" });
    }
  }, [actif]);

  return (
    <>
      <nav className="cats" aria-label="Catégories" ref={barre}>
        {visibles.map((c) => (
          <a key={c.slug} href={`#${c.slug}`} aria-current={actif === c.slug ? "true" : undefined}>
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
            {filtreVegeDispo && (
              <button type="button" className="filtre-vege" aria-pressed={seulementVege} onClick={() => setSeulementVege((v) => !v)}>
                Végétarien
              </button>
            )}
            <p className="recherche-resultat" role="status">
              {filtre
                ? trouves === 0
                  ? q
                    ? `Aucun plat ne correspond à « ${recherche.trim()} ».`
                    : "Aucun plat végétarien pour le moment."
                  : `${trouves} plat${trouves > 1 ? "s" : ""}`
                : ""}
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
              const motif =
                p.rupture_motif ??
                (seulementPizzas && p.station !== "pizza" ? "Seulement les pizzas à cette heure." : null) ??
                motifPlat(catalogue, p.slug, moment, aujourdhui);
              return (
                <li key={p.slug} className={`plat ${p.photo ? "a-photo" : "sans-image"}${motif ? " epuise" : ""}`} data-slug={p.slug}>
                  <button type="button" className="plat-carte" onClick={() => setOuvert(p)} disabled={Boolean(motif)}>
                    {p.photo && (
                      <span className={`plat-media${PHOTOS_SERREES.includes(p.photo) ? " serre" : ""}`}>
                        <Image
                          src={urlPhoto(p.photo)}
                          alt=""
                          fill
                          sizes="(min-width: 1280px) 18vw, (min-width: 900px) 24vw, 50vw"
                          priority={i === 0 && j < 4}
                        />
                      </span>
                    )}
                    <span className="plat-txt">
                      <span className="plat-nom">{nomAffiche(p)}</span>
                      {p.jour_service && <span className="plat-service">{LIBELLE_SERVICE[p.jour_service]}</span>}
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
                {c.slug === "plat-du-jour" && <p className="cat-note">Aujourd&apos;hui seulement.</p>}
                {avecPhoto.length > 0 && <ul className="plats">{avecPhoto.map(rendre)}</ul>}
                {sansPhoto.length > 0 && <ul className="plats plats-texte">{sansPhoto.map(rendre)}</ul>}
              </section>
            );
          })}
        </div>
        <aside className="panier-col" aria-label="Votre commande">
          <h2 className="panier-titre">Votre commande</h2>
          <ContenuPanier lignes={lignes} quantite={quantite} catalogue={catalogue} choix={choix} reponse={reponse} preversion={preversion} suivi={panier} calcul={calcul} onModifier={modifier}
            suggestion={suggestion}
            onSuggestion={(slug) => ajouter({ slug, qte: 1, choix: {}, retraits: [], note: "" })}
          />
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
          prenomActif={prenomActif}
          initiale={edition !== null ? lignes[edition] : undefined}
          onAjouter={(ligne) => {
            if (edition !== null) {
              remplacer(edition, ligne);
              setAnnonce("Ligne mise à jour dans le panier.");
              return;
            }
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
