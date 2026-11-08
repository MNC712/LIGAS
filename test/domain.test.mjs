// Unit tests for the domain rules that were derived from the public product:
// standings, player statistics and local-time conversion.
// Run with: node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { resetDb, run, ROOT } from "../src/db.mjs";
import {
  computeStandings, computePlayerStats,
  localDateTimeToUtc, slugify, hashPassword, verifyPassword,
  mulberry32, roundRobin, planSchedule, pairSeeds,
  computeGroupSeeds, computeQualifiers,
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
    id: 1, slug: "test-league", name: "Test League",
    points_win: 3, points_draw: 1, points_lose: 0,
    ranking_points: "DESC", ranking_goal_diff: "DESC",
    ranking_goals_scored: "DESC", ranking_wins: "DESC",
    ...overrides,
  };
  run(db, `INSERT INTO competition
      (id, slug, name, points_win, points_draw, points_lose,
       ranking_points, ranking_goal_diff, ranking_goals_scored, ranking_wins)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    c.id, c.slug, c.name, c.points_win, c.points_draw, c.points_lose,
    c.ranking_points, c.ranking_goal_diff, c.ranking_goals_scored, c.ranking_wins);
  return c;
}

function addTeam(db, id, name, { groupId = null } = {}) {
  run(db, "INSERT INTO team (id, slug, name) VALUES (?,?,?)", id, `team-${id}`, name);
  const ctId = id * 10;
  run(db, "INSERT INTO competition_team (id, competition_id, team_id, group_id) VALUES (?,?,?,?)", ctId, 1, id, groupId);
  return ctId;
}

function addGroup(db, id, name, ordering = 1) {
  run(db, "INSERT INTO competition_group (id, competition_id, name, slug, ordering) VALUES (?,?,?,?,?)",
    id, 1, name, name.toLowerCase().replace(/\s+/g, "-"), ordering);
}

function addGroupRound(db, id, groupId) {
  run(db, "INSERT INTO round (id, competition_id, group_id, stage, name, ordering) VALUES (?,?,?,'GROUP',?,1)",
    id, 1, groupId, `Ronda ${groupId}`);
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

/* -------------------------------------------------------------- round robin */

test("roundRobin pairs every team against every rival once", () => {
  const rounds = roundRobin([1, 2, 3, 4]);
  assert.equal(rounds.length, 3);
  const pairs = rounds.flat();
  assert.equal(pairs.length, 6);
  const keys = pairs.map(([a, b]) => [a, b].sort((x, y) => x - y).join("-"));
  assert.equal(new Set(keys).size, 6); // each pairing exactly once
  for (const rd of rounds) {
    assert.equal(new Set(rd.flat()).size, 4); // each team plays once per round
  }
});

test("roundRobin handles odd team counts with byes", () => {
  const rounds = roundRobin([1, 2, 3]);
  assert.equal(rounds.length, 3);
  const keys = rounds.flat().map(([a, b]) => [a, b].sort((x, y) => x - y).join("-")).sort();
  assert.deepEqual(keys, ["1-2", "1-3", "2-3"]);
});

test("roundRobin double leg mirrors home and away, shuffled deterministically", () => {
  const a = roundRobin([1, 2, 3, 4], { doubleRound: true, random: mulberry32(42) });
  const b = roundRobin([1, 2, 3, 4], { doubleRound: true, random: mulberry32(42) });
  assert.deepEqual(a, b); // the same seed redraws the same fixtures
  assert.equal(a.length, 6);
  const pairs = a.flat();
  assert.equal(pairs.length, 12);
  const ordered = pairs.map(([h, w]) => `${h}>${w}`);
  assert.equal(new Set(ordered).size, 12); // each oriented pairing once
  const unordered = new Map();
  for (const [h, w] of pairs) {
    const k = [h, w].sort((x, y) => x - y).join("-");
    unordered.set(k, (unordered.get(k) || 0) + 1);
  }
  for (const count of unordered.values()) assert.equal(count, 2); // home and away
});

/* ------------------------------------------------------------ auto schedule */

test("planSchedule never places a team twice on the same day", () => {
  const games = [
    { id: 1, home: "A", away: "B" },
    { id: 2, home: "A", away: "C" },
    { id: 3, home: "B", away: "C" },
  ];
  const { assignments, unscheduled } = planSchedule(games, {
    startDate: "2026-03-01", fromTime: "18:00", toTime: "23:00", slotMinutes: 60,
  });
  assert.deepEqual(unscheduled, []);
  assert.equal(assignments.length, 3);
  const days = new Set();
  for (const a of assignments) {
    const g = games.find((x) => x.id === a.id);
    for (const t of [g.home, g.away]) {
      const key = `${t}|${a.date}`;
      assert.ok(!days.has(key), `team ${t} twice on ${a.date}`);
      days.add(key);
    }
  }
});

test("planSchedule never double-books a pitch but shares slots across pitches", () => {
  const games = [
    { id: 1, home: "A", away: "B" },
    { id: 2, home: "C", away: "D" },
    { id: 3, home: "E", away: "F" },
  ];
  const one = planSchedule(games, {
    startDate: "2026-03-01", fromTime: "18:00", toTime: "23:00", slotMinutes: 60, pitchIds: [1],
  });
  const slots = one.assignments.map((a) => `${a.date} ${a.time}`);
  assert.equal(new Set(slots).size, 3); // one pitch: three distinct slots
  const two = planSchedule(games, {
    startDate: "2026-03-01", fromTime: "18:00", toTime: "23:00", slotMinutes: 60, pitchIds: [1, 2],
  });
  const [first, second] = two.assignments;
  assert.equal(`${first.date} ${first.time}`, `${second.date} ${second.time}`); // parallel slots
  assert.notEqual(first.pitchId, second.pitchId);
});

test("planSchedule respects existing team and pitch occupancy", () => {
  const busyTeams = new Map([["A", new Map([["2026-03-01", 1]])]]);
  const busyPitches = new Map([[1, new Set(["2026-03-02 18:00"])]]);
  const { assignments, unscheduled } = planSchedule([{ id: 1, home: "A", away: "B" }], {
    startDate: "2026-03-01", fromTime: "18:00", toTime: "23:00", slotMinutes: 60,
    pitchIds: [1], busyTeams, busyPitches,
  });
  assert.deepEqual(unscheduled, []);
  assert.equal(assignments[0].date, "2026-03-02"); // A already plays on the 1st
  assert.equal(assignments[0].time, "19:00"); // the 18:00 slot is taken on pitch 1
});

/* ------------------------------------------------------------------- seeds */

test("pairSeeds matches best against worst and grants a bye to the top seed", () => {
  const s = (n) => ({ seed: n, team_name: `T${n}` });
  const four = pairSeeds([s(1), s(2), s(3), s(4)]);
  assert.equal(four.bye, null);
  assert.deepEqual(four.pairs.map(([a, b]) => [a.seed, b.seed]), [[1, 4], [2, 3]]);
  const five = pairSeeds([s(1), s(2), s(3), s(4), s(5)]);
  assert.equal(five.bye.seed, 1);
  assert.deepEqual(five.pairs.map(([a, b]) => [a.seed, b.seed]), [[2, 5], [3, 4]]);
});

test("computeGroupSeeds ranks mixed-size groups with adjusted records", (t) => {
  const db = useDb(t);
  addCompetition(db);
  addGroup(db, 1, "Grupo A", 1);
  addGroup(db, 2, "Grupo B", 2);
  const a1 = addTeam(db, 1, "A1", { groupId: 1 });
  const a2 = addTeam(db, 2, "A2", { groupId: 1 });
  const a3 = addTeam(db, 3, "A3", { groupId: 1 });
  const b1 = addTeam(db, 4, "B1", { groupId: 2 });
  const b2 = addTeam(db, 5, "B2", { groupId: 2 });
  const b3 = addTeam(db, 6, "B3", { groupId: 2 });
  const b4 = addTeam(db, 7, "B4", { groupId: 2 });
  addGroupRound(db, 1, 1);
  addGroupRound(db, 2, 2);
  // Group A (3 teams): A1 wins twice, A2 beats A3.
  addGame(db, 1, { roundId: 1, home: a1, away: a2, scoreHome: 2, scoreAway: 0, date: "2026-01-03T17:00:00.000Z" });
  addGame(db, 2, { roundId: 1, home: a1, away: a3, scoreHome: 1, scoreAway: 0, date: "2026-01-10T17:00:00.000Z" });
  addGame(db, 3, { roundId: 1, home: a2, away: a3, scoreHome: 3, scoreAway: 0, date: "2026-01-17T17:00:00.000Z" });
  // Group B (4 teams): B1 wins everything, B2 second, B4 last without a point.
  addGame(db, 4, { roundId: 2, home: b1, away: b2, scoreHome: 2, scoreAway: 0, date: "2026-01-03T17:00:00.000Z" });
  addGame(db, 5, { roundId: 2, home: b1, away: b3, scoreHome: 2, scoreAway: 0, date: "2026-01-10T17:00:00.000Z" });
  addGame(db, 6, { roundId: 2, home: b1, away: b4, scoreHome: 5, scoreAway: 0, date: "2026-01-17T17:00:00.000Z" });
  addGame(db, 7, { roundId: 2, home: b2, away: b3, scoreHome: 1, scoreAway: 0, date: "2026-01-24T17:00:00.000Z" });
  addGame(db, 8, { roundId: 2, home: b2, away: b4, scoreHome: 4, scoreAway: 0, date: "2026-01-31T17:00:00.000Z" });
  addGame(db, 9, { roundId: 2, home: b3, away: b4, scoreHome: 2, scoreAway: 0, date: "2026-02-07T17:00:00.000Z" });

  const seeds = computeGroupSeeds(db, 1);
  assert.equal(seeds.length, 7);
  const byName = Object.fromEntries(seeds.map((s) => [s.team_name, s]));

  // Winners of each group qualify, plus the best runner-up across groups.
  assert.deepEqual(seeds.filter((s) => s.qualified).map((s) => s.team_name), ["B1", "A1", "A2"]);
  assert.equal(byName.A2.bestRunnerUp, true);
  assert.equal(byName.B2.qualified, false);

  // Adjusted record: games against the bottom side of the larger group do not
  // count, so B1's 5-0 over B4 is discarded from its adjusted record.
  assert.equal(byName.B1.points, 6);
  assert.equal(byName.B1.goals_diff, 4);
  assert.equal(byName.B2.points, 3);
  assert.equal(byName.B2.goals_diff, -1);
  assert.equal(byName.B4.goals_diff, 0); // no counting games left

  // Overall order: adjusted points, then goal difference.
  assert.deepEqual(seeds.slice(0, 4).map((s) => s.team_name), ["B1", "A1", "A2", "B2"]);
  assert.deepEqual(seeds.map((s) => s.seed), [1, 2, 3, 4, 5, 6, 7]);

  const qualifiers = computeQualifiers(db, 1);
  assert.deepEqual(qualifiers.map((s) => s.team_name), ["B1", "A1", "A2"]);
});
