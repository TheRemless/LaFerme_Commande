# Noms de plats à harmoniser

Pour Jérémy, suite de l'audit design (D12). Aucune donnée n'a été changée. Les noms viennent de `docs/carte-proposee.json` (noms Uber Eats, colonne `nom`) et de la carte de la salle (colonne `salleNom`). Tu choisis, puis on corrige dans le back-office ou dans le tableau de validation.

## 1. Pizzas écrites en minuscule après « Pizza »

Sur la carte en ligne, le mot « Pizza » est retiré et la première lettre est remise en majuscule (« Miss Italia »). Partout ailleurs (suivi, e-mails, tablette, ticket, back-office), le nom s'affiche tel quel : « Pizza miss Italia ».

| Nom en base | Proposition |
|---|---|
| Pizza miss Italia | Pizza Miss Italia |
| Pizza prosciutto | Pizza Prosciutto |
| Pizza tonno | Pizza Tonno |
| Pizza peppino | Pizza Peppino |
| Pizza végétarienne | Pizza Végétarienne |
| Pizza rucola | Pizza Rucola |
| Pizza melanzana | Pizza Melanzana |
| Pizza norvégienne | Pizza Norvégienne |
| Pizza bresaola | Pizza Bresaola |
| Pizza funghi | Pizza Funghi |
| Pizza stromboli | Pizza Stromboli |

Les autres pizzas ont déjà une majuscule (Margherita, Diavola, Parma, Capricciosa, Romana, Sicilia, Napoletana, Hawaï, Calzone, La Ferme, Frutti di Mare, Ferrari, 4 Stagioni, 4 fromages). Seule exception à trancher : « Pizza 4 fromages » (salle : « 4 Fromages »).

## 2. Même plat, deux noms à l'écran

| Où | Ce que voit le client |
|---|---|
| Carte en ligne | Margherita |
| Suivi, e-mails, tablette, ticket | Pizza Margherita |

À choisir : garder « Pizza » partout sauf sur la carte (la catégorie Pizzas le dit déjà), ou l'enlever partout. Le changement se fait dans le code, sans toucher aux données.

## 3. Français et italien mélangés dans le même nom

| Nom en base | Carte de la salle |
|---|---|
| Pasta al pomodoro et basilico | Al pomodoro e basilico |
| Rigatoni alla parmigiana et Burrata | (pas sur la carte de la salle) |
| Paccheri alla salsiccia siciliana et polpette de bœuf | (pas sur la carte de la salle) |

À choisir : « e » (italien, comme la salle) ou « et ».

## 4. Écarts avec la carte de la salle

Les noms en ligne sont plus courts que ceux de la salle. Ce n'est pas une erreur, mais un client qui connaît la salle peut chercher l'autre nom. Les écarts les plus visibles :

| Nom en ligne | Carte de la salle |
|---|---|
| Pasta bolognaise | Spaghettini bolognese |
| Pasta aux crevettes | Pennette aux crevettes et scampis au parfum de curry |
| Gnocchi pommes de terre | Gnocchi alla sorrentina |
| Pasta aglio | Spaghettini aglio, olio e peperoncino |
| Pasta all'amatriciana | Alla matriciana |
| Terrine de foie gras de canard | Terrine de foie de canard et son chutney de figues |
| Risotto noix de Saint Jacques | Risotto noix de Saint-Jacques et gambas safranées |
| Panzerotti aux épinards | Panzerotti ricotta et épinards |

Deux fautes à corriger de toute façon. « Saint Jacques » prend un trait d'union (« Saint-Jacques »). La salle écrit « Ferrarii » pour la Pizza Ferrari.
