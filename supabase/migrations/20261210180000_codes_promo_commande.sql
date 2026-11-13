-- Codes promo, suite (vague 3, bo-carte) : ce que demande le branchement au panier et au paiement
-- (client-commande).
-- 1. commandes.code_promo et commandes.remise_centimes gardent le code et la remise avec la commande (reçu,
--    e-mail, export). Total = plats + frais − remise. creer_commande (client-commande) les remplit et appelle
--    noter_utilisation_code dans la même transaction.
-- 2. evaluer_code accepte provisoire (panier, client pas encore connu).
--
-- Objets partagés recréés : evaluer_code (depuis 20261210120000_codes_promo.sql, seul ajout : provisoire).
-- Ajout sur une table partagée : deux colonnes en fin de commandes. Compatible avant et après.

alter table commandes add column code_promo text;
alter table commandes add column remise_centimes integer not null default 0 check (remise_centimes >= 0);

-- p : { code, email, telephone, adresse (jsonb ou null), mode, sous_total_centimes, frais_centimes, provisoire }.
-- Rend { ok: true, code, type, remise_centimes, a_verifier? } ou { ok: false, raison, minimum_centimes? }.
-- provisoire (panier, client pas encore connu) : sans e-mail ni téléphone, « une fois par client » et
-- « première commande » attendent le paiement ; la réponse porte a_verifier. Au paiement : jamais provisoire.
-- raison : desactive, inconnu, inactif, pas_commence, expire, minimum, plafond, deja_utilise,
-- pas_premiere, retrait, client_inconnu.
create or replace function evaluer_code(p jsonb) returns jsonb
language plpgsql stable as $$
declare
  c codes_promo%rowtype;
  aujourdhui date := (now() at time zone 'Europe/Zurich')::date;
  v_code text := upper(btrim(coalesce(p ->> 'code', '')));
  v_email text := email_normal(p ->> 'email');
  v_tel text := telephone_normal(p ->> 'telephone');
  v_adr text := adresse_cle(case when jsonb_typeof(p -> 'adresse') = 'object' then p -> 'adresse' end);
  v_sous_total integer := greatest(coalesce((p ->> 'sous_total_centimes')::integer, 0), 0);
  v_frais integer := greatest(coalesce((p ->> 'frais_centimes')::integer, 0), 0);
  remise integer;
begin
  if coalesce((select valeur = 'true'::jsonb from reglages where cle = 'codes_promo_actifs'), false) is not true then
    return jsonb_build_object('ok', false, 'raison', 'desactive');
  end if;
  select * into c from codes_promo where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'raison', 'inconnu');
  end if;
  if not c.actif then
    return jsonb_build_object('ok', false, 'raison', 'inactif');
  end if;
  if c.debut is not null and aujourdhui < c.debut then
    return jsonb_build_object('ok', false, 'raison', 'pas_commence');
  end if;
  if c.fin is not null and aujourdhui > c.fin then
    return jsonb_build_object('ok', false, 'raison', 'expire');
  end if;
  if v_sous_total < c.minimum_centimes then
    return jsonb_build_object('ok', false, 'raison', 'minimum', 'minimum_centimes', c.minimum_centimes);
  end if;
  if c.type = 'livraison' and (p ->> 'mode' is distinct from 'livraison' or v_frais = 0) then
    return jsonb_build_object('ok', false, 'raison', 'retrait');
  end if;
  if c.plafond_utilisations is not null and (
    select count(*) from utilisations_codes u join commandes x on x.id = u.commande_id
    where u.code_id = c.id and commande_compte(x)
  ) >= c.plafond_utilisations then
    return jsonb_build_object('ok', false, 'raison', 'plafond');
  end if;
  if (c.une_fois_par_client or c.premiere_commande) and v_email is null and v_tel is null then
    if coalesce((p ->> 'provisoire')::boolean, false) then
      return jsonb_build_object('ok', true, 'code', c.code, 'type', c.type, 'a_verifier', true,
        'remise_centimes', case c.type
          when 'pourcentage' then round(v_sous_total * c.valeur / 100.0)::integer
          when 'montant' then least(c.valeur, v_sous_total)
          else v_frais end);
    end if;
    return jsonb_build_object('ok', false, 'raison', 'client_inconnu');
  end if;
  if c.une_fois_par_client and exists (
    select 1 from utilisations_codes u join commandes x on x.id = u.commande_id
    where u.code_id = c.id and commande_compte(x)
      and (email_normal(x.client_email) = v_email or telephone_normal(x.client_telephone) = v_tel or adresse_cle(x.adresse) = v_adr)
  ) then
    return jsonb_build_object('ok', false, 'raison', 'deja_utilise');
  end if;
  if c.premiere_commande and (
    exists (select 1 from commandes x where email_normal(x.client_email) = v_email and commande_compte(x))
    or exists (select 1 from commandes x where telephone_normal(x.client_telephone) = v_tel and commande_compte(x))
    or (v_adr is not null and exists (select 1 from commandes x where adresse_cle(x.adresse) = v_adr and commande_compte(x)))
  ) then
    return jsonb_build_object('ok', false, 'raison', 'pas_premiere');
  end if;
  remise := case c.type
    when 'pourcentage' then round(v_sous_total * c.valeur / 100.0)::integer
    when 'montant' then least(c.valeur, v_sous_total)
    else v_frais end;
  return jsonb_build_object('ok', true, 'code', c.code, 'type', c.type, 'remise_centimes', remise);
end;
$$;

revoke execute on function evaluer_code(jsonb) from public, anon, authenticated;
grant execute on function evaluer_code(jsonb) to service_role;
