-- Lot 7b : back-office, réservé au rôle « gerant ».
-- Même modèle que le reste : aucune écriture publique, fonctions réservées au serveur. Le serveur ne les
-- appelle qu'avec l'identifiant d'un gérant tiré d'une session vérifiée. Chaque modification est
-- journalisée : qui, quand, avant et après.

create table journal_gestion (
  id bigint generated always as identity primary key,
  personnel_id uuid references personnel (id) on delete set null,
  -- Le nom est copié : le journal reste lisible si le membre est retiré.
  personnel_nom text not null,
  objet text not null check (objet in ('plat', 'option', 'retraits', 'zone', 'horaire', 'fermeture', 'import')),
  cle text not null,
  avant jsonb,
  apres jsonb,
  le timestamptz not null default now()
);
create index journal_gestion_idx on journal_gestion (le desc);

alter table journal_gestion enable row level security;
revoke all on journal_gestion from anon, authenticated;

-- Nom du gérant, ou erreur : aucune fonction de gestion ne s'exécute pour quelqu'un d'autre.
create function gerant_nom(p_personnel uuid) returns text
language plpgsql stable as $$
declare
  n text;
begin
  select nom into n from personnel where id = p_personnel and role = 'gerant' and actif;
  if n is null then
    raise exception 'Réservé au gérant';
  end if;
  return n;
end;
$$;

create function journaliser(p_personnel uuid, p_objet text, p_cle text, p_avant jsonb, p_apres jsonb) returns void
language sql as $$
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, gerant_nom(p_personnel), p_objet, p_cle, p_avant, p_apres);
$$;

-- ---------- Lecture ----------

-- Toute la carte, plats non commandables compris, avec ce qui bloque la mise en ligne.
create function gestion_carte() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'nom', c.nom,
        'plats', coalesce((
          select jsonb_agg(jsonb_build_object(
            'slug', p.slug, 'nom', p.nom, 'description', p.description, 'prix_centimes', p.prix_centimes,
            'prix_a_valider', p.prix_a_valider, 'commandable', p.commandable, 'station', p.station, 'photo', p.photo,
            'provenance', p.provenance, 'provenances_a_fournir', to_jsonb(p.provenances_a_fournir), 'allergenes', p.allergenes,
            'retraits', coalesce((select jsonb_agg(jsonb_build_object('nom', r.nom, 'a_valider', r.a_valider) order by r.ordre) from plat_retraits r where r.plat_id = p.id), '[]'::jsonb),
            'groupes', coalesce((select jsonb_agg(g.slug order by pg.ordre) from plat_groupes pg join groupes_options g on g.id = pg.groupe_id where pg.plat_id = p.id), '[]'::jsonb),
            'bloquants', coalesce((select jsonb_agg(b.motif) from plats_bloquants b where b.slug = p.slug), '[]'::jsonb)
          ) order by p.ordre)
          from plats p where p.categorie_id = c.id
        ), '[]'::jsonb)
      ) order by c.ordre)
      from categories c
    ), '[]'::jsonb),
    'groupes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', g.slug, 'nom', g.nom, 'choix_min', g.choix_min, 'choix_max', g.choix_max,
        'options', coalesce((select jsonb_agg(jsonb_build_object('nom', o.nom, 'prix_centimes', o.prix_centimes, 'prix_a_valider', o.prix_a_valider, 'actif', o.actif) order by o.ordre) from options o where o.groupe_id = g.id), '[]'::jsonb)
      ) order by g.id)
      from groupes_options g
    ), '[]'::jsonb),
    -- Nombre de plats qui bloquent la mise en ligne (un plat compte une fois, quels que soient ses motifs).
    'bloquants', (select count(distinct slug) from plats_bloquants)
  );
$$;

create function gestion_service() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'zones', coalesce((select jsonb_agg(to_jsonb(z) || jsonb_build_object(
      'npa', coalesce((select jsonb_agg(jsonb_build_object('npa', n.npa, 'localite', n.localite) order by n.npa, n.localite) from zone_npa n where n.zone_numero = z.numero), '[]'::jsonb)
    ) order by z.numero) from zones_livraison z), '[]'::jsonb),
    'horaires', coalesce((select jsonb_agg(to_jsonb(h) order by h.jour, h.service) from horaires h), '[]'::jsonb),
    'fermetures', coalesce((select jsonb_agg(to_jsonb(f) order by f.debut) from fermetures f), '[]'::jsonb)
  );
$$;

create function journal_gestion_recent(p_limite integer) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(j) - 'personnel_id' order by j.le desc), '[]'::jsonb)
  from (select * from journal_gestion order by le desc limit least(greatest(p_limite, 1), 500)) j;
$$;

-- ---------- Carte ----------

