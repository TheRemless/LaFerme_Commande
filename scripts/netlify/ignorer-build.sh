#!/usr/bin/env bash
# Commande « ignore » de Netlify (netlify.toml) : sortie 0 = build sauté, sortie 1 = build lancé.
# Netlify sobre (19.11.2026, docs/netlify-sobre.md) : une préversion ne se construit que si on la demande.
#   - main : sautée tant que le site n'est pas lancé (PRODUCTION_LANCEE=non). À la bascule, main ne se construit
#     que si le dernier commit porte [production] (chaque mise en production coûte 15 crédits).
#   - PR de Dependabot : jamais de préversion.
#   - Autre branche : préversion seulement si le dernier commit porte [preview], ou si la PR a le label « preview ».
#     Sinon sautée : les vérifications GitHub (lint, types, Vitest, Playwright sur la base embarquée) testent tout.
# Variables lues (fournies par Netlify) : BRANCH, HEAD, COMMIT_REF, REVIEW_ID (numéro de la PR).
set -u

PRODUCTION_LANCEE=non
DEPOT="TheRemless/LaFerme_Commande"

message=$(git log -1 --format=%B "${COMMIT_REF:-HEAD}" 2>/dev/null || true)

if [ "${BRANCH:-}" = "main" ]; then
  if [ "$PRODUCTION_LANCEE" != "oui" ]; then
    echo "Build de production sauté : site pas encore lancé (bascule : docs/mise-en-ligne.md)."
    exit 0
  fi
  case "$message" in
    *"[production]"*) echo "Mise en production demandée ([production] dans le commit)."; exit 1 ;;
    *) echo "Build de production sauté : pas de [production] dans le dernier commit de main."; exit 0 ;;
  esac
fi

case "${BRANCH:-} ${HEAD:-}" in
  *dependabot/*) echo "Préversion sautée : PR Dependabot."; exit 0 ;;
esac

case "$message" in
  *"[preview]"*) echo "Préversion demandée ([preview] dans le dernier commit)."; exit 1 ;;
esac

# Label « preview » de la PR. Dépôt public : lecture sans jeton. Réseau en panne ou limite de l'API atteinte :
# la préversion est sautée (le commit [preview] reste possible).
if [ -n "${REVIEW_ID:-}" ]; then
  labels=$(curl -fsS --max-time 10 -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${DEPOT}/issues/${REVIEW_ID}/labels" 2>/dev/null || true)
  if printf '%s' "$labels" | grep -Eq '"name": *"preview"'; then
    echo "Préversion demandée (label preview sur la PR #${REVIEW_ID})."
    exit 1
  fi
fi

echo "Préversion sautée : ni label preview ni [preview] dans le dernier commit. Les vérifications GitHub testent la PR."
exit 0
