// Wipe the sports data so a competition can be rebuilt from scratch.
//
// Kept on purpose: the organisation, the competition/season shell, the
// event-type catalogue, the settings and the user accounts. The admin console
// can edit competitions, but the shell stays so there is always a place to
// register teams, groups, rounds and matches.
// Run: node scripts/reset.mjs
import { openDb, run, get, DB_PATH } from "../src/db.mjs";

// Children first, so explicit deletes never depend on cascade ordering.
const TABLES = [
  "session", "event", "game_player", "game_team", "game",
  "player_stat_base", "competition_player", "competition_team", "round",
  "competition_group", "team_image", "team", "player", "pitch", "change_log",
  "sponsor",
];

const db = openDb();
const count = (t) => get(db, `SELECT COUNT(*) AS n FROM ${t}`).n;

const before = Object.fromEntries(TABLES.map((t) => [t, count(t)]));

db.exec("BEGIN");
try {
  for (const t of TABLES) run(db, `DELETE FROM ${t}`);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const removed = TABLES.map((t) => [t, before[t]]).filter(([, n]) => n > 0);
console.log(`Reset ${DB_PATH}`);
for (const [table, n] of removed) console.log(`  -${String(n).padStart(4)}  ${table}`);
console.log(`Kept: competition=${count("competition")} season=${count("season")}` +
  ` event_type=${count("event_type")} user=${count("user")} organization=${count("organization")}`);

db.close();
