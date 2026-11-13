"use client";

import { useEffect, useState } from "react";
import { messagesVisibles, type MessageClient, type Page } from "@/lib/messages-clients";

// Bannière d'information programmée par le gérant (back-office, rubrique Messages aux clients). Doc :
// docs/messages-clients.md. Le texte du gérant est rendu en texte, jamais en HTML.
// La page vient du cache (une minute au plus) : le serveur trie à l'heure du rendu, puis le navigateur
// retrie à son heure et toutes les 30 secondes, pour qu'un message commence et finisse à la minute près.
// Hors de l'accueil, la bannière est accessoire : config illisible, la page s'affiche sans elle (messages absents).
export function MessagesClients({ messages, page, rendu }: { messages: MessageClient[] | undefined; page: Page; rendu: number }) {
  const [maintenant, setMaintenant] = useState(rendu);
  useEffect(() => {
    if (!messages?.length) return;
    setMaintenant(Date.now());
    const minuterie = setInterval(() => setMaintenant(Date.now()), 30_000);
    return () => clearInterval(minuterie);
  }, [messages]);

  const visibles = messagesVisibles(messages, page, maintenant);
  if (visibles.length === 0) return null;
  return (
    <section className="messages-clients" aria-label="Information du restaurant">
      {visibles.map((m) => (
        <p key={m.id}>{m.texte}</p>
      ))}
    </section>
  );
}
