// HTTP application: public league site, admin console and referee app.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, extname, normalize } from "node:path";
import { openDb, all, get, run, ROOT } from "./db.mjs";
import {
  theme, verifyPassword, statusLabel, slugify, localDateTimeToUtc, localParts,
  mulberry32, roundRobin, planSchedule, computeGroupSeeds, pairSeeds,
} from "./domain.mjs";
import * as repo from "./repo.mjs";
import * as views from "./public-views.mjs";
import * as admin from "./admin-views.mjs";
import { ensureBootstrap } from "./bootstrap.mjs";

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "127.0.0.1";
const db = openDb();
ensureBootstrap(db);

/* ------------------------------------------------------------------ utils */

const MIME = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json",
};

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie || "").flm_session;
  if (!token) return null;
  return get(
    db,
    `SELECT u.* FROM session s JOIN user u ON u.id = s.user_id WHERE s.token = ?`,
    token
  ) || null;
}

function setSession(res, userId) {
  const token = randomBytes(24).toString("hex");
  run(db, "INSERT INTO session (token, user_id, created_at) VALUES (?,?,?)", token, userId, new Date().toISOString());
  res.setHeader("Set-Cookie", `flm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function clearSession(req, res) {
  const token = parseCookies(req.headers.cookie || "").flm_session;
  if (token) run(db, "DELETE FROM session WHERE token = ?", token);
  res.setHeader("Set-Cookie", "flm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function sendHtml(res, content, status = 200) {
  const buffer = Buffer.from(String(content), "utf8");
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-length": buffer.length, "x-content-type-options": "nosniff" });
  res.end(buffer);
}

function sendJson(res, payload, status = 200) {
  const buffer = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": buffer.length, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(buffer);
}

// Scripts that manage a match in place ask for JSON; plain form posts keep
// their redirect so the no-JS flow and the smoke tests are unchanged.
function wantsJson(req) {
  return (req.headers.accept || "").includes("application/json") || req.headers["x-requested-with"] === "fetch";
}

// Serialised live state shared by the polling endpoint and the admin writes.
function liveBody(gameId) {
  const snapshot = repo.liveSnapshot(db, gameId);
  if (!snapshot) return null;
  const { game, events } = snapshot;
  return {
    id: game.id,
    status: game.status,
    statusLabel: statusLabel(game.status),
    live: game.status === "STARTED" || game.status === "BREAK",
    score: game.score_home !== null && game.score_away !== null ? `${game.score_home} - ${game.score_away}` : "0 - 0",
    scoreHome: game.score_home,
    scoreAway: game.score_away,
    penaltyHome: game.penalty_score_home,
    penaltyAway: game.penalty_score_away,
    events: events.map((e) => ({
      id: e.id,
      time: e.time,
      type: e.system_name,
      typeName: e.type_name,
      player: e.player_name || e.name || "",
      team: e.team_name || "",
      own: Boolean(e.for_opposite_team),
    })),
  };
}

function redirect(res, location, status = 303) {
  res.writeHead(status, { location });
  res.end();
}

function fail(res, path, message) {
  const sep = path.includes("?") ? "&" : "?";
  redirect(res, `${path}${sep}err=${encodeURIComponent(message)}`);
}

function ok(res, path, message) {
  const sep = path.includes("?") ? "&" : "?";
  redirect(res, `${path}${sep}ok=${encodeURIComponent(message)}`);
}

// A whitespace-free numeric field, or the fallback when it is empty/invalid.
function int(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  const type = req.headers["content-type"] || "";
  if (type.includes("application/json")) {
    try { return JSON.parse(rawBody || "{}"); } catch { return {}; }
  }
  // Repeated fields (multi-select checkboxes) must survive as arrays; a single
  // occurrence stays a string so every existing consumer keeps working.
  const params = new URLSearchParams(rawBody);
  const body = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    body[key] = values.length > 1 ? values : values[0];
  }
  return body;
}

function queryObject(url) {
  return Object.fromEntries(url.searchParams.entries());
}

function scopeFor(req) {
  const org = get(db, "SELECT * FROM organization LIMIT 1");
  const lang = "es";
  return { db, org, theme: theme(db), lang, user: currentUser(req) };
}

/* ---------------------------------------------------------------- routing */

const routes = [];
function route(method, pattern, handler) {
  const segments = pattern.split("/").filter(Boolean);
  routes.push({ method, segments, handler });
}
function matchRoute(method, pathname) {
  const parts = pathname.split("/").filter(Boolean);
  for (const r of routes) {
    if (r.method !== method || r.segments.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.segments.length; i++) {
      const s = r.segments[i];
      if (s.startsWith(":")) params[s.slice(1)] = decodeURIComponent(parts[i]);
      else if (s !== parts[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

async function serveStatic(req, res, pathname) {
  const clean = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, "public", clean);
  if (!file.startsWith(join(ROOT, "public"))) return false;
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "content-length": data.length, "cache-control": "no-cache" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------- auth */

function requireAdmin(req, res) {
  const user = currentUser(req);
  if (!user || user.role !== "ADMIN") { redirect(res, "/admin/login"); return null; }
  return user;
}
function requireStaff(req, res) {
  const user = currentUser(req);
  if (!user) { redirect(res, "/admin/login"); return null; }
  return user;
}

/* ============================== public routes ============================ */

const compCtx = (slug) => views.competitionContext(db, slug);

route("GET", "/", (req, res) => redirect(res, "/es"));
route("GET", "/:lang/competitions", (req, res) => sendHtml(res, views.competitionsView(scopeFor(req))));
route("GET", "/:lang/calendar", (req, res) => {
  const url = new URL(req.url, "http://x");
  sendHtml(res, views.calendarView(scopeFor(req), { month: url.searchParams.get("month") }));
});
route("GET", "/:lang/archive", (req, res) => sendHtml(res, views.archiveView(scopeFor(req))));
route("GET", "/:lang/archive/:season", (req, res, p) => {
  const out = views.seasonArchiveView(scopeFor(req), p.season);
  sendHtml(res, out || views.notFoundView(scopeFor(req)), out ? 200 : 404);
});

for (const [suffix, render] of [
  ["", (scope, ctx) => views.competitionView(scope, ctx)],
  ["/schedule", (scope, ctx) => views.scheduleView(scope, ctx)],
  ["/results", (scope, ctx, url) => views.resultsView(scope, ctx, { page: url.searchParams.get("page") })],
  ["/players-list", (scope, ctx, url) => views.playersView(scope, ctx, {
    page: url.searchParams.get("page"), sort: url.searchParams.get("sort") || "goals", team: url.searchParams.get("team") || "",
  })],
  ["/regulations", (scope, ctx) => views.regulationsView(scope, ctx)],
]) {
  route("GET", `/:lang/competition/:slug${suffix}`, (req, res, p) => {
    const scope = scopeFor(req);
    const ctx = compCtx(p.slug);
    if (!ctx) return sendHtml(res, views.notFoundView(scope), 404);
    sendHtml(res, render(scope, ctx, new URL(req.url, "http://x")));
  });
}
route("GET", "/:lang/competition/:slug/teams/:team", (req, res, p) => {
  const scope = scopeFor(req);
  const ctx = compCtx(p.slug);
  const out = ctx && views.teamView(scope, ctx, p.team, "about");
  sendHtml(res, out || views.notFoundView(scope), out ? 200 : 404);
});
for (const section of ["matches", "players", "gallery"]) {
  route("GET", `/:lang/competition/:slug/teams/:team/${section}`, (req, res, p) => {
    const scope = scopeFor(req);
    const ctx = compCtx(p.slug);
    const out = ctx && views.teamView(scope, ctx, p.team, section);
    sendHtml(res, out || views.notFoundView(scope), out ? 200 : 404);
  });
}
route("GET", "/:lang/competition/:slug/teams/:team/players/:player", (req, res, p) => {
  const scope = scopeFor(req);
  const ctx = compCtx(p.slug);
  const out = ctx && views.playerView(scope, ctx, p.team, p.player);
  sendHtml(res, out || views.notFoundView(scope), out ? 200 : 404);
});
route("GET", "/:lang/competition/:slug/games/:game", (req, res, p) => {
  const scope = scopeFor(req);
  const ctx = compCtx(p.slug);
  const out = ctx && views.matchView(scope, ctx, p.game);
  sendHtml(res, out || views.notFoundView(scope), out ? 200 : 404);
});

/* =============================== admin routes =========================== */

route("GET", "/admin/login", (req, res) => {
  if (currentUser(req)) return redirect(res, "/admin");
  sendHtml(res, admin.loginView(scopeFor(req)));
});
route("POST", "/admin/login", async (req, res) => {
  const body = await readBody(req);
  const user = get(db, "SELECT * FROM user WHERE email = ?", String(body.email || "").trim().toLowerCase());
  if (!user || !verifyPassword(String(body.password || ""), user.password_salt, user.password_hash)) {
    return sendHtml(res, admin.loginView(scopeFor(req), { error: "Correo o contraseña incorrectos." }), 401);
  }
  setSession(res, user.id);
  redirect(res, user.role === "REFEREE" ? "/referee" : "/admin");
});
route("POST", "/admin/logout", (req, res) => {
  clearSession(req, res);
  redirect(res, "/admin/login");
});

route("GET", "/admin", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const scope = scopeFor(req);
  const counts = {
    teams: get(db, "SELECT COUNT(*) n FROM team").n,
    players: get(db, "SELECT COUNT(*) n FROM player").n,
    games: get(db, "SELECT COUNT(*) n FROM game").n,
    goals: get(db, "SELECT COALESCE(SUM(score_home + score_away),0) n FROM game WHERE status='FINISHED'").n,
    upcoming: get(db, "SELECT COUNT(*) n FROM game WHERE status = 'NOT_STARTED'").n,
  };
  const recent = all(db, `SELECT g.id, g.game_date, g.score_home, g.score_away,
      ht.name home_name, at.name away_name
      FROM game g
      JOIN game_team gh ON gh.game_id=g.id AND gh.team_type='HOME' JOIN competition_team hc ON hc.id=gh.competition_team_id JOIN team ht ON ht.id=hc.team_id
      JOIN game_team ga ON ga.game_id=g.id AND ga.team_type='AWAY' JOIN competition_team ac ON ac.id=ga.competition_team_id JOIN team at ON at.id=ac.team_id
      WHERE g.status='FINISHED' ORDER BY g.game_date DESC LIMIT 6`);
  const upcoming = all(db, `SELECT g.id, g.game_date, ht.name home_name, at.name away_name
      FROM game g
      JOIN game_team gh ON gh.game_id=g.id AND gh.team_type='HOME' JOIN competition_team hc ON hc.id=gh.competition_team_id JOIN team ht ON ht.id=hc.team_id
      JOIN game_team ga ON ga.game_id=g.id AND ga.team_type='AWAY' JOIN competition_team ac ON ac.id=ga.competition_team_id JOIN team at ON at.id=ac.team_id
      WHERE g.status='NOT_STARTED' ORDER BY g.game_date ASC LIMIT 6`);
  sendHtml(res, admin.dashboardView(scope, { counts, recent, upcoming, user }));
});

/* teams ---------------------------------------------------------------- */

// Every competition, as options for the team-participation checkboxes.
function competitionOptions(selected = new Set()) {
  return repo.competitions(db).map((c) => ({ id: c.id, name: c.name, selected: selected.has(c.id) }));
}

route("GET", "/admin/teams", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const teams = all(db, `SELECT t.*,
      (SELECT COUNT(*) FROM competition_player cp JOIN competition_team ct ON ct.id=cp.competition_team_id WHERE ct.team_id=t.id) players,
      (SELECT COUNT(*) FROM competition_team ct WHERE ct.team_id=t.id) competitions
    FROM team t ORDER BY t.name`);
  sendHtml(res, admin.teamsView(scopeFor(req), { teams, user, query: queryObject(new URL(req.url, "http://x")) }));
});
route("GET", "/admin/teams/new", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  sendHtml(res, admin.teamFormView(scopeFor(req), { team: null, competitions: competitionOptions(), user, query: queryObject(new URL(req.url, "http://x")) }));
});
route("GET", "/admin/teams/:id", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const team = get(db, "SELECT * FROM team WHERE id = ?", Number(p.id));
  if (!team) return redirect(res, "/admin/teams");
  const selected = new Set(all(db, "SELECT competition_id FROM competition_team WHERE team_id = ?", team.id).map((r) => r.competition_id));
  sendHtml(res, admin.teamFormView(scopeFor(req), { team, competitions: competitionOptions(selected), user, query: queryObject(new URL(req.url, "http://x")) }));
});
route("POST", "/admin/teams/save", async (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const id = b.id ? Number(b.id) : null;
  const name = String(b.name || "").trim();
  if (!name) return fail(res, "/admin/teams", "El nombre es obligatorio");
  const slug = slugify(b.slug || name);
  try {
    let teamId = id;
    if (id) {
      run(db, "UPDATE team SET name=?, name_short=?, slug=?, city=?, about=?, crest_url=? WHERE id=?",
        name, b.name_short || null, slug, b.city || null, b.about || null, b.crest_url || null, id);
    } else {
      teamId = Number(run(db, "INSERT INTO team (name, name_short, slug, city, about, crest_url) VALUES (?,?,?,?,?,?)",
        name, b.name_short || null, slug, b.city || null, b.about || null, b.crest_url || null).lastInsertRowid);
    }
    const wanted = new Set([].concat(b.competitions || []).map(Number));
    const current = all(db, "SELECT id, competition_id FROM competition_team WHERE team_id = ?", teamId);
    for (const row of current) {
      if (wanted.has(row.competition_id)) continue;
      const used = get(db, "SELECT COUNT(*) n FROM game_team WHERE competition_team_id = ?", row.id).n;
      if (!used) run(db, "DELETE FROM competition_team WHERE id = ?", row.id);
    }
    for (const compId of wanted) {
      run(db, "INSERT OR IGNORE INTO competition_team (competition_id, team_id) VALUES (?,?)", compId, teamId);
    }
    ok(res, "/admin/teams", "Equipo guardado");
  } catch (e) {
    fail(res, "/admin/teams", e.message);
  }
});
route("POST", "/admin/teams/:id/delete", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const used = get(db, `SELECT COUNT(*) n FROM competition_team ct JOIN game_team gt ON gt.competition_team_id = ct.id WHERE ct.team_id = ?`, Number(p.id)).n;
  if (used) return fail(res, "/admin/teams", "El equipo tiene partidos y no se puede eliminar");
  try {
    run(db, "DELETE FROM team WHERE id = ?", Number(p.id));
    ok(res, "/admin/teams", "Equipo eliminado");
  } catch (e) { fail(res, "/admin/teams", e.message); }
});

/* players -------------------------------------------------------------- */

function rosterTeamOptions() {
  return all(db, `SELECT ct.id, t.name, c.name AS competition FROM competition_team ct
    JOIN team t ON t.id = ct.team_id JOIN competition c ON c.id = ct.competition_id
    ORDER BY t.name`);
}

route("GET", "/admin/players", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const url = new URL(req.url, "http://x");
  const q = (url.searchParams.get("q") || "").trim();
  const teamId = url.searchParams.get("team") || "";
  const params = [];
  let sql = `SELECT p.*, cp.id AS competition_player_id, cp.squad_number, cp.competition_team_id,
      (p.first_name || ' ' || p.last_name) AS full_name, t.name AS team_name
    FROM player p
    LEFT JOIN competition_player cp ON cp.player_id = p.id
    LEFT JOIN competition_team ct ON ct.id = cp.competition_team_id
    LEFT JOIN team t ON t.id = ct.team_id WHERE 1=1`;
  if (q) { sql += " AND (p.first_name LIKE ? OR p.last_name LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
  if (teamId) { sql += " AND ct.team_id = ?"; params.push(Number(teamId)); }
  sql += " ORDER BY p.last_name, p.first_name LIMIT 500";
  const players = all(db, sql, ...params);
  const teams = all(db, `SELECT DISTINCT t.id, t.name FROM team t JOIN competition_team ct ON ct.team_id=t.id ORDER BY t.name`);
  sendHtml(res, admin.adminPlayersView(scopeFor(req), { players, teams, q, teamId, user, query: queryObject(url) }));
});
route("GET", "/admin/players/new", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  sendHtml(res, admin.adminPlayerFormView(scopeFor(req), {
    player: null, teams: rosterTeamOptions(), user, query: queryObject(new URL(req.url, "http://x")),
  }));
});
route("GET", "/admin/players/:id", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const player = get(db, `SELECT p.*, cp.id AS competition_player_id, cp.squad_number, cp.competition_team_id
    FROM player p LEFT JOIN competition_player cp ON cp.player_id = p.id WHERE p.id = ? ORDER BY cp.id LIMIT 1`,
    Number(p.id));
  if (!player) return redirect(res, "/admin/players");
  sendHtml(res, admin.adminPlayerFormView(scopeFor(req), {
    player, teams: rosterTeamOptions(), user, query: queryObject(new URL(req.url, "http://x")),
  }));
});
route("POST", "/admin/players/save", async (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const first = String(b.first_name || "").trim();
  const last = String(b.last_name || "").trim();
  if (!first || !last) return fail(res, "/admin/players", "El nombre es obligatorio");
  const slug = slugify(`${first} ${last}`);
  const id = b.id ? Number(b.id) : null;
  try {
    let playerId = id;
    if (id) {
      run(db, "UPDATE player SET first_name=?, last_name=?, slug=?, date_of_birth=?, about=?, avatar_url=? WHERE id=?",
        first, last, slug, b.date_of_birth || null, b.about || null, b.avatar_url || null, id);
    } else {
      playerId = Number(run(db, "INSERT INTO player (first_name, last_name, slug, date_of_birth, about, avatar_url) VALUES (?,?,?,?,?,?)",
        first, last, slug, b.date_of_birth || null, b.about || null, b.avatar_url || null).lastInsertRowid);
    }
    // The competition is owned by the chosen squad slot, so no competition
    // context has to be guessed here.
    const ctId = b.competition_team_id ? Number(b.competition_team_id) : null;
    if (ctId) {
      const ct = get(db, "SELECT competition_id FROM competition_team WHERE id = ?", ctId);
      if (ct) {
        const existing = get(db, "SELECT id FROM competition_player WHERE competition_id = ? AND player_id = ?", ct.competition_id, playerId);
        if (existing) {
          run(db, "UPDATE competition_player SET competition_team_id=?, squad_number=? WHERE id=?", ctId, b.squad_number || null, existing.id);
        } else {
          run(db, "INSERT INTO competition_player (competition_id, competition_team_id, player_id, squad_number) VALUES (?,?,?,?)",
            ct.competition_id, ctId, playerId, b.squad_number || null);
        }
      }
    }
    ok(res, "/admin/players", "Jugador guardado");
  } catch (e) {
    fail(res, "/admin/players", e.message);
  }
});
route("POST", "/admin/players/:id/delete", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  try {
    run(db, "DELETE FROM player WHERE id = ?", Number(p.id));
    ok(res, "/admin/players", "Jugador eliminado");
  } catch (e) { fail(res, "/admin/players", e.message); }
});

/* competitions --------------------------------------------------------- */

// All teams with their participation and group inside one competition.
function teamsForCompetition(competitionId) {
  const rows = all(db, "SELECT team_id, group_id FROM competition_team WHERE competition_id = ?", competitionId);
  const assigned = new Map(rows.map((r) => [r.team_id, r]));
  return all(db, "SELECT * FROM team ORDER BY name").map((t) => ({
    id: t.id,
    name: t.name,
    in_competition: assigned.has(t.id),
    group_id: assigned.get(t.id)?.group_id ?? null,
  }));
}

function competitionSettingsBody(b) {
  return [
    String(b.name || "").trim(),
    int(b.season_id),
    b.about || null,
    b.regulations || null,
    int(b.half_time, 10),
    int(b.points_win, 3),
    int(b.points_draw, 1),
    int(b.points_lose, 0),
    b.ranking_points || "DESC",
    b.ranking_goal_diff || "DESC",
    b.ranking_goals_scored || "DESC",
    int(b.red_card_matches, 1),
    b.is_archive ? 1 : 0,
    b.start_date || null,
    b.end_date || null,
    b.location ? String(b.location).trim() : null,
  ];
}

route("GET", "/admin/competitions", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  sendHtml(res, admin.competitionsView(scopeFor(req), {
    competitions: repo.competitions(db), user, query: queryObject(new URL(req.url, "http://x")),
  }));
});
route("GET", "/admin/competitions/new", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  sendHtml(res, admin.competitionFormView(scopeFor(req), {
    competition: null, seasons: repo.seasons(db), groups: [], rounds: [], teams: [], user, query: queryObject(new URL(req.url, "http://x")),
  }));
});
route("GET", "/admin/competitions/:id", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const competition = get(db, `SELECT c.*, s.name AS season_name FROM competition c LEFT JOIN season s ON s.id=c.season_id WHERE c.id = ?`, Number(p.id));
  if (!competition) return redirect(res, "/admin/competitions");
  sendHtml(res, admin.competitionFormView(scopeFor(req), {
    competition,
    seasons: repo.seasons(db),
    groups: repo.groupsForCompetition(db, competition.id),
    rounds: repo.roundsForCompetition(db, competition.id),
    teams: teamsForCompetition(competition.id),
    seeds: computeGroupSeeds(db, competition.id),
    pitches: all(db, "SELECT * FROM pitch ORDER BY name"),
    user, query: queryObject(new URL(req.url, "http://x")),
  }));
});
route("POST", "/admin/competitions/create", async (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const [name, seasonId, about, regulations, halfTime, pw, pd, pl, rp, rgd, rgs, redCard, archive, startDate, endDate, location] = competitionSettingsBody(b);
  if (!name) return fail(res, "/admin/competitions/new", "El nombre es obligatorio");
  const kind = ["LIGA", "TORNEO", "COPA"].includes(b.kind) ? b.kind : "TORNEO";
  const slug = slugify(b.slug || name);
  try {
    const id = Number(run(db, `INSERT INTO competition
        (slug, name, kind, season_id, about, regulations, half_time, points_win, points_draw, points_lose,
         ranking_points, ranking_goal_diff, ranking_goals_scored, red_card_suspension_matches, is_archive,
         start_date, end_date, location)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      slug, name, kind, seasonId, about, regulations, halfTime, pw, pd, pl, rp, rgd, rgs, redCard, archive,
      startDate, endDate, location).lastInsertRowid);
    applyCompetitionTemplate(id, kind);
    ok(res, `/admin/competitions/${id}`, "Competición creada");
  } catch (e) {
    fail(res, "/admin/competitions/new", e.message);
  }
});

