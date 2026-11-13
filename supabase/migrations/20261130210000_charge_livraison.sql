-- Heure promise réaliste, version 2 (vague 3, bo-operations). La version 1 (20261130100000) mesure la file
-- du four et de la cuisine. Un soir où un seul livreur est là au lieu de deux et qu'il a déjà quatre sacs,
-- la cuisine suit mais la livraison arrive en retard. Désormais les livreurs présents ce service (planning,
-- 20261130120000) et les livraisons à faire ou en route allongent aussi les heures annoncées en livraison.
--
-- Règle : attente d'un livreur = livraisons à faire ou en route (celles parties pour moitié), divisées par
-- (livreurs présents × livraisons qu'un livreur fait en une heure). Une commande passée maintenant est prête après la préparation habituelle ;
-- si un livreur ne peut pas la prendre avant, l'écart allonge les heures de livraison, arrondi aux 5 minutes
-- et plafonné comme la cuisine (allongement_max_minutes). Le retrait n'est pas touché.
--
-- Pas compté (rien ne change pour les clients) tant que le débit d'un livreur vaut 0 (en attente du chiffre de
-- Jérémy) ou qu'aucun livreur n'est prévu ce service (planning pas tenu : on ne devine pas).
-- Fonctions recréées (les miennes, dernière définition : 20261130190000_interrupteurs_gestion.sql) :
-- regler_reglage_general et reglages_generaux, pour le nouveau réglage livraisons_par_livreur_heure.

insert into reglages (cle, valeur, proposition) values
  -- Livraisons qu'un livreur fait en une heure, aller et retour compris. 0 : livraison non comptée.
  ('livraisons_par_livreur_heure', '0', true)
  on conflict (cle) do nothing;

-- Livraisons pas encore terminées : lues à chaque calcul (une fois par minute au plus, config en cache).
create index commandes_livraisons_en_cours_idx on commandes (heure_confirmee)
  where mode = 'livraison' and statut in ('nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie');

-- Attente d'un livreur à l'instant. Livreurs présents : planning du service en cours (midi avant 15h à
-- Genève, soir ensuite), semaine type corrigée par les absences et renforts du jour. Livraisons : commandes
-- en livraison pas terminées (de nouvelle à partie), dues avant qu'une commande passée maintenant soit
-- livrée au plus tard (délai de zone le plus long plus l'allongement maximal), et pas en retard de plus que
-- l'allongement maximal. Aucune donnée de client, aucun nom de livreur.
create function charge_livraison() returns jsonb
language sql stable as $$
  with ici as (
    select (now() at time zone 'Europe/Zurich') as t
  ),
  r as (
    select
      (ici.t)::date as jour,
      extract(isodow from ici.t)::smallint as dow,
      case when extract(hour from ici.t) < 15 then 'midi' else 'soir' end as service,
      coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'preparation_minutes'), 20) as prep,
      coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'allongement_max_minutes'), 0) as plafond,
      coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'livraisons_par_livreur_heure'), 0) as debit,
      coalesce((select max(delai_max) from zones_livraison where active), 0) as zone_max
    from ici
  ),
  -- Prévus ce service d'après le planning, plus ceux qui ont reçu une livraison depuis deux heures : un
  -- planning tenu à moitié (un renfort saisi, les habitués jamais déclarés) ne fait pas croire à un seul livreur.
  presents as (
    select count(*)::integer as n
    from personnel p, r
    where p.role = 'livreur' and p.actif and (
      coalesce(
        (select x.present from livreurs_jours x where x.livreur_id = p.id and x.jour = r.jour and x.service = r.service),
        exists (select 1 from livreurs_semaine s where s.livreur_id = p.id and s.jour = r.dow and s.service = r.service)
      )
      or exists (select 1 from livraisons v where v.livreur_id = p.id and v.attribuee_le > now() - interval '2 hours')
    )
  ),
  dues as (
    select c.statut, coalesce(
      c.heure_confirmee,
      case when c.quand_type = 'creneau' then (c.quand_date + make_interval(mins => c.quand_minutes)) at time zone 'Europe/Zurich' end,
      now()
    ) as due
    from commandes c
    where c.mode = 'livraison' and c.statut in ('nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie')
  ),
  -- Une livraison partie compte pour moitié : le livreur a déjà fait une partie du trajet.
  livraisons as (
    select count(*)::integer as n, count(*) filter (where d.statut = 'partie')::integer as parties
    from dues d, r
    where d.due <= now() + make_interval(mins => greatest(r.zone_max, r.prep) + r.plafond)
      and d.due > now() - make_interval(mins => greatest(r.plafond, 15))
  ),
  calcul as (
    select r.prep, r.plafond, r.debit, p.n as livreurs, l.n as nb,
      r.debit > 0 and p.n > 0 as compte,
      case when r.debit > 0 and p.n > 0 then ceil((l.n - l.parties / 2.0) * 60.0 / (p.n * r.debit))::integer else 0 end as attente
    from r, presents p, livraisons l
  )
  select jsonb_build_object(
    'livraisons', c.nb,
    'livreurs', c.livreurs,
    'attente_minutes', c.attente,
    'compte', c.compte,
    'allongement_minutes', least(c.plafond, (ceil(greatest(0, c.attente - c.prep) / 5.0) * 5)::integer)
  )
  from calcul c;
$$;

