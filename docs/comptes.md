# Comptes clients (lot 6)

Connexion par code e-mail à 6 chiffres, faite par le site (pas par Supabase Auth). Décision du 6.11.2026, actée dans `docs/PROMPT.md` §4.

## Parcours

- Commande toujours possible en invité. En fin de commande, la case « Créer mon compte avec cet e-mail » ; le suivi propose ensuite de recevoir et d'entrer le code. La commande est rangée dans le compte si son e-mail est celui du compte.
- Page `/compte` : e-mail, code, puis l'espace client (commandes, « recommander la même chose », adresses, coordonnées, connexion, export, suppression).
- Client connecté : coordonnées déjà remplies au passage de commande, adresses de livraison proposées à l'accueil, chaque commande rangée dans le compte, son adresse gardée (dix au plus).
- « Recommander la même chose » : contrôle contre la carte du jour. Plat retiré, en rupture ou option disparue : laissé de côté avec la raison. Prix changé : signalé. Les montants viennent toujours de la base.

## Sécurité

| Règle | Où |
|---|---|
| Données des comptes jamais lisibles sans la clé secrète : sécurité par ligne sans politique, droits retirés à `anon` et `authenticated`, accès par des fonctions SQL réservées à `service_role` | `supabase/migrations/20261108090000_comptes.sql` |
| Le serveur ne passe aux fonctions que l'identifiant du compte tiré d'une session vérifiée ; chaque fonction filtre sur ce compte | `src/lib/comptes/api.ts`, fonctions `*_compte` |
| Codes, jetons de session, e-mails des limites et IP gardés en empreinte HMAC-SHA-256 (clé `SECRET_COMPTES`, ou à défaut tirée de `SUPABASE_SECRET_KEY`) | `src/lib/comptes/securite.ts` |
| Code valable 10 minutes, usage unique, un seul code actif par e-mail, annulé après 5 essais faux, délai de 1, 2, 4 et 8 secondes entre deux essais | `verifier_code` |
| Comparaison du code en temps constant (les 32 octets de l'empreinte sont toujours parcourus) | `egal_constant` |
| Limites d'envoi : par e-mail, un code puis 30 s, 1 min, 2 min, 4 min d'attente et 5 par heure ; par IP, 20 par heure | `demander_code` |
| Limites de vérification par IP : 5 essais faux libres, puis 2 s, 4 s, 8 s… et 30 par heure | `verifier_code` |
| Aucune énumération : même réponse et même délai que l'e-mail ait un compte ou non (le compte est créé au premier bon code) | `demander_code`, `/api/compte/code` |
| Session : jeton aléatoire de 32 octets, neuf à chaque connexion (l'ancien du navigateur est fermé), cookie `__Host-` HttpOnly, Secure, SameSite=Lax, 30 jours, révocable (« me déconnecter », « déconnecter tous mes appareils ») | `src/lib/comptes/session.ts`, `deconnecter` |
| CSRF : toute route qui change un état exige l'en-tête Origin du site (ou `Sec-Fetch-Site: same-origin`) | `src/lib/comptes/origine-requete.ts` |
| E-mails normalisés (espaces retirés, minuscules), contrôle en base | `emailNormalise`, contrainte `comptes.email` |
| Journal des connexions : événement, date, huit caractères de l'empreinte de l'IP. Ni e-mail, ni code, ni jeton. Gardé six mois | `journal_connexions` |
| Le code n'est jamais gardé en base, même en copie de courriel | `envoyerCodeParCourriel` |

## Préversions sans serveur d'envoi

Aucun e-mail ne part. Le code s'affiche à l'écran seulement sur une base de test et pour une adresse en `.test` (par exemple `jeremy@laferme.test`). Une base de test, c'est la base embarquée (poste local, tests) ou un projet Supabase déclaré par `BASE_DE_TEST=1`.

Une préversion qui écrit dans la vraie base (clé secrète du projet de production) n'affiche **jamais** de code, même pour une adresse en `.test` : la connexion y attend le serveur d'envoi. Avant le 12.11.2026, n'importe qui pouvait y entrer comme gérant avec `equipe@laferme.test` (docs/audits/securite.md, S1). En production, sans serveur d'envoi, l'envoi échoue.

Limites des essais : cinq par code, cinq codes par heure et par e-mail, vingt codes par heure et trente par 24 heures par adresse IP, 150 codes de clients par 24 heures tous clients confondus (voir plus bas), quinze essais faux par jour et par e-mail (puis attente jusqu'à ce que le plus ancien ait 24 heures). Une adresse IPv6 compte pour son /64.

## nLPD

- Export : `/api/compte/export`, un fichier JSON avec le profil, les adresses, les commandes, les sessions et le journal du compte (sans les empreintes de sécurité).
- Suppression : profil, adresses, sessions, codes et journal effacés. Les commandes déjà passées restent pour la comptabilité du restaurant, détachées du compte. Point à faire valider par Jérémy et à écrire dans la déclaration de confidentialité (lot 8).

## Avant d'ouvrir les comptes à de vrais clients

- Envoi par la boîte e-mail du restaurant chez Infomaniak (décision de Jérémy du 12.11.2026, à la place de Resend). Dans Netlify, production et préversions :
  - `SMTP_UTILISATEUR` : l'adresse d'envoi complète, de préférence une adresse dédiée (par exemple `commande@<domaine>`).
  - `SMTP_MOT_DE_PASSE` : un mot de passe d'appareil créé pour le site, pas celui de la boîte. Dans Mail Infomaniak : menu à droite de l'adresse, réglages de l'adresse, mot de passe, « Ajouter un appareil », onglet de configuration IMAP/SMTP. Il ne s'affiche qu'une fois ([aide Infomaniak, 711](https://www.infomaniak.com/en/support/faq/711/manage-devices-passwords-from-mail-infomaniak)).
  - `COURRIEL_EXPEDITEUR` : le nom affiché et la même adresse, par exemple `La Ferme <commande@<domaine>>`. L'adresse d'expéditeur doit être celle de l'identifiant.
  - Facultatif : `SMTP_HOTE` (`mail.infomaniak.com` par défaut) et `SMTP_PORT` (587 avec STARTTLS par défaut, 465 admis). Réglages lus sur l'[aide Infomaniak, 2023](https://www.infomaniak.com/fr/support/faq/2023/utiliser-lenvoi-de-mail-authentifie-depuis-un-site-web-heberge-chez-infomaniak) le 12.11.2026.
- Limite d'Infomaniak : 500 e-mails par jour pour un Service Mail, « adjustable upon request » ([infomaniak.com, Service Mail](https://www.infomaniak.com/en/ksuite/service-mail/ecosystem), lu le 12.11.2026). Une adresse gratuite a une limite plus basse, chiffre non affiché : vérifier l'offre de la boîte du restaurant. Au-delà de la limite, les e-mails ne partent plus jusqu'au lendemain, codes de connexion compris.
- Quota géré par le site (vague 3, `src/lib/courriel/quota.ts`) : chaque envoi réserve une place sur 24 heures glissantes. À 80 % du plafond, les alertes au restaurant s'arrêtent et une alerte unique part. À 85 %, « prête » et « en route » s'arrêtent. À 95 %, les codes de connexion et le reste du suivi s'arrêtent : une demande de code se fabrique sans compte, une commande payée non. Seules les confirmations de commande partent jusqu'au plafond. Un e-mail refusé est noté dans l'historique de la commande (« e-mail non envoyé »). Réglages dans Netlify : `COURRIELS_PLAFOND_JOUR` (500 par défaut, à changer seulement après le relèvement chez Infomaniak) et `COURRIELS_ETAPES=1` (rétablit « acceptée », « prête » et « en route » ; sans elle, un seul e-mail à la commande, décision de Jérémy du 13.11.2026, détail dans `docs/vague-3/client-compte.md`).
- Plafond global : 150 codes de clients par 24 heures glissantes (décision de Jérémy du 12.11.2026, migration `20261123090000_plafond_codes.sql`). Il protège le quota d'envoi : sans lui, une seule adresse IP faisait partir 480 codes par jour. Au plafond, la page répond « Trop de codes demandés aujourd'hui sur le site » et aucun e-mail ne part. Les clients peuvent toujours commander sans compte, les codes de l'équipe ne sont ni comptés ni plafonnés. Une même adresse IP ne reçoit que 30 codes par 24 heures : seule, elle ne peut pas atteindre le plafond. Revers assumé : quelqu'un qui dispose de plusieurs adresses IP et atteint le plafond exprès empêche les clients de se connecter jusqu'à ce que la fenêtre glisse. Au premier refus, le restaurant reçoit une alerte par e-mail (`ALERTE_EMAIL`), une fois par 24 heures, et le journal Netlify dit « Plafond quotidien des codes de connexion des clients atteint ». Ordre de mise en place : le code d'abord (fusion de la PR), la migration ensuite. L'ancien code ne connaît pas la réponse du plafond et enverrait un code jamais enregistré. Pour le changer, dans le SQL Editor de Supabase : `update reglages set valeur = '200' where cle = 'plafond_codes_clients_jour';`
- Anti-doublon : le même e-mail d'une commande (même destinataire, même sujet, même texte) ne part pas deux fois de suite en 24 heures (un rejeu est ignoré, un retour à une heure déjà annoncée part). La copie gardée en base sert de registre (`courrielsPartis`).
- Le code du personnel part après la réponse du site (S11) : si le serveur d'envoi est en panne, la page dit quand même « envoyé » et l'échec n'apparaît que dans les journaux Netlify.
- Obligatoire en production : `SECRET_COMPTES` (32 octets aléatoires au moins, propre à la production) dans Netlify. Sans elle, le build de production échoue et le site refuse les connexions : tirée de la clé Supabase, que les préversions ont aussi, une session ouverte sur une préversion vaudrait en production. La poser avant le premier vrai client : la changer ensuite annule les codes en cours et les sessions ouvertes.

## Connexion Google ou Apple

Pas prévue. Si Jérémy la veut un jour, il faudra un ajout : soit Supabase Auth pour ces seuls fournisseurs, soit OpenID Connect directement, avec rattachement au compte de même e-mail vérifié.
