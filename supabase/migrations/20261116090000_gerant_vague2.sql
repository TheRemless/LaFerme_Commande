-- Vague 2 de la session gérant (docs/audits/gerant.md) :
--   G07 option A : rupture d'un supplément depuis la tablette, manque signalé sur une commande acceptée
--     (remboursé, ou déduit de ce qu'il reste à encaisser au comptoir) ;
--   fermer un seul service, ouvrir un jour non prévu, commandes déjà prises sur une période (G15) ;
--   communes d'une zone ; plafond du comptoir réglable ; retour arrière depuis le journal (G11).
-- Objets partagés (docs .claude/vague-2-regles.md) : la contrainte du journal devient un contrôle de forme ;
-- la vue options_publiques reçoit une colonne « rupture » en fin de liste, rien d'autre n'y change.

-- ---------- Journal : contrôle de forme au lieu d'une liste fermée ----------
alter table journal_gestion drop constraint journal_gestion_objet_check;
alter table journal_gestion add constraint journal_gestion_objet_check check (objet ~ '^[a-z_]{2,30}$');
-- Ligne annulée par un retour arrière : identifiant de la ligne qui l'a défaite.
alter table journal_gestion add column annule_par bigint;

-- ---------- G07 : rupture d'un supplément ----------
alter table options add column rupture_jour date;

-- Même définition que 20261106150000_options_panier.sql, plus la rupture du jour (heure de Genève) en fin de liste.
create or replace view options_publiques with (security_invoker = true) as
select g.slug as groupe_slug, g.nom as groupe_nom, g.choix_min, g.choix_max,
       o.nom, o.prix_centimes, o.prix_a_valider, o.ordre,
       coalesce(o.rupture_jour = (now() at time zone 'Europe/Zurich')::date, false) as rupture
from options o
join groupes_options g on g.id = o.groupe_id;

create function regler_rupture_option(p_groupe text, p_nom text, p_rupture boolean, p_personnel uuid) returns boolean
language plpgsql as $$
begin
  update options o set rupture_jour = case when p_rupture then (now() at time zone 'Europe/Zurich')::date end
  from groupes_options g
  where g.id = o.groupe_id and g.slug = p_groupe and o.nom = p_nom;
  if not found then
    return false;
  end if;
  insert into journal_personnel (personnel_id, evenement) values (p_personnel, 'rupture option ' || p_groupe || '/' || p_nom || ' ' || p_rupture::text);
  return true;
end;
$$;

-- Suppléments proposés, pour l'onglet des ruptures de la tablette.
create function options_tablette() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'groupe', g.slug, 'groupe_nom', g.nom, 'nom', o.nom,
    'rupture', coalesce(o.rupture_jour = (now() at time zone 'Europe/Zurich')::date, false)
  ) order by g.slug, o.ordre), '[]'::jsonb)
  from options o join groupes_options g on g.id = o.groupe_id
  where o.actif and g.choix_min = 0;
$$;

-- ---------- G07 : manque signalé sur une commande acceptée ----------

-- « deduction » : au comptoir, pas encore payé, le manque se retire de ce qu'il reste à encaisser.
alter table remboursements drop constraint remboursements_moyen_check;
alter table remboursements add constraint remboursements_moyen_check check (moyen in ('stripe', 'especes', 'deduction'));
-- Ce qui manquait, pour ne pas le signaler deux fois : [{ ligne, qte } | { ligne, groupe, nom }].
alter table remboursements add column elements jsonb;

-- Calcule et, si p_confirmer, enregistre le remboursement de ce qui manque. Le montant vient de la base
-- (prix de la ligne, prix actuel du supplément), jamais de l'écran. Tout membre actif peut le faire
-- (la cuisine le constate) ; le remboursement libre reste au gérant (demander_remboursement).
create function signaler_manque(p_commande uuid, p_elements jsonb, p_cle text, p_personnel uuid, p_confirmer boolean) returns jsonb
language plpgsql as $$
declare
  auteur text;
  c commandes%rowtype;
  r remboursements%rowtype;
  e jsonb;
  l commande_lignes%rowtype;
  prec jsonb;
  qte_deja integer;
  prix integer;
  montant integer := 0;
  parties text[] := '{}';
  engage integer;
  m text;
