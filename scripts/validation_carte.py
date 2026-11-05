"""Produit docs/validation-carte.xlsx à partir de docs/carte-proposee.json (docs/PROMPT.md §5).
Usage : python3 scripts/validation_carte.py
"""
import json
from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

RACINE = Path(__file__).resolve().parent.parent
carte = json.loads((RACINE / "docs" / "carte-proposee.json").read_text())

POLICE = "Arial"
GRAS = Font(name=POLICE, bold=True)
NORMAL = Font(name=POLICE)
TITRE = Font(name=POLICE, bold=True, size=14)
ENTETE_FOND = PatternFill("solid", fgColor="E7E4E0")
A_REMPLIR = PatternFill("solid", fgColor="FFF2B3")
FILET = Border(bottom=Side(style="thin", color="C9C4BE"))
HAUT = Alignment(vertical="top", wrap_text=True)
CHF = '0.00;-0.00;"-"'

wb = Workbook()

# ---------- Carte ----------
ws = wb.active
ws.title = "Carte"
colonnes = [
    ("Catégorie", 11), ("Nom", 30), ("Description", 44), ("Prix Uber (CHF)", 11), ("Prix salle proposé (CHF)", 12),
    ("Écart salle - Uber (CHF)", 11), ("Prix validé (CHF)", 11), ("Commandable (oui/non)", 13), ("Station (pizza/cuisine)", 12),
    ("Provenance", 38), ("Allergènes", 30), ("Plat de la salle associé", 34), ("Association", 11), ("Remarque", 46), ("Retraits gratuits proposés", 46),
]
for i, (titre, larg) in enumerate(colonnes, 1):
    c = ws.cell(row=1, column=i, value=titre)
    c.font = GRAS
    c.fill = ENTETE_FOND
    c.alignment = Alignment(vertical="center", wrap_text=True)
    ws.column_dimensions[c.column_letter].width = larg
ws.row_dimensions[1].height = 44

for r, p in enumerate(carte["plats"], 2):
    remarques = [p["remarque"]] if p["remarque"] else []
    if p["faitMaisonSurUber"] or "maison" in (p["salleNom"] or "").lower():
        remarques.append("Uber ou la carte de la salle dit « maison » : à confirmer avant de l'écrire")
    if p["categorie"] == "Desserts" and p["nom"].startswith("Chiacchiere"):
        remarques.append("Station pizza proposée : pâte à pizza frite")
    prov = "; ".join(p["provenancesConnues"])
    if p["provenancesManquantes"]:
        prov = (prov + "; " if prov else "") + "À fournir : " + ", ".join(p["provenancesManquantes"])
    valeurs = [
        p["categorie"], p["nom"], p["description"], p["prixUber"], p["prixSalle"],
        f'=IF(E{r}="","",E{r}-D{r})', None, None, p["station"], prov or None, None,
        p["salleNom"], p["fiabilite"], " ".join(remarques) or None, ", ".join(p["retraits"]) or None,
    ]
    for col, v in enumerate(valeurs, 1):
        c = ws.cell(row=r, column=col, value=v)
        c.font = NORMAL
        c.alignment = HAUT
        c.border = FILET
        if col in (4, 5, 6, 7):
            c.number_format = CHF
        if col in (7, 8, 9, 10, 11):
            c.fill = A_REMPLIR
derniere = len(carte["plats"]) + 1

oui_non = DataValidation(type="list", formula1='"oui,non"', allow_blank=True)
station = DataValidation(type="list", formula1='"pizza,cuisine"', allow_blank=True)
prix = DataValidation(type="decimal", operator="between", formula1="0", formula2="500", allow_blank=True,
                      error="Un prix en francs, par exemple 18 ou 4.50", errorTitle="Prix")
for dv, plage in ((oui_non, f"H2:H{derniere}"), (station, f"I2:I{derniere}"), (prix, f"G2:G{derniere}")):
    ws.add_data_validation(dv)
    dv.add(plage)
ws.freeze_panes = "C2"
ws.auto_filter.ref = f"A1:O{derniere}"
ws["E1"].comment = Comment("Prix lu sur la carte de la salle (ancien site Wix, Site_LaFerme/src/_data/carte.json). Vide quand le plat n'y figure pas.", "Claude")
ws["D1"].comment = Comment("Relevé de la page Uber Eats du restaurant le 5.11.2026.", "Claude")

