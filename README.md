# FLM clone

A local, full-stack recreation of the FLM System league-management product,
built exclusively from publicly observable behaviour of
https://www.flmsystem.com/us/solutions/futsal and the public league site
hosted on it (AQUA OPEN liga halowa, https://aquaopen.flmsystem.com).

Nothing was invented: public data, page structure and ranking rules come from
the observed product. Where a behaviour cannot be observed without an account
(the admin console and the referee app), the implementation is an explicitly
documented, inferred design — see [Observed vs inferred](#observed-vs-inferred).

## Stack

- Node.js ≥ 22.5, zero runtime dependencies.
- `node:sqlite` (built-in SQLite), `node:http`, a tiny server-side rendering
  layer (`src/render.mjs`), plain CSS/JS in `public/`.

## Getting started

```sh
npm run seed      # load data/raw.json into data/flm.db
npm start         # serve http://127.0.0.1:5173
```

| Surface | URL | Seeded credentials |
| --- | --- | --- |
| Public league site | http://127.0.0.1:5173/en | — |
| Admin console | http://127.0.0.1:5173/admin | `admin@aquaopen.local / Admin123!` |
| Referee app | http://127.0.0.1:5173/referee | `referee@aquaopen.local / Referee123!` |

Useful commands:

```sh
npm run harvest   # re-capture the public dataset into data/raw.json
npm run verify    # compare computed standings + player stats against the capture
npm test          # domain unit tests (standings, stats, round-robin, timezones)
npm run smoke     # end-to-end write-path test against a throwaway DB + server
```

## Architecture

```
scripts/harvest.mjs  → data/raw.json   reproducible capture from the public GraphQL API
src/seed.mjs         → data/flm.db     loads the capture; splits published aggregates into
                                       player_stat_base + captured events
src/db.mjs            schema + connection (organization, team, player, competition,
                       round, game, game_team, game_player, event, user, session, …)
src/domain.mjs        standings, player stats, round-robin, schedule generation,
                       timezone conversion, password hashing, slugification
src/repo.mjs          shared queries (competitions, games, events, teams, players)
src/public-views.mjs  public site (tables, schedule, results, player list, teams,
                       match centre, cup bracket, archive, calendar, gallery, contact)
src/admin-views.mjs   admin console + referee app screens
src/server.mjs        routing, sessions (scrypt + cookie), write endpoints
public/referee.js     persistent match clock (localStorage, no server state)
```

The layered rule is: views read through `repo` and `domain` only; writes live in
`server.mjs` and always recompute derived state (score from goal events, player
stat bases on match finish) rather than trusting posted values.

## Observed vs inferred

| Area | Status |
| --- | --- |
| Dataset (21 teams, 199 player records, 85 games, 493 events, standings, player stats) | **Observed** — harvested from the public GraphQL API (`api.flmsystem.com/graphql-api`, anonymous). |
| Public URL structure (`/en/league-menu/{league}/{season}/…`, `/en/tournament-menu/{cup}/…`, archive, calendar) | **Observed**. |
| Visual tokens (primary `#006fff`, secondary `#0500ff`, accent `#e1e9f4`, Inter, layout) | **Observed** from the site's CSS and pages. |
| Standings rule: 3/1/0, finished scoreless games count as played, tie-break order points → GD → GF → wins, position deltas | **Observed** — reproduces the published table exactly (verified by `npm run verify`). |
| Player stats: published totals reproduced as base + captured events | **Observed** — `npm run verify` shows 0/108 mismatches. |
| Cup bracket + final standings rendering | **Observed** (bracket generation itself is not implemented — not observable without write access). |
| Admin console screens (teams, players, competitions, schedule, games, messages, settings) | **Inferred** — designed from the data model and what the public site exposes. |
| Referee app (match clock, event recording, squads, status changes) | **Inferred** — same reasoning. |
| Round naming (`Kolejka N`), `Europe/Warsaw` kick-off times, 10-minute halves | **Observed** from the seeded data. |

## Verification

- `npm test` — 9 domain unit tests (all pass).
- `npm run smoke` — 11 end-to-end checks covering login, admin event add/delete
  with automatic score recomputation, final result save, referee status/score/
  squad flows, and timezone-correct schedule generation (all pass).
- `npm run verify` — computed standings and player stats match the captured
  publication exactly.

## Limitations

- Single organization, single language (English); the observed product
  supports more, but only one dataset was captured.
- Cup brackets are rendered, not generated (behaviour not observable).
- News, gallery and contact pages are seeded from the capture; a CMS was not
  inferred.
- Authentication is local-only (scrypt, HttpOnly session cookie); there is no
  password reset flow, as none could be observed.
