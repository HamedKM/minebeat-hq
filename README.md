# Minebeat HQ

Panneau central de tous les projets Minebeat Studios — https://hq.minebeat.org

- `index.html` : la page (aucune donnée dedans).
- `supabase/functions/hq` : copie du service qui rassemble les chiffres (projet Supabase « Paradisme »).
  Les données ne sont envoyées qu'avec le mot de passe `HQ_PASSWORD` (secret Supabase).
  Quiet Sense est lu via `https://quiet-sense.com/api/hq/summary` avec la clé `HQ_KEY` (même valeur dans Supabase et Cloudflare).
