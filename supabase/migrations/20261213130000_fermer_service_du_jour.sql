-- Fermer le service du jour (vague 3, bo-operations ; droit fermer_service du rôle « responsable de service »,
-- décision D1 de Jérémy, coordonnée par bo-socle). Une panne, un coup dur : le responsable ferme ce midi, ce soir
-- ou toute la journée d'aujourd'hui, avec un motif, depuis la tablette ou le back-office. Aujourd'hui seulement :
-- la date vient de la base (heure de Genève), jamais de l'appelant. Les autres fermetures, les horaires et les
-- zones restent au gérant (gerant_nom).
-- Contrôle : auteur_droit(p_personnel, 'fermer_service') (gérant, ou responsable quand role_responsable_actif).
-- Aucune fonction partagée recréée.

-- p_service : 'midi', 'soir' ou 'journee'. Rend l'identifiant de la fermeture. Déjà fermé : erreur deja_ferme.
create function fermer_service_du_jour(p_service text, p_motif text, p_personnel uuid) returns smallint
language plpgsql as $$
declare
  qui text := auteur_droit(p_personnel, 'fermer_service');
  jour date := (now() at time zone 'Europe/Zurich')::date;
  motif text := btrim(regexp_replace(coalesce(p_motif, ''), '\s+', ' ', 'g'));
  srv text := case when p_service = 'journee' then null else p_service end;
  f fermetures%rowtype;
begin
  if p_service is null or p_service not in ('midi', 'soir', 'journee') then
    raise exception 'service_invalide';
  end if;
  if char_length(motif) not between 2 and 120 then
    raise exception 'motif_invalide';
  end if;
  -- Déjà fermé aujourd'hui : toute la journée, ou ce service quand on ferme un service.
  if exists (
    select 1 from fermetures x
    where x.debut <= jour and jour <= x.fin and (x.service is null or (srv is not null and x.service = srv))
  ) then
    raise exception 'deja_ferme';
  end if;
  insert into fermetures (debut, fin, motif, service) values (jour, jour, motif, srv) returning * into f;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'fermeture', f.id::text, null, to_jsonb(f));
  return f.id;
end;
$$;

revoke execute on function fermer_service_du_jour(text, text, uuid) from public, anon, authenticated;
grant execute on function fermer_service_du_jour(text, text, uuid) to service_role;
