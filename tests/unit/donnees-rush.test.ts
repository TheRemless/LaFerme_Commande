import { describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { genererRush, OPTIONS_PAR_DEFAUT } from "../../scripts/rush/generer";
import { empreinteRush, refusHorsBaseEmbarquee } from "../../scripts/rush/garde";

// Jeu de données de rush (scripts/donnees-rush.ts) à petite échelle : mêmes règles que le jeu complet.
const OPTIONS = { ...OPTIONS_PAR_DEFAUT, echelle: 0.03, joursHistorique: 60, maintenant: new Date("2026-11-13T14:00:00Z") }; // 15h à Genève : hors service, la file en direct est fabriquée.

async function generer(graine: number = OPTIONS.graine) {
  const db = await creerBaseLocale();
  const bilan = await genererRush(db, { ...OPTIONS, graine });
  return { db, bilan };
}

describe("jeu de données de rush", () => {
  it("refuse de tourner dès qu'une vraie base est configurée", () => {
    expect(refusHorsBaseEmbarquee({})).toBeNull();
    expect(refusHorsBaseEmbarquee({ CONTEXTE_DEPLOIEMENT: "local" })).toBeNull();
    for (const v of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "DATABASE_URL", "NETLIFY", "CONTEXT"]) {
      expect(refusHorsBaseEmbarquee({ [v]: "x" })).toContain(v);
    }
    expect(refusHorsBaseEmbarquee({ CONTEXTE_DEPLOIEMENT: "deploy-preview" })).toContain("CONTEXTE_DEPLOIEMENT");
  });

  it("même graine et même instant : mêmes données ; autre graine : autres données", async () => {
    const a = await generer();
    const b = await generer();
    const c = await generer(7);
    expect(await empreinteRush(a.db)).toBe(await empreinteRush(b.db));
    expect(await empreinteRush(a.db)).not.toBe(await empreinteRush(c.db));
    await Promise.all([a.db.close(), b.db.close(), c.db.close()]);
  });

  it("des commandes cohérentes avec les règles du site, et toutes factices", async () => {
    const { db, bilan } = await generer();
    expect(bilan.commandes).toBeGreaterThan(200);
    const r = await db.query<Record<string, number>>(`select
      (select count(*) from commandes c where sous_total_centimes <> (select sum(total_centimes) from commande_lignes l where l.commande_id = c.id))::int as totaux_faux,
      (select count(*) from commandes where total_centimes <> sous_total_centimes + frais_centimes)::int as frais_faux,
      (select count(*) from commandes where moyen_paiement = 'comptoir' and (mode = 'livraison' or total_centimes > 10000))::int as comptoir_hors_regle,
      (select count(*) from commandes where mode = 'livraison' and sous_total_centimes < (select minimum_centimes from zones_livraison z where z.numero = zone_numero))::int as sous_minimum,
      (select count(*) from commandes where client_email not like '%@exemple.test')::int as email_reel,
      (select count(*) from comptes where email not like '%@exemple.test')::int as compte_reel,
      (select count(*) from commandes where client_telephone not like '+41 00 000 %')::int as telephone_reel,
      (select count(*) from commandes where stripe_session_id is not null and stripe_session_id not like 'cs_test_rush_%')::int as stripe_reel,
      (select count(*) from (select jour_service, numero from commandes group by 1, 2 having count(*) > 1) d)::int as numeros_doubles,
      (select count(*) from remboursements r join commandes c on c.id = r.commande_id where r.montant_centimes > c.total_centimes)::int as remboursement_trop,
      (select count(*) from commandes where statut in ('terminee', 'refusee') and termine_le is null)::int as fin_sans_heure,
      (select count(*) from commandes where cree_le > '2026-11-13T14:00:00Z')::int as futur`);
    expect(r.rows[0]).toEqual({
      totaux_faux: 0, frais_faux: 0, comptoir_hors_regle: 0, sous_minimum: 0, email_reel: 0, compte_reel: 0, telephone_reel: 0,
      stripe_reel: 0, numeros_doubles: 0, remboursement_trop: 0, fin_sans_heure: 0, futur: 0,
    });
    // Tous les cas utiles au service sont là : file en direct, à l'avance, refus, échecs, remboursements, livreurs.
    const statuts = (await db.query<{ s: string }>("select distinct statut as s from commandes")).rows.map((x) => x.s);
    expect(statuts).toEqual(expect.arrayContaining(["nouvelle", "en_preparation", "terminee", "refusee", "annulee"]));
    const n = (await db.query<Record<string, number>>(`select
      (select count(*) from commandes where quand_type = 'creneau' and jour_service > '2026-11-13')::int as a_l_avance,
      (select count(*) from remboursements)::int as remboursements,
      (select count(*) from livraisons)::int as livraisons,
      (select count(*) from journal_gestion)::int as journal,
      (select count(*) from plats where rupture_jour = '2026-11-13')::int as ruptures`)).rows[0];
    for (const [cle, v] of Object.entries(n)) expect(v, cle).toBeGreaterThan(0);
    await db.close();
  });
});
