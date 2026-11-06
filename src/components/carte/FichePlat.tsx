"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import type { LignePlat } from "@/lib/carte";
import { LIMITES, prixUnitaire, type Catalogue, type LignePanier } from "@/lib/panier";
import { prixChf, prixCourt } from "@/lib/prix";
import { nomAffiche } from "@/components/Plat";
import { Icone } from "@/components/Icone";

// Suppléments affichés d'office ; les autres derrière « Voir les … suppléments ».
const SUPPLEMENTS_VISIBLES = 8;

export function FichePlat({
  plat,
  catalogue,
  preversion,
  onAjouter,
  onFermer,
}: {
  plat: LignePlat;
  catalogue: Catalogue;
  preversion: boolean;
  onAjouter: (l: LignePanier) => void;
  onFermer: () => void;
}) {
  const ids = useId();
  const fenetre = useRef<HTMLDivElement>(null);
  const info = catalogue.plats[plat.slug];
  const groupes = (info?.groupes ?? []).map((g) => catalogue.groupes[g]).filter(Boolean);
  const [qte, setQte] = useState(1);
  const [choix, setChoix] = useState<Record<string, string[]>>({});
  const [retraits, setRetraits] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [tous, setTous] = useState(false);

  useEffect(() => {
    const avant = document.activeElement as HTMLElement | null;
    document.body.classList.add("fiche-ouverte");
    fenetre.current?.focus();
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onFermer();
      if (e.key !== "Tab" || !fenetre.current) return;
      // Tab et Maj+Tab tournent dans la fiche au lieu de passer sur la carte derrière le voile.
      const focusables = fenetre.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href]");
      const premier = focusables[0];
      const dernier = focusables[focusables.length - 1];
      if (e.shiftKey && (document.activeElement === premier || document.activeElement === fenetre.current)) {
        e.preventDefault();
        dernier?.focus();
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault();
        premier?.focus();
      }
    };
    document.addEventListener("keydown", touche);
    return () => {
      document.body.classList.remove("fiche-ouverte");
      document.removeEventListener("keydown", touche);
      avant?.focus();
    };
  }, [onFermer]);

  const ligne: LignePanier = { slug: plat.slug, qte, choix, retraits, note: note.trim() };
  const manquant = groupes.find((g) => (choix[g.slug]?.length ?? 0) < g.choix_min);
  const total = prixUnitaire(catalogue, ligne) * qte;

  function basculer(groupe: string, nom: string, max: number) {
    const actuels = choix[groupe] ?? [];
    if (max === 1) return setChoix({ ...choix, [groupe]: [nom] });
    const suivants = actuels.includes(nom) ? actuels.filter((n) => n !== nom) : actuels.length < max ? [...actuels, nom] : actuels;
    setChoix({ ...choix, [groupe]: suivants });
  }

  const provenances = [
    ...(plat.provenance ? plat.provenance.split("\n") : []),
    ...(preversion ? plat.provenances_a_fournir.map((p) => `${p.charAt(0).toUpperCase()}${p.slice(1)} : provenance à compléter`) : []),
  ];

  return (
    <>
      <div className="fiche-fond" onClick={onFermer} aria-hidden="true" />
      <div className="fiche" role="dialog" aria-modal="true" aria-labelledby={`${ids}-nom`} ref={fenetre} tabIndex={-1}>
        <button type="button" className="fiche-fermer" onClick={onFermer} aria-label="Fermer">
          <Icone nom="fermer" />
        </button>
        {plat.photo ? (
          <div className="fiche-media">
            <Image src={`/plats/${plat.photo}`} alt={nomAffiche(plat)} fill sizes="(min-width: 900px) 460px, 100vw" />
          </div>
        ) : (
          <div className="fiche-media fiche-sans-photo" aria-hidden="true">
            <span>{nomAffiche(plat)}</span>
          </div>
        )}
        <div className="fiche-corps">
          <div className="fiche-tete">
            <h2 id={`${ids}-nom`}>{nomAffiche(plat)}</h2>
            <span className="fiche-prix">{prixCourt(plat.prix_centimes)}</span>
          </div>
          {plat.description && <p className="fiche-desc">{plat.description}</p>}
          <div className="fiche-infos">
            {provenances.length > 0 && (
              <div>
                <h3>Provenance</h3>
                <ul>
                  {provenances.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <h3>Allergènes</h3>
              <p>{plat.allergenes ?? <>Demandez-nous au <a href="tel:+41227921689">022 792 16 89</a></>}</p>
            </div>
          </div>

          {groupes.map((g) => {
            const choisis = choix[g.slug] ?? [];
            const unique = g.choix_max === 1;
            const visibles = unique || tous ? g.options : g.options.slice(0, SUPPLEMENTS_VISIBLES);
            return (
              <fieldset className="groupe" key={g.slug}>
                <legend>
                  {unique ? `Vos ${g.nom.toLowerCase()}` : "Ajouter"}{" "}
                  <span className="groupe-regle">
                    {g.choix_min > 0 ? "obligatoire" : `jusqu'à ${g.choix_max}, ${choisis.length} choisi${choisis.length > 1 ? "s" : ""}`}
                  </span>
                </legend>
                <div className="options-grille">
                  {visibles.map((o) => {
                    const coche = choisis.includes(o.nom);
                    const bloque = !unique && !coche && choisis.length >= g.choix_max;
                    return (
                      <label key={o.nom} className={`option${bloque ? " bloque" : ""}`}>
                        <input
                          type={unique ? "radio" : "checkbox"}
                          name={`${ids}-${g.slug}`}
                          checked={coche}
                          disabled={bloque}
                          onChange={() => basculer(g.slug, o.nom, g.choix_max)}
                        />
                        <span>{o.nom}</span>
                        {o.prix_centimes > 0 && <span className="opt-prix">+{prixCourt(o.prix_centimes)}</span>}
                      </label>
                    );
                  })}
                </div>
                {!unique && !tous && g.options.length > SUPPLEMENTS_VISIBLES && (
                  <button type="button" className="lien" onClick={() => setTous(true)}>
                    Voir les {g.options.length} suppléments
                  </button>
                )}
              </fieldset>
            );
          })}

          {info && info.retraits.length > 0 && (
            <fieldset className="groupe">
              <legend>
                Retirer <span className="groupe-regle">gratuit</span>
              </legend>
              <div className="options-grille">
                {info.retraits.map((r) => (
                  <label key={r.nom} className="option">
                    <input
                      type="checkbox"
                      checked={retraits.includes(r.nom)}
                      onChange={() => setRetraits(retraits.includes(r.nom) ? retraits.filter((x) => x !== r.nom) : [...retraits, r.nom])}
                    />
                    <span>Sans {r.nom.toLowerCase()}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="champ">
            <label htmlFor={`${ids}-note`}>
              Note pour la cuisine <span className="facultatif">facultatif</span>
            </label>
            <input id={`${ids}-note`} maxLength={LIMITES.note} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="fiche-pied">
          <div className="qte">
            <button type="button" onClick={() => setQte(Math.max(1, qte - 1))} aria-label="Un de moins">
              −
            </button>
            <span aria-live="polite">{qte}</span>
            <button type="button" onClick={() => setQte(Math.min(LIMITES.quantite, qte + 1))} aria-label="Un de plus">
              +
            </button>
          </div>
          <button
            type="button"
            className="bouton-principal"
            disabled={Boolean(manquant)}
            onClick={() => {
              onAjouter(ligne);
              onFermer();
            }}
          >
            {manquant ? `Choisissez vos ${manquant.nom.toLowerCase()}` : `Ajouter, ${prixChf(total)}`}
          </button>
        </div>
      </div>
    </>
  );
}