// Templates pre-build the starting structure so the admin can fill in teams
// and games right away. Everything stays editable afterwards.
function applyCompetitionTemplate(competitionId, kind) {
  if (kind === "LIGA") {
    run(db, "INSERT INTO competition_group (competition_id, name, slug, ordering) VALUES (?,?,?,?)",
      competitionId, "Grupo A", "grupo-a", 1);
  } else if (kind === "TORNEO") {
    for (const [i, name] of ["Grupo A", "Grupo B"].entries()) {
      run(db, "INSERT INTO competition_group (competition_id, name, slug, ordering) VALUES (?,?,?,?)",
        competitionId, name, slugify(name), i + 1);
    }
    for (const [i, name] of ["Semifinales", "Final"].entries()) {
      run(db, "INSERT INTO round (competition_id, group_id, stage, name, ordering) VALUES (?,?,?,?,?)",
        competitionId, null, "PLAYOFF", name, i + 1);
    }
  } else if (kind === "COPA") {
    for (const [i, name] of ["Octavos", "Cuartos", "Semifinales", "Final"].entries()) {
      run(db, "INSERT INTO round (competition_id, group_id, stage, name, ordering) VALUES (?,?,?,?,?)",
        competitionId, null, "PLAYOFF", name, i + 1);
    }
  }
}
route("POST", "/admin/competitions/:id/save", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const [name, seasonId, about, regulations, halfTime, pw, pd, pl, rp, rgd, rgs, redCard, archive, startDate, endDate, location] = competitionSettingsBody(b);
  if (!name) return fail(res, `/admin/competitions/${p.id}`, "El nombre es obligatorio");
  const slug = slugify(b.slug || name);
  try {
    run(db, `UPDATE competition SET slug=?, name=?, season_id=?, about=?, regulations=?, half_time=?,
        points_win=?, points_draw=?, points_lose=?, ranking_points=?, ranking_goal_diff=?,
        ranking_goals_scored=?, red_card_suspension_matches=?, is_archive=?,
        start_date=?, end_date=?, location=? WHERE id=?`,
      slug, name, seasonId, about, regulations, halfTime, pw, pd, pl, rp, rgd, rgs, redCard, archive,
      startDate, endDate, location, Number(p.id));
    ok(res, `/admin/competitions/${p.id}`, "Ajustes guardados");
  } catch (e) {
    fail(res, `/admin/competitions/${p.id}`, e.message);
  }
});
route("POST", "/admin/competitions/:id/delete", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const compId = Number(p.id);
  // Games outlive their round (round_id is set null on cascade), so remove them
  // first to avoid orphan rows, then let the competition cascade the rest.
  run(db, "DELETE FROM game WHERE round_id IN (SELECT id FROM round WHERE competition_id = ?)", compId);
  run(db, "DELETE FROM competition WHERE id = ?", compId);
  ok(res, "/admin/competitions", "Competición eliminada");
});

