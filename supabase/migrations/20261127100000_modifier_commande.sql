-- Vague 3, bo-commandes, PR B : modifier une commande acceptée, lot n°1 sans argent.
-- Le client appelle : « je me suis trompé d'étage », « c'est au nom de ma femme », « mon numéro a changé ».
-- Modifiable : prénom, nom, téléphone, et pour une livraison les consignes (sonnette, étage, code,
-- instructions) et l'adresse dans la MÊME zone (mêmes frais, même minimum). Une adresse dans une autre zone,
-- un passage livraison ↔ retrait ou un article ajouté touchent au montant : décision de Jérémy, pas ici.
--
-- Droits (proposition à valider par Jérémy) : l'équipe (service ou gérant) tant que la commande est à
-- accepter, acceptée ou en préparation ; le gérant seul une fois prête ou partie ; personne ensuite.
-- Le serveur a déjà validé la forme des champs et décidé la zone de l'adresse (registre fédéral) : la base
-- revérifie l'auteur, l'état, le mode et que la zone n'a pas changé.
--
-- Objets partagés recréés : aucun. Compatible avant et après : le code de main n'appelle pas cette fonction.

create function modifier_commande(p_commande uuid, p jsonb, p_personnel uuid, p_par text, p_de text default null) returns jsonb
language plpgsql as $$
declare
  pe personnel%rowtype;
  c commandes%rowtype;
  avant jsonb := '{}'::jsonb;
  apres jsonb := '{}'::jsonb;
  k text;
begin
  select * into pe from personnel where id = p_personnel and actif and role in ('service', 'gerant');
  if not found then
    raise exception 'personnel_inactif';
  end if;
  select * into c from commandes where id = p_commande for update;
  if not found then
    raise exception 'commande_inconnue';
  end if;
  -- L'écran montrait un autre état (autre tablette, livreur) : rien ne se fait (SS-06).
  if p_de is not null and c.statut <> p_de then
    raise exception 'deja_change';
  end if;
  if c.statut in ('prete', 'partie') then
    if pe.role <> 'gerant' then
      raise exception 'reserve_gerant';
    end if;
  elsif c.statut not in ('nouvelle', 'acceptee', 'en_preparation') then
    raise exception 'statut_non_modifiable';
  end if;

  foreach k in array array['client_prenom', 'client_nom', 'client_telephone'] loop
    if p ? k then
      if jsonb_typeof(p -> k) <> 'string' or length(btrim(p ->> k)) not between 1 and 60 then
        raise exception 'champ_invalide';
      end if;
      if (to_jsonb(c) -> k) is distinct from to_jsonb(btrim(p ->> k)) then
        avant := avant || jsonb_build_object(k, to_jsonb(c) -> k);
        apres := apres || jsonb_build_object(k, btrim(p ->> k));
      end if;
    end if;
  end loop;

  if p ? 'details_livraison' or p ? 'adresse' then
    if c.mode <> 'livraison' then
      raise exception 'pas_une_livraison';
    end if;
  end if;
  if p ? 'details_livraison' then
    if jsonb_typeof(p -> 'details_livraison') <> 'object' or coalesce(btrim(p -> 'details_livraison' ->> 'sonnette'), '') = '' then
      raise exception 'champ_invalide';
    end if;
    if c.details_livraison is distinct from p -> 'details_livraison' then
      avant := avant || jsonb_build_object('details_livraison', c.details_livraison);
      apres := apres || jsonb_build_object('details_livraison', p -> 'details_livraison');
    end if;
  end if;
  if p ? 'adresse' then
    if jsonb_typeof(p -> 'adresse') <> 'object' or coalesce(p -> 'adresse' ->> 'npa', '') !~ '^\d{4}$' then
      raise exception 'champ_invalide';
    end if;
    -- Même zone, donc mêmes frais et même minimum : le montant payé reste juste.
    if (p ->> 'zone_numero') is null or (p ->> 'zone_numero')::smallint is distinct from c.zone_numero then
      raise exception 'zone_differente';
    end if;
    if c.adresse is distinct from p -> 'adresse' then
      avant := avant || jsonb_build_object('adresse', c.adresse);
      apres := apres || jsonb_build_object('adresse', p -> 'adresse');
    end if;
  end if;

  if apres = '{}'::jsonb then
    return jsonb_build_object('modifie', false, 'champs', '[]'::jsonb);
  end if;

  update commandes set
    client_prenom = coalesce(apres ->> 'client_prenom', client_prenom),
    client_nom = coalesce(apres ->> 'client_nom', client_nom),
    client_telephone = coalesce(apres ->> 'client_telephone', client_telephone),
    details_livraison = case when apres ? 'details_livraison' then apres -> 'details_livraison' else details_livraison end,
    adresse = case when apres ? 'adresse' then apres -> 'adresse' else adresse end
  where id = p_commande;

  insert into evenements_commande (commande_id, de, vers, par, detail)
    values (p_commande, c.statut, c.statut, p_par, 'modifiee ' || (select string_agg(x, ', ' order by x) from jsonb_object_keys(apres) x));
  -- Livraison en cours : le livreur doit relire l'adresse (son téléphone lit le journal des livraisons).
  if apres ? 'adresse' or apres ? 'details_livraison' then
    insert into journal_livraisons (commande_id, personnel_id, par, evenement, detail)
      select p_commande, p_personnel, p_par, 'adresse_modifiee', null
      where exists (select 1 from livraisons l where l.commande_id = p_commande and l.retiree_le is null);
  end if;
  -- Journal du back-office pour tout auteur, gérant ou équipe (journaliser exige un gérant).
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, pe.nom, 'commande', p_commande::text, avant, apres);

  return jsonb_build_object('modifie', true, 'statut', c.statut,
    'champs', (select jsonb_agg(x order by x) from jsonb_object_keys(apres) x), 'avant', avant, 'apres', apres);
end;
$$;

revoke execute on function modifier_commande(uuid, jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function modifier_commande(uuid, jsonb, uuid, text, text) to service_role;
