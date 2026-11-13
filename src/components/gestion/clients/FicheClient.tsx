"use client";

import { useCallback, useEffect, useState } from "react";
import { MARQUE } from "@/components/gestion/clients/libelles";
import { FicheCommande } from "@/components/gestion/commandes/FicheCommande";
import {
  heureCourte,
  jourCourt,
  MODE,
  STATUT,
} from "@/components/gestion/commandes/libelles";
import {
  BarreEnregistrer,
  Champ,
  Chargement,
  EtatErreur,
  montant,
  Onglets,
  useConfirmer,
  useFormulaire,
  useNotifier,
} from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";

// Fiche d'un client (vague 3, bo-commandes) : ce que le restaurant sait de lui, ses commandes (ouvrables ici),
// ses remboursements, les notes de l'équipe et, si Jérémy l'active, une marque « à surveiller » ou « bloqué ».

type Adresse = { rue: string; numero: string; npa: string; localite: string };
type Fiche = {
  email: string;
  prenom: string;
  nom: string;
  commandes: number;
  refusees: number;
  servi_centimes: number;
  rembourse_centimes: number;
  panier_moyen_centimes: number | null;
  premiere_le: string;
  derniere_le: string;
  frequence_jours: number | null;
  livraisons: number;
  retraits: number;
  telephones: string[];
  adresses: { adresse: Adresse; fois: number; derniere_le: string }[];
  plats: { nom: string; qte: number }[];
  commandes_liste: {
    id: string;
    numero: number;
    jour_service: string;
    cree_le: string;
    mode: string;
    statut: string;
    statut_paiement: string;
    total_centimes: number;
    rembourse_centimes: number;
  }[];
  remboursements: {
    commande_id: string;
    numero: number;
    montant_centimes: number;
    motif: string;
    statut: string;
    personnel_nom: string;
    cree_le: string;
  }[];
  notes: {
    id: number;
    texte: string;
    personnel_nom: string;
    cree_le: string;
  }[];
  marque: {
    marque: "surveiller" | "bloque";
    motif: string;
    personnel_nom: string;
    le: string;
  } | null;
  marque_active: boolean;
  compte: { cree_le: string; adresses: number } | null;
};

