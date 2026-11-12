// Lien qui ouvre la navigation du téléphone vers une adresse de livraison : Plans sur iPhone, l'appli
// choisie (Google Maps, Waze) sur Android, Google Maps ailleurs. Seule l'adresse part vers l'appli de
// navigation, jamais le nom, le téléphone ni le code d'entrée du client.
export type Plateforme = "ios" | "android" | "autre";

export function lienNavigation(a: { rue: string; numero: string; npa: string; localite: string }, plateforme: Plateforme): string {
  const texte = encodeURIComponent(`${a.rue} ${a.numero}, ${a.npa} ${a.localite}, Suisse`);
  if (plateforme === "ios") return `https://maps.apple.com/?daddr=${texte}&dirflg=d`;
  if (plateforme === "android") return `geo:0,0?q=${texte}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${texte}`;
}

export function plateformeDe(userAgent: string, pointsTactiles = 0): Plateforme {
  if (/iPhone|iPad|iPod/.test(userAgent) || (userAgent.includes("Macintosh") && pointsTactiles > 1)) return "ios";
  return /Android/.test(userAgent) ? "android" : "autre";
}
