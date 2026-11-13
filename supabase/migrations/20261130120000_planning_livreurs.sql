-- Planning et suivi des livreurs (vague 3, bo-operations). Avant : la tablette savait qui était connecté,
-- personne ne savait qui devait travailler ce soir, ni combien chacun livrait, en combien de temps.
--
-- Planning = semaine type (Marco : du mardi au samedi soir) + exceptions d'un jour (Inès en plus samedi midi,
-- Marco malade ce soir). « Qui travaille ce soir » se lit pour n'importe quelle date. La semaine type se règle
-- au back-office (gérant) ; une absence ou un renfort du jour aussi depuis la tablette (équipe), car un livreur
-- malade appelle à 18h. Statistiques lues dans les tables de la vague 2 (livraisons, evenements_commande).
-- Pas d'objet partagé recréé : tables et fonctions neuves.

create table livreurs_semaine (
  livreur_id uuid not null references personnel (id) on delete cascade,
  jour smallint not null check (jour between 1 and 7),
  service text not null check (service in ('midi', 'soir')),
  primary key (livreur_id, jour, service)
);

create table livreurs_jours (
  livreur_id uuid not null references personnel (id) on delete cascade,
  jour date not null,
  service text not null check (service in ('midi', 'soir')),
  -- true : prévu ce jour-là en plus de sa semaine ; false : absent (malade, congé).
  present boolean not null,
  motif text check (motif is null or char_length(motif) between 2 and 120),
  modifie_le timestamptz not null default now(),
  primary key (livreur_id, jour, service)
);
create index livreurs_jours_jour_idx on livreurs_jours (jour);

alter table livreurs_semaine enable row level security;
alter table livreurs_jours enable row level security;
revoke all on livreurs_semaine, livreurs_jours from anon, authenticated;

-- Livreur actif, sinon exception.
create function livreur_actif(p_livreur uuid) returns text
language plpgsql stable as $$
declare
  n text;
begin
  select nom into n from personnel where id = p_livreur and role = 'livreur' and actif;
  if n is null then
    raise exception 'Livreur inconnu ou retiré de l''équipe';
  end if;
  return n;
end;
$$;

-- Semaine type d'un livreur (gérant) : la liste remplace l'ancienne. p_creneaux : [{ "jour": 2, "service": "soir" }].
create function regler_semaine_livreur(p_livreur uuid, p_creneaux jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  qui text := gerant_nom(p_personnel);
  nom_livreur text := livreur_actif(p_livreur);
  avant jsonb;
  apres jsonb;
begin
  if jsonb_typeof(p_creneaux) <> 'array' or jsonb_array_length(p_creneaux) > 14 then
    raise exception 'Semaine illisible';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_creneaux) e
    where jsonb_typeof(e) <> 'object' or (e ->> 'jour') !~ '^[1-7]$' or coalesce(e ->> 'service', '') not in ('midi', 'soir')
  ) then
    raise exception 'Semaine : jours de 1 à 7, services midi ou soir';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('jour', jour, 'service', service) order by jour, service), '[]'::jsonb) into avant
    from livreurs_semaine where livreur_id = p_livreur;
  delete from livreurs_semaine where livreur_id = p_livreur;
  insert into livreurs_semaine (livreur_id, jour, service)
    select distinct p_livreur, (e ->> 'jour')::smallint, e ->> 'service' from jsonb_array_elements(p_creneaux) e;
  select coalesce(jsonb_agg(jsonb_build_object('jour', jour, 'service', service) order by jour, service), '[]'::jsonb) into apres
    from livreurs_semaine where livreur_id = p_livreur;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'livreur_semaine', nom_livreur, avant, apres);
  return apres;
end;
$$;

-- Exception d'un jour (équipe : tablette ou back-office). p_present : true en plus, false absent, null pour
-- revenir à la semaine type. Du jour même (heure de Genève) à 60 jours.
create function regler_jour_livreur(p_livreur uuid, p_jour date, p_service text, p_present boolean, p_motif text, p_personnel uuid)
returns boolean
language plpgsql as $$
declare
  qui text := equipe_nom(p_personnel);
  nom_livreur text := livreur_actif(p_livreur);
  aujourd_hui date := (now() at time zone 'Europe/Zurich')::date;
  motif text := nullif(btrim(coalesce(p_motif, '')), '');
  avant livreurs_jours%rowtype;
begin
  if p_service is null or p_service not in ('midi', 'soir') then
    raise exception 'Service : midi ou soir';
  end if;
  if p_jour is null or p_jour < aujourd_hui or p_jour > aujourd_hui + 60 then
    raise exception 'Jour : d''aujourd''hui à 60 jours';
  end if;
  if motif is not null and char_length(motif) not between 2 and 120 then
    raise exception 'Motif : de 2 à 120 caractères';
  end if;
  select * into avant from livreurs_jours where livreur_id = p_livreur and jour = p_jour and service = p_service for update;
  if p_present is null then
    delete from livreurs_jours where livreur_id = p_livreur and jour = p_jour and service = p_service;
  else
    insert into livreurs_jours (livreur_id, jour, service, present, motif)
      values (p_livreur, p_jour, p_service, p_present, motif)
      on conflict (livreur_id, jour, service) do update set present = excluded.present, motif = excluded.motif, modifie_le = now();
  end if;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'livreur_jour', nom_livreur,
      case when avant.livreur_id is not null then jsonb_build_object('jour', avant.jour, 'service', avant.service, 'present', avant.present, 'motif', avant.motif) end,
      case when p_present is not null then jsonb_build_object('jour', p_jour, 'service', p_service, 'present', p_present, 'motif', motif) end);
  return true;
