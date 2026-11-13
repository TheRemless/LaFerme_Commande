-- Nouveautés de la commande client sur la tablette, la vue par poste, les tickets et la page livreur (vague 3,
-- tablette ; colonnes de client-commande : 20261210130000_allergie_commande, 20261210140000_destinataire_commande,
-- 20261210210000_couverts_prenoms).
--
-- Objets partagés recréés, repris de leur dernière définition dans main, avec seulement les champs nouveaux :
-- - file_tablette : 20261203090000_tablette_encaissement.sql, plus allergie, destinataire, couverts et le prénom
--   (pour) de chaque ligne.
-- - livraisons_livreur : 20261119090000_livreurs.sql (seule définition), plus destinataire.
-- Les tickets lisent déjà la commande entière (commande_par_id) : rien à changer en base pour eux.
-- Le code lit ces champs comme facultatifs : il marche avant et après la migration.

create or replace function file_tablette() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x.j order by x.cree_le), '[]'::jsonb) from (
    select o.cree_le, jsonb_build_object(
      'id', o.id, 'numero', o.numero, 'cree_le', o.cree_le, 'attend_depuis', coalesce(o.paye_le, o.cree_le),
      'mode', o.mode, 'statut', o.statut,
      'statut_paiement', o.statut_paiement, 'moyen_paiement', o.moyen_paiement,
      'client_prenom', o.client_prenom, 'client_nom', o.client_nom, 'client_telephone', o.client_telephone,
      'adresse', o.adresse, 'details_livraison', o.details_livraison, 'zone_numero', o.zone_numero,
      'quand_type', o.quand_type, 'quand_date', o.quand_date, 'quand_minutes', o.quand_minutes,
      'heure_confirmee', o.heure_confirmee, 'pizzas_seulement', o.pizzas_seulement,
      'sous_total_centimes', o.sous_total_centimes, 'frais_centimes', o.frais_centimes, 'total_centimes', o.total_centimes,
      'motif', o.motif, 'avertissement', o.avertissement,
      -- Vague 3 (tablette) : moyen noté à l'encaissement au comptoir, annulation faite par le client (#70).
      'moyen_comptoir', o.moyen_comptoir, 'annulee_par_client_le', o.annulee_par_client_le,
      -- Vague 3 (client-commande, 20261210130000 à 20261210210000) : allergie de toute la commande, personne qui
      -- reçoit la commande ({ nom, telephone } ou null), couverts et serviettes, prénom de chaque ligne.
      'allergie', o.allergie, 'destinataire', o.destinataire, 'couverts', o.couverts,
      'lignes', coalesce((
        select jsonb_agg(jsonb_build_object('nom', l.nom, 'qte', l.qte, 'station', l.station, 'choix', l.choix, 'retraits', l.retraits, 'note', l.note, 'pour', l.pour) order by l.position)
        from commande_lignes l where l.commande_id = o.id
      ), '[]'::jsonb)
    ) as j
    from commandes o
    where o.statut in ('nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie')
       or (o.statut in ('terminee', 'refusee') and o.modifie_le >= ((now() at time zone 'Europe/Zurich')::date::timestamp at time zone 'Europe/Zurich'))
       or (o.statut = 'refusee' and o.statut_paiement = 'paye')
  ) x;
$$;

create or replace function livraisons_livreur(p_livreur uuid) returns jsonb
language plpgsql as $$
declare
  r jsonb;
begin
  insert into activite_livreurs (personnel_id, vu_le) values (p_livreur, now())
    on conflict (personnel_id) do update set vu_le = excluded.vu_le;
  insert into journal_livraisons (commande_id, personnel_id, par, evenement)
    select l.commande_id, p_livreur, 'livreur:' || p.nom, 'vue'
    from livraisons l join commandes o on o.id = l.commande_id join personnel p on p.id = p_livreur
    where l.livreur_id = p_livreur and l.retiree_le is null and o.statut in ('acceptee', 'en_preparation', 'partie')
    on conflict do nothing;
  select jsonb_build_object(
    'livraisons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'commande_id', o.id, 'numero', o.numero, 'statut', o.statut, 'heure', o.heure_confirmee,
        'adresse', jsonb_build_object('rue', o.adresse ->> 'rue', 'numero', o.adresse ->> 'numero', 'npa', o.adresse ->> 'npa', 'localite', o.adresse ->> 'localite'),
        'details', o.details_livraison, 'zone', o.zone_numero,
        'prenom', o.client_prenom, 'telephone', o.client_telephone,
        -- Vague 3 : la personne qui reçoit la commande, quand ce n'est pas celle qui a commandé (client-commande).
        'destinataire', o.destinataire,
        'articles', (select coalesce(sum(x.qte), 0) from commande_lignes x where x.commande_id = o.id),
        'pizzas', (select coalesce(sum(x.qte), 0) from commande_lignes x where x.commande_id = o.id and x.station = 'pizza'),
        'paye', o.statut_paiement = 'paye', 'total_centimes', o.total_centimes,
        'probleme', l.probleme, 'probleme_detail', l.probleme_detail
      ) order by l.position, l.attribuee_le)
      from livraisons l join commandes o on o.id = l.commande_id
      where l.livreur_id = p_livreur and l.retiree_le is null and o.statut in ('acceptee', 'en_preparation', 'partie')
    ), '[]'::jsonb),
    'retirees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'commande_id', o.id, 'numero', o.numero,
        'raison', case when l.retiree_le is null or l.raison_retrait = 'annulee' then 'annulee' else l.raison_retrait end,
        'partie', exists (select 1 from evenements_commande v where v.commande_id = o.id and v.vers = 'partie')
      ) order by o.numero)
      from livraisons l join commandes o on o.id = l.commande_id
      where l.livreur_id = p_livreur and l.retrait_vu_le is null and l.attribuee_le > now() - interval '12 hours'
        and ((l.retiree_le is not null and l.raison_retrait in ('reattribuee', 'retiree', 'client_absent')
              -- Rendue au même livreur entre-temps : elle est dans sa liste, pas d'alerte.
              and not exists (select 1 from livraisons y where y.commande_id = l.commande_id and y.livreur_id = p_livreur and y.retiree_le is null))
          or (l.retiree_le is null and o.statut in ('refusee', 'annulee')))
    ), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

revoke execute on function file_tablette(), livraisons_livreur(uuid) from public, anon, authenticated;
grant execute on function file_tablette(), livraisons_livreur(uuid) to service_role;
