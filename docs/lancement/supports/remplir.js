// Remplit les champs de la maquette depuis champs.js et dessine les QR.
// Bibliothèque QR : qrcode-generator 1.4.4 (licence MIT), chargée depuis jsDelivr.
(function () {
  const champs = window.CHAMPS;
  const params = new URLSearchParams(location.search);

  document.querySelectorAll("[data-champ]").forEach((el) => {
    const valeur = champs[el.dataset.champ];
    el.textContent = valeur;
    if (valeur.startsWith("[")) el.classList.add("a-confirmer");
  });

  document.querySelectorAll("[data-qr]").forEach((el) => {
    const adresse = params.get("qr") || champs[el.dataset.qr];
    const qr = qrcode(0, "M");
    qr.addData(adresse);
    qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    el.setAttribute("aria-label", "QR code vers " + adresse);
  });

  document.documentElement.dataset.pret = "1";
})();
