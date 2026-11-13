-- Messages d'information aux clients (vague 3, bo-operations) : une bannière sur le site (fermeture, retard
-- général, nouveauté), programmée, qui disparaît seule à sa fin. Le gérant écrit le texte : le site n'en
-- invente aucun (les textes passent par Jérémy, redaction-fr). L'affichage est fait par la session
-- client-commande, sur la config du service.
-- Pas d'objet partagé recréé : table et fonctions neuves.

create table messages_clients (
  id bigint generated always as identity primary key,
  texte text not null check (char_length(texte) between 5 and 200),
  debut timestamptz not null,
  fin timestamptz not null,
  -- accueil : la page d'accueil seulement ; partout : accueil, carte, panier et paiement.
  emplacement text not null default 'accueil' check (emplacement in ('accueil', 'partout')),
  cree_par text not null,
  cree_le timestamptz not null default now(),
  retire_le timestamptz,
  check (fin > debut)
);
create index messages_clients_fin_idx on messages_clients (fin) where retire_le is null;
alter table messages_clients enable row level security;
revoke all on messages_clients from anon, authenticated;

-- Programmer un message (gérant). Début : maintenant ou plus tard (60 jours au plus) ; durée : 60 jours au
-- plus ; 5 messages pas encore finis au plus, pour qu'un client ne lise jamais une pile de bandeaux.
create function ajouter_message_client(p jsonb, p_personnel uuid) returns bigint
language plpgsql as $$
declare
  qui text := gerant_nom(p_personnel);
  t text := btrim(regexp_replace(coalesce(p ->> 'texte', ''), '\s+', ' ', 'g'));
  d timestamptz := coalesce((p ->> 'debut')::timestamptz, now());
  f timestamptz := (p ->> 'fin')::timestamptz;
  e text := coalesce(p ->> 'emplacement', 'accueil');
  nouveau bigint;
begin
  if char_length(t) not between 5 and 200 then
    raise exception 'Texte : de 5 à 200 caractères';
  end if;
  if d < now() - interval '5 minutes' or d > now() + interval '60 days' then
    raise exception 'Début : maintenant ou dans les 60 jours';
  end if;
  if f is null or f <= d or f <= now() or f > d + interval '60 days' then
    raise exception 'Fin : après le début, 60 jours au plus';
  end if;
  if e not in ('accueil', 'partout') then
    raise exception 'Emplacement : accueil ou partout';
  end if;
  if (select count(*) from messages_clients where retire_le is null and fin > now()) >= 5 then
    raise exception 'Cinq messages au plus en même temps';
  end if;
  insert into messages_clients (texte, debut, fin, emplacement, cree_par) values (t, d, f, e, qui) returning id into nouveau;
  perform journaliser(p_personnel, 'message_client', nouveau::text, null,
    jsonb_build_object('texte', t, 'debut', d, 'fin', f, 'emplacement', e));
  return nouveau;
end;
$$;

-- Retirer un message avant sa fin (gérant). false : inconnu ou déjà retiré.
create function retirer_message_client(p_id bigint, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  m messages_clients%rowtype;
begin
  perform gerant_nom(p_personnel);
  select * into m from messages_clients where id = p_id for update;
  if not found or m.retire_le is not null then
    return false;
  end if;
  update messages_clients set retire_le = now() where id = p_id;
  perform journaliser(p_personnel, 'message_client', p_id::text,
    jsonb_build_object('texte', m.texte, 'debut', m.debut, 'fin', m.fin, 'emplacement', m.emplacement), null);
  return true;
end;
$$;

-- Pour le site (config du service, publique) : messages pas retirés, pas finis, qui commencent dans les
-- 24 heures. Le navigateur compare l'heure exacte : un message apparaît et disparaît à la minute près
-- malgré le cache. Aucun nom.
create function messages_actifs() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'texte', texte, 'debut', debut, 'fin', fin, 'emplacement', emplacement) order by debut, id), '[]'::jsonb)
  from messages_clients
  where retire_le is null and fin > now() and debut <= now() + interval '24 hours';
$$;

-- Pour le back-office : les messages pas finis et ceux des 30 derniers jours.
create function messages_gestion() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(m) order by m.debut desc, m.id desc), '[]'::jsonb)
  from messages_clients m
  where m.fin > now() - interval '30 days';
$$;

revoke execute on function ajouter_message_client(jsonb, uuid), retirer_message_client(bigint, uuid), messages_actifs(), messages_gestion()
  from public, anon, authenticated;
grant execute on function ajouter_message_client(jsonb, uuid), retirer_message_client(bigint, uuid), messages_actifs(), messages_gestion()
  to service_role;
