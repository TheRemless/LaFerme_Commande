-- Horodatage par poste (vague 3, tablette ; accords de bo-pilotage et bo-operations) : quand un poste a reçu une
-- commande, quand il l'a lancée, quand elle est sortie. Sert à la vue par poste de la tablette (décision D12, à
-- l'essai), aux temps réels du pilotage et à la file réelle de charge_cuisine().
--
-- Aucune fonction partagée recréée : deux déclencheurs sur commandes remplissent la table.
-- - Premiers tickets (tickets_le passe de null à une heure, premiers_tickets) : une ligne par poste présent dans les
--   lignes de la commande, a_faire_le = tickets_le. Fixé une seule fois : une réimpression ne le change pas. Une
--   commande à l'avance n'a sa ligne qu'à la sortie de ses tickets (60 ou 30 minutes avant), pas à l'acceptation.
-- - Commande prête, partie ou terminée : pret_le se remplit pour les postes encore ouverts, pret_par = 'statut'
--   (heure déduite). Les temps restent complets même si personne ne touche la vue par poste.
-- Refusée ou annulée : pret_le reste vide (le pilotage l'exclut, la charge filtre sur le statut de la commande).

create table commande_postes (
  commande_id uuid not null references commandes (id) on delete cascade,
  station station not null,
  a_faire_le timestamptz not null,
  lance_le timestamptz,
  pret_le timestamptz,
  -- « tablette:Prénom » quand le poste touche « Prête », 'statut' quand l'heure est déduite du statut.
  pret_par text,
  primary key (commande_id, station)
);
-- File réelle d'un poste (charge_cuisine, une fois par minute).
create index commande_postes_ouverts_idx on commande_postes (station) where pret_le is null;

alter table commande_postes enable row level security;
revoke all on commande_postes from anon, authenticated;
grant select, insert, update, delete on commande_postes to service_role;

create function commande_postes_aux_tickets() returns trigger
language plpgsql as $$
begin
  insert into commande_postes (commande_id, station, a_faire_le)
    select distinct new.id, l.station, new.tickets_le from commande_lignes l where l.commande_id = new.id
    on conflict (commande_id, station) do nothing;
  return null;
end;
$$;
create trigger commande_postes_aux_tickets after update of tickets_le on commandes
  for each row when (old.tickets_le is null and new.tickets_le is not null)
  execute function commande_postes_aux_tickets();

create function commande_postes_au_statut() returns trigger
language plpgsql as $$
begin
  update commande_postes set pret_le = now(), pret_par = 'statut'
    where commande_id = new.id and pret_le is null;
  return null;
end;
$$;
create trigger commande_postes_au_statut after update of statut on commandes
  for each row when (old.statut is distinct from new.statut and new.statut in ('prete', 'partie', 'terminee'))
  execute function commande_postes_au_statut();

-- Commandes en cuisine au moment de la migration : leurs tickets sont sortis, elles entrent dans la table.
insert into commande_postes (commande_id, station, a_faire_le)
  select distinct c.id, l.station, c.tickets_le
  from commandes c join commande_lignes l on l.commande_id = c.id
  where c.tickets_le is not null and c.statut in ('acceptee', 'en_preparation')
  on conflict (commande_id, station) do nothing;

-- Postes des commandes encore en cuisine ou sorties dans les 30 dernières minutes (rappel d'une commande close),
-- pour la file de la tablette.
create function postes_actifs() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'commande_id', p.commande_id, 'station', p.station, 'a_faire_le', p.a_faire_le, 'lance_le', p.lance_le,
    'pret_le', p.pret_le, 'pret_par', case when p.pret_par = 'statut' then 'statut' when p.pret_par is not null then 'poste' end
  ) order by p.a_faire_le), '[]'::jsonb)
  from commande_postes p join commandes c on c.id = p.commande_id
  where c.statut in ('acceptee', 'en_preparation', 'prete', 'partie', 'terminee')
    and (p.pret_le is null or p.pret_le > now() - interval '30 minutes');
$$;

-- Gestes du poste : « lancer » (facultatif), « pret », « rouvrir » (erreur de doigt, ou un plat refait). Équipe du
-- restaurant seulement (equipe_nom, 20261130090000). Seulement pour une commande encore en cuisine ; rouvrir ne
-- touche pas au statut de la commande. Renvoie la ligne, ou null si la commande n'a pas ce poste en cuisine.
create function marquer_poste(p_commande uuid, p_station station, p_geste text, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  qui text := equipe_nom(p_personnel);
  r commande_postes%rowtype;
begin
  if p_geste not in ('lancer', 'pret', 'rouvrir') then
    raise exception 'Geste inconnu';
  end if;
  update commande_postes p set
    lance_le = case when p_geste = 'lancer' then coalesce(p.lance_le, now()) else p.lance_le end,
    pret_le = case p_geste when 'pret' then coalesce(p.pret_le, now()) when 'rouvrir' then null else p.pret_le end,
    pret_par = case p_geste when 'pret' then coalesce(p.pret_par, 'tablette:' || qui) when 'rouvrir' then null else p.pret_par end
  from commandes c
  where p.commande_id = p_commande and p.station = p_station and c.id = p.commande_id and c.statut in ('acceptee', 'en_preparation')
  returning p.* into r;
  if not found then
    return null;
  end if;
  return to_jsonb(r);
end;
$$;

revoke all on function postes_actifs(), marquer_poste(uuid, station, text, uuid), commande_postes_aux_tickets(), commande_postes_au_statut()
  from public, anon, authenticated;
grant execute on function postes_actifs(), marquer_poste(uuid, station, text, uuid) to service_role;
