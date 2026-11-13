import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { creerCommande } from "@/lib/db/serveur";

// Vague 3, client-commande : un créneau devenu complet entre le choix de l'heure et le paiement est
// annoncé dès le calcul du panier, pas seulement au clic sur « Payer » (refus de creer_commande).
// Montants d'essai, pas des prix de la carte.

let POST: (r: Request) => Promise<Response>;
const DATE = "2026-11-10";
const MINUTES = 1230;
let avant: string;

beforeAll(async () => {
  ({ POST } = await import("@/app/api/panier/route"));
  const db = await baseLocale();
  avant = (await db.query<{ valeur: string }>("select valeur::text from reglages where cle = 'capacite_retraits_par_creneau'")).rows[0].valeur;
  await db.query("update reglages set valeur = '1' where cle = 'capacite_retraits_par_creneau'");
});
afterAll(async () => {
  const db = await baseLocale();
  await db.query("update reglages set valeur = $1::jsonb where cle = 'capacite_retraits_par_creneau'", [avant]);
});

function panier(quand: unknown) {
  return POST(
    new Request("http://localhost/api/panier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }],
        mode: "retrait",
        quand,
        heure: `${DATE}T19:05`,
      }),
    }),
  );
}

async function occuper(minutes: number) {
  const cle = randomUUID();
  await creerCommande({
    jeton_suivi: `jeton-${cle}`,
    cle_idempotence: cle,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    client_prenom: "Essai",
    client_nom: "Creneau",
    client_telephone: "079 000 00 00",
    client_email: `cr-${cle.slice(0, 8)}@exemple.ch`,
    quand_type: "creneau",
    quand_date: DATE,
    quand_minutes: minutes,
    pizzas_seulement: true,
    sous_total_centimes: 4000,
    frais_centimes: 0,
    total_centimes: 4000,
    tva_centimes: 102,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 2, unitaire_centimes: 2000, total_centimes: 4000, choix: {}, retraits: [], note: "" }],
  });
}

describe("créneau complet vu dès le panier", () => {
  it("un créneau libre reste valide", async () => {
    const r = await (await panier({ type: "creneau", date: DATE, minutes: MINUTES })).json();
    expect(r.message_quand).toBeNull();
    expect(r.valide).toBe(true);
  });

  it("un créneau rempli entre-temps bloque le paiement avec une raison", async () => {
    await occuper(MINUTES);
    const r = await (await panier({ type: "creneau", date: DATE, minutes: MINUTES })).json();
    expect(r.valide).toBe(false);
    expect(r.message_quand).toMatch(/^Ce créneau est complet\./);
    expect(r.creneau_complet).toBe(true);
  });

  it("le créneau voisin, lui, reste libre", async () => {
    const r = await (await panier({ type: "creneau", date: DATE, minutes: MINUTES + 15 })).json();
    expect(r.valide).toBe(true);
    expect(r.creneau_complet).toBeFalsy();
  });
});
