"""Construit docs/carte-proposee.json à partir du relevé Uber croisé avec la carte de la salle.

Corrige à la main les associations fausses ou manquantes du croisement automatique
(docs/PROMPT.md §5). Tous les prix restent « à valider » par Jérémy.
Usage : python3 -I scripts/carte_proposee.py
"""
import json
import re
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
RECHERCHE = RACINE / "docs" / "recherche"

# Associations revues le 5.11.2026 contre la carte de la salle (Site_LaFerme/src/_data/carte.json).
# nom Uber -> (nom salle, prix salle, fiabilité, remarque)
CORRECTIONS = {
    "Pizza Romana": ("Romana", 23, "sûre", "Le croisement automatique l'avait associée aux gnocchi alla romana (26), c'est faux"),
    "Gnocchi pommes de terre": ("Gnocchi alla sorrentina", 25, "probable", "Uber : crème de tomate gratinée à la mozzarella, salle : sauce tomate, crème, gratinés à la mozzarella. Le croisement automatique proposait alla romana (26)"),
    "Gnocchi alla romana": ("Gnocchi alla romana", 26, "sûre", "Même garniture des deux côtés"),
    "Gnocchi au Gorgonzola": ("Gnocchi au gorgonzola", 26, "sûre", ""),
    "Pasta aux crevettes": ("Pennette aux crevettes et scampis au parfum de curry", 28, "probable", "Uber propose des pâtes au choix, la salle des pennette"),
    "Pasta aglio": ("Spaghettini aglio, olio e peperoncino", 21, "sûre", ""),
    "Risotto noix de Saint Jacques": ("Risotto noix de Saint-Jacques et gambas safranées", 34, "sûre", ""),
    "Burrata, tomates et mortadella": ("Burrata, mortadella, tomate et rucola", 24, "probable", "La salle ajoute la rucola"),
    "Salade de chèvre chaud": ("Salade de chèvre chaud façon Malakoff au miel", 32, "sûre", ""),
    "Terrine de foie gras de canard": ("Terrine de foie de canard et son chutney de figues", 30, "probable", "Uber dit foie gras, la salle dit foie de canard, avec chutney de figues"),
    "Lasagne de bœuf": ("Lasagne de bœuf", 27, "sûre", "Score bas à cause du nom de groupe, l'association est juste"),
    "Linguine au saumon fumé": ("Linguine au saumon fumé, safran, crème", 28, "sûre", "Score bas à cause du nom de groupe, l'association est juste"),
    "Pasta bolognaise": ("Spaghettini bolognese", 25, "sûre", ""),
    "Panzerotti aux épinards": ("Panzerotti ricotta et épinards", 26, "sûre", ""),
    "Cheeseburger de bœuf": (None, None, "aucune", "Pas sur la carte de la salle. Le « Burger maison gourmand » (29) est un autre plat"),
}
SANS_SALLE = {"Boissons": "Boissons sur une carte séparée, sans prix connu", "Desserts": "Desserts sur une carte séparée, sans prix connu"}

PHOTOS = {
    "Pizza Margherita": "margherita", "Pizza miss Italia": "missitalia", "Pizza prosciutto": "prosciuto",
    "Pizza 4 Stagioni": "4saison", "Pizza végétarienne": "vegetarienne", "Pizza melanzana": "melanzana",
    "Rigatoni alla peppino": "rigatoniallapeppino", "Paccheri alla norma": "paccheriallanorma",
    "Lasagne de bœuf": "lasagne", "Pasta al pesto": "spaghettialpesto",
    "Linguine aux fruits de mer": "linguineaifruttidimare", "Tartare de bœuf": "tartare",
    "Cheeseburger de bœuf": "cheeseburger", "Chiacchiere alla Nutella": "chiacchiere",
    "Tiramisu": "tiramisu", "Panna cotta": "pannacotta",
}

# Provenances écrites sur la carte de la salle (notes des sections Poissons et Viandes).
# mot de la description -> provenance connue, ou None s'il faut la demander.
VIANDES_POISSONS = [
    (r"\bb(œ|oe)uf\b|polpette|boulettes|bolognaise|bolognese", "Bœuf : Suisse ou Autriche (carte de la salle)"),
    (r"\bporc\b", "Porc : Suisse ou Autriche (carte de la salle)"),
    (r"perches", "Perches : Estonie (carte de la salle)"),
    (r"gambas|scampis|crevettes", "Gambas : Vietnam (carte de la salle, à confirmer pour les crevettes et scampis)"),
    (r"vongole", "Vongole : Italie (carte de la salle)"),
    (r"saumon", "Saumon : Norvège (carte de la salle, à confirmer pour le saumon fumé)"),
    (r"canard|foie", "Canard : France (carte de la salle)"),
    (r"poulet", None), (r"thon|tonno", None), (r"jambon|prosciutto|parma", None),
    (r"mortadel", None), (r"lardons|carbonara|amatriciana", None), (r"saucisson|salsiccia|saucisse|salami|calabrese|diavola", None),
    (r"bresaola", None), (r"homard", None), (r"fruits de mer|frutti", None), (r"calamar", None),
    (r"saint.?jacques", None), (r"anchois|mollica|napoletana", None),
]
NOMS_MANQUANTS = {
    "poulet": "poulet", "thon|tonno": "thon", "jambon|prosciutto|parma": "jambon", "mortadel": "mortadelle",
    "lardons|carbonara|amatriciana": "lardons", "saucisson|salsiccia|saucisse|salami|calabrese|diavola": "charcuterie",
    "bresaola": "bresaola", "homard": "homard", "fruits de mer|frutti": "fruits de mer", "calamar": "calamars",
    "saint.?jacques": "Saint-Jacques", "anchois|mollica|napoletana": "anchois",
}


