-- Prix en lot et duplication d'un plat (vague 3, bo-carte).
--
-- 1. Prix en lot : le gérant choisit des plats (une catégorie entière ou une liste) et une règle :
--    nouveau prix pour chacun, hausse ou baisse en pour cent, ou en centimes, arrondie à 5, 10, 50 ou
--    100 centimes. La base calcule les nouveaux prix à partir de ceux qu'elle a : aucun montant ne vient du
--    code. Aperçu sans écriture (p_appliquer faux), puis application en une seule transaction : tout passe
--    ou rien ne passe. Chaque plat changé passe par modifier_plat : même journal (objet « plat », donc
--    annulable ligne par ligne), même verrou, même règle « Prix validé ».
-- 2. Dupliquer un plat : copie hors de la vente (origine 'gestion'), sous le nom donné, dans la même
--    catégorie, avec poste, description, prix, provenance, allergènes, disponibilités, groupes d'options et
--    retraits. Une photo envoyée n'est pas copiée (elle appartient à son plat et s'efface avec lui) ; une
--    photo du shooting l'est.
--
-- Objets partagés recréés : aucun. Fonctions neuves seulement. Après 20261210090000_disponibilites.sql
-- (colonnes dispo_* copiées par dupliquer_plat).

-- p : { categorie: slug } ou { slugs: [..] }, regle: 'fixe' | 'pourcentage' | 'montant',
--     valeur: entier signé (centièmes de pour cent pour 'pourcentage' : 500 = +5 % ; centimes pour 'montant'),
--     prix: { slug: centimes } pour 'fixe', arrondi: 5 | 10 | 50 | 100 (défaut 10), prix_valide: booléen.
-- Rend [{ slug, nom, avant, apres }], dans l'ordre de la carte. Plats archivés et plats du jour exclus.
create function prix_en_lot(p jsonb, p_appliquer boolean, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  arrondi integer;
  regle text := p ->> 'regle';
  valeur integer;
  r record;
  resultat jsonb := '[]'::jsonb;
  nouveau integer;
  n integer := 0;
begin
  perform gerant_nom(p_personnel);
  if p ? 'arrondi' and (p ->> 'arrondi') !~ '^[0-9]{1,3}$' then raise exception 'arrondi_invalide'; end if;
  arrondi := coalesce((p ->> 'arrondi')::integer, 10);
  if arrondi not in (5, 10, 50, 100) then raise exception 'arrondi_invalide'; end if;
  if regle is null or regle not in ('fixe', 'pourcentage', 'montant') then raise exception 'regle_invalide'; end if;
  if regle <> 'fixe' then
    if jsonb_typeof(p -> 'valeur') is distinct from 'number' or (p ->> 'valeur') !~ '^-?[0-9]{1,5}$' then raise exception 'valeur_invalide'; end if;
    valeur := (p ->> 'valeur')::integer;
    if valeur = 0 or (regle = 'pourcentage' and abs(valeur) > 5000) or (regle = 'montant' and abs(valeur) > 10000) then
      raise exception 'valeur_invalide';
    end if;
  elsif jsonb_typeof(p -> 'prix') is distinct from 'object' then
    raise exception 'valeur_invalide';
  end if;
  if not (p ? 'categorie' or jsonb_typeof(p -> 'slugs') = 'array' or regle = 'fixe') then
    raise exception 'selection_vide';
  end if;

  for r in
    select x.slug, x.nom, x.prix_centimes, x.origine, x.commandable
    from plats x join categories c on c.id = x.categorie_id
    where x.archive_le is null and x.origine <> 'jour'
      and case
        when p ? 'categorie' then c.slug = p ->> 'categorie'
        when jsonb_typeof(p -> 'slugs') = 'array' then x.slug in (select jsonb_array_elements_text(p -> 'slugs'))
        else p -> 'prix' ? x.slug
      end
    order by c.ordre, x.ordre, x.nom
    for update of x
  loop
    n := n + 1;
    if n > 300 then raise exception 'selection_trop_grande'; end if;
    if regle = 'fixe' then
      if not (p -> 'prix' ? r.slug) then continue; end if;
      if jsonb_typeof(p -> 'prix' -> r.slug) <> 'number' or (p -> 'prix' ->> r.slug) !~ '^[0-9]{1,6}$' then
        raise exception 'prix_hors_bornes: %', r.nom;
      end if;
      nouveau := (p -> 'prix' ->> r.slug)::integer;
    elsif regle = 'pourcentage' then
      nouveau := (round(r.prix_centimes::numeric * (10000 + valeur) / 10000 / arrondi) * arrondi)::integer;
    else
      nouveau := (round((r.prix_centimes + valeur)::numeric / arrondi) * arrondi)::integer;
    end if;
    if nouveau < 0 then
      raise exception 'prix_hors_bornes: %', r.nom;
    end if;
    -- Même verrou que modifier_plat, dès l'aperçu : un plat ajouté au back-office et en vente ne peut pas
    -- passer avec un prix à valider.
    if nouveau <> r.prix_centimes and not coalesce((p ->> 'prix_valide')::boolean, false)
       and r.origine <> 'carte' and r.commandable then
      raise exception 'plat_incomplet: % : prix à valider (cochez « Prix validé »)', r.nom;
    end if;
    resultat := resultat || jsonb_build_array(jsonb_build_object('slug', r.slug, 'nom', r.nom, 'avant', r.prix_centimes, 'apres', nouveau));
    if p_appliquer and nouveau <> r.prix_centimes then
      perform modifier_plat(r.slug, jsonb_build_object('prix_centimes', nouveau, 'prix_valide', coalesce((p ->> 'prix_valide')::boolean, false)), p_personnel);
    end if;
  end loop;
  if jsonb_array_length(resultat) = 0 then
    raise exception 'selection_vide';
  end if;
  return resultat;
end;
$$;

-- Copie d'un plat, hors de la vente, sous un nouveau nom. Rend { slug }.
create function dupliquer_plat(p_slug text, p_base text, p_nom text, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  src plats%rowtype;
  s text;
  pid uuid;
  apres plats%rowtype;
  n text := btrim(regexp_replace(coalesce(p_nom, ''), '\s+', ' ', 'g'));
begin
  perform gerant_nom(p_personnel);
  select * into src from plats where slug = p_slug;
  if not found then
    return null;
  end if;
  if src.origine = 'jour' then
    raise exception 'jour_non_duplicable';
  end if;
  if n = '' or length(n) > 80 then
    raise exception 'nom_invalide';
  end if;
  s := slug_libre(p_base);
  -- La copie se range juste après son modèle.
  update plats set ordre = ordre + 1 where categorie_id = src.categorie_id and ordre > src.ordre;
  insert into plats (slug, categorie_id, nom, description, prix_centimes, prix_a_valider, commandable, station, photo,
                     ordre, provenance, provenances_a_fournir, allergenes, origine, dispo_service, dispo_mode, dispo_jours)
  values (
    s, src.categorie_id, n, src.description, src.prix_centimes, src.prix_a_valider, false, src.station,
    case when src.photo ~ '^[0-9a-f-]{36}\.jpg$' then null else src.photo end,
    src.ordre + 1,
    src.provenance, src.provenances_a_fournir, src.allergenes, 'gestion', src.dispo_service, src.dispo_mode, src.dispo_jours
  )
  returning id into pid;
  insert into plat_groupes (plat_id, groupe_id, ordre) select pid, groupe_id, ordre from plat_groupes where plat_id = src.id;
  insert into plat_retraits (plat_id, nom, a_valider, ordre) select pid, nom, a_valider, ordre from plat_retraits where plat_id = src.id;
  select * into apres from plats where id = pid;
  -- Même objet qu'un plat ajouté : une création ne s'annule pas depuis le journal.
  perform journaliser(p_personnel, 'plat_ajoute', s, null,
    to_jsonb(apres) - 'id' - 'cree_le' - 'modifie_le' || jsonb_build_object('copie_de', p_slug));
  return jsonb_build_object('slug', s, 'commandable', false, 'manques', to_jsonb(motifs_plat(pid)));
end;
$$;

revoke execute on function prix_en_lot(jsonb, boolean, uuid), dupliquer_plat(text, text, text, uuid) from public, anon, authenticated;
grant execute on function prix_en_lot(jsonb, boolean, uuid), dupliquer_plat(text, text, text, uuid) to service_role;
