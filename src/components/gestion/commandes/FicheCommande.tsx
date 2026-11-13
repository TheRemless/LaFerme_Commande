"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  auteur,
  evenementTexte,
  heureCourte,
  jourCourt,
  MODE,
  PAIEMENT,
  STATUT,
  type Evenement,
} from "@/components/gestion/commandes/libelles";
import {
  BarreEnregistrer,
  Champ,
  Chargement,
  Chronologie,
  EtatErreur,
  montant,
  Onglets,
  useConfirmer,
  useFormulaire,
  useNotifier,
} from "@/components/gestion/ui";
import { nouvelleCle } from "@/lib/cle";
import { jourGeneveDe } from "@/lib/heures";
import { depuisHeureGeneve } from "@/lib/service";
import { poster } from "@/lib/requete-client";

// Fiche d'une commande dans le panneau latéral : tout ce que l'équipe doit savoir quand le client appelle
// (« où est ma commande », « il manque le tiramisù », « je me suis trompé d'étage »), et les gestes permis.
// Tout vient de fiche_commande_gestion ; chaque geste repasse par le serveur, qui revérifie tout en base.

type Adresse = { rue: string; numero: string; npa: string; localite: string };
type Details = {
  sonnette: string;
  etage: string;
  code: string;
  instructions: string;
};
type Ligne = {
  position: number;
  nom: string;
  qte: number;
  unitaire_centimes: number;
  total_centimes: number;
  choix: Record<string, string[]>;
  prix_choix: Record<string, Record<string, number>> | null;
  retraits: string[];
  note: string;
};
type Fiche = {
  id: string;
  numero: number;
  jour_service: string;
  cree_le: string;
  mode: "livraison" | "retrait";
  statut: string;
  statut_paiement: string;
  moyen_paiement: string;
  client_prenom: string;
  client_nom: string;
  client_telephone: string;
  client_email: string;
  adresse: Adresse | null;
  details_livraison: Details | null;
  sous_total_centimes: number;
  frais_centimes: number;
  total_centimes: number;
  tva_centimes: number;
  rembourse_centimes: number;
  motif: string | null;
  stripe_payment_intent: string | null;
  compte_id: string | null;
  heure_prevue: string | null;
  quand_type: string;
  retard_minutes: number | null;
  zone: { numero: number; nom: string } | null;
  livreur: {
    nom: string;
    attribuee_le: string;
    probleme: string | null;
    probleme_detail: string | null;
  } | null;
  lignes: Ligne[];
  courriels: {
    id: string;
    sujet: string;
    destinataire: string;
    envoye_le: string;
    fournisseur: string;
  }[];
  tickets: {
    id: string;
    station: string;
    etat: string;
    reimpression: boolean;
    cree_le: string;
    imprime_le: string | null;
    erreur: string | null;
  }[];
  notes: {
    id: number;
    texte: string;
    personnel_nom: string;
    cree_le: string;
  }[];
  remboursements: {
    id: string;
    cle: string;
    montant_centimes: number;
    motif: string;
    moyen: string;
    statut: string;
    erreur: string | null;
    personnel_nom: string;
    cree_le: string;
  }[];
  client: {
    commandes: number;
    refusees: number;
    depense_centimes: number;
    premiere_le: string;
    derniere_le: string;
  } | null;
  chronologie: Evenement[];
  reclamations?: {
    id: string;
    type: string;
    description: string;
    statut: string;
    source: string;
    geste: string | null;
    cree_par: string;
    cree_le: string;
  }[];
};

// Message d'une réponse du serveur, qu'il réponde { message } (gestes) ou { erreur } (refus).
const messageDe = (r: { donnees: Record<string, unknown> }, defaut: string) =>
  String(r.donnees.message ?? r.donnees.erreur ?? defaut);

const REMBOURSABLE = ["prete", "partie", "terminee"];
const HEURE_MODIFIABLE = ["acceptee", "en_preparation", "prete", "partie"];
const IMPRIMABLE = [
  "acceptee",
  "en_preparation",
  "prete",
  "partie",
  "terminee",
];
const ANNULABLE = ["nouvelle", "acceptee", "en_preparation", "partie"];
const MODIFIABLE = [
  "nouvelle",
  "acceptee",
  "en_preparation",
  "prete",
  "partie",
];

