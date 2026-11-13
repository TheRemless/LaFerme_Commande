"use client";

import { useEffect, useState } from "react";

/** La valeur, avec un temps de retard : une recherche ne part au serveur qu'une fois la frappe finie. */
export function useDiffere<T>(valeur: T, ms = 300): T {
  const [v, setV] = useState(valeur);
  useEffect(() => {
    const t = setTimeout(() => setV(valeur), ms);
    return () => clearTimeout(t);
  }, [valeur, ms]);
  return v;
}
