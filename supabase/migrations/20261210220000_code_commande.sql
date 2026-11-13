-- Vague 3, client-commande : un code promo s'applique à la commande dans UNE transaction, sous verrou
-- (revue de sécurité : sans cela, des commandes envoyées en même temps utilisaient plusieurs fois un code
-- « une fois par client » ou dépassaient son plafond). Fonction neuve, aucun objet recréé : elle appelle
-- creer_commande(p) telle qu'elle est dans la base, quelle que soit sa version. Elle remplit aussi
-- commandes.code_promo et commandes.remise_centimes, ajoutées par 20261210180000_codes_promo_commande.sql :
-- à lancer après celle-ci.
--
-- Ordre : verrou sur la clé de la commande ; nouvel essai avec la même clé (retour de Stripe) → la commande
-- enregistrée, sans réévaluer le code ; sinon verrou sur le code, evaluer_code, total et TVA recalculés,
-- creer_commande, utilisation notée. Un refus lève « code_refuse:<raison>[:<minimum>] ».

create function creer_commande_code(p jsonb, p_code text) returns jsonb
language plpgsql as $$
declare
  existante commandes%rowtype;
  ev jsonb;
  remise integer;
  total integer;
  taux numeric := (p ->> 'taux_tva_pourcent')::numeric;
  r record;
  code_net text := upper(btrim(coalesce(p_code, '')));
begin
  perform pg_advisory_xact_lock(hashtext('commande:' || (p ->> 'cle_idempotence')));
  select * into existante from commandes c where c.cle_idempotence = p ->> 'cle_idempotence';
  if found then
    return jsonb_build_object('id', existante.id, 'numero', existante.numero, 'jeton_suivi', existante.jeton_suivi, 'deja', true,
      'total_centimes', existante.total_centimes, 'remise_centimes', coalesce((select u.remise_centimes from utilisations_codes u where u.commande_id = existante.id), 0));
  end if;

  perform pg_advisory_xact_lock(hashtext('code:' || code_net));
  ev := evaluer_code(jsonb_build_object(
    'code', code_net,
    'email', p ->> 'client_email',
    'telephone', p ->> 'client_telephone',
    'adresse', p -> 'adresse',
    'mode', p ->> 'mode',
    'sous_total_centimes', (p ->> 'sous_total_centimes')::integer,
    'frais_centimes', (p ->> 'frais_centimes')::integer
  ));
  remise := 0;
  if (ev ->> 'ok')::boolean then
    remise := least(greatest((ev ->> 'remise_centimes')::integer, 0), (p ->> 'total_centimes')::integer);
    total := (p ->> 'total_centimes')::integer - remise;
    if total <= 0 then
      raise exception 'code_refuse:total_nul';
    end if;
    p := p || jsonb_build_object('total_centimes', total, 'tva_centimes', round(total * taux / (100 + taux))::integer);
  elsif ev ->> 'raison' <> 'desactive' then
    raise exception 'code_refuse:%:%', ev ->> 'raison', coalesce(ev ->> 'minimum_centimes', '');
  end if;

  select * into r from creer_commande(p);
  if remise > 0 then
    insert into utilisations_codes (code_id, commande_id, remise_centimes)
    select id, r.id, remise from codes_promo where code = code_net;
    -- Code et remise gardés avec la commande (colonnes de 20261210180000, bo-carte : reçu, e-mail, export).
    update commandes set code_promo = code_net, remise_centimes = remise where id = r.id;
  end if;
  return jsonb_build_object('id', r.id, 'numero', r.numero, 'jeton_suivi', r.jeton_suivi, 'deja', r.deja,
    'total_centimes', (p ->> 'total_centimes')::integer, 'remise_centimes', remise);
end;
$$;

revoke execute on function creer_commande_code(jsonb, text) from public, anon, authenticated;
grant execute on function creer_commande_code(jsonb, text) to service_role;