begin
  select nom into auteur from personnel where id = p_personnel and actif;
  if auteur is null then
    raise exception 'personnel_inactif';
  end if;
  if p_cle is null or length(p_cle) not between 8 and 80 then
    raise exception 'cle_invalide';
  end if;
  if p_confirmer then
    perform pg_advisory_xact_lock(hashtext('remboursement:' || p_cle));
    select * into r from remboursements where cle = p_cle;
    if found then
      if r.commande_id <> p_commande or r.elements is distinct from p_elements then
        raise exception 'cle_reutilisee';
      end if;
      return to_jsonb(r) || jsonb_build_object('deja', true, 'description', substr(r.motif, 10), 'numero', (select numero from commandes where id = p_commande));
    end if;
  end if;
  select * into c from commandes where id = p_commande for update;
  if not found then
    raise exception 'commande_inconnue';
  end if;
  if c.statut not in ('acceptee', 'en_preparation', 'prete', 'partie') then
    raise exception 'statut_non_remboursable';
  end if;
  if c.statut_paiement not in ('paye', 'encaisse', 'a_encaisser_retrait') then
    raise exception 'pas_encaissee';
  end if;
  if jsonb_typeof(p_elements) <> 'array' or jsonb_array_length(p_elements) not between 1 and 30 then
    raise exception 'elements_invalides';
  end if;
  -- Ce qui a déjà été signalé (en cours ou fait) sur cette commande.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into prec
  from remboursements rb, jsonb_array_elements(rb.elements) x
  where rb.commande_id = p_commande and rb.statut in ('en_cours', 'fait') and rb.elements is not null;
  for e in select * from jsonb_array_elements(p_elements) loop
    select * into l from commande_lignes where commande_id = p_commande and position = (e ->> 'ligne')::smallint;
    if not found then
      raise exception 'ligne_inconnue';
    end if;
    if coalesce(e ->> 'groupe', '') = '' then
      -- Le plat entier : prix de la ligne, suppléments compris.
      if (e ->> 'qte')::integer is null or (e ->> 'qte')::integer < 1 then
        raise exception 'elements_invalides';
      end if;
      select coalesce(sum((x ->> 'qte')::integer), 0) into qte_deja from jsonb_array_elements(prec) x
      where (x ->> 'ligne')::integer = l.position and coalesce(x ->> 'groupe', '') = '';
      if qte_deja + (e ->> 'qte')::integer > l.qte then
        raise exception 'deja_signale';
      end if;
      prec := prec || jsonb_build_array(e);
      montant := montant + l.unitaire_centimes * (e ->> 'qte')::integer;
      parties := parties || ((e ->> 'qte') || ' × ' || l.nom);
    else
      -- Un supplément choisi sur la ligne : son prix actuel, pour chaque plat de la ligne.
      if not coalesce(l.choix -> (e ->> 'groupe') ? (e ->> 'nom'), false) then
        raise exception 'option_absente';
      end if;
      if exists (select 1 from jsonb_array_elements(prec) x
                 where (x ->> 'ligne')::integer = l.position and (x ->> 'groupe' = e ->> 'groupe' and x ->> 'nom' = e ->> 'nom'
                   or (coalesce(x ->> 'groupe', '') = '' and (x ->> 'qte')::integer >= l.qte))) then
        raise exception 'deja_signale';
      end if;
      select o.prix_centimes into prix from options o join groupes_options g on g.id = o.groupe_id
      where g.slug = e ->> 'groupe' and o.nom = e ->> 'nom';
      prec := prec || jsonb_build_array(e);
      montant := montant + coalesce(prix, 0) * l.qte;
      parties := parties || ((e ->> 'nom') || ' sur ' || l.qte || ' × ' || l.nom);
    end if;
  end loop;
  select coalesce(sum(montant_centimes), 0) into engage from remboursements where commande_id = p_commande and statut in ('en_cours', 'fait');
  montant := least(montant, c.total_centimes - engage);
  if montant <= 0 then
    raise exception 'montant_trop_eleve';
  end if;
  m := 'Manque : ' || array_to_string(parties, ', ');
  if not p_confirmer then
    return jsonb_build_object('montant_centimes', montant, 'description', array_to_string(parties, ', '), 'numero', c.numero);
  end if;
  insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_id, personnel_nom, fait_le, elements)
  values (p_commande, p_cle, montant, left(m, 200),
    case when c.moyen_paiement = 'en_ligne' then 'stripe' when c.statut_paiement = 'encaisse' then 'especes' else 'deduction' end,
    case when c.moyen_paiement = 'en_ligne' then 'en_cours' else 'fait' end,
    p_personnel, auteur,
    case when c.moyen_paiement = 'en_ligne' then null else now() end,
    p_elements)
  returning * into r;
  insert into evenements_commande (commande_id, de, vers, par, detail)
  values (p_commande, null, 'manque', 'tablette:' || auteur, (montant / 100.0)::numeric(10, 2)::text || ' CHF, ' || array_to_string(parties, ', '));
  if r.statut = 'fait' and c.statut_paiement = 'encaisse' then
    perform maj_rembourse(p_commande);
  end if;
  return to_jsonb(r) || jsonb_build_object('deja', false, 'description', array_to_string(parties, ', '), 'numero', c.numero);
