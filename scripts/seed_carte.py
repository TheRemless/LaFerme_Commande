"""Écrit supabase/seed.sql depuis docs/carte-proposee.json.

Chaque prix entre en base avec prix_a_valider = true (docs/PROMPT.md §5.2).
Usage : npm run seed:generer
"""
import json
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
carte = json.loads((RACINE / "docs" / "carte-proposee.json").read_text())

CATEGORIES = [
    ("Pizzas", "pizzas", "Pizzas"),
    ("Entrées", "entrees", "Entrées"),
    ("Pâtes", "pates", "Pâtes et risottos"),
    ("Poissons", "poissons", "Poissons"),
    ("Viandes", "viandes", "Viandes"),
    ("Desserts", "desserts", "Desserts"),
    ("Boissons", "boissons", "Boissons"),
]
GROUPES = {"g1": "supplements-pizza", "g2": "choix-pates"}


def q(texte):
    if texte is None:
        return "null"
    return "'" + str(texte).replace("'", "''") + "'"


def tableau(valeurs):
    return "array[" + ", ".join(q(v) for v in valeurs) + "]::text[]" if valeurs else "'{}'::text[]"


def centimes(chf):
    return round(chf * 100)


def provenance_affichee(connues):
    # La source « (carte de la salle…) » sert à Jérémy, pas au client.
    return "\n".join(t.split(" (")[0] for t in connues) or None


lignes = [
    "-- Généré par scripts/seed_carte.py depuis docs/carte-proposee.json. Ne pas modifier à la main.",
    "-- Tous les prix sont des propositions (prix_a_valider = true).",
    "",
]
for ordre, (_, slug, nom) in enumerate(CATEGORIES, 1):
    lignes.append(f"insert into categories (slug, nom, ordre) values ({q(slug)}, {q(nom)}, {ordre});")

for cle, slug in GROUPES.items():
    g = carte["groupes"][cle]
    lignes.append(
        f"insert into groupes_options (slug, nom, choix_min, choix_max) values ({q(slug)}, {q(g['groupe'])}, {g['min']}, {g['max']});"
    )
    for ordre, c in enumerate(g["choix"], 1):
        lignes.append(
            "insert into options (groupe_id, nom, prix_centimes, ordre) "
            f"select id, {q(c['nom'])}, {centimes(c['prix'])}, {ordre} from groupes_options where slug = {q(slug)};"
        )

slug_categorie = {cat: slug for cat, slug, _ in CATEGORIES}
for cat, _, _ in CATEGORIES:
    # Plats avec photo en tête de chaque catégorie, en attendant le classement par ventes réelles.
    plats = [p for p in carte["plats"] if p["categorie"] == cat]
    plats.sort(key=lambda p: p["photo"] is None)
    for ordre, p in enumerate(plats, 1):
        lignes.append(
            "insert into plats (slug, categorie_id, nom, description, prix_centimes, station, photo, ordre, provenance, provenances_a_fournir) "
            f"select {q(p['id'])}, id, {q(p['nom'])}, {q(p['descriptionSite'])}, {centimes(p['prixPropose'])}, {q(p['station'])}, "
            f"{q(p['photo'] + '.jpg' if p['photo'] else None)}, {ordre}, {q(provenance_affichee(p['provenancesConnues']))}, "
            f"{tableau(p['provenancesManquantes'])} from categories where slug = {q(slug_categorie[cat])};"
        )
        for g_ordre, cle in enumerate(p["groupes"], 1):
            lignes.append(
                "insert into plat_groupes (plat_id, groupe_id, ordre) "
                f"select p.id, g.id, {g_ordre} from plats p, groupes_options g where p.slug = {q(p['id'])} and g.slug = {q(GROUPES[cle])};"
            )
        for r_ordre, r in enumerate(p["retraits"], 1):
            lignes.append(
                f"insert into plat_retraits (plat_id, nom, ordre) select id, {q(r)}, {r_ordre} from plats where slug = {q(p['id'])};"
            )

(RACINE / "supabase" / "seed.sql").write_text("\n".join(lignes) + "\n")
print(f"supabase/seed.sql : {len(carte['plats'])} plats")
