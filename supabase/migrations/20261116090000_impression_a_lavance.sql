-- Impression des commandes à l'avance (audit « samedi soir » SS-11, audit du gérant G08 option A).
-- Accepter une commande pour samedi soir, le mercredi, imprimait ses tickets le mercredi. Désormais une
-- commande acceptée n'a ses tickets qu'à partir de l'heure promise moins impression_avance_minutes. La
-- surveillance du serveur (une fois par minute) les crée, pas la tablette. Le client reçoit toujours sa
-- confirmation à l'acceptation.

-- Proposition : 60 minutes. Le délai le plus long annoncé aux clients est celui de la zone 2 (50 minutes
-- au plus, préparation comprise) ; dix minutes de marge pour un soir chargé. Pour un retrait (préparation
-- 20 minutes), le ticket arrive 40 minutes avant : il attend sur le rail, rien ne se perd.
insert into reglages (cle, valeur, proposition) values ('impression_avance_minutes', '60', true)
  on conflict (cle) do nothing;

-- Heure de création des premiers tickets d'une commande (null : pas encore imprimée). Seule premiers_tickets
-- l'écrit, sous verrou de la commande : un ticket ne sort qu'une fois, quel que soit le nombre de tours de
-- surveillance, d'instances de fonction ou de redémarrages.
alter table commandes add column tickets_le timestamptz;
-- Commandes acceptées avant cette migration : leurs tickets sont déjà sortis.
update commandes set tickets_le = accepte_le where accepte_le is not null and tickets_le is null;
create index commandes_a_imprimer_idx on commandes (heure_confirmee)
  where tickets_le is null and statut in ('acceptee', 'en_preparation');

create function premiers_tickets(p_commande uuid, p jsonb) returns integer
language plpgsql as $$
declare
  c commandes%rowtype;
  n integer;
begin
  select * into c from commandes where id = p_commande for update;
  if not found or c.tickets_le is not null or c.statut not in ('acceptee', 'en_preparation', 'prete', 'partie') then
    return 0;
  end if;
  n := creer_taches_impression(p_commande, p, false);
  update commandes set tickets_le = now() where id = p_commande;
  return n;
end;
$$;

-- Commandes acceptées dont l'heure d'impression est arrivée, la plus pressée d'abord. Une commande déjà
-- prête ou partie n'a plus besoin de ticket ; une refusée n'en a jamais.
create function commandes_a_imprimer() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(id order by heure_confirmee), '[]'::jsonb)
  from commandes
  where tickets_le is null and statut in ('acceptee', 'en_preparation') and heure_confirmee is not null
    and heure_confirmee - make_interval(mins => coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'impression_avance_minutes'), 60)) <= now();
$$;

create function regler_impression_avance(p_valeur integer, p_personnel uuid) returns void
language plpgsql as $$
declare
  avant jsonb;
begin
  perform gerant_nom(p_personnel);
  if p_valeur is null or p_valeur not between 15 and 240 then
    raise exception 'Impression : de 15 à 240 minutes avant l''heure';
  end if;
  select valeur into avant from reglages where cle = 'impression_avance_minutes';
  update reglages set valeur = to_jsonb(p_valeur), proposition = false where cle = 'impression_avance_minutes';
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, gerant_nom(p_personnel), 'reglage', 'impression_avance_minutes', avant, to_jsonb(p_valeur));
end;
$$;

revoke execute on function premiers_tickets(uuid, jsonb), commandes_a_imprimer(), regler_impression_avance(integer, uuid)
  from public, anon, authenticated;
grant execute on function premiers_tickets(uuid, jsonb), commandes_a_imprimer(), regler_impression_avance(integer, uuid)
  to service_role;
