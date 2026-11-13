-- Calendrier du back-office (vague 3, bo-operations) : pour chaque jour, les commandes déjà prises par service
-- et par mode, sans aucune donnée de client. Sert à voir ce qu'une fermeture toucherait avant de la poser
-- (le détail par numéro reste commandes_dans_periode, vague 2). Même règle de service : midi avant 15h.
-- Commandes pour un créneau (à l'avance) et « dès que possible » (jour de leur heure confirmée, sinon de leur
-- création), ni refusées, ni annulées, ni en attente de paiement. Pas d'objet partagé recréé.
create function reservations_par_jour(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  with o as (
    select
      coalesce(c.quand_date, (coalesce(c.heure_confirmee, c.cree_le) at time zone 'Europe/Zurich')::date) as jour,
      case
        when c.quand_type = 'creneau' then case when c.quand_minutes < 900 then 'midi' else 'soir' end
        when extract(hour from coalesce(c.heure_confirmee, c.cree_le) at time zone 'Europe/Zurich') < 15 then 'midi'
        else 'soir'
      end as service,
      c.mode
    from commandes c
    where c.statut in ('nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie', 'terminee')
      and (
        (c.quand_type = 'creneau' and c.quand_date between p_debut and least(p_fin, p_debut + 92))
        or (c.quand_type <> 'creneau' and c.cree_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
          and c.cree_le < ((least(p_fin, p_debut + 92) + 1)::timestamp at time zone 'Europe/Zurich'))
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object('jour', jour, 'service', service, 'livraisons', l, 'retraits', r) order by jour, service), '[]'::jsonb)
  from (
    select jour, service, count(*) filter (where mode = 'livraison') as l, count(*) filter (where mode = 'retrait') as r
    from o where jour between p_debut and least(p_fin, p_debut + 92) group by jour, service
  ) x;
$$;

revoke execute on function reservations_par_jour(date, date) from public, anon, authenticated;
grant execute on function reservations_par_jour(date, date) to service_role;
