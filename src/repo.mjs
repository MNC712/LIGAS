// Read models shared by the public and admin views.
import { all, get } from "./db.mjs";

const GAME_SELECT = `
  SELECT g.id, g.game_date, g.status, g.score_home, g.score_away,
         g.penalty_score_home, g.penalty_score_away, g.code, g.pitch_id,
         r.id AS round_id, r.name AS round_name, r.stage, r.group_id,
         cg.name AS group_name, r.competition_id,
         ht.competition_team_id AS home_ct, hteam.name AS home_name, hteam.slug AS home_slug,
         hteam.crest_url AS home_crest, hteam.name_short AS home_short,
         at.competition_team_id AS away_ct, ateam.name AS away_name, ateam.slug AS away_slug,
         ateam.crest_url AS away_crest, ateam.name_short AS away_short,
         p.name AS pitch_name, p.address AS pitch_address, p.city AS pitch_city
    FROM game g
    JOIN round r ON r.id = g.round_id
    LEFT JOIN competition_group cg ON cg.id = r.group_id
    JOIN game_team ht ON ht.game_id = g.id AND ht.team_type = 'HOME'
    JOIN game_team at ON at.game_id = g.id AND at.team_type = 'AWAY'
    JOIN competition_team hct ON hct.id = ht.competition_team_id
    JOIN team hteam ON hteam.id = hct.team_id
    JOIN competition_team act ON act.id = at.competition_team_id
    JOIN team ateam ON ateam.id = act.team_id
    LEFT JOIN pitch p ON p.id = g.pitch_id`;

export function competitionGames(db, competitionId, { status = null, order = "DESC", limit = null, offset = 0, stage = null, groupId = null } = {}) {
  const params = [competitionId];
  let sql = `${GAME_SELECT} WHERE r.competition_id = ?`;
  if (status) { sql += " AND g.status = ?"; params.push(status); }
  if (stage) { sql += " AND r.stage = ?"; params.push(stage); }
  if (groupId !== null) { sql += " AND r.group_id = ?"; params.push(groupId); }
  sql += ` ORDER BY g.game_date ${order}, r.ordering ${order}, r.id ${order}, g.id ${order}`;
  if (limit !== null) { sql += " LIMIT ? OFFSET ?"; params.push(limit, offset); }
  return all(db, sql, ...params);
}

export function liveGames(db, competitionId) {
  return all(
    db,
    `${GAME_SELECT} WHERE r.competition_id = ? AND g.status IN ('STARTED','BREAK')
      ORDER BY g.game_date ASC, g.id ASC`,
    competitionId
  );
}

export function countCompetitionGames(db, competitionId, status = null) {
  const params = [competitionId];
  let sql = `SELECT COUNT(*) AS n FROM game g JOIN round r ON r.id = g.round_id WHERE r.competition_id = ?`;
  if (status) { sql += " AND g.status = ?"; params.push(status); }
  return get(db, sql, ...params).n;
}

export function gameById(db, id) {
  return get(db, `${GAME_SELECT} WHERE g.id = ?`, id);
}

export function gamesForTeam(db, competitionId, teamId, { status = null, limit = 10, order = "DESC" } = {}) {
  const params = [competitionId, teamId, teamId];
  let sql = `${GAME_SELECT} WHERE r.competition_id = ?
    AND (hct.team_id = ? OR act.team_id = ?)`;
  if (status) { sql += " AND g.status = ?"; params.push(status); }
  sql += ` ORDER BY g.game_date ${order}, g.id ${order} LIMIT ?`;
  params.push(limit);
  return all(db, sql, ...params);
}

// Group-stage rounds first (by their group and ordering), then playoff rounds.
export function roundsForCompetition(db, competitionId) {
  return all(
    db,
    `SELECT r.*, cg.name AS group_name,
        (SELECT COUNT(*) FROM game g WHERE g.round_id = r.id) AS games,
        (SELECT COUNT(*) FROM game g WHERE g.round_id = r.id AND g.status = 'FINISHED') AS finished
       FROM round r LEFT JOIN competition_group cg ON cg.id = r.group_id
      WHERE r.competition_id = ?
      ORDER BY CASE r.stage WHEN 'GROUP' THEN 0 ELSE 1 END, r.ordering, r.id`,
    competitionId
  );
}

export function groupsForCompetition(db, competitionId) {
  return all(
    db,
    `SELECT cg.*, (SELECT COUNT(*) FROM competition_team ct WHERE ct.group_id = cg.id) AS teams
       FROM competition_group cg WHERE cg.competition_id = ? ORDER BY cg.ordering, cg.id`,
    competitionId
  );
}

export function competitionTeams(db, competitionId) {
  return all(
    db,
    `SELECT ct.id AS competition_team_id, ct.group_id, t.id AS team_id, t.name, t.slug, t.crest_url
       FROM competition_team ct JOIN team t ON t.id = ct.team_id
      WHERE ct.competition_id = ? ORDER BY t.name`,
    competitionId
  );
}

export function competitionTeamBySlug(db, competitionId, teamSlug) {
  return get(
    db,
    `SELECT ct.id AS competition_team_id, ct.competition_id, ct.group_id, t.*
       FROM competition_team ct JOIN team t ON t.id = ct.team_id
      WHERE ct.competition_id = ? AND t.slug = ?`,
    competitionId, teamSlug
  );
}

export function teamImages(db, teamId) {
  return all(db, "SELECT id, url FROM team_image WHERE team_id = ?", teamId);
}