/* groups --------------------------------------------------------------- */
route("POST", "/admin/competitions/:id/groups/save", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const compId = Number(p.id);
  const b = await readBody(req);
  const name = String(b.name || "").trim();
  if (!name) return fail(res, `/admin/competitions/${compId}`, "El nombre del grupo es obligatorio");
  const ordering = int(b.ordering, 0);
  try {
    if (b.id) {
      run(db, "UPDATE competition_group SET name=?, ordering=? WHERE id=? AND competition_id=?", name, ordering, Number(b.id), compId);
    } else {
      run(db, "INSERT INTO competition_group (competition_id, name, slug, ordering) VALUES (?,?,?,?)", compId, name, slugify(name), ordering);
    }
    ok(res, `/admin/competitions/${compId}`, "Grupo guardado");
  } catch (e) {
    fail(res, `/admin/competitions/${compId}`, e.message);
  }
});
route("POST", "/admin/competitions/:id/groups/:gid/delete", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const compId = Number(p.id);
  const gid = Number(p.gid);
  // Deleting a group would cascade its rounds, so block it while dependencies exist.
  const teams = get(db, "SELECT COUNT(*) n FROM competition_team WHERE group_id = ?", gid).n;
  const rounds = get(db, "SELECT COUNT(*) n FROM round WHERE group_id = ?", gid).n;
  if (teams || rounds) return fail(res, `/admin/competitions/${compId}`, "El grupo tiene equipos o jornadas y no se puede eliminar");
  run(db, "DELETE FROM competition_group WHERE id = ? AND competition_id = ?", gid, compId);
  ok(res, `/admin/competitions/${compId}`, "Grupo eliminado");
});

