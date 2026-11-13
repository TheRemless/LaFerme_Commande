-- Vague 3, client-compte : le client corrige les consignes de livraison d'une adresse enregistrée (étage,
-- sonnette, code, instructions), contrôlées par le serveur (detailsValides). Seulement une adresse du compte de
-- la session. Fonction neuve ; aucun objet recréé, aucun UPDATE ni DELETE sur des données existantes.
create function modifier_details_adresse(p_compte uuid, p_adresse uuid, p_details jsonb, p_ip_court text) returns boolean
language plpgsql as $$
begin
  update adresses_compte set details = p_details where id = p_adresse and compte_id = p_compte;
  if not found then
    return false;
  end if;
  insert into journal_connexions (compte_id, evenement, ip_court) values (p_compte, 'profil_modifie', p_ip_court);
  return true;
end;
$$;
revoke execute on function modifier_details_adresse(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function modifier_details_adresse(uuid, uuid, jsonb, text) to service_role;
