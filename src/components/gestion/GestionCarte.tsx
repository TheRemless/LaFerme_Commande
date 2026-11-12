"use client";

import { useId, useMemo, useState } from "react";
import { enregistrer } from "@/components/gestion/enregistrer";
import { PhotoPlat } from "@/components/gestion/PhotoPlat";
import { PHOTOS, estPhotoEnvoyee } from "@/lib/photos";
import { poster } from "@/lib/requete-client";

export type ServiceJour = "midi" | "soir" | "journee";

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
  origine: "carte" | "gestion" | "jour";
  archive: boolean;
  jour: string | null;
  jour_service: ServiceJour | null;
  retraits: { nom: string; a_valider: boolean }[];
  groupes: string[];
  // Ce qui bloquerait la mise en ligne si le plat était en vente.
  manques: string[];
  bloquants: string[];
};
export type GroupeGestion = { slug: string; nom: string; choix_min: number; choix_max: number; options: { nom: string; prix_centimes: number; prix_a_valider: boolean; actif: boolean }[] };
export type DonneesCarte = {
  categories: { slug: string; nom: string; plats: PlatGestion[] }[];
  plats_du_jour: PlatGestion[];
  aujourdhui: string;
  groupes: GroupeGestion[];
  bloquants: number;
};

const chf = (c: number) => (c / 100).toFixed(2);
export const SERVICES: [ServiceJour, string][] = [
  ["midi", "Midi"],
  ["soir", "Soir"],
  ["journee", "Midi et soir"],
];

// Les suppléments à valider se regroupent en un seul motif : ils se valident dans leur propre onglet.
function motifs(bloquants: string[]): string[] {
  const supplements = bloquants.filter((b) => b.startsWith("supplément à valider"));
  const autres = bloquants.filter((b) => !b.startsWith("supplément à valider"));
  return supplements.length ? [...autres, `${supplements.length} supplément${supplements.length > 1 ? "s" : ""} à valider`] : autres;
}

function etatVente(m: string[]): string {
  return m.length ? `Pour le mettre en vente, il manque : ${motifs(m).join(", ")}.` : "Rien ne manque : il peut être mis en vente.";
}