-- Champs modifiables d'un plat. Une clé absente ne change rien. « prix_valide » vrai lève le drapeau
-- de validation ; un nouveau prix sans « prix_valide » le remet à valider.
create function modifier_plat(p_slug text, p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  avant plats%rowtype;
  apres plats%rowtype;
begin
  perform gerant_nom(p_personnel);
  select * into avant from plats where slug = p_slug for update;
  if not found then
    return null;
  end if;
  update plats set
    nom = coalesce(p ->> 'nom', nom),
    description = coalesce(p ->> 'description', description),
    prix_centimes = coalesce((p ->> 'prix_centimes')::integer, prix_centimes),
    prix_a_valider = case
      when p ? 'prix_valide' then not (p ->> 'prix_valide')::boolean
      when p ? 'prix_centimes' and (p ->> 'prix_centimes')::integer <> avant.prix_centimes then true
      else prix_a_valider end,
    commandable = coalesce((p ->> 'commandable')::boolean, commandable),
    station = coalesce((p ->> 'station')::station, station),
    photo = case when p ? 'photo' then nullif(p ->> 'photo', '') else photo end,
    provenance = case when p ? 'provenance' then nullif(p ->> 'provenance', '') else provenance end,
    provenances_a_fournir = case when p ? 'provenances_a_fournir'
      then array(select jsonb_array_elements_text(p -> 'provenances_a_fournir')) else provenances_a_fournir end,
    allergenes = case when p ? 'allergenes' then nullif(p ->> 'allergenes', '') else allergenes end
  where id = avant.id
  returning * into apres;
  perform journaliser(p_personnel, 'plat', p_slug,
    to_jsonb(avant) - 'id' - 'cree_le' - 'modifie_le', to_jsonb(apres) - 'id' - 'cree_le' - 'modifie_le');
  return to_jsonb(apres) - 'id';
end;
$$;

-- Retraits gratuits d'un plat : la liste donnée devient la liste validée (ajouts, retraits, validation).
create function modifier_retraits(p_slug text, p_noms text[], p_personnel uuid) returns boolean
language plpgsql as $$
declare
  pid uuid;
  avant jsonb;
begin
  perform gerant_nom(p_personnel);
  select id into pid from plats where slug = p_slug;
  if pid is null then
    return false;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('nom', nom, 'a_valider', a_valider) order by ordre), '[]'::jsonb) into avant from plat_retraits where plat_id = pid;
  delete from plat_retraits where plat_id = pid and not (nom = any (p_noms));
  insert into plat_retraits (plat_id, nom, ordre, a_valider)
    select pid, n.nom, (n.i - 1)::smallint, false from unnest(p_noms) with ordinality as n(nom, i)
    on conflict (plat_id, nom) do update set a_valider = false, ordre = excluded.ordre;
  perform journaliser(p_personnel, 'retraits', p_slug, avant, to_jsonb(p_noms));
  return true;
end;
$$;

create function modifier_option(p_groupe text, p_nom text, p jsonb, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant options%rowtype;
  apres options%rowtype;
begin
  perform gerant_nom(p_personnel);
  select o.* into avant from options o join groupes_options g on g.id = o.groupe_id where g.slug = p_groupe and o.nom = p_nom for update;
  if not found then
    return false;
  end if;
  update options set
    prix_centimes = coalesce((p ->> 'prix_centimes')::integer, prix_centimes),
    prix_a_valider = case
      when p ? 'prix_valide' then not (p ->> 'prix_valide')::boolean
      when p ? 'prix_centimes' and (p ->> 'prix_centimes')::integer <> avant.prix_centimes then true
      else prix_a_valider end,
    actif = coalesce((p ->> 'actif')::boolean, actif)
  where id = avant.id
  returning * into apres;
  perform journaliser(p_personnel, 'option', p_groupe || '/' || p_nom, to_jsonb(avant) - 'id' - 'groupe_id' - 'modifie_le', to_jsonb(apres) - 'id' - 'groupe_id' - 'modifie_le');
  return true;
end;
$$;

-- Import du tableau docs/validation-carte.xlsx : plats et options d'un bloc. Tout passe ou rien ne passe.
-- p = { "plats": [{ "slug", ...champs de modifier_plat }], "options": [{ "groupe", "nom", ...champs }] }
create function importer_validation(p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  x jsonb;
  n_plats integer := 0;
  n_options integer := 0;
begin
  perform gerant_nom(p_personnel);
  for x in select * from jsonb_array_elements(coalesce(p -> 'plats', '[]'::jsonb)) loop
    if modifier_plat(x ->> 'slug', x - 'slug', p_personnel) is null then
      raise exception 'Plat inconnu : %', x ->> 'slug';
    end if;
    n_plats := n_plats + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'options', '[]'::jsonb)) loop
    if not modifier_option(x ->> 'groupe', x ->> 'nom', x - 'groupe' - 'nom', p_personnel) then
      raise exception 'Option inconnue : %', x ->> 'nom';
    end if;
    n_options := n_options + 1;
  end loop;
  perform journaliser(p_personnel, 'import', 'validation-carte.xlsx', null, jsonb_build_object('plats', n_plats, 'options', n_options));
  return jsonb_build_object('plats', n_plats, 'options', n_options, 'bloquants', (select count(distinct slug) from plats_bloquants));
end;
$$;

-- ---------- Livraison et horaires ----------

