"use client";

import { useMemo, useRef, useState } from "react";
import "./carte.css";
import { FichePlat, NouveauPlat, type DonneesCarte, type PlatGestion } from "@/components/gestion/GestionCarte";
import { PrixEnLot } from "@/components/gestion/carte/PrixEnLot";
import { DispoRupture, CopierPlat, Etiquettes, ETIQUETTES } from "@/components/gestion/carte/FicheVague3";
import { enregistrer } from "@/components/gestion/enregistrer";
import { PanneauLateral, TableauDonnees, montant, useConfirmer, useNotifier, useOuverture, type Colonne, type Tri } from "@/components/gestion/ui";

// La carte en liste dense (vague 3) : 80 plats et plus d'un coup d'œil, ce qui manque à chacun, le prix
// modifiable sur place, les gestes en lot (prix, validation, épuisé jusqu'à une date, remise en vente).
// La carte entière est déjà chargée par la coque (contexte-carte.tsx) : filtre et tri se font ici, sur
// une centaine de lignes au plus.

export type LignePlatListe = PlatGestion & { categorie_slug: string; categorie_nom: string; ordre_categorie: number; ordre: number };

export type FiltreEtat = "tous" | "vente" | "hors" | "epuise" | "bloquants" | "a_valider" | "sans_photo" | "sans_allergenes" | "archives";

const FILTRES: { cle: FiltreEtat; titre: string; garde: (p: LignePlatListe) => boolean }[] = [
  { cle: "tous", titre: "Tous", garde: (p) => !p.archive },
  { cle: "vente", titre: "En vente", garde: (p) => !p.archive && p.commandable && !p.rupture_jusqu_au },
  { cle: "hors", titre: "Hors vente", garde: (p) => !p.archive && !p.commandable },
  { cle: "epuise", titre: "Épuisés", garde: (p) => !p.archive && !!p.rupture_jusqu_au },
  // Plats en vente qui bloquent la mise en ligne (vue plats_bloquants) : à régler avant l'ouverture.
  { cle: "bloquants", titre: "Bloquent la mise en ligne", garde: (p) => !p.archive && p.bloquants.length > 0 },
  { cle: "a_valider", titre: "Prix à valider", garde: (p) => !p.archive && p.prix_a_valider },
  { cle: "sans_photo", titre: "Sans photo", garde: (p) => !p.archive && !p.photo },
  { cle: "sans_allergenes", titre: "Sans allergènes", garde: (p) => !p.archive && !p.allergenes },
  { cle: "archives", titre: "Archivés", garde: (p) => p.archive },
];

