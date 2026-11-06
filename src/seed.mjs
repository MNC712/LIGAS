// Seed the local database from the harvested public dataset.
// Run: node src/seed.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openDb, resetDb, run, get, ROOT } from "./db.mjs";
import { hashPassword, slugify } from "./domain.mjs";

const raw = JSON.parse(readFileSync(join(ROOT, "data", "raw.json"), "utf8"));
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

console.log(`Seeding ${raw.organization.name} (${raw.domain}) from ${raw.harvested_at}`);

const db = resetDb();

/* ------------------------------------------------------------------- org */
const o = raw.organization;
const img = (i) => i?.url || null;
run(
  db,
  `INSERT INTO organization
   (id, name, domain, primary_color, secondary_color, background_color, background_accent_color,
    text_color, text_secondary_color, home_url, contact_email, timezone, date_format, time_format,
    news_page_enabled, contact_page_enabled, gallery_page_enabled, home_page_enabled,
    logo_url, banner_url, gallery_json, socials_json)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  num(o.id), o.name, o.domain, o.primary_color, o.secondary_color, o.background_color,
  o.background_accent_color, o.text_color, o.text_secondary_color, o.home_url, o.contact_email,
  o.timezone || "Europe/Warsaw", o.date_format, o.time_format,
  o.news_page_enabled ? 1 : 0, o.contact_page_enabled ? 1 : 0,
  o.gallery_page_enabled ? 1 : 0, o.home_page_enabled ? 1 : 0,
  img(o.logo), img(o.banner_image),
  JSON.stringify((o.gallery_images || []).map((g) => g.url)),
  JSON.stringify({
    facebook: o.social_facebook_url, instagram: o.social_instagram_url,
    youtube: o.social_youtube_url, tiktok: o.social_tiktok_url, x: o.social_x_url,
  })
);

for (const s of o.sponsors || []) {
  run(db, "INSERT INTO sponsor (id, name, url, image_url) VALUES (?,?,?,?)", num(s.id), s.name, s.url, img(s.image));
}
for (const f of o.contact_fields || []) {
  run(db, "INSERT INTO contact_field (id, name, value) VALUES (?,?,?)", num(f.id), f.name, f.value);
}
for (const p of o.posts || []) {
  run(
    db, "INSERT INTO post (id, title, slug, content, featured, created_at, image_url) VALUES (?,?,?,?,?,?,?)",
    num(p.id), p.title, p.slug, p.content, p.featured ? 1 : 0, p.created_at, img(p.image)
  );
}

/* ------------------------------------------------------- league / season */
const leagueComp = raw.competitions.find((c) => c.type === "LEAGUE");
if (leagueComp?.league) {
  run(db, "INSERT INTO league (id, name, slug) VALUES (?,?,?)", num(leagueComp.league.id), leagueComp.league.name, leagueComp.league.slug);
}
for (const s of raw.seasons) {
  run(
    db, "INSERT INTO season (id, name, slug, start_date, end_date, regulations, classification_enabled) VALUES (?,?,?,?,?,?,?)",
    num(s.id), s.name, s.slug, s.start_date, s.end_date, s.regulations, s.classification_enabled ? 1 : 0
  );
}
for (const c of raw.competitions) {
  run(
    db,
    `INSERT INTO competition
     (id, slug, name, type, state, is_archive, about, regulations, league_id, season_id,
      points_win, points_draw, points_lose, ranking_points, ranking_head_to_head,
      ranking_goal_diff, ranking_goals_scored, ranking_wins, cup_name, cup_start_date,
      cup_end_date, cup_format, cup_phase, placement_depth, half_time, red_card_suspension_matches)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    num(c.id), c.slug ?? null, c.name, c.type, c.state || "PUBLISHED", c.is_archive ? 1 : 0,
    c.about, c.regulations, num(c.league?.id), num(c.season?.id),
    c.league_points_win ?? 3, c.league_points_draw ?? 1, c.league_points_lose ?? 0,
    c.league_ranking_points ?? "DESC", c.league_ranking_head_to_head ?? "DESC",
    c.league_ranking_goal_diff ?? "DESC", c.league_ranking_goals_scored ?? "DESC",
    c.league_ranking_wins ?? "DESC", c.cup_name, c.cup_start_date, c.cup_end_date,
    c.cup_format, c.cup_phase, c.placement_depth, c.half_time ?? 10, c.red_card_suspension_matches ?? 1
  );
}

