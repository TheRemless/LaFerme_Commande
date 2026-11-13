"use client";

import { useCallback, useEffect, useState } from "react";
import { jourCourtFr } from "@/components/gestion/carte/ListeCarte";
import { EtatErreur, PanneauLateral, TableauDonnees, montant, nombre, useConfirmer, useNotifier, type Colonne } from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";
import "./carte.css";

// Codes promo (vague 3), construits désactivés : l'interrupteur général reste faux et chaque code naît
// inactif tant que Jérémy n'a pas décidé de l'offre (docs/lancement/offre-premiere-commande.md). Aucun
// montant n'est proposé par l'écran : le gérant saisit tout.

type Code = {
  code: string;
  libelle: string;
  type: "pourcentage" | "montant" | "livraison";
  valeur: number | null;
  minimum_centimes: number;
  debut: string | null;
  fin: string | null;
  plafond_utilisations: number | null;
  premiere_commande: boolean;
  une_fois_par_client: boolean;
  actif: boolean;
  commandes: number;
  remise_centimes: number;
  total_centimes: number;
};
type Donnees = { actifs: boolean; codes: Code[] };

export function offreTexte(c: Pick<Code, "type" | "valeur">): string {
  if (c.type === "livraison") return "Livraison offerte";
  if (c.type === "pourcentage") return `${c.valeur} % des plats`;
  return `CHF ${montant(c.valeur ?? 0)} de moins`;
}

function datesTexte(c: Code): string {
  if (!c.debut && !c.fin) return "Sans date";
  if (c.debut && c.fin) return `Du ${jourCourtFr(c.debut)} au ${jourCourtFr(c.fin)}`;
  return c.debut ? `Dès le ${jourCourtFr(c.debut)}` : `Jusqu'au ${jourCourtFr(c.fin!)}`;
}

const COLONNES: Colonne<Code>[] = [
  { cle: "code", titre: "Code", valeur: (c) => c.code, fixe: true },
  { cle: "libelle", titre: "Support", valeur: (c) => c.libelle },
  { cle: "offre", titre: "Offre", valeur: offreTexte },
  { cle: "dates", titre: "Dates", valeur: datesTexte },
  { cle: "etat", titre: "État", valeur: (c) => (c.actif ? "Actif" : "Inactif") },
  { cle: "commandes", titre: "Commandes", valeur: (c) => nombre(c.commandes), nombre: true },
  { cle: "remise", titre: "Remise CHF", valeur: (c) => montant(c.remise_centimes), nombre: true },
  { cle: "total", titre: "Encaissé CHF", valeur: (c) => montant(c.total_centimes), nombre: true },
  { cle: "minimum", titre: "Minimum CHF", valeur: (c) => (c.minimum_centimes ? montant(c.minimum_centimes) : "Aucun"), cacheeParDefaut: true },
  { cle: "plafond", titre: "Plafond", valeur: (c) => (c.plafond_utilisations ? nombre(c.plafond_utilisations) : "Aucun"), cacheeParDefaut: true },
];

