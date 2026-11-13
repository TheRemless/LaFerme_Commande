"use client";

import { useEffect, useState } from "react";
import { CodeLivreur } from "./CodeLivreur";
import { BOUTONS_MAX, choixLivreurs, tourneesAffichees } from "./livraisons-choix";
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
  plusTard,
  donnees,
  agir,
  annulerPartie = false,
}: {
  commandes: CommandeTablette[];
  // Livraisons acceptées dont les tickets ne sont pas encore sortis (onglet « À l'avance ») : pas encore à attribuer.
  plusTard?: Set<string>;
  donnees: DonneesLivraisons | null;
  agir: (corps: Record<string, unknown>) => Promise<void>;
  // Peut annuler une livraison partie (gérant) : sinon, le texte dit à qui le demander.
  annulerPartie?: boolean;
}) {
  const [envoi, setEnvoi] = useState(false);
  // « Code de connexion » des livreurs : gérant ou responsable, réglage connexion_livreur_par_code ouvert.
  const [codeAutorise, setCodeAutorise] = useState(false);
  useEffect(() => {
    fetch("/api/tablette/code-livreur", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCodeAutorise(d?.autorise === true))
      .catch(() => undefined);
  }, []);
  async function faire(corps: Record<string, unknown>) {
    setEnvoi(true);
    await agir(corps);
    setEnvoi(false);
  }
  if (!donnees) return <p className="tab-vide">Chargement des livraisons…</p>;

  const parCommande = new Map(donnees.livraisons.map((l) => [l.commande_id, l]));
  const enCours = livraisonsEnCours(commandes);
  const aAttribuer = enCours
    .filter((c) => !parCommande.has(c.id) && !plusTard?.has(c.id))
    .sort((a, b) => (a.heure_confirmee ?? a.heure_proposee).localeCompare(b.heure_confirmee ?? b.heure_proposee));
  const actifs = donnees.livreurs.filter((l) => l.actif);
  const commandeDe = new Map(commandes.map((c) => [c.id, c]));
  // Planning du service (bo-operations) : les prévus en boutons, les autres dans « Donner à… ».
  const { boutons, menu } = choixLivreurs(donnees.livreurs, donnees.prevus);
  const avecLivraison = new Set(donnees.livraisons.map((l) => l.livreur_id));
  const tournees = tourneesAffichees(donnees.livreurs, donnees.prevus, avecLivraison);
  // Les boutons réunissent les prévus au planning et ceux dont la page est ouverte : on les nomme à part (M11 de la
  // mise en situation : « Prévus ce soir » listait des livreurs absents du planning).
  const auPlanning = new Set(donnees.prevus?.ids ?? []);
  const prevusNoms = boutons.filter((l) => auPlanning.has(l.id)).map((l) => l.nom);
  const ouvertsNoms = boutons.filter((l) => !auPlanning.has(l.id)).map((l) => l.nom);
  const moment = donnees.prevus?.service === "midi" ? "midi" : "soir";

  return (
    <div className="liv-tablette">
      <section className="liv-colonne" aria-labelledby="liv-a-attribuer">
        <h2 id="liv-a-attribuer">
          À donner à un livreur <span className="tab-nb">{aAttribuer.length}</span>
        </h2>
        {actifs.length === 0 && <p className="tab-message">Aucun livreur dans l&apos;équipe. Le gérant en ajoute un au back-office, rubrique « Équipe ».</p>}
        {actifs.length > BOUTONS_MAX && (
          <p className="tab-meta">
            {prevusNoms.length > 0 ? `Prévus ce ${moment} : ${prevusNoms.join(", ")}.` : `Personne au planning de ce ${moment}.`}
            {ouvertsNoms.length > 0 ? ` Page ouverte sur leur téléphone : ${ouvertsNoms.join(", ")}.` : ""}
            {menu.length > 0 ? " Les autres sont dans « Donner à… »." : ""}
          </p>
        )}
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
                  {boutons.map((l) => (
                    <button key={l.id} type="button" className="bouton-second" disabled={envoi} onClick={() => faire({ action: "attribuer", commande: c.id, livreur: l.id })}>
                      À {l.nom}
                    </button>
                  ))}
                  {menu.length > 0 && (
                    <select
                      className="liv-donner"
                      aria-label={`Donner la commande ${c.numero} à un livreur`}
                      disabled={envoi}
                      value=""
                      onChange={(e) => e.target.value && faire({ action: "attribuer", commande: c.id, livreur: e.target.value })}
                    >
                      <option value="">{boutons.length > 0 ? "Donner à un autre…" : "Donner à…"}</option>
                      {menu.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nom}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="liv-colonne">
        {tournees.map((l) => (
          <Tournee
            key={l.id}
            livreur={l}
            autres={boutons.filter((x) => x.id !== l.id)}
            autresMenu={menu.filter((x) => x.id !== l.id)}
            livraisons={donnees.livraisons.filter((x) => x.livreur_id === l.id)}
            commandeDe={commandeDe}
            envoi={envoi}
            faire={faire}
            codeAutorise={codeAutorise}
            annulerPartie={annulerPartie}
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
  autresMenu = [],
  livraisons,
  commandeDe,
  envoi,
  faire,
  codeAutorise = false,
  annulerPartie = false,
}: {
  livreur: LivreurTablette;
  autres: LivreurTablette[];
  // Livreurs ni prévus ni connectés (grande équipe) : dans le menu « Donner à… ».
  autresMenu?: LivreurTablette[];
  livraisons: LivraisonTablette[];
  commandeDe: Map<string, CommandeTablette>;
  envoi: boolean;
  faire: (corps: Record<string, unknown>) => Promise<void>;
  codeAutorise?: boolean;
  annulerPartie?: boolean;
}) {
  const [confirmer, setConfirmer] = useState<string | null>(null);
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
        {codeAutorise && livreur.actif && <CodeLivreur livreur={livreur.id} nom={livreur.nom} />}
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
                      Problème à {x.probleme_le ? heure(x.probleme_le) : "…"} : {problemeTexte(x)}. Appelez le client
                      {c?.client_telephone ? (
                        <>
                          {" "}
                          (<a href={`tel:${c.client_telephone.replace(/[^+\d]/g, "")}`}>{c.client_telephone}</a>)
                        </>
                      ) : null}{" "}
                      ou {livreur.nom}, puis touchez « Problème réglé »
                      {x.probleme === "client_absent" && x.commande_statut === "partie"
                        ? " s'il répond, ou « Client absent : clore » s'il ne répond pas."
                        : annulerPartie || x.commande_statut !== "partie"
                          ? " ou annulez la commande dans « En cours »."
                          : " ou demandez au gérant d'annuler la commande (elle est remboursée)."}
                    </p>
                  )}
                  {confirmer === x.commande_id && (
                    <div className="liv-confirmer">
                      <p>
                        Clore le n° {x.numero} sans le livrer ni le rembourser ? Le client reçoit un e-mail « non remise », le gérant décide ensuite d&apos;un remboursement dans
                        le back-office.
                      </p>
                      <div className="boutons-ligne">
                        <button
                          type="button"
                          className="bouton-principal"
                          disabled={envoi}
                          onClick={async () => {
                            await faire({ action: "client_absent", commande: x.commande_id });
                            setConfirmer(null);
                          }}
                        >
                          Oui, clore sans rembourser
                        </button>
                        <button type="button" className="bouton-second" onClick={() => setConfirmer(null)}>
                          Garder
                        </button>
                      </div>
                    </div>
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
                    {x.probleme === "client_absent" && x.commande_statut === "partie" && confirmer !== x.commande_id && (
                      <button type="button" className="bouton-second" disabled={envoi} onClick={() => setConfirmer(x.commande_id)}>
                        Client absent : clore
                      </button>
                    )}
                    {autres.map((a) => (
                      <button key={a.id} type="button" className="bouton-second" disabled={envoi} onClick={() => faire({ action: "attribuer", commande: x.commande_id, livreur: a.id })}>
                        Donner à {a.nom}
                      </button>
                    ))}
                    {autresMenu.length > 0 && (
                      // Grande équipe : les livreurs ni prévus ni connectés dans un menu.
                      <select
                        className="liv-donner"
                        aria-label={`Donner la commande ${x.numero} à un autre livreur`}
                        disabled={envoi}
                        value=""
                        onChange={(e) => e.target.value && faire({ action: "attribuer", commande: x.commande_id, livreur: e.target.value })}
                      >
                        <option value="">{autres.length > 0 ? "Donner à un autre…" : "Donner à…"}</option>
                        {autresMenu.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.nom}
                          </option>
                        ))}
                      </select>
                    )}
                    <button type="button" className="bouton-second" disabled={envoi} onClick={() => faire({ action: "retirer", commande: x.commande_id })}>
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