/* ------------------------------------------------------------------ teams */
for (const t of raw.teams) {
  run(
    db, "INSERT INTO team (id, slug, name, name_short, city, about, crest_url, image_url) VALUES (?,?,?,?,?,?,?,?)",
    num(t.id), t.slug, t.name, t.name_short, t.city, t.about, img(t.crest), img(t.image)
  );
  for (const im of t.team_images || []) {
    run(db, "INSERT INTO team_image (team_id, url) VALUES (?,?)", num(t.id), img(im));
  }
}
for (const ct of raw.competitionTeams) {
  run(db, "INSERT INTO competition_team (id, competition_id, team_id) VALUES (?,?,?)",
    num(ct.id), num(ct.competition_id), num(ct.team_id));
}

/* ------------------------------------------------------- players + stats */
for (const p of raw.players) {
  run(
    db, "INSERT OR IGNORE INTO player (id, slug, first_name, last_name, date_of_birth, about, avatar_url) VALUES (?,?,?,?,?,?,?)",
    num(p.player.id), p.player.slug, p.player.first_name, p.player.last_name,
    p.player.date_of_birth, p.player.about, img(p.player.avatar)
  );
  run(
    db, "INSERT OR IGNORE INTO competition_player (id, competition_id, competition_team_id, player_id, squad_number) VALUES (?,?,?,?,?)",
    num(p.id), num(p.competition_id), num(p.competition_team_id), num(p.player_id), p.squad_number
  );
}

/* ----------------------------------------------------------------- rounds */
for (const r of raw.rounds) {
  run(
    db, "INSERT INTO round (id, competition_id, name, cup_phase, cup_bracket, cup_bracket_order, cup_bracket_round, elimination_format) VALUES (?,?,?,?,?,?,?,?)",
    num(r.id), num(r.competition_id), r.name, r.cup_phase, r.cup_bracket,
    r.cup_bracket_order, r.cup_bracket_round, r.elimination_format
  );
}

/* ------------------------------------------------------- pitches + games */
for (const p of raw.pitches) {
  run(db, "INSERT INTO pitch (id, name, address, city, slug) VALUES (?,?,?,?,?)",
    num(p.id), p.name, p.address, p.city, p.slug);
}

const cpByCompPlayer = new Map(); // `${competitionId}:${playerId}` -> competition_player id
for (const row of db.prepare("SELECT id, competition_id, player_id FROM competition_player").all()) {
  cpByCompPlayer.set(`${row.competition_id}:${row.player_id}`, row.id);
}

// Event types observed in the capture plus the three the referee screen needs.
const eventTypes = new Map();
for (const g of raw.games) {
  for (const e of g.events || []) {
    if (!eventTypes.has(e.event_type.system_name)) eventTypes.set(e.event_type.system_name, e.event_type.name);
  }
}
const extraTypes = { assist: "Asysta", mvp: "MVP", own_goal: "Samobójcza" };
for (const [system, name] of Object.entries(extraTypes)) if (!eventTypes.has(system)) eventTypes.set(system, name);

let typeId = 1;
const typeIds = {};
for (const [system, name] of eventTypes) {
  run(db, "INSERT INTO event_type (id, name, system_name) VALUES (?,?,?)", typeId, name, system);
  typeIds[system] = typeId++;
}

const eventCountByCp = new Map();
const gamePlayerKey = new Map(); // `${gameId}:${cpId}` -> game_player id
let eventTotal = 0;