/* teams of a competition ----------------------------------------------- */
route("POST", "/admin/competitions/:id/teams/save", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const compId = Number(p.id);
  const b = await readBody(req);
  const wanted = new Set([].concat(b.teams || []).map(Number));
  const groupIds = new Set(all(db, "SELECT id FROM competition_group WHERE competition_id = ?", compId).map((g) => g.id));
  const existing = new Map(all(db, "SELECT id, team_id FROM competition_team WHERE competition_id = ?", compId).map((r) => [r.team_id, r]));
  for (const t of all(db, "SELECT id FROM team")) {
    const row = existing.get(t.id);
    const raw = b[`group_${t.id}`];
    const groupId = raw && groupIds.has(Number(raw)) ? Number(raw) : null;
    if (wanted.has(t.id)) {
      if (row) run(db, "UPDATE competition_team SET group_id=? WHERE id=?", groupId, row.id);
      else run(db, "INSERT INTO competition_team (competition_id, team_id, group_id) VALUES (?,?,?)", compId, t.id, groupId);
    } else if (row) {
      const used = get(db, "SELECT COUNT(*) n FROM game_team WHERE competition_team_id = ?", row.id).n;
      if (!used) run(db, "DELETE FROM competition_team WHERE id = ?", row.id);
    }
  }
  ok(res, `/admin/competitions/${compId}`, "Equipos guardados");
});

/* rounds --------------------------------------------------------------- */
route("POST", "/admin/competitions/:id/rounds/save", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const compId = Number(p.id);
  const b = await readBody(req);
  const name = String(b.name || "").trim();
  if (!name) return fail(res, `/admin/competitions/${compId}`, "El nombre de la jornada es obligatorio");
  const stage = b.stage === "PLAYOFF" ? "PLAYOFF" : "GROUP";
  const groupIds = new Set(all(db, "SELECT id FROM competition_group WHERE competition_id = ?", compId).map((g) => g.id));
  const raw = b.group_id;
  const groupId = stage === "GROUP" && raw && groupIds.has(Number(raw)) ? Number(raw) : null;
  try {
    run(db, "INSERT INTO round (competition_id, group_id, stage, name, ordering) VALUES (?,?,?,?,?)",
      compId, groupId, stage, name, int(b.ordering, 0));
    ok(res, `/admin/competitions/${compId}`, "Jornada añadida");
  } catch (e) {
    fail(res, `/admin/competitions/${compId}`, e.message);
  }
});
route("POST", "/admin/competitions/:id/rounds/:rid/delete", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const compId = Number(p.id);
  const rid = Number(p.rid);
  const games = get(db, "SELECT COUNT(*) n FROM game WHERE round_id = ?", rid).n;
  if (games) return fail(res, `/admin/competitions/${compId}`, "La jornada tiene partidos y no se puede eliminar");
  run(db, "DELETE FROM round WHERE id = ? AND competition_id = ?", rid, compId);
  ok(res, `/admin/competitions/${compId}`, "Jornada eliminada");
});

/* fixtures, scheduling and bracket seeding ----------------------------- */

// Generate random round-robin fixtures for one group (or the whole group
// stage when there are no groups). Only pending games are replaced, so the
// draw can be regenerated as many times as needed; played games are kept.
route("POST", "/admin/competitions/:id/fixtures/generate", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const compId = Number(p.id);
  const back = `/admin/competitions/${compId}`;
  const b = await readBody(req);
  const groupId = int(b.group_id);
  const doubleRound = Boolean(b.double);
  const random = mulberry32(Date.now());

  const groups = groupId
    ? all(db, "SELECT * FROM competition_group WHERE id = ? AND competition_id = ?", groupId, compId)
    : all(db, "SELECT * FROM competition_group WHERE competition_id = ? ORDER BY ordering, id", compId);
  const targets = groups.length ? groups : [null]; // null = group stage without groups

  // Protect history: refuse if any group-stage game already started.
  for (const g of targets) {
    const params = g ? [compId, g.id] : [compId];
    const sql = `SELECT COUNT(*) n FROM game g JOIN round r ON r.id = g.round_id
      WHERE r.competition_id = ? AND r.stage = 'GROUP'
      ${g ? "AND r.group_id = ?" : "AND r.group_id IS NULL"}
      AND (g.status <> 'NOT_STARTED' OR EXISTS (SELECT 1 FROM event e WHERE e.game_id = g.id))`;
    if (get(db, sql, ...params).n) {
      return fail(res, back, "Hay partidos ya jugados o con eventos en ese grupo; no se pueden regenerar los emparejamientos");
    }
  }

  let created = 0;
  for (const g of targets) {
    const teams = g
      ? all(db, "SELECT id FROM competition_team WHERE competition_id = ? AND group_id = ?", compId, g.id)
      : all(db, "SELECT id FROM competition_team WHERE competition_id = ?", compId);
    if (teams.length < 2) continue;
    // Drop pending games and the now-empty group rounds before redrawing.
    run(db, `DELETE FROM game WHERE id IN (
        SELECT g2.id FROM game g2 JOIN round r ON r.id = g2.round_id
        WHERE r.competition_id = ? AND r.stage = 'GROUP' ${g ? "AND r.group_id = ?" : "AND r.group_id IS NULL"} AND g2.status = 'NOT_STARTED')`,
      ...(g ? [compId, g.id] : [compId]));
    run(db, `DELETE FROM round WHERE competition_id = ? AND stage = 'GROUP'
        ${g ? "AND group_id = ?" : "AND group_id IS NULL"}
        AND NOT EXISTS (SELECT 1 FROM game g3 WHERE g3.round_id = round.id)`,
      ...(g ? [compId, g.id] : [compId]));

    const rounds = roundRobin(teams.map((t) => t.id), { doubleRound, random });
    rounds.forEach((pairs, i) => {
      const roundId = Number(run(db,
        "INSERT INTO round (competition_id, group_id, stage, name, ordering) VALUES (?,?,?,?,?)",
        compId, g ? g.id : null, "GROUP", `Jornada ${i + 1}`, i + 1).lastInsertRowid);
      for (const [home, away] of pairs) {
        const gameId = Number(run(db, "INSERT INTO game (round_id, status) VALUES (?, 'NOT_STARTED')", roundId).lastInsertRowid);
        run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?,?,'HOME')", gameId, home);
        run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?,?,'AWAY')", gameId, away);
        created += 1;
      }
    });
  }
  if (!created) return fail(res, back, "No hay equipos suficientes en el grupo para sortear emparejamientos");
  ok(res, back, `Sorteo generado: ${created} partidos creados`);
});

