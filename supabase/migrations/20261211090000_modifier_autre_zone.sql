-- Vague 3, bo-commandes : adresse corrigée dans une AUTRE zone de livraison (D4), désactivée par défaut
-- (réglage modification_autre_zone). Permise seulement si les frais de la nouvelle zone ne dépassent pas
-- ceux déjà payés et si le sous-total atteint son minimum : rien n'est à encaisser, le restaurant garde
-- l'écart. Une zone plus chère reste refusée (« annulez et faites recommander ») : elle demanderait un
-- paiement du complément, autre décision de Jérémy.
-- L'activer : update reglages set valeur = 'true', proposition = false where cle = 'modification_autre_zone';
--
-- Objet partagé recréé : modifier_commande, reprise de sa seule définition (20261127100000_modifier_commande.sql),
-- avec seulement le cas de l'autre zone en plus. Nommée après la dernière migration de main pour cette raison.
-- Compatible avant et après : sans le réglage, la fonction se comporte exactement comme avant ; le code de
-- main n'envoie pas les frais de la zone et retombe donc toujours sur « autre zone refusée ».

insert into reglages (cle, valeur, proposition) values ('modification_autre_zone', 'false', true)
on conflict (cle) do nothing;

create function modification_autre_zone_active() returns boolean
language sql stable as $$
  select coalesce((select (valeur #>> '{}')::boolean from reglages where cle = 'modification_autre_zone' and jsonb_typeof(valeur) = 'boolean'), false);
$$;

create or replace function modifier_commande(p_commande uuid, p jsonb, p_personnel uuid, p_par text, p_de text default null) returns jsonb
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
  if c.statut not in ('nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie') then
    raise exception 'statut_non_modifiable';
  end if;
  if pe.role <> 'gerant' and (
    c.statut in ('prete', 'partie')
    or not coalesce((select (valeur #>> '{}')::boolean from reglages where cle = 'modification_par_equipe' and jsonb_typeof(valeur) = 'boolean'), false)
  ) then
    raise exception 'reserve_gerant';
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
    if (p ->> 'zone_numero') is null then
      raise exception 'zone_differente';
    end if;
    if (p ->> 'zone_numero')::smallint is distinct from c.zone_numero then
      -- Autre zone (D4, désactivé par défaut) : seulement si ses frais ne dépassent pas ceux payés et si le
      -- sous-total atteint son minimum. Les frais payés restent : le restaurant garde l'écart, rien n'est dû.
      if not modification_autre_zone_active()
        or (p ->> 'zone_frais_centimes') is null or (p ->> 'zone_minimum_centimes') is null
        or (p ->> 'zone_frais_centimes')::integer > c.frais_centimes
        or c.sous_total_centimes < (p ->> 'zone_minimum_centimes')::integer then
        raise exception 'zone_differente';
      end if;
      avant := avant || jsonb_build_object('zone_numero', c.zone_numero);
      apres := apres || jsonb_build_object('zone_numero', (p ->> 'zone_numero')::smallint);
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
    adresse = case when apres ? 'adresse' then apres -> 'adresse' else adresse end,
    zone_numero = case when apres ? 'zone_numero' then (apres ->> 'zone_numero')::smallint else zone_numero end
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

revoke execute on function modification_autre_zone_active() from public, anon, authenticated;
grant execute on function modification_autre_zone_active() to service_role;
