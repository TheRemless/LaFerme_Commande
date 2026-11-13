-- regler_rupture_groupee refuse en base un livreur (défense en profondeur, passe finale de qualite du 13.11.2026).
-- La route l'arrêtait déjà (exigerPersonnel) ; la fonction ne vérifiait que « membre actif ».
-- Repart de 20261210090000_disponibilites.sql. Seul changement : le contrôle du rôle (service, gérant,
-- responsable quand role_responsable_actif) et l'erreur droit_refuse. create or replace garde les droits
-- d'exécution (service_role seul).

create or replace function regler_rupture_groupee(p_cible text, p_jusqu_au date, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  aujourdhui date := (now() at time zone 'Europe/Zurich')::date;
  avant date;
  qui text;
begin
  select role into qui from personnel where id = p_personnel and actif;
  if qui is null then
    raise exception 'personnel_inconnu';
  end if;
  -- Même règle que la route (exigerPersonnel) : service et gérant ; responsable tant que le rôle est activé
  -- (un responsable reste dans l'équipe quand role_responsable_actif est coupé, son droit est relu ici).
  if not (qui in ('service', 'gerant') or (qui = 'responsable' and role_responsable_actif())) then
    raise exception 'droit_refuse';
  end if;
  if p_cible is null or p_cible !~ '^(poste:(pizza|cuisine)|categorie:[a-z0-9-]{1,40})$'
     or (p_cible like 'categorie:%' and not exists (select 1 from categories where slug = substr(p_cible, 11) and slug <> 'plat-du-jour')) then
    return false;
  end if;
  if p_jusqu_au is not null and (p_jusqu_au < aujourdhui or p_jusqu_au > aujourdhui + 60) then
    raise exception 'date_rupture';
  end if;
  select jusqu_au into avant from ruptures_groupees where cible = p_cible for update;
  if p_jusqu_au is null then
    delete from ruptures_groupees where cible = p_cible;
  else
    insert into ruptures_groupees (cible, jusqu_au) values (p_cible, p_jusqu_au)
      on conflict (cible) do update set jusqu_au = excluded.jusqu_au;
  end if;
  insert into journal_personnel (personnel_id, evenement)
    values (p_personnel, 'rupture groupee ' || p_cible || ' ' || coalesce(p_jusqu_au::text, 'levee'));
  if exists (select 1 from personnel where id = p_personnel and actif and role = 'gerant') then
    perform journaliser(p_personnel, 'rupture_groupee', p_cible,
      jsonb_build_object('jusqu_au', case when avant >= aujourdhui then avant end),
      jsonb_build_object('jusqu_au', p_jusqu_au));
  end if;
  return true;
end;
$$;
