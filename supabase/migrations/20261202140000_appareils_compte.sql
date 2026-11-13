-- Vague 3, client-compte : le client voit les appareils connectés à son compte (« Safari sur iPhone ») et en
-- déconnecte un seul. Ajouts : colonne sessions_compte.appareil (en fin de table, nom court, rien d'autre),
-- trois fonctions neuves. Aucun objet recréé, aucun UPDATE ni DELETE sur des données existantes.
alter table sessions_compte add column appareil text check (appareil is null or length(appareil) <= 60);

-- Juste après la connexion : le nom de l'appareil de la session, une fois.
create function noter_appareil(p_session_hache text, p_appareil text) returns void
language sql as $$
  update sessions_compte set appareil = left(btrim(p_appareil), 60)
  where jeton_hache = p_session_hache and appareil is null and revoquee_le is null;
$$;

-- Sessions ouvertes du compte, la plus récente d'abord ; « courant » : celle du navigateur qui demande.
create function appareils_compte(p_compte uuid, p_session_hache text) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'appareil', s.appareil, 'cree_le', s.cree_le, 'courant', s.jeton_hache = p_session_hache)
    order by s.cree_le desc), '[]'::jsonb)
  from sessions_compte s
  where s.compte_id = p_compte and s.revoquee_le is null and s.expire_le > now();
$$;

-- Déconnecte une seule session du compte de la session qui demande ; jamais celle d'un autre compte.
create function deconnecter_appareil(p_compte uuid, p_session uuid, p_ip_court text) returns boolean
language plpgsql as $$
begin
  update sessions_compte set revoquee_le = now() where id = p_session and compte_id = p_compte and revoquee_le is null;
  if not found then
    return false;
  end if;
  insert into journal_connexions (compte_id, evenement, ip_court) values (p_compte, 'deconnexion', p_ip_court);
  return true;
end;
$$;

revoke execute on function noter_appareil(text, text), appareils_compte(uuid, text), deconnecter_appareil(uuid, uuid, text) from public, anon, authenticated;
grant execute on function noter_appareil(text, text), appareils_compte(uuid, text), deconnecter_appareil(uuid, uuid, text) to service_role;
