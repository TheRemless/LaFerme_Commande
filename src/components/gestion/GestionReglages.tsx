"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BarreEnregistrer,
  Champ,
  Chargement,
  EtatErreur,
  useFormulaire,
  useNotifier,
} from "@/components/gestion/ui";
import { poster, type Reponse } from "@/lib/requete-client";
import "./reglages.css";

// Rubrique « Réglages généraux » du back-office (vague 3, bo-operations) : des valeurs que le gérant devait
// faire changer par un développeur. Données : /api/gestion/service (champ generaux). Doc : docs/reglages-generaux.md.

type Generaux = {
  plafond_codes_clients_jour: number | null;
  creneau_minutes: number | null;
  avance_jours: number | null;
  alerte_email: string | null;
  annulation_client_active: boolean;
  plats_populaires_actifs?: boolean;
  suggestion_panier_active?: boolean;
  rythme?: Partial<Record<CleRythme, number>>;
  interrupteurs?: {
    cle: string;
    libelle: string;
    aide: string | null;
    valeur: boolean;
  }[];
};
type Charge = {
  allongement_minutes: number;
  raison: string | null;
  pizza: { articles: number; compte: boolean };
  cuisine: { articles: number; compte: boolean };
  // Version 2 : absent tant que la base n'a pas charge_livraison (migration 20261130210000).
  livraison?: { livreurs: number; compte: boolean };
} | null;
type CleRythme =
  | "debit_pizza_quart_heure"
  | "debit_cuisine_quart_heure"
  | "livraisons_par_livreur_heure"
  | "allongement_max_minutes"
  | "fourchette_livraison_minutes"
  | "fourchette_retrait_minutes";
const RYTHME: {
  cle: CleRythme;
  libelle: string;
  aide: string;
  min: number;
  max: number;
}[] = [
  {
    cle: "debit_pizza_quart_heure",
    libelle: "Pizzas que le four sort en 15 minutes",
    aide: "0 : le four n'est pas compté. Au départ 0, en attente du chiffre de Jérémy.",
    min: 0,
    max: 100,
  },
  {
    cle: "debit_cuisine_quart_heure",
    libelle: "Plats que la cuisine sort en 15 minutes",
    aide: "0 : la cuisine n'est pas comptée. Au départ 0, en attente du chiffre de Jérémy.",
    min: 0,
    max: 100,
  },
  {
    cle: "livraisons_par_livreur_heure",
    libelle: "Livraisons qu'un livreur fait en une heure",
    aide: "Aller et retour compris. Avec les livreurs prévus ce service (rubrique Livreurs), donne l'attente d'un livreur. 0 : les livraisons ne sont pas comptées. Au départ 0, en attente du chiffre de Jérémy.",
    min: 0,
    max: 20,
  },
  {
    cle: "allongement_max_minutes",
    libelle: "Heures annoncées : minutes en plus, au plus",
    aide: "Ce que la file ou l'attente d'un livreur peut ajouter aux heures annoncées, au maximum.",
    min: 0,
    max: 90,
  },
  {
    cle: "fourchette_livraison_minutes",
    libelle: "Fourchette annoncée en livraison (min)",
    aide: "« Entre 19h40 et 19h55 » : 15. 0 : une seule heure.",
    min: 0,
    max: 60,
  },
  {
    cle: "fourchette_retrait_minutes",
    libelle: "Fourchette annoncée au retrait (min)",
    aide: "0 : une seule heure.",
    min: 0,
    max: 60,
  },
];
// « En ce moment » du bloc Rythme : la raison quand les heures s'allongent, sinon ce qui est compté ou pas.
function maintenant(charge: Charge): string {
  if (charge === null) return "file pas lue.";
  if (charge.raison) return charge.raison;
  const cuisine =
    charge.pizza.compte || charge.cuisine.compte
      ? "la file ne retarde rien."
      : "la file n'est pas comptée (débits à 0).";
  const l = charge.livraison;
  if (!l) return cuisine;
  const livraison = l.compte
    ? "Les livreurs suivent."
    : l.livreurs === 0
      ? "Livraisons pas comptées (aucun livreur prévu ce service)."
      : "Livraisons pas comptées (débit à 0).";
  return `${cuisine} ${livraison}`;
}

// Valeurs du formulaire : du texte pour les champs à saisir, comme l'écran les montre.
type Valeurs = {
  alerte_email: string;
  plafond: string;
  creneau: string;
  avance: string;
  annulation: boolean;
  populaires: boolean;
  suggestion: boolean;
  // Interrupteurs déclarés en base, par clé (oui ou non).
  oui: Record<string, boolean>;
} & Record<CleRythme, string>;

const CRENEAUX = [10, 15, 20, 30];
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

function versValeurs(g: Generaux): Valeurs {
  return {
    alerte_email: g.alerte_email ?? "",
    plafond: String(g.plafond_codes_clients_jour ?? ""),
    creneau: String(g.creneau_minutes ?? 15),
    avance: String(g.avance_jours ?? ""),
    annulation: g.annulation_client_active,
    populaires: g.plats_populaires_actifs ?? false,
    suggestion: g.suggestion_panier_active ?? false,
    ...(Object.fromEntries(
      RYTHME.map((r) => [r.cle, String(g.rythme?.[r.cle] ?? "")]),
    ) as Record<CleRythme, string>),
    oui: Object.fromEntries(
      (g.interrupteurs ?? []).map((i) => [i.cle, i.valeur]),
    ),
  };
}