for (const g of raw.games) {
  const competitionId = num(g.round?.competition?.id);
  // A couple of rounds are not returned by roundsPublic; recreate them from the
  // round object embedded in the game payload.
  if (g.round?.id) {
    run(
      db,
      `INSERT OR IGNORE INTO round (id, competition_id, name, cup_phase, cup_bracket, cup_bracket_order, cup_bracket_round)
       VALUES (?,?,?,?,?,?,?)`,
      num(g.round.id), competitionId, g.round.name, g.round.cup_phase,
      g.round.cup_bracket, g.round.cup_bracket_order, g.round.cup_bracket_round
    );
  }
  run(
    db,
    `INSERT INTO game (id, round_id, pitch_id, game_date, status, score_home, score_away,
       penalty_score_home, penalty_score_away, code, about, video, stats_counted)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    num(g.id), num(g.round?.id), num(g.pitch?.id), g.game_date, g.status,
    g.score_home, g.score_away, g.penalty_score_home, g.penalty_score_away,
    g.code, g.about, g.video
  );
  run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?,?, 'HOME')",
    num(g.id), num(g.home_team.competition_team.id));
  run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?,?, 'AWAY')",
    num(g.id), num(g.away_team.competition_team.id));

  for (const e of g.events || []) {
    const playerId = num(e.game_player?.competition_player?.player?.id);
    const cpId = cpByCompPlayer.get(`${competitionId}:${playerId}`);
    if (!cpId) continue;
    const key = `${g.id}:${cpId}`;
    let gpId = gamePlayerKey.get(key);
    if (!gpId) {
      gpId = Number(run(db,
        "INSERT INTO game_player (game_id, competition_player_id, squad_number) VALUES (?,?,?)",
        num(g.id), cpId, e.game_player?.squad_number ?? null).lastInsertRowid);
      gamePlayerKey.set(key, gpId);
    }
    run(db,
      "INSERT INTO event (game_id, game_player_id, event_type_id, time, in_additional_time, for_opposite_team, name) VALUES (?,?,?,?,?,?,?)",
      num(g.id), gpId, typeIds[e.event_type.system_name], e.time,
      e.in_additional_time ? 1 : 0, e.for_opposite_team ? 1 : 0, e.name);
    eventTotal++;
    const agg = eventCountByCp.get(cpId) || { goal: 0, yellow_card: 0, red_card: 0 };
    if (agg[e.event_type.system_name] !== undefined) agg[e.event_type.system_name]++;
    eventCountByCp.set(cpId, agg);
  }
}

/* ------------------------------------------- observed aggregates as base */
let statRows = 0;
for (const p of raw.players) {
  const cpId = cpByCompPlayer.get(`${num(p.competition_id)}:${num(p.player_id)}`);
  if (!cpId) continue;
  const ev = eventCountByCp.get(cpId) || {};
  // Base = published season total minus the events we hold, so base + events
  // reproduces the published number exactly.
  run(
    db,
    `INSERT OR REPLACE INTO player_stat_base
     (competition_player_id, games, goals, assists, mvp, yellow, red, conceded)
     VALUES (?,?,?,?,?,?,?,?)`,
    cpId, p.games_played ?? 0,
    (p.goals_scored ?? 0) - (ev.goal || 0),
    p.assists ?? 0, p.mvp ?? 0,
    (p.yellow_cards ?? 0) - (ev.yellow_card || 0),
    (p.red_cards ?? 0) - (ev.red_card || 0),
    p.conceded ?? 0
  );
  statRows++;
}

/* ------------------------------------------------------------------ users */
function addUser(email, name, password, role) {
  const { hash, salt } = hashPassword(password);
  run(db, "INSERT INTO user (email, name, password_hash, password_salt, role) VALUES (?,?,?,?,?)",
    email, name, hash, salt, role);
}
addUser("admin@aquaopen.local", "League administrator", "Admin123!", "ADMIN");
addUser("referee@aquaopen.local", "Match referee", "Referee123!", "REFEREE");
addUser("referee2@aquaopen.local", "Second referee", "Referee123!", "REFEREE");

run(db, "INSERT INTO setting (key, value) VALUES (?,?)", "site_language", "en");

console.log(`  teams=${raw.teams.length} competition_teams=${raw.competitionTeams.length}`);
console.log(`  players=${raw.players.length} stat_bases=${statRows}`);
console.log(`  games=${raw.games.length} events=${eventTotal}`);
console.log(`  standings=${raw.standings[0]?.standings_positions?.length || 0}`);
console.log("Seeded users: admin@aquaopen.local / Admin123!  referee@aquaopen.local / Referee123!");
db.close();
