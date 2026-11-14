import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import {
  ticketsDeCommande,
  type CommandePourTicket,
} from "@/lib/impression/ticket";
import { estPostePlat, libellePoste, pizzasSeulement } from "@/lib/postes-plat";

// Poste « comptoir » (migrations 20261215150000 et 20261215151000, décision de Jérémy du 14.11.2026) : boissons au
// comptoir, desserts laissés tels quels, ni ticket de préparation, ni ligne dans commande_postes, ni débit.

let db: PGlite;
let gerant: string;
beforeAll(async () => {
  db = await creerBaseLocale();
  gerant = (
    await db.query<{ id: string }>(
      "select id from personnel where email = 'equipe@laferme.test'",
    )
  ).rows[0].id;
}, 120_000);

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
const postesDe = async (categorie: string) =>
  (
    await db.query<{ slug: string; station: string }>(
      "select p.slug, p.station::text as station from plats p join categories c on c.id = p.categorie_id where c.slug = $1 order by p.slug",
      [categorie],
    )
  ).rows;

let n = 0;
async function commande(stations: string[]): Promise<string> {
  n += 1;
  const ligne = (station: string, i: number) => ({
    slug: `plat-${station}-${i}`,
    nom: `Plat ${station}`,
    station,
    qte: 2,
    unitaire_centimes: 1000,
    total_centimes: 2000,
    choix: {},
    retraits: [],
    note: "",
  });
  return (
    await db.query<{ id: string }>("select * from creer_commande($1)", [
      {
        jeton_suivi: `j-comptoir-${n}`,
        cle_idempotence: `comptoir-${n}`,
        mode: "retrait",
        statut: "acceptee",
        statut_paiement: "paye",
        moyen_paiement: "en_ligne",
        client_prenom: "A",
        client_nom: "B",
        client_telephone: "079",
        client_email: "a@b.test",
        quand_type: "asap",
        pizzas_seulement: false,
        sous_total_centimes: 2000 * stations.length,
        frais_centimes: 0,
        total_centimes: 2000 * stations.length,
        tva_centimes: 3,
        taux_tva_pourcent: 2.6,
        origine: "http://localhost",
        lignes: stations.map(ligne),
      },
    ])
  ).rows[0].id;
}

describe("poste comptoir en base", () => {
  it("l'enum station a la valeur comptoir", async () => {
    expect(await f<string[]>("enum_range(null::station)::text[]")).toEqual([
      "pizza",
      "cuisine",
      "comptoir",
    ]);
  });

  it("les boissons passent au comptoir, les desserts restent où ils étaient", async () => {
    const boissons = await postesDe("boissons");
    expect(boissons.length).toBeGreaterThan(0);
    expect(boissons.every((p) => p.station === "comptoir")).toBe(true);
    const desserts = await postesDe("desserts");
    expect(
      desserts.find((p) => p.slug === "chiacchiere-alla-nutella")?.station,
    ).toBe("pizza");
    expect(
      desserts
        .filter((p) => p.slug !== "chiacchiere-alla-nutella")
        .every((p) => p.station === "cuisine"),
    ).toBe(true);
  });

  it("le gérant choisit le poste d'un plat, comptoir compris, et le journal le garde", async () => {
    const slug = (await postesDe("desserts")).find(
      (p) => p.station === "cuisine",
    )!.slug;
    await f("modifier_plat($1, $2, $3)", [
      slug,
      { station: "comptoir" },
      gerant,
    ]);
    expect(
      (await postesDe("desserts")).find((p) => p.slug === slug)?.station,
    ).toBe("comptoir");
    const j = (
      await db.query<{ apres: { station?: string } }>(
        "select apres from journal_gestion where objet = 'plat' order by id desc limit 1",
      )
    ).rows[0];
    expect(j.apres.station).toBe("comptoir");
  });

  it("une ligne au comptoir n'ouvre pas de poste aux premiers tickets", async () => {
    const id = await commande(["pizza", "comptoir", "cuisine"]);
    await f("premiers_tickets($1, $2::jsonb)", [
      id,
      JSON.stringify([
        { station: "pizza", contenu: [] },
        { station: "cuisine", contenu: [] },
      ]),
    ]);
    const postes = (
      await db.query<{ poste: string }>(
        "select station::text as poste from commande_postes where commande_id = $1 order by station",
        [id],
      )
    ).rows;
    expect(postes.map((p) => p.poste)).toEqual(["pizza", "cuisine"]);
  });

  it("un article au comptoir ne compte dans aucun débit", async () => {
    await db.exec("truncate commandes cascade");
    await db.query(
      "update reglages set valeur = '8'::jsonb where cle = 'debit_pizza_quart_heure'",
    );
    await db.query(
      "update reglages set valeur = '10'::jsonb where cle = 'debit_cuisine_quart_heure'",
    );
    const id = await commande(["pizza", "comptoir", "comptoir", "cuisine"]);
    await db.query(
      "update commandes set heure_confirmee = now() + interval '10 minutes' where id = $1",
      [id],
    );
    const c = await f<{
      pizza: { articles: number };
      cuisine: { articles: number };
    }>("charge_cuisine()");
    // Deux pièces par ligne : 2 pizzas, 2 plats, les 4 boissons nulle part.
    expect(c.pizza.articles).toBe(2);
    expect(c.cuisine.articles).toBe(2);
  });
});

describe("poste comptoir, règles pures", () => {
  it("libellés et validation du poste", () => {
    expect(["pizza", "cuisine", "comptoir"].map(libellePoste)).toEqual([
      "Four",
      "Cuisine",
      "Comptoir",
    ]);
    expect(estPostePlat("comptoir")).toBe(true);
    expect(estPostePlat("bar")).toBe(false);
  });

  it("règle des pizzas : le comptoir ne la retient pas, mais il faut une pizza", () => {
    expect(pizzasSeulement(["pizza", "comptoir"])).toBe(true);
    expect(pizzasSeulement(["pizza"])).toBe(true);
    expect(pizzasSeulement(["comptoir"])).toBe(false);
    expect(pizzasSeulement(["pizza", "cuisine", "comptoir"])).toBe(false);
    expect(pizzasSeulement([])).toBe(false);
  });

  it("aucun ticket de préparation pour le comptoir", () => {
    const c = {
      numero: 7,
      mode: "retrait",
      statut_paiement: "paye",
      heure_confirmee: null,
      client_prenom: "A",
      client_nom: "B",
      client_telephone: "079",
      couverts: false,
      adresse: null,
      details_livraison: null,
      lignes: [
        { nom: "Margherita", qte: 1, station: "pizza", details: [] },
        { nom: "Thé froid citron", qte: 2, station: "comptoir", details: [] },
      ],
    } as unknown as CommandePourTicket;
    const t = ticketsDeCommande(c, { accepteLe: "2026-11-20T18:00:00Z" });
    expect(t.map((x) => x.station)).toEqual(["pizza"]);
    // Pas de ligne de préparation pour la boisson : seulement sa case dans la liste du sac (tablette, #246).
    const lignes = t[0].contenu.flatMap((x) => (x.t === "texte" ? [x.texte] : []));
    expect(lignes).not.toContain("2 x Thé froid citron");
    expect(lignes).toContain("[ ] 2 x Thé froid citron");
    // Seule l'autre station de préparation est annoncée en pied de ticket, pas le comptoir.
    expect(JSON.stringify(t)).not.toContain("Aussi");
  });
});
