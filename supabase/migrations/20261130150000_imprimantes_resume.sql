-- Imprimantes au back-office (vague 3, bo-operations) : pour chaque imprimante, le dernier ticket sorti, les
-- tickets qui attendent et les échecs du jour (heure de Genève). Le gérant voit d'un coup d'œil si une
-- imprimante imprime encore. Lecture seule de taches_impression, aucune donnée de client (ni nom ni numéro).
-- Les tickets de test (sans commande, PR de la session tablette) comptent : un test sorti prouve le branchement.
create index taches_impression_imprimee_idx on taches_impression (imprimante_id, imprime_le desc) where imprime_le is not null;

create function resume_imprimantes() returns jsonb
language sql stable as $$
  with jour as (select ((now() at time zone 'Europe/Zurich')::date)::timestamp at time zone 'Europe/Zurich' as debut)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'dernier_ticket_le', (select max(t.imprime_le) from taches_impression t where t.imprimante_id = i.id and t.imprime_le is not null),
    'en_attente', (select count(*) from taches_impression t where t.imprimante_id = i.id and t.etat in ('en_attente', 'envoyee')),
    'plus_ancien_en_attente_le', (select min(t.cree_le) from taches_impression t where t.imprimante_id = i.id and t.etat in ('en_attente', 'envoyee')),
    'imprimes_aujourdhui', (select count(*) from taches_impression t, jour where t.imprimante_id = i.id and t.imprime_le >= jour.debut),
    'echecs_aujourdhui', (select count(*) from taches_impression t, jour where t.imprimante_id = i.id and t.etat = 'echec' and t.cree_le >= jour.debut)
  ) order by i.id), '[]'::jsonb)
  from imprimantes i;
$$;

revoke execute on function resume_imprimantes() from public, anon, authenticated;
grant execute on function resume_imprimantes() to service_role;
