"use client";

import { useState } from "react";
import type { DonneesCarte } from "@/components/gestion/GestionCarte";
import { CADRAGES, envoyerPhoto, type Cadrage } from "@/components/gestion/PhotoPlat";
import { platDuFichier } from "@/lib/photos-lot";

// Plusieurs photos d'un coup (vague 3) : le gérant choisit les fichiers, l'écran propose le plat d'après le
// nom du fichier (« pizza-tonno.jpg », « Pizza Tonno.png »), il corrige si besoin, choisit le cadrage, puis
// envoie. Chaque photo passe par le même contrôle que l'envoi d'une seule (type, taille, recadrage 4:3).

type Ligne = { fichier: File; plat: string; cadrage: Cadrage; etat: string | null; ok: boolean };

export function PhotosEnLot({ donnees, fini }: { donnees: DonneesCarte; fini: (envoyees: number) => Promise<void> }) {
  const plats = donnees.categories.flatMap((c) => c.plats.filter((p) => !p.archive).map((p) => ({ slug: p.slug, nom: p.nom, categorie: c.nom, photo: p.photo })));
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [progres, setProgres] = useState<string | null>(null);

  function choisir(fichiers: FileList | null) {
    if (!fichiers) return;
    setLignes([...fichiers].slice(0, 40).map((f) => ({ fichier: f, plat: platDuFichier(f.name, plats), cadrage: "centre", etat: null, ok: false })));
  }
  const changer = (i: number, l: Partial<Ligne>) => setLignes((ls) => ls.map((x, j) => (j === i ? { ...x, ...l } : x)));

  async function envoyer() {
    setEnvoi(true);
    let envoyees = 0;
    const aEnvoyer = lignes.map((l, i) => ({ l, i })).filter(({ l }) => l.plat && !l.ok);
    for (const [n, { l, i }] of aEnvoyer.entries()) {
      setProgres(`Photo ${n + 1} sur ${aEnvoyer.length}…`);
      const erreur = await envoyerPhoto(l.plat, l.fichier, l.cadrage);
      changer(i, { etat: erreur ?? "En ligne.", ok: !erreur });
      if (!erreur) envoyees += 1;
    }
    setProgres(null);
    setEnvoi(false);
    if (envoyees) await fini(envoyees);
  }

  const pretes = lignes.filter((l) => l.plat && !l.ok).length;
  const doublons = new Set(lignes.filter((l, i) => l.plat && lignes.findIndex((x) => x.plat === l.plat) !== i).map((l) => l.plat));

  return (
    <div className="bo-formulaire">
      <div className="bo-champ">
        <label htmlFor="photos-lot">Photos</label>
        <input id="photos-lot" type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" disabled={envoi} onChange={(e) => choisir(e.target.files)} />
        <p className="bo-champ-aide">
          Jusqu&apos;à 40 photos d&apos;un coup. Nommez les fichiers comme les plats (pizza-tonno.jpg) et l&apos;écran les range tout seul. Seulement des photos du restaurant.
        </p>
      </div>
      {lignes.length > 0 && (
        <table className="bo-apercu">
          <caption>Vérifiez le plat de chaque photo avant l&apos;envoi.</caption>
          <thead>
            <tr>
              <th scope="col">Fichier</th>
              <th scope="col">Plat</th>
              <th scope="col">Cadrage</th>
              <th scope="col">État</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => {
              const plat = plats.find((p) => p.slug === l.plat);
              return (
                <tr key={`${l.fichier.name}-${i}`}>
                  <th scope="row">{l.fichier.name}</th>
                  <td>
                    <label htmlFor={`photo-plat-${i}`} className="sr-only">
                      Plat pour {l.fichier.name}
                    </label>
                    <select id={`photo-plat-${i}`} value={l.plat} disabled={envoi || l.ok} onChange={(e) => changer(i, { plat: e.target.value })}>
                      <option value="">Ne pas envoyer</option>
                      {plats.map((p) => (
                        <option key={p.slug} value={p.slug}>
                          {p.nom} ({p.categorie})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <label htmlFor={`photo-cadrage-${i}`} className="sr-only">
                      Cadrage pour {l.fichier.name}
                    </label>
                    <select id={`photo-cadrage-${i}`} value={l.cadrage} disabled={envoi || l.ok} onChange={(e) => changer(i, { cadrage: e.target.value as Cadrage })}>
                      {CADRAGES.map(([v, t]) => (
                        <option key={v} value={v}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {l.etat ??
                      (!l.plat ? "Pas de plat trouvé" : doublons.has(l.plat) ? "Deux photos pour ce plat : la dernière gagne" : plat?.photo ? "Remplacera la photo actuelle" : "Prête")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {progres && <p role="status">{progres}</p>}
      {lignes.length > 0 && (
        <button type="button" className="bo-bouton bo-bouton-principal" disabled={envoi || pretes === 0} onClick={envoyer}>
          {envoi ? "Envoi…" : `Envoyer ${pretes} photo${pretes > 1 ? "s" : ""}`}
        </button>
      )}
    </div>
  );
}
