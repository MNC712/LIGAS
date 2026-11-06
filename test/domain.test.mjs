// Unit tests for the domain rules that were derived from the public product:
// standings, player statistics, round-robin pairings, schedule generation and
// local-time conversion. Run with: node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { resetDb, run, ROOT } from "../src/db.mjs";
import {
  computeStandings, computePlayerStats, roundRobin, generateSchedule,
  localDateTimeToUtc, slugify, hashPassword, verifyPassword,
} from "../src/domain.mjs";

const DB_PATH = join(ROOT, ".cache", "test-domain.db");

function freshDb() {
  return resetDb(DB_PATH);
}

function useDb(t) {
  const db = freshDb();
  t.after(() => {
    try { db.close(); } catch {}
    removeDb();
  });
  return db;
}

function removeDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
}

test.after(removeDb);

/* ------------------------------------------------------------------ helpers */

function addCompetition(db, overrides = {}) {
  const c = {
    id: 1, slug: "test-league", name: "Test League", type: "LEAGUE",
    points_win: 3, points_draw: 1, points_lose: 0,
    ranking_points: "DESC", ranking_goal_diff: "DESC",
    ranking_goals_scored: "DESC", ranking_wins: "DESC",
    ...overrides,
  };
  run(db, `INSERT INTO competition
      (id, slug, name, type, points_win, points_draw, points_lose,
       ranking_points, ranking_goal_diff, ranking_goals_scored, ranking_wins)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    c.id, c.slug, c.name, c.type, c.points_win, c.points_draw, c.points_lose,
    c.ranking_points, c.ranking_goal_diff, c.ranking_goals_scored, c.ranking_wins);
  return c;
}

function addTeam(db, id, name) {
  run(db, "INSERT INTO team (id, slug, name) VALUES (?,?,?)", id, `team-${id}`, name);
  const ctId = id * 10;
  run(db, "INSERT INTO competition_team (id, competition_id, team_id) VALUES (?,?,?)", ctId, 1, id);
  return ctId;
}

function addRound(db, id, competitionId = 1, name = "Kolejka 1") {
  run(db, "INSERT INTO round (id, competition_id, name) VALUES (?,?,?)", id, competitionId, name);
}

function addGame(db, id, { roundId = 1, status = "FINISHED", home, away, scoreHome = null, scoreAway = null, date = "2026-01-10T17:00:00.000Z" }) {
  run(db, `INSERT INTO game (id, round_id, game_date, status, score_home, score_away, stats_counted)
    VALUES (?,?,?,?,?,?,1)`, id, roundId, date, status, scoreHome, scoreAway);
  run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?,?,'HOME')", id, home);
  run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?,?,'AWAY')", id, away);
}

function seedEventTypes(db) {
  const types = { goal: 1, own_goal: 2, yellow_card: 3, red_card: 4, assist: 5, mvp: 6 };
  for (const [system, id] of Object.entries(types)) {
    run(db, "INSERT INTO event_type (id, name, system_name) VALUES (?,?,?)", id, system, system);
  }
}

/* --------------------------------------------------------------- roundRobin */

test("roundRobin schedules every pair once per leg without repeats", () => {
  const single = roundRobin([1, 2, 3, 4], { doubleRound: false });
  assert.equal(single.length, 3);
  for (const round of single) {
    assert.equal(round.length, 2);
    assert.equal(new Set(round.flat()).size, 4);
  }
  const pairs = single.flat().map(([a, b]) => `${a}-${b}`);
  assert.equal(new Set(pairs).size, 6);

  const double = roundRobin([1, 2, 3, 4], { doubleRound: true });
  assert.equal(double.length, 6);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(double[i + 3], double[i].map(([a, b]) => [b, a]));
  }
});

test("roundRobin handles an odd number of teams with a bye", () => {
  const rounds = roundRobin([1, 2, 3], { doubleRound: false });
  assert.equal(rounds.length, 3);
  assert.equal(rounds.flat().length, 3);
  for (const round of rounds) assert.equal(round.length, 1);
});

/* --------------------------------------------------------- timezone helper */

test("localDateTimeToUtc converts Warsaw wall-clock time across DST", () => {
  assert.equal(localDateTimeToUtc("2026-01-10", "18:00").toISOString(), "2026-01-10T17:00:00.000Z");
  assert.equal(localDateTimeToUtc("2026-07-11", "18:00").toISOString(), "2026-07-11T16:00:00.000Z");
  assert.equal(localDateTimeToUtc("2026-06-01", "09:30", "UTC").toISOString(), "2026-06-01T09:30:00.000Z");
  assert.throws(() => localDateTimeToUtc("not-a-date", "18:00"));
});

/* ---------------------------------------------------------------- slug + auth */

test("slugify transliterates Polish letters", () => {
  assert.equal(slugify("Puchar AQUA Open Ligi Halowej"), "puchar-aqua-open-ligi-halowej");
  assert.equal(slugify("Łódź Ąę"), "lodz-ae");
});

test("password hashes verify only the original password", () => {
  const { hash, salt } = hashPassword("Admin123!");
  assert.equal(verifyPassword("Admin123!", salt, hash), true);
  assert.equal(verifyPassword("admin123!", salt, hash), false);
});

/* ---------------------------------------------------------------- standings */

test("computeStandings ranks by points, goal difference, goals and wins", (t) => {
  const db = useDb(t);
  addCompetition(db);
  const a = addTeam(db, 1, "Alpha");
  const b = addTeam(db, 2, "Beta");
  const c = addTeam(db, 3, "Gamma");
  addRound(db, 1);
  addGame(db, 1, { home: a, away: b, scoreHome: 2, scoreAway: 1, date: "2026-01-10T17:00:00.000Z" });
  addGame(db, 2, { home: c, away: b, scoreHome: 3, scoreAway: 0, date: "2026-01-17T17:00:00.000Z" });
  addGame(db, 3, { home: a, away: c, scoreHome: 0, scoreAway: 0, date: "2026-01-24T17:00:00.000Z" });
  // Finished but scoreless: counts as played, awards nothing (observed rule).
  addGame(db, 4, { home: b, away: c, scoreHome: null, scoreAway: null, date: "2026-01-31T17:00:00.000Z" });

  const table = computeStandings(db, 1);
  const byName = Object.fromEntries(table.map((r) => [r.team_name, r]));

  assert.equal(byName.Alpha.points, 4);
  assert.equal(byName.Alpha.games_played, 2);
  assert.equal(byName.Alpha.goals_diff, 1);
  assert.equal(byName.Beta.games_played, 3);
  assert.equal(byName.Beta.points, 0);
  assert.equal(byName.Gamma.games_played, 3);
  assert.equal(byName.Gamma.points, 4);
  assert.equal(byName.Gamma.goals_diff, 3);

  assert.deepEqual(table.map((r) => r.team_name), ["Gamma", "Alpha", "Beta"]);
  assert.deepEqual(table.map((r) => r.place), [1, 2, 3]);
  assert.equal(byName.Alpha.position_delta, 0);
  assert.deepEqual(byName.Alpha.form, ["D", "W"]);
});

test("computeStandings ignores unfinished games and respects stored points", (t) => {
  const db = useDb(t);
  addCompetition(db, { points_win: 2, points_draw: 1 });
  const a = addTeam(db, 1, "Alpha");
  const b = addTeam(db, 2, "Beta");
  addRound(db, 1);
  addGame(db, 1, { home: a, away: b, scoreHome: 1, scoreAway: 1 });
  addGame(db, 2, { home: a, away: b, status: "STARTED", scoreHome: 4, scoreAway: 0 });

  const table = computeStandings(db, 1);
  assert.equal(table[0].points, 1);
  assert.equal(table[0].games_played, 1);
  assert.equal(table[0].goals_scored, 1);
});

/* --------------------------------------------------------- player statistics */

test("computePlayerStats adds captured events on top of the published base", (t) => {
  const db = useDb(t);
  addCompetition(db);
  const a = addTeam(db, 1, "Alpha");
  const b = addTeam(db, 2, "Beta");
  run(db, "INSERT INTO player (id, slug, first_name, last_name) VALUES (1,'jan-kowalski','Jan','Kowalski')");
  run(db, "INSERT INTO competition_player (id, competition_id, competition_team_id, player_id, squad_number) VALUES (10,1,?,1,7)", a);
  run(db, "INSERT INTO player_stat_base (competition_player_id, games, goals, assists, mvp, yellow, red) VALUES (10,5,3,1,0,1,0)");
  seedEventTypes(db);
  addRound(db, 1);
  addGame(db, 1, { home: a, away: b, scoreHome: 2, scoreAway: 0 });
  run(db, "INSERT INTO game_player (id, game_id, competition_player_id) VALUES (100,1,10)");
  run(db, "INSERT INTO event (game_id, game_player_id, event_type_id, time) VALUES (1,100,1,12)");
  run(db, "INSERT INTO event (game_id, game_player_id, event_type_id, time) VALUES (1,100,1,30)");
  run(db, "INSERT INTO event (game_id, game_player_id, event_type_id, time) VALUES (1,100,3,40)");

  const [row] = computePlayerStats(db, 1);
  assert.equal(row.full_name, "Jan Kowalski");
  assert.equal(row.games_played, 5);
  assert.equal(row.goals_scored, 5);
  assert.equal(row.assists, 1);
  assert.equal(row.yellow_cards, 2);
  assert.equal(row.red_cards, 0);
});

/* -------------------------------------------------------- schedule generator */

test("generateSchedule creates weekly Kolejka rounds at the local kick-off time", (t) => {
  const db = useDb(t);
  addCompetition(db);
  for (const [id, name] of [[1, "Alpha"], [2, "Beta"], [3, "Gamma"], [4, "Delta"]]) addTeam(db, id, name);

  const created = generateSchedule(db, 1, {
    startDate: "2026-01-05", weekday: 6, times: ["18:00", "19:30"],
    doubleRound: false, timeZone: "Europe/Warsaw",
  });

  assert.equal(created.length, 3);
  assert.deepEqual(created.map((r) => r.roundName), ["Kolejka 1", "Kolejka 2", "Kolejka 3"]);
  assert.deepEqual(created.map((r) => r.games.length), [2, 2, 2]);

  const games = db.prepare("SELECT game_date FROM game ORDER BY id").all();
  // First Saturday on/after 2026-01-05 is 10 January; 18:00 CET is 17:00Z.
  assert.equal(games[0].game_date, "2026-01-10T17:00:00.000Z");
  assert.equal(games[1].game_date, "2026-01-10T18:30:00.000Z");
  assert.equal(games[2].game_date, "2026-01-17T17:00:00.000Z");
});
