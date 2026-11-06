// Public league-site views.
import { all, get } from "./db.mjs";
import { html, raw, layout, crest, formBadges, pagination, pageNumbers, icons, pageBanner, tabsNav, emptyState, escapeHtml } from "./render.mjs";
import {
  computeStandings, computePlayerStats, fmtDate, fmtTime, fmtDateTime, competitionBySlugs,
} from "./domain.mjs";
import * as repo from "./repo.mjs";

const PER_PAGE_RESULTS = 15;
const PER_PAGE_PLAYERS = 10;

function sanitizeRich(input) {
  if (!input) return "";
  return String(input)
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "");
}

function score(game) {
  if (game.score_home === null || game.score_away === null) return "—";
  return `${game.score_home} - ${game.score_away}`;
}

function cupPhaseLabel(phase) {
  return {
    FINAL: "Final (F)", THIRD_PLACE: "Tercer puesto (T)",
    SEMI_FINAL: "Semifinal (SF)", QUARTER_FINAL: "Cuartos de final (CF)",
    ROUND_OF_16: "Octavos de final (OF)", GROUP: "Fase de grupos",
  }[phase] || phase || "Ronda";
}

const PHASE_ORDER = ["FINAL", "THIRD_PLACE", "SEMI_FINAL", "QUARTER_FINAL", "ROUND_OF_16", "GROUP"];

/* ------------------------------------------------------------- league ctx */

export function leagueContext(db, leagueSlug, seasonSlug) {
  const competition = competitionBySlugs(db, leagueSlug, seasonSlug);
  if (!competition) return null;
  const league = get(db, "SELECT * FROM league WHERE id = ?", competition.league_id);
  const season = get(db, "SELECT * FROM season WHERE id = ?", competition.season_id);
  return { competition, league, season };
}

function seasonSelect(scope, competition) {
  const seasons = repo.seasons(scope.db);
  return html`<label class="select-field">
    <span class="visually-hidden">Temporada</span>
    <select onchange="if(this.value)location.href=this.value">
      ${seasons.map((s) => {
        const comp = scope.db.prepare(
          `SELECT c.id FROM competition c JOIN league l ON l.id=c.league_id
            WHERE l.slug = ? AND c.season_id = ? AND c.type='LEAGUE'`
        ).get(competition.league?.slug || competition.league_slug, s.id);
        const value = comp ? `/${scope.lang}/league-menu/${competition.league?.slug || competition.league_slug}/${s.slug}` : "";
        return html`<option value="${value}"${s.id === competition.season_id ? " selected" : ""}>${s.name}</option>`;
      })}
    </select>
  </label>`;
}

function leagueChrome(scope, ctx, active) {
  const base = `/${scope.lang}/league-menu/${ctx.league.slug}/${ctx.season.slug}`;
  return {
    base,
    banner: pageBanner({
      org: scope.org,
      chip: ctx.competition.is_archive ? "Datos archivados" : null,
      title: ctx.competition.name,
      aside: seasonSelect(scope, { ...ctx.competition, league_slug: ctx.league.slug }),
    }),
    tabs: tabsNav([
      { href: base, label: "Clasificación", active: active === "tables" },
      { href: `${base}/schedule`, label: "Calendario", active: active === "schedule" },
      { href: `${base}/results`, label: "Resultados", active: active === "results" },
      { href: `${base}/players-list`, label: "Jugadores", active: active === "players" },
      { href: `${base}/regulations`, label: "Reglamento", active: active === "regulations" },
    ]),
  };
}

function page(scope, parts) {
  return layout({
    org: scope.org, theme: scope.theme, lang: scope.lang,
    active: parts.active || "", ...parts,
  }).toString();
}

/* ------------------------------------------------------------------ tables */

export function tablesView(scope, ctx) {
  const chrome = leagueChrome(scope, ctx, "tables");
  const rows = computeStandings(scope.db, ctx.competition.id);
  const tz = scope.theme.timezone;

  const body = html`
  <div class="container">
    <section class="panel">
      <table class="data-table standings-table">
        <thead>
          <tr>
            <th class="col-place">#</th>
            <th class="col-team">Equipos</th>
            <th class="num">Pts</th><th class="num">P</th><th class="num">W</th><th class="num">D</th>
            <th class="num">L</th><th class="num">GF</th><th class="num">GA</th><th class="num">GD</th>
            <th class="col-form">Racha</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => html`
            <tr class="${r.place <= 3 ? "is-podium" : ""}">
              <td class="col-place">
                <span class="place-badge">${r.place <= 3 ? (r.place === 1 ? icons.trophy({ size: 16 }) : icons.bars({ size: 16 })) : ""}<span>${r.place}</span></span>
              </td>
              <td class="col-team">
                <a class="team-cell" href="${chrome.base}/teams/${r.team_slug}">
                  ${crest(r.crest_url, r.team_name)}
                  <span>${r.team_name}</span>
                </a>
              </td>
              <td class="num strong primary">${r.points}</td>
              <td class="num">${r.games_played}</td>
              <td class="num">${r.games_won}</td>
              <td class="num">${r.games_drawn}</td>
              <td class="num">${r.games_lost}</td>
              <td class="num">${r.goals_scored}</td>
              <td class="num">${r.goals_conceded}</td>
              <td class="num">${r.goals_diff}</td>
              <td class="col-form">${formBadges(r.form)}</td>
            </tr>`)}
        </tbody>
      </table>
    </section>

    <section class="podium">
      ${rows.slice(0, 3).map((r) => html`
        <a class="podium-card podium-${r.place}" href="${chrome.base}/teams/${r.team_slug}">
          <span class="podium-place">${r.place}</span>
          ${crest(r.crest_url, r.team_name, "crest crest-lg")}
          <span class="podium-name">${r.team_name}</span>
          <span class="podium-points">${r.points} pts</span>
        </a>`)}
    </section>
    <p class="table-note">La clasificación se calcula con los partidos de liga finalizados, con ${ctx.competition.points_win}/${ctx.competition.points_draw}/${ctx.competition.points_lose} puntos por victoria/empate/derrota.</p>
  </div>`;

  return page(scope, {
    title: `Clasificación - ${ctx.competition.name}`, description: `Clasificación de ${ctx.competition.name}`,
    body, banner: chrome.banner, tabs: chrome.tabs, active: "league",
  });
}

/* ---------------------------------------------------------------- schedule */