end;
$$;

-- Planning de p_debut à p_fin (31 jours au plus) : pour chaque jour et service où un livreur est prévu ou
-- noté, la liste avec sa source (semaine, ajout, absent). Livreurs actifs seulement.
create function planning_livreurs(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  with jours as (
    select d::date as jour, extract(isodow from d)::smallint as dow
    from generate_series(p_debut, least(p_fin, p_debut + 30), interval '1 day') d
  ),
  livreurs as (select id, nom from personnel where role = 'livreur' and actif),
  lignes as (
    select j.jour, s.service, l.id, l.nom, coalesce(x.present, true) as present,
      case when x.present is null then 'semaine' when x.present then 'semaine' else 'absent' end as source, x.motif
    from jours j
    join livreurs_semaine s on s.jour = j.dow
    join livreurs l on l.id = s.livreur_id
    left join livreurs_jours x on x.livreur_id = s.livreur_id and x.jour = j.jour and x.service = s.service
    union all
    select x.jour, x.service, l.id, l.nom, x.present, case when x.present then 'ajout' else 'absent' end, x.motif
    from livreurs_jours x
    join livreurs l on l.id = x.livreur_id
    where x.jour between p_debut and least(p_fin, p_debut + 30)
      and not exists (select 1 from livreurs_semaine s where s.livreur_id = x.livreur_id and s.jour = extract(isodow from x.jour) and s.service = x.service)
  )
  select coalesce(jsonb_agg(jsonb_build_object('jour', g.jour, 'service', g.service, 'presents', g.presents, 'livreurs', g.livreurs)
    order by g.jour, g.service = 'soir'), '[]'::jsonb)
  from (
    select jour, service, count(*) filter (where present) as presents,
      jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'present', present, 'source', source, 'motif', motif) order by present desc, nom) as livreurs
    from lignes group by jour, service
  ) g;
$$;

-- Livreurs actifs et leur semaine type, pour l'écran du planning.
create function semaines_livreurs() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'nom', p.nom,
    'creneaux', coalesce((select jsonb_agg(jsonb_build_object('jour', s.jour, 'service', s.service) order by s.jour, s.service)
      from livreurs_semaine s where s.livreur_id = p.id), '[]'::jsonb)
  ) order by p.nom), '[]'::jsonb)
  from personnel p where p.role = 'livreur' and p.actif;
$$;

-- Livraisons de chaque livreur sur une période (jours de vente, heure de Genève ; 93 jours au plus) :
-- attribuées (sans les réattribuées ni les reprises), livrées, client absent, problèmes signalés, temps moyen
-- entre « partie » et « terminée », retard moyen sur l'heure promise. Aucune donnée de client.
create function stats_livreurs(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  with l as (
    select l.livreur_id, l.commande_id, l.retiree_le, l.raison_retrait, l.probleme, o.statut, o.heure_confirmee
    from livraisons l
    join commandes o on o.id = l.commande_id
    where l.attribuee_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
      and l.attribuee_le < ((least(p_fin, p_debut + 92) + 1)::timestamp at time zone 'Europe/Zurich')
      and coalesce(l.raison_retrait, '') not in ('reattribuee', 'retiree')
  ),
  t as (
    select l.*,
      (select min(e.le) from evenements_commande e where e.commande_id = l.commande_id and e.vers = 'partie') as partie_le,
      (select min(e.le) from evenements_commande e where e.commande_id = l.commande_id and e.vers = 'terminee') as terminee_le
    from l
  )
  select coalesce(jsonb_agg(x order by x ->> 'nom'), '[]'::jsonb) from (
    select jsonb_build_object(
      'livreur_id', p.id,
      'nom', p.nom,
      'actif', p.actif,
      'livraisons', count(*),
      'livrees', count(*) filter (where t.statut = 'terminee' and t.retiree_le is null),
      'client_absent', count(*) filter (where t.raison_retrait = 'client_absent'),
      'problemes', count(*) filter (where t.probleme is not null),
      'minutes_moyennes', round(avg(extract(epoch from t.terminee_le - t.partie_le) / 60)
        filter (where t.retiree_le is null and t.partie_le is not null and t.terminee_le > t.partie_le)),
      'retard_moyen_minutes', round(avg(greatest(0, extract(epoch from t.terminee_le - t.heure_confirmee) / 60))
        filter (where t.retiree_le is null and t.terminee_le is not null and t.heure_confirmee is not null))
    ) as x
    from t join personnel p on p.id = t.livreur_id
    group by p.id, p.nom, p.actif
  ) s;
$$;

revoke execute on function
  livreur_actif(uuid), regler_semaine_livreur(uuid, jsonb, uuid), regler_jour_livreur(uuid, date, text, boolean, text, uuid),
  planning_livreurs(date, date), stats_livreurs(date, date), semaines_livreurs()
  from public, anon, authenticated;
grant execute on function
  livreur_actif(uuid), regler_semaine_livreur(uuid, jsonb, uuid), regler_jour_livreur(uuid, date, text, boolean, text, uuid),
  planning_livreurs(date, date), stats_livreurs(date, date), semaines_livreurs()
  to service_role;
