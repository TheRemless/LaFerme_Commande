-- Vague 3, bo-socle : rôle « responsable de service » (D1, oui de Jérémy le 13.11.2026). Il déconnecte un
-- appareil perdu (téléphone d'un livreur, tablette) : il voit la liste de l'équipe et les appareils de chacun,
-- et coupe un appareil. Jamais celui d'un gérant : un responsable ne peut pas couper l'accès de son patron.
-- Tout reste réservé au gérant tant que role_responsable_actif n'est pas à true (droit_personnel le relit).
--
-- Objets partagés recréés, chacun depuis sa seule définition en vigueur dans main :
--   liste_personnel (20261212140000_recherche_equipe.sql),
--   appareils_personnel et couper_appareil_personnel (20261210250000_appareils_equipe.sql).
-- Seul changement : gerant_nom devient auteur_droit(…, 'deconnecter_appareil'), et le garde du gérant visé.
-- Numéro réservé par le chef (plage de bo-socle 20261213150000 à 20261213170000).

create or replace function liste_personnel(p_personnel uuid) returns jsonb
language plpgsql stable as $$
begin
  -- Gérant, ou responsable de service pour déconnecter un appareil perdu (D1).
  perform auteur_droit(p_personnel, 'deconnecter_appareil');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email, 'nom', p.nom, 'role', p.role, 'actif', p.actif,
      'sessions', (select count(*) from sessions_personnel s where s.personnel_id = p.id and s.revoquee_le is null and s.expire_le > now()
                     and (p.role <> 'livreur' or s.cree_le > now() - interval '12 hours')),
      'derniere_connexion', (select max(s.cree_le) from sessions_personnel s where s.personnel_id = p.id),
      'derniere_activite', (select max(greatest(s.cree_le, s.vue_le)) from sessions_personnel s where s.personnel_id = p.id)
    ) order by p.actif desc, p.role desc, p.nom)
    from personnel p
  ), '[]'::jsonb);
end;
$$;

create or replace function appareils_personnel(p_membre uuid, p_personnel uuid, p_session_hache text) returns jsonb
language plpgsql stable as $$
begin
  perform auteur_droit(p_personnel, 'deconnecter_appareil');
  -- Les appareils d'un gérant ne regardent que les gérants.
  if exists (select 1 from personnel where id = p_membre and role = 'gerant')
     and not exists (select 1 from personnel where id = p_personnel and role = 'gerant' and actif) then
    raise exception 'droit_refuse';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'appareil', s.appareil, 'cree_le', s.cree_le, 'vue_le', s.vue_le, 'expire_le', s.expire_le,
      'actuel', s.jeton_hache = p_session_hache
    ) order by coalesce(s.vue_le, s.cree_le) desc)
    from sessions_personnel s
    join personnel p on p.id = s.personnel_id
    where s.personnel_id = p_membre and s.revoquee_le is null and s.expire_le > now()
      -- Même règle que personnel_de_session : la session d'un livreur ne vit que 12 heures.
      and (p.role <> 'livreur' or s.cree_le > now() - interval '12 hours')
  ), '[]'::jsonb);
end;
$$;

create or replace function couper_appareil_personnel(p_session uuid, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  auteur text := auteur_droit(p_personnel, 'deconnecter_appareil');
  e text;
begin
  -- Un responsable ne coupe jamais l'appareil d'un gérant.
  if exists (select 1 from sessions_personnel s join personnel p on p.id = s.personnel_id where s.id = p_session and p.role = 'gerant')
     and not exists (select 1 from personnel where id = p_personnel and role = 'gerant' and actif) then
    raise exception 'droit_refuse';
  end if;
  update sessions_personnel s set revoquee_le = now()
  from personnel p
  where s.id = p_session and p.id = s.personnel_id and s.revoquee_le is null
  returning p.email into e;
  if e is null then
    return false;
  end if;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, auteur, 'personnel', e, null, jsonb_build_object('sessions_coupees', 1));
  return true;
end;
$$;
