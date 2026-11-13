"use client";

// Clôture du jour (rapport Z) : ce qui a été encaissé, ce qui reste à encaisser au comptoir, les remboursements,
// ce qui est à vérifier, la TVA. Le gérant compte la caisse et clôture : la base calcule l'écart, garde une copie
// du rapport et journalise (cloture_jour, cloturer_jour : docs/pilotage.md). Rien n'est recalculé ici.
import { useCallback, useEffect, useRef, useState } from "react";
import { Champ, Chargement, EtatErreur, montant, nombre, useConfirmer, useNotifier, decalerJour } from "@/components/gestion/ui";
import { libelleEcart, montantCompte, type ClotureJour as Donnees } from "@/lib/cloture";
import { heureDe, jourGeneveDe } from "@/lib/heures";
import { jourDeService } from "@/lib/pilotage";
import { poster } from "@/lib/requete-client";
import { jourTexte } from "@/lib/service";
import "./cloture.css";

const STATUTS: Record<string, string> = {
  nouvelle: "à accepter",
  acceptee: "acceptée",
  en_preparation: "en préparation",
  prete: "prête",
  partie: "partie",
  terminee: "terminée",
};
const MOYENS = { stripe: "en ligne", especes: "espèces", deduction: "déduit au comptoir" } as const;
const ETATS = { fait: "fait", en_cours: "pas encore confirmé", echec: "échec" } as const;

