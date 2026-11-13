-- Vague 3, client-commande : commander pour quelqu'un d'autre (P1 du carnet).
-- Celui qui commande paie et reçoit les e-mails ; la personne qui reçoit la livraison, ou vient chercher la
-- commande à emporter, a son nom et son téléphone ici : { "nom", "telephone" }, ou null pour soi-même.
-- Lu par le livreur, la tablette et les tickets (sessions `tablette`), jamais copié dans le compte.
--
-- Objet partagé recréé : creer_commande, repris de 20261201090000_allergie_commande.sql avec la seule colonne
-- destinataire en plus. Avant cette migration, l'ancienne fonction ignore le champ : à lancer avec la fusion.

alter table commandes add column destinataire jsonb
  constraint commandes_destinataire_forme check (
    destinataire is null or (
      jsonb_typeof(destinataire) = 'object'
      and char_length(destinataire ->> 'nom') between 1 and 80
      and char_length(destinataire ->> 'telephone') between 8 and 20
    )
  );

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
    compte_id, compte_demande, allergie, destinataire
  ) values (
    n, aujourd_hui, service, p ->> 'jeton_suivi', p ->> 'cle_idempotence', p ->> 'mode', p ->> 'statut', p ->> 'statut_paiement', p ->> 'moyen_paiement',
    p ->> 'client_prenom', p ->> 'client_nom', p ->> 'client_telephone', p ->> 'client_email', p -> 'adresse', p -> 'details_livraison',
    (p ->> 'zone_numero')::smallint,
    p ->> 'quand_type', (p ->> 'quand_date')::date, (p ->> 'quand_minutes')::smallint, (p ->> 'pizzas_seulement')::boolean,
    (p ->> 'sous_total_centimes')::integer, (p ->> 'frais_centimes')::integer, (p ->> 'total_centimes')::integer,
    (p ->> 'tva_centimes')::integer, (p ->> 'taux_tva_pourcent')::numeric, p ->> 'origine',
    cid, coalesce((p ->> 'compte_demande')::boolean, false) and cid is null, coalesce(p ->> 'allergie', ''),
    case when jsonb_typeof(p -> 'destinataire') = 'object' then p -> 'destinataire' end
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
