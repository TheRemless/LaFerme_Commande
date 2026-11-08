import { unzipSync, strFromU8 } from "fflate";

// Lecture minimale d'un fichier .xlsx : valeurs des cellules par onglet, sans formules ni styles.
// Un .xlsx est une archive zip de XML. On lit le classeur (noms des onglets), les chaînes partagées et
// la feuille demandée. Une formule rend sa dernière valeur calculée, s'il y en a une.
// Taille décompressée plafonnée pour qu'un fichier piégé ne remplisse pas la mémoire.

export type Valeur = string | number | null;
export type Feuille = Map<number, Map<number, Valeur>>; // ligne → colonne → valeur (1 = A)

const LIMITE_OCTETS = 20 * 1024 * 1024;

function decoder(t: string): string {
  return t
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textes(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decoder(m[1])).join("");
}

function colonne(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export class Classeur {
  private fichiers: Record<string, Uint8Array>;
  private partagees: string[] = [];
  private onglets = new Map<string, string>();

  constructor(octets: ArrayBuffer) {
    let total = 0;
    this.fichiers = unzipSync(new Uint8Array(octets), {
      filter: (f) => {
        if (!/^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/.test(f.name)) return false;
        total += f.originalSize;
        if (total > LIMITE_OCTETS) throw new Error("Fichier trop volumineux une fois décompressé.");
        return true;
      },
    });
    const lire = (nom: string) => (this.fichiers[nom] ? strFromU8(this.fichiers[nom]) : null);
    const classeur = lire("xl/workbook.xml");
    const liens = lire("xl/_rels/workbook.xml.rels");
    if (!classeur || !liens) throw new Error("Ce n'est pas un classeur Excel lisible.");
    const cibles = new Map([...liens.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
    for (const m of classeur.matchAll(/<sheet\b[^>]*>/g)) {
      const nom = /name="([^"]*)"/.exec(m[0])?.[1];
      const id = /r:id="([^"]+)"/.exec(m[0])?.[1];
      const cible = cibles.get(id);
      if (nom && cible) this.onglets.set(decoder(nom), `xl/${cible.replace(/^\/?xl\//, "")}`);
    }
    const ss = lire("xl/sharedStrings.xml");
    if (ss) this.partagees = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textes(m[1]));
  }

  feuille(nom: string): Feuille | null {
    const chemin = this.onglets.get(nom);
    const octets = chemin ? this.fichiers[chemin] : undefined;
    if (!octets) return null;
    const xml = strFromU8(octets);
    const f: Feuille = new Map();
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1];
      const corps = m[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(corps)?.[1];
      let valeur: Valeur = null;
      if (type === "s" && v !== undefined) valeur = this.partagees[Number(v)] ?? null;
      else if (type === "inlineStr") valeur = textes(corps);
      else if ((type === "str" || type === "e") && v !== undefined) valeur = decoder(v);
      else if (type === "b" && v !== undefined) valeur = v === "1" ? "oui" : "non";
      else if (v !== undefined) valeur = Number(v);
      if (typeof valeur === "string") valeur = valeur.trim() || null;
      if (typeof valeur === "number" && !Number.isFinite(valeur)) valeur = null;
      if (valeur === null) continue;
      const ligne = Number(/\d+$/.exec(ref)![0]);
      if (!f.has(ligne)) f.set(ligne, new Map());
      f.get(ligne)!.set(colonne(ref), valeur);
    }
    return f;
  }
}
