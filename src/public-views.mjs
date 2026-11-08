// Public league-site views for the unified "grupos + playoff" competition.
import { all, get } from "./db.mjs";
import { html, raw, layout, crest, formBadges, pagination, pageNumbers, icons, pageBanner, tabsNav, emptyState } from "./render.mjs";
import {
  computeStandings, computePlayerStats, fmtDate, fmtTime, fmtDateTime, statusLabel,
} from "./domain.mjs";
import * as repo from "./repo.mjs";

const PER_PAGE_RESULTS = 15;
const PER_PAGE_PLAYERS = 10;
const KIND_LABEL = { LIGA: "Liga", TORNEO: "Torneo", COPA: "Copa" };
const kindLabel = (kind) => KIND_LABEL[kind] || kind || "";

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

/* ---------------------------------------------------------------- sponsors */

function sponsorStrip(scope) {
  const sponsors = repo.activeSponsors(scope.db);
  if (sponsors.length === 0) return "";
  return html`
    <section class="panel sponsor-panel">
      <h2 class="panel-title">Nuestros patrocinadores</h2>
      <div class="sponsor-grid">
        ${sponsors.map((s) => html`<a href="${s.link_url || "#"}" target="_blank" rel="noopener" class="sponsor-item">
          ${s.logo_url ? html`<img src="${s.logo_url}" alt="${s.name}" loading="lazy" />` : html`<span>${s.name}</span>`}
        </a>`)}
      </div>
    </section>`;
}

/* --------------------------------------------------------- competition ctx */

export function competitionContext(db, slug) {
  const competition = get(db, "SELECT * FROM competition WHERE slug = ?", slug);
  if (!competition) return null;
  const season = competition.season_id ? get(db, "SELECT * FROM season WHERE id = ?", competition.season_id) : null;
  return { competition, season };
}

function competitionSelect(scope, current) {
  const comps = repo.competitions(scope.db);
  if (comps.length < 2) return null;
  return html`<label class="select-field">
    <span class="visually-hidden">Competición</span>
    <select onchange="if(this.value)location.href=this.value">
      ${comps.map((c) => html`<option value="/${scope.lang}/competition/${c.slug}"${c.id === current.id ? " selected" : ""}>${c.name}</option>`)}
    </select>
  </label>`;
}

