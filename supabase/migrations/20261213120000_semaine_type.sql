-- Jours fermés chaque semaine, réglables au back-office (vague 3, bo-operations ; demande de Jérémy du 13.11.2026 :
-- « Même s'il y a des jours fixes fermés chaque semaine, faut qu'on puisse avoir pas mal de choix »). Les services
-- de la semaine (table horaires) ne se changeaient qu'en heures : dimanche et lundi fermés venaient de la migration
-- 20261106120000. Le gérant ferme désormais un service chaque semaine (le mercredi midi, tout le lundi) ou en ouvre
-- un (le dimanche soir), avec ses quatre heures. Les fermetures et ouvertures d'un jour précis restent à part.
--
-- Fermer chaque semaine supprime la ligne de horaires (le journal garde ses heures) ; les commandes déjà prises
-- pour ce jour restent valables, l'écran les compte. Aucune fonction partagée recréée.

-- Commandes à venir déjà prises pour ce jour de la semaine et ce service (midi avant 15h), pas encore terminées.
create function commandes_jour_semaine(p_jour smallint, p_service text) returns integer
language sql stable as $$
  select count(*)::integer from commandes c
  where c.statut in ('nouvelle', 'acceptee', 'en_preparation')
    and c.quand_type = 'creneau'
    and c.quand_date >= (now() at time zone 'Europe/Zurich')::date
    and extract(isodow from c.quand_date) = p_jour
    and (case when c.quand_minutes < 15 * 60 then 'midi' else 'soir' end) = p_service;
$$;

-- Fermer un service chaque semaine. Faux s'il était déjà fermé.
create function fermer_service_semaine(p_jour smallint, p_service text, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  qui text := gerant_nom(p_personnel);
  avant horaires%rowtype;
begin
  delete from horaires where jour = p_jour and service = p_service returning * into avant;
  if not found then
    return false;
  end if;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'horaire_semaine', p_jour || '-' || p_service, to_jsonb(avant), null);
  return true;
end;
$$;

-- Ouvrir un service chaque semaine avec ses quatre heures. Rend l'identifiant ; erreur s'il est déjà ouvert.
create function ouvrir_service_semaine(p_jour smallint, p_service text, p jsonb, p_personnel uuid) returns smallint
language plpgsql as $$
declare
  qui text := gerant_nom(p_personnel);
  apres horaires%rowtype;
begin
  if p_jour is null or p_jour not between 1 and 7 or p_service is null or p_service not in ('midi', 'soir') then
    raise exception 'Jour ou service inconnu';
  end if;
  if exists (select 1 from horaires where jour = p_jour and service = p_service) then
    raise exception 'Ce service est déjà ouvert';
  end if;
  insert into horaires (jour, service, premiere_heure, derniere_heure, derniere_commande, derniere_commande_pizzas, proposition)
    values (p_jour, p_service, (p ->> 'premiere_heure')::time, (p ->> 'derniere_heure')::time,
      (p ->> 'derniere_commande')::time, (p ->> 'derniere_commande_pizzas')::time, false)
    returning * into apres;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'horaire_semaine', p_jour || '-' || p_service, null, to_jsonb(apres));
  return apres.id;
end;
$$;

revoke execute on function commandes_jour_semaine(smallint, text), fermer_service_semaine(smallint, text, uuid),
  ouvrir_service_semaine(smallint, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function commandes_jour_semaine(smallint, text), fermer_service_semaine(smallint, text, uuid),
  ouvrir_service_semaine(smallint, text, jsonb, uuid) to service_role;
