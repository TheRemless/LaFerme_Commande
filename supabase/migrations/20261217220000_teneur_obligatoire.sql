-- Teneur en alcool obligatoire pour vendre une boisson (bo-carte ; proposition de client-compte, accord du chef du
-- 19.11.2026). Sans teneur, une boisson se vendrait au taux réduit : un vin saisi sans teneur serait sous-déclaré une
-- fois la compta à deux taux en marche (compta_multi_taux_pret, 20261217150000). 0 est admis (sans alcool). Aucune
-- teneur n'est posée d'office : c'est au restaurant de la saisir (fiche du plat, « Teneur en alcool »).
--
-- 1. garde_alcool() (20261217150000) refuse aussi de mettre en vente une boisson sans teneur (teneur_a_saisir), et
--    se déclenche aussi quand un plat change de catégorie.
-- 2. motifs_plat (20261217150000) : motif « teneur en alcool à saisir » pour une boisson sans teneur. Il apparaît
--    dans la fiche, dans la liste des plats bloquants (plats_bloquants, mise en route) et bloque la mise en ligne.
-- Les boissons déjà en vente sans teneur le restent (aucun UPDATE ici) : elles bloquent la mise en ligne tant que la
-- teneur n'est pas saisie. Un plat créé au back-office dans Boissons naît hors de la vente tant qu'elle manque
-- (ajouter_plat ne met en vente qu'un plat sans motif).
-- 3. La compta à deux taux est prête : compta_multi_taux_pret passe à vrai (accord avec bo-pilotage du 19.11.2026).
--    À appliquer APRÈS la #276 de bo-pilotage, dont les lecteurs (récap, Crésus simple, synthèse, clôture) suivent la
--    ventilation par taux. Rien n'est mis en vente ici : une boisson alcoolisée reste à poser par le gérant (Jérémy
--    décide), avec sa teneur.

create or replace function garde_alcool() returns trigger
language plpgsql as $$
begin
  if new.commandable and new.teneur_alcool is null
     and exists (select 1 from categories c where c.id = new.categorie_id and c.slug = 'boissons') then
    raise exception 'teneur_a_saisir';
  end if;
  if new.commandable and categorie_tva(new.teneur_alcool) = 'normal' and not alcool_compta_prete() then
    raise exception 'alcool_compta_pas_prete';
  end if;
  return new;
end;
$$;
drop trigger garde_alcool on plats;
create trigger garde_alcool before insert or update of commandable, teneur_alcool, categorie_id on plats
  for each row execute function garde_alcool();

-- Même définition que 20261217150000_tva_par_plat.sql, + le motif 7.
create or replace function motifs_plat(p_id uuid) returns text[]
language sql stable as $$
  select coalesce(array_agg(x.motif order by x.rang, x.motif), '{}')
  from (
    select 1 as rang, 'prix à valider' as motif from plats p where p.id = p_id and p.prix_a_valider
    union all
    select 2, 'allergènes manquants' from plats p where p.id = p_id and coalesce(p.allergenes, '') = ''
    union all
    select 3, 'provenance à fournir' from plats p where p.id = p_id and cardinality(p.provenances_a_fournir) > 0
    union all
    select distinct 4, 'supplément à valider : ' || o.nom
    from plat_groupes g join options o on o.groupe_id = g.groupe_id and o.actif and o.prix_a_valider
    where g.plat_id = p_id
    union all
    select 5, 'retraits à valider' where exists (select 1 from plat_retraits r where r.plat_id = p_id and r.a_valider)
    union all
    select 6, 'boisson alcoolisée : la compta à deux taux n''est pas prête'
    from plats p where p.id = p_id and categorie_tva(p.teneur_alcool) = 'normal' and not alcool_compta_prete()
    union all
    select 7, 'teneur en alcool à saisir (0 pour une boisson sans alcool)'
    from plats p join categories c on c.id = p.categorie_id where p.id = p_id and c.slug = 'boissons' and p.teneur_alcool is null
  ) x;
$$;

-- 3. Compta à deux taux prête (après la #276 de bo-pilotage).
update reglages set valeur = 'true' where cle = 'compta_multi_taux_pret';
