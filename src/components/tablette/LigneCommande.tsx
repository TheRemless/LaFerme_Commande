"use client";

import { useState } from "react";
import type { CommandeTablette } from "@/lib/tablette";
import { heureDe as heure, jourCourtDe as jourCourt, jourGeneveDe as jourGeneve } from "@/lib/heures";
import { prixChf } from "@/lib/prix";
import { gestePrincipal, resumePlats, type EtatTemps } from "@/components/tablette/rush";

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
  const geste = gestePrincipal(c);
  const promise = c.heure_confirmee ?? c.heure_proposee;
  const autreJour = jourGeneve(promise) !== aujourdHui;
  const deduit = c.deduit_centimes ?? 0;
  const client = `${c.client_prenom} ${c.client_nom.charAt(0)}.`;

  async function faire() {
    if (!geste) return;
    setEnvoi(true);
    await agir(geste.corps);
    setEnvoi(false);
  }

  return (
    <li className={`tab-ligne tab-niveau-${etat.niveau}${ouverte ? " tab-ligne-ouverte" : ""}`}>
      <button type="button" className="tab-ligne-corps" aria-expanded={ouverte} onClick={ouvrir}>
        <span className="tab-ligne-num">{c.numero}</span>
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
          </span>
          <span className="tab-ligne-plats">{resumePlats(c.lignes)}</span>
          {c.statut_paiement === "a_encaisser_retrait" && <span className="tab-ligne-encaisser">À encaisser {prixChf(c.total_centimes - deduit)}</span>}
        </span>
      </button>
      {geste ? (
        <button type="button" className="bouton-principal tab-ligne-geste" disabled={envoi} onClick={faire}>
          {geste.libelle}
        </button>
      ) : (
        <span className="tab-ligne-geste" aria-hidden="true" />
      )}
    </li>
  );
}