// Occupancy for the automatic planner, across every competition (teams and
// pitches are global, so a team never doubles up on the same day anywhere).
function scheduleOccupancy(tz) {
  const busyTeams = new Map();
  const busyPitches = new Map();
  const rows = all(db, `SELECT g.id, g.game_date, g.pitch_id,
      hct.team_id AS home_team, act.team_id AS away_team
    FROM game g
    JOIN game_team ht ON ht.game_id = g.id AND ht.team_type = 'HOME'
    JOIN competition_team hct ON hct.id = ht.competition_team_id
    JOIN game_team at ON at.game_id = g.id AND at.team_type = 'AWAY'
    JOIN competition_team act ON act.id = at.competition_team_id
    WHERE g.game_date IS NOT NULL AND g.status <> 'CANCELED'`);
  for (const r of rows) {
    const { date, time } = localParts(r.game_date, tz);
    for (const t of [r.home_team, r.away_team]) {
      if (!busyTeams.has(t)) busyTeams.set(t, new Map());
      const m = busyTeams.get(t);
      m.set(date, (m.get(date) || 0) + 1);
    }
    if (r.pitch_id) {
      if (!busyPitches.has(r.pitch_id)) busyPitches.set(r.pitch_id, new Set());
      busyPitches.get(r.pitch_id).add(`${date} ${time}`);
    }
  }
  return { busyTeams, busyPitches };
}

// Assign dates, times and pitches to the unscheduled games of a competition.
route("POST", "/admin/competitions/:id/fixtures/schedule", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const compId = Number(p.id);
  const back = `/admin/competitions/${compId}`;
  const b = await readBody(req);
  const comp = get(db, "SELECT * FROM competition WHERE id = ?", compId);
  if (!comp) return redirect(res, "/admin/competitions");
  if (!b.start_date) return fail(res, back, "Indica la fecha de inicio");
  const tz = scopeFor(req).theme.timezone;
  const pitchIds = (Array.isArray(b.pitches) ? b.pitches : b.pitches ? [b.pitches] : []).map(Number).filter(Boolean);
  const slotMinutes = int(b.slot_minutes, comp.half_time * 2 + 15);

  const games = all(db, `SELECT g.id, hct.team_id AS home, act.team_id AS away
    FROM game g JOIN round r ON r.id = g.round_id
    JOIN game_team ht ON ht.game_id = g.id AND ht.team_type = 'HOME'
    JOIN competition_team hct ON hct.id = ht.competition_team_id
    JOIN game_team at ON at.game_id = g.id AND at.team_type = 'AWAY'
    JOIN competition_team act ON act.id = at.competition_team_id
    WHERE r.competition_id = ? AND g.game_date IS NULL AND g.status = 'NOT_STARTED'
    ORDER BY CASE r.stage WHEN 'GROUP' THEN 0 ELSE 1 END, r.ordering, r.id, g.id`, compId);
  if (!games.length) return fail(res, back, "No hay partidos sin fecha en esta competición");

  const { busyTeams, busyPitches } = scheduleOccupancy(tz);
  const { assignments, unscheduled } = planSchedule(games, {
    startDate: b.start_date,
    fromTime: b.from_time || "18:00",
    toTime: b.to_time || "23:00",
    slotMinutes,
    pitchIds,
    busyTeams, busyPitches,
    maxPerDayPerTeam: int(b.max_per_day, 1),
  });
  for (const a of assignments) {
    run(db, "UPDATE game SET game_date = ?, pitch_id = ? WHERE id = ?",
      localDateTimeToUtc(a.date, a.time, tz).toISOString(), a.pitchId, a.id);
  }
  const msg = `Horarios asignados a ${assignments.length} partidos`;
  ok(res, back, unscheduled.length ? `${msg} (${unscheduled.length} no cupieron en el rango)` : msg);
});

// Seed a playoff round best-vs-worst. The first playoff round takes the
// qualified teams (group winners + best runner-up); later rounds take the
// winners of the previous playoff round, re-seeded by their group record.
route("POST", "/admin/competitions/:id/bracket/seed", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const compId = Number(p.id);
  const back = `/admin/competitions/${compId}`;
  const b = await readBody(req);
  const roundId = int(b.round_id);
  const round = get(db, "SELECT * FROM round WHERE id = ? AND competition_id = ? AND stage = 'PLAYOFF'", roundId, compId);
  if (!round) return fail(res, back, "Elige una ronda de playoff válida");
  if (get(db, "SELECT COUNT(*) n FROM game WHERE round_id = ?", roundId).n) {
    return fail(res, back, "Esa ronda ya tiene partidos; elimínalos para resembrar los cruces");
  }

  const groupSeeds = computeGroupSeeds(db, compId);
  const playoffRounds = all(db,
    "SELECT * FROM round WHERE competition_id = ? AND stage = 'PLAYOFF' ORDER BY ordering, id", compId);
  const idx = playoffRounds.findIndex((r) => r.id === roundId);
  const playoffGames = repo.competitionGames(db, compId, { stage: "PLAYOFF" });

  // Entrants of each round: the qualified teams for the first playoff round;
  // afterwards the winners of the previous round plus whoever advanced with a
  // bye (entrant without a game there).
  let entrants = groupSeeds.filter((s) => s.qualified).map((s) => s.competition_team_id);
  if (idx === 0 && entrants.length < 2) {
    return fail(res, back, "Aún no hay clasificados suficientes en la fase de grupos");
  }
  for (let i = 0; i < idx; i++) {
    const r = playoffRounds[i];
    const games = playoffGames.filter((g) => g.round_id === r.id);
    if (games.length === 0) {
      return fail(res, back, `La ronda anterior (${r.name}) aún no tiene cruces; siémbrala primero`);
    }
    if (games.some((g) => g.status !== "FINISHED" || g.score_home === null || g.score_away === null)) {
      return fail(res, back, `La ronda anterior (${r.name}) no está completa`);
    }
    const playing = new Set(games.flatMap((g) => [g.home_ct, g.away_ct]));
    const winners = games.map((g) => {
      const homeWins = g.score_home > g.score_away ||
        (g.score_home === g.score_away && (g.penalty_score_home ?? -1) > (g.penalty_score_away ?? -1));
      return homeWins ? g.home_ct : g.away_ct;
    });
    entrants = [...winners, ...entrants.filter((ct) => !playing.has(ct))];
  }

  const seeds = entrants
    .map((ct) => groupSeeds.find((s) => s.competition_team_id === ct))
    .filter(Boolean)
    .sort((a, b) => a.seed - b.seed);
  if (seeds.length < 2) return fail(res, back, "No hay suficientes equipos vivos para los cruces");

  const { pairs, bye } = pairSeeds(seeds);
  for (const [best, worst] of pairs) {
    const gameId = Number(run(db, "INSERT INTO game (round_id, status) VALUES (?, 'NOT_STARTED')", roundId).lastInsertRowid);
    run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?,?,'HOME')", gameId, best.competition_team_id);
    run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?,?,'AWAY')", gameId, worst.competition_team_id);
  }
  ok(res, back, `Cruces creados en «${round.name}»: ${pairs.length} partidos${bye ? `, ${bye.team_name} pasa directo` : ""}`);
});

/* pitches -------------------------------------------------------------- */
route("POST", "/admin/pitches/save", async (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const backTo = b.back || "/admin/competitions";
  const name = String(b.name || "").trim();
  if (!name) return fail(res, backTo, "El nombre de la cancha es obligatorio");
  run(db, "INSERT INTO pitch (name, address) VALUES (?,?)", name, b.address ? String(b.address).trim() : null);
  ok(res, backTo, "Cancha añadida");
});
route("POST", "/admin/pitches/:id/delete", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  run(db, "DELETE FROM pitch WHERE id = ?", Number(p.id));
  ok(res, b.back || "/admin/competitions", "Cancha eliminada");
});

/* games ---------------------------------------------------------------- */

const GAMES_ADMIN_SELECT = `SELECT g.id, g.game_date, g.status, g.score_home, g.score_away,
    ht.name home_name, at.name away_name, r.name round_name, r.stage, c.name competition_name
  FROM game g
  JOIN round r ON r.id=g.round_id JOIN competition c ON c.id=r.competition_id
  JOIN game_team gh ON gh.game_id=g.id AND gh.team_type='HOME' JOIN competition_team hc ON hc.id=gh.competition_team_id JOIN team ht ON ht.id=hc.team_id
  JOIN game_team ga ON ga.game_id=g.id AND ga.team_type='AWAY' JOIN competition_team ac ON ac.id=ga.competition_team_id JOIN team at ON at.id=ac.team_id`;

