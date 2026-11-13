-- Zones par service et zone fermée jusqu'à une heure (vague 3, bo-operations).
-- Avant : une zone était ouverte pour tous les services ou pour aucun. Désormais :
--   1. services : les services où la zone est livrée (« zone 3 le soir seulement »). Réglé par le gérant.
--   2. fermee_jusqu_a : la zone est fermée jusqu'à cette heure, puis rouvre seule (neige, livreur malade,
--      route coupée). Posé par l'équipe (tablette ou back-office), avec un motif lisible par le client.
-- Le site lit ces colonnes avec la zone (lecture publique de zones_livraison, comme frais et délais) : aucun
-- calcul en base, mêmes fonctions pures dans le navigateur et sur le serveur (src/lib/service.ts).
-- Pas d'objet partagé recréé : colonnes en fin de table, fonctions neuves. modifier_zone, annuler_journal et
-- gestion_service restent tels quels (gestion_service renvoie déjà toute la ligne de la zone).

alter table zones_livraison
  add column services text[] not null default '{midi,soir}'
    check (cardinality(services) between 1 and 2 and services <@ array['midi', 'soir']::text[]),
  add column fermee_jusqu_a timestamptz,
  add column fermee_motif text check (fermee_motif is null or char_length(fermee_motif) between 2 and 120);

-- Services d'une zone (gérant). Au moins un : pour ne plus livrer une zone du tout, « Zone ouverte » décochée.
create function regler_zone_services(p_numero smallint, p_services text[], p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant text[];
  propres text[];
begin
  perform gerant_nom(p_personnel);
  select array(select distinct s from unnest(p_services) s order by s) into propres;
  if cardinality(propres) = 0 or not (propres <@ array['midi', 'soir']::text[]) then
    raise exception 'Services : midi, soir ou les deux';
  end if;
  select services into avant from zones_livraison where numero = p_numero for update;
  if not found then
    return false;
  end if;
  update zones_livraison set services = propres where numero = p_numero;
  perform journaliser(p_personnel, 'zone_services', p_numero::text, to_jsonb(avant), to_jsonb(propres));
  return true;
end;
$$;

-- Zone fermée jusqu'à une heure (équipe : tablette ou back-office). Sept jours au plus : au-delà, c'est une
-- zone fermée (« Zone ouverte » décochée au back-office). Refermer une zone déjà fermée remplace l'heure.
create function fermer_zone(p_numero smallint, p_jusqua timestamptz, p_motif text, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  qui text := equipe_nom(p_personnel);
  avant zones_livraison%rowtype;
  motif text := nullif(btrim(coalesce(p_motif, '')), '');
begin
  if p_jusqua is null or p_jusqua <= now() or p_jusqua > now() + interval '7 days' then
    raise exception 'Fin de fermeture : dans les sept jours qui viennent';
  end if;
  if motif is null or char_length(motif) not between 2 and 120 then
    raise exception 'Motif : de 2 à 120 caractères';
  end if;
  select * into avant from zones_livraison where numero = p_numero for update;
  if not found then
    return false;
  end if;
  update zones_livraison set fermee_jusqu_a = p_jusqua, fermee_motif = motif where numero = p_numero;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'zone_fermeture', p_numero::text,
      jsonb_build_object('jusqua', avant.fermee_jusqu_a, 'motif', avant.fermee_motif),
      jsonb_build_object('jusqua', p_jusqua, 'motif', motif));
  return true;
end;
$$;

-- Rouvrir avant l'heure. false : zone inconnue ou pas fermée (déjà rouverte, heure passée).
create function rouvrir_zone(p_numero smallint, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  qui text := equipe_nom(p_personnel);
  avant zones_livraison%rowtype;
begin
  select * into avant from zones_livraison where numero = p_numero for update;
  if not found or avant.fermee_jusqu_a is null or avant.fermee_jusqu_a <= now() then
    return false;
  end if;
  update zones_livraison set fermee_jusqu_a = null, fermee_motif = null where numero = p_numero;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'zone_fermeture', p_numero::text,
      jsonb_build_object('jusqua', avant.fermee_jusqu_a, 'motif', avant.fermee_motif), null);
  return true;
end;
$$;

revoke execute on function
  regler_zone_services(smallint, text[], uuid), fermer_zone(smallint, timestamptz, text, uuid), rouvrir_zone(smallint, uuid)
  from public, anon, authenticated;
grant execute on function
  regler_zone_services(smallint, text[], uuid), fermer_zone(smallint, timestamptz, text, uuid), rouvrir_zone(smallint, uuid)
  to service_role;