export function scheduleView(scope, ctx) {
  const chrome = leagueChrome(scope, ctx, "schedule");
  const tz = scope.theme.timezone;
  const games = repo.competitionGames(scope.db, ctx.competition.id, { status: "NOT_STARTED", order: "ASC" });
  const byRound = new Map();
  for (const g of games) {
    if (!byRound.has(g.round_id)) byRound.set(g.round_id, { name: g.round_name, games: [] });
    byRound.get(g.round_id).games.push(g);
  }

  const body = html`
  <div class="container">
    ${games.length === 0 ? emptyState("No hay partidos programados", "Ya se han jugado todos los partidos de esta competición.") : ""}
    ${[...byRound.values()].map((round) => html`
      <section class="round-block">
        <h2 class="round-title">${round.name}</h2>
        <div class="panel">
          <table class="data-table games-table">
            <thead><tr><th>Fecha</th><th>Equipo 1</th><th class="center">Marcador</th><th>Equipo 2</th><th>Sede</th></tr></thead>
            <tbody>
              ${round.games.map((g) => html`
                <tr>
                  <td class="nowrap muted">${fmtDateTime(g.game_date, tz)}</td>
                  <td><a class="team-cell team-cell-end" href="${chrome.base}/teams/${g.home_slug}"><span>${g.home_name}</span>${crest(g.home_crest, g.home_name)}</a></td>
                  <td class="center score-cell"><a href="${chrome.base}/games/${g.id}">${g.status === "FINISHED" ? score(g) : "vs"}</a></td>
                  <td><a class="team-cell" href="${chrome.base}/teams/${g.away_slug}">${crest(g.away_crest, g.away_name)}<span>${g.away_name}</span></a></td>
                  <td class="muted">${g.pitch_name || "—"}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>
      </section>`)}
  </div>`;

  return page(scope, {
    title: `Calendario - ${ctx.competition.name}`, body,
    banner: chrome.banner, tabs: chrome.tabs, active: "league",
  });
}

/* ----------------------------------------------------------------- results */

export function resultsView(scope, ctx, { page: pageNo = 1 } = {}) {
  const chrome = leagueChrome(scope, ctx, "results");
  const tz = scope.theme.timezone;
  const total = repo.countCompetitionGames(scope.db, ctx.competition.id, "FINISHED");
  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE_RESULTS));
  const current = Math.min(Math.max(1, Number(pageNo) || 1), lastPage);
  const games = repo.competitionGames(scope.db, ctx.competition.id, {
    status: "FINISHED", order: "DESC", limit: PER_PAGE_RESULTS, offset: (current - 1) * PER_PAGE_RESULTS,
  });
  const base = `${chrome.base}/results`;

  const body = html`
  <div class="container">
    <section class="panel">
      <table class="data-table games-table">
        <thead><tr><th>Fecha</th><th>Equipo 1</th><th class="center">Marcador</th><th>Equipo 2</th><th>Sede</th></tr></thead>
        <tbody>
          ${games.map((g) => html`
            <tr>
              <td class="nowrap muted">${fmtDateTime(g.game_date, tz)}</td>
              <td><a class="team-cell team-cell-end" href="${chrome.base}/teams/${g.home_slug}"><span>${g.home_name}</span>${crest(g.home_crest, g.home_name)}</a></td>
              <td class="center score-cell"><a href="${chrome.base}/games/${g.id}">${score(g)}${g.penalty_score_home !== null && g.penalty_score_away !== null ? html`<small class="pen">(${g.penalty_score_home} - ${g.penalty_score_away})</small>` : ""}</a></td>
              <td><a class="team-cell" href="${chrome.base}/teams/${g.away_slug}">${crest(g.away_crest, g.away_name)}<span>${g.away_name}</span></a></td>
              <td class="muted">${g.pitch_name || "—"}</td>
            </tr>`)}
        </tbody>
      </table>
    </section>
    ${pagination({ page: current, lastPage, href: (p) => `${base}?page=${p}` })}
  </div>`;

  return page(scope, {
    title: `Resultados - ${ctx.competition.name}`, body,
    banner: chrome.banner, tabs: chrome.tabs, active: "league",
  });
}

/* ------------------------------------------------------------- player list */

const SORTS = {
  goals: (a, b) => b.goals_scored - a.goals_scored,
  assists: (a, b) => b.assists - a.assists,
  mvp: (a, b) => b.mvp - a.mvp,
  played: (a, b) => b.games_played - a.games_played,
  yellow: (a, b) => b.yellow_cards - a.yellow_cards,
  red: (a, b) => b.red_cards - a.red_cards,
  conceded: (a, b) => b.conceded - a.conceded,
  name: (a, b) => a.full_name.localeCompare(b.full_name),
};

export function playersView(scope, ctx, { page: pageNo = 1, sort = "goals", team = "" } = {}) {
  const chrome = leagueChrome(scope, ctx, "players");
  const base = `${chrome.base}/players-list`;
  let stats = computePlayerStats(scope.db, ctx.competition.id);
  if (team) stats = stats.filter((p) => p.team_slug === team);
  stats.sort((SORTS[sort] || SORTS.goals));
  stats.sort((a, b) => (SORTS[sort] || SORTS.goals)(a, b) || a.full_name.localeCompare(b.full_name));

  const total = stats.length;
  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE_PLAYERS));
  const current = Math.min(Math.max(1, Number(pageNo) || 1), lastPage);
  const rows = stats.slice((current - 1) * PER_PAGE_PLAYERS, current * PER_PAGE_PLAYERS);
  const href = (p) => `${base}?page=${p}&sort=${encodeURIComponent(sort)}${team ? `&team=${encodeURIComponent(team)}` : ""}`;
  const sortLink = (key, label) => html`<a class="sort-link${sort === key ? " is-active" : ""}" href="${base}?sort=${key}${team ? `&team=${encodeURIComponent(team)}` : ""}">${label}${sort === key ? html`<span class="sort-caret">▾</span>` : ""}</a>`;
  const teams = [...new Map(stats.map((p) => [p.team_slug, p])).values()].sort((a, b) => a.team_name.localeCompare(b.team_name));

  const body = html`
  <div class="container">
    <form class="list-filter" method="get" action="${base}">
      <label>Equipo
        <select name="team" onchange="this.form.submit()">
          <option value="">Todos los equipos</option>
          ${teams.map((t) => html`<option value="${t.team_slug}"${team === t.team_slug ? " selected" : ""}>${t.team_name}</option>`)}
        </select>
      </label>
      <input type="hidden" name="sort" value="${sort}" />
    </form>
    <section class="panel">
      <table class="data-table players-table">
        <thead>
          <tr>
            <th class="col-name">${sortLink("name", "Nombre")}</th>
            <th>Equipo</th>
            <th class="num">${sortLink("played", "PJ")}</th>
            <th class="num">${sortLink("goals", "Goles")}</th>
            <th class="num">${sortLink("assists", "Asist.")}</th>
            <th class="num">${sortLink("mvp", "MVP")}</th>
            <th class="num">${sortLink("yellow", "Amar.")}</th>
            <th class="num">${sortLink("red", "Rojas")}</th>
            <th class="num">${sortLink("conceded", "Encaj.")}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((p) => html`
            <tr>
              <td class="col-name"><a class="player-cell" href="${chrome.base}/teams/${p.team_slug}/players/${p.slug}">
                ${p.avatar_url ? html`<img class="avatar" src="${p.avatar_url}" alt="" />` : html`<span class="avatar avatar--empty">${(p.first_name?.[0] || "") + (p.last_name?.[0] || "")}</span>`}
                <span>${p.full_name}</span></a></td>
              <td class="muted">${p.team_name}</td>
              <td class="num">${p.games_played}</td>
              <td class="num strong">${p.goals_scored}</td>
              <td class="num">${p.assists}</td>
              <td class="num">${p.mvp}</td>
              <td class="num">${p.yellow_cards}</td>
              <td class="num">${p.red_cards}</td>
              <td class="num">${p.conceded}</td>
            </tr>`)}
        </tbody>
      </table>
    </section>
    ${pageNumbers({ page: current, lastPage, href })}
    <p class="table-note">${total} jugadores en esta competición. Las columnas son ordenables; las estadísticas son totales de la temporada.</p>
  </div>`;

  return page(scope, {
    title: `Jugadores - ${ctx.competition.name}`, body,
    banner: chrome.banner, tabs: chrome.tabs, active: "league",
  });
}

/* ------------------------------------------------------------- regulations */

export function regulationsView(scope, ctx) {
  const chrome = leagueChrome(scope, ctx, "regulations");
  const content = ctx.competition.regulations || ctx.season.regulations || "";
  const body = html`<div class="container">
    <article class="panel prose">${content ? raw(sanitizeRich(content)) : emptyState("Sin reglamento publicado")}</article>
  </div>`;
  return page(scope, { title: `Reglamento - ${ctx.competition.name}`, body, banner: chrome.banner, tabs: chrome.tabs, active: "league" });
}

/* -------------------------------------------------------------------- team */

export function teamView(scope, ctx, teamSlug, section = "about") {
  const team = repo.competitionTeamBySlug(scope.db, ctx.competition.id, teamSlug);
  if (!team) return null;
  const base = `/${scope.lang}/league-menu/${ctx.league.slug}/${ctx.season.slug}`;
  const teamBase = `${base}/teams/${team.slug}`;
  const tz = scope.theme.timezone;
  const standings = computeStandings(scope.db, ctx.competition.id);
  const position = standings.find((s) => s.competition_team_id === team.competition_team_id);
  const stats = computePlayerStats(scope.db, ctx.competition.id).filter((p) => p.competition_team_id === team.competition_team_id);
  const recent = repo.gamesForTeam(scope.db, ctx.competition.id, team.id, { status: "FINISHED", limit: 5 });
  const upcoming = repo.gamesForTeam(scope.db, ctx.competition.id, team.id, { status: "NOT_STARTED", limit: 5, order: "ASC" });
  const allGames = repo.gamesForTeam(scope.db, ctx.competition.id, team.id, { limit: 100 });
  const gallery = repo.teamImages(scope.db, team.id);

  const banner = pageBanner({
    org: scope.org,
    chip: ctx.competition.name,
    title: html`<span class="banner-team">${crest(team.crest_url, team.name, "crest crest-lg")}<span>${team.name}</span></span>`,
    aside: seasonSelect(scope, { ...ctx.competition, league_slug: ctx.league.slug }),
  });
  const tabs = tabsNav([
    { href: teamBase, label: "El equipo", active: section === "about" },
    { href: `${teamBase}/matches`, label: "Partidos", active: section === "matches" },
    { href: `${teamBase}/players`, label: "Jugadores", active: section === "players" },
    { href: `${teamBase}/gallery`, label: "Fotos", active: section === "gallery" },
  ]);

  let content;
  if (section === "matches") {
    content = html`<section class="panel">
      <table class="data-table games-table">
        <thead><tr><th>Fecha</th><th>Rival</th><th class="center">Marcador</th><th>Sede</th></tr></thead>
        <tbody>${allGames.map((g) => {
          const home = g.home_ct === team.competition_team_id;
          const opponent = home ? g.away_name : g.home_name;
          const gf = home ? g.score_home : g.score_away;
          const ga = home ? g.score_away : g.score_home;
          return html`<tr>
            <td class="muted nowrap">${fmtDateTime(g.game_date, tz)}</td>
            <td><a class="team-cell" href="${base}/teams/${home ? g.away_slug : g.home_slug}">${crest(home ? g.away_crest : g.home_crest, opponent)}<span>${opponent}</span></a></td>
            <td class="center score-cell"><a href="${base}/games/${g.id}">${gf === null || ga === null ? "—" : `${gf} - ${ga}`}</a></td>
            <td class="muted">${g.pitch_name || "—"}</td>
          </tr>`;
        })}</tbody>
      </table>
    </section>`;
  } else if (section === "players") {
    content = html`<section class="panel">
      <table class="data-table">
        <thead><tr><th>#</th><th>Jugador</th><th class="num">PJ</th><th class="num">Goles</th><th class="num">Asist.</th><th class="num">MVP</th><th class="num">Amar.</th><th class="num">Rojas</th></tr></thead>
        <tbody>${stats
          .sort((a, b) => b.goals_scored - a.goals_scored)
          .map((p) => html`<tr>
            <td class="muted">${p.squad_number ?? "—"}</td>
            <td><a class="player-cell" href="${teamBase}/players/${p.slug}">
              ${p.avatar_url ? html`<img class="avatar" src="${p.avatar_url}" alt="" />` : html`<span class="avatar avatar--empty">${(p.first_name?.[0] || "") + (p.last_name?.[0] || "")}</span>`}
              <span>${p.full_name}</span></a></td>
            <td class="num">${p.games_played}</td>
            <td class="num strong">${p.goals_scored}</td>
            <td class="num">${p.assists}</td>
            <td class="num">${p.mvp}</td>
            <td class="num">${p.yellow_cards}</td>
            <td class="num">${p.red_cards}</td>
          </tr>`)}</tbody>
      </table>
    </section>`;
  } else if (section === "gallery") {
    content = gallery.length
      ? html`<div class="gallery-grid">${gallery.map((im) => html`<a class="gallery-item" href="${im.url}" target="_blank" rel="noopener"><img src="${im.url}" alt="${team.name}" loading="lazy" /></a>`)}</div>`
      : html`<section class="panel">${emptyState("Aún no hay fotos", "Aquí aparecerán las fotos del equipo publicadas por la liga.")}</section>`;
  } else {
    content = html`
      <div class="two-col">
        <section class="panel">
          <h2 class="panel-title">Resultados en liga</h2>
          <table class="mini-table">
            <tbody>
              <tr><th>Clasificación</th><td>${position ? position.place : "—"}</td></tr>
              <tr><th>Puntos</th><td>${position ? position.points : "—"}</td></tr>
              <tr><th>Jugados</th><td>${position ? position.games_played : "—"}</td></tr>
              <tr><th>Victorias</th><td>${position ? position.games_won : "—"}</td></tr>
              <tr><th>Empates</th><td>${position ? position.games_drawn : "—"}</td></tr>
              <tr><th>Derrotas</th><td>${position ? position.games_lost : "—"}</td></tr>
              <tr><th>Goles</th><td>${position ? `${position.goals_scored}:${position.goals_conceded}` : "—"}</td></tr>
            </tbody>
          </table>
        </section>
        <section class="panel">
          <h2 class="panel-title">Últimos partidos</h2>
          <table class="mini-table">
            <tbody>${recent.map((g) => {
              const home = g.home_ct === team.competition_team_id;
              return html`<tr>
                <td class="muted nowrap">${fmtDate(g.game_date, tz)}</td>
                <td><a href="${base}/teams/${home ? g.away_slug : g.home_slug}">${home ? g.away_name : g.home_name}</a></td>
                <td class="num">${home ? `${g.score_home} - ${g.score_away}` : `${g.score_away} - ${g.score_home}`}</td>
              </tr>`;
            })}</tbody>
          </table>
          ${upcoming.length ? html`<h3 class="panel-subtitle">Próximos</h3>
          <ul class="plain-list">${upcoming.map((g) => html`<li><span class="muted">${fmtDateTime(g.game_date, tz)}</span> ${g.home_name} vs ${g.away_name}</li>`)}</ul>` : ""}
        </section>
      </div>
      ${team.about ? html`<section class="panel prose"><h2 class="panel-title">Sobre el equipo</h2>${raw(sanitizeRich(team.about))}</section>` : ""}`;
  }

  const body = html`<div class="container">${content}</div>`;
  return page(scope, { title: `${team.name} - ${ctx.competition.name}`, body, banner, tabs, active: "league" });
}

/* ------------------------------------------------------------ player page */

export function playerView(scope, ctx, teamSlug, playerSlug) {
  const team = repo.competitionTeamBySlug(scope.db, ctx.competition.id, teamSlug);
  if (!team) return null;
  const player = repo.playerBySlug(scope.db, playerSlug);
  if (!player) return null;
  player.full_name = `${player.first_name || ""} ${player.last_name || ""}`.trim();
  const stats = computePlayerStats(scope.db, ctx.competition.id)
    .find((p) => p.player_id === player.id && p.competition_team_id === team.competition_team_id);
  if (!stats) return null;
  const base = `/${scope.lang}/league-menu/${ctx.league.slug}/${ctx.season.slug}`;
  const log = repo.playerSeasonGameLog(scope.db, ctx.competition.id, player.id);
  const tz = scope.theme.timezone;

  const banner = pageBanner({
    org: scope.org,
    chip: team.name,
    title: player.full_name,
    aside: seasonSelect(scope, { ...ctx.competition, league_slug: ctx.league.slug }),
  });
  const tabs = tabsNav([
    { href: `${base}/teams/${team.slug}`, label: "El equipo", active: false },
    { href: `${base}/teams/${team.slug}/matches`, label: "Partidos", active: false },
    { href: `${base}/teams/${team.slug}/players`, label: "Jugadores", active: false },
    { href: `${base}/teams/${team.slug}/gallery`, label: "Fotos", active: false },
  ]);

  const body = html`<div class="container">
    <div class="two-col">
      <section class="panel player-card">
        <div class="player-hero">
          ${player.avatar_url ? html`<img class="player-avatar" src="${player.avatar_url}" alt="${player.full_name}" />` : html`<span class="player-avatar player-avatar--empty">${(player.first_name?.[0] || "") + (player.last_name?.[0] || "")}</span>`}
          <div>
            <h2 class="player-name">${player.full_name}</h2>
            <p class="muted">${team.name}${player.date_of_birth ? ` · nacido el ${fmtDate(player.date_of_birth, tz)}` : ""}${stats.squad_number ? ` · #${stats.squad_number}` : ""}</p>
          </div>
        </div>
        <div class="stat-grid">
          ${[["PJ", stats.games_played], ["Goles", stats.goals_scored], ["Asist.", stats.assists], ["MVP", stats.mvp], ["Amar.", stats.yellow_cards], ["Rojas", stats.red_cards]]
            .map(([label, value]) => html`<div class="stat"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`)}
        </div>
        ${player.about ? html`<p class="prose">${player.about}</p>` : ""}
      </section>
      <section class="panel">
        <h2 class="panel-title">Historial de partidos</h2>
        ${log.length === 0 ? emptyState("Sin apariciones registradas") : html`
        <table class="data-table compact">
          <thead><tr><th>Fecha</th><th>Partido</th><th class="num">Goles</th><th class="num">Asist.</th><th class="num">Tarjetas</th></tr></thead>
          <tbody>${log.map((g) => html`<tr>
            <td class="muted nowrap">${fmtDate(g.game_date, tz)}</td>
            <td>${g.home_name} ${g.score_home ?? "—"} : ${g.score_away ?? "—"} ${g.away_name}</td>
            <td class="num">${g.goals || ""}</td>
            <td class="num">${g.assists || ""}</td>
            <td class="num">${g.yellow ? html`<span class="card card-yellow" title="Tarjeta amarilla"></span>` : ""}${g.red ? html`<span class="card card-red" title="Tarjeta roja"></span>` : ""}</td>
          </tr>`)}</tbody>
        </table>`}
      </section>
    </div>
  </div>`;
  return page(scope, { title: player.full_name, body, banner, tabs, active: "league" });
}

/* -------------------------------------------------------------------- cup */

export function cupContext(db, slug) {
  const competition = get(db, "SELECT * FROM competition WHERE type = 'CUP' AND slug = ?", slug);
  if (!competition) return null;
  const season = get(db, "SELECT * FROM season WHERE id = ?", competition.season_id);
  return { competition, season, league: null };
}

function cupChrome(scope, ctx, active) {
  const base = `/${scope.lang}/tournament-menu/${ctx.competition.slug}`;
  return {
    base,
    banner: pageBanner({
      org: scope.org,
      chip: ctx.competition.is_archive ? "Datos archivados" : null,
      title: ctx.competition.cup_name || ctx.competition.name,
      aside: html`<label class="select-field"><span class="visually-hidden">Competición</span>
        <select onchange="if(this.value)location.href=this.value">
          <option value="${base}" selected>${ctx.competition.cup_name || ctx.competition.name}</option>
          ${repo.leagueCompetitions(scope.db).filter((c) => c.season_id === ctx.competition.season_id)
            .map((c) => html`<option value="/${scope.lang}/league-menu/${c.league_slug}/${c.season_slug}">${c.name}</option>`)}
        </select></label>`,
    }),
    tabs: tabsNav([
      { href: base, label: "Copa", active: active === "cup" },
      { href: `${base}/final-standings`, label: "Clasificación final", active: active === "final" },
      { href: `${base}/schedule`, label: "Calendario", active: active === "schedule" },
      { href: `${base}/players-list`, label: "Jugadores", active: active === "players" },
      { href: `${base}/regulations`, label: "Reglamento", active: active === "regulations" },
    ]),
  };
}

export function cupBracketView(scope, ctx) {
  const chrome = cupChrome(scope, ctx, "cup");
  const tz = scope.theme.timezone;
  const games = repo.competitionGames(scope.db, ctx.competition.id, { order: "ASC" });
  const groups = new Map();
  for (const g of games) {
    const phase = g.cup_phase || "FINAL";
    if (!groups.has(phase)) groups.set(phase, []);
    groups.get(phase).push(g);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    const ia = PHASE_ORDER.indexOf(a[0]); const ib = PHASE_ORDER.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const body = html`<div class="container">
    ${ordered.length === 0 ? emptyState("Aún no hay partidos de copa") : ""}
    ${ordered.map(([phase, list]) => html`
      <section class="cup-phase">
        <h2 class="cup-phase-title">${cupPhaseLabel(phase)} ${["FINAL", "THIRD_PLACE"].includes(phase) ? icons.trophy({ size: 16 }) : ""}</h2>
        <div class="cup-games">
          ${list.map((g) => html`
            <a class="cup-game" href="${chrome.base}/games/${g.id}">
              <div class="cup-team"><span>${crest(g.home_crest, g.home_name)} ${g.home_name}</span><strong>${g.score_home ?? "—"}</strong></div>
              <div class="cup-team"><span>${crest(g.away_crest, g.away_name)} ${g.away_name}</span><strong>${g.score_away ?? "—"}</strong></div>
              <div class="cup-meta">
                <span class="cup-pitch">${icons.pin({ size: 14 })} ${g.pitch_name || "—"}</span>
                <span class="cup-code">${g.code || g.round_name || ""}</span>
              </div>
              <div class="cup-date muted">${g.status === "FINISHED" ? fmtDateTime(g.game_date, tz) : fmtDateTime(g.game_date, tz)}${g.penalty_score_home !== null && g.penalty_score_away !== null ? ` · pen. ${g.penalty_score_home}-${g.penalty_score_away}` : ""}</div>
            </a>`)}
        </div>
      </section>`)}
  </div>`;
  return page(scope, { title: ctx.competition.cup_name || ctx.competition.name, body, banner: chrome.banner, tabs: chrome.tabs, active: "tournaments" });
}

export function cupFinalStandings(scope, ctx) {
  const chrome = cupChrome(scope, ctx, "final");
  const games = repo.competitionGames(scope.db, ctx.competition.id, { status: "FINISHED" });
  const placement = new Map();
  const teamName = new Map();
  const teamSlug = new Map();
  for (const g of games) {
    teamName.set(g.home_ct, g.home_name); teamName.set(g.away_ct, g.away_name);
    teamSlug.set(g.home_ct, g.home_slug); teamSlug.set(g.away_ct, g.away_slug);
  }
  const set = (ct, text) => { if (ct && !placement.has(ct)) placement.set(ct, text); };
  for (const g of games) {
    if (g.cup_phase === "FINAL" && g.score_home !== null && g.score_away !== null) {
      const homeWon = g.score_home > g.score_away ||
        (g.score_home === g.score_away && (g.penalty_score_home ?? 0) > (g.penalty_score_away ?? 0));
      set(homeWon ? g.home_ct : g.away_ct, "1");
      set(homeWon ? g.away_ct : g.home_ct, "2");
    }
    if (g.cup_phase === "THIRD_PLACE" && g.score_home !== null && g.score_away !== null) {
      const homeWon = g.score_home > g.score_away ||
        (g.score_home === g.score_away && (g.penalty_score_home ?? 0) > (g.penalty_score_away ?? 0));
      set(homeWon ? g.home_ct : g.away_ct, "3");
      set(homeWon ? g.away_ct : g.home_ct, "4");
    }
    if (g.cup_phase === "SEMI_FINAL" && g.score_home !== null && g.score_away !== null) {
      const homeWon = g.score_home > g.score_away;
      set(homeWon ? g.away_ct : g.home_ct, "3-4");
    }
    if (g.cup_phase === "QUARTER_FINAL" && g.score_home !== null && g.score_away !== null) {
      const homeWon = g.score_home > g.score_away;
      set(homeWon ? g.away_ct : g.home_ct, "5-8");
    }
  }
  const rank = (v) => (v.includes("-") ? Number(v.split("-")[0]) : Number(v));
  const rows = [...placement.entries()]
    .map(([ct, place]) => ({ place, name: teamName.get(ct) || "—", slug: teamSlug.get(ct) || "" }))
    .sort((a, b) => rank(a.place) - rank(b.place) || a.name.localeCompare(b.name));

  const body = html`<div class="container">
    <section class="panel">
      ${rows.length === 0 ? emptyState("Aún no hay clasificación final") : html`
      <table class="data-table">
        <thead><tr><th class="col-place">Puesto</th><th>Equipo</th></tr></thead>
        <tbody>${rows.map((r) => html`<tr><td class="place-badge">${r.place}</td><td><a class="team-cell" href="${chrome.base}/teams/${r.slug}">${r.name}</a></td></tr>`)}</tbody>
      </table>`}
    </section>
  </div>`;
  return page(scope, { title: `Clasificación final - ${ctx.competition.cup_name}`, body, banner: chrome.banner, tabs: chrome.tabs, active: "tournaments" });
}

export function cupSchedule(scope, ctx) {
  const chrome = cupChrome(scope, ctx, "schedule");
  const tz = scope.theme.timezone;
  const games = repo.competitionGames(scope.db, ctx.competition.id, { status: "NOT_STARTED", order: "ASC" });
  const body = html`<div class="container"><section class="panel">
    ${games.length === 0 ? emptyState("No hay partidos programados") : html`
    <table class="data-table games-table">
      <thead><tr><th>Fecha</th><th>Equipo 1</th><th class="center">Marcador</th><th>Equipo 2</th><th>Sede</th></tr></thead>
      <tbody>${games.map((g) => html`<tr>
        <td class="muted nowrap">${fmtDateTime(g.game_date, tz)}</td>
        <td>${g.home_name}</td><td class="center muted">vs</td><td>${g.away_name}</td><td class="muted">${g.pitch_name || "—"}</td>
      </tr>`)}</tbody>
    </table>`}
  </section></div>`;
  return page(scope, { title: `Calendario - ${ctx.competition.cup_name}`, body, banner: chrome.banner, tabs: chrome.tabs, active: "tournaments" });
}

export function cupPlayers(scope, ctx, { page: pageNo = 1 } = {}) {
  const chrome = cupChrome(scope, ctx, "players");
  const stats = computePlayerStats(scope.db, ctx.competition.id).sort((a, b) => b.goals_scored - a.goals_scored);
  const lastPage = Math.max(1, Math.ceil(stats.length / PER_PAGE_PLAYERS));
  const current = Math.min(Math.max(1, Number(pageNo) || 1), lastPage);
  const rows = stats.slice((current - 1) * PER_PAGE_PLAYERS, current * PER_PAGE_PLAYERS);
  const body = html`<div class="container">
    <section class="panel"><table class="data-table players-table">
      <thead><tr><th>Nombre</th><th>Equipo</th><th class="num">PJ</th><th class="num">Goles</th><th class="num">Asist.</th><th class="num">MVP</th><th class="num">Amar.</th><th class="num">Rojas</th></tr></thead>
      <tbody>${rows.map((p) => html`<tr>
        <td><a class="player-cell" href="${chrome.base}/teams/${p.team_slug}/players/${p.slug}">
          ${p.avatar_url ? html`<img class="avatar" src="${p.avatar_url}" alt="" />` : html`<span class="avatar avatar--empty">${(p.first_name?.[0] || "") + (p.last_name?.[0] || "")}</span>`}
          <span>${p.full_name}</span></a></td>
        <td class="muted">${p.team_name}</td><td class="num">${p.games_played}</td><td class="num strong">${p.goals_scored}</td>
        <td class="num">${p.assists}</td><td class="num">${p.mvp}</td><td class="num">${p.yellow_cards}</td><td class="num">${p.red_cards}</td>
      </tr>`)}</tbody>
    </table></section>
    ${pageNumbers({ page: current, lastPage, href: (p) => `${chrome.base}/players-list?page=${p}` })}
  </div>`;
  return page(scope, { title: `Jugadores - ${ctx.competition.cup_name}`, body, banner: chrome.banner, tabs: chrome.tabs, active: "tournaments" });
}

export function cupRegulations(scope, ctx) {
  const chrome = cupChrome(scope, ctx, "regulations");
  const content = ctx.competition.regulations || "";
  const body = html`<div class="container"><article class="panel prose">${content ? raw(sanitizeRich(content)) : emptyState("Sin reglamento publicado")}</article></div>`;
  return page(scope, { title: `Reglamento - ${ctx.competition.cup_name}`, body, banner: chrome.banner, tabs: chrome.tabs, active: "tournaments" });
}

export function cupTeamView(scope, ctx, teamSlug) {
  const team = repo.competitionTeamBySlug(scope.db, ctx.competition.id, teamSlug);
  if (!team) return null;
  const base = `/${scope.lang}/tournament-menu/${ctx.competition.slug}`;
  const games = repo.gamesForTeam(scope.db, ctx.competition.id, team.id, { limit: 30 });
  const stats = computePlayerStats(scope.db, ctx.competition.id).filter((p) => p.competition_team_id === team.competition_team_id).sort((a, b) => b.goals_scored - a.goals_scored);
  const banner = pageBanner({ org: scope.org, chip: ctx.competition.cup_name, title: html`<span class="banner-team">${crest(team.crest_url, team.name, "crest crest-lg")}<span>${team.name}</span></span>` });
  const tz = scope.theme.timezone;
  const body = html`<div class="container">
    <div class="two-col">
      <section class="panel"><h2 class="panel-title">Partidos de copa</h2>
        <table class="data-table compact"><tbody>${games.map((g) => {
          const home = g.home_ct === team.competition_team_id;
          return html`<tr><td class="muted nowrap">${fmtDate(g.game_date, tz)}</td>
            <td>${home ? g.away_name : g.home_name}</td>
            <td class="num">${home ? `${g.score_home ?? "—"} - ${g.score_away ?? "—"}` : `${g.score_away ?? "—"} - ${g.score_home ?? "—"}`}</td></tr>`;
        })}</tbody></table>
      </section>
      <section class="panel"><h2 class="panel-title">Jugadores</h2>
        <table class="data-table compact"><tbody>${stats.map((p) => html`<tr><td>${p.full_name}</td><td class="num">${p.goals_scored}</td></tr>`)}</tbody></table>
      </section>
    </div>
  </div>`;
  return page(scope, { title: team.name, body, banner, tabs: tabsNav([{ href: base, label: "Copa", active: true }]), active: "tournaments" });
}

/* --------------------------------------------------------------- game page */

export function matchView(scope, ctx, kind, gameId) {
  const game = repo.gameById(scope.db, Number(gameId));
  if (!game) return null;
  const base = kind === "league"
    ? `/${scope.lang}/league-menu/${ctx.league.slug}/${ctx.season.slug}`
    : `/${scope.lang}/tournament-menu/${ctx.competition.slug}`;
  const events = repo.gameEvents(scope.db, game.id);
  const tz = scope.theme.timezone;
  const goals = events.filter((e) => e.system_name === "goal" || e.system_name === "own_goal");
  const cards = events.filter((e) => e.system_name === "yellow_card" || e.system_name === "red_card");
  const title = kind === "league" ? ctx.competition.name : (ctx.competition.cup_name || ctx.competition.name);

  const banner = pageBanner({
    org: scope.org, chip: game.round_name ? `${title} · ${game.round_name}` : title,
    title: "Centro del partido",
    aside: html`<a class="btn btn-outline-light" href="${base}">Volver a la competición</a>`,
  });

  const body = html`<div class="container">
    <section class="scoreboard panel">
      <div class="scoreboard-team">
        <a href="${base}/teams/${game.home_slug}">${crest(game.home_crest, game.home_name, "crest crest-xl")}<span>${game.home_name}</span></a>
      </div>
      <div class="scoreboard-centre">
        <div class="scoreboard-score">${score(game)}</div>
        <div class="muted">${game.status === "FINISHED" ? "Finalizado" : game.status === "STARTED" ? "En directo" : "Programado"}</div>
        <div class="muted small">${fmtDateTime(game.game_date, tz)}</div>
        ${game.penalty_score_home !== null && game.penalty_score_away !== null ? html`<div class="muted small">Penaltis ${game.penalty_score_home} - ${game.penalty_score_away}</div>` : ""}
      </div>
      <div class="scoreboard-team">
        <a href="${base}/teams/${game.away_slug}">${crest(game.away_crest, game.away_name, "crest crest-xl")}<span>${game.away_name}</span></a>
      </div>
    </section>

    <div class="two-col">
      <section class="panel">
        <h2 class="panel-title">Goles</h2>
        ${goals.length === 0 ? emptyState("Sin goles registrados") : html`<ul class="timeline">
          ${goals.map((e) => html`<li><span class="timeline-minute">${e.time}′</span>
            <span class="timeline-body"><strong>${e.player_name || e.name}</strong>
            <span class="muted small">${e.team_name || ""}${e.system_name === "own_goal" || e.for_opposite_team ? " · gol en propia" : ""}</span></span></li>`)}
        </ul>`}
        <h2 class="panel-title">Tarjetas</h2>
        ${cards.length === 0 ? emptyState("Sin tarjetas registradas") : html`<ul class="timeline">
          ${cards.map((e) => html`<li><span class="timeline-minute">${e.time}′</span>
            <span class="timeline-body"><strong>${e.player_name || e.name}</strong>
            <span class="muted small">${e.team_name || ""} · ${e.system_name === "yellow_card" ? "Tarjeta amarilla" : "Tarjeta roja"}</span></span>
            <span class="card ${e.system_name === "yellow_card" ? "card-yellow" : "card-red"}"></span></li>`)}
        </ul>`}
      </section>
      <section class="panel">
        <h2 class="panel-title">Información del partido</h2>
        <table class="mini-table"><tbody>
          <tr><th>Jornada</th><td>${game.round_name || "—"}</td></tr>
          <tr><th>Sede</th><td>${game.pitch_name || "—"}${game.pitch_city ? `, ${game.pitch_city}` : ""}</td></tr>
          <tr><th>Fecha</th><td>${fmtDateTime(game.game_date, tz)}</td></tr>
          <tr><th>Estado</th><td>${game.status}</td></tr>
          <tr><th>Código</th><td>${game.code || "—"}</td></tr>
        </tbody></table>
      </section>
    </div>
  </div>`;
  return page(scope, { title: `${game.home_name} vs ${game.away_name}`, body, banner, active: kind === "league" ? "league" : "tournaments" });
}

/* ------------------------------------------------------------------ others */

export function calendarView(scope, { month } = {}) {
  const tz = scope.theme.timezone;
  const now = new Date();
  const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const start = new Date(`${ym}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const games = all(
    scope.db,
    `SELECT g.id, g.game_date, g.status, g.score_home, g.score_away,
            ht.name AS home_name, at.name AS away_name, r.competition_id, c.type AS comp_type, c.slug AS cup_slug, c.name AS comp_name,
            l.slug AS league_slug, s.slug AS season_slug
       FROM game g
       JOIN round r ON r.id = g.round_id
       JOIN competition c ON c.id = r.competition_id
       LEFT JOIN league l ON l.id = c.league_id
       LEFT JOIN season s ON s.id = c.season_id
       JOIN game_team ght ON ght.game_id = g.id AND ght.team_type = 'HOME'
       JOIN competition_team hct ON hct.id = ght.competition_team_id JOIN team ht ON ht.id = hct.team_id
       JOIN game_team gat ON gat.game_id = g.id AND gat.team_type = 'AWAY'
       JOIN competition_team act ON act.id = gat.competition_team_id JOIN team at ON at.id = act.team_id
      WHERE g.game_date >= ? AND g.game_date < ?
      ORDER BY g.game_date ASC`,
    start.toISOString(), end.toISOString()
  );
  const byDay = new Map();
  for (const g of games) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(g.game_date));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(g);
  }
  const monthLabel = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", month: "long", year: "numeric" }).format(start);
  const firstWeekday = (start.getUTCDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const prev = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const ymOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const body = html`<div class="container">
    <div class="calendar-head">
      <a class="btn btn-ghost" href="/${scope.lang}/calendar?month=${ymOf(prev)}">← ${new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", month: "long" }).format(prev)}</a>
      <h2>${monthLabel}</h2>
      <a class="btn btn-ghost" href="/${scope.lang}/calendar?month=${ymOf(next)}">${new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", month: "long" }).format(next)} →</a>
    </div>
    ${games.length === 0 ? emptyState("No hay partidos programados", "No hay competiciones en tu calendario. Vuelve más tarde para no perderte ningún partido.") : ""}
    <div class="calendar-grid">
      ${["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"].map((d) => html`<div class="calendar-dow">${d}</div>`)}
      ${cells.map((d) => {
        if (!d) return html`<div class="calendar-cell is-empty"></div>`;
        const key = `${ym}-${String(d).padStart(2, "0")}`;
        const list = byDay.get(key) || [];
        return html`<div class="calendar-cell${list.length ? " has-games" : ""}">
          <span class="calendar-day">${d}</span>
          ${list.map((g) => {
            const href = g.comp_type === "CUP" ? `/${scope.lang}/tournament-menu/${g.cup_slug}` : `/${scope.lang}/league-menu/${g.league_slug}/${g.season_slug}`;
            return html`<a class="calendar-game" href="${href}"><span class="calendar-time">${fmtTime(g.game_date, tz)}</span><span class="calendar-teams">${g.home_name} – ${g.away_name}</span></a>`;
          })}
        </div>`;
      })}
    </div>
  </div>`;
  return page(scope, {
    title: `Calendario - ${monthLabel}`, body, active: "calendar",
    banner: pageBanner({ org: scope.org, title: "Calendario", subtitle: "Todos los partidos programados por esta organización" }),
  });
}

