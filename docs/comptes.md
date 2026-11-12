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

## Préversions sans Resend

Aucun e-mail ne part. Le code s'affiche à l'écran seulement sur une base de test et pour une adresse en `.test` (par exemple `jeremy@laferme.test`). Une base de test, c'est la base embarquée (poste local, tests) ou un projet Supabase déclaré par `BASE_DE_TEST=1`.

Une préversion qui écrit dans la vraie base (clé secrète du projet de production) n'affiche **jamais** de code, même pour une adresse en `.test` : la connexion y attend Resend. Avant le 12.11.2026, n'importe qui pouvait y entrer comme gérant avec `equipe@laferme.test` (docs/audits/securite.md, S1). En production, sans Resend, l'envoi échoue.

Limites des essais : cinq par code, cinq codes par heure et par e-mail, quinze essais faux par jour et par e-mail (puis attente jusqu'à ce que le plus ancien ait 24 heures). Une adresse IPv6 compte pour son /64.

## nLPD

- Export : `/api/compte/export`, un fichier JSON avec le profil, les adresses, les commandes, les sessions et le journal du compte (sans les empreintes de sécurité).
- Suppression : profil, adresses, sessions, codes et journal effacés. Les commandes déjà passées restent pour la comptabilité du restaurant, détachées du compte. Point à faire valider par Jérémy et à écrire dans la déclaration de confidentialité (lot 8).

## Avant d'ouvrir les comptes à de vrais clients

- Compte Resend avec un domaine d'envoi vérifié, puis `RESEND_API_KEY` et `COURRIEL_EXPEDITEUR` dans Netlify (production et préversions).
- Obligatoire en production : `SECRET_COMPTES` (32 octets aléatoires au moins, propre à la production) dans Netlify. Sans elle, le build de production échoue et le site refuse les connexions : tirée de la clé Supabase, que les préversions ont aussi, une session ouverte sur une préversion vaudrait en production. La poser avant le premier vrai client : la changer ensuite annule les codes en cours et les sessions ouvertes.

## Connexion Google ou Apple

Pas prévue. Si Jérémy la veut un jour, il faudra un ajout : soit Supabase Auth pour ces seuls fournisseurs, soit OpenID Connect directement, avec rattachement au compte de même e-mail vérifié.
