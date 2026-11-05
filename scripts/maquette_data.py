"""Écrit maquette/data.js depuis docs/carte-proposee.json, sans les mentions « maison » non confirmées.
Usage : python3 -I scripts/maquette_data.py
"""
import json
import re
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
carte = json.loads((RACINE / "docs" / "carte-proposee.json").read_text())
GARDER = ["id", "categorie", "nom", "description", "prixPropose", "station", "groupes", "retraits", "provenancesConnues", "provenancesManquantes", "photo"]


def sans_maison(texte):
    # docs/PROMPT.md §5.4 : « fait maison » interdit tant que Jérémy ne l'a pas confirmé.
    texte = re.sub(r"(?i)\bfait maison\.?", "", texte)
    texte = re.sub(r"(?i)\s*\bmaison\b", "", texte)
    return texte.strip()


plats = []
for p in carte["plats"]:
    q = {k: p[k] for k in GARDER}
    q["description"] = sans_maison(q["description"])
    plats.append(q)
sortie = {"groupes": carte["groupes"], "plats": plats}
(RACINE / "maquette" / "data.js").write_text(
    "// Généré par scripts/maquette_data.py. Prix proposés, tous à valider.\nwindow.CARTE = " + json.dumps(sortie, ensure_ascii=False) + ";\n"
)
