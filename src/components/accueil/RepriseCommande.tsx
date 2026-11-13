"use client";

import { useState } from "react";
import type { Recommande } from "@/lib/comptes/recommander";
import { nomClient } from "@/lib/nom-plat";
import { annoncerPlatsRemis, panierVide, remplacerPanier } from "@/lib/panier-local";
import { poster } from "@/lib/requete-client";
import type { Mode } from "@/lib/service";

// Vague 3, client-commande : un client connecté retrouve sa dernière commande dès l'accueil.
// « Reprendre cette commande » remet ses plats dans le panier (contrôlés contre la carte du jour par
// /api/compte/recommander), garde le mode de la commande, puis le client choisit l'heure et va au panier.

export type DerniereCommande = { id: string; cree_le: string; mode: Mode; lignes: { nom: string; qte: number }[] };

function jourTexte(iso: string): string {
  return new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
}

export function RepriseCommande({ derniere, onReprise }: { derniere: DerniereCommande; onReprise: (mode: Mode) => void }) {
  const [etat, setEtat] = useState<"repos" | "confirmer" | "envoi" | { remis: number; retires: string[] } | { erreur: string }>("repos");
  const resume = derniere.lignes.map((l) => `${l.qte} × ${nomClient(l.nom, /^Pizza /.test(l.nom))}`).join(", ");

  async function reprendre(remplacer = false) {
    // Un panier en cours n'est jamais écrasé sans accord.
    if (!remplacer && !panierVide()) return setEtat("confirmer");
    setEtat("envoi");
    const r = await poster("/api/compte/recommander", { commande: derniere.id });
    if (!r.ok) return setEtat({ erreur: String(r.donnees.erreur ?? "Impossible pour le moment. Réessayez.") });
    const rec = r.donnees as unknown as Recommande;
    if (rec.lignes.length === 0) return setEtat({ erreur: "Aucun de ces plats n'est disponible aujourd'hui." });
    remplacerPanier(rec.lignes);
    annoncerPlatsRemis(rec.lignes);
    setEtat({ remis: rec.lignes.reduce((n, l) => n + l.qte, 0), retires: rec.retirees.map((x) => x.nom) });
    onReprise(derniere.mode);
  }

  return (
    <div className="verdict verdict-info reprise" role="status">
      <p className="verdict-titre">Votre dernière commande, {jourTexte(derniere.cree_le)}</p>
      <p>{resume}</p>
      {etat === "repos" || etat === "envoi" ? (
        <button type="button" className="bouton-second" onClick={() => reprendre()} disabled={etat === "envoi"}>
          {etat === "envoi" ? "Un instant…" : "Reprendre cette commande"}
        </button>
      ) : etat === "confirmer" ? (
        <>
          <p>Votre panier contient déjà des plats. Les remplacer par cette commande&nbsp;?</p>
          <div className="boutons-ligne">
            <button type="button" className="bouton-second" onClick={() => reprendre(true)}>
              Remplacer mon panier
            </button>
            <button type="button" className="lien" onClick={() => setEtat("repos")}>
              Garder mon panier
            </button>
          </div>
        </>
      ) : "erreur" in etat ? (
        <p>{etat.erreur}</p>
      ) : (
        <>
          <p>
            <strong>{etat.remis === 1 ? "1 plat remis" : `${etat.remis} plats remis`} dans votre panier.</strong> Choisissez l&apos;heure,
            puis passez au panier.
          </p>
          {etat.retires.length > 0 && <p>Indisponibles aujourd&apos;hui, non repris : {etat.retires.join(", ")}.</p>}
        </>
      )}
    </div>
  );
}
