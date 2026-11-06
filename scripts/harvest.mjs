// Harvest public data from the FLM System public GraphQL API.
// Evidence source: https://api.flmsystem.com/graphql-api (anonymous public queries)
// Domain: aquaopen.flmsystem.com
// Writes: data/raw.json
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOMAIN = process.env.FLM_DOMAIN || "aquaopen.flmsystem.com";
const ENDPOINT = "https://api.flmsystem.com/graphql-api";

async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://aquaopen.flmsystem.com" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const IMG = `id name url thumbnails { width height thumbnail_image { url } }`;

const TEAM_REF = `id slug name name_short crest { ${IMG} }`;

const GAME_FIELDS = `
  id game_date status result score_home score_away penalty_score_home penalty_score_away code
  about video
  round { id name cup_phase cup_bracket cup_bracket_order competition { id slug type cup_name name } }
  pitch { id name address city }
  home_team { id competition_team { id team { ${TEAM_REF} } } }
  away_team { id competition_team { id team { ${TEAM_REF} } } }
  events { id name time timeDisplay in_additional_time for_opposite_team event_type { name system_name } game_player { squad_number competition_player { player { id slug full_name } team_name squad_number } } }
`;

async function fetchGames() {
  const all = [];
  let page = 1;
  for (;;) {
    const data = await gql(
      `query($domain:String!,$page:Int,$order:[OrderByClause!]){ gamesPublic(domain:$domain, first:100, page:$page, undated_last:true, orderBy:$order){ paginatorInfo{ currentPage lastPage total } data { ${GAME_FIELDS} } } }`,
      { domain: DOMAIN, page, order: [{ column: "game_date", order: "ASC" }, { column: "id", order: "ASC" }] }
    );
    const p = data.gamesPublic;
    all.push(...p.data);
    if (p.paginatorInfo.currentPage >= p.paginatorInfo.lastPage) break;
    page++;
  }
  return all;
}

async function fetchPlayers() {
  const all = [];
  let page = 1;
  for (;;) {
    const data = await gql(
      `query($domain:String!,$page:Int){ competitionPlayersPublic(domain:$domain, first:100, page:$page){ paginatorInfo{ currentPage lastPage total } data {
        id player_id competition_id competition_team_id squad_number team_name full_name
        games_played goals_scored assists mvp yellow_cards red_cards conceded
        player { id slug first_name last_name date_of_birth about avatar { ${IMG} } }
        competition { id slug type name cup_name }
        competition_team { id team { ${TEAM_REF} } }
      } } }`,
      { domain: DOMAIN, page }
    );
    const p = data.competitionPlayersPublic;
    all.push(...p.data);
    if (p.paginatorInfo.currentPage >= p.paginatorInfo.lastPage) break;
    page++;
  }
  return all;
}

async function main() {
  const org = await gql(
    `query($domain:String!){ organizationPublic(domain:$domain){
      id name domain currency timezone date_format time_format
      primary_color secondary_color background_color background_accent_color text_color text_secondary_color
      home_url social_facebook_url social_instagram_url social_youtube_url social_tiktok_url social_x_url
      news_page_enabled contact_page_enabled gallery_page_enabled home_page_enabled contact_email
      counters { member_organizations_count teams_count players_count games_played_count goals_count }
      logo { ${IMG} }
      favicon { ${IMG} }
      gallery_images { ${IMG} }
      banner_image { ${IMG} }
      contact_image { ${IMG} }
      sponsors { id name url image { ${IMG} } }
      contact_fields { id name value }
      posts { id title slug content featured created_at image { ${IMG} } }
      sports { id name slug }
    } }`,
    { domain: DOMAIN }
  );

  const competitions = await gql(
    `query($domain:String!,$order:[OrderByClause!]){ competitionsPublic(domain:$domain, forNow:false, first:50, orderBy:$order){ data {
      id slug name type state is_archive about regulations
      league_points_win league_points_lose league_points_draw
      league_ranking_points league_ranking_head_to_head league_ranking_goal_diff league_ranking_goals_scored league_ranking_wins
      cup_name cup_start_date cup_end_date cup_format cup_phase placement_depth half_time red_card_suspension_matches
      league { id name slug }
      season { id name slug start_date end_date regulations classification_enabled }
    } } }`,
    { domain: DOMAIN, order: [{ column: "id", order: "ASC" }] }
  );

  const seasons = await gql(
    `query($domain:String!,$order:[OrderByClause!]){ seasonsPublic(domain:$domain, first:50, orderBy:$order){ data { id name slug start_date end_date regulations classification_enabled } } }`,
    { domain: DOMAIN, order: [{ column: "start_date", order: "DESC" }] }
  );

  const teams = await gql(
    `query($domain:String!){ teamsPublic(domain:$domain, first:100){ data { id slug name name_short city about crest { ${IMG} } image { ${IMG} } team_images { ${IMG} } } } }`,
    { domain: DOMAIN }
  );

  const competitionTeams = await gql(
    `query($domain:String!){ competitionTeamsPublic(domain:$domain, first:100){ data { id competition_id team_id competition { id slug type name cup_name } team { ${TEAM_REF} } } } }`,
    { domain: DOMAIN }
  );

  const rounds = await gql(
    `query($domain:String!){ roundsPublic(domain:$domain, first:100, orderByCupPhase:true){ data { id competition_id name cup_phase cup_bracket cup_bracket_order cup_bracket_round elimination_format competition { id slug type name cup_name } } } }`,
    { domain: DOMAIN }
  );

  const pitches = await gql(
    `query($domain:String!){ pitchesPublic(domain:$domain, first:50){ data { id name address about city slug image { ${IMG} } } } }`,
    { domain: DOMAIN }
  );

  const games = await fetchGames();
  const players = await fetchPlayers();

  // Standings for every league competition (grouped by league + season).
  const standings = [];
  for (const c of competitions.competitionsPublic.data) {
    if (c.type !== "LEAGUE") continue;
    const s = await gql(
      `query($domain:String!,$league:String!,$season:String!){ competitionStandingsPublic(domain:$domain, league_slug:$league, season_slug:$season, live:false){ competition_id competition_group_id standings_positions {
        competition_team_id team_name team_id team_slug crest_url place points games_played games_won games_draw games_lost
        goals_scored goals_conceded goals_diff extra_goals_added position_delta actual_form { result rivals form_designation game_date }
      } } }`,
      { domain: DOMAIN, league: c.league?.slug || "", season: c.season?.slug || "" }
    );
    standings.push({ competition: c.id, ...s.competitionStandingsPublic });
  }

  const raw = {
    harvested_at: new Date().toISOString(),
    source: ENDPOINT,
    domain: DOMAIN,
    organization: org.organizationPublic,
    competitions: competitions.competitionsPublic.data,
    seasons: seasons.seasonsPublic.data,
    teams: teams.teamsPublic.data,
    competitionTeams: competitionTeams.competitionTeamsPublic.data,
    rounds: rounds.roundsPublic.data,
    pitches: pitches.pitchesPublic.data,
    games,
    players,
    standings,
  };

  await mkdir(join(ROOT, "data"), { recursive: true });
  const out = join(ROOT, "data", "raw.json");
  await writeFile(out, JSON.stringify(raw, null, 2));
  console.log(
    `saved ${out}\n  org=${raw.organization.name}\n  competitions=${raw.competitions.length}\n  seasons=${raw.seasons.length}\n  teams=${raw.teams.length}\n  rounds=${raw.rounds.length}\n  games=${raw.games.length}\n  players=${raw.players.length}\n  standings=${raw.standings.length}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
