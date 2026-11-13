"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { DonneesCarte } from "@/components/gestion/GestionCarte";
import { jourCourtFr } from "@/components/gestion/carte/dates";
import { STATUT } from "@/components/gestion/commandes/libelles";
import { enregistrer } from "@/components/gestion/enregistrer";
import { demanderOuverture, useNotifier } from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";

// Four en panne (contrôle du 13.11.2026) : tout le poste pizza, tout le poste cuisine ou toute une catégorie
// épuisés jusqu'à une date d'un geste, remis en vente d'un geste. Les ruptures plat par plat restent quand
// on lève la rupture groupée. Après chaque « Épuiser », les commandes déjà passées qui contiennent ces
// plats et ne sont pas encore prêtes, avec un lien vers chacune.

export function nomCible(cible: string, donnees: DonneesCarte): string {
  if (cible === "poste:pizza") return "Tout le poste pizza";
  if (cible === "poste:cuisine") return "Tout le poste cuisine";
  const slug = cible.replace(/^categorie:/, "");
  return `Toute la catégorie ${donnees.categories.find((c) => c.slug === slug)?.nom ?? slug}`;
}

// « Tout le poste pizza épuisé », « Toute la catégorie Desserts épuisée ».
const epuise = (cible: string) => (cible.startsWith("categorie:") ? "épuisée" : "épuisé");

// Ruptures groupées en cours, en tête de la carte : chacune se lève d'un geste.
export function RupturesGroupees({ donnees, recharger }: { donnees: DonneesCarte; recharger: () => Promise<void> }) {
  const notifier = useNotifier();
  const [envoi, setEnvoi] = useState<string | null>(null);
  const actives = donnees.ruptures_groupees ?? [];
  if (!actives.length) return null;
  async function lever(cible: string) {
    setEnvoi(cible);
    const erreur = await enregistrer("/api/gestion/carte", { type: "rupture_groupee", cible, jusqu_au: null });
    setEnvoi(null);
    notifier(erreur ? { texte: erreur, ton: "erreur" } : { texte: `${nomCible(cible, donnees)} de nouveau en vente.`, ton: "succes" });
    if (!erreur) await recharger();
  }
  return (
    <ul className="bo-ruptures-groupees" aria-label="Postes et catégories épuisés">
      {actives.map((r) => (
        <li key={r.cible}>
          <p>
            <strong>{nomCible(r.cible, donnees)}</strong> {epuise(r.cible)} jusqu&apos;au {jourCourtFr(r.jusqu_au)} compris.
          </p>
          <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" disabled={envoi !== null} onClick={() => lever(r.cible)}>
            {envoi === r.cible ? "Enregistrement…" : "Remettre en vente"}
          </button>
        </li>
      ))}
    </ul>
  );
}

