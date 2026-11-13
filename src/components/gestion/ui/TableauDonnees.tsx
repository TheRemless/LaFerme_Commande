"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { documentCsv, nomFichierCsv, telechargerCsv } from "@/components/gestion/ui/csv";
import { Chargement, EtatErreur, EtatVide } from "@/components/gestion/ui/Etats";
import { nombre } from "@/components/gestion/ui/format";
import { useRaccourci } from "@/components/gestion/ui/Raccourcis";
import { jourGeneveDe } from "@/lib/heures";

// Tableau de données du back-office. Contrôlé : le tri, la page, la recherche et les filtres sont tenus par
// la rubrique, qui demande au serveur la page voulue (jamais toute la table : 300 commandes par jour).
// Le tableau, lui, tient la sélection affichée, les colonnes choisies et la densité (gardées dans le navigateur).

export type Colonne<T> = {
  cle: string;
  titre: string;
  /** Texte brut (CSV, rendu par défaut). */
  valeur?: (l: T) => string | number | null | undefined;
  /** Rendu à l'écran, si différent du texte brut. */
  rendu?: (l: T) => React.ReactNode;
  triable?: boolean;
  /** Chiffres et montants : alignés à droite, en chiffres de même largeur. */
  nombre?: boolean;
  /** Toujours visible (le nom, le numéro) : pas dans « Colonnes ». */
  fixe?: boolean;
  /** Cachée tant que le gérant ne la demande pas. */
  cacheeParDefaut?: boolean;
};

export type Tri = { cle: string; sens: "asc" | "desc" };

type Props<T> = {
  /** Nom du tableau pour les lecteurs d'écran et le fichier CSV (« Commandes »). */
  titre: string;
  colonnes: Colonne<T>[];
  /** null pendant le premier chargement. */
  lignes: T[] | null;
  cleLigne: (l: T) => string;
  /** Un rechargement est en cours (les lignes déjà là restent, grisées). */
  chargement?: boolean;
  erreur?: string | null;
  onReessayer?: () => void;
  /** Ce qu'on montre quand il n'y a aucune ligne. */
  vide?: { titre: string; texte?: React.ReactNode; action?: React.ReactNode };
  tri?: Tri;
  onTri?: (t: Tri) => void;
  pagination?: { page: number; parPage: number; total: number; onPage: (p: number) => void };
  recherche?: { valeur: string; onChange: (v: string) => void; libelle: string };
  /** Filtres propres à la rubrique (sélecteurs, période), affichés à côté de la recherche. */
  filtres?: React.ReactNode;
  /** Sélection et actions en lot. Les actions reçoivent les clés choisies. */
  actionsLot?: (cles: string[], vider: () => void) => React.ReactNode;
  /** Ouvrir la fiche d'une ligne (clic sur la ligne, ou Entrée sur son premier bouton). */
  onOuvrir?: (l: T) => void;
  /** Export CSV : par défaut les lignes affichées ; `toutes` va chercher toutes les lignes du filtre. */
  csv?: { toutes?: () => Promise<T[]> };
  /** Clé pour garder colonnes et densité dans ce navigateur (« commandes »). */
  memoire?: string;
};

type Preferences = { cachees: string[]; compact: boolean };

function lirePreferences(memoire: string | undefined, colonnes: Colonne<unknown>[]): Preferences {
  const defaut = { cachees: colonnes.filter((c) => c.cacheeParDefaut).map((c) => c.cle), compact: false };
  if (!memoire) return defaut;
  try {
    const p = JSON.parse(localStorage.getItem(`laferme.gestion.tableau.${memoire}`) ?? "null") as Preferences | null;
    return p && Array.isArray(p.cachees) ? { cachees: p.cachees, compact: !!p.compact } : defaut;
  } catch {
    return defaut;
  }
}

