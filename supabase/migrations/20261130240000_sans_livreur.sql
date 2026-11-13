-- Aucun livreur prévu (vague 3, bo-operations ; P1 de produit-gestion). Le planning disait « Personne de prévu
-- pour livrer » ce soir, mais l'accueil du back-office ne disait rien et le site prenait des livraisons.
-- 1. livreurs_prevus(jour, service) : le nombre de livreurs prévus au planning (semaine type corrigée par les
--    absences et les renforts du jour). Sert à l'alerte de l'accueil (src/lib/sans-livreur.ts, donnée de bo-socle).
-- 2. Règle proposée, désactivée (décision de Jérémy) : « Fermer la livraison d'un service sans livreur prévu ».
--    Cochée, le site ne propose pas la livraison pour un midi ou un soir où personne n'est prévu. Décochée (départ),
--    rien ne change : un planning pas tenu ne doit pas fermer la livraison.
-- Aucune fonction partagée recréée (le planning et la table des interrupteurs sont les miens).

create function livreurs_prevus(p_jour date, p_service text) returns integer
language sql stable as $$
  select count(*)::integer
  from personnel p
  where p.role = 'livreur' and p.actif and coalesce(
    (select x.present from livreurs_jours x where x.livreur_id = p.id and x.jour = p_jour and x.service = p_service),
    exists (select 1 from livreurs_semaine s where s.livreur_id = p.id and s.jour = extract(isodow from p_jour) and s.service = p_service)
  );
$$;

-- Services sans livreur prévu de p_debut à p_fin (15 jours au plus) : [{ jour, service }].
create function services_sans_livreur(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('jour', d.jour, 'service', s.service) order by d.jour, s.service = 'soir'), '[]'::jsonb)
  from (select g::date as jour from generate_series(p_debut, least(p_fin, p_debut + 14), interval '1 day') g) d
  cross join (values ('midi'), ('soir')) as s(service)
  where livreurs_prevus(d.jour, s.service) = 0;
$$;

revoke execute on function livreurs_prevus(date, text), services_sans_livreur(date, date) from public, anon, authenticated;
grant execute on function livreurs_prevus(date, text), services_sans_livreur(date, date) to service_role;

insert into reglages (cle, valeur, proposition) values ('livraison_sans_livreur_fermee', 'false', true)
  on conflict (cle) do nothing;
insert into interrupteurs_gestion (cle, libelle, aide, cache, ordre) values
  ('livraison_sans_livreur_fermee', 'Fermer la livraison d''un service sans livreur prévu',
    'Proposition, décision de Jérémy. Cochée : un midi ou un soir où le planning ne prévoit aucun livreur, le site ne propose pas la livraison (le retrait reste ouvert). Décochée : rien ne change, l''accueil du back-office avertit seulement.',
    'config-service', 60)
  on conflict (cle) do nothing;