export function playerBySlug(db, playerSlug) {
  return get(db, "SELECT * FROM player WHERE slug = ?", playerSlug);
}

export function teamRoster(db, competitionId, competitionTeamId) {
  return all(
    db,
    `SELECT cp.id AS competition_player_id, cp.squad_number, p.slug, p.first_name, p.last_name,
            p.date_of_birth, p.avatar_url
       FROM competition_player cp JOIN player p ON p.id = cp.player_id
      WHERE cp.competition_id = ? AND cp.competition_team_id = ?
      ORDER BY (cp.squad_number IS NULL), cp.squad_number, p.last_name`,
    competitionId, competitionTeamId
  );
}

export function gameEvents(db, gameId) {
  return all(
    db,
    `SELECT e.id, e.time, e.in_additional_time, e.for_opposite_team, e.name,
            et.name AS type_name, et.system_name,
            gp.competition_player_id,
            (p.first_name || ' ' || p.last_name) AS player_name, p.slug AS player_slug,
            ct.id AS competition_team_id, t.name AS team_name, t.slug AS team_slug,
            gp.squad_number
       FROM event e
       JOIN event_type et ON et.id = e.event_type_id
       LEFT JOIN game_player gp ON gp.id = e.game_player_id
       LEFT JOIN competition_player cp ON cp.id = gp.competition_player_id
       LEFT JOIN player p ON p.id = cp.player_id
       LEFT JOIN competition_team ct ON ct.id = cp.competition_team_id
       LEFT JOIN team t ON t.id = ct.team_id
      WHERE e.game_id = ?
      ORDER BY e.time ASC, e.id ASC`,
    gameId
  );
}

// Everything needed to draw a live scoreboard: the match row plus its events.
export function liveSnapshot(db, gameId) {
  const game = get(
    db,
    `SELECT id, status, score_home, score_away, penalty_score_home, penalty_score_away
       FROM game WHERE id = ?`,
    gameId
  );
  if (!game) return null;
  return { game, events: gameEvents(db, gameId) };
}

export function playerSeasonGameLog(db, competitionId, playerId) {
  return all(
    db,
    `SELECT g.id, g.game_date, g.status, g.score_home, g.score_away,
            ht.competition_team_id AS home_ct, hteam.name AS home_name,
            at.competition_team_id AS away_ct, ateam.name AS away_name,
            cp.competition_team_id AS player_ct,
            (SELECT COUNT(*) FROM event e JOIN event_type et ON et.id = e.event_type_id
              WHERE e.game_id = g.id AND e.game_player_id = gp.id AND et.system_name = 'goal') AS goals,
            (SELECT COUNT(*) FROM event e JOIN event_type et ON et.id = e.event_type_id
              WHERE e.game_id = g.id AND e.game_player_id = gp.id AND et.system_name = 'assist') AS assists,
            (SELECT COUNT(*) FROM event e JOIN event_type et ON et.id = e.event_type_id
              WHERE e.game_id = g.id AND e.game_player_id = gp.id AND et.system_name = 'yellow_card') AS yellow,
            (SELECT COUNT(*) FROM event e JOIN event_type et ON et.id = e.event_type_id
              WHERE e.game_id = g.id AND e.game_player_id = gp.id AND et.system_name = 'red_card') AS red
       FROM game_player gp
       JOIN game g ON g.id = gp.game_id
       JOIN round r ON r.id = g.round_id
       JOIN competition_player cp ON cp.id = gp.competition_player_id
       JOIN game_team ht ON ht.game_id = g.id AND ht.team_type = 'HOME'
       JOIN team hteam ON hteam.id = (SELECT team_id FROM competition_team WHERE id = ht.competition_team_id)
       JOIN game_team at ON at.game_id = g.id AND at.team_type = 'AWAY'
       JOIN team ateam ON ateam.id = (SELECT team_id FROM competition_team WHERE id = at.competition_team_id)
      WHERE r.competition_id = ? AND cp.player_id = ?
      ORDER BY g.game_date DESC`,
    competitionId, playerId
  );
}

export function seasons(db) {
  return all(db, "SELECT * FROM season ORDER BY start_date DESC");
}

export function activeSponsors(db) {
  return all(db, "SELECT * FROM sponsor WHERE active = 1 ORDER BY ordering, id");
}

export function allSponsors(db) {
  return all(db, "SELECT * FROM sponsor ORDER BY ordering, id");
}

export function competitions(db) {
  return all(
    db,
    `SELECT c.*, s.slug AS season_slug, s.name AS season_name,
        (SELECT COUNT(*) FROM competition_team ct WHERE ct.competition_id = c.id) AS teams,
        (SELECT COUNT(*) FROM competition_group cg WHERE cg.competition_id = c.id) AS groups_count,
        (SELECT COUNT(*) FROM round r WHERE r.competition_id = c.id AND r.stage = 'GROUP') AS group_rounds,
        (SELECT COUNT(*) FROM round r WHERE r.competition_id = c.id AND r.stage = 'PLAYOFF') AS playoff_rounds,
        (SELECT COUNT(*) FROM game g JOIN round r ON r.id = g.round_id WHERE r.competition_id = c.id) AS games
       FROM competition c LEFT JOIN season s ON s.id = c.season_id
      ORDER BY c.id`,
  );
}

export function competitionsForSeason(db, seasonId) {
  return all(
    db,
    `SELECT c.*, s.slug AS season_slug FROM competition c
       LEFT JOIN season s ON s.id = c.season_id
      WHERE c.season_id = ? ORDER BY c.id`,
    seasonId
  );
}
