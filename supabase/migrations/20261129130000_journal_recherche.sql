-- Vague 3, pilotage : journal du back-office, lecture avec filtres. Qui, quoi, quand, et une recherche dans la
-- clé et les valeurs avant et après. Page par page (curseur sur l'identifiant), du plus récent au plus ancien.
-- Lecture seule, service_role seul (la route vérifie le gérant), comme journal_gestion_recent qui reste en place.
--
-- p : { auteur?: text, objet?: text, debut?: date, fin?: date (jours à Genève), recherche?: text,
--       avant_id?: bigint (dernière ligne déjà affichée), limite?: integer (100 par défaut, 200 au plus) }

-- Index : journal_gestion_idx (le) et journal_gestion_objet_idx (objet, cle, le), déjà en place.

create function journal_gestion_chercher(p jsonb) returns jsonb
language plpgsql stable as $$
declare
  auteur text := nullif(btrim(coalesce(p ->> 'auteur', '')), '');
  obj text := nullif(btrim(coalesce(p ->> 'objet', '')), '');
  debut date := nullif(p ->> 'debut', '')::date;
  fin date := nullif(p ->> 'fin', '')::date;
  q text := left(nullif(btrim(regexp_replace(coalesce(p ->> 'recherche', ''), '\s+', ' ', 'g')), ''), 60);
  avant_id bigint := nullif(p ->> 'avant_id', '')::bigint;
  limite integer := least(greatest(coalesce(nullif(p ->> 'limite', '')::integer, 100), 1), 200);
  motif text;
  lignes jsonb;
  n integer;
begin
  if debut is not null and fin is not null and fin < debut then
    raise exception 'periode_invalide';
  end if;
  -- La recherche est un texte, pas un motif : % et _ tapés par le gérant se cherchent tels quels.
  motif := case when q is null then null else '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  select coalesce(jsonb_agg(to_jsonb(j) - 'personnel_id' order by j.id desc), '[]'::jsonb), count(*)
  into lignes, n
  from (
    select * from journal_gestion e
    where (auteur is null or e.personnel_nom = auteur)
      and (obj is null or e.objet = obj)
      and (debut is null or e.le >= (debut::timestamp at time zone 'Europe/Zurich'))
      and (fin is null or e.le < ((fin + 1)::timestamp at time zone 'Europe/Zurich'))
      and (avant_id is null or e.id < avant_id)
      and (motif is null or e.cle ilike motif or e.avant::text ilike motif or e.apres::text ilike motif)
    order by e.id desc
    limit limite + 1
  ) j;
  -- Une ligne de plus que demandé : il y a une page suivante.
  if n > limite then
    lignes := lignes - limite;
    return jsonb_build_object('entrees', lignes, 'suivant', (lignes -> (limite - 1) ->> 'id')::bigint);
  end if;
  return jsonb_build_object('entrees', lignes, 'suivant', null);
end;
$$;

-- Ce que proposent les listes de l'écran : les auteurs et les objets présents dans le journal, les plus
-- fréquents d'abord.
create function journal_gestion_filtres() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'auteurs', coalesce((select jsonb_agg(jsonb_build_object('nom', a.personnel_nom, 'lignes', a.n) order by a.n desc, a.personnel_nom)
      from (select personnel_nom, count(*) as n from journal_gestion group by personnel_nom) a), '[]'::jsonb),
    'objets', coalesce((select jsonb_agg(jsonb_build_object('objet', o.objet, 'lignes', o.n) order by o.n desc, o.objet)
      from (select objet, count(*) as n from journal_gestion group by objet) o), '[]'::jsonb)
  );
$$;

revoke execute on function journal_gestion_chercher(jsonb), journal_gestion_filtres() from public, anon, authenticated;
grant execute on function journal_gestion_chercher(jsonb), journal_gestion_filtres() to service_role;
