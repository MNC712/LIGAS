/* Live match polling.
 *
 * Refreshes a match in place - score, status, live badge, penalties and the
 * goal/card timelines - from GET /api/games/:id/live, so spectators follow a
 * game without reloading and the admin console reflects every change at once.
 *
 * It also upgrades the admin controls: forms marked data-live-form are sent
 * with fetch (X-Requested-With: fetch) and the JSON reply - the very same live
 * payload - is applied instantly, keeping the page fluid during a match.
 * Without JavaScript everything keeps working: plain form posts still redirect.
 */

(function () {
  "use strict";

  var LIVE_MS = 4000;   // fast refresh while a match is being played
  var IDLE_MS = 20000;  // cheaper refresh when nothing is live yet

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* ------------------------------------------------------------ timelines */

  function timelineItem(minute, name, meta, cardClass) {
    var li = make("li");
    li.appendChild(make("span", "timeline-minute", minute + "\u2032"));
    var body = make("span", "timeline-body");
    body.appendChild(make("strong", null, name));
    body.appendChild(make("span", "muted small", meta));
    li.appendChild(body);
    if (cardClass) li.appendChild(make("span", "card " + cardClass));
    return li;
  }

  function buildTimeline(events, kind) {
    if (!events.length) {
      var empty = make("div", "empty-state");
      empty.appendChild(make("p", "empty-title", kind === "goals" ? "Sin goles registrados" : "Sin tarjetas registradas"));
      return empty;
    }
    var ul = make("ul", "timeline");
    events.forEach(function (e) {
      var name = e.player || "\u2014";
      if (kind === "goals") {
        var own = e.type === "own_goal" || e.own;
        ul.appendChild(timelineItem(e.time, name, (e.team || "") + (own ? " \u00b7 gol en propia" : ""), null));
      } else {
        var yellow = e.type === "yellow_card";
        ul.appendChild(timelineItem(
          e.time, name,
          (e.team || "") + " \u00b7 " + (e.typeName || (yellow ? "Tarjeta amarilla" : "Tarjeta roja")),
          yellow ? "card-yellow" : "card-red"
        ));
      }
    });
    return ul;
  }

  // Only touch the DOM when the content actually changed: rebuilding the same
  // list every few seconds would flicker the page for no reason.
  function setTimeline(container, events, kind) {
    if (!container) return;
    var signature = kind + ":" + JSON.stringify(events);
    if (container.dataset.sig === signature) return;
    container.dataset.sig = signature;
    container.replaceChildren(buildTimeline(events, kind));
  }

  function buildEventsTable(gameId, events) {
    if (!events.length) return make("p", "muted", "Sin eventos registrados.");
    var table = make("table", "data-table compact");
    var tbody = make("tbody");
    events.forEach(function (e) {
      var tr = make("tr");
      tr.appendChild(make("td", "num", e.time + "\u2032"));
      tr.appendChild(make("td", null, e.typeName || e.type));
      tr.appendChild(make("td", null, e.player || "\u2014"));
      tr.appendChild(make("td", "muted", e.team || ""));
      var actions = make("td", "num row-actions");
      var form = document.createElement("form");
      form.method = "post";
      form.action = "/admin/games/" + gameId + "/events/" + e.id + "/delete";
      form.setAttribute("data-live-form", "");
      var button = make("button", "btn btn-mini btn-danger", "Eliminar");
      button.type = "submit";
      form.appendChild(button);
      actions.appendChild(form);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function setEvents(container, gameId, events) {
    if (!container) return;
    var signature = JSON.stringify(events);
    if (container.dataset.sig === signature) return;
    container.dataset.sig = signature;

    var count = document.querySelector('[data-live="eventcount"]');
    if (count) setText(count, events.length + (events.length === 1 ? " evento" : " eventos"));

    // The server already rendered this table on load; adopt it as-is so the
    // first poll does not repaint identical rows.
    if (container.hasAttribute("data-ssr")) {
      container.removeAttribute("data-ssr");
      return;
    }
    container.replaceChildren(buildEventsTable(gameId, events));
  }

  /* --------------------------------------------------------- state update */

  function applyState(root, state) {
    setText(root.querySelector('[data-live="score"]'), state.score);

    var statusEl = root.querySelector('[data-live="status"]');
    if (statusEl) {
      setText(statusEl, state.statusLabel);
      if (statusEl.classList.contains("pill")) statusEl.classList.toggle("pill-live", state.live);
    }

    var badge = root.querySelector('[data-live="badge"]');
    if (badge) badge.hidden = !state.live;

    var penalties = root.querySelector('[data-live="penalties"]');
    if (penalties) {
      var hasPenalties = state.penaltyHome !== null && state.penaltyAway !== null;
      setText(penalties, hasPenalties ? "Penaltis " + state.penaltyHome + " - " + state.penaltyAway : "");
    }

    var boards = root.querySelectorAll(".scoreboard, .referee-score");
    for (var i = 0; i < boards.length; i++) boards[i].classList.toggle("is-live", state.live);

    var events = state.events || [];
    setTimeline(root.querySelector('[data-live="goals"]'), events.filter(function (e) {
      return e.type === "goal" || e.type === "own_goal";
    }), "goals");
    setTimeline(root.querySelector('[data-live="cards"]'), events.filter(function (e) {
      return e.type === "yellow_card" || e.type === "red_card";
    }), "cards");
    setEvents(root.querySelector('[data-live="events"]'), state.id, events);
  }

  function fetchLive(gameId) {
    return fetch("/api/games/" + gameId + "/live", {
      headers: { accept: "application/json" },
      cache: "no-store",
    }).then(function (res) { return res.ok ? res.json() : null; });
  }

  /* -------------------------------------------------------------- polling */

  function createLoop(root) {
    var gameId = root.dataset.liveGame;
    var delay = LIVE_MS;
    var timer = null;

    function schedule() {
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(tick, delay);
    }

    function tick() {
      timer = null;
      fetchLive(gameId)
        .then(function (state) {
          if (!state || state.error) return;
          applyState(root, state);
          delay = state.live ? LIVE_MS : IDLE_MS;
        })
        .catch(function () { /* transient failure: keep the current delay */ })
        .then(schedule);
    }

    function now() {
      if (timer) { window.clearTimeout(timer); timer = null; }
      tick();
    }

    now();
    return { now: now };
  }

  var loops = [];
  var roots = document.querySelectorAll("[data-live-game]");
  for (var i = 0; i < roots.length; i++) loops.push(createLoop(roots[i]));

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    loops.forEach(function (loop) { loop.now(); });
  });

  /* --------------------------------------------------- admin form upgrades */

  function flash(form, ok) {
    var panel = form.closest(".panel") || form;
    panel.classList.remove("is-flash-ok", "is-flash-err");
    void panel.offsetWidth; // restart the animation on repeated saves
    panel.classList.add(ok ? "is-flash-ok" : "is-flash-err");
    window.setTimeout(function () {
      panel.classList.remove("is-flash-ok", "is-flash-err");
    }, 900);
  }

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || !form.hasAttribute || !form.hasAttribute("data-live-form")) return;
    event.preventDefault();

    var body = new FormData(form);
    var submitter = event.submitter;
    if (submitter && submitter.name && !body.has(submitter.name)) {
      body.append(submitter.name, submitter.value);
    }

    form.setAttribute("aria-busy", "true");
    fetch(form.action, {
      method: "POST",
      headers: { accept: "application/json", "x-requested-with": "fetch" },
      body: body,
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (state) {
        if (!state || state.error) throw new Error("unexpected response");
        var root = form.closest("[data-live-game]");
        if (root) applyState(root, state);
        flash(form, true);
      })
      .catch(function () {
        // Fall back to the plain (no-JS) submission so nothing is ever lost.
        form.removeAttribute("data-live-form");
        form.submit();
      })
      .then(function () { form.removeAttribute("aria-busy"); });
  });
})();
