"use client";

import { useEffect, useState } from "react";
import { ListeClients } from "@/components/gestion/clients/ListeClients";
import { ListeReclamations } from "@/components/gestion/clients/ListeReclamations";
import { Onglets, ouvertureEnAttente } from "@/components/gestion/ui";
import "@/components/gestion/commandes/commandes.css";

// Rubrique Clients du back-office (vague 3, bo-commandes) : les clients (invités compris) et les réclamations.
export function GestionClients() {
  const [onglet, setOnglet] = useState("clients");
  // Arrivée depuis la fiche d'une commande (« Ouvrir le dossier ») : l'onglet Réclamations, qui ouvre le dossier.
  useEffect(() => {
    if (ouvertureEnAttente("reclamation")) setOnglet("reclamations");
  }, []);
  return (
    <Onglets
      libelle="Parties de la rubrique"
      actif={onglet}
      onChange={setOnglet}
      onglets={[
        { cle: "clients", titre: "Clients" },
        { cle: "reclamations", titre: "Réclamations" },
      ]}
    >
      {onglet === "clients" ? <ListeClients /> : <ListeReclamations />}
    </Onglets>
  );
}