// Formulaire du panneau « Four en panne » : un poste ou une catégorie, une date, puis les commandes touchées.
export function EpuiserPoste({ donnees, recharger }: { donnees: DonneesCarte; recharger: () => Promise<void> }) {
  const notifier = useNotifier();
  const aujourdhui = donnees.aujourdhui.slice(0, 10);
  const [quoi, setQuoi] = useState<"poste:pizza" | "poste:cuisine" | "categorie">("poste:pizza");
  const [categorie, setCategorie] = useState(donnees.categories[0]?.slug ?? "");
  const [date, setDate] = useState(aujourdhui);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<{ cible: string; jusqu_au: string } | null>(null);
  const cible = quoi === "categorie" ? `categorie:${categorie}` : quoi;

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const r = await enregistrer("/api/gestion/carte", { type: "rupture_groupee", cible, jusqu_au: date });
    setEnvoi(false);
    if (r) return setErreur(r);
    notifier({ texte: `${nomCible(cible, donnees)} ${epuise(cible)} jusqu'au ${jourCourtFr(date)}, de retour le lendemain.`, ton: "succes" });
    setFait({ cible, jusqu_au: date });
    await recharger();
  }

  if (fait) {
    return (
      <div className="bo-formulaire">
        <p>
          {nomCible(fait.cible, donnees)} est {epuise(fait.cible)} jusqu&apos;au {jourCourtFr(fait.jusqu_au)} compris. Le client ne peut plus en commander, la
          tablette le montre.
        </p>
        <CommandesTouchees requete={{ cible: fait.cible, jusqu_au: fait.jusqu_au }} aujourdhui={aujourdhui} />
      </div>
    );
  }

  return (
    <form onSubmit={envoyer} className="bo-formulaire">
      <fieldset className="bo-choix bo-choix-colonne">
        <legend>Quoi</legend>
        <label className="bo-case">
          <input type="radio" name="four-quoi" checked={quoi === "poste:pizza"} onChange={() => setQuoi("poste:pizza")} />
          <span>Tout le poste pizza (four en panne)</span>
        </label>
        <label className="bo-case">
          <input type="radio" name="four-quoi" checked={quoi === "poste:cuisine"} onChange={() => setQuoi("poste:cuisine")} />
          <span>Tout le poste cuisine</span>
        </label>
        <label className="bo-case">
          <input type="radio" name="four-quoi" checked={quoi === "categorie"} onChange={() => setQuoi("categorie")} />
          <span>Une catégorie</span>
        </label>
      </fieldset>
      {quoi === "categorie" && (
        <div className="bo-champ">
          <label htmlFor="four-categorie">Catégorie</label>
          <select id="four-categorie" value={categorie} onChange={(e) => setCategorie(e.target.value)}>
            {donnees.categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.nom}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="bo-champ">
        <label htmlFor="four-date">Épuisé jusqu&apos;au (compris)</label>
        <input id="four-date" type="date" required value={date} min={aujourdhui} onChange={(e) => setDate(e.target.value)} />
        <p className="bo-champ-aide">Tout revient seul le lendemain. Les plats déjà épuisés un par un le restent.</p>
      </div>
      {erreur && (
        <p className="bo-erreur" role="alert">
          {erreur}
        </p>
      )}
      <button type="submit" className="bo-bouton bo-bouton-principal" disabled={envoi}>
        {envoi ? "Enregistrement…" : "Épuiser"}
      </button>
    </form>
  );
}

type CommandeTouchee = { id: string; numero: number; jour: string; statut: string; mode: string; heure: number | null; lignes: { nom: string; qte: number }[] };

const heureTexte = (m: number | null) => (m === null ? "dès que possible" : `à ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

// Commandes pas encore prêtes qui contiennent les plats épuisés : à appeler avant que la cuisine ne
// découvre le manque. Le lien ouvre la fiche dans la rubrique Commandes (sans rien mettre dans l'adresse).
export function CommandesTouchees({ requete, aujourdhui }: { requete: { slugs?: string[]; cible?: string; jusqu_au: string | null }; aujourdhui: string }) {
  const titre = useId();
  const [commandes, setCommandes] = useState<CommandeTouchee[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const cle = JSON.stringify(requete);
  useEffect(() => {
    let actif = true;
    poster("/api/gestion/carte", { type: "commandes_touchees", ...JSON.parse(cle) }).then((r) => {
      if (!actif) return;
      if (r.ok) setCommandes(r.donnees.commandes as CommandeTouchee[]);
      else setErreur(String(r.donnees.erreur ?? "Commandes en cours illisibles. Regardez la tablette."));
    });
    return () => {
      actif = false;
    };
  }, [cle]);

  return (
    <section className="bo-touchees" aria-labelledby={titre} aria-live="polite">
      <h3 id={titre}>Commandes en cours qui les contiennent</h3>
      {erreur ? (
        <p className="bo-erreur">{erreur}</p>
      ) : commandes === null ? (
        <p className="bo-champ-aide">Recherche des commandes en cours…</p>
      ) : commandes.length === 0 ? (
        <p>Aucune commande à accepter, acceptée ou en préparation ne les contient.</p>
      ) : (
        <>
          <p>
            {commandes.length} commande{commandes.length > 1 ? "s" : ""} à prévenir. Appelez le client depuis la fiche avant que la cuisine ne
            découvre le manque.
          </p>
          <ul>
            {commandes.map((c) => (
              <li key={c.id}>
                <Link href="/gestion/commandes" className="bo-touchee-lien" onClick={() => demanderOuverture({ type: "commande", cle: c.id })}>
                  Commande n° {c.numero}
                </Link>
                <span>
                  {STATUT[c.statut] ?? c.statut}, {c.mode === "livraison" ? "livraison" : "à emporter"}
                  {c.jour.slice(0, 10) !== aujourdhui.slice(0, 10) ? ` le ${jourCourtFr(c.jour)}` : ""} {heureTexte(c.heure)}
                </span>
                <span className="bo-champ-aide">{c.lignes.map((l) => `${l.qte} × ${l.nom}`).join(", ")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