# ---------- Suppléments ----------
ss = wb.create_sheet("Suppléments pizza")
for i, (titre, larg) in enumerate([("Supplément", 24), ("Prix Uber (CHF)", 14), ("Prix validé (CHF)", 14), ("Proposé sur le site (oui/non)", 16)], 1):
    c = ss.cell(row=1, column=i, value=titre)
    c.font, c.fill, c.alignment = GRAS, ENTETE_FOND, Alignment(wrap_text=True, vertical="center")
    ss.column_dimensions[c.column_letter].width = larg
for r, s in enumerate(carte["groupes"]["g1"]["choix"], 2):
    for col, v in enumerate([s["nom"], s["prix"], None, None], 1):
        c = ss.cell(row=r, column=col, value=v)
        c.font, c.border = NORMAL, FILET
        if col in (2, 3):
            c.number_format = CHF
        if col in (3, 4):
            c.fill = A_REMPLIR
fin_s = len(carte["groupes"]["g1"]["choix"]) + 1
dv2 = DataValidation(type="list", formula1='"oui,non"', allow_blank=True)
ss.add_data_validation(dv2)
dv2.add(f"D2:D{fin_s}")
ss.cell(row=fin_s + 2, column=1, value="Sur Uber, 5 suppléments au plus par pizza. Même règle sur le site ?").font = GRAS
ss.cell(row=fin_s + 3, column=1, value="Nombre maximum validé :").font = NORMAL
ss.cell(row=fin_s + 3, column=2).fill = A_REMPLIR
ss.cell(row=fin_s + 4, column=1, value="Source des prix : page Uber Eats du 5.11.2026, seule source connue.").font = Font(name=POLICE, italic=True)
ss.freeze_panes = "A2"

# ---------- Choix des pâtes ----------
sp = wb.create_sheet("Choix des pâtes")
for i, (titre, larg) in enumerate([("Pâtes au choix", 22), ("Supplément Uber (CHF)", 14), ("Supplément validé (CHF)", 14)], 1):
    c = sp.cell(row=1, column=i, value=titre)
    c.font, c.fill, c.alignment = GRAS, ENTETE_FOND, Alignment(wrap_text=True, vertical="center")
    sp.column_dimensions[c.column_letter].width = larg
for r, s in enumerate(carte["groupes"]["g2"]["choix"], 2):
    for col, v in enumerate([s["nom"], s["prix"], None], 1):
        c = sp.cell(row=r, column=col, value=v)
        c.font, c.border = NORMAL, FILET
        if col > 1:
            c.number_format = CHF
        if col == 3:
            c.fill = A_REMPLIR
sp.cell(row=5, column=1, value="Choix obligatoire sur les plats « Pasta … » d'Uber. La carte de la salle sert ces plats en spaghettini ou pennette : d'autres pâtes à proposer ?").font = NORMAL

# ---------- Lisez-moi ----------
lm = wb.create_sheet("Lisez-moi", 0)
lm.column_dimensions["A"].width = 48
lm.column_dimensions["B"].width = 16
for col in "CDEFG":
    lm.column_dimensions[col].width = 14
lignes = [
    ("Carte du site de commande : à valider par Jérémy", TITRE),
    ("Base : les 80 articles de la page Uber Eats relevée le 5.11.2026, avec le prix de la salle quand le plat existe sur la carte de la salle.", NORMAL),
    ("Remplir seulement les cases jaunes. Tant qu'un plat commandable n'a pas de prix validé, le site ne peut pas être mis en ligne.", NORMAL),
    ("", NORMAL),
    ("Colonnes à remplir (onglet Carte)", GRAS),
    ("Prix validé : le prix affiché sur le site. Recopier le prix salle s'il est juste.", NORMAL),
    ("Commandable : oui ou non. Non = le plat n'apparaît pas sur le site.", NORMAL),
    ("Station : pizza ou cuisine, l'imprimante qui reçoit la ligne. Pré-rempli comme proposition.", NORMAL),
    ("Provenance : pays d'origine des viandes et poissons, obligatoire par écrit. « À fournir » = manque.", NORMAL),
    ("Allergènes : les 14 allergènes du plat (gluten, lait, œuf, poisson, crustacés, fruits à coque, etc.).", NORMAL),
    ("", NORMAL),
    ("Exemple de ligne remplie", GRAS),
]
for i, (t, f) in enumerate(lignes, 1):
    c = lm.cell(row=i, column=1, value=t)
    c.font = f
    c.alignment = Alignment(wrap_text=True, vertical="top")
