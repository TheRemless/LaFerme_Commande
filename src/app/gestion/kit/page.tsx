import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoKit } from "@/components/gestion/DemoKit";

export const metadata: Metadata = { title: "Kit" };

// Démonstration du kit du back-office : en local (base embarquée) seulement, jamais sur une préversion ni en production.
export default function Page() {
  if (process.env.BASE_LOCALE !== "1") notFound();
  return <DemoKit />;
}
