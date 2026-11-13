"use client";

import { useCallback, useEffect, useState } from "react";
import { useCarte } from "@/components/gestion/contexte-carte";
import { EtatErreur, PanneauLateral, TableauDonnees, montant, useConfirmer, useNotifier, type Colonne } from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";
import "./carte.css";

// Menus et formules (vague 3), construits désactivés : l'interrupteur menus_actifs reste faux et chaque menu
// naît inactif, son prix à valider, tant que Jérémy n'a pas décidé de vendre des menus. Aucun prix proposé
// par l'écran : le gérant saisit tout.

type PlatEtape = { slug: string; nom: string; supplement_centimes: number };
type Etape = { nom: string; choix_min: number; choix_max: number; categorie: string | null; plats: PlatEtape[] };
type Menu = {
  slug: string;
  nom: string;
  description: string;
  prix_centimes: number;
  prix_a_valider: boolean;
  actif: boolean;
  archive: boolean;
  etapes: Etape[];
  manques: string[];
};
type Donnees = { actifs: boolean; menus: Menu[] };

const etat = (m: Menu) => (m.archive ? "Archivé" : m.actif ? "Actif" : "Inactif");

const COLONNES: Colonne<Menu>[] = [
  { cle: "nom", titre: "Menu", valeur: (m) => m.nom, fixe: true },
  { cle: "prix", titre: "Prix CHF", valeur: (m) => montant(m.prix_centimes), nombre: true },
  { cle: "etapes", titre: "Étapes", valeur: (m) => m.etapes.map((e) => e.nom).join(", ") || "Aucune" },
  { cle: "etat", titre: "État", valeur: etat },
  { cle: "manques", titre: "À compléter", valeur: (m) => m.manques.join(", ") || "Rien" },
];

export function GestionMenus() {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState(false);

  const charger = useCallback(async () => {
    try {
      const rep = await fetch("/api/gestion/menus", { cache: "no-store" });
      if (!rep.ok) throw new Error();
      setDonnees((await rep.json()) as Donnees);
      setErreur(null);
    } catch {
      setErreur("Les menus n'ont pas pu être chargés. Vérifiez la connexion et réessayez.");
    }
  }, []);
  useEffect(() => {
    charger();
  }, [charger]);

  async function basculer() {
    if (!donnees) return;
    const activer = !donnees.actifs;
    const ok = await confirmer(
      activer
        ? {
            titre: "Proposer les menus aux clients ?",
            texte: "Les menus actifs, au prix validé, apparaîtront sur la carte dès que leur affichage sera branché. Vendre des menus est une décision de Jérémy : n'activez qu'avec son accord.",
            oui: "Proposer les menus",
            danger: true,
          }
        : { titre: "Retirer les menus du site ?", texte: "Plus aucun menu n'est proposé aux clients.", oui: "Retirer les menus" },
    );
    if (!ok) return;
    const r = await poster("/api/gestion/menus", { action: "interrupteur", actif: activer });
    notifier(r.ok ? { texte: activer ? "Menus proposés." : "Menus retirés du site.", ton: "succes" } : { texte: String(r.donnees.erreur ?? "Pas enregistré."), ton: "erreur" });
    await charger();
  }

  if (erreur && !donnees) return <EtatErreur texte={erreur} reessayer={charger} />;
  const menu = ouvert ? (donnees?.menus.find((m) => m.slug === ouvert) ?? null) : null;

  return (
    <div className="bo-carte">
      <div className="bo-promo-interrupteur" role="status">
        <p>
          <strong>{donnees ? (donnees.actifs ? "Menus proposés aux clients." : "Menus pas proposés aux clients.") : "Chargement…"}</strong>{" "}
          {donnees && !donnees.actifs && "Préparez-les ici, aucun n'est montré aux clients, même actif."}
        </p>
        {donnees && (
          <button type="button" className="bo-bouton bo-bouton-second" onClick={basculer}>
            {donnees.actifs ? "Retirer les menus du site" : "Proposer les menus"}
          </button>
        )}
      </div>
      <div className="bo-carte-tete">
        <p className="bo-champ-aide">Un menu a un prix fixe et des étapes : une pizza au choix, un dessert, une boisson. Il naît inactif.</p>
        <button type="button" className="bo-bouton bo-bouton-principal" onClick={() => setNouveau(true)}>
          Nouveau menu
        </button>
      </div>
      <TableauDonnees<Menu>
        titre="Menus"
        colonnes={COLONNES}
        lignes={donnees?.menus ?? null}
        cleLigne={(m) => m.slug}
        erreur={erreur}
        onReessayer={charger}
        onOuvrir={(m) => setOuvert(m.slug)}
        memoire="menus"
        vide={{ titre: "Aucun menu.", texte: "Créez un menu pour le préparer ; il ne sera proposé qu'une fois activé, avec l'accord de Jérémy." }}
      />
      {nouveau && (
        <PanneauLateral titre="Nouveau menu" onFermer={() => setNouveau(false)}>
          <FormulaireMenu
            fini={async (slug) => {
              setNouveau(false);
              await charger();
              setOuvert(slug);
            }}
          />
        </PanneauLateral>
      )}
      {menu && (
        <PanneauLateral titre={menu.nom} sousTitre={`${montant(menu.prix_centimes)} CHF, ${etat(menu).toLowerCase()}`} onFermer={() => setOuvert(null)} large>
          <FormulaireMenu key={`f-${menu.slug}-${menu.prix_centimes}-${menu.nom}`} existant={menu} fini={async () => charger()} />
          <EtapesMenu key={`e-${menu.slug}-${JSON.stringify(menu.etapes)}`} menu={menu} fini={charger} />
        </PanneauLateral>
      )}
    </div>
  );
}

