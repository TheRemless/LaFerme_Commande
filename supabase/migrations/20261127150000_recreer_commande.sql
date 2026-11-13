-- Vague 3, bo-commandes : recréer une commande à partir d'une autre quand le client appelle (« la même que
-- vendredi », ou une commande annulée à refaire). Nouvelle commande à emporter, payée au comptoir, aux prix
-- du jour, contrôlée comme une commande du site. Façon de prendre une commande et argent : décision de
-- Jérémy, désactivée par défaut (réglage commande_telephone_active).
-- L'activer : update reglages set valeur = 'true', proposition = false where cle = 'commande_telephone_active';
--
-- Objets partagés recréés : aucun. Compatible avant et après : le code de main n'appelle pas ces fonctions.

insert into reglages (cle, valeur, proposition) values ('commande_telephone_active', 'false', true)
on conflict (cle) do nothing;

create function commande_telephone_active() returns boolean
language sql stable as $$
  select coalesce((select (valeur #>> '{}')::boolean from reglages where cle = 'commande_telephone_active' and jsonb_typeof(valeur) = 'boolean'), false);
$$;

-- Trace des deux côtés : la commande source dit « recréée en n° X », la nouvelle « recréée depuis n° Y ».
create function noter_recreation(p_source uuid, p_nouvelle uuid, p_personnel uuid) returns void
language plpgsql as $$
declare
  nom text := gerant_nom(p_personnel);
  s commandes%rowtype;
  n commandes%rowtype;
begin
  select * into s from commandes where id = p_source;
  select * into n from commandes where id = p_nouvelle;
  if s.id is null or n.id is null then
    raise exception 'commande_inconnue';
  end if;
  insert into evenements_commande (commande_id, de, vers, par, detail) values
    (s.id, s.statut, s.statut, 'gestion:' || nom, 'recreee en ' || n.numero),
    (n.id, null, n.statut, 'gestion:' || nom, 'recreee depuis ' || s.numero || ' du ' || to_char(s.jour_service, 'DD.MM.YYYY'));
  perform journaliser(p_personnel, 'commande_recreee', n.id::text, jsonb_build_object('source', s.id, 'numero', s.numero), jsonb_build_object('numero', n.numero, 'total_centimes', n.total_centimes));
end;
$$;

revoke execute on function commande_telephone_active(), noter_recreation(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function commande_telephone_active(), noter_recreation(uuid, uuid, uuid) to service_role;
