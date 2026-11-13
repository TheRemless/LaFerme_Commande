"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { heureDe, jourGeneveDe } from "@/lib/heures";
import { nouvelleCle } from "@/lib/cle";
import { prixChf as chf } from "@/lib/prix";
import { poster } from "@/lib/requete-client";
import { ajouterJours, jourTexte } from "@/lib/service";

// Commandes passées (audit du gérant, G04) et remboursement après coup (G02). La recherche part en POST :
// un nom ou un téléphone n'apparaît jamais dans une adresse.

type Ligne = {
  id: string;
  numero: number;
  jour_service: string;
  cree_le: string;
  mode: "livraison" | "retrait";
  statut: string;
  statut_paiement: string;
  moyen_paiement: "en_ligne" | "comptoir";
  client_prenom: string;
  client_nom: string;
  client_telephone: string;
  total_centimes: number;
  rembourse_centimes: number;
};
type Jour = { jour: string; commandes: number; refusees: number; ventes_centimes: number; rembourse_centimes: number; a_encaisser: number };
type Fiche = Ligne & {
  adresse: { rue: string; numero: string; npa: string; localite: string } | null;
  frais_centimes: number;
  motif: string | null;
  lignes: { nom: string; qte: number; total_centimes: number; note: string }[];
  evenements: { de: string | null; vers: string; par: string; detail: string | null; le: string }[];
  remboursements: { id: string; cle: string; montant_centimes: number; motif: string; moyen: string; statut: string; erreur: string | null; personnel_nom: string; cree_le: string }[];
};

const STATUT: Record<string, string> = {
  nouvelle: "À accepter",
  acceptee: "Acceptée",
  en_preparation: "En préparation",
  prete: "Prête",
  partie: "Partie",
  terminee: "Terminée",
  refusee: "Refusée ou annulée",
};
const PAIEMENT: Record<string, string> = {
  paye: "payée en ligne",
  encaisse: "payée au comptoir",
  a_encaisser_retrait: "à encaisser au comptoir",
  rembourse: "remboursée",
  echec: "paiement échoué",
  en_attente: "paiement en attente",
};
const EVENEMENT: Record<string, string> = {
  acceptee: "Acceptée",
  en_preparation: "En préparation",
  prete: "Prête",
  partie: "Partie",
  terminee: "Terminée",
  refusee: "Refusée ou annulée",
  encaisse: "Encaissée",
  remboursement: "Remboursement",
};