function FormulaireMenu({ existant, fini }: { existant?: Menu; fini: (slug: string) => Promise<void> }) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const [f, setF] = useState({
    nom: existant?.nom ?? "",
    description: existant?.description ?? "",
    prix: existant ? (existant.prix_centimes / 100).toFixed(2) : "",
    valide: existant ? !existant.prix_a_valider : false,
  });
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    const champs = { nom: f.nom, description: f.description, prix: f.prix, prix_valide: f.valide };
    const r = await poster("/api/gestion/menus", existant ? { action: "modifier", menu: existant.slug, champs } : { action: "creer", champs });
    if (!r.ok) return setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    notifier({ texte: existant ? "Menu enregistré." : "Menu créé, inactif. Ajoutez ses étapes.", ton: "succes" });
    await fini(existant?.slug ?? String(r.donnees.menu));
  }

  async function action(corps: Record<string, unknown>, texte: string) {
    const r = await poster("/api/gestion/menus", corps);
    notifier(r.ok ? { texte, ton: "succes" } : { texte: String(r.donnees.erreur ?? "Pas enregistré."), ton: "erreur" });
    if (existant) await fini(existant.slug);
  }

  async function archiver() {
    if (!existant) return;
    const ok = await confirmer({ titre: `Archiver ${existant.nom} ?`, texte: "Il quitte la vente. On peut le remettre plus tard, inactif.", oui: `Archiver ${existant.nom}`, danger: true });
    if (ok) await action({ action: "archiver", menu: existant.slug, archiver: true }, `${existant.nom} archivé.`);
  }

  return (
    <form onSubmit={envoyer} className="bo-formulaire">
      {existant && !existant.archive && (
        <div className="bo-ligne-champs">
          <p>{existant.manques.length ? `Pour l'activer, il manque : ${existant.manques.join(", ")}.` : "Rien ne manque, il peut être activé."}</p>
          <button
            type="button"
            className="bo-bouton bo-bouton-second"
            onClick={() => action({ action: "modifier", menu: existant.slug, champs: { actif: !existant.actif } }, existant.actif ? "Menu inactif." : "Menu actif.")}
          >
            {existant.actif ? "Rendre inactif" : "Activer ce menu"}
          </button>
        </div>
      )}
      {existant?.archive && (
        <div className="bo-ligne-champs">
          <p>Archivé, hors de la vente.</p>
          <button type="button" className="bo-bouton bo-bouton-second" onClick={() => action({ action: "archiver", menu: existant.slug, archiver: false }, `${existant.nom} remis, inactif.`)}>
            Remettre ce menu
          </button>
        </div>
      )}
      <div className="bo-champ">
        <label htmlFor="menu-nom">Nom du menu</label>
        <input id="menu-nom" required maxLength={80} value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} />
      </div>
      <div className="bo-champ">
        <label htmlFor="menu-description">Description</label>
        <textarea id="menu-description" maxLength={400} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      <div className="bo-champ">
        <label htmlFor="menu-prix">Prix (CHF)</label>
        <input id="menu-prix" required inputMode="decimal" value={f.prix} onChange={(e) => setF({ ...f, prix: e.target.value, valide: false })} />
      </div>
      <label className="bo-case">
        <input type="checkbox" checked={f.valide} onChange={(e) => setF({ ...f, valide: e.target.checked })} />
        <span>Prix validé</span>
      </label>
      {erreur && (
        <p className="bo-erreur" role="alert">
          {erreur}
        </p>
      )}
      <div className="bo-ligne-champs">
        <button type="submit" className="bo-bouton bo-bouton-principal">
          {existant ? "Enregistrer le menu" : "Créer le menu"}
        </button>
        {existant && !existant.archive && (
          <button type="button" className="bo-bouton bo-bouton-discret" onClick={archiver}>
            Archiver ce menu
          </button>
        )}
      </div>
    </form>
  );
}

type EtapeSaisie = { nom: string; min: string; max: string; categorie: string; plats: Record<string, string> };

