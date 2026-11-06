import { openDb } from "../src/db.mjs";
import { computeStandings, computePlayerStats } from "../src/domain.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raw = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "raw.json"), "utf8"));
const db = openDb();
const standings = computeStandings(db, 58);
const observed = raw.standings[0].standings_positions;

let ok = true;
observed.forEach((o, i) => {
  const c = standings[i];
  const same =
    c.team_name === o.team_name && c.points === o.points &&
    c.games_played === o.games_played && c.goals_scored === o.goals_scored &&
    c.goals_conceded === o.goals_conceded && c.games_won === o.games_won &&
    c.games_drawn === o.games_draw && c.games_lost === o.games_lost;
  if (!same) {
    ok = false;
    console.log("MISMATCH", i, o.team_name, [o.points, o.games_played, o.games_won, o.games_draw, o.games_lost, o.goals_scored, o.goals_conceded],
      "vs", c.team_name, [c.points, c.games_played, c.games_won, c.games_draw, c.games_lost, c.goals_scored, c.goals_conceded]);
  }
});
console.log("standings match:", ok);
if (!ok) process.exitCode = 1;
console.table(standings.map((s) => ({ place: s.place, team: s.team_name, pts: s.points, p: s.games_played, w: s.games_won, d: s.games_drawn, l: s.games_lost, gf: s.goals_scored, ga: s.goals_conceded, gd: s.goals_diff, form: s.form.join("") })));

const stats = computePlayerStats(db, 58).sort((a, b) => b.goals_scored - a.goals_scored || a.full_name.localeCompare(b.full_name));
const observedPlayers = raw.players.filter((p) => p.competition_id === "58");
let mismatch = 0;
for (const o of observedPlayers) {
  const c = stats.find((x) => x.player_id === Number(o.player_id));
  if (!c) { mismatch++; continue; }
  if (c.goals_scored !== o.goals_scored || c.assists !== o.assists || c.mvp !== o.mvp ||
      c.yellow_cards !== o.yellow_cards || c.red_cards !== o.red_cards || c.games_played !== o.games_played) {
    mismatch++;
  }
}
console.log("player stat mismatches:", mismatch, "of", observedPlayers.length);
if (mismatch) process.exitCode = 1;
