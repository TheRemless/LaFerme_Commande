-- Tablette, vague 3 : encaissement au comptoir en espèces ou par carte (demande de bo-pilotage pour la clôture
-- du jour), et file de la tablette avec le moyen noté et l'annulation faite par le client.
-- Objets partagés recréés : marquer_encaisse (dernière définition : 20261109090000_tablette.sql, seul changement :
-- p_moyen), file_tablette (dernière définition : 20261113090000_correctifs_service.sql, seul changement : deux champs
-- en plus).

alter table commandes add column moyen_comptoir text check (moyen_comptoir in ('especes', 'carte'));

-- Un troisième paramètre facultatif : un appel à deux arguments (ancien code, autres sessions) marche toujours.
drop function marquer_encaisse(uuid, text);
create function marquer_encaisse(p_commande uuid, p_par text, p_moyen text default null) returns boolean
language plpgsql as $$
begin
  if p_moyen is not null and p_moyen not in ('especes', 'carte') then
    raise exception 'Moyen de paiement inconnu.';
  end if;
  update commandes set statut_paiement = 'encaisse', moyen_comptoir = p_moyen
    where id = p_commande and statut_paiement = 'a_encaisser_retrait' and statut not in ('refusee', 'annulee');
  if not found then
    return false;
  end if;
  insert into evenements_commande (commande_id, de, vers, par, detail) values (p_commande, null, 'encaisse', p_par, p_moyen);
  return true;
end;
$$;

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
      'lignes', coalesce((
        select jsonb_agg(jsonb_build_object('nom', l.nom, 'qte', l.qte, 'station', l.station, 'choix', l.choix, 'retraits', l.retraits, 'note', l.note) order by l.position)
        from commande_lignes l where l.commande_id = o.id
      ), '[]'::jsonb)
    ) as j
    from commandes o
    where o.statut in ('nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie')
       or (o.statut in ('terminee', 'refusee') and o.modifie_le >= ((now() at time zone 'Europe/Zurich')::date::timestamp at time zone 'Europe/Zurich'))
       or (o.statut = 'refusee' and o.statut_paiement = 'paye')
  ) x;
$$;

revoke execute on function marquer_encaisse(uuid, text, text), file_tablette() from public, anon, authenticated;
grant execute on function marquer_encaisse(uuid, text, text), file_tablette() to service_role;