function roundsForFilter(competitionId) {
  if (competitionId) return repo.roundsForCompetition(db, competitionId);
  return all(db, `SELECT r.*, c.name AS competition_name FROM round r JOIN competition c ON c.id=r.competition_id
    ORDER BY c.id, CASE r.stage WHEN 'GROUP' THEN 0 ELSE 1 END, r.ordering, r.id`);
}

route("GET", "/admin/games", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const url = new URL(req.url, "http://x");
  const competitionId = url.searchParams.get("competition") || "";
  const status = url.searchParams.get("status") || "";
  const stage = url.searchParams.get("stage") || "";
  const roundId = url.searchParams.get("round") || "";
  const params = [];
  let sql = `${GAMES_ADMIN_SELECT} WHERE 1=1`;
  if (competitionId) { sql += " AND r.competition_id = ?"; params.push(Number(competitionId)); }
  if (stage) { sql += " AND r.stage = ?"; params.push(stage); }
  if (status) { sql += " AND g.status = ?"; params.push(status); }
  if (roundId) { sql += " AND g.round_id = ?"; params.push(Number(roundId)); }
  sql += " ORDER BY g.game_date DESC LIMIT 200";
  sendHtml(res, admin.adminGamesView(scopeFor(req), {
    games: all(db, sql, ...params),
    competitions: repo.competitions(db),
    competitionId, status, stage, roundId,
    rounds: roundsForFilter(competitionId ? Number(competitionId) : null),
    user, query: queryObject(url),
  }));
});
route("GET", "/admin/games/new", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const url = new URL(req.url, "http://x");
  const competitions = repo.competitions(db);
  const competitionId = Number(url.searchParams.get("competition") || competitions[0]?.id || 0) || null;
  sendHtml(res, admin.adminGameFormView(scopeFor(req), {
    competitions,
    competitionId,
    rounds: competitionId ? repo.roundsForCompetition(db, competitionId) : [],
    teams: competitionId ? repo.competitionTeams(db, competitionId) : [],
    pitches: all(db, "SELECT * FROM pitch ORDER BY name"),
    user, query: queryObject(url),
  }));
});
// Interval-overlap conflicts for a manually placed game: same pitch or the
// same team already playing inside the match window (2 halves + 10' break).
function schedulingConflicts({ gameId = null, gameDate, pitchId, homeCt, awayCt, durationMin, tz }) {
  if (!gameDate) return [];
  const start = new Date(gameDate).getTime();
  const end = start + durationMin * 60000;
  const rows = all(db, `SELECT g.id, g.game_date, g.pitch_id,
      hct.team_id AS home_team, act.team_id AS away_team,
      tht.name AS home_name, tat.name AS away_name
    FROM game g
    JOIN game_team ht ON ht.game_id = g.id AND ht.team_type = 'HOME'
    JOIN competition_team hct ON hct.id = ht.competition_team_id
    JOIN team tht ON tht.id = hct.team_id
    JOIN game_team at ON at.game_id = g.id AND at.team_type = 'AWAY'
    JOIN competition_team act ON act.id = at.competition_team_id
    JOIN team tat ON tat.id = act.team_id
    WHERE g.game_date IS NOT NULL AND g.status <> 'CANCELED'${gameId ? " AND g.id <> ?" : ""}`,
    ...(gameId ? [gameId] : []));
  const teamIds = all(db, "SELECT id, team_id FROM competition_team WHERE id IN (?,?)", homeCt, awayCt)
    .map((r) => r.team_id);
  const conflicts = [];
  for (const r of rows) {
    const s2 = new Date(r.game_date).getTime();
    if (s2 >= end || s2 + durationMin * 60000 <= start) continue;
    const label = `${r.home_name} vs ${r.away_name} (${localParts(r.game_date, tz).date} ${localParts(r.game_date, tz).time})`;
    if (pitchId && r.pitch_id === pitchId) conflicts.push(`la cancha ya está ocupada por ${label}`);
    if (teamIds.includes(r.home_team) || teamIds.includes(r.away_team)) conflicts.push(`un equipo ya juega en ese horario: ${label}`);
  }
  return conflicts;
}

route("POST", "/admin/games/create", async (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const competitionId = int(b.competition_id);
  const roundId = int(b.round_id);
  const homeCt = int(b.home_ct);
  const awayCt = int(b.away_ct);
  const back = competitionId ? `/admin/games/new?competition=${competitionId}` : "/admin/games/new";
  if (!roundId || !homeCt || !awayCt) return fail(res, back, "Elige jornada y los dos equipos");
  if (homeCt === awayCt) return fail(res, back, "El local y el visitante deben ser distintos");
  const round = get(db, "SELECT * FROM round WHERE id = ? AND competition_id = ?", roundId, competitionId);
  if (!round) return fail(res, back, "La jornada no pertenece a esa competición");
  const sides = all(db, "SELECT id FROM competition_team WHERE competition_id = ? AND id IN (?,?)", competitionId, homeCt, awayCt);
  if (sides.length < 2) return fail(res, back, "Los equipos deben pertenecer a la competición");
  try {
    const tz = scopeFor(req).theme.timezone;
    const gameDate = b.date ? localDateTimeToUtc(b.date, b.time || "00:00", tz).toISOString() : null;
    if (gameDate) {
      const comp = get(db, "SELECT half_time FROM competition WHERE id = ?", competitionId);
      const conflicts = schedulingConflicts({ gameDate, pitchId: int(b.pitch_id), homeCt, awayCt, durationMin: (comp?.half_time ?? 10) * 2 + 10, tz });
      if (conflicts.length) return fail(res, back, `Conflicto de calendario: ${conflicts[0]}`);
    }
    const gameId = Number(run(db, "INSERT INTO game (round_id, pitch_id, game_date, status, code) VALUES (?,?,?, 'NOT_STARTED', ?)",
      roundId, int(b.pitch_id), gameDate, b.code || null).lastInsertRowid);
    run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?,?,'HOME')", gameId, homeCt);
    run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?,?,'AWAY')", gameId, awayCt);
    ok(res, `/admin/games/${gameId}`, "Partido creado");
  } catch (e) {
    fail(res, back, e.message);
  }
});

