// End-to-end smoke test for the write paths (admin console + referee app).
// It seeds a throwaway database, starts the real HTTP server on its own port,
// drives the public CLI-like form endpoints and checks the stored result.
// Run with: node scripts/smoke.mjs
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { ROOT } from "../src/db.mjs";

const NODE = process.execPath;
const PORT = Number(process.env.SMOKE_PORT || 5199);
const BASE = `http://127.0.0.1:${PORT}`;
const WORK = join(ROOT, ".cache", "smoke");
const DB_PATH = join(WORK, "smoke.db");
const ADMIN = { email: "admin@aquaopen.local", password: "Admin123!" };
const REFEREE = { email: "referee@aquaopen.local", password: "Referee123!" };

let server;

function cleanup() {
  if (server && !server.killed) server.kill();
  try { rmSync(WORK, { recursive: true, force: true }); } catch {}
}

async function waitFor(url, attempts = 75) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not start at ${url}`);
}

function makeClient() {
  let cookie = "";
  return async function request(path, { method = "GET", form } = {}) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    let body;
    if (form) {
      body = new URLSearchParams(form).toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    const res = await fetch(BASE + path, { method, headers, body, redirect: "manual" });
    for (const value of res.headers.getSetCookie?.() || []) {
      const pair = value.split(";")[0];
      if (pair.startsWith("flm_session=")) cookie = pair;
    }
    return { status: res.status, location: res.headers.get("location"), text: await res.text() };
  };
}

function openReader() {
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

const read = (sql, ...params) => {
  const db = openReader();
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
};

function newRoundId() {
  const [row] = read("SELECT COALESCE(MAX(id),0) id FROM round");
  return row.id;
}

try {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  execFileSync(NODE, [join(ROOT, "src", "seed.mjs")], {
    env: { ...process.env, FLM_DB: DB_PATH }, stdio: "pipe",
  });

  server = spawn(NODE, [join(ROOT, "src", "server.mjs")], {
    env: { ...process.env, FLM_DB: DB_PATH, PORT: String(PORT) },
    stdio: "pipe",
  });
  await waitFor(`${BASE}/en`);

  const publicSite = makeClient();
  const admin = makeClient();
  const referee = makeClient();
  const steps = [];
  const check = async (name, fn) => { await fn(); steps.push(name); };

  const [target] = read(`
    SELECT g.id, c.id competition_id,
      (SELECT COUNT(*) FROM event e WHERE e.game_id = g.id) events,
      COALESCE(c.slug, l.slug) competition_slug, s.slug season_slug, c.type competition_type
    FROM game g
    JOIN round r ON r.id = g.round_id
    JOIN competition c ON c.id = r.competition_id
    LEFT JOIN league l ON l.id = c.league_id
    LEFT JOIN season s ON s.id = c.season_id
    WHERE c.type = 'LEAGUE' AND g.status = 'FINISHED'
    ORDER BY events DESC, g.id
    LIMIT 1`);
  assert.ok(target, "seed must contain a finished league game");
  const gameId = target.id;
  const publicGamePath = target.competition_type === "CUP"
    ? `/en/tournament-menu/${target.competition_slug}/games/${gameId}`
    : `/en/league-menu/${target.competition_slug}/${target.season_slug}/games/${gameId}`;

  await check("public home renders the seeded organisation", async () => {
    const res = await publicSite("/en");
    assert.equal(res.status, 200);
    assert.match(res.text, /AQUA OPEN/);
  });

  await check("anonymous visitors cannot open the admin console", async () => {
    const res = await publicSite("/admin");
    assert.equal(res.status, 303);
    assert.match(res.location, /\/admin\/login/);
  });

  await check("admin login redirects to the dashboard", async () => {
    const res = await admin("/admin/login", { method: "POST", form: ADMIN });
    assert.equal(res.status, 303);
    assert.equal(res.location, "/admin");
    const page = await admin("/admin");
    assert.equal(page.status, 200);
    assert.match(page.text, /Dashboard/);
  });

  const [homePlayer] = read(`
    SELECT gp.competition_player_id cp_id
    FROM game_player gp
    JOIN game_team gt ON gt.game_id = gp.game_id AND gt.team_type = 'HOME'
    JOIN competition_player cp ON cp.id = gp.competition_player_id
    WHERE gp.game_id = ? AND cp.competition_team_id = gt.competition_team_id
    ORDER BY gp.id LIMIT 1`, gameId);
  assert.ok(homePlayer, "the target game must have a home squad player");
  const [goalType] = read("SELECT id FROM event_type WHERE system_name = 'goal'");

  const scoreBefore = read(
    `SELECT
       SUM(CASE WHEN et.system_name = 'goal' AND cp.competition_team_id = home.competition_team_id THEN 1
                WHEN et.system_name = 'own_goal' AND cp.competition_team_id <> home.competition_team_id THEN 1
                ELSE 0 END) home_goals
     FROM event e
     JOIN event_type et ON et.id = e.event_type_id
     JOIN game_player gp ON gp.id = e.game_player_id
     JOIN competition_player cp ON cp.id = gp.competition_player_id
     JOIN game_team home ON home.game_id = e.game_id AND home.team_type = 'HOME'
     WHERE e.game_id = ?`, gameId)[0];

  await check("admin records an event and the score is recomputed", async () => {
    const res = await admin(`/admin/games/${gameId}/events`, {
      method: "POST",
      form: { competition_player_id: homePlayer.cp_id, event_type_id: goalType.id, time: 77 },
    });
    assert.equal(res.status, 303);
    const [game] = read("SELECT score_home, score_away, status FROM game WHERE id = ?", gameId);
    assert.equal(game.score_home, (scoreBefore.home_goals || 0) + 1);
    const page = await publicSite(publicGamePath);
    assert.equal(page.status, 200);
    assert.match(page.text, new RegExp(`scoreboard-score">${game.score_home} - ${game.score_away}`));
  });

  const [added] = read(
    `SELECT e.id FROM event e JOIN game_player gp ON gp.id = e.game_player_id
      WHERE e.game_id = ? AND gp.competition_player_id = ? ORDER BY e.id DESC LIMIT 1`,
    gameId, homePlayer.cp_id);

  await check("admin deletes the event and the score returns", async () => {
    const res = await admin(`/admin/games/${gameId}/events/${added.id}/delete`, { method: "POST" });
    assert.equal(res.status, 303);
    const [game] = read("SELECT score_home FROM game WHERE id = ?", gameId);
    assert.equal(game.score_home, scoreBefore.home_goals || 0);
  });

  await check("admin saves a final result", async () => {
    const res = await admin(`/admin/games/${gameId}/save`, {
      method: "POST",
      form: {
        score_home: 6, score_away: 3, penalty_score_home: "", penalty_score_away: "",
        status: "FINISHED", code: "SMOKE-1", game_date: "",
      },
    });
    assert.equal(res.status, 303);
    const [game] = read("SELECT score_home, score_away, status, stats_counted FROM game WHERE id = ?", gameId);
    assert.deepEqual(
      { h: game.score_home, a: game.score_away, s: game.status, counted: game.stats_counted },
      { h: 6, a: 3, s: "FINISHED", counted: 1 });
    const page = await publicSite(publicGamePath);
    assert.match(page.text, /scoreboard-score">6 - 3/);
  });

  await check("public standings and player list render after the write", async () => {
    const table = await publicSite(`/en/league-menu/${target.competition_slug}/${target.season_slug}`);
    assert.equal(table.status, 200);
    const players = await publicSite(`/en/league-menu/${target.competition_slug}/${target.season_slug}/players-list`);
    assert.equal(players.status, 200);
    assert.match(players.text, /Full name/);
    assert.match(table.text, /Hand Dach/);
  });

  await check("referee logs in and sees the match list", async () => {
    const res = await referee("/admin/login", { method: "POST", form: REFEREE });
    assert.equal(res.status, 303);
    assert.equal(res.location, "/referee");
    const page = await referee("/referee");
    assert.equal(page.status, 200);
  });

  await check("referee changes status and corrects the score", async () => {
    let res = await referee(`/referee/game/${gameId}/status`, { method: "POST", form: { status: "BREAK" } });
    assert.equal(res.status, 303);
    res = await referee(`/referee/game/${gameId}/score`, { method: "POST", form: { score_home: 2, score_away: 2 } });
    assert.equal(res.status, 303);
    const [game] = read("SELECT score_home, score_away, status FROM game WHERE id = ?", gameId);
    assert.deepEqual({ h: game.score_home, a: game.score_away, s: game.status }, { h: 2, a: 2, s: "BREAK" });
  });

  await check("referee saves a squad subset", async () => {
    const squad = read("SELECT DISTINCT competition_player_id id FROM game_player WHERE game_id = ? ORDER BY id", gameId);
    assert.ok(squad.length >= 2);
    const keep = squad.slice(0, 1).map((p) => p.id);
    const res = await referee(`/referee/game/${gameId}/squad`, {
      method: "POST", form: { player: keep },
    });
    assert.equal(res.status, 303);
    const remaining = read("SELECT competition_player_id id FROM game_player WHERE game_id = ?", gameId);
    const withEvents = read(`SELECT COUNT(DISTINCT gp.competition_player_id) n
      FROM game_player gp JOIN event e ON e.game_player_id = gp.id
      WHERE gp.game_id = ?`, gameId)[0].n;
    // Only players without recorded events can be removed.
    assert.ok(remaining.length <= squad.length);
    assert.ok(remaining.length >= withEvents);
    assert.ok(remaining.some((p) => keep.includes(p.id)));
  });

  await check("admin generates a timezone-correct weekly schedule", async () => {
    const before = newRoundId();
    const res = await admin("/admin/schedule/generate", {
      method: "POST",
      form: {
        competition_id: target.competition_id,
        start_date: "2027-01-02", weekday: 6, times: "18:00", pitch_id: "",
      },
    });
    assert.equal(res.status, 303);
    const rounds = read("SELECT id, name FROM round WHERE id > ? ORDER BY id", before);
    assert.ok(rounds.length > 0, "rounds should be created");
    assert.equal(rounds[0].name, "Kolejka 1");
    const games = read(`SELECT g.game_date FROM game g WHERE g.round_id = ? ORDER BY g.id`, rounds[0].id);
    // 18:00 CET on 2 January 2027 is 17:00Z.
    assert.equal(games[0].game_date, "2027-01-02T17:00:00.000Z");
  });

  console.log(`smoke: ${steps.length} checks passed`);
  for (const name of steps) console.log(`  ok  ${name}`);
  cleanup();
  process.exit(0);
} catch (error) {
  cleanup();
  console.error("smoke: FAILED");
  console.error(error);
  process.exit(1);
}
