// Pages légales : des sections de paragraphes. Un passage entre crochets [ … ] est une information à fournir
// par Jérémy : il s'affiche surligné et bloque la validation de la page.
export type Section = { titre: string; contenu: (string | string[])[] };
export type PageLegale = { titre: string; misAJour: string; sections: Section[] };

export function aCompleter(p: PageLegale): number {
  return JSON.stringify(p.sections).match(/\[[^\]]+\]/g)?.length ?? 0;
}
