-- Appareils connectés de l'équipe (vague 3, bo-socle) : pour chaque membre, ses sessions ouvertes, avec le
-- type d'appareil (« iPad, Safari »), la date de connexion et la dernière activité, et « Déconnecter cet
-- appareil » un par un (une tablette volée, un téléphone de livreur perdu) sans couper les autres.
-- Rien de personnel : ni adresse IP complète ni empreinte du navigateur, seulement un libellé court tiré du
-- navigateur à la connexion. La dernière activité est notée au plus une fois toutes les cinq minutes.

alter table sessions_personnel add column appareil text check (appareil is null or length(appareil) <= 40);
alter table sessions_personnel add column vue_le timestamptz;

-- À la connexion : le libellé de l'appareil de la session qui vient de naître.
create function noter_appareil_personnel(p_session_hache text, p_appareil text) returns void
language sql as $$
  update sessions_personnel set appareil = left(nullif(btrim(p_appareil), ''), 40), vue_le = now()
  where jeton_hache = p_session_hache and revoquee_le is null;
$$;

-- À chaque page ou requête de l'équipe : au plus une écriture toutes les cinq minutes par appareil.
create function voir_session_personnel(p_session_hache text) returns void
language sql as $$
  update sessions_personnel set vue_le = now()
  where jeton_hache = p_session_hache and revoquee_le is null and expire_le > now()
    and (vue_le is null or vue_le < now() - interval '5 minutes');
$$;

-- Le gérant : les appareils ouverts d'un membre, le plus récent en haut. « actuel » marque celui du gérant.
create function appareils_personnel(p_membre uuid, p_personnel uuid, p_session_hache text) returns jsonb
language plpgsql stable as $$
begin
  perform gerant_nom(p_personnel);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'appareil', s.appareil, 'cree_le', s.cree_le, 'vue_le', s.vue_le, 'expire_le', s.expire_le,
      'actuel', s.jeton_hache = p_session_hache
    ) order by coalesce(s.vue_le, s.cree_le) desc)
    from sessions_personnel s
    join personnel p on p.id = s.personnel_id
    where s.personnel_id = p_membre and s.revoquee_le is null and s.expire_le > now()
      -- Même règle que personnel_de_session : la session d'un livreur ne vit que 12 heures.
      and (p.role <> 'livreur' or s.cree_le > now() - interval '12 hours')
  ), '[]'::jsonb);
end;
$$;

-- Le gérant coupe un seul appareil. Journalisé comme « Déconnecté de 1 appareil ».
create function couper_appareil_personnel(p_session uuid, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  e text;
begin
  update sessions_personnel s set revoquee_le = now()
  from personnel p
  where s.id = p_session and p.id = s.personnel_id and s.revoquee_le is null
  returning p.email into e;
  if e is null then
    return false;
  end if;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, auteur, 'personnel', e, null, jsonb_build_object('sessions_coupees', 1));
  return true;
end;
$$;

revoke all on function noter_appareil_personnel(text, text), voir_session_personnel(text), appareils_personnel(uuid, uuid, text), couper_appareil_personnel(uuid, uuid)
  from public, anon, authenticated;
grant execute on function noter_appareil_personnel(text, text), voir_session_personnel(text), appareils_personnel(uuid, uuid, text), couper_appareil_personnel(uuid, uuid)
  to service_role;
