import "server-only";
import { fonctionSql } from "@/lib/db/serveur";
import type { Totaux } from "@/lib/panier";
import { codeSaisi, messageRefus, type RaisonRefus } from "@/lib/codes-promo";

// Codes promo côté client (moteur de bo-carte, 20261210120000_codes_promo.sql). Construits complets mais
// éteints : tant que le réglage codes_promo_actifs est faux, aucun champ n'apparaît et un code envoyé est
// ignoré. La remise vient toujours de la base (evaluer_code), jamais du navigateur.

export type ResultatCode = { ok: true; code: string; type: string; remise_centimes: number } | { ok: false; raison: string; minimum_centimes?: number };

export type DemandeCode = {
  code: string;
  email?: string | null;
  telephone?: string | null;
  adresse?: unknown;
  mode: "livraison" | "retrait";
  sous_total_centimes: number;
  frais_centimes: number;
  // Panier : client pas encore connu, « une fois par client » et « première commande » attendent le paiement.
  provisoire?: boolean;
};

// Forme d'un code tapé et textes de refus : ceux de bo-carte (src/lib/codes-promo.ts), un seul jeu de règles.
export const codeTape = codeSaisi;

export async function evaluerCode(d: DemandeCode): Promise<ResultatCode> {
  try {
    return await fonctionSql<ResultatCode>("evaluer_code", {
      p: {
        code: d.code,
        email: d.email ?? null,
        telephone: d.telephone ?? null,
        adresse: d.adresse && typeof d.adresse === "object" ? d.adresse : null,
        mode: d.mode,
        sous_total_centimes: d.sous_total_centimes,
        frais_centimes: d.frais_centimes,
        provisoire: d.provisoire === true,
      },
    });
  } catch {
    return { ok: false, raison: "indisponible" };
  }
}

// Le champ « Code » est-il proposé ? Un code vide rend « desactive » quand l'interrupteur est éteint.
export async function codesActifs(): Promise<boolean> {
  const r = await evaluerCode({ code: "", mode: "retrait", sous_total_centimes: 0, frais_centimes: 0 });
  return !r.ok && r.raison !== "desactive" && r.raison !== "indisponible";
}

// Texte d'un refus pour le client : celui de bo-carte, plus le cas d'une base muette.
export function messageCode(r: Extract<ResultatCode, { ok: false }>): string {
  if (r.raison === "indisponible") return "Le code ne peut pas être vérifié pour le moment. Réessayez dans un instant.";
  return messageRefus({ raison: r.raison as RaisonRefus, minimum_centimes: r.minimum_centimes }) ?? "Ce code n'existe pas. Vérifiez l'orthographe.";
}

// Totaux après remise : le total payé baisse, la TVA comprise est recalculée sur ce total.
export function appliquerRemise<T extends Pick<Totaux, "total_centimes" | "tva_centimes">>(t: T, remise: number, tauxTva: number): T & { remise_centimes: number } {
  const r = Math.max(0, Math.min(remise, t.total_centimes));
  const total = t.total_centimes - r;
  return { ...t, total_centimes: total, tva_centimes: Math.round((total * tauxTva) / (100 + tauxTva)), remise_centimes: r };
}
