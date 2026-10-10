# Pronos NBA 2026-27

Le jeu de pronos de la saison NBA entre potes : chacun classe les 30 équipes (bilans), répond à
13 questions (MVP, ROY, champion…) et déclare jusqu'à 5 hot takes 🔥 avant le premier match. Tout
se verrouille au coup d'envoi, puis le classement se met à jour tout seul pendant la saison.

## Stack

- Next.js 16 (App Router), React 19, TypeScript, CSS Modules
- Postgres (Neon, via la Vercel Marketplace), hébergé sur Vercel
- Données : API JSON publiques d'ESPN (classements, effectifs, trophées, cotes DraftKings)
- Pas de service payant, pas d'IA : les points sont calculés par des formules (`src/lib/scoring.ts`)

## Lancer en local

```bash
npm install
npx vercel env pull .env.local   # DATABASE_URL, SESSION_SECRET, ADMIN_PSEUDO, CRON_SECRET
npm run db:schema
npm run dev
```

`npm test` lance les tests (barème, validation, parsing ESPN). `LOCK_AT_OVERRIDE` (dans
`.env.local`, jamais en production) permet de tester les pages d'après-verrouillage.

## Une nouvelle saison

Tout ce qui dépend de la saison est dans `src/config/` : dates et verrouillage (`season.ts`),
lignes des bookmakers (`bookmaker-lines.ts`), questions (`questions.ts`), barème (`scoring.ts`).
Ensuite `npm run data` régénère équipes, joueurs et coachs depuis ESPN.
