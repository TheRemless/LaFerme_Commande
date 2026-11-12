"use client";

import { useState } from "react";
import type { DonneesLivraisons, LivraisonTablette, LivreurTablette } from "@/lib/livreur";
import type { CommandeTablette } from "@/lib/tablette";
import { heureDe as heure } from "@/lib/heures";
import { PROBLEME_LIBELLE } from "@/lib/livraisons-textes";

// Onglet « Livraisons » de la tablette : commandes à donner à un livreur, tournée de chaque livreur dans
// l'ordre de passage (proposé, modifiable à la main), état de chaque livraison et problèmes signalés.

const PROBLEME_TEXTE: Record<string, string> = Object.fromEntries(Object.entries(PROBLEME_LIBELLE).map(([k, v]) => [k, k === "autre" ? "autre problème" : v.toLowerCase()]));

const EN_COURS = ["acceptee", "en_preparation", "partie"];

export function problemeTexte(l: Pick<LivraisonTablette, "probleme" | "probleme_detail">): string {
  return `${PROBLEME_TEXTE[l.probleme ?? ""] ?? l.probleme}${l.probleme_detail ? `, « ${l.probleme_detail} »` : ""}`;
}

function adresseCourte(c: CommandeTablette): string {
  return c.adresse ? `${c.adresse.rue} ${c.adresse.numero}, ${c.adresse.npa} ${c.adresse.localite}` : "Adresse manquante";
}

// Commandes en livraison acceptées et pas encore livrées : celles qu'on peut donner à un livreur.
export function livraisonsEnCours(commandes: CommandeTablette[]): CommandeTablette[] {
  return commandes.filter((c) => c.mode === "livraison" && EN_COURS.includes(c.statut));
}