function gameData(gameId) {
  const game = repo.gameById(db, gameId);
  if (!game) return null;
  const eventTypes = all(db, "SELECT * FROM event_type ORDER BY id");
  const roster = (ct) => all(db, `SELECT cp.id AS competition_player_id, cp.squad_number,
      (p.first_name || ' ' || p.last_name) AS full_name, t.name AS team_name,
      (SELECT COUNT(*) FROM event e JOIN event_type et ON et.id=e.event_type_id
        WHERE e.game_id = ? AND e.game_player_id IN (SELECT id FROM game_player WHERE game_id=? AND competition_player_id=cp.id)
        AND et.system_name IN ('goal','own_goal')) AS goals
    FROM competition_player cp JOIN player p ON p.id=cp.player_id
    JOIN competition_team cte ON cte.id=cp.competition_team_id JOIN team t ON t.id=cte.team_id
    WHERE cp.competition_team_id = ? ORDER BY (cp.squad_number IS NULL), cp.squad_number`, game.id, game.id, ct);
  const inSquad = new Set(all(db, "SELECT competition_player_id FROM game_player WHERE game_id = ?", game.id).map((r) => r.competition_player_id));
  const withSquad = (list) => list.map((p) => ({ ...p, in_squad: inSquad.has(p.competition_player_id) }));
  return {
    game, eventTypes,
    events: repo.gameEvents(db, game.id),
    homePlayers: withSquad(roster(game.home_ct)),
    awayPlayers: withSquad(roster(game.away_ct)),
  };
}
route("GET", "/admin/games/:id", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const data = gameData(Number(p.id));
  if (!data) return redirect(res, "/admin/games");
  const competitionId = data.game.competition_id;
  sendHtml(res, admin.adminGameEditView(scopeFor(req), {
    ...data,
    rounds: repo.roundsForCompetition(db, competitionId),
    teams: repo.competitionTeams(db, competitionId),
    pitches: all(db, "SELECT * FROM pitch ORDER BY name"),
    user, query: queryObject(new URL(req.url, "http://x")),
  }));
});
route("POST", "/admin/games/:id/organize", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const gameId = Number(p.id);
  const game = get(db, "SELECT * FROM game WHERE id = ?", gameId);
  if (!game) return redirect(res, "/admin/games");
  const b = await readBody(req);
  const roundId = int(b.round_id);
  const homeCt = int(b.home_ct);
  const awayCt = int(b.away_ct);
  if (roundId) run(db, "UPDATE game SET round_id = ? WHERE id = ?", roundId, gameId);
  if (homeCt && awayCt) {
    if (homeCt === awayCt) return fail(res, `/admin/games/${gameId}`, "El local y el visitante deben ser distintos");
    run(db, "DELETE FROM game_team WHERE game_id = ?", gameId);
    run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?,?,'HOME')", gameId, homeCt);
    run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?,?,'AWAY')", gameId, awayCt);
  }
  const tz = scopeFor(req).theme.timezone;
  const gameDate = b.date ? localDateTimeToUtc(b.date, b.time || "00:00", tz).toISOString() : null;
  if (gameDate) {
    const current = repo.gameById(db, gameId);
    const comp = get(db, "SELECT half_time FROM competition WHERE id = ?", current.competition_id);
    const conflicts = schedulingConflicts({
      gameId, gameDate, pitchId: int(b.pitch_id),
      homeCt: homeCt || current.home_ct, awayCt: awayCt || current.away_ct,
      durationMin: (comp?.half_time ?? 10) * 2 + 10, tz,
    });
    if (conflicts.length) return fail(res, `/admin/games/${gameId}`, `Conflicto de calendario: ${conflicts[0]}`);
  }
  run(db, "UPDATE game SET pitch_id=?, code=?, game_date=COALESCE(?, game_date) WHERE id=?",
    int(b.pitch_id), b.code || null, gameDate, gameId);
  ok(res, `/admin/games/${gameId}`, "Partido reorganizado");
});
route("POST", "/admin/games/:id/delete", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  run(db, "DELETE FROM game WHERE id = ?", Number(p.id));
  ok(res, "/admin/games", "Partido eliminado");
});
route("POST", "/admin/games/:id/save", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const gameId = Number(p.id);
  const scoreHome = b.score_home === "" ? null : Number(b.score_home);
  const scoreAway = b.score_away === "" ? null : Number(b.score_away);
  run(db, `UPDATE game SET score_home=?, score_away=?, penalty_score_home=?, penalty_score_away=?, status=? WHERE id=?`,
    scoreHome, scoreAway,
    b.penalty_score_home === "" ? null : Number(b.penalty_score_home),
    b.penalty_score_away === "" ? null : Number(b.penalty_score_away),
    b.status || "NOT_STARTED", gameId);
  if (b.status === "FINISHED") countGameStats(gameId);
  ok(res, `/admin/games/${gameId}`, "Resultado guardado");
});
route("POST", "/admin/games/:id/events", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const gameId = Number(p.id);
  const cpId = Number(b.competition_player_id);
  if (!cpId) return fail(res, `/admin/games/${gameId}`, "Elige un jugador");
  addEvent(gameId, cpId, Number(b.event_type_id), Number(b.time) || 1);
  if (wantsJson(req)) return sendJson(res, liveBody(gameId));
  ok(res, `/admin/games/${gameId}`, "Evento añadido");
});
route("POST", "/admin/games/:id/events/:eventId/delete", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  deleteEvent(Number(p.id), Number(p.eventId));
  if (wantsJson(req)) return sendJson(res, liveBody(Number(p.id)));
  ok(res, `/admin/games/${p.id}`, "Evento eliminado");
});
route("POST", "/admin/games/:id/status", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const gameId = Number(p.id);
  const status = ["NOT_STARTED", "STARTED", "BREAK", "FINISHED", "CANCELED"].includes(b.status) ? b.status : "STARTED";
  if (status === "FINISHED") {
    const g = get(db, "SELECT score_home, score_away FROM game WHERE id = ?", gameId);
    if (g.score_home === null || g.score_away === null) recomputeScore(gameId);
    countGameStats(gameId);
  }
  run(db, "UPDATE game SET status = ? WHERE id = ?", status, gameId);
  if (wantsJson(req)) return sendJson(res, liveBody(gameId));
  ok(res, `/admin/games/${gameId}`, "Estado actualizado");
});
route("POST", "/admin/games/:id/squad", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const gameId = Number(p.id);
  const wanted = new Set([].concat(b.player || []).map(Number));
  const existing = all(db, "SELECT id, competition_player_id FROM game_player WHERE game_id = ?", gameId);
  const present = new Set(existing.map((row) => row.competition_player_id));
  for (const row of existing) {
    if (wanted.has(row.competition_player_id)) continue;
    const hasEvents = get(db, "SELECT COUNT(*) n FROM event WHERE game_player_id = ?", row.id).n;
    if (!hasEvents) run(db, "DELETE FROM game_player WHERE id = ?", row.id);
  }
  for (const cpId of wanted) {
    if (present.has(cpId)) continue;
    const row = get(db, "SELECT squad_number FROM competition_player WHERE id = ?", cpId);
    run(db, "INSERT OR IGNORE INTO game_player (game_id, competition_player_id, squad_number) VALUES (?,?,?)", gameId, cpId, row?.squad_number ?? null);
  }
  ok(res, `/admin/games/${gameId}`, "Convocatoria guardada");
});

/* live state ----------------------------------------------------------- */
route("GET", "/api/games/:id/live", (req, res, p) => {
  const body = liveBody(Number(p.id));
  sendJson(res, body || { error: "not_found" }, body ? 200 : 404);
});

/* sponsors ------------------------------------------------------------- */
route("GET", "/admin/sponsors", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  sendHtml(res, admin.sponsorsView(scopeFor(req), {
    sponsors: repo.allSponsors(db), user, query: queryObject(new URL(req.url, "http://x")),
  }));
});
route("POST", "/admin/sponsors/save", async (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const name = String(b.name || "").trim();
  if (!name) return fail(res, "/admin/sponsors", "El nombre es obligatorio");
  const logoUrl = b.logo_url ? String(b.logo_url).trim() : null;
  const linkUrl = b.link_url ? String(b.link_url).trim() : null;
  const ordering = int(b.ordering, 0);
  const active = b.active ? 1 : 0;
  try {
    if (b.id) {
      run(db, "UPDATE sponsor SET name=?, logo_url=?, link_url=?, ordering=?, active=? WHERE id=?",
        name, logoUrl, linkUrl, ordering, active, Number(b.id));
    } else {
      run(db, "INSERT INTO sponsor (name, logo_url, link_url, ordering, active) VALUES (?,?,?,?,1)",
        name, logoUrl, linkUrl, ordering);
    }
    ok(res, "/admin/sponsors", "Patrocinador guardado");
  } catch (e) {
    fail(res, "/admin/sponsors", e.message);
  }
});
route("POST", "/admin/sponsors/:id/delete", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  run(db, "DELETE FROM sponsor WHERE id = ?", Number(p.id));
  ok(res, "/admin/sponsors", "Patrocinador eliminado");
});

/* settings ------------------------------------------------------------- */
route("GET", "/admin/settings", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  sendHtml(res, admin.settingsView(scopeFor(req), {
    org: get(db, "SELECT * FROM organization LIMIT 1"),
    user, query: queryObject(new URL(req.url, "http://x")),
  }));
});
route("POST", "/admin/settings/save", async (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  run(db, `UPDATE organization SET name=?, primary_color=?, secondary_color=?,
      background_accent_color=?, socials_json=? WHERE id = (SELECT id FROM organization LIMIT 1)`,
    b.name, b.primary_color, b.secondary_color, b.background_accent_color,
    JSON.stringify({ facebook: b.social_facebook_url, instagram: b.social_instagram_url, youtube: b.social_youtube_url }));
  ok(res, "/admin/settings", "Ajustes guardados");
});

/* ============================== referee routes ========================== */

route("GET", "/referee", (req, res) => {
  const user = requireStaff(req, res); if (!user) return;
  const today = new Date().toISOString().slice(0, 10);
  let games = all(db, `SELECT g.id, g.game_date, g.status, ht.name home_name, at.name away_name
      FROM game g
      JOIN game_team gh ON gh.game_id=g.id AND gh.team_type='HOME' JOIN competition_team hc ON hc.id=gh.competition_team_id JOIN team ht ON ht.id=hc.team_id
      JOIN game_team ga ON ga.game_id=g.id AND ga.team_type='AWAY' JOIN competition_team ac ON ac.id=ga.competition_team_id JOIN team at ON at.id=ac.team_id
      WHERE g.status IN ('NOT_STARTED','STARTED','BREAK') AND g.game_date >= ?
      ORDER BY g.game_date ASC LIMIT 20`, new Date(`${today}T00:00:00Z`).toISOString());
  const isToday = games.length > 0;
  if (games.length === 0) {
    games = all(db, `SELECT g.id, g.game_date, g.status, ht.name home_name, at.name away_name
      FROM game g
      JOIN game_team gh ON gh.game_id=g.id AND gh.team_type='HOME' JOIN competition_team hc ON hc.id=gh.competition_team_id JOIN team ht ON ht.id=hc.team_id
      JOIN game_team ga ON ga.game_id=g.id AND ga.team_type='AWAY' JOIN competition_team ac ON ac.id=ga.competition_team_id JOIN team at ON at.id=ac.team_id
      WHERE g.status IN ('NOT_STARTED','STARTED','BREAK') ORDER BY g.game_date ASC LIMIT 20`);
  }
  sendHtml(res, admin.refereeHomeView(scopeFor(req), { games, user, today: isToday }));
});
route("GET", "/referee/game/:id", (req, res, p) => {
  const user = requireStaff(req, res); if (!user) return;
  const data = gameData(Number(p.id));
  if (!data) return redirect(res, "/referee");
  sendHtml(res, admin.refereeGameView(scopeFor(req), { ...data, user }));
});

