"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormCode } from "@/components/compte/FormCode";

// Case « créer mon compte » cochée en fin de commande : le code part à l'e-mail de la commande,
// qui est rangée dans le compte une fois le code entré.
export function CreerCompte({ jeton, rattachee }: { jeton: string; rattachee: boolean }) {
  const router = useRouter();
  if (rattachee) {
    return (
      <section className="suivi-compte" role="status">
        <p className="aide-forte">Compte créé. Cette commande est dans votre compte.</p>
        <Link className="lien" href="/compte">
          Voir mon compte
        </Link>
      </section>
    );
  }
  return (
    <section className="suivi-compte" aria-labelledby="suivi-compte-titre">
      <h2 id="suivi-compte-titre">Créez votre compte</h2>
      <p>On envoie un code à l&apos;e-mail de la commande. Une fois le code entré, cette commande est rangée dans votre compte.</p>
      <FormCode jeton={jeton} titreBouton="Créer mon compte" onConnecte={() => router.refresh()} />
    </section>
  );
}