end;
$$;

-- Manques des commandes en cours, pour la tablette : montant retiré et ce qui manque.
create function manques_en_cours() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'commande_id', x.commande_id, 'deduit_centimes', x.montant, 'manques', x.manques
  )), '[]'::jsonb)
  from (
    select r.commande_id, sum(r.montant_centimes)::integer as montant, array_agg(substr(r.motif, 10) order by r.cree_le) as manques
    from remboursements r join commandes o on o.id = r.commande_id
    where r.elements is not null and r.statut in ('en_cours', 'fait')
      and o.statut in ('acceptee', 'en_preparation', 'prete', 'partie', 'terminee')
      and o.modifie_le > now() - interval '2 days'
    group by r.commande_id
  ) x;
$$;

-- Une commande refusée ou annulée n'a jamais été une vente : ses remboursements ne sortent pas non plus
-- de l'export (sinon un manque remboursé avant un refus compterait en négatif).
create or replace function export_remboursements(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jour', (r.fait_le at time zone 'Europe/Zurich')::date, 'heure', to_char(r.fait_le at time zone 'Europe/Zurich', 'HH24:MI'),
    'numero', o.numero, 'jour_vente', o.jour, 'mode', o.mode,
    'paiement', case when r.moyen = 'stripe' then 'en ligne' else 'comptoir' end,
    'montant_centimes', r.montant_centimes, 'taux_tva_pourcent', o.taux_tva_pourcent,
    'tva_centimes', round(r.montant_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer,
    'reference', r.stripe_refund_id
  ) order by r.fait_le), '[]'::jsonb)
  from remboursements r join commandes o on o.id = r.commande_id
  where r.statut = 'fait' and (r.fait_le at time zone 'Europe/Zurich')::date between p_debut and p_fin
    and o.statut not in ('refusee', 'annulee');
$$;

-- ---------- Fermer un seul service, ouvrir un jour non prévu ----------

-- Une fermeture sans service ferme la journée entière, comme avant.
alter table fermetures add column service text check (service in ('midi', 'soir'));