export function contactView(scope, { sent = false, error = "" } = {}) {
  const fields = all(scope.db, "SELECT * FROM contact_field ORDER BY id");
  const socials = (() => { try { return JSON.parse(scope.org.socials_json || "{}"); } catch { return {}; } })();
  const body = html`<div class="container">
    <div class="two-col">
      <section class="panel">
        <h2 class="panel-title">Contacta con nosotros</h2>
        ${sent ? html`<div class="alert alert-success">Tu mensaje se ha enviado al organizador.</div>` : ""}
        ${error ? html`<div class="alert alert-error">${error}</div>` : ""}
        <form method="post" action="/${scope.lang}/contact" class="form">
          <label>Nombre<input type="text" name="name" required /></label>
          <label>Email<input type="email" name="email" required /></label>
          <label>Asunto<input type="text" name="subject" /></label>
          <label>Mensaje<textarea name="message" rows="5" required></textarea></label>
          <button class="btn btn-primary" type="submit">Enviar mensaje</button>
        </form>
      </section>
      <section class="panel">
        <h2 class="panel-title">Organizador</h2>
        ${fields.map((f) => html`<p class="contact-line"><strong>${f.name}</strong><br /><a href="mailto:${f.value}">${f.value}</a></p>`)}
        ${scope.org.contact_email ? html`<p class="contact-line"><a href="mailto:${scope.org.contact_email}">${scope.org.contact_email}</a></p>` : ""}
        <h3 class="panel-subtitle">Redes sociales</h3>
        <ul class="plain-list">
          ${Object.entries(socials).filter(([, v]) => v).map(([k, v]) => html`<li><a href="${v}" target="_blank" rel="noopener">${k[0].toUpperCase() + k.slice(1)}</a></li>`)}
        </ul>
      </section>
    </div>
  </div>`;
  return page(scope, { title: "Contacto", body, active: "contact", banner: pageBanner({ org: scope.org, title: "Contacto" }) });
}

