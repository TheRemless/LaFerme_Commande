-- Vague 3, client-commande : allergie ou intolérance pour toute la commande (P0 du carnet).
-- Un champ court, séparé de la note libre, lu par la cuisine (tickets et tablette, session `tablette`).
-- Donnée de santé (nLPD art. 5) : elle reste sur la commande, n'est jamais copiée dans le compte
-- (completer_depuis_commande ne la lit pas) ni proposée de nouveau à la commande suivante.
--
-- Objet partagé recréé : creer_commande, repris de 20261124090000_manque_prix_fige.sql (dernière version
-- de main), avec la seule colonne allergie en plus. Avant cette migration, le code envoie le champ et
-- l'ancienne fonction l'ignore (la commande passe, l'allergie n'est pas gardée) : à lancer avec la fusion.

alter table commandes add column allergie text not null default ''
  constraint commandes_allergie_longueur check (char_length(allergie) <= 120);

create or replace function creer_commande(p jsonb) returns table (id uuid, numero integer, jeton_suivi text, deja boolean)
language plpgsql as $$
declare
  existante commandes%rowtype;
  aujourd_hui date := (now() at time zone 'Europe/Zurich')::date;
  service date;
  n integer;
  nouvelle_id uuid;
  cid uuid := (p ->> 'compte_id')::uuid;
begin
  perform pg_advisory_xact_lock(hashtext('commande:' || (p ->> 'cle_idempotence')));
  select * into existante from commandes c where c.cle_idempotence = p ->> 'cle_idempotence';
  if found then
    return query select existante.id, existante.numero, existante.jeton_suivi, true;
    return;
  end if;
  service := case when p ->> 'quand_type' = 'creneau' then (p ->> 'quand_date')::date else aujourd_hui end;
  if p ->> 'quand_type' = 'creneau' then
    perform pg_advisory_xact_lock(hashtext('creneau:' || (p ->> 'quand_date') || ':' || (p ->> 'quand_minutes') || ':' || (p ->> 'mode')));
    if creneau_plein((p ->> 'quand_date')::date, (p ->> 'quand_minutes')::smallint, p ->> 'mode') then
      raise exception 'creneau_complet';
    end if;
  end if;
  insert into compteurs_jour as cj (jour, dernier) values (service, 1)
    on conflict (jour) do update set dernier = cj.dernier + 1
    returning cj.dernier into n;
  insert into commandes (
    numero, jour, jour_service, jeton_suivi, cle_idempotence, mode, statut, statut_paiement, moyen_paiement,
    client_prenom, client_nom, client_telephone, client_email, adresse, details_livraison, zone_numero,
    quand_type, quand_date, quand_minutes, pizzas_seulement,
    sous_total_centimes, frais_centimes, total_centimes, tva_centimes, taux_tva_pourcent, origine,
    compte_id, compte_demande, allergie
  ) values (
    n, aujourd_hui, service, p ->> 'jeton_suivi', p ->> 'cle_idempotence', p ->> 'mode', p ->> 'statut', p ->> 'statut_paiement', p ->> 'moyen_paiement',
    p ->> 'client_prenom', p ->> 'client_nom', p ->> 'client_telephone', p ->> 'client_email', p -> 'adresse', p -> 'details_livraison',
    (p ->> 'zone_numero')::smallint,
    p ->> 'quand_type', (p ->> 'quand_date')::date, (p ->> 'quand_minutes')::smallint, (p ->> 'pizzas_seulement')::boolean,
    (p ->> 'sous_total_centimes')::integer, (p ->> 'frais_centimes')::integer, (p ->> 'total_centimes')::integer,
    (p ->> 'tva_centimes')::integer, (p ->> 'taux_tva_pourcent')::numeric, p ->> 'origine',
    cid, coalesce((p ->> 'compte_demande')::boolean, false) and cid is null, coalesce(p ->> 'allergie', '')
  ) returning commandes.id into nouvelle_id;
  insert into commande_lignes (commande_id, position, plat_slug, nom, station, qte, unitaire_centimes, total_centimes, choix, retraits, note, prix_choix)
  select nouvelle_id, (l.ordinality - 1)::smallint, l.v ->> 'slug', l.v ->> 'nom', (l.v ->> 'station')::station, (l.v ->> 'qte')::smallint,
         (l.v ->> 'unitaire_centimes')::integer, (l.v ->> 'total_centimes')::integer, l.v -> 'choix', l.v -> 'retraits', coalesce(l.v ->> 'note', ''),
         case when jsonb_typeof(l.v -> 'prix_choix') = 'object' then l.v -> 'prix_choix' end
  from jsonb_array_elements(p -> 'lignes') with ordinality as l(v, ordinality);
  if cid is not null then
    perform completer_depuis_commande(cid, nouvelle_id);
  end if;
  return query select nouvelle_id, n, p ->> 'jeton_suivi', false;
end;
$$;