create table ouvertures (
  id smallint generated always as identity primary key,
  jour date not null,
  service text not null check (service in ('midi', 'soir')),
  premiere_heure time not null,
  derniere_heure time not null,
  derniere_commande time not null,
  derniere_commande_pizzas time not null,
  motif text not null,
  unique (jour, service),
  check (premiere_heure < derniere_heure and derniere_commande <= derniere_commande_pizzas)
);
alter table ouvertures enable row level security;
create policy "lecture publique" on ouvertures for select to anon, authenticated using (true);
revoke all on ouvertures from anon, authenticated;
grant select on ouvertures to anon, authenticated;
grant select, insert, update, delete on ouvertures to service_role;

create function ajouter_fermeture_service(p_jour date, p_service text, p_motif text, p_personnel uuid) returns smallint
language plpgsql as $$
declare
  f fermetures%rowtype;
begin
  perform gerant_nom(p_personnel);
  if p_service not in ('midi', 'soir') or p_service is null then
    raise exception 'service_invalide';
  end if;
  insert into fermetures (debut, fin, motif, service) values (p_jour, p_jour, p_motif, p_service) returning * into f;
  perform journaliser(p_personnel, 'fermeture', f.id::text, null, to_jsonb(f));
  return f.id;
end;
$$;

-- p = { jour, service, premiere_heure, derniere_heure, derniere_commande, derniere_commande_pizzas, motif }.
-- Remplace les horaires habituels de ce service ce jour-là, ou ouvre un jour normalement fermé.
create function ajouter_ouverture(p jsonb, p_personnel uuid) returns smallint
language plpgsql as $$
declare
  o ouvertures%rowtype;
begin
  perform gerant_nom(p_personnel);
  if p ->> 'service' not in ('midi', 'soir') or p ->> 'service' is null then
    raise exception 'service_invalide';
  end if;
  if not ((p ->> 'premiere_heure')::time < (p ->> 'derniere_heure')::time
          and (p ->> 'derniere_commande')::time <= (p ->> 'derniere_commande_pizzas')::time) then
    raise exception 'heures_invalides';
  end if;
  insert into ouvertures (jour, service, premiere_heure, derniere_heure, derniere_commande, derniere_commande_pizzas, motif)
  values ((p ->> 'jour')::date, p ->> 'service', (p ->> 'premiere_heure')::time, (p ->> 'derniere_heure')::time,
    (p ->> 'derniere_commande')::time, (p ->> 'derniere_commande_pizzas')::time, p ->> 'motif')
  returning * into o;
  perform journaliser(p_personnel, 'ouverture', o.id::text, null, to_jsonb(o));
  return o.id;
end;
$$;

create function supprimer_ouverture(p_id smallint, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  o ouvertures%rowtype;
begin
  perform gerant_nom(p_personnel);
  delete from ouvertures where id = p_id returning * into o;
  if not found then
    return false;
  end if;
  perform journaliser(p_personnel, 'ouverture', p_id::text, to_jsonb(o), null);
  return true;
end;
$$;

-- Numéros des commandes encore à servir sur une période (un service : midi avant 15h, soir après).
-- Le back-office les montre avant une fermeture, pour les annuler sur la tablette (G15).
create function commandes_dans_periode(p_debut date, p_fin date, p_service text) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(o.numero order by o.quand_date, o.quand_minutes), '[]'::jsonb)
  from commandes o
  where o.quand_type = 'creneau' and o.quand_date between p_debut and p_fin
    and o.statut in ('nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie')
    and (p_service is null or (p_service = 'midi') = (o.quand_minutes < 900));
$$;

