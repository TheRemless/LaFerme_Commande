# bo-socle : coque, kit, accueil, droits et connexion de l'équipe (vague 3)

Ce que `bo-socle` a construit, pour l'équipe et pour les autres sessions. Le kit a son propre mode d'emploi : `docs/vague-3/kit-back-office.md`.

## Codes de connexion de l'équipe

- **Plafond global sur 24 heures** (migration `20261210160000_plafond_codes_equipe.sql`). Il est **désactivé** tant que Jérémy n'a pas donné la valeur : le réglage `plafond_codes_personnel_jour` est absent. Une fois activé, au plafond, le site ne crée plus de code pour l'équipe. Il répond comme pour une adresse inconnue et prévient le restaurant une fois par 24 heures. Ce compteur est séparé de celui des clients (150 par jour) : un client ne peut jamais bloquer la connexion de l'équipe. Une fois activé, une adresse ne peut prendre qu'un quart du plafond sur 24 heures et une IP la moitié. Pour couper toute l'équipe, il faut donc au moins quatre adresses connues. Les appareils déjà connectés restent connectés. Pour l'activer :
  `insert into reglages (cle, valeur, proposition) values ('plafond_codes_personnel_jour', '<nombre>', false) on conflict (cle) do update set valeur = excluded.valeur, proposition = false;`
- **Adresse bloquée après 15 codes faux** : si la limite d'envoi du jour refuse le courriel au membre, l'alerte au restaurant part quand même. Elle précise que le membre n'a rien reçu.
- Tests : `tests/unit/codes-equipe.test.ts`.

## Recherche globale (⌘K)

Le bouton « Recherche » de l'en-tête, ou ⌘K sur Mac et Ctrl+K sur PC. Il trouve :
- une commande par son numéro, le nom ou le téléphone du client ;
- un client par son nom ou son téléphone ;
- un plat ;
- une rubrique par son nom ou ce qu'on y fait.

Les flèches choisissent, Entrée ouvre, Échap ferme. Le texte cherché part en POST (`/api/gestion/recherche`, gérant seulement) et n'apparaît jamais dans l'adresse. La recherche ne refait aucune requête : elle demande cinq résultats aux listes de `bo-commandes` (`liste_commandes_gestion`, `clients_gestion`) et au catalogue. La fiche visée s'ouvre en arrivant sur la rubrique par `useOuverture` (kit) : Commandes, Clients et Carte doivent l'appeler pour leurs fiches.
