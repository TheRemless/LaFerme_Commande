"use client";

// Le navigateur imprime ou enregistre en PDF (« Enregistrer au format PDF » dans la fenêtre d'impression).
export function Imprimer() {
  return (
    <button type="button" className="bouton-principal recu-imprimer" onClick={() => window.print()}>
      Imprimer ou enregistrer en PDF
    </button>
  );
}
