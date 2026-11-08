import "server-only";
import { centimes } from "@/lib/gestion";
import { Classeur, type Feuille, type Valeur } from "@/lib/xlsx-lecture";

// Import du tableau docs/validation-carte.xlsx rempli par Jérémy (onglets Carte, Suppléments pizza,
// Choix des pâtes). On ne lit que les cases jaunes : prix validé, commandable, station, provenance,
// allergènes ; prix validé et « proposé » des suppléments. Une case vide ne change rien.
// Le résultat est un aperçu (avant, après) ; rien n'est écrit tant que le gérant n'a pas confirmé.

type PlatActuel = {
  slug: string;
  nom: string;
  prix_centimes: number;
  prix_a_valider: boolean;
  commandable: boolean;
  station: "pizza" | "cuisine";
  provenance: string | null;
  provenances_a_fournir: string[];
  allergenes: string | null;
};
type OptionActuelle = { nom: string; prix_centimes: number; prix_a_valider: boolean; actif: boolean };
export type CarteActuelle = {
  categories: { plats: PlatActuel[] }[];
  groupes: { slug: string; options: OptionActuelle[] }[];
};

export type Changement = { champ: string; avant: string; apres: string };
export type Apercu = {
  plats: (Record<string, unknown> & { slug: string })[];
  options: (Record<string, unknown> & { groupe: string; nom: string })[];
  lignes: { nom: string; changements: Changement[] }[];
  avertissements: string[];
};

const normal = (t: string) => t.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

function colonnes(f: Feuille): Map<string, number> {
  const m = new Map<string, number>();
  for (const [i, v] of f.get(1) ?? []) if (typeof v === "string") m.set(normal(v), i);
  return m;
}

const cellule = (f: Feuille, ligne: number, col: number): Valeur => f.get(ligne)?.get(col) ?? null;
const dernierRang = (f: Feuille) => Math.max(1, ...f.keys());

const chf = (c: number) => (c / 100).toFixed(2);

// « Bœuf : Suisse (carte de la salle); À fournir : jambon, thon » → provenance « Bœuf : Suisse »,
// à fournir [jambon, thon]. Comme l'amorçage de la carte (scripts/seed_carte.py) : la source entre
// parenthèses sert à Jérémy et n'est jamais affichée au client ; une provenance par ligne.
function lireProvenance(t: string): { provenance: string; aFournir: string[] } {
  const parts = t.split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
  const aFournir = parts.filter((x) => /^à fournir\s*:/i.test(x)).flatMap((x) => x.replace(/^à fournir\s*:/i, "").split(",").map((y) => y.trim()).filter(Boolean));
  const connues = parts.filter((x) => !/^à fournir\s*:/i.test(x)).map((x) => x.split(" (")[0].trim()).filter(Boolean);
  return { provenance: connues.join("\n"), aFournir };
}

function ouiNon(v: Valeur): boolean | null | "invalide" {
  if (v === null) return null;
  const t = normal(String(v));
  return t === "oui" ? true : t === "non" ? false : "invalide";
}

