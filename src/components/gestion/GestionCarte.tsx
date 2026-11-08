"use client";

import { useId, useMemo, useState } from "react";
import { enregistrer } from "@/components/gestion/enregistrer";
import { PHOTOS } from "@/lib/photos";

export type PlatGestion = {
  slug: string;
  nom: string;
  description: string;
  prix_centimes: number;
  prix_a_valider: boolean;
  commandable: boolean;
  station: "pizza" | "cuisine";
  photo: string | null;
  provenance: string | null;
  provenances_a_fournir: string[];
  allergenes: string | null;
  retraits: { nom: string; a_valider: boolean }[];
  groupes: string[];
  bloquants: string[];
};
export type DonneesCarte = {
  categories: { slug: string; nom: string; plats: PlatGestion[] }[];
  groupes: { slug: string; nom: string; choix_min: number; choix_max: number; options: { nom: string; prix_centimes: number; prix_a_valider: boolean; actif: boolean }[] }[];
  bloquants: number;
};

const chf = (c: number) => (c / 100).toFixed(2);

// Les suppléments à valider se regroupent en un seul motif : ils se valident dans leur propre onglet.
function motifs(bloquants: string[]): string[] {
  const supplements = bloquants.filter((b) => b.startsWith("supplément à valider"));
  const autres = bloquants.filter((b) => !b.startsWith("supplément à valider"));
  return supplements.length ? [...autres, `${supplements.length} supplément${supplements.length > 1 ? "s" : ""} à valider`] : autres;
}

