// Champs à confirmer par Jérémy avant impression.
// Une valeur entre crochets s'affiche surlignée en jaune sur la maquette : elle n'est pas validée.
// L'adresse du QR peut aussi se passer dans l'URL de la page : flyer.html?qr=https://exemple.ch/?ref=flyer-a5
window.CHAMPS = {
  // Adresse codée dans le QR. Le paramètre ref sert à compter les visites venues de chaque support.
  qrFlyer: "https://[adresse-du-site-a-confirmer]/?ref=flyer-a5",
  qrAutocollant: "https://[adresse-du-site-a-confirmer]/?ref=autocollant",
  // Adresse imprimée en clair sous le QR (sans https://).
  adresseAffichee: "[adresse du site à confirmer]",
  // Offre de première commande : voir docs/lancement/offre-premiere-commande.md (trois options, choix de Jérémy).
  offre: "[Offre de première commande à choisir]",
  code: "[CODE]",
  // Communes livrées : proposition du 5.11.2026 (zones 1 et 2), à valider dans le back-office.
  communes:
    "[Onex, Petit-Lancy, Grand-Lancy, Confignon, Bernex, Plan-les-Ouates, Carouge, Jonction, Plainpalais, Le Lignon, Châtelaine, Aïre]",
  // Horaires de livraison : proposition, à valider dans le back-office.
  horaires: "[Mardi à samedi, midi et soir. Heures à confirmer]",
};
