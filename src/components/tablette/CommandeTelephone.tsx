"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { FichePlat } from "@/components/carte/FichePlat";
import { chercherAdresses, type Adresse, type Details } from "@/lib/adresse";
import type { Categorie, LignePlat } from "@/lib/carte";
import { nomClient } from "@/lib/nom-plat";
import type { Catalogue, LignePanier } from "@/lib/panier";
import { prixChf } from "@/lib/prix";
import {
  creneaux,
  heureTexte,
  jourTexte,
  type ConfigService,
  type Quand,
  type Zone,
} from "@/lib/service";
import "./telephone.css";

// Commande prise au téléphone (vague 3, bo-commandes) : toute l'équipe, depuis la tablette. On remplit dans
// l'ordre de la conversation : livraison ou à emporter, adresse, plats, heure, client. Les prix, la zone et
// l'heure se vérifient sur le serveur à chaque changement (comme le panier du site) et une dernière fois à
// l'envoi. La commande entre acceptée, avec ses tickets ; elle se paie à la livraison ou au retrait.

type Mode = "livraison" | "retrait";
type Verdict =
  | { statut: "vide" }
  | { statut: "attente" }
  | {
      statut: "livrable";
      adresse: Adresse;
      zone: Pick<Zone, "numero" | "frais_centimes" | "minimum_centimes">;
    }
  | { statut: "refus"; message: string };
type Calcul = {
  sous_total_centimes: number;
  frais_centimes: number;
  total_centimes: number;
  manque_minimum_centimes: number;
  valide: boolean;
  message_quand: string | null;
  pizzas_seulement: boolean;
  lignes: { erreur?: string | null; nom: string; total_centimes: number }[];
};
type Resultat =
  | { ok: true; numero: number; heure: string; message: string }
  | { ok: false; message: string; champ?: string };

const DETAILS_VIDES: Details = {
  sonnette: "",
  etage: "",
  code: "",
  instructions: "",
};

function nouvelleCle(): string {
  return `tel-${crypto.randomUUID()}`;
}

function cleLigne(l: LignePanier): string {
  return JSON.stringify([l.slug, l.choix, l.retraits, l.note]);
}

