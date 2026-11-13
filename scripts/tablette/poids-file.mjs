// Poids de la file de la tablette (vague 3, file allégée) : réponse complète, puis relecture sans changement.
// Local seulement : AUDIT_BASE=http://localhost:3228 node scripts/tablette/poids-file.mjs [email]
import { BASE, connecter } from "../audit/lib.mjs";

const cookie = await connecter(process.argv[2] ?? "lea.rush@exemple.test");
const lire = async (version) => {
  const r = await fetch(`${BASE}/api/tablette/file${version ? `?version=${version}` : ""}`, { headers: { cookie, Origin: BASE } });
  const corps = await r.arrayBuffer();
  return { status: r.status, octets: corps.byteLength, version: r.headers.get("X-Version-File") };
};
const complet = await lire();
const relu = await lire(complet.version);
const json = JSON.parse(await (await fetch(`${BASE}/api/tablette/file`, { headers: { cookie, Origin: BASE } })).text());
console.log(
  JSON.stringify({
    complet: { status: complet.status, ko: +(complet.octets / 1024).toFixed(1) },
    sans_changement: { status: relu.status, octets: relu.octets },
    commandes: json.commandes.length,
    terminees_sans_lignes: json.commandes.filter((c) => c.lignes_omises).length,
    taches: json.impression.taches.length,
  }),
);