export function ClotureJour() {
  const aujourdhui = jourDeService();
  const [jour, setJour] = useState(aujourdhui);
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [especes, setEspeces] = useState("");
  const [carte, setCarte] = useState("");
  const [note, setNote] = useState("");
  const [erreursSaisie, setErreursSaisie] = useState<{ especes?: string; carte?: string }>({});
  const [envoi, setEnvoi] = useState(false);
  const confirmer = useConfirmer();
  const notifier = useNotifier();
  const demande = useRef(0);

  const charger = useCallback(async () => {
    const n = ++demande.current;
    setErreur(null);
    setDonnees(null);
    try {
      const r = await fetch(`/api/gestion/cloture?jour=${jour}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (n !== demande.current) return;
      if (!r.ok) throw new Error(String((d as { erreur?: string }).erreur ?? "La clôture ne répond pas."));
      const c = d as Donnees;
      setDonnees(c);
      // Une clôture déjà faite : ses montants comptés reviennent dans les champs, pour reclôturer si besoin.
      setEspeces(c.cloture?.especes_comptees_centimes != null ? (c.cloture.especes_comptees_centimes / 100).toFixed(2) : "");
      setCarte(c.cloture?.carte_comptoir_centimes != null ? (c.cloture.carte_comptoir_centimes / 100).toFixed(2) : "");
      setNote(c.cloture?.note ?? "");
      setErreursSaisie({});
    } catch (e) {
      if (n !== demande.current) return;
      setErreur(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Pas de connexion. Vérifiez le réseau et réessayez.");
    }
  }, [jour]);

  useEffect(() => {
    charger();
  }, [charger]);

  async function cloturer(ev: React.FormEvent) {
    ev.preventDefault();
    if (!donnees) return;
    const e = montantCompte(especes);
    const c = montantCompte(carte);
    const erreurs = {
      especes: e === undefined ? "Montant illisible : écrivez par exemple 1250.50." : undefined,
      carte: c === undefined ? "Montant illisible : écrivez par exemple 830." : undefined,
    };
    setErreursSaisie(erreurs);
    if (e === undefined || c === undefined) return;
    const attendu = donnees.rapport.encaissements.attendu_comptoir_centimes;
    const compte = e === null && c === null ? null : (e ?? 0) + (c ?? 0);
    const ok = await confirmer({
      titre: donnees.cloture ? `Reclôturer le ${jourTexte(jour)} ?` : `Clôturer le ${jourTexte(jour)} ?`,
      texte:
        compte === null
          ? "Rien n'est compté : la clôture garde le rapport sans écart de caisse."
          : `Attendu au comptoir : CHF ${montant(attendu)}. Compté : CHF ${montant(compte)}. Écart : CHF ${montant(compte - attendu)}.${donnees.cloture ? " La clôture précédente reste dans le journal." : ""}`,
      oui: donnees.cloture ? "Reclôturer" : "Clôturer le jour",
    });
    if (!ok) return;
    setEnvoi(true);
    const r = await poster("/api/gestion/cloture", { jour, especes: e === null ? "" : (e / 100).toFixed(2), carte: c === null ? "" : (c / 100).toFixed(2), note });
    setEnvoi(false);
    if (!r.ok) {
      notifier({ texte: String(r.donnees.erreur ?? "Pas clôturé."), ton: "erreur" });
      return;
    }
    notifier({ texte: `Jour du ${jourTexte(jour)} clôturé.`, ton: "succes" });
    await charger();
  }

  const r = donnees?.rapport;
  const cl = donnees?.cloture;
  const en = r?.encaissements;
  // Espèces et carte séparées : seulement si le rapport les contient (pas une clôture enregistrée avant).
  const moyens =
    en && en.comptoir_especes && en.comptoir_carte && en.comptoir_non_note && en.attendu_especes_centimes !== undefined && en.attendu_carte_centimes !== undefined
      ? { especes: en.comptoir_especes, carte: en.comptoir_carte, nonNote: en.comptoir_non_note, attenduEspeces: en.attendu_especes_centimes, attenduCarte: en.attendu_carte_centimes }
      : null;

  return (
    <div className="clo">
      <div className="clo-tete">
        <div className="bo-champ clo-jour">
          <label htmlFor="clo-jour">Jour de service</label>
          <input id="clo-jour" type="date" value={jour} max={aujourdhui} onChange={(e) => e.target.value && setJour(e.target.value)} />
        </div>
        <span className="clo-raccourcis">
          <button type="button" className="bo-bouton bo-bouton-second" aria-pressed={jour === aujourdhui} onClick={() => setJour(aujourdhui)}>
            Aujourd&apos;hui
          </button>
          <button type="button" className="bo-bouton bo-bouton-second" aria-pressed={jour === decalerJour(aujourdhui, -1)} onClick={() => setJour(decalerJour(aujourdhui, -1))}>
            Hier
          </button>
        </span>
        {r && (
          <span className="clo-actions">
            <button type="button" className="bo-bouton bo-bouton-second" onClick={() => window.print()}>
              Imprimer
            </button>
            <a className="bo-bouton bo-bouton-second" href={`/api/gestion/cloture?jour=${jour}&format=csv`} download>
              Télécharger (CSV)
            </a>
          </span>
        )}
      </div>

      {erreur ? (
        <EtatErreur texte={erreur} reessayer={charger} />
      ) : !r || !donnees ? (
        <Chargement lignes={8} libelle="Calcul de la clôture…" />
      ) : (
        <>
          <h2 className="clo-titre">
            <span className="clo-imprime">La Ferme, </span>Clôture du {jourTexte(r.jour)}
          </h2>
          <p className="aide">
            Jour de service de 5h à 5h le lendemain.
            {cl ? ` Clôturé le ${jourTexte(jourGeneveDe(cl.cloture_le))} à ${heureDe(cl.cloture_le)} par ${cl.personnel_nom} : chiffres tels qu'ils étaient à ce moment-là.` : " Pas encore clôturé : chiffres calculés maintenant."}
          </p>
          {donnees.change_depuis && (
            <p className="clo-attention" role="alert">
              Des commandes ou des remboursements de ce jour ont changé depuis la clôture. Recomptez si besoin et reclôturez.
            </p>
          )}

          <div className="clo-deux">
            <section aria-labelledby="clo-encaisse">
              <h3 id="clo-encaisse">Encaissé</h3>
              <div className="clo-defile" tabIndex={0} role="region" aria-labelledby="clo-encaisse">
              <table className="clo-table">
                <tbody>
                  <tr>
                    <th scope="row">En ligne (TWINT ou carte)</th>
                    <td className="clo-nb">{nombre(r.encaissements.en_ligne.commandes)}</td>
                    <td className="clo-nb">CHF {montant(r.encaissements.en_ligne.centimes)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Au comptoir</th>
                    <td className="clo-nb">{nombre(r.encaissements.comptoir.commandes)}</td>
                    <td className="clo-nb">CHF {montant(r.encaissements.comptoir.centimes)}</td>
                  </tr>
                  {moyens && (
                    <>
                      <tr className="clo-detail">
                        <th scope="row">dont espèces</th>
                        <td className="clo-nb">{nombre(moyens.especes.commandes)}</td>
                        <td className="clo-nb">CHF {montant(moyens.especes.centimes)}</td>
                      </tr>
                      <tr className="clo-detail">
                        <th scope="row">dont carte</th>
                        <td className="clo-nb">{nombre(moyens.carte.commandes)}</td>
                        <td className="clo-nb">CHF {montant(moyens.carte.centimes)}</td>
                      </tr>
                      {moyens.nonNote.commandes > 0 && (
                        <tr className="clo-detail">
                          <th scope="row">dont moyen pas noté</th>
                          <td className="clo-nb">{nombre(moyens.nonNote.commandes)}</td>
                          <td className="clo-nb">CHF {montant(moyens.nonNote.centimes)}</td>
                        </tr>
                      )}
                    </>
                  )}
                  <tr>
                    <th scope="row">Déduit au comptoir (manques)</th>
                    <td />
                    <td className="clo-nb">CHF {montant(r.encaissements.deductions_centimes)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Espèces rendues</th>
                    <td />
                    <td className="clo-nb">CHF {montant(-r.encaissements.especes_rendues_centimes)}</td>
                  </tr>
                  <tr className="clo-total">
                    <th scope="row">Attendu au comptoir</th>
                    <td />
                    <td className="clo-nb">CHF {montant(r.encaissements.attendu_comptoir_centimes)}</td>
                  </tr>
                </tbody>
              </table>
              </div>
              <p className="aide">
                {!moyens
                  ? "Au comptoir : espèces et carte ensemble (clôture enregistrée avant que la tablette note le moyen)."
                  : moyens.nonNote.commandes > 0
                    ? "Certaines commandes du comptoir n'ont pas de moyen noté : l'écart se lit sur le total, pas par moyen."
                    : "Espèces : à comparer au tiroir. Carte : à comparer au ticket du terminal."}
              </p>
            </section>

            <section aria-labelledby="clo-caisse" className={cl ? "clo-caisse" : "clo-caisse clo-sans-impression"}>
              <h3 id="clo-caisse">Compter la caisse</h3>
              {cl && cl.ecart_centimes !== null && (
                <p className="clo-ecart" data-ecart={cl.ecart_centimes === 0 ? "juste" : "ecart"}>
                  Compté CHF {montant((cl.especes_comptees_centimes ?? 0) + (cl.carte_comptoir_centimes ?? 0))} pour CHF {montant(cl.attendu_comptoir_centimes)} attendus :{" "}
                  {cl.ecart_centimes === 0 ? "la caisse est juste." : `écart de CHF ${montant(cl.ecart_centimes)}.`}
                </p>
              )}
              <form onSubmit={cloturer} className="clo-form">
                <Champ
                  libelle="Espèces comptées (CHF)"
                  aide={moyens ? `Attendu dans le tiroir : CHF ${montant(moyens.attenduEspeces)}. Vide si pas compté.` : "Vide si pas compté."}
                  erreur={erreursSaisie.especes}
                >
                  {(a) => <input {...a} inputMode="decimal" autoComplete="off" value={especes} onChange={(e) => setEspeces(e.target.value)} />}
                </Champ>
                <Champ
                  libelle="Carte au comptoir (CHF)"
                  aide={moyens ? `Le total du ticket du terminal. Attendu : CHF ${montant(moyens.attenduCarte)}.` : "Le total du ticket de clôture du terminal."}
                  erreur={erreursSaisie.carte}
                >
                  {(a) => <input {...a} inputMode="decimal" autoComplete="off" value={carte} onChange={(e) => setCarte(e.target.value)} />}
                </Champ>
                <Champ libelle="Note" facultatif>
                  {(a) => <textarea {...a} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
                </Champ>
                <button type="submit" className="bo-bouton bo-bouton-principal" disabled={envoi || jour > aujourdhui}>
                  {envoi ? "Clôture…" : cl ? "Reclôturer" : "Clôturer le jour"}
                </button>
              </form>
            </section>
          </div>

          <section aria-labelledby="clo-a-encaisser">
            <h3 id="clo-a-encaisser">Comptoir pas encore encaissé</h3>
            {r.a_encaisser.length === 0 ? (
              <p className="aide">Tout est encaissé.</p>
            ) : (
              <div className="clo-defile" tabIndex={0} role="region" aria-labelledby="clo-a-encaisser">
              <table className="clo-table">
                <thead>
                  <tr>
                    <th scope="col">Numéro</th>
                    <th scope="col">Heure</th>
                    <th scope="col">Où en est la commande</th>
                    <th scope="col" className="clo-nb">À encaisser</th>
                  </tr>
                </thead>
                <tbody>
                  {r.a_encaisser.map((a) => (
                    <tr key={a.numero}>
                      <td>{a.numero}</td>
                      <td>{a.heure}</td>
                      <td>{STATUTS[a.statut] ?? a.statut}</td>
                      <td className="clo-nb">CHF {montant(a.du_centimes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </section>

          <section aria-labelledby="clo-verifier">
            <h3 id="clo-verifier">À vérifier</h3>
            {r.ecarts.length === 0 ? (
              <p className="aide">Rien à vérifier.</p>
            ) : (
              <ul className="clo-liste">
                {r.ecarts.map((e, i) => (
                  <li key={`${e.type}-${e.numero}-${i}`}>
                    <strong>{libelleEcart(e)}</strong> : commande {e.numero}, CHF {montant(e.centimes)}
                    {e.type === "pas_terminee" ? ` (${STATUTS[e.statut] ?? e.statut})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="clo-remb">
            <h3 id="clo-remb">Remboursements du jour</h3>
            {r.remboursements.length === 0 ? (
              <p className="aide">Aucun remboursement.</p>
            ) : (
              <div className="clo-defile" tabIndex={0} role="region" aria-labelledby="clo-remb">
              <table className="clo-table">
                <thead>
                  <tr>
                    <th scope="col">Numéro</th>
                    <th scope="col">Heure</th>
                    <th scope="col">Moyen</th>
                    <th scope="col">État</th>
                    <th scope="col">Motif</th>
                    <th scope="col">Par</th>
                    <th scope="col" className="clo-nb">CHF</th>
                  </tr>
                </thead>
                <tbody>
                  {r.remboursements.map((x, i) => (
                    <tr key={`${x.numero}-${i}`}>
                      <td>
                        {x.numero}
                        {x.commande_refusee ? " (refusée)" : ""}
                      </td>
                      <td>{x.heure}</td>
                      <td>{MOYENS[x.moyen]}</td>
                      <td>{ETATS[x.statut]}</td>
                      <td>{x.motif}</td>
                      <td>{x.par}</td>
                      <td className="clo-nb">{montant(x.montant_centimes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </section>

          <div className="clo-deux">
            <section aria-labelledby="clo-ventes">
              <h3 id="clo-ventes">Ventes</h3>
              <div className="clo-defile" tabIndex={0} role="region" aria-labelledby="clo-ventes">
              <table className="clo-table">
                <tbody>
                  <tr>
                    <th scope="row">Commandes prises</th>
                    <td className="clo-nb">{nombre(r.ventes.commandes)}</td>
                    <td className="clo-nb">CHF {montant(r.ventes.ttc_centimes)}</td>
                  </tr>
                  <tr>
                    <th scope="row">dont livraison</th>
                    <td className="clo-nb">{nombre(r.ventes.livraison.commandes)}</td>
                    <td className="clo-nb">CHF {montant(r.ventes.livraison.ttc_centimes)}</td>
                  </tr>
                  <tr>
                    <th scope="row">dont à emporter</th>
                    <td className="clo-nb">{nombre(r.ventes.retrait.commandes)}</td>
                    <td className="clo-nb">CHF {montant(r.ventes.retrait.ttc_centimes)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Frais de livraison</th>
                    <td />
                    <td className="clo-nb">CHF {montant(r.ventes.frais_centimes)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Refusées</th>
                    <td className="clo-nb">{nombre(r.ventes.refusees.commandes)}</td>
                    <td className="clo-nb">CHF {montant(r.ventes.refusees.ttc_centimes)}</td>
                  </tr>
                </tbody>
              </table>
              </div>
            </section>
            <section aria-labelledby="clo-tva">
              <h3 id="clo-tva">TVA</h3>
              <div className="clo-defile" tabIndex={0} role="region" aria-labelledby="clo-tva">
              <table className="clo-table">
                <thead>
                  <tr>
                    <th scope="col">Taux</th>
                    <th scope="col" className="clo-nb">Net TTC</th>
                    <th scope="col" className="clo-nb">TVA nette</th>
                    <th scope="col" className="clo-nb">Net HT</th>
                  </tr>
                </thead>
                <tbody>
                  {r.ventes.tva.length === 0 ? (
                    <tr>
                      <td colSpan={4}>Aucune vente.</td>
                    </tr>
                  ) : (
                    r.ventes.tva.map((t) => (
                      <tr key={t.taux_pourcent}>
                        <td>{t.taux_pourcent} %</td>
                        <td className="clo-nb">{montant(t.net_ttc_centimes)}</td>
                        <td className="clo-nb">{montant(t.net_tva_centimes)}</td>
                        <td className="clo-nb">{montant(t.net_ht_centimes)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
