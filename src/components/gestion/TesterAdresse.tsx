"use client";

import { useState } from "react";
import { Champ, montant } from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";
import { heureTexte, instantGeneve, jourTexte, type EtatService } from "@/lib/service";

// Tester une adresse (vague 3, bo-operations), rubrique Livraison et horaires : ce que le site répondrait
// maintenant à un client qui donne cette adresse. Calcul du serveur (src/lib/simulateur-adresse.ts), rien
// n'est enregistré. Doc : docs/zones-services.md.

type Simulation = {
  statut: "livrable" | "hors-zone" | "zone-fermee";
  verifiee: boolean;
  adresse: { rue: string; numero: string; npa: string; localite: string } | null;
  zone: {
    numero: number;
    nom: string;
    active: boolean;
    frais_centimes: number;
    minimum_centimes: number;
    delai_min: number;
    delai_max: number;
    services: ("midi" | "soir")[];
    aujourdhui: ("midi" | "soir")[];
    fermee_jusqu_a: string | null;
    fermee_motif: string | null;
  } | null;
  etat: EtatService | null;
};

const vide = { rue: "", numero: "", npa: "", localite: "" };
const heure = (iso: string) => heureTexte(instantGeneve(new Date(iso)).minutes);
const jourDe = (iso: string) => {
  const j = instantGeneve(new Date(iso)).date;
  return j === instantGeneve(new Date()).date ? "aujourd'hui" : jourTexte(j);
};

// Ce que le client lirait pour la livraison, maintenant.
function maintenant(e: EtatService): string {
  switch (e.etat) {
    case "ouvert":
      return `Dès que possible : livrée vers ${heureTexte(e.desQuePossible)}.`;
    case "ferme":
      return `Pas de livraison maintenant. Premier créneau proposé : ${jourDe(`${e.prochain.date}T12:00:00Z`)} à ${heureTexte(e.prochain.minutes)}.`;
    case "pause":
      return `Commandes en ligne en pause${e.jusqua ? ` jusqu'à ${heure(e.jusqua)}` : ""}.`;
    case "livraison-fermee":
      return "Livraison fermée pour le moment (tablette ou coup de feu) : retrait seulement.";
    case "fermeture":
      return `Restaurant fermé : ${e.fermeture.motif}.${e.reouverture ? ` Réouverture ${jourTexte(e.reouverture)}.` : ""}`;
    case "aucun-creneau":
      return "Aucun créneau de livraison dans les jours où l'on peut commander.";
  }
}

export function TesterAdresse() {
  const [v, setV] = useState(vide);
  const [r, setR] = useState<Simulation | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function tester(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    if (!/^\d{4}$/.test(v.npa.trim())) return setErreur("Un NPA à quatre chiffres.");
    if (v.localite.trim().length < 2) return setErreur("La localité, par exemple Onex.");
    setEnvoi(true);
    const rep = await poster("/api/gestion/service", { type: "simuler-adresse", adresse: v });
    setEnvoi(false);
    if (!rep.ok) {
      setR(null);
      return setErreur(String(rep.donnees.erreur ?? "Pas de réponse. Réessayez."));
    }
    setR(rep.donnees as unknown as Simulation);
  }

  return (
    <section className="ges-bloc bo-test-adresse" aria-labelledby="test-adresse-titre">
      <h2 id="test-adresse-titre">Tester une adresse</h2>
      <p className="aide">
        Ce que le site répondrait maintenant à un client qui donne cette adresse. Rien n&apos;est enregistré. Avec la rue, l&apos;adresse est cherchée dans le
        registre fédéral, comme au paiement. Sans rue, seuls le NPA et la localité comptent.
      </p>
      <form className="bo-test-adresse-form" onSubmit={tester} noValidate>
        <Champ libelle="Rue" facultatif>
          {(a) => <input {...a} autoComplete="off" value={v.rue} onChange={(e) => setV({ ...v, rue: e.target.value })} />}
        </Champ>
        <Champ libelle="Numéro" facultatif>
          {(a) => <input {...a} autoComplete="off" value={v.numero} onChange={(e) => setV({ ...v, numero: e.target.value })} />}
        </Champ>
        <Champ libelle="NPA">
          {(a) => <input {...a} inputMode="numeric" maxLength={4} autoComplete="off" value={v.npa} onChange={(e) => setV({ ...v, npa: e.target.value })} />}
        </Champ>
        <Champ libelle="Localité">
          {(a) => <input {...a} autoComplete="off" value={v.localite} onChange={(e) => setV({ ...v, localite: e.target.value })} />}
        </Champ>
        <button type="submit" className="bo-bouton bo-bouton-principal" disabled={envoi}>
          {envoi ? "Test…" : "Tester"}
        </button>
      </form>
      {erreur && (
        <p className="aide-forte" role="alert">
          {erreur}
        </p>
      )}
      {r && <Resultat r={r} />}
    </section>
  );
}

function Resultat({ r }: { r: Simulation }) {
  const z = r.zone;
  const lignes: string[] = [];
  if (r.verifiee && r.adresse) lignes.push(`Adresse retrouvée dans le registre fédéral : ${r.adresse.rue} ${r.adresse.numero}, ${r.adresse.npa} ${r.adresse.localite}.`);
  else if (!r.verifiee) lignes.push("Sans rue : seuls le NPA et la localité ont compté.");
  let titre: string;
  if (r.statut === "hors-zone" || !z) {
    titre = "Hors zone";
    lignes.push("Le client ne peut commander qu'à emporter.");
  } else if (r.statut === "zone-fermee") {
    titre = `${z.nom} : fermée`;
    if (z.active && z.fermee_jusqu_a) {
      lignes.push(`Fermée jusqu'à ${heure(z.fermee_jusqu_a)}, ${jourDe(z.fermee_jusqu_a)}${z.fermee_motif ? ` (${z.fermee_motif})` : ""}. Le client peut commander à emporter.`);
    } else lignes.push("« Zone ouverte à la livraison » est décochée dans sa fiche. Le client peut commander à emporter.");
  } else {
    titre = `${z.nom} : livrée`;
    lignes.push(`Frais de livraison ${montant(z.frais_centimes)} CHF, commande minimum ${montant(z.minimum_centimes)} CHF.`);
    lignes.push(`Délai annoncé en ce moment : de ${z.delai_min} à ${z.delai_max} minutes.`);
    lignes.push(
      z.aujourdhui.length === 0
        ? "Pas livrée aujourd'hui (service fermé ou zone livrée à un autre service)."
        : `Livrée aujourd'hui : ${z.aujourdhui.length === 2 ? "midi et soir" : `le ${z.aujourdhui[0]}`}.`,
    );
    if (r.etat) lignes.push(maintenant(r.etat));
  }
  return (
    <div className="bo-test-adresse-resultat" role="status" data-statut={r.statut}>
      <p className="bo-test-adresse-titre">{titre}</p>
      <ul>
        {lignes.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