function recomputeScore(gameId) {
  const game = get(db, "SELECT * FROM game WHERE id = ?", gameId);
  if (!game) return;
  const events = all(db, `SELECT et.system_name, cp.competition_team_id AS team_ct
    FROM event e JOIN event_type et ON et.id=e.event_type_id
    JOIN game_player gp ON gp.id=e.game_player_id
    JOIN competition_player cp ON cp.id=gp.competition_player_id
    WHERE e.game_id = ? AND et.system_name IN ('goal','own_goal')`, gameId);
  const teams = all(db, "SELECT competition_team_id, team_type FROM game_team WHERE game_id = ?", gameId);
  const home = teams.find((t) => t.team_type === "HOME")?.competition_team_id;
  const away = teams.find((t) => t.team_type === "AWAY")?.competition_team_id;
  let hs = 0, as = 0;
  for (const e of events) {
    let scorer = e.team_ct;
    if (e.system_name === "own_goal") scorer = scorer === home ? away : home;
    if (scorer === home) hs++; else as++;
  }
  run(db, "UPDATE game SET score_home=?, score_away=? WHERE id=?", hs, as, gameId);
}
function addEvent(gameId, cpId, eventTypeId, minute) {
  let gp = get(db, "SELECT id FROM game_player WHERE game_id = ? AND competition_player_id = ?", gameId, cpId);
  if (!gp) {
    const row = get(db, "SELECT cp.squad_number, cp.competition_team_id FROM competition_player cp WHERE cp.id = ?", cpId);
    const id = Number(run(db, "INSERT INTO game_player (game_id, competition_player_id, squad_number) VALUES (?,?,?)",
      gameId, cpId, row?.squad_number ?? null).lastInsertRowid);
    gp = { id };
  }
  run(db, "INSERT INTO event (game_id, game_player_id, event_type_id, time) VALUES (?,?,?,?)", gameId, gp.id, eventTypeId, minute);
  recomputeScore(gameId);
  run(db, "UPDATE game SET status = CASE WHEN status='NOT_STARTED' THEN 'STARTED' ELSE status END WHERE id = ?", gameId);
}
function deleteEvent(gameId, eventId) {
  run(db, "DELETE FROM event WHERE id = ? AND game_id = ?", eventId, gameId);
  recomputeScore(gameId);
}
function countGameStats(gameId) {
  const game = get(db, "SELECT stats_counted FROM game WHERE id = ?", gameId);
  if (!game || game.stats_counted) return;
  const players = all(db, "SELECT DISTINCT competition_player_id FROM game_player WHERE game_id = ?", gameId);
  for (const { competition_player_id: cpId } of players) {
    const exists = get(db, "SELECT competition_player_id FROM player_stat_base WHERE competition_player_id = ?", cpId);
    if (exists) run(db, "UPDATE player_stat_base SET games = games + 1 WHERE competition_player_id = ?", cpId);
    else run(db, "INSERT INTO player_stat_base (competition_player_id, games) VALUES (?, 1)", cpId);
  }
  run(db, "UPDATE game SET stats_counted = 1 WHERE id = ?", gameId);
}

route("POST", "/referee/game/:id/status", async (req, res, p) => {
  const user = requireStaff(req, res); if (!user) return;
  const b = await readBody(req);
  const status = ["NOT_STARTED", "STARTED", "BREAK", "FINISHED", "CANCELED"].includes(b.status) ? b.status : "STARTED";
  const gameId = Number(p.id);
  if (status === "FINISHED") {
    const g = get(db, "SELECT score_home, score_away FROM game WHERE id = ?", gameId);
    if (g.score_home === null || g.score_away === null) recomputeScore(gameId);
    countGameStats(gameId);
  }
  run(db, "UPDATE game SET status = ? WHERE id = ?", status, gameId);
  ok(res, `/referee/game/${gameId}`, "Estado actualizado");
});
route("POST", "/referee/game/:id/score", async (req, res, p) => {
  const user = requireStaff(req, res); if (!user) return;
  const b = await readBody(req);
  run(db, "UPDATE game SET score_home=?, score_away=? WHERE id=?",
    Number(b.score_home) || 0, Number(b.score_away) || 0, Number(p.id));
  ok(res, `/referee/game/${p.id}`, "Marcador corregido");
});
route("POST", "/referee/game/:id/events", async (req, res, p) => {
  const user = requireStaff(req, res); if (!user) return;
  const b = await readBody(req);
  const value = String(b.submit || "");
  const [teamCt, cpId] = value.split(":").map(Number);
  if (!teamCt || !cpId) return fail(res, `/referee/game/${p.id}`, "Elige un jugador");
  const typeId = Number(b.event_type_id);
  const minute = Math.max(1, Math.min(120, Number(b.time) || 1));
  addEvent(Number(p.id), cpId, typeId, minute);
  ok(res, `/referee/game/${p.id}`, "Evento registrado");
});
route("POST", "/referee/game/:id/events/:eventId/delete", (req, res, p) => {
  const user = requireStaff(req, res); if (!user) return;
  deleteEvent(Number(p.id), Number(p.eventId));
  ok(res, `/referee/game/${p.id}`, "Evento eliminado");
});
route("POST", "/referee/game/:id/squad", async (req, res, p) => {
  const user = requireStaff(req, res); if (!user) return;
  const b = await readBody(req);
  const gameId = Number(p.id);
  const wanted = new Set([].concat(b.player || []).map(Number));
  const existing = all(db, "SELECT id, competition_player_id FROM game_player WHERE game_id = ?", gameId);
  const present = new Set(existing.map((row) => row.competition_player_id));
  for (const row of existing) {
    if (wanted.has(row.competition_player_id)) continue;
    const hasEvents = get(db, "SELECT COUNT(*) n FROM event WHERE game_player_id = ?", row.id).n;
    if (!hasEvents) run(db, "DELETE FROM game_player WHERE id = ?", row.id);
  }
  for (const cpId of wanted) {
    if (present.has(cpId)) continue;
    const row = get(db, "SELECT squad_number FROM competition_player WHERE id = ?", cpId);
    run(db, "INSERT OR IGNORE INTO game_player (game_id, competition_player_id, squad_number) VALUES (?,?,?)", gameId, cpId, row?.squad_number ?? null);
  }
  ok(res, `/referee/game/${gameId}`, "Convocatoria guardada");
});

/* ------------------------------------------------------------------ home */

// Registered after the admin and referee sections so those one-segment paths
// are not mistaken for a language code.
route("GET", "/:lang", (req, res) => sendHtml(res, views.homeView(scopeFor(req))));

/* ------------------------------------------------------------------ 404 */

async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && (url.pathname === "/styles.css" || url.pathname === "/live.js" || url.pathname === "/referee.js")) {
      if (await serveStatic(req, res, url.pathname)) return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/public/")) {
      if (await serveStatic(req, res, url.pathname.slice(7))) return;
    }
    const found = matchRoute(req.method, url.pathname);
    if (found) return await found.handler(req, res, found.params);
    // Language-less public paths are redirected to /es for convenience.
    const legacy = ["/competitions", "/calendar", "/archive", "/competition"];
    if (legacy.some((p) => url.pathname.startsWith(p))) return redirect(res, `/es${url.pathname}${url.search}`);
    sendHtml(res, views.notFoundView(scopeFor(req)), 404);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Internal error: ${error.message}`);
    }
  }
}

createServer(handler).listen(PORT, HOST, () => {
  console.log(`LIGAS running at http://${HOST}:${PORT}`);
  console.log(`  Sitio público : http://${HOST}:${PORT}/es`);
  console.log(`  Admin         : http://${HOST}:${PORT}/admin`);
  console.log(`  Árbitro       : http://${HOST}:${PORT}/referee`);
});