export function lireTableau(fichier: ArrayBuffer, actuelle: CarteActuelle): Apercu {
  const wb = new Classeur(fichier);
  const apercu: Apercu = { plats: [], options: [], lignes: [], avertissements: [] };

  const plats = new Map(actuelle.categories.flatMap((c) => c.plats).map((p) => [normal(p.nom), p]));
  const carte = wb.feuille("Carte");
  if (!carte) throw new Error("Onglet « Carte » introuvable : est-ce bien le tableau docs/validation-carte.xlsx ?");
  const col = colonnes(carte);
  const iNom = col.get("nom");
  const iPrix = col.get("prix validé (chf)");
  const iCmd = col.get("commandable (oui/non)");
  const iStation = col.get("station (pizza/cuisine)");
  const iProv = col.get("provenance");
  const iAll = col.get("allergènes");
  if (!iNom || !iPrix || !iCmd || !iStation || !iProv || !iAll) throw new Error("Colonnes de l'onglet « Carte » introuvables : le tableau a-t-il été modifié ?");

  for (let r = 2; r <= dernierRang(carte); r++) {
    const nom = cellule(carte, r, iNom);
    if (typeof nom !== "string") continue;
    const p = plats.get(normal(nom));
    if (!p) {
      apercu.avertissements.push(`Ligne ${r} : « ${nom} » n'existe pas dans la carte du site, ligne ignorée.`);
      continue;
    }
    const champs: Record<string, unknown> = {};
    const changements: Changement[] = [];

    const prix = cellule(carte, r, iPrix);
    if (prix !== null) {
      const c = centimes(prix);
      if (c === null) apercu.avertissements.push(`Ligne ${r} (${nom}) : prix validé « ${prix} » illisible, ignoré.`);
      else if (c !== p.prix_centimes || p.prix_a_valider) {
        champs.prix_centimes = c;
        champs.prix_valide = true;
        changements.push({ champ: "Prix", avant: `${chf(p.prix_centimes)}${p.prix_a_valider ? " (à valider)" : ""}`, apres: `${chf(c)} (validé)` });
      }
    }
    const cmdBrut = cellule(carte, r, iCmd);
    const cmd = ouiNon(cmdBrut);
    if (cmd === "invalide") apercu.avertissements.push(`Ligne ${r} (${nom}) : « Commandable » vaut « ${cmdBrut} », oui ou non attendu, ignoré.`);
    else if (cmd !== null && cmd !== p.commandable) {
      champs.commandable = cmd;
      changements.push({ champ: "Commandable", avant: p.commandable ? "oui" : "non", apres: cmd ? "oui" : "non" });
    }
    const station = cellule(carte, r, iStation);
    if (station !== null) {
      const s = normal(String(station));
      if (s !== "pizza" && s !== "cuisine") apercu.avertissements.push(`Ligne ${r} (${nom}) : station « ${station} » inconnue, ignorée.`);
      else if (s !== p.station) {
        champs.station = s;
        changements.push({ champ: "Station", avant: p.station, apres: s });
      }
    }
    const prov = cellule(carte, r, iProv);
    if (prov !== null) {
      const { provenance, aFournir } = lireProvenance(String(prov));
      if (provenance !== (p.provenance ?? "") || aFournir.join(",") !== p.provenances_a_fournir.join(",")) {
        champs.provenance = provenance;
        champs.provenances_a_fournir = aFournir;
        const texte = (pr: string | null, af: string[]) =>
          [pr?.replace(/\n/g, "; "), af.length ? `à fournir : ${af.join(", ")}` : ""].filter(Boolean).join("; ") || "vide";
        changements.push({ champ: "Provenance", avant: texte(p.provenance, p.provenances_a_fournir), apres: texte(provenance, aFournir) });
      }
    }
    const all = cellule(carte, r, iAll);
    if (all !== null && String(all) !== (p.allergenes ?? "")) {
      if (String(all).length > 300) apercu.avertissements.push(`Ligne ${r} (${nom}) : allergènes trop longs, ignorés.`);
      else {
        champs.allergenes = String(all);
        changements.push({ champ: "Allergènes", avant: p.allergenes ?? "vide", apres: String(all) });
      }
    }
    if (changements.length) {
      apercu.plats.push({ slug: p.slug, ...champs });
      apercu.lignes.push({ nom, changements });
    }
  }

  // Suppléments (prix validé, proposé oui/non) et choix des pâtes (supplément validé).
  const onglets: [string, string, string, string | null][] = [
    ["Suppléments pizza", "supplements-pizza", "prix validé (chf)", "proposé sur le site (oui/non)"],
    ["Choix des pâtes", "choix-pates", "supplément validé (chf)", null],
  ];
  for (const [titre, groupe, colPrix, colActif] of onglets) {
    const ws = wb.feuille(titre);
    const g = actuelle.groupes.find((x) => x.slug === groupe);
    if (!ws || !g) continue;
    const cs = colonnes(ws);
    const iP = cs.get(colPrix);
    const iA = colActif ? cs.get(colActif) : undefined;
    const opts = new Map(g.options.map((o) => [normal(o.nom), o]));
    for (let r = 2; r <= dernierRang(ws); r++) {
      const nom = cellule(ws, r, 1);
      if (typeof nom !== "string") continue;
      const o = opts.get(normal(nom));
      if (!o) continue;
      const champs: Record<string, unknown> = {};
      const changements: Changement[] = [];
      const prix = iP ? cellule(ws, r, iP) : null;
      if (prix !== null) {
        const c = centimes(prix);
        if (c === null) apercu.avertissements.push(`${titre}, ligne ${r} (${nom}) : prix « ${prix} » illisible, ignoré.`);
        else if (c !== o.prix_centimes || o.prix_a_valider) {
          champs.prix_centimes = c;
          champs.prix_valide = true;
          changements.push({ champ: "Prix", avant: `${chf(o.prix_centimes)}${o.prix_a_valider ? " (à valider)" : ""}`, apres: `${chf(c)} (validé)` });
        }
      }
      const actif = iA ? ouiNon(cellule(ws, r, iA)) : null;
      if (actif === "invalide") apercu.avertissements.push(`${titre}, ligne ${r} (${nom}) : oui ou non attendu, ignoré.`);
      else if (actif !== null && actif !== o.actif) {
        champs.actif = actif;
        changements.push({ champ: "Proposé", avant: o.actif ? "oui" : "non", apres: actif ? "oui" : "non" });
      }
      if (changements.length) {
        apercu.options.push({ groupe, nom: o.nom, ...champs });
        apercu.lignes.push({ nom: `${titre} : ${o.nom}`, changements });
      }
    }
  }
  return apercu;
}