export function galleryView(scope) {
  const images = repo.galleryImages(scope.db);
  const body = html`<div class="container">
    ${images.length === 0 ? emptyState("Sin fotos publicadas") : html`<div class="gallery-grid">
      ${images.map((url) => html`<a class="gallery-item" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="" loading="lazy" /></a>`)}
    </div>`}
  </div>`;
  return page(scope, { title: "Galería", body, active: "gallery", banner: pageBanner({ org: scope.org, title: "Galería" }) });
}

export function archiveView(scope) {
  const seasons = repo.seasons(scope.db);
  const body = html`<div class="container"><section class="panel">
    <table class="data-table"><thead><tr><th>Nombre</th><th>Fecha de inicio</th></tr></thead>
      <tbody>${seasons.map((s) => html`<tr>
        <td><a href="/${scope.lang}/league-menu/seasons-archive/${s.slug}">${s.name}</a></td>
        <td class="muted">${s.start_date}</td></tr>`)}</tbody>
    </table>
  </section></div>`;
  return page(scope, { title: "Archivo de temporadas", body, active: "archive", banner: pageBanner({ org: scope.org, title: "Archivo de temporadas" }) });
}

export function seasonArchiveView(scope, slug) {
  const season = get(scope.db, "SELECT * FROM season WHERE slug = ?", slug);
  if (!season) return null;
  const comps = repo.competitionsForSeason(scope.db, season.id);
  const body = html`<div class="container">
    <section class="panel">
      <h2 class="panel-title">${season.name}</h2>
      <p class="muted">${season.start_date} – ${season.end_date}</p>
      <div class="card-list">
        ${comps.map((c) => {
          const href = c.type === "CUP"
            ? `/${scope.lang}/tournament-menu/${c.slug}`
            : `/${scope.lang}/league-menu/${c.league_slug}/${season.slug}`;
          return html`<a class="card-link" href="${href}">
            <span class="card-link-title">${c.name}</span>
            <span class="muted">${c.type === "CUP" ? "Copa" : "Liga"}${c.is_archive ? " · archivada" : ""}</span>
            ${icons.arrow({ size: 18 })}
          </a>`;
        })}
        ${comps.length === 0 ? emptyState("Sin competiciones en esta temporada") : ""}
      </div>
    </section>
  </div>`;
  return page(scope, { title: season.name, body, active: "archive", banner: pageBanner({ org: scope.org, chip: "Archivo de temporadas", title: season.name }) });
}

