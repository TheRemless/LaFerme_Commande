"use client";

import { useState } from "react";
import type {
  DonneesCarte,
  GroupeGestion,
} from "@/components/gestion/GestionCarte";
import { enregistrer } from "@/components/gestion/enregistrer";
import { jourCourtFr } from "@/components/gestion/carte/ListeCarte";
import { useConfirmer, useNotifier } from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";
import "./carte.css";

// Groupes d'options (vague 3) : créer un groupe, le régler (nom, minimum, maximum), cocher des options
// d'avance, les ordonner et les renommer, choisir les plats qui le portent, épuiser une option jusqu'à une
// date. Chaque geste passe par /api/gestion/carte, réservé au gérant et journalisé.

function Bornes({
  min,
  max,
  setMin,
  setMax,
}: {
  min: string;
  max: string;
  setMin: (v: string) => void;
  setMax: (v: string) => void;
}) {
  return (
    <div className="bo-ligne-champs bo-ligne-champs-haut">
      <div className="bo-champ">
        <label htmlFor="groupe-min">Minimum à choisir</label>
        <input
          id="groupe-min"
          type="number"
          min={0}
          max={10}
          required
          value={min}
          onChange={(e) => setMin(e.target.value)}
        />
        <p className="bo-champ-aide">
          0 pour un choix facultatif, 1 ou plus pour un choix obligatoire.
        </p>
      </div>
      <div className="bo-champ">
        <label htmlFor="groupe-max">Maximum</label>
        <input
          id="groupe-max"
          type="number"
          min={1}
          max={20}
          required
          value={max}
          onChange={(e) => setMax(e.target.value)}
        />
      </div>
    </div>
  );
}

export function NouveauGroupe({
  cree,
}: {
  cree: (slug: string) => Promise<void>;
}) {
  const notifier = useNotifier();
  const [nom, setNom] = useState("");
  const [min, setMin] = useState("0");
  const [max, setMax] = useState("1");
  const [erreur, setErreur] = useState<string | null>(null);
  async function creer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    const r = await poster("/api/gestion/carte", {
      type: "nouveau_groupe",
      champs: { nom, choix_min: Number(min), choix_max: Number(max) },
    });
    if (!r.ok)
      return setErreur(
        String(r.donnees.erreur ?? "Pas enregistré. Réessayez."),
      );
    notifier({
      texte: `Groupe « ${nom.trim()} » créé. Ajoutez-lui ses options, puis ses plats.`,
      ton: "succes",
    });
    await cree(String(r.donnees.slug));
  }
  return (
    <form onSubmit={creer} className="bo-formulaire">
      <div className="bo-champ">
        <label htmlFor="groupe-nom">Nom du groupe</label>
        <input
          id="groupe-nom"
          value={nom}
          maxLength={40}
          required
          onChange={(e) => setNom(e.target.value)}
        />
        <p className="bo-champ-aide">
          Le nom que voit le client sur la fiche du plat, par exemple Sauce,
          Cuisson ou Accompagnement.
        </p>
      </div>
      <Bornes min={min} max={max} setMin={setMin} setMax={setMax} />
      {erreur && (
        <p className="bo-erreur" role="alert">
          {erreur}
        </p>
      )}
      <button type="submit" className="bo-bouton bo-bouton-principal">
        Créer le groupe
      </button>
    </form>
  );
}

