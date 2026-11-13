import { describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import type { Personnel } from "@/lib/personnel/session";

// Passe finale de qualite : un décalage un vendredi soir touche des dizaines de commandes. Chaque e-mail
// ouvre sa connexion SMTP (une à deux secondes) : envoyés un par un, ils dépassaient le temps d'une fonction
// Netlify. Ici l'envoi dure 200 ms : les e-mails partent par lots, jamais plus de ENVOIS_SIMULTANES à la fois.
let enCours = 0;
let maxSimultanes = 0;
vi.mock("@/lib/courriel/envoi", async (original) => ({
  ...(await original<typeof import("@/lib/courriel/envoi")>()),
  envoyerCourriel: async () => {
    enCours += 1;
    maxSimultanes = Math.max(maxSimultanes, enCours);
    await new Promise((ok) => setTimeout(ok, 200));
    enCours -= 1;
  },
}));

const { decalerCommandes, ENVOIS_SIMULTANES } = await import("@/lib/decalage");

async function commandeAcceptee(n: number): Promise<string> {
  const db = await baseLocale();
  const p = {
    jeton_suivi: `jeton-decalage-lot-${n}-${Date.now()}`, cle_idempotence: `decalage-lot-${n}-${Date.now()}`, mode: "retrait", statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait", moyen_paiement: "comptoir", zone_numero: null, client_prenom: "Lot", client_nom: `Test${n}`,
    client_telephone: "079 000 00 00", client_email: `lot${n}@laferme.test`, quand_type: "asap", pizzas_seulement: true,
    sous_total_centimes: 1500, frais_centimes: 0, total_centimes: 1500, tva_centimes: 38, taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query("select changer_statut($1, 'acceptee', 'tablette:Test', now() + interval '30 minutes')", [id]);
  return id;
}

describe("décaler un vendredi soir : les e-mails partent par lots", () => {
  it("20 commandes : tous les clients prévenus, au plus ENVOIS_SIMULTANES envois à la fois, bien plus vite qu'un par un", async () => {
    const db = await baseLocale();
    const r = await db.query<{ id: string }>(
      "insert into personnel (email, nom, role) values ('decalage-lot@laferme.test', 'Décalage lot', 'service') on conflict (email) do update set actif = true returning id",
    );
    const personnel: Personnel = { id: r.rows[0].id, email: "decalage-lot@laferme.test", nom: "Décalage lot", role: "service" };
    const ids = [];
    for (let i = 0; i < 20; i++) ids.push(await commandeAcceptee(i));
    const debut = Date.now();
    const res = await decalerCommandes({ minutes: 15, station: null, cle: `lot-${Date.now()}` }, personnel);
    const duree = Date.now() - debut;
    expect(res).toMatchObject({ ok: true, deja: false });
    if (!res.ok) return;
    expect(res.commandes).toBeGreaterThanOrEqual(20);
    expect(res.prevenus).toBe(res.commandes);
    expect(maxSimultanes).toBeGreaterThan(1);
    expect(maxSimultanes).toBeLessThanOrEqual(ENVOIS_SIMULTANES);
    // Un par un : 20 × 200 ms = 4 s. Par lots de 8 : 3 lots, moins de 2 s même sur un poste chargé.
    expect(duree).toBeLessThan(2500);
  });
});
