// Mesure du tableau des ventes sur un an d'historique à 300 commandes par jour, base embarquée (PGlite).
// npx tsx --conditions=react-server scripts/mesure-pilotage.ts
// PGlite tourne dans un seul fil : les temps de la vraie base de Zurich restent à mesurer (non vérifié).

import { creerBaseLocale } from "@/lib/db/locale";

const JOURS = 365;
const PAR_JOUR = 300;
const FIN = "2026-12-31";

async function main() {
  const db = await creerBaseLocale();
  const t0 = performance.now();
  // Une commande sur trente refusée, une sur cent annulée, 60 % en livraison, 70 % payées en ligne.
  await db.exec(`
    insert into commandes (numero, jour, jour_service, jeton_suivi, cle_idempotence, mode, statut, statut_paiement, moyen_paiement,
      client_prenom, client_nom, client_telephone, client_email, quand_type, pizzas_seulement, zone_numero,
      sous_total_centimes, frais_centimes, total_centimes, tva_centimes, taux_tva_pourcent, origine, motif, cree_le, paye_le, accepte_le, termine_le)
    select k, d, d, 'mesure-' || d || '-' || k, 'mesure-' || d || '-' || k,
      case when k % 5 < 3 then 'livraison' else 'retrait' end,
      case when k % 30 = 0 then 'refusee' when k % 100 = 1 then 'annulee' else 'terminee' end,
      case when k % 100 = 1 then 'echec' when k % 10 < 7 then 'paye' else 'encaisse' end,
      case when k % 10 < 7 then 'en_ligne' else 'comptoir' end,
      'Prénom', 'Nom', '079 000 00 00', 'client' || (k * 7919 % 4000) || '@mesure.test', 'asap', false,
      case when k % 5 < 3 then 1 + k % 3 end,
      t - case when k % 5 < 3 then 490 else 0 end, case when k % 5 < 3 then 490 else 0 end, t, round(t * 2.6 / 102.6), 2.6,
      'http://localhost:3000', case when k % 30 = 0 then (array['Trop de monde', 'Plus de pâte', 'Hors zone'])[1 + k % 3] end,
      h, h + interval '1 minute', h + interval '3 minutes', h + interval '40 minutes'
    from (
      select d::date as d, k, 2000 + (k * 37 % 6000) as t,
        (d::date + time '11:00' + (case when k % 3 = 0 then k % 180 else 450 + k % 270 end) * interval '1 minute') at time zone 'Europe/Zurich' as h
      from generate_series('${FIN}'::date - ${JOURS - 1}, '${FIN}'::date, interval '1 day') d, generate_series(1, ${PAR_JOUR}) k
    ) x;
    insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, cree_le, fait_le)
    select id, 'mesure-r-' || id, 500, 'Mesure', 'stripe', case when numero % 400 = 3 then 'echec' else 'fait' end, 'Mesure',
      termine_le, case when numero % 400 <> 3 then termine_le end
    from commandes where numero % 50 = 3 and statut = 'terminee';
    analyze;
  `);
  const nb = (await db.query<{ n: number }>("select count(*)::int as n from commandes")).rows[0].n;
  console.log(`Base : ${nb} commandes sur ${JOURS} jours, écrites en ${Math.round(performance.now() - t0)} ms`);

  const cas: [string, string, string, string | null][] = [
    ["jour", FIN, FIN, null],
    ["soir seul", FIN, FIN, "soir"],
    ["mois, soir seul", "2026-12-01", FIN, "soir"],
    ["semaine", "2026-12-21", "2026-12-27", null],
    ["mois (30 jours)", "2026-12-01", "2026-12-31", null],
    ["année", "2026-01-01", FIN, null],
  ];
  for (const [nom, debut, fin, service] of cas) {
    const temps: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t = performance.now();
      await db.query("select pilotage_ventes($1::date, $2::date, null, null, $3)", [debut, fin, service]);
      temps.push(performance.now() - t);
    }
    temps.sort((a, b) => a - b);
    console.log(`pilotage_ventes ${nom.padEnd(16)} médiane ${Math.round(temps[2])} ms (min ${Math.round(temps[0])}, max ${Math.round(temps[4])})`);
  }
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
