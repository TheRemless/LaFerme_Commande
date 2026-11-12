-- Alerte quand une adresse de l'équipe est bloquée par des codes faux (audit de sécurité, S4).
-- Reprend verifier_code_personnel_limite (20261112090000_correctifs_securite.sql, inchangée depuis) et n'y ajoute
-- qu'un drapeau : au 15e code faux en 24 heures sur une adresse active de l'équipe, la réponse porte
-- « bloque » et la fin du blocage. Le site prévient alors le membre et le restaurant, une seule fois.
-- Ancien code compatible : il ignore ce drapeau.

create or replace function verifier_code_personnel_limite(
  p_email text, p_cle_email text, p_cle_ip text, p_code_hache text, p_ip_court text,
  p_session_hache text, p_ancienne_session_hache text default null
) returns jsonb
language plpgsql as $$
declare
  a integer;
  r jsonb;
  n integer;
  premier timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('code:' || p_cle_email));
  a := attente_limite('echec_email', p_cle_email, 15, interval '24 hours', 0, 0);
  if a > 0 then
    return jsonb_build_object('statut', 'attente', 'attente', a);
  end if;
  r := verifier_code_personnel(p_email, p_cle_email, p_cle_ip, p_code_hache, p_ip_court, p_session_hache, p_ancienne_session_hache);
  if r ->> 'statut' = 'invalide' then
    insert into tentatives_connexion (action, cle) values ('echec_email', p_cle_email);
    -- Sous le verrou ci-dessus : le compte passe par 15 une seule fois par blocage.
    select count(*), min(le) into n, premier from tentatives_connexion
    where action = 'echec_email' and cle = p_cle_email and le > now() - interval '24 hours';
    if n = 15 and exists (select 1 from personnel where email = lower(btrim(p_email)) and actif) then
      r := r || jsonb_build_object('bloque', true, 'jusqu_a', premier + interval '24 hours');
    end if;
  end if;
  return r;
end;
$$;

revoke execute on function verifier_code_personnel_limite(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function verifier_code_personnel_limite(text, text, text, text, text, text, text) to service_role;