export function ReglerGroupe({
  groupe,
  donnees,
  recharger,
}: {
  groupe: GroupeGestion;
  donnees: DonneesCarte;
  recharger: () => Promise<void>;
}) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const [nom, setNom] = useState(groupe.nom);
  const [min, setMin] = useState(String(groupe.choix_min));
  const [max, setMax] = useState(String(groupe.choix_max));
  const proposees = groupe.options.filter((o) => o.actif);
  // Choix obligatoire sans assez d'options : les plats qui le portent ne pourraient plus être commandés.
  const impossible = groupe.choix_min > proposees.length;
  const [defauts, setDefauts] = useState<string[]>(
    groupe.options.filter((o) => o.par_defaut).map((o) => o.nom),
  );
  const [plats, setPlats] = useState<string[]>(groupe.plats ?? []);
  const [renommer, setRenommer] = useState({
    ancien: groupe.options[0]?.nom ?? "",
    nouveau: "",
  });
  const [rupture, setRupture] = useState({
    nom: proposees[0]?.nom ?? "",
    date: donnees.aujourdhui.slice(0, 10),
  });

  async function agir(corps: Record<string, unknown>, succes: string) {
    const erreur = await enregistrer("/api/gestion/carte", corps);
    notifier(
      erreur
        ? { texte: erreur, ton: "erreur" }
        : { texte: succes, ton: "succes" },
    );
    if (!erreur) await recharger();
    return !erreur;
  }

  async function enregistrerPlats() {
    const retires = (groupe.plats ?? []).filter((s) => !plats.includes(s));
    if (retires.length) {
      const n = retires.length;
      const ok = await confirmer({
        titre: `Retirer « ${groupe.nom} » de ${n} plat${n > 1 ? "s" : ""} ?`,
        texte: "Ces plats ne proposeront plus ces options aux clients.",
        oui: `Retirer de ${n} plat${n > 1 ? "s" : ""}`,
        danger: true,
      });
      if (!ok) return;
    }
    await agir(
      { type: "plats_du_groupe", groupe: groupe.slug, slugs: plats },
      `« ${groupe.nom} » est proposé sur ${plats.length} plat${plats.length > 1 ? "s" : ""}.`,
    );
  }

  async function deplacer(i: number, sens: -1 | 1) {
    const noms = groupe.options.map((o) => o.nom);
    const j = i + sens;
    if (j < 0 || j >= noms.length) return;
    [noms[i], noms[j]] = [noms[j], noms[i]];
    await agir(
      { type: "ordre_options", groupe: groupe.slug, noms },
      "Ordre enregistré.",
    );
  }

  return (
    <div className="bo-groupe-reglages">
      <section
        className="bo-fiche-partie bo-fiche-partie-premiere"
        aria-labelledby="groupe-regles"
      >
        <h3 id="groupe-regles">Nom et règles du choix</h3>
        <form
          className="bo-formulaire"
          onSubmit={(e) => {
            e.preventDefault();
            agir(
              {
                type: "groupe",
                groupe: groupe.slug,
                champs: { nom, choix_min: Number(min), choix_max: Number(max) },
              },
              "Groupe enregistré.",
            );
          }}
        >
          <div className="bo-champ">
            <label htmlFor="groupe-renom">Nom affiché aux clients</label>
            <input
              id="groupe-renom"
              value={nom}
              maxLength={40}
              required
              onChange={(e) => setNom(e.target.value)}
            />
          </div>
          <Bornes min={min} max={max} setMin={setMin} setMax={setMax} />
          <button type="submit" className="bo-bouton bo-bouton-second">
            Enregistrer le groupe
          </button>
        </form>
      </section>

      <section className="bo-fiche-partie" aria-labelledby="groupe-defauts">
        <h3 id="groupe-defauts">Cochées d&apos;avance</h3>
        {proposees.length === 0 ? (
          <p className="bo-champ-aide">
            Aucune option proposée. Ajoutez-en sous le groupe.
          </p>
        ) : (
          <>
            <p className="bo-champ-aide">
              Le client les trouve cochées sur la fiche du plat et peut les
              décocher. {groupe.choix_max} au plus.
            </p>
            <fieldset className="bo-choix">
              <legend className="sr-only">Options cochées d&apos;avance</legend>
              {proposees.map((o) => (
                <label key={o.nom} className="bo-case">
                  <input
                    type="checkbox"
                    checked={defauts.includes(o.nom)}
                    onChange={(e) =>
                      setDefauts((d) =>
                        e.target.checked
                          ? [...d, o.nom]
                          : d.filter((x) => x !== o.nom),
                      )
                    }
                  />
                  <span>{o.nom}</span>
                </label>
              ))}
            </fieldset>
            <button
              type="button"
              className="bo-bouton bo-bouton-second"
              onClick={() =>
                agir(
                  { type: "defauts", groupe: groupe.slug, noms: defauts },
                  "Options cochées d'avance enregistrées.",
                )
              }
            >
              Enregistrer les options cochées
            </button>
          </>
        )}
      </section>

      {groupe.options.length > 0 && (
        <section className="bo-fiche-partie" aria-labelledby="groupe-ordre">
          <h3 id="groupe-ordre">Ordre et noms des options</h3>
          <ol className="bo-ordre">
            {groupe.options.map((o, i) => (
              <li key={o.nom}>
                <span>{o.nom}</span>
                <span className="bo-ordre-boutons">
                  <button
                    type="button"
                    className="bo-bouton bo-bouton-second bo-bouton-petit"
                    disabled={i === 0}
                    onClick={() => deplacer(i, -1)}
                    aria-label={`Monter ${o.nom}`}
                  >
                    Monter
                  </button>
                  <button
                    type="button"
                    className="bo-bouton bo-bouton-second bo-bouton-petit"
                    disabled={i === groupe.options.length - 1}
                    onClick={() => deplacer(i, 1)}
                    aria-label={`Descendre ${o.nom}`}
                  >
                    Descendre
                  </button>
                </span>
              </li>
            ))}
          </ol>
          {groupe.options.length > 0 && (
            <form
              className="bo-ligne-champs"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await agir(
                  {
                    type: "renommer_option",
                    groupe: groupe.slug,
                    nom: renommer.ancien,
                    nouveau: renommer.nouveau,
                  },
                  `« ${renommer.ancien} » s'appelle maintenant « ${renommer.nouveau.trim()} ».`,
                );
                if (ok) setRenommer({ ...renommer, nouveau: "" });
              }}
            >
              <div className="bo-champ">
                <label htmlFor="option-ancien">Option à renommer</label>
                <select
                  id="option-ancien"
                  value={renommer.ancien}
                  onChange={(e) =>
                    setRenommer({ ...renommer, ancien: e.target.value })
                  }
                >
                  {groupe.options.map((o) => (
                    <option key={o.nom}>{o.nom}</option>
                  ))}
                </select>
              </div>
              <div className="bo-champ">
                <label htmlFor="option-nouveau">Nouveau nom</label>
                <input
                  id="option-nouveau"
                  value={renommer.nouveau}
                  maxLength={60}
                  required
                  onChange={(e) =>
                    setRenommer({ ...renommer, nouveau: e.target.value })
                  }
                />
              </div>
              <button type="submit" className="bo-bouton bo-bouton-second">
                Renommer
              </button>
            </form>
          )}
        </section>
      )}

      {proposees.length > 0 && (
        <section className="bo-fiche-partie" aria-labelledby="groupe-rupture">
          <h3 id="groupe-rupture">Option épuisée</h3>
          <ul className="bo-ordre">
            {proposees
              .filter((o) => o.rupture_jusqu_au)
              .map((o) => (
                <li key={o.nom}>
                  <span>
                    {o.nom}, épuisé jusqu&apos;au{" "}
                    {jourCourtFr(o.rupture_jusqu_au!)}
                  </span>
                  <button
                    type="button"
                    className="bo-bouton bo-bouton-second bo-bouton-petit"
                    onClick={() =>
                      agir(
                        {
                          type: "rupture",
                          groupe: groupe.slug,
                          nom: o.nom,
                          jusqu_au: null,
                        },
                        `${o.nom} de nouveau proposé.`,
                      )
                    }
                  >
                    Remettre
                  </button>
                </li>
              ))}
          </ul>
          <form
            className="bo-ligne-champs"
            onSubmit={(e) => {
              e.preventDefault();
              agir(
                {
                  type: "rupture",
                  groupe: groupe.slug,
                  nom: rupture.nom,
                  jusqu_au: rupture.date,
                },
                `${rupture.nom} épuisé jusqu'au ${jourCourtFr(rupture.date)}, de retour le lendemain.`,
              );
            }}
          >
            <div className="bo-champ">
              <label htmlFor="rupture-option">Option</label>
              <select
                id="rupture-option"
                value={rupture.nom}
                onChange={(e) =>
                  setRupture({ ...rupture, nom: e.target.value })
                }
              >
                {proposees.map((o) => (
                  <option key={o.nom}>{o.nom}</option>
                ))}
              </select>
            </div>
            <div className="bo-champ">
              <label htmlFor="rupture-option-date">
                Épuisé jusqu&apos;au (compris)
              </label>
              <input
                id="rupture-option-date"
                type="date"
                required
                min={donnees.aujourdhui.slice(0, 10)}
                value={rupture.date}
                onChange={(e) =>
                  setRupture({ ...rupture, date: e.target.value })
                }
              />
            </div>
            <button type="submit" className="bo-bouton bo-bouton-second">
              Épuiser
            </button>
          </form>
        </section>
      )}

      <section className="bo-fiche-partie" aria-labelledby="groupe-plats">
        <h3 id="groupe-plats">Plats qui proposent ce groupe</h3>
        <p className="bo-champ-aide">
          {plats.length} plat{plats.length > 1 ? "s" : ""} coché
          {plats.length > 1 ? "s" : ""}. Un prix d&apos;option changé vaut pour
          tous ces plats.
        </p>
        {donnees.categories.map((c) => {
          const visibles = c.plats.filter((p) => !p.archive);
          if (!visibles.length) return null;
          const tous = visibles.every((p) => plats.includes(p.slug));
          return (
            <fieldset key={c.slug} className="bo-choix bo-choix-plats">
              <legend>
                <label className="bo-case">
                  <input
                    type="checkbox"
                    checked={tous}
                    onChange={(e) =>
                      setPlats((ps) =>
                        e.target.checked
                          ? [
                              ...new Set([
                                ...ps,
                                ...visibles.map((p) => p.slug),
                              ]),
                            ]
                          : ps.filter(
                              (s) => !visibles.some((p) => p.slug === s),
                            ),
                      )
                    }
                  />
                  <span>{c.nom}, tous</span>
                </label>
              </legend>
              {visibles.map((p) => (
                <label key={p.slug} className="bo-case">
                  <input
                    type="checkbox"
                    checked={plats.includes(p.slug)}
                    onChange={(e) =>
                      setPlats((ps) =>
                        e.target.checked
                          ? [...ps, p.slug]
                          : ps.filter((s) => s !== p.slug),
                      )
                    }
                  />
                  <span>{p.nom}</span>
                </label>
              ))}
            </fieldset>
          );
        })}
        {impossible && plats.length > 0 && (
          <p className="bo-erreur" role="alert">
            Ce choix est obligatoire ({groupe.choix_min} au moins) et il
            n&apos;a que {proposees.length} option
            {proposees.length > 1 ? "s" : ""} proposée
            {proposees.length > 1 ? "s" : ""}. Ajoutez des options avant de le
            poser sur des plats, sinon ils ne pourraient plus être commandés.
          </p>
        )}
        <button
          type="button"
          className="bo-bouton bo-bouton-principal"
          disabled={impossible && plats.length > 0}
          onClick={enregistrerPlats}
        >
          Enregistrer les plats
        </button>
      </section>
    </div>
  );
}
