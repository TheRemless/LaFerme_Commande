-- Justificatif du client dans le sac (mission compta, R6, R7, R24 de docs/compta/plan-conformite.md) : un ticket à
-- part, au poste qui fait le sac, en plus du ticket de préparation de ce poste. Deux tâches pour le même poste.
-- creer_taches_impression (20261113090000) sautait, en réimpression, toute tâche d'un poste qui en avait déjà une en
-- attente : la deuxième du même appel (le justificatif) était perdue. Désormais seules comptent les tâches qui
-- existaient avant l'appel. Recréée à l'identique sauf ce point. Numéro donné par bo-pilotage.

create or replace function creer_taches_impression(p_commande uuid, p jsonb, p_reimpression boolean) returns integer
language plpgsql as $$
declare
  x jsonb;
  imp smallint;
  n integer := 0;
  occupees station[];
begin
  -- Postes qui ont déjà une tâche en attente ou envoyée, avant cet appel.
  select coalesce(array_agg(distinct station), '{}') into occupees
    from taches_impression where commande_id = p_commande and etat in ('en_attente', 'envoyee');
  for x in select * from jsonb_array_elements(p) loop
    if p_reimpression and (x ->> 'station')::station = any(occupees) then
      continue;
    end if;
    select id into imp from imprimantes where station = (x ->> 'station')::station and actif order by id limit 1;
    insert into taches_impression (commande_id, station, imprimante_id, contenu, reimpression, etat)
      values (p_commande, (x ->> 'station')::station, imp, x -> 'contenu', p_reimpression, case when imp is null then 'sans_imprimante' else 'en_attente' end);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- « Ticket » à la tablette (lecture de secours quand l'imprimante ne sort rien) : tous les tickets de la dernière
-- impression de chaque poste, dans l'ordre de création (préparation, puis justificatif), au lieu d'un seul, pris
-- au hasard entre deux tâches créées au même instant. Recréée (20261111090000), même signature.
create or replace function tickets_commande(p_commande uuid) returns jsonb
language sql stable as $$
  -- Identifiants en UUID : l'ordre est donné par le contenu, le justificatif après le ticket de préparation.
  select coalesce(jsonb_agg(jsonb_build_object('station', t.station, 'contenu', t.contenu)
    order by t.station, coalesce(t.contenu -> 0 ->> 'texte', '') = 'JUSTIFICATIF CLIENT', t.id), '[]'::jsonb)
  from taches_impression t
  where t.commande_id = p_commande
    and t.cree_le = (select max(x.cree_le) from taches_impression x where x.commande_id = p_commande and x.station = t.station);
$$;