export function FicheClient({
  email,
  onChange,
}: {
  email: string;
  onChange: () => void;
}) {
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [onglet, setOnglet] = useState("resume");
  const [commande, setCommande] = useState<{
    id: string;
    numero: number;
  } | null>(null);

  const charger = useCallback(async () => {
    const r = await poster("/api/gestion/clients", { action: "fiche", email });
    if (r.ok) {
      setFiche(r.donnees as unknown as Fiche);
      setErreur(null);
    } else
      setErreur(
        String(r.donnees.erreur ?? "La fiche n'a pas pu être chargée."),
      );
  }, [email]);
  useEffect(() => {
    charger();
  }, [charger]);
  const apres = useCallback(async () => {
    await charger();
    onChange();
  }, [charger, onChange]);

  if (erreur) return <EtatErreur texte={erreur} reessayer={charger} />;
  if (!fiche) return <Chargement lignes={6} />;

  // Une commande ouverte depuis la fiche du client : sa fiche complète, et le retour au client.
  if (commande) {
    return (
      <div className="bo-fiche-commande">
        <div>
          <button
            type="button"
            className="bo-bouton bo-bouton-discret"
            onClick={() => setCommande(null)}
          >
            Retour à {fiche.prenom} {fiche.nom}
          </button>
          <h3>Commande {commande.numero}</h3>
        </div>
        <FicheCommande id={commande.id} onChange={apres} />
      </div>
    );
  }

  return (
    <div className="bo-fiche-commande">
      <dl className="bo-fiche-etat">
        <div>
          <dt>Commandes</dt>
          <dd>
            <strong>{fiche.commandes}</strong>
            {fiche.refusees > 0 && (
              <span>
                {" "}
                ({fiche.refusees} refusée{fiche.refusees > 1 ? "s" : ""})
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Dépensé</dt>
          <dd>
            CHF {montant(fiche.servi_centimes - fiche.rembourse_centimes)}
            {fiche.panier_moyen_centimes ? (
              <span>
                , panier moyen CHF {montant(fiche.panier_moyen_centimes)}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Dernière commande</dt>
          <dd>
            {jourCourt(fiche.derniere_le)}
            {fiche.frequence_jours ? (
              <span>
                , en moyenne tous les {Math.round(fiche.frequence_jours)} jours
              </span>
            ) : null}
          </dd>
        </div>
        {fiche.marque && fiche.marque_active && (
          <div>
            <dt>Marque</dt>
            <dd>
              <strong>{MARQUE[fiche.marque.marque]}</strong> :{" "}
              {fiche.marque.motif}
            </dd>
          </div>
        )}
      </dl>
      <Onglets
        libelle="Parties de la fiche du client"
        actif={onglet}
        onChange={setOnglet}
        onglets={[
          { cle: "resume", titre: "Client" },
          {
            cle: "commandes",
            titre: "Commandes",
            badge: fiche.commandes_liste.length || undefined,
          },
          {
            cle: "remboursements",
            titre: "Remboursements",
            badge: fiche.remboursements.length || undefined,
          },
          {
            cle: "notes",
            titre: "Notes",
            badge: fiche.notes.length || undefined,
          },
          { cle: "marque", titre: "Marque" },
        ]}
      >
        {onglet === "resume" && <Resume fiche={fiche} />}
        {onglet === "commandes" && (
          <Commandes fiche={fiche} ouvrir={setCommande} />
        )}
        {onglet === "remboursements" && <Remboursements fiche={fiche} />}
        {onglet === "notes" && <Notes fiche={fiche} apres={apres} />}
        {onglet === "marque" && (
          <Marque
            key={JSON.stringify(fiche.marque)}
            fiche={fiche}
            apres={apres}
          />
        )}
      </Onglets>
    </div>
  );
}

function Resume({ fiche }: { fiche: Fiche }) {
  return (
    <div className="bo-fiche-sections">
      <section aria-labelledby="fcl-contact">
        <h3 id="fcl-contact">Contact</h3>
        <p>{fiche.email}</p>
        {fiche.telephones.map((t) => (
          <p key={t}>
            <a className="bo-lien" href={`tel:${t.replace(/[^\d+]/g, "")}`}>
              {t}
            </a>
          </p>
        ))}
        {/* Les dates abrégées finissent déjà par un point (« mer. 10 déc. ») : pas de point final. */}
        <p className="bo-champ-aide">{fiche.compte ? `Compte créé le ${jourCourt(fiche.compte.cree_le)}` : "Sans compte : commandes en invité"}</p>
        <p className="bo-champ-aide">Première commande le {jourCourt(fiche.premiere_le)}</p>
      </section>
      <section aria-labelledby="fcl-habitudes">
        <h3 id="fcl-habitudes">Habitudes</h3>
        <p>
          {fiche.livraisons} livraison{fiche.livraisons > 1 ? "s" : ""},{" "}
          {fiche.retraits} à emporter.
        </p>
        {fiche.plats.length > 0 && (
          <ul className="bo-fiche-liste">
            {fiche.plats.map((p) => (
              <li key={p.nom}>
                {p.nom} <span className="bo-champ-aide">({p.qte} fois)</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {fiche.adresses.length > 0 && (
        <section aria-labelledby="fcl-adresses">
          <h3 id="fcl-adresses">Adresses de livraison</h3>
          <ul className="bo-fiche-liste">
            {fiche.adresses.map((a) => (
              <li key={`${a.adresse.rue}-${a.adresse.numero}-${a.adresse.npa}`}>
                {a.adresse.rue} {a.adresse.numero}, {a.adresse.npa}{" "}
                {a.adresse.localite}
                <span className="bo-champ-aide">
                  {" "}
                  ({a.fois} fois, dernière le {jourCourt(a.derniere_le)})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Commandes({
  fiche,
  ouvrir,
}: {
  fiche: Fiche;
  ouvrir: (c: { id: string; numero: number }) => void;
}) {
  return (
    <table className="bo-fiche-lignes">
      <thead>
        <tr>
          <th scope="col">Commande</th>
          <th scope="col">Statut</th>
          <th scope="col" className="bo-nombre">
            CHF
          </th>
        </tr>
      </thead>
      <tbody>
        {fiche.commandes_liste.map((c) => (
          <tr key={c.id}>
            <td>
              <button
                type="button"
                className="bo-lien"
                onClick={() => ouvrir({ id: c.id, numero: c.numero })}
              >
                N° {c.numero}, {jourCourt(c.cree_le)}
              </button>
              <span className="bo-fiche-option">{MODE[c.mode] ?? c.mode}</span>
            </td>
            <td>{STATUT[c.statut] ?? c.statut}</td>
            <td className="bo-nombre">
              {montant(c.total_centimes)}
              {c.rembourse_centimes > 0 && (
                <span className="bo-fiche-option">
                  −{montant(c.rembourse_centimes)}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Remboursements({ fiche }: { fiche: Fiche }) {
  if (fiche.remboursements.length === 0)
    return <p className="bo-etat-texte">Aucun remboursement pour ce client.</p>;
  return (
    <ul className="bo-fiche-liste">
      {fiche.remboursements.map((r, i) => (
        <li key={`${r.commande_id}-${i}`}>
          CHF {montant(r.montant_centimes)}, commande {r.numero} : {r.motif}
          <span className="bo-champ-aide">
            {" "}
            (
            {r.statut === "fait"
              ? "fait"
              : r.statut === "echec"
                ? "échoué"
                : "en cours"}
            , {r.personnel_nom}, {jourCourt(r.cree_le)})
          </span>
        </li>
      ))}
    </ul>
  );
}

function Notes({ fiche, apres }: { fiche: Fiche; apres: () => Promise<void> }) {
  const [n, setN] = useState(0);
  return (
    <div className="bo-fiche-sections">
      <NouvelleNote
        key={n}
        email={fiche.email}
        fait={async () => {
          setN((x) => x + 1);
          await apres();
        }}
      />
      {fiche.notes.length > 0 && (
        <ul className="bo-fiche-liste">
          {fiche.notes.map((note) => (
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
  email,
  fait,
}: {
  email: string;
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
        poster("/api/gestion/clients", {
          action: "noter",
          email,
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
        libelle="Nouvelle note sur ce client"
        aide="Pour l'équipe, jamais affichée au client. Mais il peut la lire s'il demande ses données : écrivez-la comme s'il la lisait."
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

// Marque « à surveiller » ou « bloqué » : décision de Jérémy (D2), désactivée tant que le réglage est faux.
function Marque({
  fiche,
  apres,
}: {
  fiche: Fiche;
  apres: () => Promise<void>;
}) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const f = useFormulaire(
    {
      marque: fiche.marque?.marque ?? "surveiller",
      motif: fiche.marque?.motif ?? "",
    },
    {
      valider: (v) =>
        v.motif.trim().length >= 3
          ? {}
          : { motif: "Écrivez pourquoi (3 caractères au moins)." },
      enregistrer: (v) =>
        poster("/api/gestion/clients", {
          action: "marquer",
          email: fiche.email,
          marque: v.marque,
          motif: v.motif,
        }),
      apres: async () => {
        notifier({ texte: "Marque enregistrée.", ton: "succes" });
        await apres();
      },
    },
  );
  if (!fiche.marque_active) {
    return (
      <p className="bo-etat-texte">
        Marquer un client « à surveiller » ou « bloqué » n&apos;est pas encore
        activé. C&apos;est une décision du restaurant : elle attend Jérémy.
      </p>
    );
  }
  async function retirer() {
    const ok = await confirmer({
      titre: "Retirer la marque ?",
      texte: `${fiche.prenom} ${fiche.nom} redevient un client sans marque.`,
      oui: "Retirer la marque",
    });
    if (!ok) return;
    const r = await poster("/api/gestion/clients", {
      action: "marquer",
      email: fiche.email,
      marque: null,
    });
    notifier({
      texte: r.ok
        ? "Marque retirée."
        : String(r.donnees.erreur ?? "Pas retirée."),
      ton: r.ok ? "succes" : "erreur",
    });
    if (r.ok) await apres();
  }
  return (
    <div className="bo-fiche-sections">
      {fiche.marque && (
        <p>
          <strong>{MARQUE[fiche.marque.marque]}</strong> depuis le{" "}
          {jourCourt(fiche.marque.le)} ({fiche.marque.personnel_nom}) :{" "}
          {fiche.marque.motif}{" "}
          <button
            type="button"
            className="bo-bouton bo-bouton-discret bo-bouton-petit"
            onClick={retirer}
          >
            Retirer la marque
          </button>
        </p>
      )}
      <form onSubmit={f.soumettre} noValidate className="bo-fiche-form">
        <Champ libelle="Marque">
          {(a) => (
            <select
              {...a}
              value={f.valeurs.marque}
              onChange={(e) =>
                f.changer("marque", e.target.value as "surveiller" | "bloque")
              }
            >
              <option value="surveiller">À surveiller</option>
              <option value="bloque">Bloqué</option>
            </select>
          )}
        </Champ>
        <Champ
          libelle="Pourquoi"
          aide="Des faits : « trois commandes au comptoir jamais retirées ». Le client peut le lire s'il demande ses données."
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
          libelle="Enregistrer la marque"
        />
      </form>
    </div>
  );
}
