"use client";

import { useCallback, useEffect, useState } from "react";
import { FicheCommande } from "@/components/gestion/commandes/FicheCommande";
import { jourCourt } from "@/components/gestion/commandes/libelles";
import {
  BarreEnregistrer,
  Champ,
  Chargement,
  Chronologie,
  ErreurLisible,
  EtatErreur,
  montant,
  PanneauLateral,
  TableauDonnees,
  useFormulaire,
  useNotifier,
  useRelecture,
  type Colonne,
} from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";

// Réclamations des clients (vague 3, bo-commandes) suivies comme des dossiers : les ouvertes d'abord, un fil
// par dossier, un geste (remboursement déjà fait, rien, ou plat offert si Jérémy l'active), une clôture motivée.

export const TYPES: Record<string, string> = {
  manquant: "Il manque quelque chose",
  froid: "Arrivée froide",
  retard: "Retard",
  erreur: "Erreur dans la commande",
  qualite: "Qualité",
  livraison: "Livraison",
  autre: "Autre",
};
const ETAT: Record<string, string> = {
  ouverte: "Ouverte",
  en_cours: "En cours",
  close: "Close",
};
const SOURCE: Record<string, string> = {
  telephone: "téléphone",
  sur_place: "sur place",
  email: "e-mail",
  suivi: "suivi du client",
};
const GESTE: Record<string, string> = {
  remboursement: "Remboursement",
  plat_offert: "Offert la prochaine fois",
  aucun: "Pas de geste",
};

type Ligne = {
  id: string;
  commande_id: string | null;
  numero: number | null;
  client: string;
  source: string;
  type: string;
  description: string;
  statut: string;
  geste: string | null;
  cree_par: string;
  cree_le: string;
};
type Page = {
  total: number;
  compteurs: Record<string, number>;
  lignes: Ligne[];
};
const PAR_PAGE = 50;

const COLONNES: Colonne<Ligne>[] = [
  {
    cle: "cree_le",
    titre: "Reçue le",
    valeur: (l) => jourCourt(l.cree_le),
    fixe: true,
  },
  { cle: "client", titre: "Client", valeur: (l) => l.client, fixe: true },
  {
    cle: "commande",
    titre: "Commande",
    valeur: (l) => (l.numero ? `N° ${l.numero}` : ""),
  },
  {
    cle: "type",
    titre: "Ce qui ne va pas",
    valeur: (l) => TYPES[l.type] ?? l.type,
  },
  { cle: "statut", titre: "État", valeur: (l) => ETAT[l.statut] ?? l.statut },
  {
    cle: "geste",
    titre: "Geste",
    valeur: (l) => (l.geste ? GESTE[l.geste] : ""),
  },
  {
    cle: "source",
    titre: "Reçue par",
    valeur: (l) => SOURCE[l.source] ?? l.source,
    cacheeParDefaut: true,
  },
  {
    cle: "description",
    titre: "Description",
    valeur: (l) => l.description,
    cacheeParDefaut: true,
  },
];

