// Les ébauches légales ne s'affichent qu'en préversion, jusqu'à ce que Jérémy les ait fait relire et
// valider : la variable PAGES_LEGALES_VALIDEES=1 les ouvre en production.
export function pagesLegalesVisibles(): boolean {
  return process.env.CONTEXTE_DEPLOIEMENT !== "production" || process.env.PAGES_LEGALES_VALIDEES === "1";
}

export function pagesLegalesValidees(): boolean {
  return process.env.PAGES_LEGALES_VALIDEES === "1";
}