export function GestionPromotions() {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState(false);

  const charger = useCallback(async () => {
    try {
      const rep = await fetch("/api/gestion/promotions", { cache: "no-store" });
      if (!rep.ok) throw new Error();
      setDonnees((await rep.json()) as Donnees);
      setErreur(null);
    } catch {
      setErreur("Les codes n'ont pas pu être chargés. Vérifiez la connexion et réessayez.");
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
            titre: "Activer les codes promo ?",
            texte: "Le champ « Code » apparaît au panier et les codes actifs donnent leur remise. L'offre est une décision de Jérémy : n'activez qu'avec son accord.",
            oui: "Activer les codes promo",
            danger: true,
          }
        : { titre: "Désactiver les codes promo ?", texte: "Le champ « Code » disparaît du panier ; aucun code ne s'applique plus.", oui: "Désactiver les codes promo" },
    );
    if (!ok) return;
    const r = await poster("/api/gestion/promotions", { action: "interrupteur", actif: activer });
    notifier(r.ok ? { texte: activer ? "Codes promo activés." : "Codes promo désactivés.", ton: "succes" } : { texte: String(r.donnees.erreur ?? "Pas enregistré."), ton: "erreur" });
    await charger();
  }

  if (erreur && !donnees) return <EtatErreur texte={erreur} reessayer={charger} />;
  const code = ouvert ? donnees?.codes.find((c) => c.code === ouvert) ?? null : null;

  return (
    <div className="bo-carte">
      <div className="bo-promo-interrupteur" role="status">
        <p>
          <strong>{donnees ? (donnees.actifs ? "Codes promo activés." : "Codes promo désactivés.") : "Chargement…"}</strong>{" "}
          {donnees && !donnees.actifs && "Le site ne montre pas de champ « Code » et aucun code ne s'applique, même actif."}
        </p>
        {donnees && (
          <button type="button" className="bo-bouton bo-bouton-second" onClick={basculer}>
            {donnees.actifs ? "Désactiver les codes promo" : "Activer les codes promo"}
          </button>
        )}
      </div>
      <div className="bo-carte-tete">
        <p className="bo-champ-aide">Un code par support (flyer, autocollant, fiche Google) pour savoir lequel ramène des commandes. Un code naît inactif.</p>
        <button type="button" className="bo-bouton bo-bouton-principal" onClick={() => setNouveau(true)}>
          Nouveau code
        </button>
      </div>
      <TableauDonnees<Code>
        titre="Codes promo"
        colonnes={COLONNES}
        lignes={donnees?.codes ?? null}
        cleLigne={(c) => c.code}
        erreur={erreur}
        onReessayer={charger}
        onOuvrir={(c) => setOuvert(c.code)}
        memoire="promotions"
        vide={{ titre: "Aucun code.", texte: "Créez un code par support quand l'offre de bienvenue sera décidée." }}
      />
      {nouveau && (
        <PanneauLateral titre="Nouveau code" onFermer={() => setNouveau(false)}>
          <FormulaireCode
            fini={async (c) => {
              setNouveau(false);
              await charger();
              setOuvert(c);
            }}
          />
        </PanneauLateral>
      )}
      {code && (
        <PanneauLateral titre={code.code} sousTitre={`${code.libelle}, ${code.actif ? "actif" : "inactif"}`} onFermer={() => setOuvert(null)}>
          <FormulaireCode key={JSON.stringify(code)} existant={code} fini={async () => charger()} />
        </PanneauLateral>
      )}
    </div>
  );
}