export function GestionCommandes() {
  const ids = useId();
  const auj = jourGeneveDe(new Date());
  const [jours, setJours] = useState<Jour[] | null>(null);
  const [liste, setListe] = useState<Ligne[] | null>(null);
  const [recherche, setRecherche] = useState("");
  const [debut, setDebut] = useState(auj);
  const [fin, setFin] = useState(auj);
  const [titre, setTitre] = useState("Aujourd'hui");
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const chargerJours = useCallback(async () => {
    const r = await poster("/api/gestion/commandes", { action: "jours", debut: ajouterJours(auj, -6), fin: auj });
    if (r.ok) setJours(r.donnees as unknown as Jour[]);
  }, [auj]);

  // Seule la dernière recherche lancée s'affiche : la liste du jour, demandée à l'ouverture et arrivée
  // après une recherche sur un réseau lent, ne remplace plus son résultat.
  const derniere = useRef(0);
  const chercher = useCallback(async (corps: { debut?: string; fin?: string; recherche?: string }, libelle: string) => {
    const n = ++derniere.current;
    setErreur(null);
    const r = await poster("/api/gestion/commandes", { action: "liste", ...corps });
    if (n !== derniere.current) return;
    if (!r.ok) return setErreur(String(r.donnees.erreur ?? "Recherche impossible."));
    setListe(r.donnees as unknown as Ligne[]);
    setTitre(libelle);
    setOuverte(null);
  }, []);

  useEffect(() => {
    chargerJours();
    chercher({ debut: auj, fin: auj }, "Aujourd'hui");
  }, [chargerJours, chercher, auj]);

  async function recharger() {
    await chargerJours();
  }

  return (
    <div className="ges-service">
      <section className="ges-bloc">
        <h2>Les 7 derniers jours</h2>
        {!jours ? (
          <p className="aide">Chargement…</p>
        ) : jours.length === 0 ? (
          <p className="aide">Aucune commande ces 7 derniers jours.</p>
        ) : (
          <div className="ges-defile">
            <table className="ges-table ges-jours">
              <thead>
                <tr>
                  <th>Jour</th>
                  <th>Commandes</th>
                  <th>Ventes</th>
                </tr>
              </thead>
              <tbody>
                {jours.map((j) => (
                  <tr key={j.jour}>
                    <td>
                      <button type="button" className="lien" onClick={() => chercher({ debut: j.jour, fin: j.jour }, `Le ${jourTexte(j.jour)}`)}>
                        {j.jour === auj ? "Aujourd'hui" : jourTexte(j.jour)}
                      </button>
                    </td>
                    <td>
                      {j.commandes}
                      {j.refusees > 0 && <small>{j.refusees === 1 ? "1 refusée" : `${j.refusees} refusées`}</small>}
                    </td>
                    <td>
                      {chf(j.ventes_centimes)}
                      {j.rembourse_centimes > 0 && <small>dont {chf(j.rembourse_centimes)} remboursés</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {jours?.some((j) => j.a_encaisser > 0) && (
          <p className="aide-forte">
            Commandes au comptoir pas encore notées comme encaissées :{" "}
            {jours
              .filter((j) => j.a_encaisser > 0)
              .map((j) => `${j.a_encaisser} le ${jourTexte(j.jour)}`)
              .join(", ")}
            .
          </p>
        )}
        <p className="aide">Ventes : commandes payées en ligne ou encaissées au comptoir, jour du service, frais de livraison compris.</p>
      </section>

      <section className="ges-bloc">
        <h2>Retrouver une commande</h2>
        <form
          className="details"
          onSubmit={(e) => {
            e.preventDefault();
            const q = recherche.trim();
            if (q) chercher({ recherche: q }, `Recherche « ${q} », 90 derniers jours`);
            else chercher({ debut, fin }, debut === fin ? `Le ${jourTexte(debut)}` : `Du ${jourTexte(debut)} au ${jourTexte(fin)}`);
          }}
        >
          <div className="champ champ-large">
            <label htmlFor={`${ids}-q`}>Nom, téléphone ou numéro</label>
            <input id={`${ids}-q`} value={recherche} maxLength={60} autoComplete="off" onChange={(e) => setRecherche(e.target.value)} />
            <p className="aide">Vide : toutes les commandes de la période.</p>
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-debut`}>Du</label>
            <input id={`${ids}-debut`} type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-fin`}>Au</label>
            <input id={`${ids}-fin`} type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
          </div>
          <button type="submit" className="bouton-principal champ-large">
            Chercher
          </button>
        </form>
        {erreur && (
          <p className="panier-alerte" role="alert">
            {erreur}
          </p>
        )}
      </section>

      <section className="ges-bloc">
        <h2>{titre}</h2>
        {!liste ? (
          <p className="aide">Chargement…</p>
        ) : liste.length === 0 ? (
          <p className="aide">Aucune commande.</p>
        ) : (
          <>
            <p className="aide">
              {liste.length} commande{liste.length > 1 ? "s" : ""}
              {liste.length >= 300 ? " (les 300 plus récentes)" : ""}. Touchez une commande pour l&apos;ouvrir.
            </p>
            <ul className="ges-plats">
              {liste.map((c) => (
                <li key={c.id}>
                  <button type="button" className="ges-ligne ges-ligne-commande" aria-expanded={ouverte === c.id} onClick={() => setOuverte(ouverte === c.id ? null : c.id)}>
                    <span className="ges-nom">
                      N° {c.numero}, {c.client_prenom} {c.client_nom}
                    </span>
                    <span className="ges-prix">{chf(c.total_centimes)}</span>
                    <span className="ges-etats">
                      {jourTexte(c.jour_service)}, {c.mode === "livraison" ? "livraison" : "à emporter"}. {STATUT[c.statut] ?? c.statut}, {PAIEMENT[c.statut_paiement] ?? c.statut_paiement}
                      {c.rembourse_centimes > 0 && c.statut_paiement !== "rembourse" ? `, ${chf(c.rembourse_centimes)} remboursés` : ""}.
                    </span>
                  </button>
                  {ouverte === c.id && <FicheCommande id={c.id} apresRemboursement={recharger} />}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function FicheCommande({ id, apresRemboursement }: { id: string; apresRemboursement: () => Promise<void> }) {
  const ids = useId();
  const [f, setF] = useState<Fiche | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [montant, setMontant] = useState("");
  const [motif, setMotif] = useState("");
  // Clé du geste : la même tant que le formulaire n'a pas abouti, pour qu'un double appui ne rembourse pas deux fois.
  const [cle, setCle] = useState(nouvelleCle);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const charger = useCallback(async () => {
    const r = await poster("/api/gestion/commandes", { action: "fiche", id });
    if (!r.ok) return setErreur(String(r.donnees.erreur ?? "Commande introuvable."));
    setF(r.donnees as unknown as Fiche);
  }, [id]);
  useEffect(() => {
    charger();
  }, [charger]);

  if (erreur) return <p className="panier-alerte">{erreur}</p>;
  if (!f) return <p className="aide ges-fiche">Chargement…</p>;

  const reste = f.total_centimes - f.rembourse_centimes - f.remboursements.filter((r) => r.statut === "en_cours").reduce((s, r) => s + r.montant_centimes, 0);
  const remboursable = ["prete", "partie", "terminee"].includes(f.statut) && ["paye", "encaisse"].includes(f.statut_paiement) && reste > 0;
  const enLigne = f.moyen_paiement === "en_ligne";

  async function envoyer(corps: { montant: string; motif: string; cle: string }) {
    setEnvoi(true);
    setMessage(null);
    const r = await poster("/api/gestion/commandes", { action: "rembourser", id, ...corps });
    const texte = String(r.donnees.message ?? r.donnees.erreur ?? "Le remboursement n'est pas passé.");
    setMessage({ ok: r.ok, texte });
    return r;
  }

  // Remboursement resté « en cours » (coupure, serveur muet) : relancé avec sa propre clé, sans doublon.
  async function relancer(x: Fiche["remboursements"][number]) {
    await envoyer({ montant: (x.montant_centimes / 100).toFixed(2), motif: x.motif, cle: x.cle });
    await apresRemboursement();
    await charger();
    setEnvoi(false);
  }

  async function rembourser(e: React.FormEvent) {
    e.preventDefault();
    const r = await envoyer({ montant: montant.trim(), motif, cle });
    // Un geste abouti ou refusé (montant, Stripe) libère la clé. Une coupure ou une erreur du serveur la garde :
    // renvoyer le même formulaire reprend le même remboursement, sans doublon.
    if (r.ok || r.statut === 409 || r.statut === 422) setCle(nouvelleCle());
    if (r.ok) {
      setMontant("");
      setMotif("");
      await apresRemboursement();
    }
    await charger();
    setEnvoi(false);
  }

  return (
    <div className="ges-fiche ges-fiche-commande">
      <p>
        <strong>
          N° {f.numero}, {f.client_prenom} {f.client_nom}
        </strong>
        <br />
        <a href={`tel:${f.client_telephone.replace(/[^+\d]/g, "")}`}>{f.client_telephone}</a>
        {f.mode === "livraison" && f.adresse && (
          <>
            <br />
            {f.adresse.rue} {f.adresse.numero}, {f.adresse.npa} {f.adresse.localite}
          </>
        )}
      </p>
      <ul className="ges-lignes-commande">
        {f.lignes.map((l, i) => (
          <li key={i}>
            {l.qte} × {l.nom}, {chf(l.total_centimes)}
            {l.note ? ` « ${l.note} »` : ""}
          </li>
        ))}
        {f.frais_centimes > 0 && <li>Livraison, {chf(f.frais_centimes)}</li>}
      </ul>
      <p>
        <strong>Total {chf(f.total_centimes)}</strong>, {PAIEMENT[f.statut_paiement] ?? f.statut_paiement}.
        {f.rembourse_centimes > 0 ? ` Déjà remboursé : ${chf(f.rembourse_centimes)}.` : ""}
        {f.motif && (f.statut === "refusee" || f.statut === "terminee") ? ` Motif : ${f.motif}` : ""}
      </p>

      <details>
        <summary>Historique</summary>
        <ul className="ges-lignes-commande">
          <li>
            Reçue le {jourTexte(jourGeneveDe(f.cree_le))} à {heureDe(f.cree_le)}
          </li>
          {f.evenements.map((e, i) => (
            <li key={i}>
              {jourTexte(jourGeneveDe(e.le))} à {heureDe(e.le)}, {EVENEMENT[e.vers] ?? e.vers}
              {e.detail && (e.vers === "refusee" || e.vers === "remboursement") ? ` (${e.detail})` : ""}, {e.par.replace(/^(tablette|gestion):/, "")}
            </li>
          ))}
        </ul>
      </details>

      {f.remboursements.length > 0 && (
        <ul className="ges-lignes-commande">
          {f.remboursements.map((r) => (
            <li key={r.id}>
              {chf(r.montant_centimes)} {r.moyen === "especes" ? "rendus en espèces" : "par Stripe"},{" "}
              {r.statut === "fait" ? "fait" : r.statut === "en_cours" ? "en cours" : `échoué${r.erreur ? ` (${r.erreur})` : ""}`}. {r.motif} {r.personnel_nom}, le {jourTexte(jourGeneveDe(r.cree_le))}.
              {r.statut === "en_cours" && Date.now() - new Date(r.cree_le).getTime() > 60_000 && (
                <>
                  {" "}
                  <button type="button" className="lien" disabled={envoi} onClick={() => relancer(r)}>
                    Relancer
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {remboursable ? (
        <form className="ges-remboursement" onSubmit={rembourser}>
          <h3>Rembourser</h3>
          <div className="details deux">
            <div className="champ">
              <label htmlFor={`${ids}-montant`}>Montant à rembourser (CHF)</label>
              <input id={`${ids}-montant`} inputMode="decimal" required value={montant} onChange={(e) => setMontant(e.target.value)} />
              <button type="button" className="lien" onClick={() => setMontant((reste / 100).toFixed(2))}>
                Tout ce qui reste, {chf(reste)}
              </button>
            </div>
            <div className="champ">
              <label htmlFor={`${ids}-motif`}>Motif</label>
              <input id={`${ids}-motif`} required minLength={3} maxLength={200} value={motif} onChange={(e) => setMotif(e.target.value)} />
              <p className="aide">{enLigne ? "Le client reçoit ce motif par e-mail." : "Payée au comptoir : rendez l'argent en espèces, le site le note."}</p>
            </div>
          </div>
          <button type="submit" className="bouton-principal" disabled={envoi || !montant.trim() || motif.trim().length < 3}>
            {envoi ? "Remboursement…" : `Rembourser${montant.trim() ? ` CHF ${montant.trim()}` : ""}`}
          </button>
        </form>
      ) : (
        ["nouvelle", "acceptee", "en_preparation"].includes(f.statut) && <p className="aide">Pas encore prête : pour l&apos;annuler, utilisez « Annuler la commande » sur la tablette.</p>
      )}
      {message && (
        <p className={message.ok ? "tab-message" : "panier-alerte"} role={message.ok ? "status" : "alert"}>
          {message.texte}
        </p>
      )}
    </div>
  );
}
