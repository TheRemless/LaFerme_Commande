-- Plafond des commandes à payer au comptoir : 100 CHF (décision de Jérémy du 12.11.2026).
-- Au comptoir rien n'est payé avant le retrait (audit de sécurité, S5) : au-delà du plafond, paiement en ligne seulement.
-- Le site le contrôle avant d'enregistrer ; la base le revérifie ici, même si le site ne l'a pas fait.
-- Ancien code compatible : il ne lit pas ce réglage, et seule une commande au comptoir au-delà du plafond est refusée.

insert into reglages (cle, valeur, proposition) values ('plafond_comptoir_centimes', '10000', false)
on conflict (cle) do nothing;

create function verifier_plafond_comptoir() returns trigger
language plpgsql as $$
declare
  plafond numeric;
begin
  -- Lu seulement pour le comptoir : un réglage mal saisi ne bloque jamais le paiement en ligne.
  if new.moyen_paiement <> 'comptoir' then
    return new;
  end if;
  select (valeur #>> '{}')::numeric into plafond from reglages
  where cle = 'plafond_comptoir_centimes' and jsonb_typeof(valeur) = 'number';
  -- Réglage absent ou illisible : pas de comptoir.
  if plafond is null or new.total_centimes > plafond then
    raise exception 'plafond_comptoir';
  end if;
  return new;
end;
$$;

create trigger commandes_plafond_comptoir before insert on commandes
  for each row execute function verifier_plafond_comptoir();

revoke execute on function verifier_plafond_comptoir() from public, anon, authenticated;
grant execute on function verifier_plafond_comptoir() to service_role;
