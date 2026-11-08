// End-to-end smoke test for the write paths (admin console + referee app).
// It builds a throwaway database from the bootstrap defaults, starts the real
// HTTP server on its own port, drives the form endpoints and checks the stored
// result. Run with: node scripts/smoke.mjs
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { ROOT, openDb, run } from "../src/db.mjs";
import { ensureBootstrap } from "../src/bootstrap.mjs";
import { hashPassword, localParts } from "../src/domain.mjs";

const NODE = process.execPath;
const PORT = Number(process.env.SMOKE_PORT || 5199);
const BASE = `http://127.0.0.1:${PORT}`;
const WORK = join(ROOT, ".cache", "smoke");
const DB_PATH = join(WORK, "smoke.db");
// Passwords are generated per run so no credential is committed to the source.
const ADMIN = { email: "admin@liga.test", password: randomBytes(12).toString("base64url") };
const REFEREE = { email: "referee@liga.test", password: randomBytes(12).toString("base64url") };

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
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(form)) {
        if (Array.isArray(value)) for (const item of value) params.append(key, item);
        else params.append(key, value);
      }
      body = params.toString();
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
const run2 = (sql, ...params) => {
  const db = openDb(DB_PATH);
  try { run(db, sql, ...params); } finally { db.close(); }
};