export function newsView(scope) {
  const posts = repo.posts(scope.db);
  const body = html`<div class="container">
    ${posts.length === 0 ? emptyState("Aún no hay noticias") : html`<div class="card-list">
      ${posts.map((p) => html`<a class="card-link" href="/${scope.lang}/news/${p.slug}">
        <span class="card-link-title">${p.title}</span>
        <span class="muted">${fmtDate(p.created_at, scope.theme.timezone)}</span>
        ${icons.arrow({ size: 18 })}
      </a>`)}
    </div>`}
  </div>`;
  return page(scope, { title: "Noticias", body, active: "news", banner: pageBanner({ org: scope.org, title: "Noticias" }) });
}

export function postView(scope, slug) {
  const post = repo.postBySlug(scope.db, slug);
  if (!post) return null;
  const body = html`<div class="container"><article class="panel prose">
    <h1>${post.title}</h1>
    <p class="muted">${fmtDate(post.created_at, scope.theme.timezone)}</p>
    ${post.image_url ? html`<img src="${post.image_url}" alt="" style="max-width:100%;border-radius:8px" />` : ""}
    ${raw(sanitizeRich(post.content))}
  </article></div>`;
  return page(scope, { title: post.title, body, active: "news", banner: pageBanner({ org: scope.org, title: post.title }) });
}

