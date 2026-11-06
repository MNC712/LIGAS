/* Match clock for the referee app.
   The clock is intentionally local to the device: it keeps running across
   reloads and gives the minute field a sensible default when recording events.
   It never changes the stored match state on its own. */

(function () {
  "use strict";

  const clock = document.getElementById("match-clock");
  if (!clock) return;

  const gameId = clock.dataset.game || "match";
  const storageKey = "flm-clock:" + gameId;
  const minuteInput = document.getElementById("event-minute");
  const buttons = document.querySelectorAll("[data-timer]");

  let state = { running: false, startedAt: 0, accumulated: 0 };

  function readState() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (stored && typeof stored === "object") {
        state = {
          running: Boolean(stored.running),
          startedAt: Number(stored.startedAt) || 0,
          accumulated: Math.max(0, Number(stored.accumulated) || 0),
        };
      }
    } catch (_) {
      state = { running: false, startedAt: 0, accumulated: 0 };
    }
  }

  function writeState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (_) {
      /* storage can be unavailable in private mode; the clock still works */
    }
  }

  function elapsedMs() {
    if (!state.running) return state.accumulated;
    return state.accumulated + Math.max(0, Date.now() - state.startedAt);
  }

  function format(ms) {
    const total = Math.floor(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function render() {
    const ms = elapsedMs();
    clock.textContent = format(ms);
    if (minuteInput) {
      const minute = Math.max(1, Math.min(120, Math.ceil(ms / 60000)));
      // Do not overwrite a value the referee typed by hand.
      if (!minuteInput.dataset.manual || Number(minuteInput.value) === minuteInput.dataset.auto) {
        minuteInput.value = String(minute);
        minuteInput.dataset.auto = String(minute);
        delete minuteInput.dataset.manual;
      }
    }
  }

  function start() {
    if (state.running) return;
    state.running = true;
    state.startedAt = Date.now();
    writeState();
    render();
  }

  function pause() {
    if (!state.running) return;
    state.accumulated = elapsedMs();
    state.running = false;
    state.startedAt = 0;
    writeState();
    render();
  }

  function reset() {
    if (state.accumulated > 0 || state.running) {
      const ok = window.confirm("¿Reiniciar el cronómetro del partido a 00:00?");
      if (!ok) return;
    }
    state = { running: false, startedAt: 0, accumulated: 0 };
    writeState();
    if (minuteInput) {
      minuteInput.value = "1";
      minuteInput.dataset.auto = "1";
      delete minuteInput.dataset.manual;
    }
    render();
  }

  buttons.forEach(function (button) {
    button.addEventListener("click", function (event) {
      event.preventDefault();
      const action = button.dataset.timer;
      if (action === "start") start();
      else if (action === "pause") pause();
      else if (action === "reset") reset();
    });
  });

  if (minuteInput) {
    minuteInput.addEventListener("input", function () {
      minuteInput.dataset.manual = "1";
    });
  }

  window.addEventListener("beforeunload", writeState);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") render();
  });

  readState();
  render();
  window.setInterval(render, 1000);
})();
