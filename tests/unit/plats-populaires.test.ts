import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { creerCommande, fonctionSql } from "@/lib/db/serveur";

// Vague 3, client-commande : plats les plus commandés (C7) et suggestion au panier, éteints par défaut.
// Montants d'essai, pas des prix de la carte.

type Populaires = { populaires_actifs: boolean; suggestion_active: boolean; tous: string[]; par_categorie: Record<string, string[]> };

async function regler(cle: string, valeur: boolean) {
  const db = await baseLocale();
  await db.query("update reglages set valeur = $2::jsonb where cle = $1", [cle, JSON.stringify(valeur)]);
}

async function vendre(slug: string, nom: string, qte: number, statut = "terminee") {
  const cle = randomUUID();
  await creerCommande({
    jeton_suivi: `jeton-${cle}`,
    cle_idempotence: cle,
    mode: "retrait",
    statut,
    statut_paiement: "paye",
    moyen_paiement: "en_ligne",
    client_prenom: "Essai",
    client_nom: "Populaire",
    client_telephone: "079 000 00 00",
    client_email: "populaire@exemple.test",
    quand_type: "asap",
    pizzas_seulement: false,
    sous_total_centimes: 1000 * qte,
    frais_centimes: 0,
    total_centimes: 1000 * qte,
    tva_centimes: 26 * qte,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [{ slug, nom, station: "cuisine", qte, unitaire_centimes: 1000, total_centimes: 1000 * qte, choix: {}, retraits: [], note: "" }],
  });
}

let boisson: string;
beforeAll(async () => {
  const db = await baseLocale();
  boisson = (await db.query<{ slug: string }>("select p.slug from plats p join categories c on c.id = p.categorie_id where c.slug = 'boissons' and p.commandable order by p.ordre limit 1")).rows[0].slug;
  await vendre("lasagne-de-boeuf", "Lasagne de bœuf", 9);
  await vendre("lasagne-de-boeuf", "Lasagne de bœuf", 9);
  await vendre(boisson, "Boisson", 8);
  for (let i = 0; i < 3; i++) await vendre("pizza-margherita", "Pizza Margherita", 9, "refusee");
});
afterAll(async () => {
  await regler("plats_populaires_actifs", false);
  await regler("suggestion_panier_active", false);
});

describe("plats populaires", () => {
  it("éteints par défaut : rien n'est calculé ni montré", async () => {
    const p = await fonctionSql<Populaires>("plats_populaires", {});
    expect(p).toMatchObject({ populaires_actifs: false, suggestion_active: false, tous: [], par_categorie: {} });
  });

  it("allumés : les vraies ventes des 28 derniers jours, sans les commandes refusées", async () => {
    await regler("plats_populaires_actifs", true);
    const p = await fonctionSql<Populaires>("plats_populaires", {});
    expect(p.populaires_actifs).toBe(true);
    expect(p.tous.indexOf("lasagne-de-boeuf")).toBeLessThan(p.tous.indexOf(boisson));
    expect(p.tous).not.toContain("pizza-margherita-inexistante");
    expect(p.par_categorie.boissons?.[0]).toBe(boisson);
    const ventesMargherita = p.tous.indexOf("pizza-margherita");
    // Les commandes refusées (27 Margherita) ne compte pas : elle ne passe pas devant les lasagnes.
    if (ventesMargherita !== -1) expect(ventesMargherita).toBeGreaterThan(p.tous.indexOf("lasagne-de-boeuf"));
  });
});
