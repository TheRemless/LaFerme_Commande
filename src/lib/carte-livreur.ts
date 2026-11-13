// Carte du livreur au suivi (décision de Jérémy du 13.11.2026) : 3 × 3 tuiles de la carte grise de swisstopo
// (geo.admin.ch, sans clé), centrées sur la position du livreur. Fonctions pures, sans réseau : la page
// pose les tuiles comme des images, sans bibliothèque de carte ni JavaScript dans le navigateur.

// Position renvoyée par positionPourSuivi (src/lib/position-livreur.ts, session tablette) : lat, lon, précision
// en mètres et heure du relevé, seulement quand la commande est l'arrêt en cours de son livreur.
export type { PositionSuivi } from "@/lib/position-livreur";

export const ZOOM_CARTE = 16;
export const TAILLE_TUILE = 256;
// Couche grise, la plus proche de la direction Béton. Les tuiles WMTS en Web Mercator (3857) couvrent la Suisse.
const COUCHE = "ch.swisstopo.pixelkarte-grau";

export type Tuile = { url: string; gauche: number; haut: number };

// Position du livreur dans la grille de 3 × 3 tuiles (768 px de côté), à placer au centre du cadre.
export function tuilesAutour(lat: number, lon: number, zoom = ZOOM_CARTE): { tuiles: Tuile[]; x: number; y: number } {
  const n = 2 ** zoom;
  const fx = ((lon + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const cx = Math.floor(fx);
  const cy = Math.floor(fy);
  const tuiles: Tuile[] = [];
  for (let ligne = 0; ligne < 3; ligne++) {
    for (let col = 0; col < 3; col++) {
      const x = cx - 1 + col;
      const y = cy - 1 + ligne;
      tuiles.push({ url: `https://wmts.geo.admin.ch/1.0.0/${COUCHE}/default/current/3857/${zoom}/${x}/${y}.jpeg`, gauche: col * TAILLE_TUILE, haut: ligne * TAILLE_TUILE });
    }
  }
  return { tuiles, x: TAILLE_TUILE + (fx - cx) * TAILLE_TUILE, y: TAILLE_TUILE + (fy - cy) * TAILLE_TUILE };
}

// Rayon de précision en pixels (mètres par pixel en Web Mercator à cette latitude), borné pour rester lisible.
export function rayonPrecision(precisionM: number | null, lat: number, zoom = ZOOM_CARTE): number | null {
  if (precisionM === null || !Number.isFinite(precisionM) || precisionM <= 0) return null;
  const metresParPixel = (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  return Math.min(120, Math.max(10, precisionM / metresParPixel));
}