revoke execute on function charge_livraison() from public, anon, authenticated;
grant execute on function charge_livraison() to service_role;

-- Le réglage se règle au back-office (bloc Rythme) : bornes 0 à 20. Seul changement par rapport à 20261130190000.
create or replace function regler_reglage_general(p_cle text, p_valeur text, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  qui text := gerant_nom(p_personnel);
  n integer;
  avant jsonb;
  apres jsonb;
  email text := lower(btrim(coalesce(p_valeur, '')));
  cache_i text;
begin
  if p_cle = 'alerte_email' then
    if email = '' then
      apres := 'null'::jsonb;
    elsif char_length(email) > 120 or email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
      raise exception 'Adresse e-mail illisible';
    else
      apres := to_jsonb(email);
    end if;
    select valeur into avant from reglages_prives where cle = p_cle for update;
    update reglages_prives set valeur = apres, modifie_le = now() where cle = p_cle;
    -- L'adresse n'est pas recopiée dans le journal : seulement qu'elle a changé.
    insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
      values (p_personnel, qui, 'reglage', p_cle,
        case when avant is null or avant = 'null'::jsonb then to_jsonb('variable ALERTE_EMAIL'::text) else to_jsonb('adresse saisie'::text) end,
        case when apres = 'null'::jsonb then to_jsonb('variable ALERTE_EMAIL'::text) else to_jsonb('adresse saisie'::text) end);
    return apres;
  end if;

  -- Interrupteurs déclarés dans interrupteurs_gestion (oui ou non). Renvoie la valeur et le cache à vider.
  select i.cache into cache_i from interrupteurs_gestion i where i.cle = p_cle;
  if found then
    if p_valeur is null or p_valeur not in ('true', 'false') then
      raise exception 'Oui ou non';
    end if;
    select valeur into avant from reglages where cle = p_cle for update;
    if not found then
      raise exception 'Réglage inconnu';
    end if;
    update reglages set valeur = to_jsonb(p_valeur::boolean), proposition = false where cle = p_cle;
    perform journaliser(p_personnel, 'reglage', p_cle, avant, to_jsonb(p_valeur::boolean));
    return jsonb_build_object('valeur', p_valeur::boolean, 'cache', cache_i);
  end if;

  if p_cle is null or p_cle not in ('plafond_codes_clients_jour', 'creneau_minutes', 'avance_jours',
      'debit_pizza_quart_heure', 'debit_cuisine_quart_heure', 'allongement_max_minutes',
      'fourchette_livraison_minutes', 'fourchette_retrait_minutes', 'livraisons_par_livreur_heure') then
    raise exception 'Réglage inconnu';
  end if;
  if p_valeur is null or p_valeur !~ '^[0-9]{1,4}$' then
    raise exception 'Un nombre entier';
  end if;
  n := p_valeur::integer;
  if (p_cle = 'plafond_codes_clients_jour' and n not between 20 and 450)
    or (p_cle = 'creneau_minutes' and n not in (10, 15, 20, 30))
    or (p_cle = 'avance_jours' and n not between 0 and 14)
    or (p_cle in ('debit_pizza_quart_heure', 'debit_cuisine_quart_heure') and n not between 0 and 100)
    or (p_cle = 'allongement_max_minutes' and n not between 0 and 90)
    or (p_cle in ('fourchette_livraison_minutes', 'fourchette_retrait_minutes') and n not between 0 and 60)
    or (p_cle = 'livraisons_par_livreur_heure' and n not between 0 and 20) then
    raise exception 'Valeur hors limites';
  end if;
  select valeur into avant from reglages where cle = p_cle for update;
  update reglages set valeur = to_jsonb(n), proposition = false where cle = p_cle;
  perform journaliser(p_personnel, 'reglage', p_cle, avant, to_jsonb(n));
  return to_jsonb(n);
end;
$$;

create or replace function reglages_generaux() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'plafond_codes_clients_jour', (select valeur from reglages where cle = 'plafond_codes_clients_jour'),
    'creneau_minutes', (select valeur from reglages where cle = 'creneau_minutes'),
    'avance_jours', (select valeur from reglages where cle = 'avance_jours'),
    'alerte_email', (select valeur from reglages_prives where cle = 'alerte_email'),
    'annulation_client_active', coalesce((select valeur from reglages where cle = 'annulation_client_active'), 'false'::jsonb),
    'plats_populaires_actifs', coalesce((select valeur from reglages where cle = 'plats_populaires_actifs'), 'false'::jsonb),
    'suggestion_panier_active', coalesce((select valeur from reglages where cle = 'suggestion_panier_active'), 'false'::jsonb),
    'interrupteurs', (select coalesce(jsonb_agg(jsonb_build_object('cle', i.cle, 'libelle', i.libelle, 'aide', i.aide,
      'valeur', coalesce((select r.valeur = 'true'::jsonb from reglages r where r.cle = i.cle), false)) order by i.ordre, i.cle), '[]'::jsonb)
      from interrupteurs_gestion i where exists (select 1 from reglages r where r.cle = i.cle)),
    'rythme', (select coalesce(jsonb_object_agg(cle, valeur), '{}'::jsonb) from reglages where cle in (
      'debit_pizza_quart_heure', 'debit_cuisine_quart_heure', 'allongement_max_minutes',
      'fourchette_livraison_minutes', 'fourchette_retrait_minutes', 'livraisons_par_livreur_heure'))
  );
$$;
