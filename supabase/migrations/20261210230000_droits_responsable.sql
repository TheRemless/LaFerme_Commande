-- Droits fins de l'équipe et rôle « responsable de service » (vague 3, bo-socle, décision D1 de Jérémy).
-- Construit DÉSACTIVÉ : sans le réglage role_responsable_actif à true, personne ne peut recevoir ce rôle et
-- rien ne change pour l'équipe. Pour l'activer (décision de Jérémy) :
--   insert into reglages (cle, valeur, proposition) values ('role_responsable_actif', 'true', false)
--   on conflict (cle) do update set valeur = excluded.valeur, proposition = false;
-- Le désactiver plus tard (valeur false) coupe aussi les droits des responsables déjà nommés : droit_personnel
-- relit le réglage à chaque appel.
-- Objets partagés recréés (repris de leur dernière définition dans main) : contrainte personnel_role_check
-- (20261119090000_livreurs.sql), fonctions ajouter_personnel (20261119090000_livreurs.sql) et
-- modifier_personnel (20261121090000_securite_2.sql). Seul changement : « responsable » admis quand le rôle est activé.

alter table personnel drop constraint personnel_role_check;
alter table personnel add constraint personnel_role_check check (role in ('service', 'gerant', 'livreur', 'responsable'));

create function role_responsable_actif() returns boolean
language sql stable as $$
  select coalesce((select valeur = 'true'::jsonb from reglages where cle = 'role_responsable_actif'), false);
$$;

-- Le tableau D1 (carnet de la vague 3), action par action. Le gérant peut tout ; un membre inactif rien.
-- Les actions de la tablette (accepter, statuts, pause, ruptures, livraisons, annuler avant « Prête », manque)
-- restent contrôlées comme aujourd'hui par le rôle : elles ne sont pas dans cette liste.
create function droit_personnel(p_personnel uuid, p_action text) returns boolean
language plpgsql stable as $$
declare
  r text;
begin
  select role into r from personnel where id = p_personnel and actif;
  if r is null then
    return false;
  end if;
  if r = 'gerant' then
    return true;
  end if;
  if r = 'responsable' and role_responsable_actif() then
    return p_action in (
      'annuler_apres_prete',      -- annuler après « Prête » ou une livraison partie
      'rembourser',               -- rembourser après coup, jusqu'au montant de la commande
      'client_absent',            -- rendre tout, une partie ou rien
      'modifier_commande',        -- modifier une commande acceptée
      'voir_commandes',           -- commandes passées, retrouver un client
      'deconnecter_appareil',     -- téléphone perdu (livreur, tablette)
      'fermer_service'            -- fermer le service du jour (panne, coup dur)
    );
  end if;
  return false;
end;
$$;

-- Comme gerant_nom, pour une action précise : le nom de l'auteur, ou une erreur si le droit manque.
create function auteur_droit(p_personnel uuid, p_action text) returns text
language plpgsql stable as $$
declare
  n text;
begin
  if not droit_personnel(p_personnel, p_action) then
    raise exception 'droit_refuse';
  end if;
  select nom into n from personnel where id = p_personnel;
  return n;
end;
$$;

revoke all on function role_responsable_actif(), droit_personnel(uuid, text), auteur_droit(uuid, text) from public, anon, authenticated;
grant execute on function role_responsable_actif(), droit_personnel(uuid, text), auteur_droit(uuid, text) to service_role;

create or replace function ajouter_personnel(p_email text, p_nom text, p_role text, p_personnel uuid) returns uuid
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  e text := lower(btrim(p_email));
  n text := btrim(regexp_replace(coalesce(p_nom, ''), '\s+', ' ', 'g'));
  avant personnel%rowtype;
  pid uuid;
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e) not between 5 and 120 then
    raise exception 'adresse_invalide';
  end if;
  if length(n) not between 1 and 60 then
    raise exception 'nom_invalide';
  end if;
  if p_role not in ('service', 'gerant', 'livreur', 'responsable') then
    raise exception 'role_invalide';
  end if;
  if p_role = 'responsable' and not role_responsable_actif() then
    raise exception 'role_desactive';
  end if;
  select * into avant from personnel where email = e for update;
  if found and avant.actif then
    raise exception 'deja_membre';
  end if;
  if found then
    update personnel set nom = n, role = p_role, actif = true where id = avant.id returning id into pid;
    -- Un membre retiré à l'ancienne (actif = false en SQL) pouvait garder ses sessions : on les coupe.
    update sessions_personnel set revoquee_le = now() where personnel_id = pid and revoquee_le is null;
  else
    insert into personnel (email, nom, role) values (e, n, p_role) returning id into pid;
  end if;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, auteur, 'personnel', e,
    case when avant.id is null then null else jsonb_build_object('nom', avant.nom, 'role', avant.role, 'actif', avant.actif) end,
    jsonb_build_object('nom', n, 'role', p_role, 'actif', true));
  return pid;
end;
$$;

create or replace function modifier_personnel(p_id uuid, p jsonb, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  avant personnel%rowtype;
  apres personnel%rowtype;
  n text;
begin
  -- Verrou sur les gérants actifs : deux retraits simultanés ne laissent pas la maison sans gérant.
  perform 1 from personnel where role = 'gerant' and actif for update;
  -- Toujours gérant une fois le verrou obtenu (lecture fraîche après l'attente).
  auteur := gerant_nom(p_personnel);
  select * into avant from personnel where id = p_id for update;
  if not found then
    return false;
  end if;
  apres := avant;
  if p ? 'nom' then
    n := btrim(regexp_replace(coalesce(p ->> 'nom', ''), '\s+', ' ', 'g'));
    if length(n) not between 1 and 60 then
      raise exception 'nom_invalide';
    end if;
    apres.nom := n;
  end if;
  if p ? 'role' then
    if p ->> 'role' not in ('service', 'gerant', 'livreur', 'responsable') then
      raise exception 'role_invalide';
    end if;
    if p ->> 'role' = 'responsable' and avant.role <> 'responsable' and not role_responsable_actif() then
      raise exception 'role_desactive';
    end if;
    apres.role := p ->> 'role';
  end if;
  if p ? 'actif' then
    apres.actif := (p ->> 'actif')::boolean;
  end if;
  if avant.role = 'gerant' and avant.actif and not (apres.role = 'gerant' and apres.actif)
     and (select count(*) from personnel where role = 'gerant' and actif) <= 1 then
    raise exception 'dernier_gerant';
  end if;
  update personnel set nom = apres.nom, role = apres.role, actif = apres.actif where id = p_id;
  if not apres.actif then
    update sessions_personnel set revoquee_le = now() where personnel_id = p_id and revoquee_le is null;
  end if;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, auteur, 'personnel', avant.email,
    jsonb_build_object('nom', avant.nom, 'role', avant.role, 'actif', avant.actif),
    jsonb_build_object('nom', apres.nom, 'role', apres.role, 'actif', apres.actif));
  return true;
end;
$$;