-- Une valeur enregistrée depuis le back-office n'est plus une proposition.
create function modifier_zone(p_numero smallint, p jsonb, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant zones_livraison%rowtype;
  apres zones_livraison%rowtype;
begin
  perform gerant_nom(p_personnel);
  select * into avant from zones_livraison where numero = p_numero for update;
  if not found then
    return false;
  end if;
  update zones_livraison set
    frais_centimes = coalesce((p ->> 'frais_centimes')::integer, frais_centimes),
    minimum_centimes = coalesce((p ->> 'minimum_centimes')::integer, minimum_centimes),
    delai_min = coalesce((p ->> 'delai_min')::smallint, delai_min),
    delai_max = coalesce((p ->> 'delai_max')::smallint, delai_max),
    active = coalesce((p ->> 'active')::boolean, active),
    proposition = false
  where numero = p_numero
  returning * into apres;
  perform journaliser(p_personnel, 'zone', p_numero::text, to_jsonb(avant), to_jsonb(apres));
  return true;
end;
$$;

create function modifier_horaire(p_id smallint, p jsonb, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant horaires%rowtype;
  apres horaires%rowtype;
begin
  perform gerant_nom(p_personnel);
  select * into avant from horaires where id = p_id for update;
  if not found then
    return false;
  end if;
  update horaires set
    premiere_heure = coalesce((p ->> 'premiere_heure')::time, premiere_heure),
    derniere_heure = coalesce((p ->> 'derniere_heure')::time, derniere_heure),
    derniere_commande = coalesce((p ->> 'derniere_commande')::time, derniere_commande),
    derniere_commande_pizzas = coalesce((p ->> 'derniere_commande_pizzas')::time, derniere_commande_pizzas),
    proposition = false
  where id = p_id
  returning * into apres;
  perform journaliser(p_personnel, 'horaire', p_id::text, to_jsonb(avant), to_jsonb(apres));
  return true;
end;
$$;

create function ajouter_fermeture(p_debut date, p_fin date, p_motif text, p_personnel uuid) returns void
language plpgsql as $$
declare
  f fermetures%rowtype;
begin
  perform gerant_nom(p_personnel);
  insert into fermetures (debut, fin, motif) values (p_debut, p_fin, p_motif) returning * into f;
  perform journaliser(p_personnel, 'fermeture', f.id::text, null, to_jsonb(f));
end;
$$;

create function supprimer_fermeture(p_id smallint, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  f fermetures%rowtype;
begin
  perform gerant_nom(p_personnel);
  delete from fermetures where id = p_id returning * into f;
  if not found then
    return false;
  end if;
  perform journaliser(p_personnel, 'fermeture', p_id::text, to_jsonb(f), null);
  return true;
end;
$$;

-- ---------- Export comptable ----------

-- Ventes encaissées sur une période (jour de commande, heure de Genève) : payées en ligne ou encaissées au
-- comptoir. Les commandes remboursées, refusées, annulées ou pas encore encaissées n'y sont pas.
create function export_ventes(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jour', o.jour, 'numero', o.numero, 'heure', to_char(o.cree_le at time zone 'Europe/Zurich', 'HH24:MI'),
    'mode', o.mode, 'paiement', case when o.statut_paiement = 'paye' then 'en ligne' else 'comptoir' end,
    'sous_total_centimes', o.sous_total_centimes, 'frais_centimes', o.frais_centimes, 'total_centimes', o.total_centimes,
    'taux_tva_pourcent', o.taux_tva_pourcent, 'tva_centimes', o.tva_centimes, 'stripe_payment_intent', o.stripe_payment_intent
  ) order by o.jour, o.numero), '[]'::jsonb)
  from commandes o
  where o.jour between p_debut and p_fin
    and o.statut_paiement in ('paye', 'encaisse')
    and o.statut not in ('refusee', 'annulee');
$$;

revoke execute on function
  gerant_nom(uuid), journaliser(uuid, text, text, jsonb, jsonb), gestion_carte(), gestion_service(), journal_gestion_recent(integer),
  modifier_plat(text, jsonb, uuid), modifier_retraits(text, text[], uuid), modifier_option(text, text, jsonb, uuid),
  importer_validation(jsonb, uuid), modifier_zone(smallint, jsonb, uuid), modifier_horaire(smallint, jsonb, uuid),
  ajouter_fermeture(date, date, text, uuid), supprimer_fermeture(smallint, uuid), export_ventes(date, date)
  from public, anon, authenticated;
grant execute on function
  gerant_nom(uuid), journaliser(uuid, text, text, jsonb, jsonb), gestion_carte(), gestion_service(), journal_gestion_recent(integer),
  modifier_plat(text, jsonb, uuid), modifier_retraits(text, text[], uuid), modifier_option(text, text, jsonb, uuid),
  importer_validation(jsonb, uuid), modifier_zone(smallint, jsonb, uuid), modifier_horaire(smallint, jsonb, uuid),
  ajouter_fermeture(date, date, text, uuid), supprimer_fermeture(smallint, uuid), export_ventes(date, date)
  to service_role;
grant select, insert, update, delete on journal_gestion to service_role;
grant usage on all sequences in schema public to service_role;
