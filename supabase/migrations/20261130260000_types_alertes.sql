-- Alertes réglables par type (vague 3, bo-operations ; P1 de produit-gestion). Le gérant ne réglait que l'adresse
-- qui reçoit les alertes. Il choisit désormais, type par type, les e-mails d'alerte qu'il reçoit. Tous restent
-- envoyés au départ (comportement d'avant). Un type coupé n'envoie plus d'e-mail, mais sa copie reste en base
-- (courriels, fournisseur « desactivee ») : rien ne se perd. Lecture : src/lib/alertes-types.ts, alerter().
-- Aucune fonction partagée recréée.

create table types_alertes (
  cle text primary key check (cle ~ '^[a-z_]{2,40}$'),
  libelle text not null check (char_length(libelle) between 5 and 120),
  aide text check (aide is null or char_length(aide) <= 300),
  ordre smallint not null default 100,
  actif boolean not null default true,
  modifie_le timestamptz
);
alter table types_alertes enable row level security;
revoke all on types_alertes from anon, authenticated;
grant select, update on types_alertes to service_role;

insert into types_alertes (cle, libelle, aide, ordre) values
  ('commande_en_attente', 'Commande pas encore acceptée', 'Après le délai réglé dans la rubrique Imprimantes (« Alerte de commande en attente »).', 10),
  ('tablette_muette', 'Tablette injoignable pendant le service', 'Les commandes en ligne se mettent en pause seules.', 20),
  ('ticket_non_imprime', 'Ticket pas imprimé', 'Une imprimante a refusé un ticket.', 30),
  ('remboursement', 'Remboursement à refaire ou refusé par Stripe', null, 40),
  ('client_absent', 'Client absent à la livraison', 'Le livreur l''a signalé.', 50),
  ('reclamation', 'Réclamation d''un client', 'Envoyée depuis son suivi de commande.', 60),
  ('quota_courriels', 'E-mails : 80 % de la limite du jour', null, 70),
  ('plafond_codes', 'Codes de connexion : plafond du jour atteint', 'Clients ou équipe.', 80),
  ('adresse_bloquee', 'Adresse de l''équipe bloquée 24 heures', 'Trop de codes faux depuis une même adresse.', 90)
  on conflict (cle) do nothing;

create function types_alertes() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('cle', cle, 'libelle', libelle, 'aide', aide, 'actif', actif) order by ordre, cle), '[]'::jsonb)
  from types_alertes;
$$;

-- Un type d'alerte coupé ou remis (gérant, journalisé). Faux si la clé est inconnue.
create function regler_type_alerte(p_cle text, p_actif boolean, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  qui text := gerant_nom(p_personnel);
  avant boolean;
begin
  if p_actif is null then
    raise exception 'Oui ou non';
  end if;
  select actif into avant from types_alertes where cle = p_cle for update;
  if not found then
    return false;
  end if;
  update types_alertes set actif = p_actif, modifie_le = now() where cle = p_cle;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'type_alerte', p_cle, to_jsonb(avant), to_jsonb(p_actif));
  return true;
end;
$$;

revoke execute on function types_alertes(), regler_type_alerte(text, boolean, uuid) from public, anon, authenticated;
grant execute on function types_alertes(), regler_type_alerte(text, boolean, uuid) to service_role;
