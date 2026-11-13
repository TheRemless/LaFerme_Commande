-- Connexion d'un livreur par un code affiché sur la tablette (vague 3, tablette ; proposition D13 point 3 de
-- produit-gestion) : zéro e-mail, une soirée. Le gérant ou un responsable touche « Code de connexion » à côté du
-- livreur, la tablette affiche 8 chiffres valables 10 minutes, le livreur les tape sur /livreur. Construit
-- DÉSACTIVÉ : réglage connexion_livreur_par_code à false (décision de Jérémy, relecture de sécurité par qualite).
-- Pour l'ouvrir : update reglages set valeur = 'true', proposition = false where cle = 'connexion_livreur_par_code';
--
-- Aucune fonction partagée recréée. Le frein par connexion est celui de la connexion de l'équipe :
-- attente_limite('echec_ip', …) et tentatives_connexion (même clé d'IP hachée, donc même compteur).
-- La session ouverte est une session de livreur ordinaire (sessions_personnel), 12 heures comme aujourd'hui
-- (S2-15) ; « Déconnecter un téléphone perdu » la coupe comme les autres.

insert into reglages (cle, valeur, proposition) values ('connexion_livreur_par_code', 'false', true)
  on conflict (cle) do nothing;

-- Le code n'est jamais gardé en clair : empreinte HMAC (« code-livreur »), comme les codes de connexion.
create table codes_livreur (
  id uuid primary key default gen_random_uuid(),
  livreur_id uuid not null references personnel (id) on delete cascade,
  code_hache text not null,
  cree_par uuid references personnel (id) on delete set null,
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null,
  utilise_le timestamptz
);
create index codes_livreur_valides_idx on codes_livreur (code_hache) where utilise_le is null;

alter table codes_livreur enable row level security;
revoke all on codes_livreur from anon, authenticated;
grant select, insert, update, delete on codes_livreur to service_role;

-- Gérant ou responsable actif, réglage ouvert, livreur actif. Un nouveau code annule le précédent de ce livreur.
-- Renvoie l'heure d'expiration. Erreurs nommées : connexion_par_code_desactivee, reserve_gerant, livreur_inconnu.
create function creer_code_livreur(p_livreur uuid, p_code_hache text, p_personnel uuid) returns timestamptz
language plpgsql as $$
declare
  qui text;
  fin timestamptz := now() + interval '10 minutes';
begin
  if not coalesce((select (valeur #>> '{}')::boolean from reglages where cle = 'connexion_livreur_par_code' and jsonb_typeof(valeur) = 'boolean'), false) then
    raise exception 'connexion_par_code_desactivee';
  end if;
  select nom into qui from personnel where id = p_personnel and actif and role in ('gerant', 'responsable');
  if qui is null then
    raise exception 'reserve_gerant';
  end if;
  if not exists (select 1 from personnel where id = p_livreur and actif and role = 'livreur') then
    raise exception 'livreur_inconnu';
  end if;
  if p_code_hache is null or length(p_code_hache) < 32 then
    raise exception 'code_illisible';
  end if;
  update codes_livreur set utilise_le = now() where livreur_id = p_livreur and utilise_le is null;
  insert into codes_livreur (livreur_id, code_hache, cree_par, expire_le) values (p_livreur, p_code_hache, p_personnel, fin);
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'livreur', 'code_connexion', null, jsonb_build_object('livreur', p_livreur, 'expire_le', fin));
  return fin;
end;
$$;

-- Le livreur tape le code. Même frein par connexion que l'équipe ; un code ne sert qu'une fois, dans ses 10 minutes,
-- pour un livreur encore actif. Renvoie { statut: 'ok' | 'invalide' | 'attente' | 'desactive', attente? }.
create function utiliser_code_livreur(p_code_hache text, p_cle_ip text, p_session_hache text) returns jsonb
language plpgsql as $$
declare
  a integer;
  c codes_livreur%rowtype;
begin
  if not coalesce((select (valeur #>> '{}')::boolean from reglages where cle = 'connexion_livreur_par_code' and jsonb_typeof(valeur) = 'boolean'), false) then
    return jsonb_build_object('statut', 'desactive');
  end if;
  perform pg_advisory_xact_lock(hashtext('code-livreur:' || p_cle_ip));
  a := attente_limite('echec_ip', p_cle_ip, 30, interval '1 hour', 2, 5);
  if a > 0 then
    return jsonb_build_object('statut', 'attente', 'attente', a);
  end if;
  select * into c from codes_livreur
    where code_hache = p_code_hache and utilise_le is null and expire_le > now()
    for update;
  if not found or not exists (select 1 from personnel where id = c.livreur_id and actif and role = 'livreur') then
    insert into tentatives_connexion (action, cle) values ('echec_ip', p_cle_ip);
    return jsonb_build_object('statut', 'invalide');
  end if;
  update codes_livreur set utilise_le = now() where id = c.id;
  insert into sessions_personnel (personnel_id, jeton_hache, expire_le) values (c.livreur_id, p_session_hache, now() + interval '12 hours');
  return jsonb_build_object('statut', 'ok');
end;
$$;

revoke all on function creer_code_livreur(uuid, text, uuid), utiliser_code_livreur(text, text, text) from public, anon, authenticated;
grant execute on function creer_code_livreur(uuid, text, uuid), utiliser_code_livreur(text, text, text) to service_role;
