"use client";

import { useState } from "react";
import type { CommandeTablette } from "@/lib/tablette";
import { heureDe as heure, jourCourtDe as jourCourt, jourGeneveDe as jourGeneve } from "@/lib/heures";
import { prixChf } from "@/lib/prix";
import { gestesPrincipaux, jourDuNumero, resumePlats, type EtatTemps, type Geste } from "@/components/tablette/rush";

// Une commande sur une ligne du tableau (vague 3) : de quoi décider à un mètre, et le geste suivant sous le doigt.
// Le reste (heure, manque, annulation, tickets) s'ouvre au toucher, sur le côté.
export function LigneCommande({
  c,
  etat,
  aujourdHui,
  livreur,
  ouverte,
  ouvrir,
  agir,
}: {
  c: CommandeTablette;
  etat: EtatTemps;
  aujourdHui: string;
  livreur?: string;
  ouverte: boolean;
  ouvrir: () => void;
  agir: (corps: Record<string, unknown>) => Promise<void>;
}) {
  const [envoi, setEnvoi] = useState(false);
  const gestes = gestesPrincipaux(c);
  const promise = c.heure_confirmee ?? c.heure_proposee;
  const autreJour = jourGeneve(promise) !== aujourdHui;
  const recueLe = jourDuNumero(c.cree_le, aujourdHui);
  const deduit = c.deduit_centimes ?? 0;
  const client = `${c.client_prenom} ${c.client_nom.charAt(0)}.`;

  async function faire(g: Geste) {
    setEnvoi(true);
    await agir(g.corps);
    setEnvoi(false);
  }

  return (
    <li className={`tab-ligne tab-niveau-${etat.niveau}${ouverte ? " tab-ligne-ouverte" : ""}${recueLe ? " tab-autre-jour" : ""}`}>
      <button type="button" className="tab-ligne-corps" aria-expanded={ouverte} onClick={ouvrir}>
        <span className="tab-ligne-num">
          {c.numero}
          {recueLe && <small className="tab-num-jour">{recueLe}</small>}
        </span>
        <span className="tab-ligne-temps">
          <span className="tab-ligne-heure">
            {autreJour && <small>{jourCourt(promise)} </small>}
            {heure(promise)}
          </span>
          {etat.texte && <span className="tab-ligne-etat">{etat.texte}</span>}
        </span>
        <span className="tab-ligne-infos">
          <span className="tab-ligne-qui">
            <strong>{c.mode === "livraison" ? "Livraison" : "À emporter"}</strong>, {client}
            {c.mode === "livraison" && ["acceptee", "en_preparation", "partie"].includes(c.statut) && <>, {livreur ?? "sans livreur"}</>}
            {/* Sur la même ligne que le client : deux lignes par commande au plus (tableau compact). */}
            {c.statut_paiement === "a_encaisser_retrait" && <span className="tab-ligne-encaisser">, à encaisser {prixChf(c.total_centimes - deduit)}</span>}
          </span>
          {c.allergie?.trim() && <span className="tab-ligne-allergie">Allergie : {c.allergie.trim()}</span>}
          <span className="tab-ligne-plats">{resumePlats(c.lignes)}</span>
        </span>
      </button>
      <span className="tab-ligne-gestes">
        {gestes.map((g) => (
          <button key={g.libelle} type="button" className="bouton-principal tab-ligne-geste" disabled={envoi} onClick={() => faire(g)}>
            {g.libelle}
          </button>
        ))}
      </span>
    </li>
  );
}
