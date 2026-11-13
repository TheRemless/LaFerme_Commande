// Fichiers CSV du back-office : même format que l'export comptable (src/lib/gestion.ts), lisible par Excel
// en Suisse : séparateur « ; », BOM UTF-8, fins de ligne CRLF, formules neutralisées.

/** Une cellule : guillemets si besoin, et « ' » devant = + - @ (sauf un nombre négatif) pour qu'Excel n'exécute rien. */
export function celluleCsv(x: string | number | boolean | null | undefined): string {
  const brut = x === null || x === undefined ? "" : String(x);
  const s = /^[=+\-@\t\r]/.test(brut) && !/^-?\d/.test(brut) ? `'${brut}` : brut;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function documentCsv(lignes: (string | number | boolean | null | undefined)[][]): string {
  return "﻿" + lignes.map((l) => l.map(celluleCsv).join(";")).join("\r\n") + "\r\n";
}

/** Nom de fichier sûr : minuscules, sans accent ni espace, avec la date du jour. */
export function nomFichierCsv(base: string, jour: string): string {
  const propre = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `la-ferme-${propre || "export"}-${jour}.csv`;
}

/** Côté navigateur : propose le fichier au téléchargement. */
export function telechargerCsv(nom: string, contenu: string) {
  const url = URL.createObjectURL(new Blob([contenu], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
