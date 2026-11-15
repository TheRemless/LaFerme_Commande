-- Vague 3, client-compte : parrainage repris après un remboursement partiel (relecture #262 de qualite). Le
-- parrainage reste éteint.
-- Un filleul crédité sur une commande de CHF 30, puis remboursé de CHF 29 (plat manquant, geste) gardait les deux
-- crédits. Désormais, à chaque remboursement fait : si la commande est celle d'un parrainage crédité et que ses plats
-- nets (base_cagnotte) repassent sous le minimum, les deux crédits sont repris (reprendre_parrainage). La part qui ne
-- peut pas l'être faute de solde est retenue plus tard par rattraper_retraits (20261216190000).
--
-- Objet recréé : cagnotte_au_remboursement (20261216090000_cagnotte.sql, client-compte).

create or replace function cagnotte_au_remboursement() returns trigger
language plpgsql as $$
declare
  o commandes%rowtype;
begin
  if new.statut = 'fait' and (tg_op = 'INSERT' or old.statut is distinct from 'fait') then
    perform ajuster_gain(new.commande_id);
    select * into o from commandes where id = new.commande_id;
    if found and exists (select 1 from parrainages p where p.commande_id = o.id and p.statut = 'credite')
       and base_cagnotte(o) < parrainage_minimum() then
      perform reprendre_parrainage(o.id);
    end if;
  end if;
  return null;
end;
$$;
