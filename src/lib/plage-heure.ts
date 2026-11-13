// Heure annoncée au client en fourchette (« entre 19h35 et 19h50 »), calculée par fourchette() de
// heure-reelle.ts (bo-operations). Tenir une fourchette protège mieux qu'une heure unique un soir chargé
// (docs/vague-3/recherche-client.md). Largeur nulle : une seule heure, « vers 19h40 ».
import { heureTexte } from "@/lib/service";

export type Plage = { basse: number; haute: number };

export function plageTexte(p: Plage): string {
  return p.basse === p.haute ? `vers ${heureTexte(p.basse)}` : `entre ${heureTexte(p.basse)} et ${heureTexte(p.haute)}`;
}
