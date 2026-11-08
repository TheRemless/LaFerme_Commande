// Pages légales : des sections de paragraphes. Un passage entre crochets [ … ] est une information à fournir
// par Jérémy : il s'affiche surligné et bloque la validation de la page.
export type Section = { titre: string; contenu: (string | string[])[] };
export type PageLegale = { titre: string; misAJour: string; sections: Section[] };

// Compté dans les textes eux-mêmes (pas dans leur JSON, dont les crochets de tableau tromperaient le compte).
export function aCompleter(p: PageLegale): number {
  const textes = p.sections.flatMap((s) => [s.titre, ...s.contenu.flat()]);
  return textes.reduce((n, t) => n + (t.match(/\[[^\]]+\]/g)?.length ?? 0), 0);
}
