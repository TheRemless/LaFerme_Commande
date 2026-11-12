"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { GestionCarte, GestionPlatDuJour, GestionSupplements, type DonneesCarte } from "@/components/gestion/GestionCarte";
import { GestionCommandes } from "@/components/gestion/GestionCommandes";
import { GestionEquipe } from "@/components/gestion/GestionEquipe";
import { GestionImprimantes } from "@/components/gestion/GestionImprimantes";
import { GestionService } from "@/components/gestion/GestionService";
import { heureDe, jourGeneveDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";
import { jourTexte } from "@/lib/service";

type Onglet = "commandes" | "carte" | "jour" | "supplements" | "service" | "imprimantes" | "equipe" | "import" | "export" | "journal";

const ONGLETS: [Onglet, string][] = [
  ["commandes", "Commandes"],
  ["carte", "Carte"],
  ["jour", "Plat du jour"],
  ["supplements", "Suppléments et pâtes"],
  ["service", "Livraison et horaires"],
  ["imprimantes", "Imprimantes"],
  ["equipe", "Équipe"],
  ["import", "Importer le tableau"],
  ["export", "Export comptable"],
  ["journal", "Journal"],
];

export function BackOffice({ nom }: { nom: string }) {
  const router = useRouter();
  const [onglet, setOnglet] = useState<Onglet>("commandes");
  const [carte, setCarte] = useState<DonneesCarte | null>(null);
  // Change à chaque import appliqué : les fiches ouvertes repartent alors des nouvelles valeurs.
  const [version, setVersion] = useState(0);

  const chargerCarte = useCallback(async () => {
    const rep = await fetch("/api/gestion/carte", { cache: "no-store" });
    if (rep.status === 401) return router.refresh();
    if (rep.ok) setCarte(await rep.json());
  }, [router]);

  useEffect(() => {
    chargerCarte();
  }, [chargerCarte]);

  return (
    <div className="gestion">
      <header className="ges-tete">
        <div>
          <h1>Back-office</h1>
          <p className="aide">
            Connecté : {nom}. Chaque modification est enregistrée dans le journal.{" "}
            <a href="/tablette">Tablette</a>
          </p>
        </div>
        {carte && (
          <p className={carte.bloquants > 0 ? "ges-bloquants" : "ges-ok"} role="status">
            {carte.bloquants > 0 ? `${carte.bloquants} plat${carte.bloquants > 1 ? "s" : ""} bloque${carte.bloquants > 1 ? "nt" : ""} la mise en ligne` : "Rien ne bloque la mise en ligne"}
          </p>
        )}
      </header>
      <nav className="tab-onglets ges-rubriques" aria-label="Rubriques">
        {ONGLETS.map(([cle, titre]) => (
          <button key={cle} type="button" aria-pressed={onglet === cle} onClick={() => setOnglet(cle)}>
            {titre}
          </button>
        ))}
      </nav>
      {onglet === "commandes" && <GestionCommandes />}
      {onglet === "equipe" && <GestionEquipe />}
      {onglet === "carte" && (carte ? <GestionCarte donnees={carte} recharger={chargerCarte} version={version} /> : <p className="aide">Chargement…</p>)}
      {onglet === "jour" && (carte ? <GestionPlatDuJour donnees={carte} recharger={chargerCarte} /> : <p className="aide">Chargement…</p>)}
      {onglet === "supplements" && (carte ? <GestionSupplements donnees={carte} recharger={chargerCarte} /> : <p className="aide">Chargement…</p>)}
      {onglet === "service" && <GestionService />}
      {onglet === "imprimantes" && <GestionImprimantes />}
      {onglet === "import" && (
        <Import
          recharger={async () => {
            setVersion((v) => v + 1);
            await chargerCarte();
          }}
        />
      )}
      {onglet === "export" && <Export />}
      {onglet === "journal" && <Journal />}
    </div>
  );
}

type Ligne = { nom: string; changements: { champ: string; avant: string; apres: string }[] };

function Import({ recharger }: { recharger: () => Promise<void> }) {
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

function Export() {
  const auj = jourGeneveDe(new Date());
  const [debut, setDebut] = useState(`${auj.slice(0, 7)}-01`);
  const [fin, setFin] = useState(auj);
  const [erreur, setErreur] = useState<string | null>(null);

  // Par requête : une période invalide ou une session terminée affiche un message, pas un faux fichier.
  async function telecharger() {
    setErreur(null);
    try {
      const rep = await fetch(`/api/gestion/export?debut=${encodeURIComponent(debut)}&fin=${encodeURIComponent(fin)}`);
      if (!rep.ok) {
        const r = (await rep.json().catch(() => ({}))) as { erreur?: string };
        return setErreur(r.erreur ?? "Export impossible.");
      }
      const url = URL.createObjectURL(await rep.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = rep.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "la-ferme-ventes.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setErreur("Pas de connexion. Réessayez.");
    }
  }
  return (
    <section className="ges-bloc">
      <h2>Export comptable</h2>
      <p>
        Ventes encaissées sur la période (payées en ligne ou au comptoir), une ligne par commande, puis le total par taux de TVA. Sans nom ni adresse de
        client. Les commandes remboursées ou refusées n&apos;y sont pas.
      </p>
      <div className="details deux">
        <div className="champ">
          <label htmlFor="export-debut">Du</label>
          <input id="export-debut" type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
        </div>
        <div className="champ">
          <label htmlFor="export-fin">Au</label>
          <input id="export-fin" type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
        </div>
      </div>
      <button type="button" className="bouton-principal" onClick={telecharger}>
        Télécharger le fichier CSV
      </button>
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
    </section>
  );
}

type Entree = {
  id: number;
  personnel_nom: string;
  objet: string;
  cle: string;
  avant: Record<string, unknown> | null;
  apres: Record<string, unknown> | null;
  le: string;
  annule_par?: number | null;
};

// Ce qui se remet depuis le journal (audit du gérant, G11), comme dans annuler_journal en base.
const REGLAGES_ANNULABLES = ["plafond_comptoir_centimes", "capacite_livraisons_par_creneau", "capacite_retraits_par_creneau", "alerte_acceptation_minutes"];
function annulable(e: Entree): boolean {
  if (e.annule_par) return false;
  if (e.objet === "reglage") return REGLAGES_ANNULABLES.includes(e.cle) && e.avant !== null;
  return ["zone", "horaire", "plat", "option", "fermeture", "ouverture", "zone_npa"].includes(e.objet);
}

const REGLAGES: Record<string, (v: unknown) => string> = {
  plafond_comptoir_centimes: (v) => `Paiement au comptoir jusqu'à CHF ${(Number(v) / 100).toFixed(2)}`,
  capacite_livraisons_par_creneau: (v) => `${v} livraisons par créneau`,
  capacite_retraits_par_creneau: (v) => `${v} retraits par créneau`,
  alerte_acceptation_minutes: (v) => `Alerte après ${v} min`,
};

function quoi(e: Entree): string {
  switch (e.objet) {
    case "plat":
      return `Plat ${String((e.apres ?? e.avant)?.nom ?? e.cle)}`;
    case "option":
      return `Supplément ${e.cle.split("/").slice(1).join("/")}`;
    case "zone":
      return `Zone ${e.cle}`;
    case "zone_npa":
      return `Commune ${e.cle}`;
    case "horaire":
      return "Horaire";
    case "fermeture":
      return "Fermeture";
    case "ouverture":
      return "Ouverture exceptionnelle";
    case "reglage":
      return "Réglage";
    case "personnel":
      return `Équipe, ${e.cle}`;
    case "remboursement":
      return `Commande ${e.cle}`;
    case "import":
      return "Import du tableau";
    case "imprimante":
      return `Imprimante ${e.cle}`;
    default:
      return `${e.objet} ${e.cle}`;
  }
}

const LIBELLES: Record<string, string> = {
  nom: "Nom",
  description: "Description",
  prix_centimes: "Prix",
  prix_a_valider: "Prix à valider",
  commandable: "Commandable",
  station: "Station",
  photo: "Photo",
  provenance: "Provenance",
  provenances_a_fournir: "Provenances à fournir",
  allergenes: "Allergènes",
  actif: "Proposé",
  frais_centimes: "Frais",
  minimum_centimes: "Minimum",
  delai_min: "Délai de",
  delai_max: "Délai à",
  active: "Zone ouverte",
  proposition: "Proposition",
  premiere_heure: "Première heure",
  derniere_heure: "Dernière heure",
  derniere_commande: "Dernière commande",
  derniere_commande_pizzas: "Dernière pizza",
};

function valeurLisible(cle: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "vide";
  if (typeof v === "string" && /^\d{2}:\d{2}:\d{2}$/.test(v)) return v.slice(0, 5);
  if (cle.endsWith("_centimes") && typeof v === "number") return (v / 100).toFixed(2);
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (Array.isArray(v)) return v.join(", ") || "vide";
  return String(v);
}

const ROLE: Record<string, string> = { service: "tablette", gerant: "tablette et back-office" };

function jourCourt(d: unknown): string {
  return jourTexte(String(d).slice(0, 10));
}

function resume(e: Entree): string {
  if (e.objet === "reglage") {
    const f = REGLAGES[e.cle] ?? ((v: unknown) => String(v));
    return `${e.avant === null ? "vide" : f(e.avant)} → ${f(e.apres)}`;
  }
  if (e.objet === "fermeture" || e.objet === "ouverture") {
    const x = (e.apres ?? e.avant ?? {}) as { debut?: string; fin?: string; jour?: string; service?: string | null; motif?: string };
    const quand = x.jour
      ? `le ${jourCourt(x.jour)}, ${x.service === "midi" ? "midi" : "soir"}`
      : x.service
        ? `le ${jourCourt(x.debut)}, ${x.service}`
        : `du ${jourCourt(x.debut)} au ${jourCourt(x.fin)}`;
    return `${e.apres ? "Ajout" : "Suppression"} : ${quand}, ${x.motif ?? ""}`;
  }
  if (e.objet === "zone_npa") {
    const av = e.avant as { zone_numero?: number } | null;
    const ap = e.apres as { zone_numero?: number } | null;
    if (!av) return `Ajoutée à la zone ${ap?.zone_numero}`;
    if (!ap) return `Retirée de la zone ${av.zone_numero}`;
    return `Zone ${av.zone_numero} → zone ${ap.zone_numero}`;
  }
  if (e.objet === "remboursement" && e.apres) {
    const a = e.apres as { montant_centimes?: number; motif?: string; moyen?: string };
    return `Commande ${e.cle} : CHF ${((a.montant_centimes ?? 0) / 100).toFixed(2)} remboursés${a.moyen === "especes" ? " en espèces" : ""}. ${a.motif ?? ""}`;
  }
  if (e.objet === "personnel") {
    const av = (e.avant ?? {}) as { nom?: string; role?: string; actif?: boolean };
    const ap = (e.apres ?? {}) as { nom?: string; role?: string; actif?: boolean; sessions_coupees?: number };
    if (ap.sessions_coupees !== undefined) return `Déconnecté de ${ap.sessions_coupees} appareil${ap.sessions_coupees > 1 ? "s" : ""}`;
    if (!e.avant || av.actif === false) return `Ajouté : ${ap.nom}, accès ${ROLE[ap.role ?? ""] ?? ap.role}`;
    if (ap.actif === false) return `Retiré : ${av.nom}`;
    const ch = [av.nom !== ap.nom ? `nom ${av.nom} → ${ap.nom}` : "", av.role !== ap.role ? `accès ${ROLE[av.role ?? ""]} → ${ROLE[ap.role ?? ""]}` : ""].filter(Boolean);
    return ch.length ? ch.join(" ; ") : "Enregistré sans changement";
  }
  if (!e.avant || !e.apres || Array.isArray(e.avant) || Array.isArray(e.apres)) {
    if (e.objet === "import") return `Import : ${JSON.stringify(e.apres)}`;
    if (!e.avant) return "Ajout";
    if (!e.apres) return "Suppression";
    return `${JSON.stringify(e.avant)} → ${JSON.stringify(e.apres)}`;
  }
  // « Proposition » passe à non à chaque enregistrement : sans intérêt pour le gérant.
  const cles = Object.keys(e.apres).filter((k) => k !== "proposition" && JSON.stringify(e.avant![k]) !== JSON.stringify(e.apres![k]));
  return cles.length
    ? cles.map((k) => `${LIBELLES[k] ?? k} : ${valeurLisible(k, e.avant![k])} → ${valeurLisible(k, e.apres![k])}`).join(" ; ")
    : "Enregistré sans changement";
}

function Journal() {
  const [entrees, setEntrees] = useState<Entree[] | null>(null);
  const [confirmer, setConfirmer] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const charger = useCallback(async () => {
    const r = await fetch("/api/gestion/journal", { cache: "no-store" }).catch(() => null);
    setEntrees(r?.ok ? await r.json() : []);
  }, []);
  useEffect(() => {
    charger();
  }, [charger]);

  // Retour arrière (G11) : la base refuse si la valeur a changé depuis.
  async function annuler(id: number) {
    setEnvoi(true);
    setMessage(null);
    const r = await poster("/api/gestion/journal", { action: "annuler", id });
    setMessage({ ok: r.ok, texte: String(r.donnees.message ?? r.donnees.erreur ?? "Pas annulé.") });
    setConfirmer(null);
    await charger();
    setEnvoi(false);
  }

  if (!entrees) return <p className="aide">Chargement…</p>;
  if (entrees.length === 0) return <p className="aide">Aucune modification pour l&apos;instant.</p>;
  return (
    <section className="ges-bloc">
      <h2>Journal des modifications</h2>
      <p className="aide">Les 200 dernières. « Annuler » remet l&apos;ancienne valeur, si rien n&apos;a changé depuis.</p>
      {message && (
        <p className={message.ok ? "tab-message" : "panier-alerte"} role={message.ok ? "status" : "alert"}>
          {message.texte}
        </p>
      )}
      <ul className="ges-plats ges-journal-liste">
        {entrees.map((e) => (
          <li key={e.id} className={e.annule_par ? "ges-retire" : ""}>
            <p className="ges-journal-tete">
              <strong>{quoi(e)}</strong>
              <span>
                {jourTexte(jourGeneveDe(e.le))}, {heureDe(e.le)}, {e.personnel_nom}
              </span>
            </p>
            <p className="ges-diff">{resume(e)}</p>
            {e.annule_par ? (
              <p className="aide">Annulée.</p>
            ) : (
              annulable(e) &&
              (confirmer === e.id ? (
                <span className="boutons-ligne">
                  <button type="button" className="bouton-second" disabled={envoi} onClick={() => annuler(e.id)}>
                    Oui, remettre l&apos;ancienne valeur
                  </button>
                  <button type="button" className="lien" onClick={() => setConfirmer(null)}>
                    Non
                  </button>
                </span>
              ) : (
                <button type="button" className="lien" onClick={() => setConfirmer(e.id)}>
                  Annuler
                </button>
              ))
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