export function OngletLivraisons({
  commandes,
  donnees,
  agir,
}: {
  commandes: CommandeTablette[];
  donnees: DonneesLivraisons | null;
  agir: (corps: Record<string, unknown>) => Promise<void>;
}) {
  const [envoi, setEnvoi] = useState(false);
  async function faire(corps: Record<string, unknown>) {
    setEnvoi(true);
    await agir(corps);
    setEnvoi(false);
  }
  if (!donnees) return <p className="tab-vide">Chargement des livraisons…</p>;

  const parCommande = new Map(donnees.livraisons.map((l) => [l.commande_id, l]));
  const enCours = livraisonsEnCours(commandes);
  const aAttribuer = enCours
    .filter((c) => !parCommande.has(c.id))
    .sort((a, b) => (a.heure_confirmee ?? a.heure_proposee).localeCompare(b.heure_confirmee ?? b.heure_proposee));
  const actifs = donnees.livreurs.filter((l) => l.actif);
  const commandeDe = new Map(commandes.map((c) => [c.id, c]));

  return (
    <div className="liv-tablette">
      <section className="liv-colonne" aria-labelledby="liv-a-attribuer">
        <h2 id="liv-a-attribuer">
          À donner à un livreur <span className="tab-nb">{aAttribuer.length}</span>
        </h2>
        {actifs.length === 0 && <p className="tab-message">Aucun livreur dans l&apos;équipe. Le gérant en ajoute un au back-office, rubrique « Équipe ».</p>}
        {aAttribuer.length === 0 ? (
          <p className="liv-rien">Toutes les livraisons acceptées ont un livreur.</p>
        ) : (
          <ul className="liv-cartes">
            {aAttribuer.map((c) => (
              <li key={c.id} className="liv-carte">
                <p className="liv-carte-tete">
                  <strong className="tab-num">{c.numero}</strong>
                  <span>
                    pour <strong>{heure(c.heure_confirmee ?? c.heure_proposee)}</strong>
                    {c.statut === "partie" ? ", déjà partie" : c.statut === "en_preparation" ? ", en préparation" : ""}
                  </span>
                </p>
                <p>
                  {adresseCourte(c)}
                  {c.zone_numero ? `. Zone ${c.zone_numero}` : ""}
                </p>
                <div className="boutons-ligne">
                  {actifs.map((l) => (
                    <button key={l.id} type="button" className="bouton-second" disabled={envoi} onClick={() => faire({ action: "attribuer", commande: c.id, livreur: l.id })}>
                      À {l.nom}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="liv-colonne">
        {donnees.livreurs.map((l) => (
          <Tournee
            key={l.id}
            livreur={l}
            autres={actifs.filter((x) => x.id !== l.id)}
            livraisons={donnees.livraisons.filter((x) => x.livreur_id === l.id)}
            commandeDe={commandeDe}
            envoi={envoi}
            faire={faire}
          />
        ))}
      </div>
    </div>
  );
}

function presence(l: LivreurTablette): string {
  if (!l.actif) return "Retiré de l'équipe : donnez ses livraisons à quelqu'un d'autre.";
  if (!l.vu_le) return "Pas encore connecté sur son téléphone.";
  const minutes = Math.floor((Date.now() - new Date(l.vu_le).getTime()) / 60_000);
  return minutes < 2 ? "Page ouverte sur son téléphone." : `Dernière mise à jour de son téléphone à ${heure(l.vu_le)}.`;
}

function Tournee({
  livreur,
  autres,
  livraisons,
  commandeDe,
  envoi,
  faire,
}: {
  livreur: LivreurTablette;
  autres: LivreurTablette[];
  livraisons: LivraisonTablette[];
  commandeDe: Map<string, CommandeTablette>;
  envoi: boolean;
  faire: (corps: Record<string, unknown>) => Promise<void>;
}) {
  const actives = livraisons.filter((x) => EN_COURS.includes(x.commande_statut));
  const annulees = livraisons.filter((x) => !EN_COURS.includes(x.commande_statut));
  const parties = actives.filter((x) => x.commande_statut === "partie").length;
  return (
    <section className="liv-tournee" aria-labelledby={`tournee-${livreur.id}`}>
      <header className="liv-tournee-tete">
        <div>
          <h2 id={`tournee-${livreur.id}`}>{livreur.nom}</h2>
          <p className="tab-meta">
            {actives.length === 0
              ? "Rien en cours."
              : `${actives.length} ${actives.length > 1 ? "livraisons" : "livraison"}${parties ? `, ${parties} en route` : ""}.`}{" "}
            {presence(livreur)}
          </p>
        </div>
        {actives.length > 1 && (
          <button type="button" className="bouton-second" disabled={envoi} onClick={() => faire({ action: "proposer", livreur: livreur.id })}>
            {actives.some((x) => x.ordre_manuel) ? "Reprendre l'ordre proposé" : "Recalculer l'ordre"}
          </button>
        )}
      </header>

      {annulees.map((x) => (
        <p key={x.commande_id} className="tab-attente">
          N° {x.numero} annulée{x.partie_le ? " alors qu'elle était partie" : ""}. {livreur.nom} doit {x.partie_le ? "rapporter le sac" : "la laisser au restaurant"} : son téléphone le lui dit
          jusqu&apos;à ce qu&apos;il touche « Compris ».
        </p>
      ))}

      {actives.length > 0 && (
        <ol className="liv-arrets">
          {actives.map((x, i) => {
            const c = commandeDe.get(x.commande_id);
            return (
              <li key={x.commande_id} className={x.probleme ? "liv-arret-tab liv-souci" : "liv-arret-tab"}>
                <p className="liv-rang-tab" aria-label={`Arrêt ${i + 1}`}>
                  {i + 1}
                </p>
                <div className="liv-arret-corps">
                  <p>
                    <strong>N° {x.numero}</strong> pour <strong>{c?.heure_confirmee ? heure(c.heure_confirmee) : "…"}</strong>.{" "}
                    {x.commande_statut === "partie" ? `En route depuis ${x.partie_le ? heure(x.partie_le) : "…"}.` : "Au restaurant."}
                  </p>
                  {c && (
                    <p className="tab-meta">
                      {adresseCourte(c)}
                      {c.zone_numero ? `. Zone ${c.zone_numero}` : ""}
                    </p>
                  )}
                  {x.probleme && (
                    <p className="liv-souci-texte">
                      Problème à {x.probleme_le ? heure(x.probleme_le) : "…"} : {problemeTexte(x)}. Appelez le client ou {livreur.nom}, puis touchez « Problème réglé » ou annulez la commande
                      dans « En cours ».
                    </p>
                  )}
                  <div className="boutons-ligne">
                    <button
                      type="button"
                      className="bouton-second"
                      disabled={envoi || i === 0}
                      aria-label={`Passer le ${x.numero} plus tôt`}
                      onClick={() => faire({ action: "deplacer", commande: x.commande_id, livreur: livreur.id, sens: -1 })}
                    >
                      Plus tôt
                    </button>
                    <button
                      type="button"
                      className="bouton-second"
                      disabled={envoi || i === actives.length - 1}
                      aria-label={`Passer le ${x.numero} plus tard`}
                      onClick={() => faire({ action: "deplacer", commande: x.commande_id, livreur: livreur.id, sens: 1 })}
                    >
                      Plus tard
                    </button>
                    {x.probleme && (
                      <button type="button" className="bouton-second" disabled={envoi} onClick={() => faire({ action: "regler_probleme", commande: x.commande_id })}>
                        Problème réglé
                      </button>
                    )}
                    {autres.map((a) => (
                      <button key={a.id} type="button" className="bouton-second" disabled={envoi} onClick={() => faire({ action: "attribuer", commande: x.commande_id, livreur: a.id })}>
                        Donner à {a.nom}
                      </button>
                    ))}
                    <button type="button" className="lien" disabled={envoi} onClick={() => faire({ action: "retirer", commande: x.commande_id })}>
                      Reprendre
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