function FormulaireCode({ existant, fini }: { existant?: Code; fini: (code: string) => Promise<void> }) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const fige = !!existant && existant.commandes > 0;
  const [f, setF] = useState({
    code: existant?.code ?? "",
    libelle: existant?.libelle ?? "",
    type: existant?.type ?? "pourcentage",
    valeur: existant?.valeur == null ? "" : existant.type === "montant" ? (existant.valeur / 100).toFixed(2) : String(existant.valeur),
    minimum: existant?.minimum_centimes ? (existant.minimum_centimes / 100).toFixed(2) : "",
    debut: existant?.debut?.slice(0, 10) ?? "",
    fin: existant?.fin?.slice(0, 10) ?? "",
    plafond: existant?.plafond_utilisations ? String(existant.plafond_utilisations) : "",
    premiere: existant?.premiere_commande ?? false,
    unefois: existant?.une_fois_par_client ?? true,
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const centimes = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);

  function champs(): Record<string, unknown> {
    const c: Record<string, unknown> = {
      libelle: f.libelle,
      minimum_centimes: f.minimum ? centimes(f.minimum) : 0,
      debut: f.debut || null,
      fin: f.fin || null,
      plafond_utilisations: f.plafond ? Number(f.plafond) : null,
      premiere_commande: f.premiere,
      une_fois_par_client: f.unefois,
    };
    if (!fige) {
      c.type = f.type;
      if (f.type === "pourcentage") c.valeur = Number(f.valeur);
      if (f.type === "montant") c.valeur = centimes(f.valeur);
    }
    if (!existant) c.code = f.code;
    return c;
  }

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/gestion/promotions", existant ? { action: "modifier", code: existant.code, champs: champs() } : { action: "creer", champs: champs() });
    setEnvoi(false);
    if (!r.ok) return setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    notifier({ texte: existant ? "Code enregistré." : `Code ${String(r.donnees.code)} créé, inactif.`, ton: "succes" });
    await fini(existant?.code ?? String(r.donnees.code));
  }

  async function activer(actif: boolean) {
    if (!existant) return;
    if (actif) {
      const ok = await confirmer({
        titre: `Activer ${existant.code} ?`,
        texte: `${offreTexte(existant)}. Il s'applique dès que les codes promo sont activés pour tout le site.`,
        oui: `Activer ${existant.code}`,
      });
      if (!ok) return;
    }
    const r = await poster("/api/gestion/promotions", { action: "modifier", code: existant.code, champs: { actif } });
    notifier(r.ok ? { texte: actif ? `${existant.code} actif.` : `${existant.code} inactif.`, ton: "succes" } : { texte: String(r.donnees.erreur ?? "Pas enregistré."), ton: "erreur" });
    await fini(existant.code);
  }

  const champ = (cle: keyof typeof f) => ({
    value: f[cle] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [cle]: e.target.value }),
  });

  return (
    <form onSubmit={envoyer} className="bo-formulaire">
      {existant && (
        <div className="bo-ligne-champs">
          <p>
            {existant.commandes} commande{existant.commandes > 1 ? "s" : ""}, CHF {montant(existant.remise_centimes)} de remise, CHF {montant(existant.total_centimes)} encaissés.
          </p>
          <button type="button" className="bo-bouton bo-bouton-second" onClick={() => activer(!existant.actif)}>
            {existant.actif ? "Rendre inactif" : "Activer ce code"}
          </button>
        </div>
      )}
      {!existant && (
        <div className="bo-champ">
          <label htmlFor="code-code">Code</label>
          <input id="code-code" required maxLength={20} autoCapitalize="characters" {...champ("code")} />
          <p className="bo-champ-aide">3 à 20 lettres, chiffres ou tirets, sans espace. Le client peut le taper en minuscules.</p>
        </div>
      )}
      <div className="bo-champ">
        <label htmlFor="code-libelle">Support</label>
        <input id="code-libelle" required maxLength={60} {...champ("libelle")} />
        <p className="bo-champ-aide">Nom interne, jamais montré au client, par exemple Flyer automne ou Fiche Google.</p>
      </div>
      <fieldset className="bo-choix" disabled={fige}>
        <legend>Offre{fige ? " (figée : le code a déjà servi)" : ""}</legend>
        {[
          ["pourcentage", "Pourcentage des plats"],
          ["montant", "Montant fixe"],
          ["livraison", "Livraison offerte"],
        ].map(([v, t]) => (
          <label key={v} className="bo-case">
            <input type="radio" name="code-type" checked={f.type === v} onChange={() => setF({ ...f, type: v as Code["type"] })} />
            <span>{t}</span>
          </label>
        ))}
      </fieldset>
      {f.type !== "livraison" && (
        <div className="bo-champ">
          <label htmlFor="code-valeur">{f.type === "pourcentage" ? "Pourcentage (1 à 100)" : "Montant (CHF)"}</label>
          <input id="code-valeur" inputMode="decimal" required disabled={fige} {...champ("valeur")} />
        </div>
      )}
      <div className="bo-ligne-champs bo-ligne-champs-haut">
        <div className="bo-champ">
          <label htmlFor="code-minimum">Minimum de plats (CHF)</label>
          <input id="code-minimum" inputMode="decimal" {...champ("minimum")} />
          <p className="bo-champ-aide">Laissez vide s'il n'y a pas de minimum.</p>
        </div>
        <div className="bo-champ">
          <label htmlFor="code-plafond">Plafond d&apos;utilisations</label>
          <input id="code-plafond" type="number" min={1} {...champ("plafond")} />
          <p className="bo-champ-aide">Laissez vide s'il n'y a pas de plafond.</p>
        </div>
      </div>
      <div className="bo-ligne-champs">
        <div className="bo-champ">
          <label htmlFor="code-debut">Début</label>
          <input id="code-debut" type="date" {...champ("debut")} />
        </div>
        <div className="bo-champ">
          <label htmlFor="code-fin">Fin (comprise)</label>
          <input id="code-fin" type="date" {...champ("fin")} />
        </div>
      </div>
      <label className="bo-case">
        <input type="checkbox" checked={f.unefois} onChange={(e) => setF({ ...f, unefois: e.target.checked })} />
        <span>Une fois par client (même e-mail, téléphone ou adresse)</span>
      </label>
      <label className="bo-case">
        <input type="checkbox" checked={f.premiere} onChange={(e) => setF({ ...f, premiere: e.target.checked })} />
        <span>Première commande seulement</span>
      </label>
      {erreur && (
        <p className="bo-erreur" role="alert">
          {erreur}
        </p>
      )}
      <button type="submit" className="bo-bouton bo-bouton-principal" disabled={envoi}>
        {envoi ? "Enregistrement…" : existant ? "Enregistrer le code" : "Créer le code"}
      </button>
    </form>
  );
}