export function FicheCommande({
  id,
  onChange,
}: {
  id: string;
  onChange: () => void;
}) {
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [onglet, setOnglet] = useState("resume");

  const charger = useCallback(async () => {
    const r = await poster("/api/gestion/commandes", {
      action: "fiche_complete",
      id,
    });
    if (r.ok) {
      setFiche(r.donnees as unknown as Fiche);
      setErreur(null);
    } else
      setErreur(
        String(r.donnees.erreur ?? "La fiche n'a pas pu être chargée."),
      );
  }, [id]);
  useEffect(() => {
    charger();
  }, [charger]);

  const apresGeste = useCallback(async () => {
    await charger();
    onChange();
  }, [charger, onChange]);

  if (erreur) return <EtatErreur texte={erreur} reessayer={charger} />;
  if (!fiche) return <Chargement lignes={6} />;

  return (
    <div className="bo-fiche-commande">
      <Etat fiche={fiche} />
      <Onglets
        libelle="Parties de la fiche"
        actif={onglet}
        onChange={setOnglet}
        onglets={[
          { cle: "resume", titre: "Commande" },
          {
            cle: "historique",
            titre: "Historique",
            badge: fiche.chronologie.length || undefined,
          },
          {
            cle: "courriels",
            titre: "E-mails",
            badge: fiche.courriels.length || undefined,
          },
          {
            cle: "notes",
            titre: "Notes",
            badge: fiche.notes.length || undefined,
          },
          { cle: "gestes", titre: "Gestes" },
          {
            cle: "reclamations",
            titre: "Réclamations",
            badge: fiche.reclamations?.length || undefined,
          },
        ]}
      >
        {onglet === "resume" && <Resume fiche={fiche} />}
        {onglet === "reclamations" && (
          <Reclamations fiche={fiche} apres={apresGeste} />
        )}
        {onglet === "historique" && (
          <Chronologie
            ordre="ancien-d-abord"
            vide="Rien n'est encore arrivé à cette commande."
            evenements={fiche.chronologie.map((e, i) => {
              const t = evenementTexte(e);
              return {
                cle: `${e.type}-${e.le}-${i}`,
                quand: e.le,
                titre: t.titre,
                detail: t.detail,
                par: e.par ? auteur(e.par) : undefined,
                important:
                  e.type === "remboursement" ||
                  (e.type === "statut" && e.vers === "refusee"),
              };
            })}
          />
        )}
        {onglet === "courriels" && (
          <Courriels fiche={fiche} apres={apresGeste} />
        )}
        {onglet === "notes" && <Notes fiche={fiche} apres={apresGeste} />}
        {onglet === "gestes" && <Gestes fiche={fiche} apres={apresGeste} />}
      </Onglets>
    </div>
  );
}

// En tête : ce qu'on dit au téléphone, sans chercher.
function Etat({ fiche }: { fiche: Fiche }) {
  const heure = fiche.heure_prevue
    ? heureCourte(fiche.heure_prevue)
    : "dès que possible";
  return (
    <dl className="bo-fiche-etat">
      <div>
        <dt>Statut</dt>
        <dd>
          <strong>{STATUT[fiche.statut] ?? fiche.statut}</strong>
          {fiche.retard_minutes && fiche.retard_minutes > 0 ? (
            <span> (retard {fiche.retard_minutes} min)</span>
          ) : null}
        </dd>
      </div>
      <div>
        <dt>
          {fiche.mode === "livraison" ? "Livraison prévue" : "Retrait prévu"}
        </dt>
        <dd>
          {heure}, {jourCourt(fiche.heure_prevue ?? fiche.cree_le)}
        </dd>
      </div>
      <div>
        <dt>Paiement</dt>
        <dd>
          {PAIEMENT[fiche.statut_paiement] ?? fiche.statut_paiement}, CHF{" "}
          {montant(fiche.total_centimes)}
          {fiche.rembourse_centimes > 0 && (
            <span>
              , dont CHF {montant(fiche.rembourse_centimes)} remboursés
            </span>
          )}
        </dd>
      </div>
      {fiche.livreur && (
        <div>
          <dt>Livreur</dt>
          <dd>
            {fiche.livreur.nom}, depuis{" "}
            {heureCourte(fiche.livreur.attribuee_le)}
            {fiche.livreur.probleme && (
              <span>
                {" "}
                : problème signalé (
                {fiche.livreur.probleme_detail ?? fiche.livreur.probleme})
              </span>
            )}
          </dd>
        </div>
      )}
      {fiche.motif && fiche.statut === "refusee" && (
        <div>
          <dt>Motif</dt>
          <dd>{fiche.motif}</dd>
        </div>
      )}
    </dl>
  );
}

function optionsLigne(l: Ligne): string[] {
  const out: string[] = [];
  for (const [groupe, noms] of Object.entries(l.choix ?? {})) {
    for (const n of noms) {
      const prix = l.prix_choix?.[groupe]?.[n];
      out.push(prix ? `+ ${n} (CHF ${montant(prix)})` : `+ ${n}`);
    }
  }
  for (const r of l.retraits ?? []) out.push(`SANS ${r}`);
  return out;
}