ex_titres = ["Nom", "Prix validé", "Commandable", "Station", "Provenance", "Allergènes"]
ex_vals = ["Pizza Margherita", 18, "oui", "pizza", "(pas de viande)", "gluten, lait"]
for j, (t, v) in enumerate(zip(ex_titres, ex_vals), 1):
    lm.cell(row=13, column=j, value=t).font = GRAS
    c = lm.cell(row=14, column=j, value=v)
    c.font = Font(name=POLICE, italic=True)
    if j == 2:
        c.number_format = CHF
lm.cell(row=15, column=1, value="Exemple seulement : ni le prix ni les allergènes de cette ligne ne sont validés.").font = Font(name=POLICE, italic=True, size=9)

etat = [
    ("Où on en est", None),
    ("Plats relevés sur Uber", f"=COUNTA(Carte!B2:B{derniere})"),
    ("Plats avec un prix de salle", f"=COUNT(Carte!E2:E{derniere})"),
    ("Plats sans prix de salle (boissons, desserts, cheeseburger)", f"=B19-B20"),
    ("Plats plus chers en salle que sur Uber", f'=COUNTIF(Carte!F2:F{derniere},">0")'),
    ("Prix validés", f"=COUNT(Carte!G2:G{derniere})"),
    ("Plats marqués commandables", f'=COUNTIF(Carte!H2:H{derniere},"oui")'),
    ("Commandables sans prix validé (bloque la mise en ligne)", f'=COUNTIFS(Carte!H2:H{derniere},"oui",Carte!G2:G{derniere},"")'),
    ("Provenances encore à fournir", f'=COUNTIF(Carte!J2:J{derniere},"*À fournir*")'),
    ("Plats sans allergènes renseignés", f'=COUNTBLANK(Carte!K2:K{derniere})'),
]
for i, (t, f) in enumerate(etat, 18):
    a = lm.cell(row=i, column=1, value=t)
    a.font = GRAS if f is None else NORMAL
    if f:
        b = lm.cell(row=i, column=2, value=f)
        b.font = NORMAL
        a.border = b.border = FILET

notes = [
    ("Sources et choix", GRAS),
    ("Prix Uber : page publique Uber Eats du restaurant, 5.11.2026 (docs/recherche/carte-uber-brute.json).", NORMAL),
    ("Prix salle : carte de la salle relevée sur l'ancien site Wix. Elle est peut-être plus récente que Uber, ou fausse : la colonne Écart montre où elle est plus chère.", NORMAL),
    ("Associations : faites automatiquement puis revues à la main le 5.11.2026. Colonne Association : sûre, probable ou aucune. Les « probable » sont à regarder en premier.", NORMAL),
    ("Provenances : seules celles écrites sur la carte de la salle sont reprises (bœuf et porc Suisse ou Autriche, canard France, perches Estonie, saumon Norvège, gambas Vietnam, vongole Italie).", NORMAL),
    ("Retraits gratuits : tirés de la description Uber de chaque pizza, à valider.", NORMAL),
]
for i, (t, f) in enumerate(notes, 30):
    c = lm.cell(row=i, column=1, value=t)
    c.font = f
    c.alignment = Alignment(wrap_text=True, vertical="top")
    lm.merge_cells(start_row=i, start_column=1, end_row=i, end_column=7)
    lm.row_dimensions[i].height = 30 if f is NORMAL else 18
for i in (2, 3):
    lm.merge_cells(start_row=i, start_column=1, end_row=i, end_column=7)
    lm.row_dimensions[i].height = 30

sortie = RACINE / "docs" / "validation-carte.xlsx"
wb.calculation.fullCalcOnLoad = True
wb.save(sortie)
print(sortie)