const entier = (v: string, min: number, max: number) =>
  /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max;

function valider(v: Valeurs): Partial<Record<keyof Valeurs, string>> {
  const e: Partial<Record<keyof Valeurs, string>> = {};
  if (v.alerte_email.trim() && !EMAIL.test(v.alerte_email.trim()))
    e.alerte_email = "Une adresse e-mail, ou rien pour garder celle du site.";
  if (!entier(v.plafond, 20, 450)) e.plafond = "Un nombre de 20 à 450.";
  if (!entier(v.avance, 0, 14)) e.avance = "Un nombre de jours de 0 à 14.";
  for (const r of RYTHME)
    if (v[r.cle] !== "" && !entier(v[r.cle], r.min, r.max))
      e[r.cle] = `Un nombre de ${r.min} à ${r.max}.`;
  return e;
}

export function GestionReglages() {
  const [generaux, setGeneraux] = useState<Generaux | null>(null);
  const [charge, setCharge] = useState<Charge>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = useCallback(async () => {
    setErreur(null);
    try {
      const r = await fetch("/api/gestion/service", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(String(d.erreur ?? "Réglages indisponibles."));
      if (!d.generaux)
        throw new Error(
          "Réglages pas encore installés : la base doit être mise à jour (migration 20261130130000).",
        );
      setGeneraux(d.generaux);
      setCharge(d.charge ?? null);
    } catch (e) {
      setErreur(
        e instanceof Error
          ? e.message
          : "Réglages indisponibles. Vérifiez le réseau.",
      );
    }
  }, []);
  useEffect(() => {
    charger();
  }, [charger]);

  if (erreur) return <EtatErreur texte={erreur} reessayer={charger} />;
  if (!generaux) return <Chargement libelle="Chargement des réglages…" />;
  return <Formulaire generaux={generaux} charge={charge} recharger={charger} />;
}

function Formulaire({
  generaux,
  charge,
  recharger,
}: {
  generaux: Generaux;
  charge: Charge;
  recharger: () => Promise<void>;
}) {
  const notifier = useNotifier();
  const initiales = versValeurs(generaux);
  const f = useFormulaire<Valeurs>(initiales, {
    valider,
    // Un réglage par appel, seulement ceux qui ont changé ; le premier refus arrête et s'affiche.
    enregistrer: async (v) => {
      const changes: [string, unknown][] = [];
      if (v.alerte_email.trim() !== initiales.alerte_email)
        changes.push(["alerte_email", v.alerte_email.trim() || null]);
      if (v.plafond !== initiales.plafond)
        changes.push(["plafond_codes_clients_jour", Number(v.plafond)]);
      if (v.creneau !== initiales.creneau)
        changes.push(["creneau_minutes", Number(v.creneau)]);
      if (v.avance !== initiales.avance)
        changes.push(["avance_jours", Number(v.avance)]);
      if (generaux.interrupteurs) {
        for (const [cle, oui] of Object.entries(v.oui))
          if (oui !== initiales.oui[cle]) changes.push([cle, oui]);
      } else {
        // Base pas encore migrée (20261130190000) : les trois cases d'avant.
        if (v.annulation !== initiales.annulation)
          changes.push(["annulation_client_active", v.annulation]);
        if (v.populaires !== initiales.populaires)
          changes.push(["plats_populaires_actifs", v.populaires]);
        if (v.suggestion !== initiales.suggestion)
          changes.push(["suggestion_panier_active", v.suggestion]);
      }
      for (const r of RYTHME)
        if (v[r.cle] !== initiales[r.cle] && v[r.cle] !== "")
          changes.push([r.cle, Number(v[r.cle])]);
      let r: Reponse = { ok: true, statut: 200, donnees: {} };
      for (const [cle, valeur] of changes) {
        r = await poster("/api/gestion/service", {
          type: "reglage-general",
          cle,
          valeur,
        });
        if (!r.ok) break;
      }
      return r;
    },
    apres: () => {
      notifier({ texte: "Réglages enregistrés.", ton: "succes" });
      recharger();
    },
  });
  const v = f.valeurs;

  return (
    <form className="bo-reg" onSubmit={f.soumettre} noValidate>
      <fieldset className="bo-reg-groupe">
        <legend>Alertes</legend>
        <Champ
          libelle="E-mail qui reçoit les alertes"
          aide="Commande pas acceptée, tablette muette, client absent, remboursement raté. Vide : l'adresse réglée lors de l'installation du site."
          erreur={f.erreurs.alerte_email}
          facultatif
        >
          {(a) => (
            <input
              {...a}
              type="email"
              autoComplete="email"
              value={v.alerte_email}
              onChange={(e) => f.changer("alerte_email", e.target.value)}
            />
          )}
        </Champ>
      </fieldset>

      <fieldset className="bo-reg-groupe">
        <legend>Commandes des clients</legend>
        <Champ
          libelle="Longueur d'un créneau"
          aide="Les heures proposées au client. À changer un jour sans réservation, jamais pendant un service : la capacité se compte par créneau."
        >
          {(a) => (
            <select
              {...a}
              value={v.creneau}
              onChange={(e) => f.changer("creneau", e.target.value)}
            >
              {CRENEAUX.map((c) => (
                <option key={c} value={String(c)}>
                  {c} minutes
                </option>
              ))}
            </select>
          )}
        </Champ>
        <Champ
          libelle="Commande à l'avance, jours au plus"
          aide="0 : seulement le jour même."
          erreur={f.erreurs.avance}
        >
          {(a) => (
            <input
              {...a}
              inputMode="numeric"
              value={v.avance}
              onChange={(e) => f.changer("avance", e.target.value)}
            />
          )}
        </Champ>
        {!generaux.interrupteurs && (
          <div className="bo-reg-case">
            <label>
              <input
                type="checkbox"
                checked={v.annulation}
                onChange={(e) => f.changer("annulation", e.target.checked)}
              />
              <span>Le client peut annuler sa commande depuis son suivi</span>
            </label>
            <p className="aide">
              Tant que la commande n&apos;est pas acceptée. Remboursée en
              entier. Décochée au départ, en attente de la décision de Jérémy.
            </p>
          </div>
        )}
      </fieldset>

      {generaux.interrupteurs && generaux.interrupteurs.length > 0 && (
        <fieldset className="bo-reg-groupe">
          <legend>Ce que le site propose aux clients</legend>
          {generaux.interrupteurs.map((i) => (
            <div key={i.cle} className="bo-reg-case">
              <label>
                <input
                  type="checkbox"
                  checked={v.oui[i.cle] ?? false}
                  onChange={(e) =>
                    f.changer("oui", { ...v.oui, [i.cle]: e.target.checked })
                  }
                />
                <span>{i.libelle}</span>
              </label>
              {i.aide && <p className="aide">{i.aide}</p>}
            </div>
          ))}
        </fieldset>
      )}

      {!generaux.interrupteurs &&
        generaux.plats_populaires_actifs !== undefined && (
          <fieldset className="bo-reg-groupe">
            <legend>Carte et panier</legend>
            <div className="bo-reg-case">
              <label>
                <input
                  type="checkbox"
                  checked={v.populaires}
                  onChange={(e) => f.changer("populaires", e.target.checked)}
                />
                <span>« Les plus commandés » en tête de la carte</span>
              </label>
              <p className="aide">
                Les plats les plus commandés des 28 derniers jours. Décochée au
                départ, en attente de la décision de Jérémy.
              </p>
            </div>
            <div className="bo-reg-case">
              <label>
                <input
                  type="checkbox"
                  checked={v.suggestion}
                  onChange={(e) => f.changer("suggestion", e.target.checked)}
                />
                <span>Proposer une boisson ou un dessert au panier</span>
              </label>
              <p className="aide">
                Le plus commandé de sa catégorie. Décochée au départ, en attente
                de la décision de Jérémy.
              </p>
            </div>
          </fieldset>
        )}

      {generaux.rythme && (
        <fieldset className="bo-reg-groupe">
          <legend>Rythme de la cuisine et des livraisons</legend>
          <p className="aide">
            Quand la file du four ou de la cuisine dépasse la préparation
            habituelle, les heures annoncées aux clients s&apos;allongent
            d&apos;elles-mêmes, jusqu&apos;au maximum réglé ici. En livraison,
            l&apos;attente d&apos;un livreur compte aussi.
          </p>
          <p className="bo-reg-maintenant" role="status">
            En ce moment : {maintenant(charge)}
          </p>
          {/* Un réglage absent de la base (migration pas encore passée) ne s'affiche pas. */}
          {RYTHME.filter((r) => generaux.rythme?.[r.cle] !== undefined).map((r) => (
            <Champ
              key={r.cle}
              libelle={r.libelle}
              aide={r.aide}
              erreur={f.erreurs[r.cle]}
            >
              {(a) => (
                <input
                  {...a}
                  inputMode="numeric"
                  value={v[r.cle]}
                  onChange={(e) => f.changer(r.cle, e.target.value)}
                />
              )}
            </Champ>
          ))}
        </fieldset>
      )}

      <fieldset className="bo-reg-groupe">
        <legend>Connexion des clients</legend>
        <Champ
          libelle="Codes de connexion envoyés par jour, au plus"
          aide="La boîte d'envoi du restaurant envoie 500 e-mails par jour au plus, confirmations de commande comprises. Une fois ce nombre atteint, plus de code jusqu'au lendemain."
          erreur={f.erreurs.plafond}
        >
          {(a) => (
            <input
              {...a}
              inputMode="numeric"
              value={v.plafond}
              onChange={(e) => f.changer("plafond", e.target.value)}
            />
          )}
        </Champ>
      </fieldset>

      <BarreEnregistrer
        etat={f.etat}
        message={f.message}
        modifie={f.modifie}
        reinitialiser={f.reinitialiser}
      />
    </form>
  );
}