try {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  // Create the database in-process so the bootstrap administrator uses a known
  // password and a referee account exists for the staff flows.
  process.env.FLM_DB = DB_PATH;
  process.env.LIGAS_ADMIN_EMAIL = ADMIN.email;
  process.env.LIGAS_ADMIN_PASSWORD = ADMIN.password;
  const setup = openDb(DB_PATH);
  ensureBootstrap(setup);
  const { hash, salt } = hashPassword(REFEREE.password);
  run(setup, "INSERT INTO user (email, name, password_hash, password_salt, role) VALUES (?,?,?,?,?)",
    REFEREE.email, "Árbitro", hash, salt, "REFEREE");
  setup.close();

  server = spawn(NODE, [join(ROOT, "src", "server.mjs")], {
    env: { ...process.env, FLM_DB: DB_PATH, PORT: String(PORT) },
    stdio: "pipe",
  });
  await waitFor(`${BASE}/es`);

  const publicSite = makeClient();
  const admin = makeClient();
  const referee = makeClient();
  const steps = [];
  const check = async (name, fn) => { await fn(); steps.push(name); };

  const [competition] = read("SELECT id, slug, name FROM competition ORDER BY id LIMIT 1");
  assert.ok(competition, "bootstrap must create a competition");

  await check("public home renders the site", async () => {
    const res = await publicSite("/es");
    assert.equal(res.status, 200);
    assert.match(res.text, /Mi Liga/);
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
    assert.match(page.text, /Panel/);
  });

  await check("admin creates a league, a tournament and a cup from templates", async () => {
    const created = [];
    for (const [name, kind] of [["Liga Test", "LIGA"], ["Torneo Test", "TORNEO"], ["Copa Test", "COPA"]]) {
      const res = await admin("/admin/competitions/create", {
        method: "POST", form: { name, kind, season_id: "" },
      });
      assert.equal(res.status, 303);
      const [c] = read("SELECT id, kind FROM competition WHERE name = ? ORDER BY id DESC LIMIT 1", name);
      assert.ok(c, `competition ${name} should exist`);
      assert.equal(c.kind, kind);
      created.push(c);
    }
    const [liga, torneo, copa] = created;
    // LIGA: one group, no playoff rounds.
    assert.equal(read("SELECT COUNT(*) n FROM competition_group WHERE competition_id = ?", liga.id)[0].n, 1);
    assert.equal(read("SELECT COUNT(*) n FROM round WHERE competition_id = ? AND stage = 'PLAYOFF'", liga.id)[0].n, 0);
    // TORNEO: two groups + two playoff rounds.
    assert.equal(read("SELECT COUNT(*) n FROM competition_group WHERE competition_id = ?", torneo.id)[0].n, 2);
    assert.equal(read("SELECT COUNT(*) n FROM round WHERE competition_id = ? AND stage = 'PLAYOFF'", torneo.id)[0].n, 2);
    // COPA: no groups, four playoff rounds.
    assert.equal(read("SELECT COUNT(*) n FROM competition_group WHERE competition_id = ?", copa.id)[0].n, 0);
    assert.equal(read("SELECT COUNT(*) n FROM round WHERE competition_id = ? AND stage = 'PLAYOFF'", copa.id)[0].n, 4);
    // Clean up so they don't affect the rest of the smoke flow.
    for (const c of created) {
      run2("DELETE FROM game WHERE round_id IN (SELECT id FROM round WHERE competition_id = ?)", c.id);
      run2("DELETE FROM competition WHERE id = ?", c.id);
    }
  });

  await check("admin creates a sponsor and the public home shows it", async () => {
    let res = await admin("/admin/sponsors/save", {
      method: "POST",
      form: { name: "Patrocinador Test", link_url: "https://example.com", logo_url: "https://example.com/logo.png", ordering: 1 },
    });
    assert.equal(res.status, 303);
    const [s] = read("SELECT id, active FROM sponsor WHERE name = 'Patrocinador Test'");
    assert.ok(s, "sponsor should exist");
    assert.equal(s.active, 1);
    const home = await publicSite("/es");
    assert.equal(home.status, 200);
    assert.match(home.text, /Nuestros patrocinadores/);
    assert.match(home.text, /Patrocinador Test/);
    // Footer also renders on other public pages.
    const comps = await publicSite("/es/competitions");
    assert.match(comps.text, /Patrocinador Test/);
    res = await admin(`/admin/sponsors/${s.id}/delete`, { method: "POST" });
    assert.equal(res.status, 303);
    assert.equal(read("SELECT COUNT(*) n FROM sponsor")[0].n, 0);
  });

  await check("admin creates two teams", async () => {
    for (const name of ["Equipo Alfa", "Equipo Beta"]) {
      const res = await admin("/admin/teams/save", { method: "POST", form: { name, competitions: String(competition.id) } });
      assert.equal(res.status, 303);
    }
    const teams = read("SELECT name FROM team ORDER BY name");
    assert.deepEqual(teams.map((t) => t.name), ["Equipo Alfa", "Equipo Beta"]);
  });

  const cts = read(`
    SELECT ct.id, t.name FROM competition_team ct JOIN team t ON t.id = ct.team_id
    WHERE ct.competition_id = ? ORDER BY t.name`, competition.id);
  const [alfa, beta] = cts;

  await check("admin adds players to each squad", async () => {
    const roster = [
      [alfa, "Ana", "1"], [alfa, "Bruno", "2"], [alfa, "Carla", "3"],
      [beta, "Diego", "1"], [beta, "Elena", "2"],
    ];
    for (const [ct, first, squad] of roster) {
      const res = await admin("/admin/players/save", {
        method: "POST",
        form: { first_name: first, last_name: ct.name.split(" ")[1], competition_team_id: String(ct.id), squad_number: squad },
      });
      assert.equal(res.status, 303);
    }
    assert.equal(read("SELECT COUNT(*) n FROM player")[0].n, 5);
  });

  let gameId;

  await check("admin builds a group, a round and a match by hand", async () => {
    // A group owns its own table; the admin creates it explicitly.
    let res = await admin(`/admin/competitions/${competition.id}/groups/save`, {
      method: "POST", form: { name: "Grupo A", ordering: 1 },
    });
    assert.equal(res.status, 303);
    const [group] = read("SELECT id FROM competition_group WHERE competition_id = ?", competition.id);
    assert.ok(group, "a group should be created");

    // Both squads are assigned to that group.
    const teamIds = read("SELECT id FROM team ORDER BY name").map((t) => t.id);
    res = await admin(`/admin/competitions/${competition.id}/teams/save`, {
      method: "POST",
      form: {
        teams: teamIds,
        [`group_${teamIds[0]}`]: String(group.id),
        [`group_${teamIds[1]}`]: String(group.id),
      },
    });
    assert.equal(res.status, 303);

    // A group-stage round (Jornada) with a fixed order.
    res = await admin(`/admin/competitions/${competition.id}/rounds/save`, {
      method: "POST",
      form: { name: "Jornada 1", stage: "GROUP", group_id: String(group.id), ordering: 1 },
    });
    assert.equal(res.status, 303);
    const [round] = read("SELECT id, name, stage FROM round WHERE competition_id = ?", competition.id);
    assert.equal(round.name, "Jornada 1");
    assert.equal(round.stage, "GROUP");

    // One match, registered by hand with a wall-clock kick-off time.
    res = await admin("/admin/games/create", {
      method: "POST",
      form: {
        competition_id: String(competition.id), round_id: String(round.id),
        home_ct: String(alfa.id), away_ct: String(beta.id),
        date: "2027-01-02", time: "18:00", code: "SMOKE-1",
      },
    });
    assert.equal(res.status, 303);
    const [game] = read("SELECT id, game_date FROM game WHERE round_id = ? ORDER BY id", round.id);
    assert.ok(game, `the round should contain a game (create redirected to ${res.location})`);
    gameId = game.id;
    // 18:00 in Buenos Aires (UTC-3, no DST) on 2 January 2027 is 21:00Z.
    assert.equal(game.game_date, "2027-01-02T21:00:00.000Z");
  });

  const [homeCt] = read("SELECT competition_team_id FROM game_team WHERE game_id = ? AND team_type = 'HOME'", gameId);
  const homeSquad = read("SELECT id FROM competition_player WHERE competition_team_id = ? ORDER BY id", homeCt.competition_team_id);
  const [goalType] = read("SELECT id FROM event_type WHERE system_name = 'goal'");
  const publicGamePath = `/es/competition/${competition.slug}/games/${gameId}`;

  await check("admin saves the match squad", async () => {
    assert.ok(homeSquad.length >= 2, "the home team needs at least two players");
    const res = await admin(`/admin/games/${gameId}/squad`, { method: "POST", form: { player: homeSquad.map((p) => p.id) } });
    assert.equal(res.status, 303);
    assert.equal(read("SELECT COUNT(*) n FROM game_player WHERE game_id = ?", gameId)[0].n, homeSquad.length);
  });

  await check("admin records an event and the score is recomputed", async () => {
    const res = await admin(`/admin/games/${gameId}/events`, {
      method: "POST",
      form: { competition_player_id: String(homeSquad[0].id), event_type_id: String(goalType.id), time: 77 },
    });
    assert.equal(res.status, 303);
    const [game] = read("SELECT score_home, score_away, status FROM game WHERE id = ?", gameId);
    assert.equal(game.score_home, 1);
    assert.equal(game.score_away, 0);
    const page = await publicSite(publicGamePath);
    assert.equal(page.status, 200);
    assert.match(page.text, new RegExp(`scoreboard-score"[^>]*>${game.score_home} - ${game.score_away}`));
  });

  await check("admin deletes the event and the score returns", async () => {
    const [added] = read("SELECT id FROM event WHERE game_id = ? ORDER BY id DESC LIMIT 1", gameId);
    const res = await admin(`/admin/games/${gameId}/events/${added.id}/delete`, { method: "POST" });
    assert.equal(res.status, 303);
    const [game] = read("SELECT score_home FROM game WHERE id = ?", gameId);
    assert.equal(game.score_home, 0);
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
    assert.match(page.text, /scoreboard-score"[^>]*>6 - 3/);
  });

  await check("public standings and player list render after the write", async () => {
    const table = await publicSite(`/es/competition/${competition.slug}`);
    assert.equal(table.status, 200);
    assert.match(table.text, /Equipo Alfa/);
    const players = await publicSite(`/es/competition/${competition.slug}/players-list`);
    assert.equal(players.status, 200);
    assert.match(players.text, /Nombre/);
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
    const keep = [squad[0].id];
    const res = await referee(`/referee/game/${gameId}/squad`, { method: "POST", form: { player: keep } });
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

  await check("futsal tournament: edit, draw, schedule, seed and finish", async () => {
    // 1. Tournament from the TORNEO template (two groups + two playoff rounds).
    let res = await admin("/admin/competitions/create", {
      method: "POST", form: { name: "Torneo Futsal", kind: "TORNEO", season_id: "" },
    });
    assert.equal(res.status, 303);
    const compId = read("SELECT id FROM competition WHERE name = 'Torneo Futsal'")[0].id;

    // 2. Full edit of the competition basics.
    res = await admin(`/admin/competitions/${compId}/save`, {
      method: "POST",
      form: {
        name: "Torneo Futsal 2027", slug: "", season_id: "",
        start_date: "2027-03-01", end_date: "2027-04-30", location: "Polideportivo Norte",
        half_time: "20", points_win: "3", points_draw: "1", points_lose: "0",
        ranking_points: "DESC", ranking_goal_diff: "DESC", ranking_goals_scored: "DESC",
        red_card_matches: "1", about: "", regulations: "",
      },
    });
    assert.equal(res.status, 303);
    const [edited] = read("SELECT name, start_date, end_date, location, half_time FROM competition WHERE id = ?", compId);
    assert.deepEqual({ ...edited }, {
      name: "Torneo Futsal 2027", start_date: "2027-03-01", end_date: "2027-04-30",
      location: "Polideportivo Norte", half_time: 20,
    });

    // 3. Seven teams: three in Grupo A, four in Grupo B (mixed sizes).
    const teamNames = ["Futsal Uno", "Futsal Dos", "Futsal Tres", "Futsal Cuatro", "Futsal Cinco", "Futsal Seis", "Futsal Siete"];
    for (const name of teamNames) {
      res = await admin("/admin/teams/save", { method: "POST", form: { name, competitions: String(compId) } });
      assert.equal(res.status, 303);
    }
    const [gA, gB] = read("SELECT id FROM competition_group WHERE competition_id = ? ORDER BY ordering", compId);
    const byName = Object.fromEntries(read(
      `SELECT t.id, t.name FROM team t JOIN competition_team ct ON ct.team_id = t.id WHERE ct.competition_id = ?`, compId
    ).map((r) => [r.name, r.id]));
    const assignForm = { teams: Object.values(byName).map(String) };
    for (const n of ["Futsal Uno", "Futsal Dos", "Futsal Tres"]) assignForm[`group_${byName[n]}`] = String(gA.id);
    for (const n of ["Futsal Cuatro", "Futsal Cinco", "Futsal Seis", "Futsal Siete"]) assignForm[`group_${byName[n]}`] = String(gB.id);
    res = await admin(`/admin/competitions/${compId}/teams/save`, { method: "POST", form: assignForm });
    assert.equal(res.status, 303);

    // 4. Random round-robin draw for the whole group stage, regenerable.
    const groupGames = () => read(`SELECT g.id, hct.team_id h, act.team_id a
      FROM game g JOIN round r ON r.id = g.round_id
      JOIN game_team ht ON ht.game_id = g.id AND ht.team_type = 'HOME' JOIN competition_team hct ON hct.id = ht.competition_team_id
      JOIN game_team at ON at.game_id = g.id AND at.team_type = 'AWAY' JOIN competition_team act ON act.id = at.competition_team_id
      WHERE r.competition_id = ? AND r.stage = 'GROUP'`, compId);
    res = await admin(`/admin/competitions/${compId}/fixtures/generate`, { method: "POST", form: { group_id: "" } });
    assert.equal(res.status, 303);
    assert.equal(groupGames().length, 9); // 3 pairings in group A (3 teams) + 6 in group B (4 teams)
    const pairKeys = groupGames().map(({ h, a }) => [h, a].sort((x, y) => x - y).join("-"));
    assert.equal(new Set(pairKeys).size, 9); // every rival faced exactly once
    res = await admin(`/admin/competitions/${compId}/fixtures/generate`, { method: "POST", form: { group_id: "" } });
    assert.equal(res.status, 303);
    assert.equal(groupGames().length, 9); // regeneration replaces, never duplicates

    // 5. Pitches and the automatic schedule: no overlaps for teams or pitches.
    for (const name of ["Cancha 1", "Cancha 2"]) {
      res = await admin("/admin/pitches/save", { method: "POST", form: { name, back: `/admin/competitions/${compId}` } });
      assert.equal(res.status, 303);
    }
    const pitchIds = read("SELECT id FROM pitch ORDER BY name").map((p) => String(p.id));
    res = await admin(`/admin/competitions/${compId}/fixtures/schedule`, {
      method: "POST",
      form: { start_date: "2027-03-01", from_time: "18:00", to_time: "23:00", slot_minutes: "60", max_per_day: "1", pitches: pitchIds },
    });
    assert.equal(res.status, 303);
    assert.match(res.location, /ok=/);
    const scheduled = read(`SELECT g.id, g.game_date, g.pitch_id, hct.team_id h, act.team_id a
      FROM game g JOIN round r ON r.id = g.round_id
      JOIN game_team ht ON ht.game_id = g.id AND ht.team_type = 'HOME' JOIN competition_team hct ON hct.id = ht.competition_team_id
      JOIN game_team at ON at.game_id = g.id AND at.team_type = 'AWAY' JOIN competition_team act ON act.id = at.competition_team_id
      WHERE r.competition_id = ? AND r.stage = 'GROUP'`, compId);
    assert.equal(scheduled.length, 9);
    assert.ok(scheduled.every((g) => g.game_date && g.pitch_id));
    assert.equal(new Set(scheduled.map((g) => `${g.pitch_id}|${g.game_date}`)).size, 9); // no pitch used twice at once
    const daySeen = new Set();
    for (const g of scheduled) {
      const { date } = localParts(g.game_date, "America/Argentina/Buenos_Aires");
      for (const t of [g.h, g.a]) {
        const key = `${t}|${date}`;
        assert.ok(!daySeen.has(key), `team ${t} plays twice on ${date}`);
        daySeen.add(key);
      }
    }

    // 5b. Manual rescheduling rejects a conflict and accepts a valid move.
    const [g1, g2] = scheduled;
    const when1 = localParts(g1.game_date, "America/Argentina/Buenos_Aires");
    res = await admin(`/admin/games/${g2.id}/organize`, {
      method: "POST",
      form: { date: when1.date, time: when1.time, pitch_id: String(g1.pitch_id) },
    });
    assert.equal(res.status, 303);
    assert.match(res.location, /err=/); // same pitch and time as another game
    assert.equal(read("SELECT game_date FROM game WHERE id = ?", g2.id)[0].game_date, g2.game_date);
    const when2 = localParts(g2.game_date, "America/Argentina/Buenos_Aires");
    res = await admin(`/admin/games/${g2.id}/organize`, {
      method: "POST",
      form: { date: when2.date, time: "08:00", pitch_id: String(g2.pitch_id) },
    });
    assert.equal(res.status, 303);
    assert.match(res.location, /ok=/);
    assert.equal(localParts(read("SELECT game_date FROM game WHERE id = ?", g2.id)[0].game_date, "America/Argentina/Buenos_Aires").time, "08:00");

    // 6. Finish the group stage with deterministic results.
    const scoreOf = (home, away) => {
      const table = {
        "Futsal Dos|Futsal Uno": ["Futsal Uno", 2, 0],
        "Futsal Tres|Futsal Uno": ["Futsal Uno", 3, 0],
        "Futsal Dos|Futsal Tres": ["Futsal Dos", 2, 0],
        "Futsal Cinco|Futsal Cuatro": ["Futsal Cuatro", 2, 0],
        "Futsal Cuatro|Futsal Seis": ["Futsal Cuatro", 2, 0],
        "Futsal Cuatro|Futsal Siete": ["Futsal Cuatro", 5, 0],
        "Futsal Cinco|Futsal Seis": ["Futsal Cinco", 1, 0],
        "Futsal Cinco|Futsal Siete": ["Futsal Cinco", 4, 0],
        "Futsal Seis|Futsal Siete": ["Futsal Seis", 2, 0],
      };
      const [winner, w, l] = table[[home, away].sort().join("|")];
      return home === winner ? [w, l] : [l, w];
    };
    const named = read(`SELECT g.id, ht.name h, at2.name a
      FROM game g JOIN round r ON r.id = g.round_id
      JOIN game_team gh ON gh.game_id = g.id AND gh.team_type = 'HOME' JOIN competition_team ch ON ch.id = gh.competition_team_id JOIN team ht ON ht.id = ch.team_id
      JOIN game_team ga ON ga.game_id = g.id AND ga.team_type = 'AWAY' JOIN competition_team ca ON ca.id = ga.competition_team_id JOIN team at2 ON at2.id = ca.team_id
      WHERE r.competition_id = ? AND r.stage = 'GROUP'`, compId);
    for (const g of named) {
      const [hs, aws] = scoreOf(g.h, g.a);
      res = await admin(`/admin/games/${g.id}/save`, {
        method: "POST",
        form: { score_home: hs, score_away: aws, penalty_score_home: "", penalty_score_away: "", status: "FINISHED" },
      });
      assert.equal(res.status, 303);
    }

    // The admin page previews the seeding: group winners + the best runner-up.
    const page = await admin(`/admin/competitions/${compId}`);
    assert.match(page.text, /Sorteo, horarios y cruces/);
    assert.match(page.text, /Mejor 2\.º/);

    // 7. Playoff seeding best-vs-worst; the best seed advances with a bye.
    const [semis, final] = read("SELECT id, name FROM round WHERE competition_id = ? AND stage = 'PLAYOFF' ORDER BY ordering", compId);
    res = await admin(`/admin/competitions/${compId}/bracket/seed`, { method: "POST", form: { round_id: String(semis.id) } });
    assert.equal(res.status, 303);
    assert.match(res.location, /ok=/);
    const semiGames = read(`SELECT g.id, ht.name h, at2.name a
      FROM game g
      JOIN game_team gh ON gh.game_id = g.id AND gh.team_type = 'HOME' JOIN competition_team ch ON ch.id = gh.competition_team_id JOIN team ht ON ht.id = ch.team_id
      JOIN game_team ga ON ga.game_id = g.id AND ga.team_type = 'AWAY' JOIN competition_team ca ON ca.id = ga.competition_team_id JOIN team at2 ON at2.id = ca.team_id
      WHERE g.round_id = ?`, semis.id);
    assert.equal(semiGames.length, 1); // three qualifiers: one tie, best seed has a bye
    assert.deepEqual([semiGames[0].h, semiGames[0].a], ["Futsal Cuatro", "Futsal Dos"]);
    res = await admin(`/admin/competitions/${compId}/bracket/seed`, { method: "POST", form: { round_id: String(semis.id) } });
    assert.match(res.location, /err=/); // reseeding a round with games is refused

    // The final pairs the semifinal winner with the bye team, best seed at home.
    res = await admin(`/admin/games/${semiGames[0].id}/save`, {
      method: "POST",
      form: { score_home: 3, score_away: 1, penalty_score_home: "", penalty_score_away: "", status: "FINISHED" },
    });
    assert.equal(res.status, 303);
    res = await admin(`/admin/competitions/${compId}/bracket/seed`, { method: "POST", form: { round_id: String(final.id) } });
    assert.equal(res.status, 303);
    assert.match(res.location, /ok=/);
    const finalGames = read(`SELECT ht.name h, at2.name a
      FROM game g
      JOIN game_team gh ON gh.game_id = g.id AND gh.team_type = 'HOME' JOIN competition_team ch ON ch.id = gh.competition_team_id JOIN team ht ON ht.id = ch.team_id
      JOIN game_team ga ON ga.game_id = g.id AND ga.team_type = 'AWAY' JOIN competition_team ca ON ca.id = ga.competition_team_id JOIN team at2 ON at2.id = ca.team_id
      WHERE g.round_id = ?`, final.id);
    assert.equal(finalGames.length, 1);
    assert.deepEqual([finalGames[0].h, finalGames[0].a], ["Futsal Uno", "Futsal Cuatro"]);
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
