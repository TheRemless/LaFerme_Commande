"use client";

import { useCallback, useEffect, useState } from "react";
import { jourCourt } from "@/components/gestion/commandes/libelles";
import { Chargement, EtatErreur, EtatVide, montant, useConfirmer, useNotifier } from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";
import "./parrainages.css";

// Rubrique Parrainages (vague 3, client-compte ; décision de Jérémy du 19.11.2026). Par parrain : ses filleuls (dates,
// montants, statut), les signaux d'abus détectés par la base, et « Suspendre ce parrain » (motif obligatoire,
// journalisé) qui bloque ses nouveaux crédits sans toucher aux anciens. Gérant seulement.

type Filleul = { email: string; prenom: string | null; nom: string | null; lie_le: string; statut: string; raison: string | null; termine_le: string | null; montant_centimes: number };
type Signal = { id: number; type: string; detail: Record<string, unknown>; le: string; classee_le: string | null; filleul: boolean };
type Parrain = {
  parrain_id: string;
  email: string;
  prenom: string | null;
  nom: string | null;
  suspendu: { motif: string; par: string; le: string } | null;
  filleuls: Filleul[];
  signaux: Signal[];
};

const STATUTS: Record<string, string> = { en_attente: "En attente", credite: "Crédité", refuse: "Refusé" };
const RAISONS: Record<string, string> = {
  telephone: "téléphone déjà vu",
  adresse: "adresse déjà vue",
  paiement: "commande remboursée",
  rembourse: "commande remboursée, crédits repris",
  parrain_suspendu: "parrain suspendu",
};
const SIGNAUX: Record<string, string> = {
  trop_de_filleuls: "Beaucoup de filleuls crédités en 30 jours",
  meme_adresse: "Filleuls à la même adresse de livraison",
  meme_ip: "Filleuls connectés depuis la même adresse IP",
  meme_nom: "Filleuls au même nom",
  sans_suite: "Filleuls qui ne recommandent jamais",
  recu_plus_que_paye: "Plus reçu en parrainage que payé sur 30 jours",
  ip_du_parrain: "Filleul connecté depuis la même adresse IP que son parrain",
  chaine: "Filleul qui parraine à son tour dans les 90 jours",
};

function detailSignal(s: Signal): string {
  const d = s.detail;
  if (s.type === "trop_de_filleuls") return `${d.filleuls_30j} filleuls crédités (seuil ${d.seuil}).`;
  if (s.type === "sans_suite") return `${d.sans_suite} sur ${d.filleuls} sans deuxième commande (${d.pourcent} %).`;
  if (s.type === "recu_plus_que_paye") return `Reçu CHF ${montant(Number(d.recu_centimes))}, payé CHF ${montant(Number(d.paye_centimes))}${s.filleul ? ", chez un filleul" : ""}.`;
  if (s.type === "ip_du_parrain") return d.niveau === 2 ? "Même adresse IP que le parrain de son parrain." : "Même adresse IP que son parrain.";
  if (s.type === "chaine") return `Son filleul crédité ${d.jours} jour${Number(d.jours) > 1 ? "s" : ""} après lui.`;
  if (typeof d.filleuls === "number") return `${d.filleuls} filleuls.`;
  return "";
}