export function CommandeTelephone({
  categories,
  catalogue,
  config,
  preversion,
}: {
  categories: Categorie[];
  catalogue: Catalogue;
  config: ConfigService;
  preversion: boolean;
}) {
  const ids = useId();
  const [cle, setCle] = useState(nouvelleCle);
  const [mode, setMode] = useState<Mode | null>(null);
  const [saisie, setSaisie] = useState("");
  const [suggestions, setSuggestions] = useState<Adresse[]>([]);
  const [verdict, setVerdict] = useState<Verdict>({ statut: "vide" });
  const [details, setDetails] = useState<Details>(DETAILS_VIDES);
  const [lignes, setLignes] = useState<LignePanier[]>([]);
  const [ouvert, setOuvert] = useState<LignePlat | null>(null);
  const [categorie, setCategorie] = useState(categories[0]?.slug ?? "");
  const [quand, setQuand] = useState<Quand>({ type: "asap" });
  const [client, setClient] = useState({
    prenom: "",
    nom: "",
    telephone: "",
    email: "",
    allergie: "",
  });
  const [calcul, setCalcul] = useState<Calcul | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState<Resultat | null>(null);

  const zone = verdict.statut === "livrable" ? verdict.zone : null;
  const adresse = verdict.statut === "livrable" ? verdict.adresse : null;

  // Suggestions d'adresse (registre fédéral, comme l'accueil du site), dès trois caractères.
  useEffect(() => {
    if (
      mode !== "livraison" ||
      verdict.statut === "livrable" ||
      saisie.trim().length < 3
    ) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      chercherAdresses(saisie, ctrl.signal)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [saisie, mode, verdict.statut]);

  async function choisirAdresse(a: Adresse) {
    setSuggestions([]);
    setSaisie(`${a.rue} ${a.numero}, ${a.npa} ${a.localite}`);
    setVerdict({ statut: "attente" });
    try {
      const rep = await fetch("/api/adresse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(a),
      });
      const r = await rep.json();
      if (r.statut === "livrable")
        setVerdict({ statut: "livrable", adresse: r.adresse, zone: r.zone });
      else if (r.statut === "zone-fermee")
        setVerdict({
          statut: "refus",
          message: "La livraison est fermée dans cette zone pour le moment.",
        });
      else if (r.statut === "hors-zone")
        setVerdict({
          statut: "refus",
          message: "Cette adresse est hors de notre zone de livraison.",
        });
      else
        setVerdict({
          statut: "refus",
          message:
            r.erreur ?? "Adresse introuvable dans le registre. Vérifiez-la.",
        });
    } catch {
      setVerdict({
        statut: "refus",
        message: "Le contrôle de l'adresse ne répond pas. Réessayez.",
      });
    }
  }

  // Prix, minimum et heure recalculés par le serveur à chaque changement (aucun prix calculé ici).
  useEffect(() => {
    if (!mode || lignes.length === 0 || (mode === "livraison" && !adresse)) {
      setCalcul(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch("/api/panier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lignes, mode, adresse, quand }),
        signal: ctrl.signal,
      })
        .then((r) => r.json())
        .then((r) => setCalcul("erreur" in r ? null : r))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [lignes, mode, adresse, quand]);

  // Heures proposées : les mêmes créneaux que le site (horaires, délais, zone, pizzas seules).
  const heures = useMemo(() => {
    if (!mode) return [];
    return creneaux(
      config,
      new Date(),
      mode,
      (zone as Zone | null) ?? undefined,
      calcul?.pizzas_seulement ?? false,
    ).slice(0, 60);
  }, [config, mode, zone, calcul?.pizzas_seulement]);

  const ajouter = useCallback((l: LignePanier) => {
    setLignes((avant) => {
      const i = avant.findIndex((x) => cleLigne(x) === cleLigne(l));
      if (i < 0) return [...avant, l];
      return avant.map((x, j) =>
        j === i ? { ...x, qte: Math.min(20, x.qte + l.qte) } : x,
      );
    });
    setOuvert(null);
  }, []);

  function quantite(i: number, delta: number) {
    setLignes((avant) =>
      avant.flatMap((x, j) =>
        j !== i
          ? [x]
          : x.qte + delta <= 0
            ? []
            : [{ ...x, qte: Math.min(20, x.qte + delta) }],
      ),
    );
  }

  function recommencer() {
    setCle(nouvelleCle());
    setMode(null);
    setSaisie("");
    setVerdict({ statut: "vide" });
    setDetails(DETAILS_VIDES);
    setLignes([]);
    setQuand({ type: "asap" });
    setClient({ prenom: "", nom: "", telephone: "", email: "", allergie: "" });
    setCalcul(null);
    setResultat(null);
  }

  async function enregistrer() {
    setEnvoi(true);
    setResultat(null);
    try {
      const rep = await fetch("/api/tablette/telephone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cle,
          mode,
          lignes,
          quand,
          adresse: mode === "livraison" ? adresse : null,
          details: mode === "livraison" ? details : null,
          allergie: client.allergie,
          client: {
            prenom: client.prenom,
            nom: client.nom,
            telephone: client.telephone,
            email: client.email,
          },
        }),
      });
      const r = (await rep.json()) as Resultat & { erreur?: string };
      setResultat(r.erreur ? { ok: false, message: r.erreur } : r);
    } catch {
      setResultat({
        ok: false,
        message: "Pas de réseau. Rien n'est enregistré : réessayez.",
      });
    } finally {
      setEnvoi(false);
    }
  }

  if (resultat?.ok) {
    return (
      <section className="tel-fait" aria-labelledby={`${ids}-fait`}>
        <h1 id={`${ids}-fait`}>Commande n° {resultat.numero} enregistrée</h1>
        <p>{resultat.message}</p>
        <p>
          Elle est acceptée et ses tickets partent selon l&apos;heure. Dites au
          client :{" "}
          {mode === "livraison"
            ? "à payer à la livraison"
            : "à payer au retrait"}
          , espèces ou carte.
        </p>
        <div className="boutons-ligne">
          <button
            type="button"
            className="bouton-principal"
            onClick={recommencer}
          >
            Nouvelle commande
          </button>
          <a className="bouton-second" href="/tablette">
            Retour à la file
          </a>
        </div>
      </section>
    );
  }

  const pret =
    !!mode &&
    lignes.length > 0 &&
    (mode === "retrait" || (!!adresse && details.sonnette.trim().length > 0)) &&
    client.prenom.trim().length > 0 &&
    client.telephone.trim().length >= 9 &&
    !!calcul?.valide;
  const total = calcul?.total_centimes;

  return (
    <div className="tel">
      <header className="tel-tete">
        <h1>Nouvelle commande (téléphone)</h1>
        <a className="lien" href="/tablette">
          Retour à la file
        </a>
      </header>

      <section aria-labelledby={`${ids}-mode`}>
        <h2 id={`${ids}-mode`}>Livraison ou à emporter</h2>
        <div className="tel-choix">
          {(["livraison", "retrait"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m === "livraison" ? "Livraison" : "À emporter"}
            </button>
          ))}
        </div>
      </section>

      {mode === "livraison" && (
        <section aria-labelledby={`${ids}-adresse`}>
          <h2 id={`${ids}-adresse`}>Adresse</h2>
          <div className="champ">
            <label htmlFor={`${ids}-saisie`}>Rue et numéro</label>
            <input
              id={`${ids}-saisie`}
              value={saisie}
              autoComplete="off"
              onChange={(e) => {
                setSaisie(e.target.value);
                if (verdict.statut !== "vide") setVerdict({ statut: "vide" });
              }}
            />
          </div>
          {suggestions.length > 0 && (
            <ul className="tel-suggestions" aria-label="Adresses trouvées">
              {suggestions.map((a) => (
                <li key={`${a.rue}-${a.numero}-${a.npa}-${a.featureId ?? ""}`}>
                  <button type="button" onClick={() => choisirAdresse(a)}>
                    {a.rue} {a.numero}, {a.npa} {a.localite}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {verdict.statut === "attente" && (
            <p className="aide">Contrôle de l&apos;adresse…</p>
          )}
          {verdict.statut === "refus" && (
            <p className="panier-alerte" role="alert">
              {verdict.message}
            </p>
          )}
          {verdict.statut === "livrable" && (
            <p className="aide">
              Zone {verdict.zone.numero} : livraison{" "}
              {prixChf(verdict.zone.frais_centimes)}, minimum{" "}
              {prixChf(verdict.zone.minimum_centimes)}.
            </p>
          )}
          <div className="tel-grille">
            {(
              [
                ["sonnette", "Nom sur la sonnette", 60],
                ["etage", "Étage (facultatif)", 30],
                ["code", "Code d'entrée (facultatif)", 30],
                ["instructions", "Consignes (facultatif)", 140],
              ] as const
            ).map(([k, libelle, max]) => (
              <div className="champ" key={k}>
                <label htmlFor={`${ids}-${k}`}>{libelle}</label>
                <input
                  id={`${ids}-${k}`}
                  maxLength={max}
                  value={details[k]}
                  onChange={(e) =>
                    setDetails({ ...details, [k]: e.target.value })
                  }
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {mode && (
        <section aria-labelledby={`${ids}-plats`}>
          <h2 id={`${ids}-plats`}>Plats</h2>
          <div className="tel-categories" role="group" aria-label="Catégories">
            {categories.map((c) => (
              <button
                key={c.slug}
                type="button"
                aria-pressed={categorie === c.slug}
                onClick={() => setCategorie(c.slug)}
              >
                {c.nom}
              </button>
            ))}
          </div>
          <ul className="tel-plats">
            {(categories.find((c) => c.slug === categorie)?.plats ?? []).map(
              (p) => (
                <li key={p.slug}>
                  <button type="button" onClick={() => setOuvert(p)}>
                    <span>
                      {nomClient(p.nom, p.categorie_slug === "pizzas")}
                    </span>
                    <span className="tel-prix">{prixChf(p.prix_centimes)}</span>
                  </button>
                </li>
              ),
            )}
          </ul>
          {lignes.length > 0 && (
            <ul className="tel-panier" aria-label="Plats de la commande">
              {lignes.map((l, i) => {
                const c = calcul?.lignes[i];
                return (
                  <li key={cleLigne(l)}>
                    <span className="tel-ligne-nom">
                      {nomClient(
                        catalogue.plats[l.slug]?.nom ?? l.slug,
                        catalogue.plats[l.slug]?.station === "pizza",
                      )}
                      {Object.values(l.choix).flat().length > 0 && (
                        <span className="aide">
                          {" "}
                          {Object.values(l.choix).flat().join(", ")}
                        </span>
                      )}
                      {l.retraits.length > 0 && (
                        <span className="aide">
                          {" "}
                          sans {l.retraits.join(", ")}
                        </span>
                      )}
                      {c?.erreur && (
                        <span className="panier-alerte"> {c.erreur}</span>
                      )}
                    </span>
                    <span className="tel-qte">
                      <button
                        type="button"
                        aria-label={`Un de moins : ${l.slug}`}
                        onClick={() => quantite(i, -1)}
                      >
                        −
                      </button>
                      <span aria-live="polite">{l.qte}</span>
                      <button
                        type="button"
                        aria-label={`Un de plus : ${l.slug}`}
                        onClick={() => quantite(i, 1)}
                      >
                        +
                      </button>
                    </span>
                    <span className="tel-prix">
                      {c ? prixChf(c.total_centimes) : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {calcul && calcul.manque_minimum_centimes > 0 && (
            <p className="panier-alerte" role="alert">
              Il manque {prixChf(calcul.manque_minimum_centimes)} pour le
              minimum de cette zone.
            </p>
          )}
        </section>
      )}

      {mode && (
        <section aria-labelledby={`${ids}-heure`}>
          <h2 id={`${ids}-heure`}>Heure</h2>
          <div className="champ">
            <label htmlFor={`${ids}-quand`}>
              {mode === "livraison" ? "Livrée" : "Prête"}
            </label>
            <select
              id={`${ids}-quand`}
              value={
                quand.type === "creneau"
                  ? `${quand.date} ${quand.minutes}`
                  : "asap"
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === "asap") setQuand({ type: "asap" });
                else {
                  const [date, minutes] = v.split(" ");
                  setQuand({ type: "creneau", date, minutes: Number(minutes) });
                }
              }}
            >
              <option value="asap">Dès que possible</option>
              {heures.map((h) => (
                <option
                  key={`${h.date} ${h.minutes}`}
                  value={`${h.date} ${h.minutes}`}
                >
                  {jourTexte(h.date)}, {heureTexte(h.minutes)}
                </option>
              ))}
            </select>
          </div>
          {calcul?.message_quand && (
            <p className="panier-alerte" role="alert">
              {calcul.message_quand}
            </p>
          )}
        </section>
      )}

      {mode && (
        <section aria-labelledby={`${ids}-client`}>
          <h2 id={`${ids}-client`}>Client</h2>
          <div className="tel-grille">
            {(
              [
                ["prenom", "Prénom", "text"],
                ["nom", "Nom (facultatif)", "text"],
                ["telephone", "Téléphone", "tel"],
                [
                  "email",
                  "E-mail (facultatif, pour le récapitulatif)",
                  "email",
                ],
              ] as const
            ).map(([k, libelle, type]) => (
              <div className="champ" key={k}>
                <label htmlFor={`${ids}-${k}`}>{libelle}</label>
                <input
                  id={`${ids}-${k}`}
                  type={type}
                  autoComplete="off"
                  value={client[k]}
                  onChange={(e) =>
                    setClient({ ...client, [k]: e.target.value })
                  }
                />
              </div>
            ))}
            <div className="champ">
              <label htmlFor={`${ids}-allergie`}>
                Allergie ou intolérance (facultatif)
              </label>
              <input
                id={`${ids}-allergie`}
                maxLength={120}
                value={client.allergie}
                onChange={(e) =>
                  setClient({ ...client, allergie: e.target.value })
                }
              />
            </div>
          </div>
        </section>
      )}

      {mode && (
        <section className="tel-envoi" aria-labelledby={`${ids}-total`}>
          <h2 id={`${ids}-total`}>
            {total !== undefined ? `Total ${prixChf(total)}` : "Total"}
          </h2>
          {calcul && mode === "livraison" && (
            <p className="aide">
              Plats {prixChf(calcul.sous_total_centimes)}, livraison{" "}
              {prixChf(calcul.frais_centimes)}.
            </p>
          )}
          <p>
            {mode === "livraison"
              ? "À payer à la livraison, espèces ou carte."
              : "À payer au retrait, espèces ou carte."}
          </p>
          {resultat && !resultat.ok && (
            <p className="panier-alerte" role="alert">
              {resultat.message}
            </p>
          )}
          <button
            type="button"
            className="bouton-principal"
            disabled={!pret || envoi}
            onClick={enregistrer}
          >
            {envoi ? "Enregistrement…" : "Enregistrer la commande"}
          </button>
          {!pret && (
            <p className="aide">
              Il faut le mode, l&apos;adresse et la sonnette pour une livraison,
              au moins un plat, le prénom et le téléphone.
            </p>
          )}
        </section>
      )}

      {ouvert && (
        <FichePlat
          plat={ouvert}
          catalogue={catalogue}
          preversion={preversion}
          onAjouter={ajouter}
          onFermer={() => setOuvert(null)}
        />
      )}
    </div>
  );
}
