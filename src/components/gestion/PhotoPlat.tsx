"use client";

import Image from "next/image";
import { useId, useRef, useState } from "react";
import type { PlatGestion } from "@/components/gestion/GestionCarte";
import { poster } from "@/lib/requete-client";
import { estPhotoEnvoyee, urlPhoto } from "@/lib/photos";

// Photo d'un plat : aperçu tel que le client le verra (4:3), envoi depuis le téléphone ou l'ordinateur,
// retrait. Le navigateur réduit d'abord la photo (un téléphone en fait de 3 à 8 Mo), le serveur la
// contrôle, la recadre et la réenregistre à la taille du site.

const COTE_MAX = 3200;
const POIDS_MAX = 5 * 1024 * 1024;

export type Cadrage = "haut" | "centre" | "bas";
export const CADRAGES: [Cadrage, string][] = [
  ["centre", "Centre"],
  ["haut", "Haut"],
  ["bas", "Bas"],
];

async function reduire(fichier: File): Promise<Blob> {
  try {
    const image = await createImageBitmap(fichier, { imageOrientation: "from-image" });
    const echelle = Math.min(1, COTE_MAX / Math.max(image.width, image.height));
    const toile = document.createElement("canvas");
    toile.width = Math.round(image.width * echelle);
    toile.height = Math.round(image.height * echelle);
    toile.getContext("2d")?.drawImage(image, 0, 0, toile.width, toile.height);
    image.close();
    const blob = await new Promise<Blob | null>((ok) => toile.toBlob(ok, "image/jpeg", 0.9));
    return blob ?? fichier;
  } catch {
    // Format que le navigateur ne sait pas lire : le serveur répondra clairement.
    return fichier;
  }
}

// Envoie une photo pour un plat : réduite dans le navigateur, recadrée en 4:3 par le serveur selon le
// cadrage, posée sur le plat. Rend null si tout va bien, sinon le message à montrer.
export async function envoyerPhoto(slug: string, fichier: File, cadrage: Cadrage = "centre"): Promise<string | null> {
  const blob = await reduire(fichier);
  if (blob.size > POIDS_MAX) return "Photo trop lourde : 5 Mo au plus.";
  const f = new FormData();
  f.set("slug", slug);
  f.set("cadrage", cadrage);
  f.set("fichier", blob, "photo.jpg");
  try {
    const rep = await fetch("/api/gestion/photo", { method: "POST", body: f });
    const r = (await rep.json().catch(() => ({}))) as { erreur?: string };
    return rep.ok ? null : (r.erreur ?? "Envoi impossible. Réessayez.");
  } catch {
    return "Pas de connexion. Vérifiez le réseau et réessayez.";
  }
}

export function PhotoPlat({ plat, recharger }: { plat: PlatGestion; recharger: () => Promise<void> }) {
  const ids = useId();
  const champ = useRef<HTMLInputElement>(null);
  const [etat, setEtat] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const [cadrage, setCadrage] = useState<Cadrage>("centre");

  async function envoyer(fichier: File) {
    setEnvoi(true);
    setEtat("Envoi…");
    const erreur = await envoyerPhoto(plat.slug, fichier, cadrage);
    setEtat(erreur ?? "Photo en ligne.");
    if (!erreur) await recharger();
    setEnvoi(false);
    if (champ.current) champ.current.value = "";
  }

  async function retirer() {
    setEnvoi(true);
    setConfirmer(false);
    const r = await poster("/api/gestion/photo", { action: "retirer", slug: plat.slug });
    setEtat(r.ok ? "Photo retirée." : String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    setEnvoi(false);
    if (r.ok) await recharger();
  }

  return (
    <div className="ges-photo">
      <div className="ges-photo-apercu">
        {plat.photo ? (
          <Image src={urlPhoto(plat.photo)} alt={`Photo actuelle : ${plat.nom}`} fill sizes="240px" />
        ) : (
          <span className="aide">Sans photo</span>
        )}
      </div>
      <div className="ges-photo-actions">
        <label htmlFor={`${ids}-cadrage`}>Cadrage</label>
        <select id={`${ids}-cadrage`} value={cadrage} onChange={(e) => setCadrage(e.target.value as Cadrage)} disabled={envoi}>
          {CADRAGES.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
        <label htmlFor={`${ids}-fichier`}>{plat.photo ? "Remplacer la photo" : "Envoyer une photo"}</label>
        <input
          ref={champ}
          id={`${ids}-fichier`}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          disabled={envoi}
          onChange={(e) => {
            const fichier = e.target.files?.[0];
            if (fichier) envoyer(fichier);
          }}
        />
        <p className="aide">JPEG, PNG, WebP ou AVIF, 1200 × 900 pixels au moins. Recadrée en 4:3 comme les photos du shooting ; le cadrage dit quelle partie garder.</p>
        {plat.photo &&
          (confirmer ? (
            <span className="boutons-ligne">
              <button type="button" className="bouton-second" onClick={retirer} disabled={envoi}>
                Oui, retirer la photo
              </button>
              <button type="button" className="lien" onClick={() => setConfirmer(false)}>
                Garder
              </button>
            </span>
          ) : (
            <button type="button" className="bouton-second" onClick={() => setConfirmer(true)} disabled={envoi}>
              Retirer la photo
            </button>
          ))}
        {plat.photo && !estPhotoEnvoyee(plat.photo) && <p className="aide">Photo du shooting : {plat.photo}</p>}
        {etat && (
          <p className="aide-forte" role="status">
            {etat}
          </p>
        )}
      </div>
    </div>
  );
}