-- gestion_service avec les ouvertures (même définition que 20261110090000_gestion.sql, plus une clé).
create or replace function gestion_service() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'zones', coalesce((select jsonb_agg(to_jsonb(z) || jsonb_build_object(
      'npa', coalesce((select jsonb_agg(jsonb_build_object('npa', n.npa, 'localite', n.localite) order by n.npa, n.localite) from zone_npa n where n.zone_numero = z.numero), '[]'::jsonb)
    ) order by z.numero) from zones_livraison z), '[]'::jsonb),
    'horaires', coalesce((select jsonb_agg(to_jsonb(h) order by h.jour, h.service) from horaires h), '[]'::jsonb),
    'fermetures', coalesce((select jsonb_agg(to_jsonb(f) order by f.debut) from fermetures f), '[]'::jsonb),
    'ouvertures', coalesce((select jsonb_agg(to_jsonb(o) order by o.jour, o.service) from ouvertures o), '[]'::jsonb)
  );
$$;

-- ---------- Communes d'une zone ----------
-- La zone d'une adresse reste décidée par le serveur à partir de l'adresse officielle du registre fédéral
-- (src/lib/zone-serveur.ts) : écrire la localité comme dans l'adresse officielle.

create function ajouter_npa_zone(p_npa text, p_localite text, p_zone smallint, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  l text := btrim(regexp_replace(coalesce(p_localite, ''), '\s+', ' ', 'g'));
  avant smallint;
begin
  if p_npa !~ '^12[0-9]{2}$' then
    raise exception 'npa_invalide';
  end if;
  if length(l) not between 2 and 60 then
    raise exception 'localite_invalide';
  end if;
  if not exists (select 1 from zones_livraison where numero = p_zone) then
    raise exception 'zone_inconnue';
  end if;
  select zone_numero into avant from zone_npa where npa = p_npa and localite = l for update;
  insert into zone_npa (npa, localite, zone_numero) values (p_npa, l, p_zone)
    on conflict (npa, localite) do update set zone_numero = excluded.zone_numero;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, auteur, 'zone_npa', p_npa || ' ' || l,
    case when avant is null then null else jsonb_build_object('npa', p_npa, 'localite', l, 'zone_numero', avant) end,
    jsonb_build_object('npa', p_npa, 'localite', l, 'zone_numero', p_zone));
  return true;
end;
$$;

create function retirer_npa_zone(p_npa text, p_localite text, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  avant smallint;
begin
  delete from zone_npa where npa = p_npa and localite = p_localite returning zone_numero into avant;
  if avant is null then
    return false;
  end if;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, auteur, 'zone_npa', p_npa || ' ' || p_localite, jsonb_build_object('npa', p_npa, 'localite', p_localite, 'zone_numero', avant), null);
  return true;
end;
$$;

-- ---------- Plafond du paiement au comptoir (réglage posé par 20261115090000_plafond_comptoir.sql) ----------

create function regler_plafond_comptoir(p_centimes integer, p_personnel uuid) returns void
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  avant jsonb;
begin
  if p_centimes is null or p_centimes not between 0 and 50000 then
    raise exception 'plafond_invalide';
  end if;
  select valeur into avant from reglages where cle = 'plafond_comptoir_centimes' for update;
  insert into reglages (cle, valeur, proposition) values ('plafond_comptoir_centimes', to_jsonb(p_centimes), false)
    on conflict (cle) do update set valeur = excluded.valeur, proposition = false;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, auteur, 'reglage', 'plafond_comptoir_centimes', avant, to_jsonb(p_centimes));
end;
$$;

-- ---------- G11 : retour arrière depuis le journal ----------