export function ListeReclamations() {
  const [statuts, setStatuts] = useState<string[]>(["ouverte", "en_cours"]);
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [ouverte, setOuverte] = useState<Ligne | null>(null);
  const corps = {
    action: "liste",
    ...(statuts.length ? { statuts } : {}),
    ...(type ? { types: [type] } : {}),
    page,
    par_page: PAR_PAGE,
  };
  const { donnees, erreur, chargement, recharger } = useRelecture<Page>(
    async () => {
      const r = await poster("/api/gestion/reclamations", corps);
      if (!r.ok)
        throw new ErreurLisible(
          String(r.donnees.erreur ?? "La liste n'a pas pu être chargée."),
        );
      return r.donnees as unknown as Page;
    },
    [corps],
    { intervalleMs: 60_000 },
  );
  const compteurs = donnees?.compteurs ?? {};
  function basculer(s: string) {
    setStatuts((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]));
    setPage(1);
  }
  return (
    <div className="bo-commandes">
      <div className="bo-pastilles" role="group" aria-label="Filtrer par état">
        {["ouverte", "en_cours", "close"].map((s) => (
          <button
            key={s}
            type="button"
            className="bo-pastille"
            aria-pressed={statuts.includes(s)}
            onClick={() => basculer(s)}
          >
            {ETAT[s]} <span className="bo-pastille-n">{compteurs[s] ?? 0}</span>
          </button>
        ))}
      </div>
      <TableauDonnees<Ligne>
        titre="Réclamations"
        colonnes={COLONNES}
        lignes={donnees?.lignes ?? null}
        cleLigne={(l) => l.id}
        chargement={chargement && donnees !== null}
        erreur={erreur}
        onReessayer={recharger}
        pagination={{
          page,
          parPage: PAR_PAGE,
          total: donnees?.total ?? 0,
          onPage: setPage,
        }}
        filtres={
          <div className="bo-filtres-ligne">
            <label>
              Ce qui ne va pas
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Tout</option>
                {Object.entries(TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
        onOuvrir={setOuverte}
        memoire="reclamations"
        vide={{
          titre: "Aucune réclamation ici.",
          texte:
            "Une réclamation se note depuis la fiche d'une commande, ou arrive du suivi du client.",
        }}
      />
      {ouverte && (
        <PanneauLateral
          large
          titre={TYPES[ouverte.type] ?? "Réclamation"}
          sousTitre={`${ouverte.client}${ouverte.numero ? `, commande ${ouverte.numero}` : ""}`}
          onFermer={() => setOuverte(null)}
        >
          <FicheReclamation id={ouverte.id} onChange={recharger} />
        </PanneauLateral>
      )}
    </div>
  );
}

type Fiche = Ligne & {
  geste_detail: string | null;
  resolution: string | null;
  close_par: string | null;
  close_le: string | null;
  commande: {
    id: string;
    numero: number;
    jour_service: string;
    statut: string;
    mode: string;
    total_centimes: number;
    client_prenom: string;
    client_nom: string;
    client_telephone: string;
  } | null;
  suivis: { par: string; texte: string; le: string }[];
  remboursements: {
    id: string;
    montant_centimes: number;
    motif: string;
    statut: string;
    cree_le: string;
  }[];
  autres: number;
  gestes_actifs: boolean;
};

function FicheReclamation({
  id,
  onChange,
}: {
  id: string;
  onChange: () => void;
}) {
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [commande, setCommande] = useState(false);
  const charger = useCallback(async () => {
    const r = await poster("/api/gestion/reclamations", {
      action: "fiche",
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
  const apres = useCallback(async () => {
    await charger();
    onChange();
  }, [charger, onChange]);
  const [n, setN] = useState(0);

  if (erreur) return <EtatErreur texte={erreur} reessayer={charger} />;
  if (!fiche) return <Chargement lignes={5} />;
  if (commande && fiche.commande) {
    return (
      <div className="bo-fiche-commande">
        <button
          type="button"
          className="bo-bouton bo-bouton-discret"
          onClick={() => setCommande(false)}
        >
          Retour à la réclamation
        </button>
        <FicheCommande id={fiche.commande.id} onChange={apres} />
      </div>
    );
  }
  const fait = async () => {
    setN((x) => x + 1);
    await apres();
  };
  return (
    <div className="bo-fiche-commande">
      <dl className="bo-fiche-etat">
        <div>
          <dt>État</dt>
          <dd>
            <strong>{ETAT[fiche.statut]}</strong>
          </dd>
        </div>
        <div>
          <dt>Reçue</dt>
          <dd>
            {jourCourt(fiche.cree_le)}, par{" "}
            {SOURCE[fiche.source] ?? fiche.source}
          </dd>
        </div>
        <div>
          <dt>Geste</dt>
          <dd>
            {fiche.geste
              ? `${GESTE[fiche.geste]}${fiche.geste_detail ? ` : ${fiche.geste_detail}` : ""}`
              : "Aucun pour l'instant"}
          </dd>
        </div>
      </dl>
      <div className="bo-fiche-sections">
        <section aria-labelledby="frc-plainte">
          <h3 id="frc-plainte">Ce que dit le client</h3>
          <p className="bo-note-texte">{fiche.description}</p>
          {fiche.commande && (
            <p>
              <button
                type="button"
                className="bo-lien"
                onClick={() => setCommande(true)}
              >
                Ouvrir la commande {fiche.commande.numero}
              </button>{" "}
              <span className="bo-champ-aide">
                ({fiche.commande.client_prenom} {fiche.commande.client_nom},{" "}
                {fiche.commande.client_telephone}, CHF{" "}
                {montant(fiche.commande.total_centimes)})
              </span>
            </p>
          )}
          {fiche.autres > 0 && (
            <p className="bo-champ-aide">
              Ce client a {fiche.autres} autre{fiche.autres > 1 ? "s" : ""}{" "}
              réclamation{fiche.autres > 1 ? "s" : ""}.
            </p>
          )}
        </section>
        <section aria-labelledby="frc-fil">
          <h3 id="frc-fil">Suivi</h3>
          <Chronologie
            ordre="ancien-d-abord"
            evenements={fiche.suivis.map((s, i) => ({
              cle: `${s.le}-${i}`,
              quand: s.le,
              titre: s.texte.replace(/\.$/, ""),
              par: s.par === "client" ? "le client" : s.par,
            }))}
          />
        </section>
        {fiche.statut !== "close" && !fiche.geste && (
          <Geste key={`g${n}`} fiche={fiche} fait={fait} />
        )}
        <Suivre key={`s${n}-${fiche.statut}`} fiche={fiche} fait={fait} />
      </div>
    </div>
  );
}

function Suivre({ fiche, fait }: { fiche: Fiche; fait: () => Promise<void> }) {
  const notifier = useNotifier();
  const close = fiche.statut === "close";
  const f = useFormulaire(
    { texte: "", statut: "", resolution: "" },
    {
      valider: (v) => ({
        ...(v.statut === "close" && v.resolution.trim().length < 3
          ? { resolution: "Écrivez comment elle s'est réglée." }
          : {}),
        ...(!v.statut && !v.texte.trim()
          ? { texte: "Écrivez un mot ou choisissez un nouvel état." }
          : {}),
      }),
      enregistrer: (v) =>
        poster("/api/gestion/reclamations", {
          action: "suivre",
          id: fiche.id,
          ...(v.texte.trim() ? { texte: v.texte } : {}),
          ...(v.statut ? { statut: v.statut } : {}),
          ...(v.statut === "close" ? { resolution: v.resolution } : {}),
        }),
      apres: async () => {
        notifier({ texte: "Enregistré.", ton: "succes" });
        await fait();
      },
    },
  );
  return (
    <section aria-labelledby="frc-suivre">
      <h3 id="frc-suivre">{close ? "Rouvrir" : "Suivre"}</h3>
      <form onSubmit={f.soumettre} noValidate className="bo-fiche-form">
        <Champ
          libelle="Un mot pour le dossier"
          facultatif
          erreur={f.erreurs.texte}
        >
          {(a) => (
            <textarea
              {...a}
              rows={2}
              maxLength={500}
              value={f.valeurs.texte}
              onChange={(e) => f.changer("texte", e.target.value)}
            />
          )}
        </Champ>
        <Champ libelle="Nouvel état">
          {(a) => (
            <select
              {...a}
              value={f.valeurs.statut}
              onChange={(e) => f.changer("statut", e.target.value)}
            >
              <option value="">Ne pas changer</option>
              {close ? (
                <option value="ouverte">Rouvrir</option>
              ) : (
                <>
                  {fiche.statut === "ouverte" && (
                    <option value="en_cours">En cours (prise en charge)</option>
                  )}
                  <option value="close">Close</option>
                </>
              )}
            </select>
          )}
        </Champ>
        {f.valeurs.statut === "close" && (
          <Champ
            libelle="Comment elle s'est réglée"
            erreur={f.erreurs.resolution}
          >
            {(a) => (
              <input
                {...a}
                maxLength={500}
                value={f.valeurs.resolution}
                onChange={(e) => f.changer("resolution", e.target.value)}
              />
            )}
          </Champ>
        )}
        <BarreEnregistrer
          etat={f.etat}
          message={f.message}
          modifie={f.modifie}
          reinitialiser={f.reinitialiser}
          libelle="Enregistrer"
        />
      </form>
    </section>
  );
}

function Geste({ fiche, fait }: { fiche: Fiche; fait: () => Promise<void> }) {
  const notifier = useNotifier();
  const remboursables = fiche.remboursements.filter(
    (r) => r.statut !== "echec",
  );
  const f = useFormulaire(
    { geste: "", remboursement_id: remboursables[0]?.id ?? "", detail: "" },
    {
      valider: (v) =>
        !v.geste
          ? { geste: "Choisissez un geste." }
          : v.geste === "remboursement"
            ? v.remboursement_id
              ? {}
              : {
                  remboursement_id:
                    "Faites d'abord le remboursement depuis la commande (onglet « Gestes »).",
                }
            : v.detail.trim().length >= 3
              ? {}
              : {
                  detail:
                    v.geste === "plat_offert"
                      ? "Dites ce qui est offert."
                      : "Dites pourquoi.",
                },
      enregistrer: (v) =>
        poster("/api/gestion/reclamations", {
          action: "geste",
          id: fiche.id,
          geste: v.geste,
          ...(v.geste === "remboursement"
            ? { remboursement_id: v.remboursement_id }
            : { detail: v.detail }),
        }),
      apres: async () => {
        notifier({ texte: "Geste noté.", ton: "succes" });
        await fait();
      },
    },
  );
  return (
    <section aria-labelledby="frc-geste">
      <h3 id="frc-geste">Geste</h3>
      <form onSubmit={f.soumettre} noValidate className="bo-fiche-form">
        <Champ libelle="Geste pour le client" erreur={f.erreurs.geste}>
          {(a) => (
            <select
              {...a}
              value={f.valeurs.geste}
              onChange={(e) => f.changer("geste", e.target.value)}
            >
              <option value="">Choisir…</option>
              <option value="remboursement">Un remboursement déjà fait</option>
              <option value="aucun">Pas de geste</option>
              {fiche.gestes_actifs && (
                <option value="plat_offert">
                  Offert à la prochaine commande
                </option>
              )}
            </select>
          )}
        </Champ>
        {f.valeurs.geste === "" ? null : f.valeurs.geste === "remboursement" ? (
          <Champ
            libelle="Remboursement"
            aide="Un remboursement se fait depuis la commande, onglet « Gestes ». Ici, on le relie au dossier."
            erreur={f.erreurs.remboursement_id}
          >
            {(a) => (
              <select
                {...a}
                value={f.valeurs.remboursement_id}
                onChange={(e) => f.changer("remboursement_id", e.target.value)}
              >
                {remboursables.length === 0 && (
                  <option value="">
                    Aucun remboursement sur cette commande
                  </option>
                )}
                {remboursables.map((r) => (
                  <option key={r.id} value={r.id}>
                    CHF {montant(r.montant_centimes)}, {r.motif}
                  </option>
                ))}
              </select>
            )}
          </Champ>
        ) : (
          <Champ
            libelle={
              f.valeurs.geste === "plat_offert"
                ? "Ce qui est offert"
                : "Pourquoi"
            }
            erreur={f.erreurs.detail}
          >
            {(a) => (
              <input
                {...a}
                maxLength={200}
                value={f.valeurs.detail}
                onChange={(e) => f.changer("detail", e.target.value)}
              />
            )}
          </Champ>
        )}
        {!fiche.gestes_actifs && (
          <p className="bo-champ-aide">
            « Offert à la prochaine commande » n&apos;est pas encore activé :
            c&apos;est une décision du restaurant.
          </p>
        )}
        <BarreEnregistrer
          etat={f.etat}
          message={f.message}
          modifie={f.modifie}
          reinitialiser={f.reinitialiser}
          libelle="Noter le geste"
        />
      </form>
    </section>
  );
}
