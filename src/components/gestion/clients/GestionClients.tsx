"use client";

import { useState } from "react";
import { ListeClients } from "@/components/gestion/clients/ListeClients";
import { ListeReclamations } from "@/components/gestion/clients/ListeReclamations";
import { Onglets } from "@/components/gestion/ui";
import "@/components/gestion/commandes/commandes.css";

// Rubrique Clients du back-office (vague 3, bo-commandes) : les clients (invités compris) et les réclamations.
export function GestionClients() {
  const [onglet, setOnglet] = useState("clients");
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