export function GestionParrainages() {
  const [liste, setListe] = useState<Parrain[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = useCallback(async () => {
    try {
      const r = await fetch("/api/gestion/parrainages", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(String(d.erreur ?? "Parrainages indisponibles."));
      setListe(d as Parrain[]);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Parrainages indisponibles.");
    }
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  if (erreur && !liste) return <EtatErreur texte={erreur} reessayer={charger} />;
  if (!liste) return <Chargement libelle="Chargement des parrainages…" />;
  if (liste.length === 0) return <EtatVide titre="Aucun parrainage pour l'instant." />;
  return (
    <div className="bo-parr">
      {liste.map((p) => (
        <FicheParrain key={p.parrain_id} p={p} apres={charger} />
      ))}
    </div>
  );
}

function nomDe(x: { prenom: string | null; nom: string | null; email: string }): string {
  const n = [x.prenom, x.nom].filter(Boolean).join(" ").trim();
  return n || x.email;
}

function FicheParrain({ p, apres }: { p: Parrain; apres: () => Promise<void> }) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const [motif, setMotif] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const titre = `parr-${p.parrain_id}`;
  const ouverts = p.signaux.filter((s) => !s.classee_le);

  async function agir(corps: Record<string, unknown>, succes: string) {
    setEnvoi(true);
    const r = await poster("/api/gestion/parrainages", corps);
    setEnvoi(false);
    notifier({ texte: r.ok ? succes : String(r.donnees.erreur ?? "Pas enregistré."), ton: r.ok ? "succes" : "erreur" });
    if (r.ok) {
      setMotif(null);
      await apres();
    }
  }

  async function reactiver() {
    const ok = await confirmer({ titre: "Réactiver ce parrain ?", texte: "Ses nouveaux filleuls seront de nouveau crédités.", oui: "Réactiver" });
    if (ok) await agir({ action: "reactiver", parrain: p.parrain_id }, "Parrain réactivé.");
  }

  return (
    <section className="bo-parr-fiche" aria-labelledby={titre}>
      <div className="bo-parr-entete">
        <div>
          <h2 id={titre}>{nomDe(p)}</h2>
          <p className="bo-champ-aide">{p.email}</p>
        </div>
        {p.suspendu ? (
          <div className="bo-parr-suspendu">
            <p>
              <strong>Suspendu</strong> le {jourCourt(p.suspendu.le)} ({p.suspendu.par}) : {p.suspendu.motif}
            </p>
            <button type="button" className="bo-bouton bo-bouton-petit" disabled={envoi} onClick={() => void reactiver()}>
              Réactiver ce parrain
            </button>
          </div>
        ) : motif === null ? (
          <button type="button" className="bo-bouton bo-bouton-petit" data-danger="" onClick={() => setMotif("")}>
            Suspendre ce parrain
          </button>
        ) : (
          <form
            className="bo-parr-motif"
            onSubmit={(e) => {
              e.preventDefault();
              void agir({ action: "suspendre", parrain: p.parrain_id, motif }, "Parrain suspendu. Ses anciens crédits restent.");
            }}
          >
            <label htmlFor={`${titre}-motif`}>Pourquoi le suspendre</label>
            <input id={`${titre}-motif`} value={motif} maxLength={200} onChange={(e) => setMotif(e.target.value)} />
            <button type="submit" className="bo-bouton bo-bouton-principal bo-bouton-petit" data-danger="" disabled={envoi || motif.trim().length < 3}>
              Suspendre
            </button>
            <button type="button" className="bo-bouton bo-bouton-discret bo-bouton-petit" onClick={() => setMotif(null)}>
              Annuler
            </button>
          </form>
        )}
      </div>

      {p.signaux.length > 0 && (
        <ul className="bo-parr-signaux">
          {p.signaux.map((s) => (
            <li key={s.id} className={s.classee_le ? "bo-parr-classe" : undefined}>
              <span>
                <strong>{SIGNAUX[s.type] ?? s.type}</strong> <span className="bo-champ-aide">{detailSignal(s)} {jourCourt(s.le)}.</span>
              </span>
              {s.classee_le ? (
                <span className="bo-champ-aide">Classé</span>
              ) : (
                <button type="button" className="bo-bouton bo-bouton-discret bo-bouton-petit" disabled={envoi} onClick={() => void agir({ action: "classer", signal: s.id }, "Signal classé.")}>
                  Classer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <table className="bo-parr-table">
        <caption className="sr-only">Filleuls de {nomDe(p)}</caption>
        <thead>
          <tr>
            <th scope="col">Filleul</th>
            <th scope="col">Lié le</th>
            <th scope="col">Statut</th>
            <th scope="col" className="bo-nombre">
              CHF
            </th>
          </tr>
        </thead>
        <tbody>
          {p.filleuls.map((f) => (
            <tr key={f.email}>
              <td>
                {nomDe(f)}
                <br />
                <span className="bo-champ-aide">{f.email}</span>
              </td>
              <td>{jourCourt(f.lie_le)}</td>
              <td>
                {STATUTS[f.statut] ?? f.statut}
                {f.raison ? <span className="bo-champ-aide"> : {RAISONS[f.raison] ?? f.raison}</span> : null}
              </td>
              <td className="bo-nombre">{montant(f.montant_centimes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ouverts.length > 0 && <p className="sr-only">{ouverts.length} signaux à examiner.</p>}
    </section>
  );
}