function competitionChrome(scope, ctx, active) {
  const base = `/${scope.lang}/competition/${ctx.competition.slug}`;
  return {
    base,
    banner: pageBanner({
      org: scope.org,
      chip: [kindLabel(ctx.competition.kind), ctx.competition.is_archive ? "Datos archivados" : ""].filter(Boolean).join(" · "),
      title: ctx.competition.name,
      aside: competitionSelect(scope, ctx.competition),
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
  const sponsors = repo.activeSponsors(scope.db);
  return layout({ org: scope.org, theme: scope.theme, lang: scope.lang, active: parts.active || "", sponsors, ...parts }).toString();
}

/* ------------------------------------------------------------------ tables */

function standingsTable(scope, ctx, base, rows) {
  return html`
    <table class="data-table standings-table">
      <thead>
        <tr>
          <th class="col-place">#</th>
          <th class="col-team">Equipos</th>
          <th class="num">Pts</th><th class="num">PJ</th><th class="num">PG</th><th class="num">PE</th>
          <th class="num">PP</th><th class="num">GF</th><th class="num">GC</th><th class="num">DG</th>
          <th class="col-form">Racha</th>
        </tr>
      </thead>
      <tbody>
        ${rows.length === 0 ? html`<tr><td colspan="11" class="muted">Sin equipos en esta tabla.</td></tr>` : ""}
        ${rows.map((r) => html`
          <tr class="${r.place <= 3 ? "is-podium" : ""}">
            <td class="col-place">
              <span class="place-badge">${r.place <= 3 ? (r.place === 1 ? icons.trophy({ size: 16 }) : icons.bars({ size: 16 })) : ""}<span>${r.place}</span></span>
            </td>
            <td class="col-team">
              <a class="team-cell" href="${base}/teams/${r.team_slug}">
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
    </table>`;
}

function playoffSection(scope, ctx, base) {
  const tz = scope.theme.timezone;
  const games = repo.competitionGames(scope.db, ctx.competition.id, { stage: "PLAYOFF", order: "ASC" });
  if (games.length === 0) return "";
  const byRound = new Map();
  for (const g of games) {
    const key = g.round_id;
    if (!byRound.has(key)) byRound.set(key, { name: g.round_name || "Eliminatoria", games: [] });
    byRound.get(key).games.push(g);
  }
  return html`
    <h2 class="section-title">Playoff</h2>
    <div class="cup-phases">
      ${[...byRound.values()].map((round) => html`
        <section class="cup-phase">
          <h3 class="cup-phase-title">${round.name}</h3>
          <div class="cup-games">
            ${round.games.map((g) => html`
              <a class="cup-game" href="${base}/games/${g.id}">
                <div class="cup-team"><span>${crest(g.home_crest, g.home_name)} ${g.home_name}</span><strong>${g.score_home ?? "—"}</strong></div>
                <div class="cup-team"><span>${crest(g.away_crest, g.away_name)} ${g.away_name}</span><strong>${g.score_away ?? "—"}</strong></div>
                <div class="cup-meta">
                  <span class="cup-pitch">${icons.pin({ size: 14 })} ${g.pitch_name || "—"}</span>
                  <span class="cup-code">${g.code || ""}</span>
                </div>
                <div class="cup-date muted">${fmtDateTime(g.game_date, tz)}${g.penalty_score_home !== null && g.penalty_score_away !== null ? ` · pen. ${g.penalty_score_home}-${g.penalty_score_away}` : ""}</div>
              </a>`)}
          </div>
        </section>`)}
    </div>`;
}

export function competitionView(scope, ctx) {
  const chrome = competitionChrome(scope, ctx, "tables");
  const groups = repo.groupsForCompetition(scope.db, ctx.competition.id);
  const comp = ctx.competition;

  const groupTables = groups.length
    ? groups.map((gr) => html`
      <h2 class="section-title">${gr.name}</h2>
      <section class="panel">${standingsTable(scope, ctx, chrome.base, computeStandings(scope.db, comp.id, { groupId: gr.id }))}</section>`)
    : html`<section class="panel">${standingsTable(scope, ctx, chrome.base, computeStandings(scope.db, comp.id))}</section>`;

  const body = html`
  <div class="container">
    <h2 class="section-title">Fase de grupos</h2>
    ${groupTables}
    ${playoffSection(scope, ctx, chrome.base)}
    <p class="table-note">La clasificación se calcula con los partidos de grupo finalizados, con ${comp.points_win}/${comp.points_draw}/${comp.points_lose} puntos por victoria/empate/derrota.</p>
  </div>`;

  return page(scope, {
    title: `Clasificación - ${comp.name}`, description: `Clasificación de ${comp.name}`,
    body, banner: chrome.banner, tabs: chrome.tabs, active: "competitions",
  });
}

/* ---------------------------------------------------------------- schedule */

export function scheduleView(scope, ctx) {
  const chrome = competitionChrome(scope, ctx, "schedule");
  const tz = scope.theme.timezone;
  const games = repo.competitionGames(scope.db, ctx.competition.id, { status: "NOT_STARTED", order: "ASC" });
  const byRound = new Map();
  for (const g of games) {
    const key = g.round_id;
    if (!byRound.has(key)) byRound.set(key, { name: g.round_name || (g.stage === "PLAYOFF" ? "Playoff" : "Jornada"), games: [] });
    byRound.get(key).games.push(g);
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
                  <td class="center score-cell"><a href="${chrome.base}/games/${g.id}">vs</a></td>
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
    banner: chrome.banner, tabs: chrome.tabs, active: "competitions",
  });
}

/* ----------------------------------------------------------------- results */

export function resultsView(scope, ctx, { page: pageNo = 1 } = {}) {
  const chrome = competitionChrome(scope, ctx, "results");
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
    banner: chrome.banner, tabs: chrome.tabs, active: "competitions",
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
  const chrome = competitionChrome(scope, ctx, "players");
  const base = `${chrome.base}/players-list`;
  let stats = computePlayerStats(scope.db, ctx.competition.id);
  if (team) stats = stats.filter((p) => p.team_slug === team);
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
    banner: chrome.banner, tabs: chrome.tabs, active: "competitions",
  });
}

/* ------------------------------------------------------------- regulations */

export function regulationsView(scope, ctx) {
  const chrome = competitionChrome(scope, ctx, "regulations");
  const content = ctx.competition.regulations || (ctx.season && ctx.season.regulations) || "";
  const body = html`<div class="container">
    <article class="panel prose">${content ? raw(sanitizeRich(content)) : emptyState("Sin reglamento publicado")}</article>
  </div>`;
  return page(scope, { title: `Reglamento - ${ctx.competition.name}`, body, banner: chrome.banner, tabs: chrome.tabs, active: "competitions" });
}

/* -------------------------------------------------------------------- team */

export function teamView(scope, ctx, teamSlug, section = "about") {
  const team = repo.competitionTeamBySlug(scope.db, ctx.competition.id, teamSlug);
  if (!team) return null;
  const base = `/${scope.lang}/competition/${ctx.competition.slug}`;
  const teamBase = `${base}/teams/${team.slug}`;
  const tz = scope.theme.timezone;
  const standings = team.group_id
    ? computeStandings(scope.db, ctx.competition.id, { groupId: team.group_id })
    : computeStandings(scope.db, ctx.competition.id);
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
    aside: competitionSelect(scope, ctx.competition),
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
          <h2 class="panel-title">Resultados en la competición</h2>
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
  return page(scope, { title: `${team.name} - ${ctx.competition.name}`, body, banner, tabs, active: "competitions" });
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
  const base = `/${scope.lang}/competition/${ctx.competition.slug}`;
  const log = repo.playerSeasonGameLog(scope.db, ctx.competition.id, player.id);
  const tz = scope.theme.timezone;

  const banner = pageBanner({
    org: scope.org,
    chip: team.name,
    title: player.full_name,
    aside: competitionSelect(scope, ctx.competition),
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
  return page(scope, { title: player.full_name, body, banner, tabs, active: "competitions" });
}

/* --------------------------------------------------------------- game page */

export function matchView(scope, ctx, gameId) {
  const game = repo.gameById(scope.db, Number(gameId));
  if (!game) return null;
  const base = `/${scope.lang}/competition/${ctx.competition.slug}`;
  const events = repo.gameEvents(scope.db, game.id);
  const tz = scope.theme.timezone;
  const goals = events.filter((e) => e.system_name === "goal" || e.system_name === "own_goal");
  const cards = events.filter((e) => e.system_name === "yellow_card" || e.system_name === "red_card");
  const title = ctx.competition.name;

  const banner = pageBanner({
    org: scope.org, chip: game.round_name ? `${title} · ${game.round_name}` : title,
    title: "Centro del partido",
    aside: html`<a class="btn btn-outline-light" href="${base}">Volver a la competición</a>`,
  });

  const isLive = game.status === "STARTED" || game.status === "BREAK";

  const body = html`<div class="container" data-live-game="${game.id}">
    <section class="scoreboard panel ${isLive ? "is-live" : ""}">
      <div class="scoreboard-team">
        <a href="${base}/teams/${game.home_slug}">${crest(game.home_crest, game.home_name, "crest crest-xl")}<span>${game.home_name}</span></a>
      </div>
      <div class="scoreboard-centre">
        <div class="scoreboard-score" data-live="score">${score(game)}</div>
        <div class="scoreboard-status">
          <span class="live-badge" data-live="badge"${isLive ? "" : " hidden"}><span class="live-dot" aria-hidden="true"></span>En directo</span>
          <span class="muted" data-live="status">${statusLabel(game.status)}</span>
        </div>
        <div class="muted small">${fmtDateTime(game.game_date, tz)}</div>
        <div class="muted small" data-live="penalties">${game.penalty_score_home !== null && game.penalty_score_away !== null ? `Penaltis ${game.penalty_score_home} - ${game.penalty_score_away}` : ""}</div>
      </div>
      <div class="scoreboard-team">
        <a href="${base}/teams/${game.away_slug}">${crest(game.away_crest, game.away_name, "crest crest-xl")}<span>${game.away_name}</span></a>
      </div>
    </section>

    <div class="two-col">
      <section class="panel">
        <h2 class="panel-title">Goles</h2>
        <div data-live="goals">
          ${goals.length === 0 ? emptyState("Sin goles registrados") : html`<ul class="timeline">
            ${goals.map((e) => html`<li><span class="timeline-minute">${e.time}′</span>
              <span class="timeline-body"><strong>${e.player_name || e.name}</strong>
              <span class="muted small">${e.team_name || ""}${e.system_name === "own_goal" || e.for_opposite_team ? " · gol en propia" : ""}</span></span></li>`)}
          </ul>`}
        </div>
        <h2 class="panel-title">Tarjetas</h2>
        <div data-live="cards">
          ${cards.length === 0 ? emptyState("Sin tarjetas registradas") : html`<ul class="timeline">
            ${cards.map((e) => html`<li><span class="timeline-minute">${e.time}′</span>
              <span class="timeline-body"><strong>${e.player_name || e.name}</strong>
              <span class="muted small">${e.team_name || ""} · ${e.system_name === "yellow_card" ? "Tarjeta amarilla" : "Tarjeta roja"}</span></span>
              <span class="card ${e.system_name === "yellow_card" ? "card-yellow" : "card-red"}"></span></li>`)}
          </ul>`}
        </div>
      </section>
      <section class="panel">
        <h2 class="panel-title">Información del partido</h2>
        <table class="mini-table"><tbody>
          <tr><th>Jornada</th><td>${game.round_name || "—"}</td></tr>
          <tr><th>Fase</th><td>${game.stage === "PLAYOFF" ? "Playoff" : "Grupos"}</td></tr>
          <tr><th>Sede</th><td>${game.pitch_name || "—"}${game.pitch_city ? `, ${game.pitch_city}` : ""}</td></tr>
          <tr><th>Fecha</th><td>${fmtDateTime(game.game_date, tz)}</td></tr>
          <tr><th>Estado</th><td>${statusLabel(game.status)}</td></tr>
          <tr><th>Código</th><td>${game.code || "—"}</td></tr>
        </tbody></table>
      </section>
    </div>
  </div>`;
  return page(scope, {
    title: `${game.home_name} vs ${game.away_name}`, body, banner,
    active: "competitions", scripts: ["/live.js"],
  });
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
            ht.name AS home_name, at.name AS away_name, c.slug AS competition_slug, c.name AS comp_name
       FROM game g
       JOIN round r ON r.id = g.round_id
       JOIN competition c ON c.id = r.competition_id
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
          ${list.map((g) => html`<a class="calendar-game" href="/${scope.lang}/competition/${g.competition_slug}"><span class="calendar-time">${fmtTime(g.game_date, tz)}</span><span class="calendar-teams">${g.home_name} – ${g.away_name}</span></a>`)}
        </div>`;
      })}
    </div>
  </div>`;
  return page(scope, {
    title: `Calendario - ${monthLabel}`, body, active: "calendar",
    banner: pageBanner({ org: scope.org, title: "Calendario", subtitle: "Todos los partidos programados por esta organización" }),
  });
}

export function archiveView(scope) {
  const seasons = repo.seasons(scope.db);
  const body = html`<div class="container"><section class="panel">
    <table class="data-table"><thead><tr><th>Nombre</th><th>Fecha de inicio</th></tr></thead>
      <tbody>${seasons.map((s) => html`<tr>
        <td><a href="/${scope.lang}/archive/${s.slug}">${s.name}</a></td>
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
      <p class="muted">${season.start_date || ""} – ${season.end_date || ""}</p>
      <div class="card-list">
        ${comps.map((c) => html`<a class="card-link" href="/${scope.lang}/competition/${c.slug}">
          <span class="card-link-title">${c.name}</span>
          <span class="muted">${c.is_archive ? "Archivada" : ""}</span>
          ${icons.arrow({ size: 18 })}
        </a>`)}
        ${comps.length === 0 ? emptyState("Sin competiciones en esta temporada") : ""}
      </div>
    </section>
  </div>`;
  return page(scope, { title: season.name, body, active: "archive", banner: pageBanner({ org: scope.org, chip: "Archivo de temporadas", title: season.name }) });
}

export function competitionsView(scope) {
  const comps = repo.competitions(scope.db);
  const body = html`<div class="container">
    ${comps.length === 0 ? emptyState("Aún no hay competiciones") : ""}
    <div class="card-list">
      ${comps.map((c) => html`<a class="card-link" href="/${scope.lang}/competition/${c.slug}">
        <span class="card-link-title">${c.name}</span>
        <span class="muted">${kindLabel(c.kind)} · ${c.season_name || ""} · ${c.teams} equipos</span>
        ${icons.arrow({ size: 18 })}
      </a>`)}
    </div>
  </div>`;
  return page(scope, { title: "Competiciones", body, active: "competitions", banner: pageBanner({ org: scope.org, title: "Competiciones" }) });
}

/* -------------------------------------------------------------------- home */

export function homeView(scope) {
  const tz = scope.theme.timezone;
  const comp = repo.competitions(scope.db)[0];
  const base = comp ? `/${scope.lang}/competition/${comp.slug}` : null;
  const latest = comp ? repo.competitionGames(scope.db, comp.id, { status: "FINISHED", order: "DESC", limit: 6 }) : [];
  const upcoming = comp ? repo.competitionGames(scope.db, comp.id, { status: "NOT_STARTED", order: "ASC", limit: 4 }) : [];
  const standings = comp ? computeStandings(scope.db, comp.id).slice(0, 5) : [];

  const live = comp ? repo.liveGames(scope.db, comp.id) : [];
  const heroMatch = live[0] || null;
  const heroNext = heroMatch ? [] : upcoming.slice(0, 2);

  const heroSide = heroMatch
    ? html`<div class="hero-match" data-live-game="${heroMatch.id}">
      <span class="hero-match-tag hero-match-tag--live" data-live="badge"><span class="live-dot" aria-hidden="true"></span>En vivo</span>
      <div class="hero-match-teams">
        <div class="hero-match-team">${crest(heroMatch.home_crest, heroMatch.home_name, "crest crest-lg")}<span>${heroMatch.home_name}</span></div>
        <div class="hero-match-score" data-live="score">${score(heroMatch)}</div>
        <div class="hero-match-team">${crest(heroMatch.away_crest, heroMatch.away_name, "crest crest-lg")}<span>${heroMatch.away_name}</span></div>
      </div>
      <span class="hero-match-meta"><span data-live="status">${statusLabel(heroMatch.status)}</span>${heroMatch.pitch_name ? ` · ${heroMatch.pitch_name}` : ""}</span>
      ${base ? html`<a class="btn btn-light btn-block" href="${base}/games/${heroMatch.id}">Seguir el partido ${icons.arrow({ size: 16 })}</a>` : ""}
    </div>`
    : heroNext.length
      ? html`<div class="hero-match">
        <span class="hero-match-tag">Próximos partidos</span>
        <div class="hero-match-next">
          ${heroNext.map((g) => html`<a class="hero-next-row" href="${base}/games/${g.id}">
            <span class="hero-next-date">${fmtDateTime(g.game_date, tz)}</span>
            <span class="hero-next-teams">${g.home_name} <em>vs</em> ${g.away_name}</span>
            <span class="hero-next-pitch">${g.pitch_name || ""}</span>
          </a>`)}
        </div>
        ${base ? html`<a class="btn btn-outline-light btn-block" href="${base}/schedule">Ver calendario ${icons.arrow({ size: 16 })}</a>` : ""}
      </div>`
      : "";

  const banner = html`<section class="home-hero">
    <div class="home-hero-inner${heroSide ? " has-side" : ""}">
      <div class="home-hero-copy">
        <span class="banner-chip">${comp ? comp.name : "Competiciones"}</span>
        <h1>${scope.org.name}</h1>
        <p class="hero-sub">Resultados, clasificación, calendario y estadísticas de jugadores: todo sobre la competición en un solo lugar.</p>
        <div class="hero-actions">
          ${base ? html`<a class="btn btn-light" href="${base}">Ver clasificación ${icons.arrow({ size: 16 })}</a>` : ""}
        </div>
      </div>
      ${heroSide}
    </div>
  </section>`;

  const body = html`<div class="container">
    <div class="home-grid">
      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Últimos resultados</h2>${base ? html`<a class="link-more" href="${base}/results">Todos los resultados ${icons.arrow({ size: 14 })}</a>` : ""}</div>
        <div class="result-list">
          ${latest.map((g) => html`<a class="result-row" href="${base}/games/${g.id}">
            <span class="result-date muted nowrap">${fmtDate(g.game_date, tz)}</span>
            <span class="result-team team-cell-end"><span>${g.home_name}</span>${crest(g.home_crest, g.home_name)}</span>
            <span class="result-score">${score(g)}</span>
            <span class="result-team team-cell">${crest(g.away_crest, g.away_name)}<span>${g.away_name}</span></span>
          </a>`)}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Clasificación</h2>${base ? html`<a class="link-more" href="${base}">Tabla completa ${icons.arrow({ size: 14 })}</a>` : ""}</div>
        <table class="data-table compact standings-mini">
          <thead><tr><th class="col-place">#</th><th>Equipo</th><th class="num">PJ</th><th class="num">DG</th><th class="num">Pts</th></tr></thead>
          <tbody>${standings.map((r) => html`<tr class="${r.place <= 3 ? "is-podium" : ""}">
            <td class="col-place"><span class="place-badge"><span>${r.place}</span></span></td>
            <td><a class="team-cell" href="${base}/teams/${r.team_slug}">${crest(r.crest_url, r.team_name)}<span>${r.team_name}</span></a></td>
            <td class="num">${r.games_played}</td><td class="num">${r.goals_diff}</td><td class="num strong primary">${r.points}</td>
          </tr>`)}</tbody>
        </table>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><h2 class="panel-title">Próximos partidos</h2>${base ? html`<a class="link-more" href="${base}/schedule">Calendario completo ${icons.arrow({ size: 14 })}</a>` : ""}</div>
      ${upcoming.length === 0 ? emptyState("No hay próximos partidos") : html`<div class="upcoming-row">
        ${upcoming.map((g) => html`<div class="upcoming-card">
          <span class="upcoming-date">${fmtDateTime(g.game_date, tz)}</span>
          <span class="upcoming-teams">${g.home_name} <em>vs</em> ${g.away_name}</span>
          <span class="muted small">${g.pitch_name || ""}</span>
        </div>`)}
      </div>`}
    </section>

    ${sponsorStrip(scope)}
  </div>`;

  return page(scope, {
    title: "", description: `${scope.org.name} — resultados, clasificación, calendario y estadísticas de jugadores.`,
    body, banner, active: "home", scripts: heroMatch ? ["/live.js"] : [],
  });
}

export function notFoundView(scope) {
  const body = html`<div class="container"><div class="empty-state">
    <p class="empty-title">Página no encontrada</p>
    <p class="empty-hint">La página que buscas no existe.</p>
    <a class="btn btn-primary" href="/${scope.lang}">Volver al inicio</a>
  </div></div>`;
  return page(scope, { title: "No encontrada", body });
}
