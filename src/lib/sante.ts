// État de santé du site, lu par un service de disponibilité externe (docs/filet.md, « Surveillance »).
// Aucune donnée personnelle : des heures, des durées et des états. Fonction pure, testée sans serveur.

// La fonction planifiée passe chaque minute en production : 5 minutes sans passage, elle est arrêtée.
export const SURVEILLANCE_EN_RETARD_S = 300;
// Même seuil que la pause automatique (src/lib/surveillance.ts).
export const TABLETTE_MUETTE_S = 180;

export type EntreesSante = {
  maintenant: Date;
  contexte: string;
  version: string | null;
  base: { ok: boolean; ms: number };
  etat: { surveillance_le: string | null; tablette_vue_le: string | null } | null;
  enService: boolean;
};

const age = (maintenant: Date, iso: string | null | undefined) =>
  iso ? Math.max(0, Math.round((maintenant.getTime() - new Date(iso).getTime()) / 1000)) : null;

export function evaluerSante(e: EntreesSante) {
  const surveillanceLe = e.etat?.surveillance_le ? new Date(e.etat.surveillance_le).toISOString() : null;
  const tabletteLe = e.etat?.tablette_vue_le ? new Date(e.etat.tablette_vue_le).toISOString() : null;
  const ageSurveillance = age(e.maintenant, surveillanceLe);
  const ageTablette = age(e.maintenant, tabletteLe);
  // Hors production, rien ne lance la surveillance chaque minute (audit samedi soir, SS-21).
  const enRetard = e.base.ok && e.contexte === "production" && (ageSurveillance === null || ageSurveillance > SURVEILLANCE_EN_RETARD_S);
  // Signalée seulement : la surveillance met déjà les commandes en pause et prévient le restaurant.
  const muette = e.enService && ageTablette !== null && ageTablette > TABLETTE_MUETTE_S;
  const etat = !e.base.ok ? "panne" : enRetard ? "degrade" : "ok";
  return {
    http: etat === "ok" ? 200 : 503,
    corps: {
      etat,
      heure: e.maintenant.toISOString(),
      version: e.version,
      contexte: e.contexte,
      base: { ok: e.base.ok, ms: e.base.ms },
      surveillance: { dernier_passage: surveillanceLe, il_y_a_s: ageSurveillance, en_retard: enRetard },
      service: { en_cours: e.enService },
      tablette: { dernier_signe: tabletteLe, il_y_a_s: ageTablette, muette },
    },
  };
}