function Resume({ fiche }: { fiche: Fiche }) {
  const d = fiche.details_livraison;
  return (
    <div className="bo-fiche-sections">
      <section aria-labelledby="fc-lignes">
        <h3 id="fc-lignes">Contenu</h3>
        <table className="bo-fiche-lignes">
          <thead>
            <tr>
              <th scope="col">Plat</th>
              <th scope="col" className="bo-nombre">
                Qté
              </th>
              <th scope="col" className="bo-nombre">
                CHF
              </th>
            </tr>
          </thead>
          <tbody>
            {fiche.lignes.map((l) => (
              <tr key={l.position}>
                <td>
                  {l.nom}
                  {optionsLigne(l).map((o) => (
                    <span key={o} className="bo-fiche-option">
                      {o}
                    </span>
                  ))}
                  {l.note && (
                    <span className="bo-fiche-option">Note : {l.note}</span>
                  )}
                </td>
                <td className="bo-nombre">{l.qte}</td>
                <td className="bo-nombre">{montant(l.total_centimes)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {fiche.frais_centimes > 0 && (
              <tr>
                <td colSpan={2}>
                  Livraison{fiche.zone ? ` (${fiche.zone.nom})` : ""}
                </td>
                <td className="bo-nombre">{montant(fiche.frais_centimes)}</td>
              </tr>
            )}
            <tr>
              <th scope="row" colSpan={2}>
                Total payé
              </th>
              <td className="bo-nombre">
                <strong>{montant(fiche.total_centimes)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section aria-labelledby="fc-client">
        <h3 id="fc-client">Client</h3>
        <p>
          {fiche.client_prenom} {fiche.client_nom}
          {fiche.compte_id ? ", avec compte" : ", sans compte"}
        </p>
        <p>
          <a
            className="bo-lien"
            href={`tel:${fiche.client_telephone.replace(/[^\d+]/g, "")}`}
          >
            {fiche.client_telephone}
          </a>
        </p>
        <p>{fiche.client_email}</p>
        {fiche.client && fiche.client.commandes > 1 && (
          <p className="bo-champ-aide">
            {fiche.client.commandes} commandes depuis le{" "}
            {jourCourt(fiche.client.premiere_le)}, CHF{" "}
            {montant(fiche.client.depense_centimes)} en tout
            {fiche.client.refusees > 0
              ? `, ${fiche.client.refusees} refusée${fiche.client.refusees > 1 ? "s" : ""}`
              : ""}
            .
          </p>
        )}
      </section>

      {fiche.mode === "livraison" && fiche.adresse && (
        <section aria-labelledby="fc-adresse">
          <h3 id="fc-adresse">Adresse</h3>
          <p>
            {fiche.adresse.rue} {fiche.adresse.numero}, {fiche.adresse.npa}{" "}
            {fiche.adresse.localite}
          </p>
          {d && (
            <p>
              Sonnette : {d.sonnette}
              {d.etage && `, étage ${d.etage}`}
              {d.code && `, code ${d.code}`}
            </p>
          )}
          {d?.instructions && <p>Instructions : {d.instructions}</p>}
        </section>
      )}
      {fiche.mode === "retrait" && (
        <section aria-labelledby="fc-retrait">
          <h3 id="fc-retrait">{MODE.retrait}</h3>
          <p>Au comptoir, Route de Chancy 132.</p>
        </section>
      )}

      <section aria-labelledby="fc-tickets">
        <h3 id="fc-tickets">Tickets</h3>
        {fiche.tickets.length === 0 ? (
          <p className="bo-champ-aide">Pas encore imprimés.</p>
        ) : (
          <ul className="bo-fiche-liste">
            {fiche.tickets.map((t) => (
              <li key={t.id}>
                {t.station === "pizza" ? "Pizza" : "Cuisine"}
                {t.reimpression ? " (réimpression)" : ""} :{" "}
                {t.etat === "imprimee"
                  ? `imprimé à ${heureCourte(t.imprime_le)}`
                  : t.etat === "echec"
                    ? `pas imprimé${t.erreur ? ` (${t.erreur})` : ""}`
                    : t.etat === "sans_imprimante"
                      ? "à l'écran de la tablette"
                      : "en attente"}
              </li>
            ))}
          </ul>
        )}
      </section>

      {fiche.stripe_payment_intent && (
        <section aria-labelledby="fc-stripe">
          <h3 id="fc-stripe">Stripe</h3>
          <p className="bo-champ-aide">
            Paiement : <code>{fiche.stripe_payment_intent}</code>
          </p>
        </section>
      )}
    </div>
  );
}

function Courriels({
  fiche,
  apres,
}: {
  fiche: Fiche;
  apres: () => Promise<void>;
}) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  async function renvoyer(m: { id: string; sujet: string }) {
    const ok = await confirmer({
      titre: "Renvoyer cet e-mail ?",
      texte: `« ${m.sujet} » repart tel quel à ${fiche.client_email}, avec « (nouvel envoi) » dans le sujet.`,
      oui: "Renvoyer l'e-mail",
    });
    if (!ok) return;
    const r = await poster("/api/gestion/commandes", {
      action: "renvoyer_courriel",
      id: fiche.id,
      courriel: m.id,
    });
    notifier({
      texte: messageDe(r, "L'e-mail n'est pas parti."),
      ton: r.ok ? "succes" : "erreur",
    });
    if (r.ok) await apres();
  }
  const [ouvert, setOuvert] = useState<{ id: string; texte: string } | null>(
    null,
  );
  const [erreur, setErreur] = useState<string | null>(null);
  async function lire(courriel: string) {
    if (ouvert?.id === courriel) return setOuvert(null);
    const r = await poster("/api/gestion/commandes", {
      action: "courriel",
      id: fiche.id,
      courriel,
    });
    if (r.ok) {
      setOuvert({ id: courriel, texte: String(r.donnees.texte ?? "") });
      setErreur(null);
    } else setErreur(String(r.donnees.erreur ?? "E-mail illisible."));
  }
  if (fiche.courriels.length === 0)
    return (
      <p className="bo-etat-texte">Aucun e-mail envoyé pour cette commande.</p>
    );
  return (
    <ul className="bo-fiche-liste">
      {fiche.courriels.map((m) => (
        <li key={m.id}>
          <p>
            <strong>{m.sujet}</strong>
          </p>
          <p className="bo-champ-aide">
            {jourCourt(m.envoye_le)} à {heureCourte(m.envoye_le)}, à{" "}
            {m.destinataire}
            {m.fournisseur === "doublure" ? " (copie locale, pas envoyé)" : ""}
          </p>
          <button
            type="button"
            className="bo-bouton bo-bouton-second bo-bouton-petit"
            aria-expanded={ouvert?.id === m.id}
            onClick={() => lire(m.id)}
          >
            {ouvert?.id === m.id ? "Fermer" : "Lire"}
          </button>{" "}
          <button
            type="button"
            className="bo-bouton bo-bouton-discret bo-bouton-petit"
            onClick={() => renvoyer(m)}
          >
            Renvoyer au client
          </button>
          {ouvert?.id === m.id && (
            <pre className="bo-courriel-texte">{ouvert.texte}</pre>
          )}
        </li>
      ))}
      {erreur && <li className="bo-champ-erreur">{erreur}</li>}
    </ul>
  );
}

function Notes({ fiche, apres }: { fiche: Fiche; apres: () => Promise<void> }) {
  // Un formulaire neuf après chaque note : le champ repart vide, sans « changements non enregistrés ».
  const [n, setN] = useState(0);
  return (
    <div className="bo-fiche-sections">
      <NouvelleNote
        key={n}
        commande={fiche.id}
        fait={async () => {
          setN((x) => x + 1);
          await apres();
        }}
      />
      {fiche.notes.length > 0 && (
        <ul className="bo-fiche-liste">
          {[...fiche.notes].reverse().map((note) => (
            <li key={note.id}>
              <p className="bo-note-texte">{note.texte}</p>
              <p className="bo-champ-aide">
                {note.personnel_nom}, {jourCourt(note.cree_le)} à{" "}
                {heureCourte(note.cree_le)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NouvelleNote({
  commande,
  fait,
}: {
  commande: string;
  fait: () => Promise<void>;
}) {
  const notifier = useNotifier();
  const f = useFormulaire(
    { texte: "" },
    {
      valider: (v) =>
        v.texte.trim().length < 2
          ? { texte: "Écrivez au moins deux caractères." }
          : {},
      enregistrer: (v) =>
        poster("/api/gestion/commandes", {
          action: "noter",
          id: commande,
          texte: v.texte,
        }),
      apres: async () => {
        notifier({ texte: "Note ajoutée.", ton: "succes" });
        await fait();
      },
    },
  );
  return (
    <form onSubmit={f.soumettre} noValidate>
      <Champ
        libelle="Nouvelle note"
        aide="Lue par l'équipe seulement, jamais montrée au client. 500 caractères au plus."
        erreur={f.erreurs.texte}
      >
        {(a) => (
          <textarea
            {...a}
            rows={3}
            maxLength={500}
            value={f.valeurs.texte}
            onChange={(e) => f.changer("texte", e.target.value)}
          />
        )}
      </Champ>
      <BarreEnregistrer
        etat={f.etat}
        message={f.message}
        modifie={f.modifie}
        reinitialiser={f.reinitialiser}
        libelle="Ajouter la note"
      />
    </form>
  );
}

// Gestes permis selon l'état : modifier les coordonnées, rembourser en partie après la remise.
function Gestes({
  fiche,
  apres,
}: {
  fiche: Fiche;
  apres: () => Promise<void>;
}) {
  // Les remboursements en cours comptent déjà : la base les réserve (S2-04).
  const reserve = fiche.remboursements
    .filter((r) => r.statut === "fait" || r.statut === "en_cours")
    .reduce((t, r) => t + r.montant_centimes, 0);
  const reste = fiche.total_centimes - reserve;
  return (
    <div className="bo-fiche-sections">
      {HEURE_MODIFIABLE.includes(fiche.statut) && (
        <ChangerHeure
          key={fiche.heure_prevue ?? "asap"}
          fiche={fiche}
          apres={apres}
        />
      )}
      {IMPRIMABLE.includes(fiche.statut) && (
        <Reimprimer fiche={fiche} apres={apres} />
      )}
      {MODIFIABLE.includes(fiche.statut) ? (
        <Modifier fiche={fiche} apres={apres} />
      ) : (
        <p className="bo-champ-aide">
          Une commande terminée ou annulée ne se modifie plus.
        </p>
      )}
      {REMBOURSABLE.includes(fiche.statut) &&
      reste > 0 &&
      fiche.statut_paiement !== "a_encaisser_retrait" ? (
        <Rembourser
          key={fiche.remboursements.length}
          fiche={fiche}
          reste={reste}
          apres={apres}
        />
      ) : (
        <p className="bo-champ-aide">
          {fiche.statut === "refusee"
            ? "Une commande refusée se rembourse en entier depuis la tablette."
            : reste <= 0
              ? "Tout est déjà remboursé."
              : "Rembourser en partie se fait une fois la commande prête, partie ou terminée."}
        </p>
      )}
      {fiche.remboursements.length > 0 && (
        <section aria-labelledby="fc-remb">
          <h3 id="fc-remb">Remboursements</h3>
          <ul className="bo-fiche-liste">
            {fiche.remboursements.map((r) => (
              <li key={r.id}>
                CHF {montant(r.montant_centimes)}{" "}
                {r.moyen === "especes" ? "en espèces" : "par Stripe"},{" "}
                {r.statut === "fait"
                  ? "fait"
                  : r.statut === "echec"
                    ? `échoué${r.erreur ? ` (${r.erreur})` : ""}`
                    : "en cours"}{" "}
                : {r.motif}
                <span className="bo-champ-aide">
                  {" "}
                  ({auteur(`gestion:${r.personnel_nom}`)},{" "}
                  {jourCourt(r.cree_le)})
                </span>
                {r.statut === "en_cours" &&
                  r.moyen === "stripe" &&
                  (Date.now() - Date.parse(r.cree_le) < 23 * 3_600_000 ? (
                    <Relancer fiche={fiche} r={r} apres={apres} />
                  ) : (
                    <span className="bo-champ-aide">
                      {" "}
                      Plus de 23 heures : vérifiez dans Stripe s&apos;il est
                      passé avant de rembourser à nouveau.
                    </span>
                  ))}
              </li>
            ))}
          </ul>
        </section>
      )}
      {ANNULABLE.includes(fiche.statut) && (
        <Annuler key={fiche.statut} fiche={fiche} apres={apres} />
      )}
      <Recreer fiche={fiche} />
    </div>
  );
}

function Modifier({
  fiche,
  apres,
}: {
  fiche: Fiche;
  apres: () => Promise<void>;
}) {
  const notifier = useNotifier();
  const d = fiche.details_livraison ?? {
    sonnette: "",
    etage: "",
    code: "",
    instructions: "",
  };
  const a = fiche.adresse ?? { rue: "", numero: "", npa: "", localite: "" };
  const initiales = {
    prenom: fiche.client_prenom,
    nom: fiche.client_nom,
    telephone: fiche.client_telephone,
    sonnette: d.sonnette,
    etage: d.etage,
    code: d.code,
    instructions: d.instructions,
    rue: a.rue,
    numero: a.numero,
    npa: a.npa,
    localite: a.localite,
  };
  const f = useFormulaire(initiales, {
    valider: (v) => ({
      ...(v.prenom.trim() ? {} : { prenom: "Le prénom est obligatoire." }),
      ...(v.nom.trim() ? {} : { nom: "Le nom est obligatoire." }),
      ...((v.telephone.match(/\d/g) ?? []).length >= 9
        ? {}
        : { telephone: "Il faut au moins neuf chiffres." }),
      ...(fiche.mode === "livraison" && !v.sonnette.trim()
        ? { sonnette: "Le nom sur la sonnette est obligatoire." }
        : {}),
      ...(fiche.mode === "livraison" && !/^\d{4}$/.test(v.npa.trim())
        ? { npa: "Un NPA à quatre chiffres." }
        : {}),
    }),
    // N'envoie que ce qui a changé : la base ne journalise que cela, et l'adresse repasse par le registre fédéral.
    enregistrer: (v) => {
      const corps: Record<string, unknown> = {
        action: "modifier",
        id: fiche.id,
        de: fiche.statut,
      };
      if (v.prenom !== initiales.prenom) corps.prenom = v.prenom;
      if (v.nom !== initiales.nom) corps.nom = v.nom;
      if (v.telephone !== initiales.telephone) corps.telephone = v.telephone;
      if (fiche.mode === "livraison") {
        if (
          ["sonnette", "etage", "code", "instructions"].some(
            (k) =>
              v[k as keyof typeof v] !== initiales[k as keyof typeof initiales],
          )
        ) {
          corps.details = {
            sonnette: v.sonnette,
            etage: v.etage,
            code: v.code,
            instructions: v.instructions,
          };
        }
        if (
          ["rue", "numero", "npa", "localite"].some(
            (k) =>
              v[k as keyof typeof v] !== initiales[k as keyof typeof initiales],
          )
        ) {
          corps.adresse = {
            rue: v.rue,
            numero: v.numero,
            npa: v.npa,
            localite: v.localite,
          };
        }
      }
      return poster("/api/gestion/commandes", corps);
    },
    apres: async (r) => {
      notifier({
        texte: String(r.donnees.message ?? "Commande modifiée."),
        ton: "succes",
      });
      await apres();
    },
  });
  const champ = (
    k: keyof typeof initiales,
    libelle: string,
    o: {
      aide?: string;
      facultatif?: boolean;
      type?: string;
      mode?: "tel" | "numeric";
    } = {},
  ) => (
    <Champ
      libelle={libelle}
      aide={o.aide}
      facultatif={o.facultatif}
      erreur={f.erreurs[k]}
    >
      {(attrs) => (
        <input
          {...attrs}
          type={o.type ?? "text"}
          inputMode={o.mode}
          value={f.valeurs[k]}
          onChange={(e) => f.changer(k, e.target.value)}
        />
      )}
    </Champ>
  );
  return (
    <section aria-labelledby="fc-modifier">
      <h3 id="fc-modifier">Modifier à la demande du client</h3>
      <p className="bo-champ-aide">
        Le montant ne change pas. Le client reçoit un e-mail avec ce qui a
        changé.
      </p>
      <form onSubmit={f.soumettre} noValidate className="bo-fiche-form">
        <fieldset>
          <legend>Client</legend>
          {champ("prenom", "Prénom")}
          {champ("nom", "Nom")}
          {champ("telephone", "Téléphone", { type: "tel", mode: "tel" })}
        </fieldset>
        {fiche.mode === "livraison" && (
          <>
            <fieldset>
              <legend>Consignes de livraison</legend>
              {champ("sonnette", "Nom sur la sonnette")}
              {champ("etage", "Étage", { facultatif: true })}
              {champ("code", "Code de la porte", { facultatif: true })}
              {champ("instructions", "Instructions au livreur", {
                facultatif: true,
              })}
            </fieldset>
            <fieldset>
              <legend>Adresse</legend>
              <p className="bo-champ-aide">
                Seulement dans la même zone de livraison : l&apos;adresse est
                vérifiée dans le registre fédéral.
              </p>
              {champ("rue", "Rue")}
              {champ("numero", "Numéro", { facultatif: true })}
              {champ("npa", "NPA", { mode: "numeric" })}
              {champ("localite", "Localité")}
            </fieldset>
          </>
        )}
        <BarreEnregistrer
          etat={f.etat}
          message={f.message}
          modifie={f.modifie}
          reinitialiser={f.reinitialiser}
          libelle="Enregistrer les changements"
        />
      </form>
    </section>
  );
}

function Rembourser({
  fiche,
  reste,
  apres,
}: {
  fiche: Fiche;
  reste: number;
  apres: () => Promise<void>;
}) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  // Une clé par geste : un double appui ou une reprise après coupure ne rembourse pas deux fois.
  const cle = useRef(nouvelleCle());
  const f = useFormulaire(
    { montant: "", motif: "" },
    {
      valider: (v) => {
        const n = Number(v.montant.replace(",", "."));
        return {
          ...(Number.isFinite(n) && n > 0 && Math.round(n * 100) <= reste
            ? {}
            : { montant: `Un montant en francs, jusqu'à ${montant(reste)}.` }),
          ...(v.motif.trim().length >= 3
            ? {}
            : {
                motif:
                  "Écrivez un motif (3 caractères au moins). Le client le reçoit.",
              }),
        };
      },
      // Un remboursement ne se défait pas : confirmation avec le montant et le moyen.
      enregistrer: async (v) => {
        const chf = Number(v.montant.replace(",", ".")).toFixed(2);
        const ok = await confirmer({
          titre: `Rembourser CHF ${chf} ?`,
          texte:
            fiche.moyen_paiement === "comptoir"
              ? "À rendre en espèces au client. Il ne reçoit pas d'e-mail."
              : `Remboursé par Stripe sur le moyen de paiement du client, qui reçoit un e-mail avec le motif.`,
          oui: `Rembourser CHF ${chf}`,
          danger: true,
        });
        if (!ok)
          return {
            ok: false,
            statut: 0,
            donnees: { erreur: "Pas remboursé." },
          };
        return poster("/api/gestion/commandes", {
          action: "rembourser",
          id: fiche.id,
          montant: v.montant,
          motif: v.motif,
          cle: cle.current,
        });
      },
      apres: async (r) => {
        cle.current = nouvelleCle();
        notifier({
          texte: String(r.donnees.message ?? "Remboursement fait."),
          ton: "succes",
        });
        await apres();
      },
    },
  );
  return (
    <section aria-labelledby="fc-rembourser">
      <h3 id="fc-rembourser">Rembourser une partie</h3>
      <form onSubmit={f.soumettre} noValidate className="bo-fiche-form">
        <Champ
          libelle="Montant à rembourser (CHF)"
          aide={`Il reste CHF ${montant(reste)} à rembourser au plus.`}
          erreur={f.erreurs.montant}
        >
          {(a) => (
            <input
              {...a}
              inputMode="decimal"
              value={f.valeurs.montant}
              onChange={(e) => f.changer("montant", e.target.value)}
            />
          )}
        </Champ>
        <div>
          <button
            type="button"
            className="bo-bouton bo-bouton-discret bo-bouton-petit"
            onClick={() => f.changer("montant", (reste / 100).toFixed(2))}
          >
            Tout ce qui reste (CHF {montant(reste)})
          </button>
        </div>
        <Champ
          libelle="Motif"
          aide="Le client le reçoit par e-mail."
          erreur={f.erreurs.motif}
        >
          {(a) => (
            <input
              {...a}
              maxLength={200}
              value={f.valeurs.motif}
              onChange={(e) => f.changer("motif", e.target.value)}
            />
          )}
        </Champ>
        <BarreEnregistrer
          etat={f.etat}
          message={f.message}
          modifie={f.modifie}
          reinitialiser={f.reinitialiser}
          libelle="Rembourser"
        />
      </form>
    </section>
  );
}

// Reprend un remboursement resté « en cours » avec SA clé : Stripe reconnaît le même geste et ne rembourse
// pas deux fois (audit de sécurité 2, S2-04), même après avoir fermé la fiche.
function Relancer({
  fiche,
  r,
  apres,
}: {
  fiche: Fiche;
  r: Fiche["remboursements"][number];
  apres: () => Promise<void>;
}) {
  const notifier = useNotifier();
  const [envoi, setEnvoi] = useState(false);
  async function relancer() {
    setEnvoi(true);
    const rep = await poster("/api/gestion/commandes", {
      action: "rembourser",
      id: fiche.id,
      montant: (r.montant_centimes / 100).toFixed(2),
      motif: r.motif,
      cle: r.cle,
    });
    setEnvoi(false);
    notifier({
      texte: messageDe(rep, "Le remboursement n'est pas encore passé."),
      ton: rep.ok ? "succes" : "erreur",
    });
    await apres();
  }
  return (
    <button
      type="button"
      className="bo-bouton bo-bouton-second bo-bouton-petit"
      disabled={envoi}
      onClick={relancer}
    >
      {envoi ? "Relance…" : "Relancer ce remboursement"}
    </button>
  );
}

// Nouvelle heure promise : le client reçoit un e-mail, comme depuis la tablette.
function ChangerHeure({
  fiche,
  apres,
}: {
  fiche: Fiche;
  apres: () => Promise<void>;
}) {
  const notifier = useNotifier();
  const base = fiche.heure_prevue ?? new Date().toISOString();
  const initiales = { jour: jourGeneveDe(base), heure: heureCourte(base) };
  const f = useFormulaire(initiales, {
    valider: (v) =>
      /^\d{2}:\d{2}$/.test(v.heure) && depuisHeureGeneve(`${v.jour}T${v.heure}`)
        ? {}
        : { heure: "Une heure comme 20:30." },
    enregistrer: (v) =>
      poster("/api/gestion/commandes", {
        action: "heure",
        id: fiche.id,
        heure: depuisHeureGeneve(`${v.jour}T${v.heure}`)?.toISOString(),
      }),
    apres: async (r) => {
      notifier({ texte: messageDe(r, "Heure changée."), ton: "succes" });
      await apres();
    },
  });
  return (
    <section aria-labelledby="fc-heure">
      <h3 id="fc-heure">Changer l&apos;heure</h3>
      <form onSubmit={f.soumettre} noValidate className="bo-fiche-form">
        <div className="bo-fiche-deux">
          <Champ libelle="Jour" erreur={f.erreurs.jour}>
            {(a) => (
              <input
                {...a}
                type="date"
                value={f.valeurs.jour}
                onChange={(e) => f.changer("jour", e.target.value)}
              />
            )}
          </Champ>
          <Champ
            libelle="Heure"
            aide="Le client reçoit un e-mail avec la nouvelle heure."
            erreur={f.erreurs.heure}
          >
            {(a) => (
              <input
                {...a}
                type="time"
                step={300}
                value={f.valeurs.heure}
                onChange={(e) => f.changer("heure", e.target.value)}
              />
            )}
          </Champ>
        </div>
        <BarreEnregistrer
          etat={f.etat}
          message={f.message}
          modifie={f.modifie}
          reinitialiser={f.reinitialiser}
          libelle="Changer l'heure"
        />
      </form>
    </section>
  );
}

function Reimprimer({
  fiche,
  apres,
}: {
  fiche: Fiche;
  apres: () => Promise<void>;
}) {
  const notifier = useNotifier();
  const [envoi, setEnvoi] = useState(false);
  async function imprimer(station?: "pizza" | "cuisine") {
    setEnvoi(true);
    const r = await poster("/api/gestion/commandes", {
      action: "reimprimer",
      id: fiche.id,
      ...(station ? { station } : {}),
    });
    setEnvoi(false);
    notifier({
      texte: messageDe(r, "Pas réimprimé."),
      ton: r.ok ? "succes" : "erreur",
    });
    if (r.ok) await apres();
  }
  const postes = [...new Set(fiche.tickets.map((t) => t.station))];
  return (
    <section aria-labelledby="fc-imprimer">
      <h3 id="fc-imprimer">Réimprimer</h3>
      <div className="bo-fiche-boutons">
        <button
          type="button"
          className="bo-bouton bo-bouton-second"
          disabled={envoi}
          onClick={() => imprimer()}
        >
          Tous les tickets
        </button>
        {postes.includes("pizza") && (
          <button
            type="button"
            className="bo-bouton bo-bouton-second"
            disabled={envoi}
            onClick={() => imprimer("pizza")}
          >
            Ticket pizza
          </button>
        )}
        {postes.includes("cuisine") && (
          <button
            type="button"
            className="bo-bouton bo-bouton-second"
            disabled={envoi}
            onClick={() => imprimer("cuisine")}
          >
            Ticket cuisine
          </button>
        )}
      </div>
    </section>
  );
}

// Annuler : comme « Refuser » sur la tablette. Payée en ligne, remboursée en entier ; tickets « ANNULÉE ».
function Annuler({
  fiche,
  apres,
}: {
  fiche: Fiche;
  apres: () => Promise<void>;
}) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const f = useFormulaire(
    { motif: "" },
    {
      valider: (v) =>
        v.motif.trim().length >= 3
          ? {}
          : {
              motif:
                "Écrivez un motif (3 caractères au moins). Le client le reçoit.",
            },
      enregistrer: async (v) => {
        const paye =
          fiche.moyen_paiement === "en_ligne" &&
          fiche.statut_paiement === "paye";
        const ok = await confirmer({
          titre: `Annuler la commande ${fiche.numero} ?`,
          texte: paye
            ? `Le client est remboursé en entier (CHF ${montant(fiche.total_centimes - fiche.rembourse_centimes)}) et reçoit le motif par e-mail. Cela ne se défait pas.`
            : "Le client reçoit le motif par e-mail. Cela ne se défait pas.",
          oui: "Annuler la commande",
          danger: true,
        });
        if (!ok)
          return { ok: false, statut: 0, donnees: { erreur: "Pas annulée." } };
        const r = await poster("/api/gestion/commandes", {
          action: "annuler",
          id: fiche.id,
          motif: v.motif,
          de: fiche.statut,
        });
        return r.ok
          ? r
          : { ...r, donnees: { erreur: messageDe(r, "Pas annulée.") } };
      },
      apres: async (r) => {
        notifier({ texte: messageDe(r, "Commande annulée."), ton: "succes" });
        await apres();
      },
    },
  );
  return (
    <section aria-labelledby="fc-annuler">
      <h3 id="fc-annuler">Annuler la commande</h3>
      <form onSubmit={f.soumettre} noValidate className="bo-fiche-form">
        <Champ
          libelle="Motif d'annulation"
          aide="Le client le reçoit par e-mail."
          erreur={f.erreurs.motif}
        >
          {(a) => (
            <input
              {...a}
              maxLength={200}
              value={f.valeurs.motif}
              onChange={(e) => f.changer("motif", e.target.value)}
            />
          )}
        </Champ>
        <BarreEnregistrer
          etat={f.etat}
          message={f.message}
          modifie={f.modifie}
          reinitialiser={f.reinitialiser}
          libelle="Annuler la commande"
        />
      </form>
    </section>
  );
}

const TYPES_RECLAMATION: [string, string][] = [
  ["manquant", "Il manque quelque chose"],
  ["froid", "Arrivée froide"],
  ["retard", "Retard"],
  ["erreur", "Erreur dans la commande"],
  ["qualite", "Qualité"],
  ["livraison", "Livraison"],
  ["autre", "Autre"],
];
const ETAT_RECLAMATION: Record<string, string> = {
  ouverte: "Ouverte",
  en_cours: "En cours",
  close: "Close",
};

function Reclamations({
  fiche,
  apres,
}: {
  fiche: Fiche;
  apres: () => Promise<void>;
}) {
  const [n, setN] = useState(0);
  const liste = fiche.reclamations ?? [];
  return (
    <div className="bo-fiche-sections">
      <NouvelleReclamation
        key={n}
        commande={fiche.id}
        fait={async () => {
          setN((x) => x + 1);
          await apres();
        }}
      />
      {liste.length > 0 && (
        <ul className="bo-fiche-liste">
          {liste.map((r) => (
            <li key={r.id}>
              <p>
                <strong>
                  {TYPES_RECLAMATION.find(([k]) => k === r.type)?.[1] ?? r.type}
                </strong>
                , {ETAT_RECLAMATION[r.statut] ?? r.statut}
              </p>
              <p className="bo-note-texte">{r.description}</p>
              <p className="bo-champ-aide">
                {r.cree_par === "client"
                  ? "Envoyée par le client depuis son suivi"
                  : `Notée par ${r.cree_par}`}
                , {jourCourt(r.cree_le)} à {heureCourte(r.cree_le)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NouvelleReclamation({
  commande,
  fait,
}: {
  commande: string;
  fait: () => Promise<void>;
}) {
  const notifier = useNotifier();
  const f = useFormulaire(
    { type: "manquant", source: "telephone", description: "" },
    {
      valider: (v) =>
        v.description.trim().length >= 3
          ? {}
          : { description: "Décrivez la plainte en quelques mots." },
      enregistrer: (v) =>
        poster("/api/gestion/reclamations", {
          action: "ouvrir",
          commande_id: commande,
          type: v.type,
          source: v.source,
          description: v.description,
        }),
      apres: async () => {
        notifier({ texte: "Réclamation notée.", ton: "succes" });
        await fait();
      },
    },
  );
  return (
    <form onSubmit={f.soumettre} noValidate className="bo-fiche-form">
      <div className="bo-fiche-deux">
        <Champ libelle="Ce qui ne va pas">
          {(a) => (
            <select
              {...a}
              value={f.valeurs.type}
              onChange={(e) => f.changer("type", e.target.value)}
            >
              {TYPES_RECLAMATION.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </Champ>
        <Champ libelle="Reçue par">
          {(a) => (
            <select
              {...a}
              value={f.valeurs.source}
              onChange={(e) => f.changer("source", e.target.value)}
            >
              <option value="telephone">Téléphone</option>
              <option value="sur_place">Sur place</option>
              <option value="email">E-mail</option>
            </select>
          )}
        </Champ>
      </div>
      <Champ
        libelle="Ce que dit le client"
        aide="Par exemple : il manque le tiramisù."
        erreur={f.erreurs.description}
      >
        {(a) => (
          <textarea
            {...a}
            rows={2}
            maxLength={500}
            value={f.valeurs.description}
            onChange={(e) => f.changer("description", e.target.value)}
          />
        )}
      </Champ>
      <BarreEnregistrer
        etat={f.etat}
        message={f.message}
        modifie={f.modifie}
        reinitialiser={f.reinitialiser}
        libelle="Noter la réclamation"
      />
    </form>
  );
}

// « La même que vendredi » : une nouvelle commande à emporter, payée au comptoir, aux prix du jour (#98).
// Désactivé tant que Jérémy n'a pas activé commande_telephone_active : le serveur le dit, l'écran l'affiche.
function Recreer({ fiche }: { fiche: Fiche }) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const cle = useRef(nouvelleCle());
  const [envoi, setEnvoi] = useState(false);
  async function recreer() {
    const ok = await confirmer({
      titre: `Recréer la commande ${fiche.numero} ?`,
      texte: `Une nouvelle commande à emporter, dès que possible, payée au comptoir, aux prix du jour, au nom de ${fiche.client_prenom} ${fiche.client_nom}. Elle arrive sur la tablette à accepter.`,
      oui: "Recréer la commande",
    });
    if (!ok) return;
    setEnvoi(true);
    const r = await poster("/api/gestion/commandes", {
      action: "recreer",
      id: fiche.id,
      quand: { type: "asap" },
      cle: cle.current,
    });
    setEnvoi(false);
    if (r.ok) cle.current = nouvelleCle();
    notifier({
      texte: messageDe(r, "Pas recréée."),
      ton: r.ok ? "succes" : "erreur",
    });
  }
  return (
    <section aria-labelledby="fc-recreer">
      <h3 id="fc-recreer">Le client veut la même</h3>
      <p className="bo-champ-aide">
        À emporter, payée au comptoir, aux prix du jour. Pas encore activé si le
        restaurant ne l&apos;a pas décidé.
      </p>
      <button
        type="button"
        className="bo-bouton bo-bouton-second"
        disabled={envoi}
        onClick={recreer}
      >
        {envoi ? "Création…" : "Recréer cette commande"}
      </button>
    </section>
  );
}