function EtapesMenu({ menu, fini }: { menu: Menu; fini: () => Promise<void> }) {
  const notifier = useNotifier();
  const { carte } = useCarte();
  const [etapes, setEtapes] = useState<EtapeSaisie[]>(
    menu.etapes.map((e) => ({
      nom: e.nom,
      min: String(e.choix_min),
      max: String(e.choix_max),
      categorie: e.categorie ?? "",
      plats: Object.fromEntries(e.plats.map((p) => [p.slug, p.supplement_centimes ? (p.supplement_centimes / 100).toFixed(2) : ""])),
    })),
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const categories = carte?.categories ?? [];
  const changer = (i: number, e: Partial<EtapeSaisie>) => setEtapes((es) => es.map((x, j) => (j === i ? { ...x, ...e } : x)));

  async function sauver() {
    setErreur(null);
    const corps = etapes.map((e) => ({
      nom: e.nom,
      choix_min: Number(e.min),
      choix_max: Number(e.max),
      categorie: e.categorie || null,
      plats: Object.entries(e.plats).map(([slug, supplement]) => ({ slug, supplement })),
    }));
    const r = await poster("/api/gestion/menus", { action: "etapes", menu: menu.slug, etapes: corps });
    if (!r.ok) return setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    notifier({ texte: "Étapes enregistrées.", ton: "succes" });
    await fini();
  }

  return (
    <section className="bo-fiche-partie" aria-labelledby={`etapes-${menu.slug}`}>
      <h3 id={`etapes-${menu.slug}`}>Étapes</h3>
      <p className="bo-champ-aide">Chaque étape propose une catégorie entière ou des plats cochés. Un supplément s&apos;ajoute au prix du menu quand le client choisit ce plat.</p>
      {etapes.map((e, i) => {
        const cat = categories.find((c) => c.slug === e.categorie);
        const proposes = categories.flatMap((c) => c.plats.filter((p) => !p.archive).map((p) => ({ ...p, categorie: c.nom })));
        return (
          <fieldset key={i} className="bo-etape">
            <legend>Étape {i + 1}</legend>
            <div className="bo-ligne-champs bo-ligne-champs-haut">
              <div className="bo-champ">
                <label htmlFor={`etape-nom-${i}`}>Nom vu par le client</label>
                <input id={`etape-nom-${i}`} maxLength={60} value={e.nom} onChange={(x) => changer(i, { nom: x.target.value })} />
              </div>
              <div className="bo-champ">
                <label htmlFor={`etape-min-${i}`}>Minimum</label>
                <input id={`etape-min-${i}`} type="number" min={0} max={10} value={e.min} onChange={(x) => changer(i, { min: x.target.value })} />
              </div>
              <div className="bo-champ">
                <label htmlFor={`etape-max-${i}`}>Maximum</label>
                <input id={`etape-max-${i}`} type="number" min={1} max={10} value={e.max} onChange={(x) => changer(i, { max: x.target.value })} />
              </div>
              <div className="bo-champ">
                <label htmlFor={`etape-cat-${i}`}>Toute une catégorie</label>
                <select id={`etape-cat-${i}`} value={e.categorie} onChange={(x) => changer(i, { categorie: x.target.value })}>
                  <option value="">Non, seulement les plats cochés</option>
                  {categories.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.nom}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <details>
              <summary>{cat ? `Suppléments dans ${cat.nom}` : "Plats proposés"} ({Object.keys(e.plats).length})</summary>
              <ul className="bo-ordre">
                {(cat ? cat.plats.filter((p) => !p.archive).map((p) => ({ ...p, categorie: cat.nom })) : proposes).map((p) => {
                  const coche = p.slug in e.plats;
                  return (
                    <li key={p.slug}>
                      <label className="bo-case">
                        <input
                          type="checkbox"
                          checked={coche}
                          onChange={(x) => {
                            const plats = { ...e.plats };
                            if (x.target.checked) plats[p.slug] = "";
                            else delete plats[p.slug];
                            changer(i, { plats });
                          }}
                        />
                        <span>
                          {p.nom}
                          {!cat && <span className="bo-champ-aide"> ({p.categorie})</span>}
                        </span>
                      </label>
                      {coche && (
                        <span className="bo-champ">
                          <label htmlFor={`sup-${i}-${p.slug}`} className="sr-only">
                            Supplément pour {p.nom} (CHF)
                          </label>
                          <input
                            id={`sup-${i}-${p.slug}`}
                            className="bo-prix-ligne"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={e.plats[p.slug]}
                            onChange={(x) => changer(i, { plats: { ...e.plats, [p.slug]: x.target.value } })}
                          />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
            <button type="button" className="bo-bouton bo-bouton-discret bo-bouton-petit" onClick={() => setEtapes((es) => es.filter((_, j) => j !== i))}>
              Retirer l&apos;étape {i + 1}
            </button>
          </fieldset>
        );
      })}
      {erreur && (
        <p className="bo-erreur" role="alert">
          {erreur}
        </p>
      )}
      <div className="bo-ligne-champs">
        <button
          type="button"
          className="bo-bouton bo-bouton-second"
          disabled={etapes.length >= 6}
          onClick={() => setEtapes((es) => [...es, { nom: "", min: "1", max: "1", categorie: "", plats: {} }])}
        >
          Ajouter une étape
        </button>
        <button type="button" className="bo-bouton bo-bouton-principal" onClick={sauver}>
          Enregistrer les étapes
        </button>
      </div>
    </section>
  );
}