export function GestionCarte({ donnees, recharger, version }: { donnees: DonneesCarte; recharger: () => Promise<void>; version: number }) {
  const [seulementBloquants, setSeulementBloquants] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState(false);
  const [ordre, setOrdre] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const categories = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return donnees.categories.map((c) => ({
      ...c,
      plats: c.plats.filter((p) => !p.archive && (!seulementBloquants || p.bloquants.length > 0) && (!q || p.nom.toLowerCase().includes(q))),
    }));
  }, [donnees, seulementBloquants, recherche]);
  const archives = donnees.categories.flatMap((c) => c.plats.filter((p) => p.archive).map((p) => ({ ...p, categorie: c.nom })));
  const filtre = seulementBloquants || recherche.trim() !== "";

  async function deplacer(categorie: string, slugs: string[], i: number, sens: -1 | 1) {
    const j = i + sens;
    if (j < 0 || j >= slugs.length) return;
    const liste = [...slugs];
    [liste[i], liste[j]] = [liste[j], liste[i]];
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/carte", { type: "ordre_plats", categorie, slugs: liste });
    if (erreur) setMessage(erreur);
    await recharger();
  }

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
        <button type="button" className="bouton-second" aria-expanded={nouveau} onClick={() => setNouveau(!nouveau)}>
          Ajouter un plat
        </button>
      </div>
      {nouveau && (
        <NouveauPlat
          donnees={donnees}
          fermer={() => setNouveau(false)}
          cree={async (slug) => {
            setNouveau(false);
            await recharger();
            setOuvert(slug);
          }}
        />
      )}
      <GestionCategories donnees={donnees} recharger={recharger} />
      {message && (
        <p className="aide-forte" role="status">
          {message}
        </p>
      )}
      {categories.every((c) => c.plats.length === 0) && filtre && <p className="aide">Aucun plat ne correspond.</p>}
      {categories.map((c) => {
        if (filtre && c.plats.length === 0) return null;
        const enOrdre = ordre === c.slug && !filtre;
        const slugs = c.plats.map((p) => p.slug);
        return (
          <div key={c.slug} className="ges-categorie">
            <div className="ges-categorie-tete">
              <h2>{c.nom}</h2>
              {!filtre && c.plats.length > 1 && (
                <button type="button" className="bouton-second" aria-pressed={enOrdre} onClick={() => setOrdre(enOrdre ? null : c.slug)}>
                  {enOrdre ? "Terminer l'ordre" : "Changer l'ordre"}
                </button>
              )}
            </div>
            {c.plats.length === 0 ? (
              <p className="aide">Aucun plat dans cette catégorie.</p>
            ) : (
              <ul className="ges-plats">
                {c.plats.map((p, i) => (
                  <li key={p.slug} className={p.commandable ? "" : "ges-retire"}>
                    {enOrdre ? (
                      <div className="ges-ligne ges-ligne-ordre">
                        <span className="ges-nom">{p.nom}</span>
                        <span className="ges-fleches">
                          <button type="button" className="bouton-second" disabled={i === 0} onClick={() => deplacer(c.slug, slugs, i, -1)} aria-label={`Monter ${p.nom}`}>
                            Monter
                          </button>
                          <button type="button" className="bouton-second" disabled={i === slugs.length - 1} onClick={() => deplacer(c.slug, slugs, i, 1)} aria-label={`Descendre ${p.nom}`}>
                            Descendre
                          </button>
                        </span>
                      </div>
                    ) : (
                      <LignePlat plat={p} ouvert={ouvert === p.slug} basculer={() => setOuvert(ouvert === p.slug ? null : p.slug)} />
                    )}
                    {/* Après un import, la fiche repart des valeurs à jour (clé changée) ; après son propre
                        enregistrement, elle garde ce qui vient d'être saisi, identique à la base. */}
                    {!enOrdre && ouvert === p.slug && <FichePlat key={`${p.slug}-${version}`} plat={p} donnees={donnees} recharger={recharger} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {archives.length > 0 && !filtre && (
        <div className="ges-categorie">
          <h2>Plats archivés</h2>
          <p className="aide">Hors de la carte. Les commandes passées et l&apos;export comptable les gardent tels quels.</p>
          <ul className="ges-plats">
            {archives.map((p) => (
              <li key={p.slug} className="ges-retire">
                <div className="ges-ligne ges-ligne-ordre">
                  <span className="ges-nom">
                    {p.nom} <span className="aide">({p.categorie})</span>
                  </span>
                  <BoutonArchive plat={p} recharger={recharger} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function LignePlat({ plat, ouvert, basculer }: { plat: PlatGestion; ouvert: boolean; basculer: () => void }) {
  return (
    <button type="button" className="ges-ligne" aria-expanded={ouvert} onClick={basculer}>
      <span className="ges-nom">{plat.nom}</span>
      <span className="ges-prix">
        {chf(plat.prix_centimes)}
        {plat.prix_a_valider ? " à valider" : ""}
      </span>
      <span className="ges-etats">
        {!plat.commandable && <span className="ges-badge">pas commandable</span>}
        {plat.origine === "gestion" && <span className="ges-badge">ajouté ici</span>}
        {motifs(plat.bloquants).map((b) => (
          <span key={b} className="ges-badge ges-badge-bloque">
            {b}
          </span>
        ))}
      </span>
    </button>
  );
}

function BoutonArchive({ plat, recharger }: { plat: PlatGestion; recharger: () => Promise<void> }) {
  const [message, setMessage] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  async function basculer() {
    const erreur = await enregistrer("/api/gestion/carte", { type: "archiver", slug: plat.slug, archiver: !plat.archive });
    setMessage(erreur);
    setConfirmer(false);
    if (!erreur) await recharger();
  }
  if (plat.archive) {
    return (
      <span className="boutons-ligne">
        <button type="button" className="bouton-second" onClick={basculer}>
          Remettre à la carte
        </button>
        {message && <span className="aide">{message}</span>}
      </span>
    );
  }
  return (
    <span className="boutons-ligne">
      {confirmer ? (
        <>
          <button type="button" className="bouton-second" onClick={basculer}>
            Oui, archiver {plat.nom}
          </button>
          <button type="button" className="lien" onClick={() => setConfirmer(false)}>
            Garder
          </button>
        </>
      ) : (
        <button type="button" className="bouton-second" onClick={() => setConfirmer(true)}>
          Archiver ce plat
        </button>
      )}
      {message && <span className="aide">{message}</span>}
    </span>
  );
}

export function FichePlat({ plat, donnees, recharger }: { plat: PlatGestion; donnees: DonneesCarte; recharger: () => Promise<void> }) {
  const ids = useId();
  const duJour = plat.origine === "jour";
  const categorie = donnees.categories.find((c) => c.plats.some((p) => p.slug === plat.slug))?.slug ?? "";
  const [f, setF] = useState({
    nom: plat.nom,
    description: plat.description,
    prix: chf(plat.prix_centimes),
    prix_valide: !plat.prix_a_valider,
    commandable: plat.commandable,
    station: plat.station,
    provenance: plat.provenance ?? "",
    a_fournir: plat.provenances_a_fournir.join(", "),
    allergenes: plat.allergenes ?? "",
    categorie,
    groupes: plat.groupes,
    service: plat.jour_service ?? "journee",
  });
  const [retraits, setRetraits] = useState(plat.retraits.map((r) => r.nom).join(", "));
  // Photo du shooting choisie dans la liste ; null tant qu'on n'y touche pas. La photo actuelle vient
  // toujours de la base : un envoi ou un retrait fait dans le bloc photo n'est jamais écrasé ici.
  const [photoChoisie, setPhotoChoisie] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function sauver(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setMessage(null);
    const champs: Record<string, unknown> = {
      nom: f.nom,
      description: f.description,
      prix: f.prix,
      prix_valide: f.prix_valide,
      commandable: f.commandable,
      station: f.station,
      provenance: f.provenance,
      provenances_a_fournir: f.a_fournir.split(",").map((x) => x.trim()).filter(Boolean),
      allergenes: f.allergenes,
    };
    if (photoChoisie !== null && photoChoisie !== (plat.photo ?? "")) champs.photo = photoChoisie;
    if (!duJour) {
      if (f.categorie !== categorie) champs.categorie = f.categorie;
      if (f.groupes.join() !== plat.groupes.join()) champs.groupes = f.groupes;
    }
    let erreur = await enregistrer("/api/gestion/carte", { type: "plat", slug: plat.slug, champs });
    if (!erreur && duJour && f.service !== plat.jour_service) {
      erreur = await enregistrer("/api/gestion/carte", { type: "service_jour", slug: plat.slug, service: f.service });
    }
    setMessage(erreur ?? "Enregistré.");
    setEnvoi(false);
    if (!erreur) {
      setPhotoChoisie(null);
      await recharger();
    }
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

  const prixInitial = chf(plat.prix_centimes);
  const champ = (cle: "nom" | "prix" | "provenance" | "a_fournir" | "allergenes") => ({
    id: `${ids}-${cle}`,
    value: f[cle],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      // Nouveau prix : « Prix validé » se décoche, à recocher une fois le prix vérifié (audit de sécurité 2, S2-02).
      setF(cle === "prix" ? { ...f, prix: e.target.value, prix_valide: e.target.value === prixInitial ? !plat.prix_a_valider : false } : { ...f, [cle]: e.target.value }),
  });
  // Un plat en vente au prix validé dont le nouveau prix n'est pas validé sort de la vente (la base le fait).
  const sortDeLaVente = !duJour && plat.commandable && !plat.prix_a_valider && !f.prix_valide;
  const retraitsAValider = plat.retraits.some((r) => r.a_valider);
  const doitEtreComplet = plat.origine !== "carte";

  return (
    <div className="ges-fiche">
      <form className="ges-fiche-form" onSubmit={sauver}>
        <div className="details deux">
          <div className="champ">
            <label htmlFor={`${ids}-nom`}>Nom affiché</label>
            <input {...champ("nom")} maxLength={80} required />
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-prix`}>Prix (CHF)</label>
            <input {...champ("prix")} inputMode="decimal" required />
            {!duJour && (
              <label className="option">
                <input type="checkbox" checked={f.prix_valide} onChange={(e) => setF({ ...f, prix_valide: e.target.checked })} />
                <span>Prix validé</span>
              </label>
            )}
            {sortDeLaVente && <p className="aide">Prix pas encore validé : le plat sort de la vente et y revient dès que la case est cochée.</p>}
          </div>
          <div className="champ champ-large">
            <label htmlFor={`${ids}-description`}>Description</label>
            <textarea id={`${ids}-description`} rows={3} maxLength={400} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
          {!duJour && (
            <div className="champ">
              <label htmlFor={`${ids}-categorie`}>Catégorie</label>
              <select id={`${ids}-categorie`} value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })}>
                {donnees.categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.nom}
                  </option>
                ))}
              </select>
            </div>
          )}
          {duJour && (
            <div className="champ">
              <label htmlFor={`${ids}-service`}>Service</label>
              <select id={`${ids}-service`} value={f.service} onChange={(e) => setF({ ...f, service: e.target.value as ServiceJour })}>
                {SERVICES.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="champ">
            <label htmlFor={`${ids}-station`}>Poste (imprimante)</label>
            <select id={`${ids}-station`} value={f.station} onChange={(e) => setF({ ...f, station: e.target.value as "pizza" | "cuisine" })}>
              <option value="pizza">Pizza</option>
              <option value="cuisine">Cuisine</option>
            </select>
          </div>
          {!duJour && <ChoixGroupes groupes={donnees.groupes} choisis={f.groupes} changer={(g) => setF({ ...f, groupes: g })} />}
          <div className="champ">
            <label htmlFor={`${ids}-provenance`}>Provenance affichée</label>
            <input {...champ("provenance")} maxLength={300} placeholder="Bœuf : Suisse ou Autriche" />
          </div>
          {!duJour && (
            <div className="champ">
              <label htmlFor={`${ids}-a_fournir`}>
                Provenances à fournir <span className="facultatif">séparées par des virgules</span>
              </label>
              <input {...champ("a_fournir")} />
            </div>
          )}
          <div className="champ champ-large">
            <label htmlFor={`${ids}-allergenes`}>Allergènes</label>
            <input {...champ("allergenes")} maxLength={300} placeholder="gluten, lait" />
            <p className="aide">Vide : la fiche affiche « Allergènes : demandez-nous au 022 792 16 89 » et la mise en ligne reste bloquée.</p>
          </div>
          {!estPhotoEnvoyee(plat.photo) && (
            <div className="champ">
              <label htmlFor={`${ids}-photo`}>Photo du shooting</label>
              <select id={`${ids}-photo`} value={photoChoisie ?? plat.photo ?? ""} onChange={(e) => setPhotoChoisie(e.target.value)}>
                <option value="">Sans photo</option>
                {PHOTOS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="champ-large">
            <label className="option">
              <input type="checkbox" checked={f.commandable} onChange={(e) => setF({ ...f, commandable: e.target.checked })} />
              <span>Commandable sur le site</span>
            </label>
            {doitEtreComplet && <p className="aide">{etatVente(plat.manques)}</p>}
          </div>
        </div>
        <div className="boutons-ligne">
          <button type="submit" className="bouton-principal" disabled={envoi}>
            Enregistrer le plat
          </button>
        </div>
      </form>

      <PhotoPlat plat={plat} recharger={recharger} />

      {!duJour && (
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
      )}
      {message && (
        <p className="aide-forte" role="status">
          {message}
        </p>
      )}
      {!duJour && (
        <div className="ges-retraits">
          <p className="aide">Archiver retire le plat de la carte sans l&apos;effacer. On peut le remettre plus tard.</p>
          <BoutonArchive plat={plat} recharger={recharger} />
        </div>
      )}
    </div>
  );
}

function ChoixGroupes({ groupes, choisis, changer }: { groupes: GroupeGestion[]; choisis: string[]; changer: (g: string[]) => void }) {
  return (
    <fieldset className="champ ges-groupes">
      <legend>Options proposées</legend>
      {groupes.map((g) => (
        <label key={g.slug} className="option">
          <input
            type="checkbox"
            checked={choisis.includes(g.slug)}
            onChange={(e) => changer(e.target.checked ? [...choisis, g.slug] : choisis.filter((x) => x !== g.slug))}
          />
          <span>
            {g.nom} <span className="facultatif">{g.choix_min > 0 ? "choix obligatoire" : `jusqu'à ${g.choix_max}`}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

// Formulaire de création. Le plat naît hors de la vente ; « Mettre en vente tout de suite » ne passe
// que si rien ne bloque la mise en ligne (la base le vérifie).
function NouveauPlat({ donnees, fermer, cree }: { donnees: DonneesCarte; fermer: () => void; cree: (slug: string) => Promise<void> }) {
  const ids = useId();
  const [f, setF] = useState({
    categorie: donnees.categories[0]?.slug ?? "",
    nom: "",
    description: "",
    prix: "",
    prix_valide: false,
    station: "",
    provenance: "",
    a_fournir: "",
    allergenes: "",
    retraits: "",
    groupes: [] as string[],
    commandable: false,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const txt = (cle: "nom" | "prix" | "provenance" | "a_fournir" | "allergenes" | "retraits") => ({
    id: `${ids}-${cle}`,
    value: f[cle],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [cle]: e.target.value }),
  });

  async function creer(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setMessage(null);
    const liste = (t: string) => t.split(",").map((x) => x.trim()).filter(Boolean);
    const r = await poster("/api/gestion/carte", {
      type: "nouveau_plat",
      champs: {
        categorie: f.categorie,
        nom: f.nom,
        description: f.description,
        prix: f.prix,
        prix_valide: f.prix_valide,
        station: f.station,
        provenance: f.provenance,
        provenances_a_fournir: liste(f.a_fournir),
        allergenes: f.allergenes,
        retraits: liste(f.retraits),
        groupes: f.groupes,
        commandable: f.commandable,
      },
    });
    setEnvoi(false);
    if (!r.ok) return setMessage(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    await cree(String(r.donnees.slug));
  }

  return (
    <form className="ges-bloc" onSubmit={creer} aria-labelledby={`${ids}-titre`}>
      <h2 id={`${ids}-titre`}>Nouveau plat</h2>
      <p className="aide">Il reste hors de la vente tant qu&apos;il manque le prix validé, les allergènes ou une provenance à fournir. Ajoutez sa photo une fois créé.</p>
      <div className="details deux">
        <div className="champ">
          <label htmlFor={`${ids}-categorie`}>Catégorie</label>
          <select id={`${ids}-categorie`} value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })} required>
            {donnees.categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.nom}
              </option>
            ))}
          </select>
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-station`}>Poste (imprimante)</label>
          <select id={`${ids}-station`} value={f.station} onChange={(e) => setF({ ...f, station: e.target.value })} required>
            <option value="">Choisir</option>
            <option value="pizza">Pizza</option>
            <option value="cuisine">Cuisine</option>
          </select>
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-nom`}>Nom affiché</label>
          <input {...txt("nom")} maxLength={80} required />
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-prix`}>Prix (CHF)</label>
          <input {...txt("prix")} inputMode="decimal" required />
          <label className="option">
            <input type="checkbox" checked={f.prix_valide} onChange={(e) => setF({ ...f, prix_valide: e.target.checked })} />
            <span>Prix validé</span>
          </label>
        </div>
        <div className="champ champ-large">
          <label htmlFor={`${ids}-description`}>Description</label>
          <textarea id={`${ids}-description`} rows={3} maxLength={400} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <ChoixGroupes groupes={donnees.groupes} choisis={f.groupes} changer={(g) => setF({ ...f, groupes: g })} />
        <div className="champ">
          <label htmlFor={`${ids}-retraits`}>
            Retraits gratuits <span className="facultatif">séparés par des virgules</span>
          </label>
          <input {...txt("retraits")} placeholder="oignons, olives" />
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-provenance`}>Provenance affichée</label>
          <input {...txt("provenance")} maxLength={300} placeholder="Bœuf : Suisse ou Autriche" />
          <p className="aide">Viande ou poisson : la provenance est obligatoire en vente à distance.</p>
        </div>
        <div className="champ">
          <label htmlFor={`${ids}-a_fournir`}>
            Provenances à fournir <span className="facultatif">séparées par des virgules</span>
          </label>
          <input {...txt("a_fournir")} />
        </div>
        <div className="champ champ-large">
          <label htmlFor={`${ids}-allergenes`}>Allergènes</label>
          <input {...txt("allergenes")} maxLength={300} placeholder="gluten, lait" />
        </div>
        <label className="option champ-large">
          <input type="checkbox" checked={f.commandable} onChange={(e) => setF({ ...f, commandable: e.target.checked })} />
          <span>Mettre en vente tout de suite si rien ne manque</span>
        </label>
      </div>
      <div className="boutons-ligne">
        <button type="submit" className="bouton-principal" disabled={envoi}>
          Créer le plat
        </button>
        <button type="button" className="lien" onClick={fermer}>
          Fermer
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

// Catégories : ajouter, renommer, réordonner. Le plat du jour reste toujours en tête de la carte.
function GestionCategories({ donnees, recharger }: { donnees: DonneesCarte; recharger: () => Promise<void> }) {
  const ids = useId();
  const [ouvert, setOuvert] = useState(false);
  const [noms, setNoms] = useState<Record<string, string>>({});
  const [nouvelle, setNouvelle] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const slugs = donnees.categories.map((c) => c.slug);

  async function action(corps: Record<string, unknown>, fait: string) {
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/carte", corps);
    setMessage(erreur ?? fait);
    if (!erreur) await recharger();
    return !erreur;
  }
  async function deplacer(i: number, sens: -1 | 1) {
    const liste = [...slugs];
    [liste[i], liste[i + sens]] = [liste[i + sens], liste[i]];
    await action({ type: "ordre_categories", slugs: liste }, "Ordre enregistré.");
  }

  return (
    <div className="ges-bloc ges-categories">
      <button type="button" className="bouton-second" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
        Catégories et leur ordre
      </button>
      {ouvert && (
        <>
          <p className="aide">L&apos;ordre est celui de la carte. Le plat du jour reste toujours en tête.</p>
          <ul className="ges-options">
            {donnees.categories.map((c, i) => (
              <li key={c.slug}>
                <div className="champ">
                  <label htmlFor={`${ids}-${c.slug}`} className="sr-only">
                    Nom de la catégorie {c.nom}
                  </label>
                  <input id={`${ids}-${c.slug}`} value={noms[c.slug] ?? c.nom} maxLength={40} onChange={(e) => setNoms({ ...noms, [c.slug]: e.target.value })} />
                </div>
                <span className="aide">
                  {c.plats.filter((p) => !p.archive).length} plat{c.plats.filter((p) => !p.archive).length > 1 ? "s" : ""}
                </span>
                {(noms[c.slug] ?? c.nom) !== c.nom && (
                  <button type="button" className="bouton-second" onClick={() => action({ type: "renommer_categorie", slug: c.slug, nom: noms[c.slug] }, "Catégorie renommée.")}>
                    Renommer
                  </button>
                )}
                <span className="ges-fleches">
                  <button type="button" className="bouton-second" disabled={i === 0} onClick={() => deplacer(i, -1)} aria-label={`Monter ${c.nom}`}>
                    Monter
                  </button>
                  <button type="button" className="bouton-second" disabled={i === slugs.length - 1} onClick={() => deplacer(i, 1)} aria-label={`Descendre ${c.nom}`}>
                    Descendre
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <form
            className="ges-retraits"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await action({ type: "nouvelle_categorie", nom: nouvelle }, "Catégorie ajoutée, en fin de carte. Elle s'affiche dès qu'un plat y est en vente.")) setNouvelle("");
            }}
          >
            <div className="champ">
              <label htmlFor={`${ids}-nouvelle`}>Nouvelle catégorie</label>
              <input id={`${ids}-nouvelle`} value={nouvelle} maxLength={40} onChange={(e) => setNouvelle(e.target.value)} required />
            </div>
            <button type="submit" className="bouton-second">
              Ajouter la catégorie
            </button>
          </form>
          {message && (
            <p className="aide-forte" role="status">
              {message}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Plat du jour ----------

export function GestionPlatDuJour({ donnees, recharger }: { donnees: DonneesCarte; recharger: () => Promise<void> }) {
  const ids = useId();
  const vide = { nom: "", description: "", prix: "", station: "cuisine", jour: donnees.aujourdhui, service: "journee" as ServiceJour, provenance: "", allergenes: "", commandable: true };
  const [f, setF] = useState(vide);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const txt = (cle: "nom" | "prix" | "provenance" | "allergenes") => ({
    id: `${ids}-${cle}`,
    value: f[cle],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [cle]: e.target.value }),
  });
  const aVenir = donnees.plats_du_jour.filter((p) => (p.jour ?? "") >= donnees.aujourdhui);
  const passes = donnees.plats_du_jour.filter((p) => (p.jour ?? "") < donnees.aujourdhui);

  async function publier(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setMessage(null);
    const r = await poster("/api/gestion/carte", { type: "plat_du_jour", champs: f });
    setEnvoi(false);
    if (!r.ok) return setMessage(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    const manques = (r.donnees.manques as string[] | undefined) ?? [];
    setMessage(
      r.donnees.commandable
        ? f.jour === donnees.aujourdhui
          ? "En ligne : il est en tête de la carte aujourd'hui."
          : `Enregistré : il sera en tête de la carte le ${jourCourt(f.jour)}.`
        : f.commandable
          ? `Enregistré, pas en vente : il manque ${motifs(manques).join(", ")}.`
          : "Enregistré, hors de la vente.",
    );
    setF({ ...vide, jour: f.jour, service: f.service, station: f.station });
    await recharger();
  }

  const liste = (plats: PlatGestion[]) => (
    <ul className="ges-plats">
      {plats.map((p) => (
        <li key={p.slug} className={p.commandable ? "" : "ges-retire"}>
          <button type="button" className="ges-ligne" aria-expanded={ouvert === p.slug} onClick={() => setOuvert(ouvert === p.slug ? null : p.slug)}>
            <span className="ges-nom">{p.nom}</span>
            <span className="ges-prix">
              {chf(p.prix_centimes)}
              {p.prix_a_valider ? " à valider" : ""}
            </span>
            <span className="ges-etats">
              <span className="ges-badge">
                {jourCourt(p.jour ?? "")}, {SERVICES.find(([v]) => v === p.jour_service)?.[1].toLowerCase()}
              </span>
              {!p.commandable && <span className="ges-badge">pas en vente</span>}
            </span>
          </button>
          {ouvert === p.slug && <FichePlat plat={p} donnees={donnees} recharger={recharger} />}
        </li>
      ))}
    </ul>
  );

  return (
    <section className="ges-carte">
      <form className="ges-bloc" onSubmit={publier} aria-labelledby={`${ids}-titre`}>
        <h2 id={`${ids}-titre`}>Nouveau plat du jour</h2>
        <p className="aide">Il s&apos;affiche en tête de la carte le jour choisi, puis disparaît seul le lendemain. Il s&apos;imprime comme les autres plats, au poste choisi.</p>
        <div className="details deux">
          <div className="champ">
            <label htmlFor={`${ids}-jour`}>Jour</label>
            <input id={`${ids}-jour`} type="date" min={donnees.aujourdhui} value={f.jour} onChange={(e) => setF({ ...f, jour: e.target.value })} required />
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-service`}>Service</label>
            <select id={`${ids}-service`} value={f.service} onChange={(e) => setF({ ...f, service: e.target.value as ServiceJour })}>
              {SERVICES.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-nom`}>Nom affiché</label>
            <input {...txt("nom")} maxLength={80} required />
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-prix`}>Prix (CHF)</label>
            <input {...txt("prix")} inputMode="decimal" required />
          </div>
          <div className="champ champ-large">
            <label htmlFor={`${ids}-description`}>Description</label>
            <textarea id={`${ids}-description`} rows={2} maxLength={400} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-station`}>Poste (imprimante)</label>
            <select id={`${ids}-station`} value={f.station} onChange={(e) => setF({ ...f, station: e.target.value })}>
              <option value="pizza">Pizza</option>
              <option value="cuisine">Cuisine</option>
            </select>
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-provenance`}>Provenance affichée</label>
            <input {...txt("provenance")} maxLength={300} placeholder="Bœuf : Suisse ou Autriche" />
          </div>
          <div className="champ champ-large">
            <label htmlFor={`${ids}-allergenes`}>Allergènes</label>
            <input {...txt("allergenes")} maxLength={300} placeholder="gluten, lait" />
            <p className="aide">Sans allergènes, le plat est enregistré mais pas mis en vente.</p>
          </div>
          <label className="option champ-large">
            <input type="checkbox" checked={f.commandable} onChange={(e) => setF({ ...f, commandable: e.target.checked })} />
            <span>Mettre en vente</span>
          </label>
        </div>
        <button type="submit" className="bouton-principal" disabled={envoi}>
          Publier le plat du jour
        </button>
        {message && (
          <p className="aide-forte" role="status">
            {message}
          </p>
        )}
      </form>
      <div className="ges-categorie">
        <h2>Aujourd&apos;hui et à venir</h2>
        {aVenir.length ? liste(aVenir) : <p className="aide">Aucun plat du jour prévu.</p>}
      </div>
      {passes.length > 0 && (
        <div className="ges-categorie">
          <h2>Les sept derniers jours</h2>
          <p className="aide">Plus affichés aux clients.</p>
          {liste(passes)}
        </div>
      )}
    </section>
  );
}

function jourCourt(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "numeric", timeZone: "UTC" });
}

// ---------- Suppléments ----------

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
          <NouvelleOption groupe={g} recharger={recharger} />
        </div>
      ))}
    </section>
  );
}

function NouvelleOption({ groupe, recharger }: { groupe: GroupeGestion; recharger: () => Promise<void> }) {
  const ids = useId();
  const [nom, setNom] = useState("");
  const [prix, setPrix] = useState("");
  const [valide, setValide] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function ajouter(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const erreur = await enregistrer("/api/gestion/carte", { type: "nouvelle_option", groupe: groupe.slug, champs: { nom, prix, prix_valide: valide } });
    setMessage(erreur ?? "Ajouté.");
    if (!erreur) {
      setNom("");
      setPrix("");
      setValide(false);
      await recharger();
    }
  }
  return (
    <form className="ges-retraits" onSubmit={ajouter}>
      <div className="champ">
        <label htmlFor={`${ids}-nom`}>Ajouter : {groupe.nom.toLowerCase()}</label>
        <input id={`${ids}-nom`} value={nom} maxLength={60} onChange={(e) => setNom(e.target.value)} required />
      </div>
      <div className="champ">
        <label htmlFor={`${ids}-prix`}>Prix (CHF)</label>
        <input id={`${ids}-prix`} inputMode="decimal" value={prix} onChange={(e) => setPrix(e.target.value)} required />
      </div>
      <label className="option">
        <input type="checkbox" checked={valide} onChange={(e) => setValide(e.target.checked)} />
        <span>Prix validé</span>
      </label>
      <button type="submit" className="bouton-second">
        Ajouter
      </button>
      {message && (
        <span className="aide" role="status">
          {message}
        </span>
      )}
    </form>
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