const JOURS_COURTS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const JOUR = new Intl.DateTimeFormat("fr-CH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const jourCourtFr = (iso: string) => JOUR.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));

export function etatPlat(p: PlatGestion): string {
  if (p.archive) return "Archivé";
  if (p.rupture_jusqu_au) return `Épuisé jusqu'au ${jourCourtFr(p.rupture_jusqu_au)}`;
  return p.commandable ? "En vente" : "Hors vente";
}

export function dispoTexte(p: PlatGestion): string {
  const d = p.dispo;
  if (!d || (!d.service && !d.mode && !d.jours)) return "Toujours";
  const bouts: string[] = [];
  if (d.service) bouts.push(d.service === "midi" ? "Midi" : "Soir");
  if (d.mode) bouts.push(d.mode === "livraison" ? "Livraison" : "À emporter");
  if (d.jours) bouts.push(d.jours.map((j) => JOURS_COURTS[j - 1]).join(" "));
  return bouts.join(", ");
}

// Ce qui reste à compléter, en un mot par sujet (le détail est dans la fiche).
const COURTS: [string, string][] = [
  ["prix à valider", "prix"],
  ["allergènes", "allergènes"],
  ["provenance", "provenance"],
  ["supplément à valider", "suppléments"],
  ["retraits", "retraits"],
];
export function manquesCourts(p: PlatGestion): string {
  const mots = COURTS.filter(([debut]) => p.manques.some((m) => m.startsWith(debut))).map(([, mot]) => mot);
  if (!p.photo) mots.push("photo");
  return mots.join(", ");
}

export function lignesCarte(donnees: DonneesCarte): LignePlatListe[] {
  return donnees.categories.flatMap((c, ci) =>
    c.plats.map((p, i) => ({ ...p, categorie_slug: c.slug, categorie_nom: c.nom, ordre_categorie: ci, ordre: i })),
  );
}

function comparer(tri: Tri) {
  const s = tri.sens === "asc" ? 1 : -1;
  return (a: LignePlatListe, b: LignePlatListe) => {
    switch (tri.cle) {
      case "prix":
        return (a.prix_centimes - b.prix_centimes) * s;
      case "nom":
        return a.nom.localeCompare(b.nom, "fr") * s;
      case "etat":
        return etatPlat(a).localeCompare(etatPlat(b), "fr") * s;
      default:
        return (a.ordre_categorie - b.ordre_categorie || a.ordre - b.ordre) * s;
    }
  };
}

// Prix modifiable sur place : Entrée ou sortie du champ enregistre, Échap rend l'ancien. Un prix changé ici
// repart à valider, comme dans la fiche sans la case « Prix validé ».
function PrixEnLigne({ plat, recharger }: { plat: LignePlatListe; recharger: () => Promise<void> }) {
  const notifier = useNotifier();
  const actuel = (plat.prix_centimes / 100).toFixed(2);
  const [v, setV] = useState(actuel);
  const [envoi, setEnvoi] = useState(false);
  async function sauver() {
    const propre = v.replace(",", ".").trim();
    // Même montant écrit autrement (« 18 » pour 18.00) : rien à enregistrer.
    if (envoi || Math.round(Number(propre) * 100) === plat.prix_centimes) return setV(actuel);
    setEnvoi(true);
    const erreur = await enregistrer("/api/gestion/carte", { type: "plat", slug: plat.slug, champs: { prix: propre } });
    setEnvoi(false);
    if (erreur) {
      setV(actuel);
      notifier({ texte: `${plat.nom} : ${erreur}`, ton: "erreur" });
      return;
    }
    notifier({ texte: `${plat.nom} : CHF ${propre}, prix à valider.`, ton: "succes" });
    await recharger();
  }
  if (plat.archive || plat.origine === "jour") return <span>{montant(plat.prix_centimes)}</span>;
  return (
    <input
      className="bo-prix-ligne"
      aria-label={`Prix de ${plat.nom} (CHF)`}
      inputMode="decimal"
      value={v}
      disabled={envoi}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={sauver}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setV(actuel);
      }}
    />
  );
}

