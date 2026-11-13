# Sources des ébauches légales (lot 8b)

Pages officielles lues le 8 novembre 2026. Les ébauches (`/mentions-legales`, `/cgv`, `/confidentialite`) sont à faire relire par un professionnel avant toute mise en ligne. Elles restent bloquées en production tant que la variable `PAGES_LEGALES_VALIDEES` ne vaut pas `1`.

## Obligations

Voir `docs/recherche/obligations_legales.md` (LCD art. 3 al. 1 let. s et art. 8, LTVA, OIP, ODAlOUs, OIDAl, nLPD art. 9, 12, 16 et 19, LTGVEAT).

## Prestataires

| Prestataire | Fait retenu | Source |
|---|---|---|
| Netlify | Netlify, Inc., 101 2nd Street, San Francisco, CA 94105. Certifié Swiss-U.S. DPF, clauses contractuelles types (décision 2021/914) au besoin | [netlify.com/privacy](https://www.netlify.com/privacy/), « Last updated: November 4, 2026 » |
| Netlify | Fonctions des nouveaux sites en `cmh` (Ohio) par défaut. Francfort (`fra`) au choix, « available on all Pro and Enterprise plans » | [docs.netlify.com, Functions optional configuration](https://docs.netlify.com/functions/optional-configuration/) |
| Netlify | Accord de traitement (DPA) : page en 404, contenu non vérifié | — |
| Stripe | Contractant pour la Suisse : Stripe Payments Europe, Limited (Stripe Payments UK Ltd en plus selon les conditions de service). Pays de Stripe Payments Europe non affiché sur la page | [stripe.com/ch/legal/ssa](https://stripe.com/ch/legal/ssa), « Last modified: September 28, 2026 » |
| Stripe | Stripe, Inc. certifié Swiss-U.S. DPF ; clauses contractuelles types de l'UE | [stripe.com/ch/privacy](https://stripe.com/ch/privacy), 16 janvier 2026 |
| Infomaniak (remplace Resend depuis le 12.11.2026) | Infomaniak Network SA, Rue Eugène-Marziano 25, 1227 Les Acacias (GE), Suisse. Sociétés du groupe « toutes établies en Suisse ». Lieu d'hébergement des e-mails et accord de traitement : non lus, à vérifier par le relecteur | [infomaniak.com, politique de confidentialité](https://www.infomaniak.com/fr/cgv/politique-de-confidentialite), lue le 12.11.2026 |
| Supabase | Région `eu-central-2` = Zurich. Contractant Supabase Pte. Ltd, Singapour. Clauses types avec avenant suisse (PFPDT compétent). Données « stored and primarily Processed » dans la région choisie | [supabase.com/docs/guides/platform/regions](https://supabase.com/docs/guides/platform/regions), [supabase.com/legal/dpa](https://supabase.com/legal/dpa) (1.8.2026) |
| Swiss-U.S. DPF | Le Conseil fédéral reconnaît une protection adéquate pour les entreprises américaines certifiées, en vigueur le 15 septembre 2024 | [admin.ch, communiqué du 14.08.2024](https://www.admin.ch/de/nsb?id=102054), [edoeb.admin.ch](https://www.edoeb.admin.ch/de/20240815-swiss-us-dpf) |

## Ce que les ébauches ne savent pas encore (à fournir)

- Adresse e-mail du restaurant (exigée par la LCD). Fournis le 13.11.2026 et écrits dans les trois pages : raison sociale Restaurant La Ferme Sàrl, société à responsabilité limitée, IDE CHE-103.250.692 (extrait du registre du commerce de Genève du 13.11.2026), TVA CHE-103.250.692 TVA (registre IDE fédéral, uid.admin.ch, lu le 13.11.2026, assujettissement depuis le 1.1.2016).
- Durée de conservation des commandes (avec la fiduciaire).
- Absence du client à la livraison, annulation avant acceptation, for juridique.
- Absence du client à la livraison, règle décidée par Jérémy le 12.11.2026 et appliquée par le site (PR #35) : la livraison est close sans remboursement automatique, le client reçoit un e-mail « commande non remise », le gérant décide au cas par cas d'un remboursement total, partiel ou d'aucun depuis le back-office. Les CGV (`src/lib/legal/cgv.ts`, paragraphe entre crochets sur l'absence du client) doivent décrire ce cas avant la mise en ligne, à faire relire par la fiduciaire.
- Contrats de traitement (DPA) signés avec chaque prestataire, et région des fonctions Netlify (Francfort avec le plan Pro).
