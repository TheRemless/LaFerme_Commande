-- Vague 3, client-compte : quota d'envoi de la boîte Infomaniak (500 e-mails par 24 heures, docs/comptes.md).
-- Chaque envoi SMTP (clients, codes, alertes) réserve une place avant de partir. Fenêtre glissante de 24 heures :
-- l'heure de remise à zéro du fournisseur n'est pas connue. Les types les moins utiles s'arrêtent d'abord et
-- laissent la place aux codes et aux confirmations. Un envoi refusé ne bloque jamais la commande : il est
-- noté dans son historique. Aucune donnée personnelle dans ce journal (ni adresse, ni sujet, ni texte).
-- Aucun objet existant n'est recréé. Aucun UPDATE ni DELETE sur des données existantes.

create table envois_courriel (
  id bigint generated always as identity primary key,
  type text not null check (type ~ '^[a-z_]{2,40}$'),
  priorite smallint not null check (priorite between 1 and 4),
  commande_id uuid references commandes (id) on delete set null,
  -- reserve : place prise, envoi en cours ; envoye ; echec (le serveur SMTP a refusé, ne compte pas) ;
  -- refuse : pas parti, quota de sa priorité atteint (ne compte pas).
  statut text not null check (statut in ('reserve', 'envoye', 'echec', 'refuse')),
  cree_le timestamptz not null default now()
);
create index envois_courriel_cree_idx on envois_courriel (cree_le);
alter table envois_courriel enable row level security;
revoke all on envois_courriel from anon, authenticated;
grant select, insert, update on envois_courriel to service_role;

-- Part du plafond que chaque priorité peut utiliser : 1 confirmations (et l'alerte du quota), 2 codes de
-- connexion, acceptation, refus, remboursement, nouvelle heure, manque, 3 prête et en route, 4 alertes.
create function part_quota_priorite(p_priorite smallint) returns numeric
language sql immutable as $$
  select case p_priorite when 1 then 1.00 when 2 then 0.95 when 3 then 0.85 else 0.80 end;
$$;

create function etat_quota_courriels(p_plafond integer) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'envoyes', count(*) filter (where statut in ('reserve', 'envoye')),
    'refuses', count(*) filter (where statut = 'refuse'),
    'plafond', p_plafond,
    'restants', greatest(p_plafond - count(*) filter (where statut in ('reserve', 'envoye')), 0),
    -- Heure où la plus ancienne place de la fenêtre se libère.
    'libere_a', min(cree_le) filter (where statut in ('reserve', 'envoye')) + interval '24 hours',
    'alerte', count(*) filter (where statut in ('reserve', 'envoye')) >= ceil(p_plafond * 0.80)
  )
  from envois_courriel where cree_le > now() - interval '24 hours';
$$;

-- Réserve une place. Verrou : deux envois simultanés ne prennent pas la même dernière place.
-- alerte_80 : vrai pour la réservation qui franchit 80 % du plafond, une fois par 24 heures (l'appelant
-- prévient alors le restaurant).
create function reserver_envoi(p_type text, p_priorite smallint, p_commande uuid, p_plafond integer) returns jsonb
language plpgsql as $$
declare
  n integer;
  seuil integer;
  rid bigint;
  vers_alerte boolean;
begin
  perform pg_advisory_xact_lock(hashtext('envois_courriel'));
  select count(*) into n from envois_courriel where cree_le > now() - interval '24 hours' and statut in ('reserve', 'envoye');
  seuil := floor(greatest(p_plafond, 0) * part_quota_priorite(p_priorite));
  if n >= seuil then
    insert into envois_courriel (type, priorite, commande_id, statut) values (p_type, p_priorite, p_commande, 'refuse');
    if p_commande is not null and exists (select 1 from commandes where id = p_commande) then
      insert into evenements_commande (commande_id, de, vers, par, detail)
      values (p_commande, null, 'courriel_non_envoye', 'site', p_type);
    end if;
    return jsonb_build_object('ok', false, 'envoyes', n);
  end if;
  insert into envois_courriel (type, priorite, commande_id, statut) values (p_type, p_priorite, p_commande, 'reserve') returning id into rid;
  vers_alerte := n + 1 >= ceil(p_plafond * 0.80) and n < ceil(p_plafond * 0.80)
    and not exists (select 1 from envois_courriel where type = 'alerte_quota' and cree_le > now() - interval '24 hours');
  return jsonb_build_object('ok', true, 'id', rid, 'envoyes', n + 1, 'alerte_80', vers_alerte);
end;
$$;

-- Fin d'un envoi réservé. Un échec SMTP rend la place.
create function terminer_envoi(p_id bigint, p_ok boolean) returns void
language sql as $$
  update envois_courriel set statut = case when p_ok then 'envoye' else 'echec' end
  where id = p_id and statut = 'reserve';
$$;

revoke execute on function
  part_quota_priorite(smallint), etat_quota_courriels(integer), reserver_envoi(text, smallint, uuid, integer), terminer_envoi(bigint, boolean)
  from public, anon, authenticated;
grant execute on function
  part_quota_priorite(smallint), etat_quota_courriels(integer), reserver_envoi(text, smallint, uuid, integer), terminer_envoi(bigint, boolean)
  to service_role;