def provenances(texte):
    t = texte.lower()
    connues, manquantes = [], []
    for motif, prov in VIANDES_POISSONS:
        if re.search(motif, t):
            if prov:
                if prov not in connues:
                    connues.append(prov)
            else:
                nom = NOMS_MANQUANTS[motif]
                if nom not in manquantes:
                    manquantes.append(nom)
    return connues, manquantes


def retraits(plat):
    if plat["c"] != "Pizzas":
        return []
    d = plat["d"].rstrip(".")
    morceaux = re.split(r",\s*|\s+et\s+", d)
    return [m.strip()[0].upper() + m.strip()[1:] for m in morceaux if m.strip()]


def sans_maison(texte):
    # docs/PROMPT.md §5.4 : « fait maison » interdit tant que Jérémy ne l'a pas confirmé.
    texte = re.sub(r"(?i)\bfait maison\.?", "", texte)
    texte = re.sub(r"(?i)\s*\bmaison\b", "", texte)
    return texte.strip()


def slug(texte):
    t = texte.lower()
    for a, b in (("œ", "oe"), ("à", "a"), ("â", "a"), ("é", "e"), ("è", "e"), ("ê", "e"), ("ï", "i"), ("î", "i"), ("ô", "o"), ("ç", "c"), ("’", ""), ("'", "")):
        t = t.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def main():
    brut = json.loads((RECHERCHE / "carte-uber-brute.json").read_text())
    croisee = json.loads((RECHERCHE / "carte-croisee.json").read_text())
    plats = []
    for p in croisee:
        nom = p["n"]
        if nom in CORRECTIONS:
            salle_nom, prix_salle, fiab, remarque = CORRECTIONS[nom]
        elif p["c"] in SANS_SALLE:
            salle_nom, prix_salle, fiab, remarque = None, None, "aucune", SANS_SALLE[p["c"]]
        elif p.get("prixSalle") is not None and p["score"] >= 0.9:
            salle_nom, prix_salle, fiab, remarque = p["salleNom"].split(" / ")[-1], p["prixSalle"], "sûre", ""
        else:
            raise SystemExit(f"Association non revue : {nom} ({p.get('score')})")
        connues, manquantes = provenances(nom + " " + p["d"])
        plats.append({
            "id": slug(nom),
            "categorie": p["c"],
            "nom": nom,
            "description": p["d"],
            "descriptionSite": sans_maison(p["d"]),
            "prixUber": p["prixUber"],
            "salleNom": salle_nom,
            "prixSalle": prix_salle,
            "fiabilite": fiab,
            "remarque": remarque,
            "prixPropose": prix_salle if prix_salle is not None else p["prixUber"],
            "sourcePrix": "salle" if prix_salle is not None else "uber",
            "prixAValider": True,
            "station": "pizza" if p["c"] == "Pizzas" or nom.startswith("Chiacchiere") else "comptoir" if p["c"] == "Boissons" else "cuisine",
            "groupes": p.get("o", []),
            "retraits": retraits(p),
            "provenancesConnues": connues,
            "provenancesManquantes": manquantes,
            "photo": PHOTOS.get(nom),
            "faitMaisonSurUber": "fait maison" in p["d"].lower(),
        })
    sortie = {
        "source": "Relevé Uber Eats du 5.11.2026 croisé avec la carte de la salle, revu le 5.11.2026. Tous les prix sont à valider.",
        "groupes": brut["groupes"],
        "plats": plats,
    }
    (RACINE / "docs" / "carte-proposee.json").write_text(json.dumps(sortie, ensure_ascii=False, indent=1))
    sans_prix = [x["nom"] for x in plats if x["prixSalle"] is None]
    print(f"{len(plats)} plats, {len(plats) - len(sans_prix)} avec prix de salle, {len(sans_prix)} sans : {', '.join(sans_prix)}")


if __name__ == "__main__":
    main()