export function ListeCarte({ donnees, recharger, version }: { donnees: DonneesCarte; recharger: () => Promise<void>; version: number }) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const [recherche, setRecherche] = useState("");
  const [categorie, setCategorie] = useState("");
  const [etat, setEtat] = useState<FiltreEtat>("tous");
  const [tri, setTri] = useState<Tri>({ cle: "carte", sens: "asc" });
  const [page, setPage] = useState(1);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [lot, setLot] = useState<string[] | null>(null);
  const [epuiser, setEpuiser] = useState<string[] | null>(null);
  const [nouveau, setNouveau] = useState(false);
  // Après des prix changés en lot, la sélection se vide : un second appui ne rejoue pas la hausse.
  const viderLot = useRef<(() => void) | null>(null);

  // Recherche globale (⌘K) : un plat choisi s'ouvre dans le panneau en arrivant sur la carte.
  useOuverture("plat", (slug) => setOuvert(slug));

  const toutes = useMemo(() => lignesCarte(donnees), [donnees]);
  const comptes = useMemo(() => Object.fromEntries(FILTRES.map((f) => [f.cle, toutes.filter(f.garde).length])) as Record<FiltreEtat, number>, [toutes]);
  const filtrees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const garde = FILTRES.find((f) => f.cle === etat)!.garde;
    return toutes
      .filter((p) => garde(p) && (!categorie || p.categorie_slug === categorie) && (!q || p.nom.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)))
      .sort(comparer(tri));
  }, [toutes, recherche, categorie, etat, tri]);
  const PAR_PAGE = 50;
  const pageLignes = filtrees.slice((page - 1) * PAR_PAGE, page * PAR_PAGE);
  const plat = ouvert ? toutes.find((p) => p.slug === ouvert) ?? null : null;
  const nomDe = (s: string) => toutes.find((p) => p.slug === s)?.nom ?? s;

  const colonnes: Colonne<LignePlatListe>[] = [
    { cle: "nom", titre: "Plat", valeur: (p) => p.nom, triable: true, fixe: true },
    { cle: "carte", titre: "Catégorie", valeur: (p) => p.categorie_nom, triable: true },
    { cle: "prix", titre: "Prix CHF", valeur: (p) => montant(p.prix_centimes), rendu: (p) => <PrixEnLigne key={`${p.slug}-${p.prix_centimes}-${version}`} plat={p} recharger={recharger} />, triable: true, nombre: true },
    { cle: "etat", titre: "État", valeur: etatPlat, triable: true },
    { cle: "manques", titre: "À compléter", valeur: (p) => manquesCourts(p) || "Rien" },
    { cle: "dispo", titre: "Disponible", valeur: dispoTexte },
    {
      cle: "etiquettes",
      titre: "Étiquettes",
      valeur: (p) => (p.etiquettes ?? []).map((e) => ETIQUETTES.find(([v]) => v === e)?.[1] ?? e).join(", "),
      cacheeParDefaut: true,
    },
    { cle: "poste", titre: "Poste", valeur: (p) => (p.station === "pizza" ? "Pizza" : "Cuisine"), cacheeParDefaut: true },
  ];

  async function valider(cles: string[], vider: () => void) {
    const aValider = cles.filter((s) => toutes.find((p) => p.slug === s)?.prix_a_valider);
    if (!aValider.length) return notifier({ texte: "Aucun de ces prix n'est à valider.", ton: "info" });
    const ok = await confirmer({ titre: `Valider ${aValider.length} prix ?`, texte: "Le prix affiché devient le prix validé, comme la case « Prix validé » de la fiche.", oui: `Valider ${aValider.length} prix` });
    if (!ok) return;
    const erreurs: string[] = [];
    for (const s of aValider) {
      const e = await enregistrer("/api/gestion/carte", { type: "plat", slug: s, champs: { prix_valide: true } });
      if (e) erreurs.push(`${nomDe(s)} : ${e}`);
    }
    vider();
    await recharger();
    notifier(erreurs.length ? { texte: erreurs.join(" "), ton: "erreur" } : { texte: `${aValider.length} prix validés.`, ton: "succes" });
  }

  async function remettre(cles: string[], vider: () => void) {
    const epuises = cles.filter((s) => toutes.find((p) => p.slug === s)?.rupture_jusqu_au);
    if (!epuises.length) return notifier({ texte: "Aucun de ces plats n'est épuisé.", ton: "info" });
    const erreurs: string[] = [];
    for (const s of epuises) {
      const e = await enregistrer("/api/gestion/carte", { type: "rupture", slug: s, jusqu_au: null });
      if (e) erreurs.push(`${nomDe(s)} : ${e}`);
    }
    vider();
    await recharger();
    notifier(erreurs.length ? { texte: erreurs.join(" "), ton: "erreur" } : { texte: `${epuises.length} plat${epuises.length > 1 ? "s" : ""} de nouveau en vente.`, ton: "succes" });
  }

  // Un même geste sur plusieurs plats (carte d'été préparée hors de la vente, puis mise en vente d'un coup).
  async function enLot(cles: string[], vider: () => void, corps: (slug: string) => Record<string, unknown>, fait: (n: number) => string) {
    const erreurs: string[] = [];
    for (const s of cles) {
      const e = await enregistrer("/api/gestion/carte", corps(s));
      if (e) erreurs.push(`${nomDe(s)} : ${e}`);
    }
    vider();
    await recharger();
    const n = cles.length - erreurs.length;
    if (n) notifier({ texte: fait(n), ton: "succes" });
    if (erreurs.length) notifier({ texte: erreurs.join(" "), ton: "erreur" });
  }
  const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

  async function archiver(cles: string[], vider: () => void) {
    const ok = await confirmer({
      titre: `Archiver ${pluriel(cles.length, "plat")} ?`,
      texte: "Ils quittent la carte, la tablette et la liste. Les commandes passées ne changent pas ; « Archivés » permet de les remettre.",
      oui: `Archiver ${pluriel(cles.length, "plat")}`,
      danger: true,
    });
    if (ok) await enLot(cles, vider, (slug) => ({ type: "archiver", slug, archiver: true }), (n) => `${pluriel(n, "plat")} archivé${n > 1 ? "s" : ""}.`);
  }

  return (
    <div className="bo-carte">
      <div className="bo-carte-tete">
        <div className="bo-carte-filtres" role="group" aria-label="Montrer">
          {FILTRES.map((f) => (
            <button
              key={f.cle}
              type="button"
              className="bo-puce"
              aria-pressed={etat === f.cle}
              onClick={() => {
                setEtat(f.cle);
                setPage(1);
              }}
            >
              {f.titre} <span className="bo-compte">{comptes[f.cle]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="bo-bouton bo-bouton-principal" onClick={() => setNouveau(true)}>
          Ajouter un plat
        </button>
      </div>
      {donnees.bloquants > 0 && (
        <p className="bo-champ-aide">
          {donnees.bloquants} plat{donnees.bloquants > 1 ? "s" : ""} en vente bloque{donnees.bloquants > 1 ? "nt" : ""} la mise en ligne (prix, allergènes, provenance ou supplément à valider).
        </p>
      )}
      <TableauDonnees<LignePlatListe>
        titre="Plats"
        colonnes={colonnes}
        lignes={pageLignes}
        cleLigne={(p) => p.slug}
        tri={tri}
        onTri={(t) => {
          setTri(t);
          setPage(1);
        }}
        pagination={{ page, parPage: PAR_PAGE, total: filtrees.length, onPage: setPage }}
        recherche={{
          valeur: recherche,
          onChange: (v) => {
            setRecherche(v);
            setPage(1);
          },
          libelle: "Nom ou description",
        }}
        filtres={
          <label className="bo-champ bo-carte-filtre-categorie">
            <span>Catégorie</span>
            <select
              value={categorie}
              onChange={(e) => {
                setCategorie(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Toutes</option>
              {donnees.categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.nom}
                </option>
              ))}
            </select>
          </label>
        }
        actionsLot={(cles, vider) => (
          <>
            <button
              type="button"
              className="bo-bouton bo-bouton-second bo-bouton-petit"
              onClick={() => {
                viderLot.current = vider;
                setLot(cles);
              }}
            >
              Changer les prix
            </button>
            <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" onClick={() => valider(cles, vider)}>
              Valider les prix
            </button>
            <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" onClick={() => setEpuiser(cles)}>
              Épuiser jusqu&apos;au…
            </button>
            <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" onClick={() => remettre(cles, vider)}>
              Fin de l&apos;épuisement
            </button>
            <button
              type="button"
              className="bo-bouton bo-bouton-second bo-bouton-petit"
              onClick={() => enLot(cles, vider, (slug) => ({ type: "plat", slug, champs: { commandable: true } }), (n) => `${pluriel(n, "plat")} en vente.`)}
            >
              Mettre en vente
            </button>
            <button
              type="button"
              className="bo-bouton bo-bouton-second bo-bouton-petit"
              onClick={() => enLot(cles, vider, (slug) => ({ type: "plat", slug, champs: { commandable: false } }), (n) => `${pluriel(n, "plat")} retiré${n > 1 ? "s" : ""} de la vente.`)}
            >
              Retirer de la vente
            </button>
            <button type="button" className="bo-bouton bo-bouton-discret bo-bouton-petit" onClick={() => archiver(cles, vider)}>
              Archiver
            </button>
          </>
        )}
        onOuvrir={(p) => setOuvert(p.slug)}
        csv={{ toutes: async () => filtrees }}
        memoire="carte"
        vide={{
          titre: etat === "tous" && !recherche && !categorie ? "Aucun plat." : "Aucun plat ne correspond.",
          texte: etat === "tous" && !recherche && !categorie ? "Ajoutez le premier plat de la carte." : "Choisissez « Tous » ou effacez la recherche.",
        }}
      />
      {plat && (
        <PanneauLateral titre={plat.nom} sousTitre={`${plat.categorie_nom}, ${etatPlat(plat).toLowerCase()}`} onFermer={() => setOuvert(null)} large>
          <FichePlat key={`${plat.slug}-${version}`} plat={plat} donnees={donnees} recharger={recharger} />
          {!plat.archive && <DispoRupture key={`d-${plat.slug}-${version}`} plat={plat} aujourdhui={donnees.aujourdhui} recharger={recharger} />}
          {!plat.archive && <Etiquettes key={`e-${plat.slug}-${version}-${(plat.etiquettes ?? []).join()}`} plat={plat} recharger={recharger} />}
          {plat.origine !== "jour" && (
            <CopierPlat
              plat={plat}
              copie={async (slug) => {
                await recharger();
                setOuvert(slug);
              }}
            />
          )}
        </PanneauLateral>
      )}
      {nouveau && (
        <PanneauLateral titre="Nouveau plat" onFermer={() => setNouveau(false)} large>
          <NouveauPlat
            donnees={donnees}
            fermer={() => setNouveau(false)}
            cree={async (slug) => {
              setNouveau(false);
              await recharger();
              setOuvert(slug);
            }}
          />
        </PanneauLateral>
      )}
      {lot && (
        <PanneauLateral titre="Changer les prix" sousTitre={`${lot.length} plat${lot.length > 1 ? "s" : ""} choisi${lot.length > 1 ? "s" : ""}`} onFermer={() => setLot(null)} large>
          <PrixEnLot
            slugs={lot}
            fini={async (n) => {
              viderLot.current?.();
              setLot(null);
              await recharger();
              notifier({ texte: `${n} prix changé${n > 1 ? "s" : ""}. Chacun s'annule dans le journal.`, ton: "succes" });
            }}
          />
        </PanneauLateral>
      )}
      {epuiser && (
        <PanneauLateral titre="Épuiser jusqu'au…" sousTitre={`${epuiser.length} plat${epuiser.length > 1 ? "s" : ""}`} onFermer={() => setEpuiser(null)}>
          <EpuiserLot
            slugs={epuiser}
            nomDe={nomDe}
            aujourdhui={donnees.aujourdhui}
            fini={async (texte, ton) => {
              setEpuiser(null);
              await recharger();
              notifier({ texte, ton });
            }}
          />
        </PanneauLateral>
      )}
    </div>
  );
}

function EpuiserLot({ slugs, nomDe, aujourdhui, fini }: { slugs: string[]; nomDe: (s: string) => string; aujourdhui: string; fini: (texte: string, ton: "succes" | "erreur") => Promise<void> }) {
  const [date, setDate] = useState(aujourdhui.slice(0, 10));
  const [envoi, setEnvoi] = useState(false);
  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    const erreurs: string[] = [];
    for (const s of slugs) {
      const r = await enregistrer("/api/gestion/carte", { type: "rupture", slug: s, jusqu_au: date });
      if (r) erreurs.push(`${nomDe(s)} : ${r}`);
    }
    setEnvoi(false);
    await fini(erreurs.length ? erreurs.join(" ") : `${slugs.length} plat${slugs.length > 1 ? "s" : ""} épuisé${slugs.length > 1 ? "s" : ""} jusqu'au ${jourCourtFr(date)}, de retour le lendemain.`, erreurs.length ? "erreur" : "succes");
  }
  return (
    <form onSubmit={envoyer} className="bo-formulaire">
      <p className="bo-champ-aide">{slugs.map(nomDe).join(", ")}</p>
      <div className="bo-champ">
        <label htmlFor="epuiser-date">Épuisé jusqu&apos;au (compris)</label>
        <input id="epuiser-date" type="date" required value={date} min={aujourdhui.slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
        <p className="bo-champ-aide">Le plat revient seul le lendemain. Aujourd&apos;hui : comme « Épuisé » sur la tablette.</p>
      </div>
      <button type="submit" className="bo-bouton bo-bouton-principal" disabled={envoi}>
        {envoi ? "Enregistrement…" : "Épuiser"}
      </button>
    </form>
  );
}
