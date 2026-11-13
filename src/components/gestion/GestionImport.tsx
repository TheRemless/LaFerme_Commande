"use client";

import { useState } from "react";

// Import du tableau de validation (déplacé tel quel depuis BackOffice.tsx, vague 3).
type Ligne = { nom: string; changements: { champ: string; avant: string; apres: string }[] };

export function GestionImport({ recharger }: { recharger: () => Promise<void> }) {
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<{ lignes: Ligne[]; avertissements: string[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(appliquer: boolean) {
    if (!fichier) return;
    setEnvoi(true);
    setMessage(null);
    const f = new FormData();
    f.set("fichier", fichier);
    if (appliquer) f.set("appliquer", "1");
    try {
      const rep = await fetch("/api/gestion/import", { method: "POST", body: f });
      const r = (await rep.json()) as { lignes?: Ligne[]; avertissements?: string[]; applique?: { plats: number; options: number; bloquants: number }; erreur?: string };
      if (!rep.ok) setMessage(r.erreur ?? "Import impossible.");
      else if (r.applique) {
        setMessage(`Appliqué : ${r.applique.plats} plats et ${r.applique.options} options. Il reste ${r.applique.bloquants} plats qui bloquent la mise en ligne.`);
        setApercu(null);
        await recharger();
      } else setApercu({ lignes: r.lignes ?? [], avertissements: r.avertissements ?? [] });
    } catch {
      setMessage("Pas de connexion. Réessayez.");
    }
    setEnvoi(false);
  }

  const n = apercu?.lignes.reduce((s, l) => s + l.changements.length, 0) ?? 0;
  return (
    <section className="ges-bloc">
      <h2>Importer le tableau de validation</h2>
      <p>
        Le tableau <strong>validation-carte.xlsx</strong> rempli : prix validés, commandable, station, provenance, allergènes, prix des suppléments.
        Une case vide ne change rien. Vous voyez les changements avant de les appliquer.
      </p>
      <div className="champ">
        <label htmlFor="fichier-import">Fichier .xlsx</label>
        <input
          id="fichier-import"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setFichier(e.target.files?.[0] ?? null);
            setApercu(null);
            setMessage(null);
          }}
        />
      </div>
      <button type="button" className="bouton-second" disabled={!fichier || envoi} onClick={() => envoyer(false)}>
        Voir les changements
      </button>
      {message && (
        <p className="tab-message" role="status">
          {message}
        </p>
      )}
      {apercu && (
        <div className="ges-apercu">
          {apercu.avertissements.length > 0 && (
            <ul className="ges-avert">
              {apercu.avertissements.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {n === 0 ? (
            <p>Aucun changement : le tableau correspond déjà à la carte.</p>
          ) : (
            <>
              <table className="ges-table">
                <thead>
                  <tr>
                    <th>Plat ou option</th>
                    <th>Champ</th>
                    <th>Avant</th>
                    <th>Après</th>
                  </tr>
                </thead>
                <tbody>
                  {apercu.lignes.flatMap((l) =>
                    l.changements.map((c, i) => (
                      <tr key={`${l.nom}-${c.champ}`}>
                        <td>{i === 0 ? l.nom : ""}</td>
                        <td>{c.champ}</td>
                        <td>{c.avant}</td>
                        <td>
                          <strong>{c.apres}</strong>
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
              <button type="button" className="bouton-principal" disabled={envoi} onClick={() => envoyer(true)}>
                Appliquer {n} changement{n > 1 ? "s" : ""}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
