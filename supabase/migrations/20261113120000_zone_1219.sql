-- Décision de Jérémy du 12.11.2026 (rapport client mystère, CM-12) : tout le NPA 1219 est livré au tarif
-- de la zone 2, soit Le Lignon (déjà en zone 2), Châtelaine et Aïre.
-- La zone d'une adresse reste décidée par le serveur à partir de l'adresse officielle du registre fédéral
-- (src/lib/zone-serveur.ts) : rien ne change pour une adresse tapée à la main qui n'y est pas retrouvée.

insert into zone_npa (npa, localite, zone_numero)
values ('1219', 'Châtelaine', 2)
on conflict (npa, localite) do update set zone_numero = excluded.zone_numero
where zone_npa.zone_numero <> excluded.zone_numero;

-- Le Lignon et Aïre : déjà en zone 2 au départ, remis en zone 2 s'ils ont été changés depuis.
update zone_npa set zone_numero = 2
where npa = '1219' and localite in ('Le Lignon', 'Aïre', 'Châtelaine') and zone_numero <> 2;