export function tournamentsView(scope) {
  const comps = repo.leagueCompetitions(scope.db).concat(repo.cupCompetitions(scope.db));
  const body = html`<div class="container"><div class="card-list">
    ${comps.map((c) => html`<a class="card-link" href="${c.type === "CUP"
      ? `/${scope.lang}/tournament-menu/${c.slug}`
      : `/${scope.lang}/league-menu/${c.league_slug}/${c.season_slug}`}">
      <span class="card-link-title">${c.type === "CUP" ? (c.cup_name || c.name) : c.name}</span>
      <span class="muted">${c.season_name || ""} · ${c.type === "CUP" ? "Copa" : "Liga"}</span>
      ${icons.arrow({ size: 18 })}
    </a>`)}
  </div></div>`;
  return page(scope, { title: "Torneos", body, active: "tournaments", banner: pageBanner({ org: scope.org, title: "Torneos" }) });
}

/* -------------------------------------------------------------------- home */

export function homeView(scope) {
  const tz = scope.theme.timezone;
  const league = repo.leagueCompetitions(scope.db)[0];
  const season = league ? get(scope.db, "SELECT * FROM season WHERE id = ?", league.season_id) : null;
  const leagueBase = league ? `/${scope.lang}/league-menu/${league.league_slug}/${league.season_slug}` : null;
  const cup = repo.cupCompetitions(scope.db)[0];
  const latest = league ? repo.competitionGames(scope.db, league.id, { status: "FINISHED", order: "DESC", limit: 6 }) : [];
  const upcoming = league ? repo.competitionGames(scope.db, league.id, { status: "NOT_STARTED", order: "ASC", limit: 4 }) : [];
  const standings = league ? computeStandings(scope.db, league.id).slice(0, 5) : [];
  const sponsors = repo.sponsors(scope.db);
  const posts = repo.posts(scope.db).slice(0, 3);
  const gallery = repo.galleryImages(scope.db).slice(0, 6);

  const banner = html`<section class="home-hero">
    <div class="home-hero-inner">
      <div>
        <span class="banner-chip">${season ? season.name : "Liga"}</span>
        <h1>${scope.org.name}</h1>
        <p class="hero-sub">Resultados, clasificación, calendario y estadísticas de jugadores: todo sobre la liga en un solo lugar.</p>
        <div class="hero-actions">
          ${leagueBase ? html`<a class="btn btn-light" href="${leagueBase}">Ver clasificación ${icons.arrow({ size: 16 })}</a>` : ""}
          ${cup ? html`<a class="btn btn-outline-light" href="/${scope.lang}/tournament-menu/${cup.slug}">Ver la copa</a>` : ""}
        </div>
      </div>
    </div>
  </section>`;

  const body = html`<div class="container">
    <div class="home-grid">
      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Últimos resultados</h2>${leagueBase ? html`<a class="link-more" href="${leagueBase}/results">Todos los resultados ${icons.arrow({ size: 14 })}</a>` : ""}</div>
        <div class="result-list">
          ${latest.map((g) => html`<a class="result-row" href="${leagueBase}/games/${g.id}">
            <span class="result-date muted nowrap">${fmtDate(g.game_date, tz)}</span>
            <span class="result-team team-cell-end"><span>${g.home_name}</span>${crest(g.home_crest, g.home_name)}</span>
            <span class="result-score">${score(g)}</span>
            <span class="result-team team-cell">${crest(g.away_crest, g.away_name)}<span>${g.away_name}</span></span>
          </a>`)}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Clasificación</h2>${leagueBase ? html`<a class="link-more" href="${leagueBase}">Tabla completa ${icons.arrow({ size: 14 })}</a>` : ""}</div>
        <table class="data-table compact standings-mini">
          <thead><tr><th class="col-place">#</th><th>Equipo</th><th class="num">PJ</th><th class="num">DG</th><th class="num">Pts</th></tr></thead>
          <tbody>${standings.map((r) => html`<tr class="${r.place <= 3 ? "is-podium" : ""}">
            <td class="col-place"><span class="place-badge"><span>${r.place}</span></span></td>
            <td><a class="team-cell" href="${leagueBase}/teams/${r.team_slug}">${crest(r.crest_url, r.team_name)}<span>${r.team_name}</span></a></td>
            <td class="num">${r.games_played}</td><td class="num">${r.goals_diff}</td><td class="num strong primary">${r.points}</td>
          </tr>`)}</tbody>
        </table>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><h2 class="panel-title">Próximos partidos</h2>${leagueBase ? html`<a class="link-more" href="${leagueBase}/schedule">Calendario completo ${icons.arrow({ size: 14 })}</a>` : ""}</div>
      ${upcoming.length === 0 ? emptyState("No hay próximos partidos") : html`<div class="upcoming-row">
        ${upcoming.map((g) => html`<div class="upcoming-card">
          <span class="upcoming-date">${fmtDateTime(g.game_date, tz)}</span>
          <span class="upcoming-teams">${g.home_name} <em>vs</em> ${g.away_name}</span>
          <span class="muted small">${g.pitch_name || ""}</span>
        </div>`)}
      </div>`}
    </section>

    ${sponsors.length ? html`<section class="sponsors">
      <h2 class="sponsors-title">Socio tecnológico</h2>
      <p class="sponsors-sub">¡Juntos jugamos hacia el mismo objetivo!</p>
      <div class="sponsor-strip">${sponsors.map((s) => html`<a class="sponsor" href="${s.url || "#"}" target="_blank" rel="noopener"><img src="${s.image_url}" alt="${s.name}" loading="lazy" /></a>`)}</div>
    </section>` : ""}

    ${gallery.length ? html`<section class="panel">
      <div class="panel-head"><h2 class="panel-title">Galería</h2><a class="link-more" href="/${scope.lang}/gallery">Ver todas las fotos ${icons.arrow({ size: 14 })}</a></div>
      <div class="gallery-grid">${gallery.map((u) => html`<a class="gallery-item" href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="" loading="lazy" /></a>`)}</div>
    </section>` : ""}

    ${posts.length ? html`<section class="panel">
      <div class="panel-head"><h2 class="panel-title">Últimas noticias</h2><a class="link-more" href="/${scope.lang}/news">Todas las noticias ${icons.arrow({ size: 14 })}</a></div>
      <div class="card-list">${posts.map((p) => html`<a class="card-link" href="/${scope.lang}/news/${p.slug}">
        <span class="card-link-title">${p.title}</span><span class="muted">${fmtDate(p.created_at, tz)}</span>${icons.arrow({ size: 18 })}</a>`)}</div>
    </section>` : ""}
  </div>`;

  return page(scope, { title: "", description: `${scope.org.name} — resultados, clasificación, calendario y estadísticas de jugadores.`, body, banner, active: "home" });
}

export function notFoundView(scope) {
  const body = html`<div class="container"><div class="empty-state">
    <p class="empty-title">Página no encontrada</p>
    <p class="empty-hint">La página que buscas no existe.</p>
    <a class="btn btn-primary" href="/${scope.lang}">Volver al inicio</a>
  </div></div>`;
  return page(scope, { title: "No encontrada", body });
}