export function GestionCarte({ donnees, recharger }: { donnees: DonneesCarte; recharger: () => Promise<void> }) {
  const [seulementBloquants, setSeulementBloquants] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [ouvert, setOuvert] = useState<string | null>(null);
  const categories = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return donnees.categories
      .map((c) => ({ ...c, plats: c.plats.filter((p) => (!seulementBloquants || p.bloquants.length > 0) && (!q || p.nom.toLowerCase().includes(q))) }))
      .filter((c) => c.plats.length > 0);
  }, [donnees, seulementBloquants, recherche]);

  return (
    <section className="ges-carte">
      <div className="ges-filtres">
        <div className="champ">
          <label htmlFor="ges-recherche">Chercher un plat</label>
          <input id="ges-recherche" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </div>
        <label className="option">
          <input type="checkbox" checked={seulementBloquants} onChange={(e) => setSeulementBloquants(e.target.checked)} />
          <span>Seulement ce qui bloque la mise en ligne</span>
        </label>
      </div>
      {categories.length === 0 && <p className="aide">Aucun plat ne correspond.</p>}
      {categories.map((c) => (
        <div key={c.slug} className="ges-categorie">
          <h2>{c.nom}</h2>
          <ul className="ges-plats">
            {c.plats.map((p) => (
              <li key={p.slug} className={p.commandable ? "" : "ges-retire"}>
                <button type="button" className="ges-ligne" aria-expanded={ouvert === p.slug} onClick={() => setOuvert(ouvert === p.slug ? null : p.slug)}>
                  <span className="ges-nom">{p.nom}</span>
                  <span className="ges-prix">
                    {chf(p.prix_centimes)}
                    {p.prix_a_valider ? " à valider" : ""}
                  </span>
                  <span className="ges-etats">
                    {!p.commandable && <span className="ges-badge">pas commandable</span>}
                    {motifs(p.bloquants).map((b) => (
                      <span key={b} className="ges-badge ges-badge-bloque">
                        {b}
                      </span>
                    ))}
                  </span>
                </button>
                {ouvert === p.slug && <FichePlat plat={p} recharger={recharger} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function FichePlat({ plat, recharger }: { plat: PlatGestion; recharger: () => Promise<void> }) {
  const ids = useId();
  const [f, setF] = useState({
    nom: plat.nom,
    description: plat.description,
    prix: chf(plat.prix_centimes),
    prix_valide: !plat.prix_a_valider,
    commandable: plat.commandable,
    station: plat.station,
    photo: plat.photo ?? "",
    provenance: plat.provenance ?? "",
    a_fournir: plat.provenances_a_fournir.join(", "),
    allergenes: plat.allergenes ?? "",
  });
  const [retraits, setRetraits] = useState(plat.retraits.map((r) => r.nom).join(", "));
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function sauver(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/carte", {
      type: "plat",
      slug: plat.slug,
      champs: {
        nom: f.nom,
        description: f.description,
        prix: f.prix,
        prix_valide: f.prix_valide,
        commandable: f.commandable,
        station: f.station,
        photo: f.photo,
        provenance: f.provenance,
        provenances_a_fournir: f.a_fournir.split(",").map((x) => x.trim()).filter(Boolean),
        allergenes: f.allergenes,
      },
    });
    setMessage(erreur ?? "Enregistré.");
    setEnvoi(false);
    if (!erreur) await recharger();
  }

  async function validerRetraits() {
    setEnvoi(true);
    setMessage(null);
    const noms = retraits.split(",").map((x) => x.trim()).filter(Boolean);
    const erreur = await enregistrer("/api/gestion/carte", { type: "retraits", slug: plat.slug, noms });
    setMessage(erreur ?? "Retraits validés.");
    setEnvoi(false);
    if (!erreur) await recharger();
  }

  const champ = (cle: "nom" | "prix" | "provenance" | "a_fournir" | "allergenes") => ({
    id: `${ids}-${cle}`,
    value: f[cle],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [cle]: e.target.value }),
  });
  const retraitsAValider = plat.retraits.some((r) => r.a_valider);

  return (
    <form className="ges-fiche" onSubmit={sauver}>
      <div className="details deux">
        <div className="champ">
          <label htmlFor={`${ids}-nom`}>Nom affiché</label>
          <input {...champ("nom")} maxLength={80} required />
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-prix`}>Prix (CHF)</label>
          <input {...champ("prix")} inputMode="decimal" required />
          <label className="option">
            <input type="checkbox" checked={f.prix_valide} onChange={(e) => setF({ ...f, prix_valide: e.target.checked })} />
            <span>Prix validé</span>
          </label>
        </div>
        <div className="champ champ-large">
          <label htmlFor={`${ids}-description`}>Description</label>
          <textarea id={`${ids}-description`} rows={3} maxLength={400} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-station`}>Station (imprimante)</label>
          <select id={`${ids}-station`} value={f.station} onChange={(e) => setF({ ...f, station: e.target.value as "pizza" | "cuisine" })}>
            <option value="pizza">Pizza</option>
            <option value="cuisine">Cuisine</option>
          </select>
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-photo`}>Photo</label>
          <select id={`${ids}-photo`} value={f.photo} onChange={(e) => setF({ ...f, photo: e.target.value })}>
            <option value="">Sans photo</option>
            {PHOTOS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-provenance`}>Provenance affichée</label>
          <input {...champ("provenance")} maxLength={300} placeholder="Bœuf : Suisse ou Autriche" />
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-a_fournir`}>
            Provenances à fournir <span className="facultatif">séparées par des virgules</span>
          </label>
          <input {...champ("a_fournir")} />
        </div>
        <div className="champ champ-large">
          <label htmlFor={`${ids}-allergenes`}>Allergènes</label>
          <input {...champ("allergenes")} maxLength={300} placeholder="gluten, lait" />
          <p className="aide">Vide : la fiche affiche « Allergènes : demandez-nous au 022 792 16 89 » et la mise en ligne reste bloquée.</p>
        </div>
        <label className="option champ-large">
          <input type="checkbox" checked={f.commandable} onChange={(e) => setF({ ...f, commandable: e.target.checked })} />
          <span>Commandable sur le site</span>
        </label>
      </div>
      <div className="boutons-ligne">
        <button type="submit" className="bouton-principal" disabled={envoi}>
          Enregistrer le plat
        </button>
      </div>

      <div className="ges-retraits">
        <div className="champ">
          <label htmlFor={`${ids}-retraits`}>
            Retraits gratuits <span className="facultatif">séparés par des virgules</span>
          </label>
          <input id={`${ids}-retraits`} value={retraits} onChange={(e) => setRetraits(e.target.value)} />
        </div>
        <button type="button" className="bouton-second" disabled={envoi} onClick={validerRetraits}>
          {retraitsAValider ? "Valider ces retraits" : "Enregistrer les retraits"}
        </button>
      </div>
      {message && (
        <p className="aide-forte" role="status">
          {message}
        </p>
      )}
    </form>
  );
}

export function GestionSupplements({ donnees, recharger }: { donnees: DonneesCarte; recharger: () => Promise<void> }) {
  return (
    <section className="ges-carte">
      {donnees.groupes.map((g) => (
        <div key={g.slug} className="ges-categorie">
          <h2>{g.nom}</h2>
          <p className="aide">
            {g.choix_min > 0 ? `Choix obligatoire, ${g.choix_max} au plus.` : `Facultatif, ${g.choix_max} au plus par plat.`}
          </p>
          <ul className="ges-options">
            {g.options.map((o) => (
              <LigneOption key={o.nom} groupe={g.slug} option={o} recharger={recharger} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function LigneOption({
  groupe,
  option,
  recharger,
}: {
  groupe: string;
  option: { nom: string; prix_centimes: number; prix_a_valider: boolean; actif: boolean };
  recharger: () => Promise<void>;
}) {
  const ids = useId();
  const [prix, setPrix] = useState(chf(option.prix_centimes));
  const [valide, setValide] = useState(!option.prix_a_valider);
  const [actif, setActif] = useState(option.actif);
  const [message, setMessage] = useState<string | null>(null);

  async function sauver() {
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/carte", { type: "option", groupe, nom: option.nom, champs: { prix, prix_valide: valide, actif } });
    setMessage(erreur ?? "Enregistré.");
    if (!erreur) await recharger();
  }

  return (
    <li className={actif ? "" : "ges-retire"}>
      <span className="ges-nom">{option.nom}</span>
      <div className="champ">
        <label htmlFor={`${ids}-prix`} className="sr-only">
          Prix de {option.nom} en francs
        </label>
        <input id={`${ids}-prix`} inputMode="decimal" value={prix} onChange={(e) => setPrix(e.target.value)} />
      </div>
      <label className="option">
        <input type="checkbox" checked={valide} onChange={(e) => setValide(e.target.checked)} />
        <span>Validé</span>
      </label>
      <label className="option">
        <input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} />
        <span>Proposé</span>
      </label>
      <button type="button" className="bouton-second" onClick={sauver}>
        Enregistrer
      </button>
      {message && <span className="aide">{message}</span>}
    </li>
  );
}
