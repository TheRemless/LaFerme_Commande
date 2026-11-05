"""Écrit maquette/data.js depuis docs/carte-proposee.json, avec les descriptions sans « maison » (champ descriptionSite).
Usage : python3 -I scripts/maquette_data.py
"""
import json
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
carte = json.loads((RACINE / "docs" / "carte-proposee.json").read_text())
GARDER = ["id", "categorie", "nom", "description", "prixPropose", "station", "groupes", "retraits", "provenancesConnues", "provenancesManquantes", "photo"]


plats = []
for p in carte["plats"]:
    q = {k: p[k] for k in GARDER}
    q["description"] = p["descriptionSite"]
    plats.append(q)
sortie = {"groupes": carte["groupes"], "plats": plats}
(RACINE / "maquette" / "data.js").write_text(
    "// Généré par scripts/maquette_data.py. Prix proposés, tous à valider.\nwindow.CARTE = " + json.dumps(sortie, ensure_ascii=False) + ";\n"
)