export function TableauDonnees<T>(p: Props<T>) {
  const { titre, colonnes, lignes, cleLigne } = p;
  const id = useId();
  const [prefs, setPrefs] = useState<Preferences>({ cachees: colonnes.filter((c) => c.cacheeParDefaut).map((c) => c.cle), compact: false });
  const [choisies, setChoisies] = useState<Set<string>>(new Set());
  const [exportEnCours, setExportEnCours] = useState(false);
  const champRecherche = useRef<HTMLInputElement>(null);

  // Les colonnes sont souvent recréées à chaque rendu : on ne relit les préférences que si leur liste change.
  const signature = colonnes.map((c) => `${c.cle}${c.cacheeParDefaut ? "*" : ""}`).join(",");
  const colonnesRef = useRef(colonnes);
  colonnesRef.current = colonnes;
  useEffect(() => setPrefs(lirePreferences(p.memoire, colonnesRef.current as Colonne<unknown>[])), [p.memoire, signature]);
  function garder(n: Preferences) {
    setPrefs(n);
    if (!p.memoire) return;
    try {
      localStorage.setItem(`laferme.gestion.tableau.${p.memoire}`, JSON.stringify(n));
    } catch {}
  }

  useRaccourci("/", () => champRecherche.current?.focus(), `Chercher dans ${titre.toLowerCase()}`, !!p.recherche);

  // La sélection ne garde que des lignes encore affichées (autre page, autre filtre : elle se vide).
  const clesAffichees = useMemo(() => new Set((lignes ?? []).map(cleLigne)), [lignes, cleLigne]);
  useEffect(() => {
    setChoisies((s) => {
      const garde = [...s].filter((k) => clesAffichees.has(k));
      return garde.length === s.size ? s : new Set(garde);
    });
  }, [clesAffichees]);

  const visibles = colonnes.filter((c) => c.fixe || !prefs.cachees.includes(c.cle));
  const selection = !!p.actionsLot;
  const toutesChoisies = clesAffichees.size > 0 && choisies.size === clesAffichees.size;

  async function exporter() {
    setExportEnCours(true);
    try {
      const source = p.csv?.toutes ? await p.csv.toutes() : (lignes ?? []);
      const texte = (c: Colonne<T>, l: T) => c.valeur?.(l) ?? "";
      telechargerCsv(nomFichierCsv(titre, jourGeneveDe(new Date())), documentCsv([visibles.map((c) => c.titre), ...source.map((l) => visibles.map((c) => texte(c, l)))]));
    } finally {
      setExportEnCours(false);
    }
  }

  const pg = p.pagination;
  const pages = pg ? Math.max(1, Math.ceil(pg.total / pg.parPage)) : 1;

  return (
    <div className="bo-tableau" data-compact={prefs.compact || undefined}>
      <div className="bo-tableau-outils">
        {p.recherche && (
          <div className="bo-recherche">
            <label htmlFor={`${id}-r`} className="sr-only">
              {p.recherche.libelle}
            </label>
            <input
              ref={champRecherche}
              id={`${id}-r`}
              type="search"
              placeholder={p.recherche.libelle}
              value={p.recherche.valeur}
              onChange={(e) => p.recherche!.onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && p.recherche!.valeur) {
                  e.preventDefault();
                  p.recherche!.onChange("");
                }
              }}
            />
          </div>
        )}
        {p.filtres}
        <div className="bo-tableau-reglages">
          <details className="bo-menu-deroulant">
            <summary className="bo-bouton bo-bouton-second bo-bouton-petit">Colonnes</summary>
            <fieldset>
              <legend className="sr-only">Colonnes affichées</legend>
              {colonnes
                .filter((c) => !c.fixe)
                .map((c) => (
                  <label key={c.cle} className="bo-case">
                    <input
                      type="checkbox"
                      checked={!prefs.cachees.includes(c.cle)}
                      onChange={(e) => garder({ ...prefs, cachees: e.target.checked ? prefs.cachees.filter((k) => k !== c.cle) : [...prefs.cachees, c.cle] })}
                    />
                    {c.titre}
                  </label>
                ))}
            </fieldset>
          </details>
          <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" aria-pressed={prefs.compact} onClick={() => garder({ ...prefs, compact: !prefs.compact })}>
            Compact
          </button>
          <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" disabled={exportEnCours || !lignes?.length} onClick={exporter}>
            {exportEnCours ? "Export…" : "Exporter en CSV"}
          </button>
        </div>
      </div>

      {selection && choisies.size > 0 && (
        <div className="bo-lot" role="region" aria-label="Actions sur la sélection">
          <p>
            {choisies.size} sélectionnée{choisies.size > 1 ? "s" : ""}
          </p>
          {p.actionsLot!([...choisies], () => setChoisies(new Set()))}
          <button type="button" className="bo-bouton bo-bouton-discret" onClick={() => setChoisies(new Set())}>
            Tout désélectionner
          </button>
        </div>
      )}

      {p.erreur ? (
        <EtatErreur texte={p.erreur} reessayer={p.onReessayer} />
      ) : lignes === null ? (
        <Chargement />
      ) : lignes.length === 0 ? (
        <EtatVide titre={p.vide?.titre ?? "Aucune ligne."} texte={p.vide?.texte} action={p.vide?.action} />
      ) : (
        <div className="bo-tableau-defile" aria-busy={p.chargement || undefined} tabIndex={0} role="region" aria-labelledby={`${id}-t`}>
          <table>
            <caption id={`${id}-t`} className="sr-only">
              {titre}
              {pg ? `, ${nombre(pg.total)} au total` : ""}
            </caption>
            <thead>
              <tr>
                {selection && (
                  <th scope="col" className="bo-col-case">
                    <input
                      type="checkbox"
                      aria-label="Tout sélectionner sur cette page"
                      checked={toutesChoisies}
                      ref={(el) => {
                        if (el) el.indeterminate = choisies.size > 0 && !toutesChoisies;
                      }}
                      onChange={() => setChoisies(toutesChoisies ? new Set() : new Set(clesAffichees))}
                    />
                  </th>
                )}
                {visibles.map((c) => {
                  const actif = p.tri?.cle === c.cle;
                  return (
                    <th
                      key={c.cle}
                      scope="col"
                      data-nombre={c.nombre || undefined}
                      aria-sort={actif ? (p.tri!.sens === "asc" ? "ascending" : "descending") : undefined}
                    >
                      {c.triable && p.onTri ? (
                        <button
                          type="button"
                          className="bo-tri"
                          onClick={() => p.onTri!({ cle: c.cle, sens: actif && p.tri!.sens === "asc" ? "desc" : "asc" })}
                        >
                          {c.titre}
                          <span className="bo-tri-sens" aria-hidden="true">
                            {actif ? (p.tri!.sens === "asc" ? "↑" : "↓") : "↕"}
                          </span>
                        </button>
                      ) : (
                        c.titre
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => {
                const cle = cleLigne(l);
                return (
                  <tr
                    key={cle}
                    data-choisie={choisies.has(cle) || undefined}
                    data-ouvrable={p.onOuvrir ? true : undefined}
                    onClick={(e) => {
                      // Un clic sur un bouton, un lien ou une case de la ligne fait son propre travail.
                      if (!p.onOuvrir || (e.target as HTMLElement).closest("button, a, input, label, select")) return;
                      p.onOuvrir(l);
                    }}
                  >
                    {selection && (
                      <td className="bo-col-case">
                        <input
                          type="checkbox"
                          aria-label={`Sélectionner ${String(colonnes[0]?.valeur?.(l) ?? cle)}`}
                          checked={choisies.has(cle)}
                          onChange={(e) => {
                            const n = new Set(choisies);
                            if (e.target.checked) n.add(cle);
                            else n.delete(cle);
                            setChoisies(n);
                          }}
                        />
                      </td>
                    )}
                    {visibles.map((c, i) => {
                      const contenu = c.rendu ? c.rendu(l) : (c.valeur?.(l) ?? "");
                      return (
                        <td key={c.cle} data-nombre={c.nombre || undefined}>
                          {i === 0 && p.onOuvrir ? (
                            <button type="button" className="bo-ouvrir" onClick={() => p.onOuvrir!(l)}>
                              {contenu}
                            </button>
                          ) : (
                            contenu
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pg && lignes && lignes.length > 0 && (
        <nav className="bo-pagination" aria-label={`Pages de ${titre.toLowerCase()}`}>
          <p>
            {nombre((pg.page - 1) * pg.parPage + 1)} à {nombre(Math.min(pg.page * pg.parPage, pg.total))} sur {nombre(pg.total)}
          </p>
          <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" disabled={pg.page <= 1} onClick={() => pg.onPage(pg.page - 1)}>
            Précédente
          </button>
          <span>
            Page {pg.page} sur {pages}
          </span>
          <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" disabled={pg.page >= pages} onClick={() => pg.onPage(pg.page + 1)}>
            Suivante
          </button>
        </nav>
      )}
    </div>
  );
}