-- Remet l'état d'avant une modification, si rien n'a changé depuis. Passe par les mêmes fonctions que
-- l'écran (donc journalisé), puis marque la ligne d'origine comme annulée. Équipe, remboursements,
-- import et imprimantes ne s'annulent pas ici.
create function annuler_journal(p_id bigint, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  e journal_gestion%rowtype;
  cur jsonb;
  champs text[];
  k text;
  rid smallint;
  nouvelle bigint;
begin
  perform gerant_nom(p_personnel);
  select * into e from journal_gestion where id = p_id for update;
  if not found then
    raise exception 'journal_inconnu';
  end if;
  if e.annule_par is not null then
    raise exception 'deja_annule';
  end if;

  if e.objet = 'zone' then
    champs := array['frais_centimes', 'minimum_centimes', 'delai_min', 'delai_max', 'active'];
    select to_jsonb(z) into cur from zones_livraison z where numero = e.cle::smallint;
    foreach k in array champs loop
      if cur -> k is distinct from e.apres -> k then raise exception 'deja_change'; end if;
    end loop;
    perform modifier_zone(e.cle::smallint, jsonb_build_object('frais_centimes', e.avant -> 'frais_centimes', 'minimum_centimes', e.avant -> 'minimum_centimes',
      'delai_min', e.avant -> 'delai_min', 'delai_max', e.avant -> 'delai_max', 'active', e.avant -> 'active'), p_personnel);

  elsif e.objet = 'horaire' then
    champs := array['premiere_heure', 'derniere_heure', 'derniere_commande', 'derniere_commande_pizzas'];
    select to_jsonb(h) into cur from horaires h where id = e.cle::smallint;
    foreach k in array champs loop
      if cur -> k is distinct from e.apres -> k then raise exception 'deja_change'; end if;
    end loop;
    perform modifier_horaire(e.cle::smallint, jsonb_build_object('premiere_heure', e.avant ->> 'premiere_heure', 'derniere_heure', e.avant ->> 'derniere_heure',
      'derniere_commande', e.avant ->> 'derniere_commande', 'derniere_commande_pizzas', e.avant ->> 'derniere_commande_pizzas'), p_personnel);

  elsif e.objet = 'plat' then
    champs := array['nom', 'description', 'prix_centimes', 'prix_a_valider', 'commandable', 'station', 'photo', 'provenance', 'provenances_a_fournir', 'allergenes'];
    select to_jsonb(p) into cur from plats p where slug = e.cle;
    if cur is null then raise exception 'deja_change'; end if;
    foreach k in array champs loop
      if cur -> k is distinct from e.apres -> k then raise exception 'deja_change'; end if;
    end loop;
    perform modifier_plat(e.cle, jsonb_build_object(
      'nom', e.avant ->> 'nom', 'description', e.avant ->> 'description', 'prix_centimes', e.avant -> 'prix_centimes',
      'prix_valide', not (e.avant ->> 'prix_a_valider')::boolean, 'commandable', e.avant -> 'commandable', 'station', e.avant ->> 'station',
      'photo', coalesce(e.avant ->> 'photo', ''), 'provenance', coalesce(e.avant ->> 'provenance', ''),
      'provenances_a_fournir', coalesce(e.avant -> 'provenances_a_fournir', '[]'::jsonb), 'allergenes', coalesce(e.avant ->> 'allergenes', '')), p_personnel);

  elsif e.objet = 'option' then
    champs := array['prix_centimes', 'prix_a_valider', 'actif'];
    select to_jsonb(o) into cur from options o join groupes_options g on g.id = o.groupe_id
    where g.slug = split_part(e.cle, '/', 1) and o.nom = substr(e.cle, length(split_part(e.cle, '/', 1)) + 2);
    if cur is null then raise exception 'deja_change'; end if;
    foreach k in array champs loop
      if cur -> k is distinct from e.apres -> k then raise exception 'deja_change'; end if;
    end loop;
    perform modifier_option(split_part(e.cle, '/', 1), substr(e.cle, length(split_part(e.cle, '/', 1)) + 2),
      jsonb_build_object('prix_centimes', e.avant -> 'prix_centimes', 'prix_valide', not (e.avant ->> 'prix_a_valider')::boolean, 'actif', e.avant -> 'actif'), p_personnel);

  elsif e.objet = 'fermeture' then
    if e.avant is null then
      -- Ajout : on la supprime, si elle est encore là.
      if not exists (select 1 from fermetures where id = e.cle::smallint) then raise exception 'deja_change'; end if;
      perform supprimer_fermeture(e.cle::smallint, p_personnel);
    else
      -- Suppression : on la remet.
      insert into fermetures (debut, fin, motif, service)
      values ((e.avant ->> 'debut')::date, (e.avant ->> 'fin')::date, e.avant ->> 'motif', e.avant ->> 'service')
      returning id into rid;
      perform journaliser(p_personnel, 'fermeture', rid::text, null, (select to_jsonb(f) from fermetures f where id = rid));
    end if;

  elsif e.objet = 'ouverture' then
    if e.avant is null then
      if not exists (select 1 from ouvertures where id = e.cle::smallint) then raise exception 'deja_change'; end if;
      perform supprimer_ouverture(e.cle::smallint, p_personnel);
    else
      perform ajouter_ouverture(e.avant - 'id', p_personnel);
    end if;

  elsif e.objet = 'reglage' and e.cle in ('plafond_comptoir_centimes', 'capacite_livraisons_par_creneau', 'capacite_retraits_par_creneau', 'alerte_acceptation_minutes') then
    select valeur into cur from reglages where cle = e.cle for update;
    if cur is distinct from e.apres then raise exception 'deja_change'; end if;
    if e.avant is null then raise exception 'non_annulable'; end if;
    update reglages set valeur = e.avant where cle = e.cle;
    perform journaliser(p_personnel, 'reglage', e.cle, e.apres, e.avant);

  elsif e.objet = 'zone_npa' then
    select to_jsonb(n) into cur from zone_npa n where npa = split_part(e.cle, ' ', 1) and localite = substr(e.cle, 6);
    if (e.apres is null and cur is not null) or (e.apres is not null and (cur is null or cur -> 'zone_numero' is distinct from e.apres -> 'zone_numero')) then
      raise exception 'deja_change';
    end if;
    if e.avant is null then
      perform retirer_npa_zone(e.apres ->> 'npa', e.apres ->> 'localite', p_personnel);
    else
      perform ajouter_npa_zone(e.avant ->> 'npa', e.avant ->> 'localite', (e.avant ->> 'zone_numero')::smallint, p_personnel);
    end if;

  else
    raise exception 'non_annulable';
  end if;

  select max(id) into nouvelle from journal_gestion;
  update journal_gestion set annule_par = nouvelle where id = p_id;
  return jsonb_build_object('annule', p_id, 'par', nouvelle);
end;
$$;

-- Le journal du back-office avec l'information d'annulation (même définition, la colonne vient de to_jsonb).
-- journal_gestion_recent lit « select * » : annule_par y apparaît sans la recréer.

revoke execute on function
  regler_rupture_option(text, text, boolean, uuid), options_tablette(),
  signaler_manque(uuid, jsonb, text, uuid, boolean), manques_en_cours(),
  ajouter_fermeture_service(date, text, text, uuid), ajouter_ouverture(jsonb, uuid), supprimer_ouverture(smallint, uuid),
  commandes_dans_periode(date, date, text), ajouter_npa_zone(text, text, smallint, uuid), retirer_npa_zone(text, text, uuid),
  regler_plafond_comptoir(integer, uuid), annuler_journal(bigint, uuid)
  from public, anon, authenticated;
grant execute on function
  regler_rupture_option(text, text, boolean, uuid), options_tablette(),
  signaler_manque(uuid, jsonb, text, uuid, boolean), manques_en_cours(),
  ajouter_fermeture_service(date, text, text, uuid), ajouter_ouverture(jsonb, uuid), supprimer_ouverture(smallint, uuid),
  commandes_dans_periode(date, date, text), ajouter_npa_zone(text, text, smallint, uuid), retirer_npa_zone(text, text, uuid),
  regler_plafond_comptoir(integer, uuid), annuler_journal(bigint, uuid)
  to service_role;
