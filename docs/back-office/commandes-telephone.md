# Commandes au téléphone et adresse dans une autre zone (vague 3, bo-commandes)

Deux fonctions construites complètes et **désactivées par défaut** : chacune attend une décision de Jérémy. Base et serveur seulement, l'écran viendra avec le kit du back-office (boutons de la fiche d'une commande).

## Recréer une commande à partir d'une autre

Le client appelle : « la même que vendredi », ou une commande annulée à refaire. Action `recreer` de `/api/gestion/commandes` (gérant), serveur `src/lib/recreer-commande.ts`, migration `supabase/migrations/20261127150000_recreer_commande.sql`, tests `tests/unit/recreer-commande.test.ts`.

- **Réglage** `commande_telephone_active` (faux par défaut). L'activer : `update reglages set valeur = 'true', proposition = false where cle = 'commande_telephone_active';`
- **Ce qui est créé** : une commande à emporter, payée au comptoir, aux prix du jour, avec les mêmes plats, options, retraits et notes, au nom, au téléphone et à l'e-mail de la commande d'origine. Elle arrive sur la tablette « à accepter » comme les autres, et le client reçoit la confirmation par e-mail.
- **Contrôles** : les mêmes qu'une commande du site (plat encore en vente, options valables, plafond du paiement au comptoir, heure possible, plat du jour, capacité du créneau en base). Un plat retiré bloque, avec son nom.
- **Traces** : « recréée en n° X » sur la commande d'origine, « recréée depuis n° Y du JJ.MM.AAAA » sur la nouvelle, et une ligne au journal (`commande_recreee`). Une clé envoyée par l'écran empêche un double appui de créer deux commandes.
- **Pas fait** : une livraison au téléphone (il faudrait faire payer en ligne, par un lien de paiement : autre décision).

## Adresse dans une autre zone (D4)

Complément de « modifier une commande acceptée ». Migration `supabase/migrations/20261211090000_modifier_autre_zone.sql` (recrée `modifier_commande`), tests `tests/unit/modifier-autre-zone-sql.test.ts`.

- **Réglage** `modification_autre_zone` (faux par défaut). L'activer : `update reglages set valeur = 'true', proposition = false where cle = 'modification_autre_zone';`
- **Permis** seulement si les frais de la nouvelle zone ne dépassent pas ceux déjà payés et si le sous-total atteint son minimum. Les frais payés restent : le restaurant garde l'écart, rien n'est à encaisser ni à rembourser.
- **Refusé** dans tous les autres cas (zone plus chère, minimum pas atteint, réglage éteint) : « annulez et faites recommander ».
