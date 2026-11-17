/* Calma · table, input, storage. Rules live in game.js. */
(function () {
  "use strict";

  var K = window.Klondike;
  var SUIT = { S: "♠︎", H: "♥︎", D: "♦︎", C: "♣︎" };
  var RANK = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  var KEY = { game: "calma.game", stats: "calma.stats", prefs: "calma.prefs" };
  var DRAG_THRESHOLD = 8;

  var $ = function (id) { return document.getElementById(id); };
  var table = $("table");

  var state, prefs, stats, L;
  var els = {}, slots = {}, where = {}, lastRef = {};
  var drag = null, hintTimer = null, zTimer = null, autoRunning = false;
  var runningSince = null, tick = null;
  var armed = { "new": 0, reset: 0 };

  /* ---------- storage ---------- */
  function read(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }
  function defaultStats() { return { played: 0, won: 0, streak: 0, bestStreak: 0, bestTimeMs: 0, bestScore: 0 }; }

  function validGame(s) {
    try {
      var n = s.stock.length + s.waste.length;
      s.tableau.forEach(function (p) { n += p.length; });
      s.foundations.forEach(function (p) { n += p.length; });
      return n === 52 && Array.isArray(s.history);
    } catch (e) { return false; }
  }

  function saveGame() {
    if (!state) return;
    var copy = Object.assign({}, state, { elapsedMs: elapsed(), history: state.history.slice(-60) });
    write(KEY.game, copy);
  }

  /* ---------- time ---------- */
  function elapsed() {
    return (state.elapsedMs || 0) + (runningSince ? Date.now() - runningSince : 0);
  }
  function startClock() {
    if (runningSince || state.done || !state.counted) return;
    runningSince = Date.now();
    tick = setInterval(updateHud, 1000);
  }
  function stopClock() {
    if (runningSince) state.elapsedMs = elapsed();
    runningSince = null;
    clearInterval(tick);
  }
  function fmtTime(ms) {
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    var h = Math.floor(m / 60);
    s = s % 60;
    if (h) return h + ":" + String(m % 60).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }

  /* ---------- game lifecycle ---------- */
  function freshGame(seed) {
    var s = K.deal(seed, prefs.drawCount);
    s.elapsedMs = 0; s.counted = false; s.done = false;
    return s;
  }

  function newGame() {
    stopClock();
    if (state && state.counted && !state.done) { stats.streak = 0; write(KEY.stats, stats); }
    state = freshGame();
    lastRef = {};
    afterDeal();
  }

  function restartGame() {
    stopClock();
    // Same deal again: it stays the same game for the statistics unless it was already won.
    var sameGame = state.counted && !state.done;
    state = freshGame(state.seed);
    state.counted = sameGame;
    afterDeal();
  }

  function afterDeal() {
    clearHint();
    $("draw-note").hidden = true;
    render(false);
    updateHud();
    saveGame();
  }

  function changed() {
    clearHint();
    if (!state.counted) {
      state.counted = true;
      stats.played++;
      write(KEY.stats, stats);
    }
    startClock();
    render(true);
    updateHud();
    if (K.isWon(state)) win();
    saveGame();
  }

  function win() {
    if (state.done) return;
    stopClock();
    state.done = true;
    var t = state.elapsedMs, sc = state.score;
    var record = false;
    stats.won++;
    stats.streak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    if (!stats.bestTimeMs || t < stats.bestTimeMs) { record = stats.won > 1; stats.bestTimeMs = t; }
    if (sc > stats.bestScore) { record = record || stats.won > 1; stats.bestScore = sc; }
    write(KEY.stats, stats);
    $("win-summary").textContent = fmtTime(t) + " · " + state.moves + " moviments · " + sc + " punts";
    $("win-record").hidden = !record;
    updateFinish();
    setTimeout(function () { openDialog("dlg-win"); }, 450);
  }

  /* ---------- actions ---------- */
  function doMove(from, index, to) {
    if (state.done || autoRunning) return false;
    if (!K.move(state, from, index, to)) return false;
    changed();
    return true;
  }

  function doDraw() {
    if (state.done || autoRunning) return;
    if (!K.draw(state)) { toast("No queden cartes al munt"); return; }
    changed();
  }

  function tapCard(ref, index) {
    var to = K.bestTarget(state, ref, index);
    if (to) { doMove(ref, index, to); return; }
    var cards = K.pickable(state, ref, index) || [];
    cards.forEach(function (c) {
      var el = els[c.id];
      el.classList.remove("shake");
      void el.offsetWidth;
      el.classList.add("shake");
    });
  }

  function undo() {
    if (state.done || autoRunning) return;
    if (!K.undo(state)) { toast("No hi ha res a desfer"); return; }
    clearHint();
    render(true);
    updateHud();
    saveGame();
  }

  function showHint() {
    if (state.done || autoRunning) return;
    clearHint();
    var h = K.hint(state);
    if (!h) { toast("No queden moviments. Desfés o comença una partida nova."); return; }
    var marked = [];
    if (h.draw) {
      var s = state.stock;
      if (s.length) marked.push(els[s[s.length - 1].id]); else marked.push(slots.s);
      toast(state.stock.length ? "Treu una carta del munt" : "Torna a girar el munt");
    } else {
      K.pile(state, h.from).slice(h.index).forEach(function (c) { marked.push(els[c.id]); });
      var dst = K.pile(state, h.to);
      marked.push(dst.length ? els[dst[dst.length - 1].id] : slots[h.to]);
    }
    marked.forEach(function (el) { el.classList.add("hint"); });
    hintTimer = setTimeout(clearHint, 1800);
  }

  function clearHint() {
    clearTimeout(hintTimer);
    table.querySelectorAll(".hint").forEach(function (el) { el.classList.remove("hint"); });
  }

  function autoFinish() {
    if (autoRunning || !K.canAutoComplete(state)) return;
    autoRunning = true;
    updateFinish();
    var steps = 0;
    (function step() {
      var r = K.autoStep(state);
      steps++;
      render(true);
      updateHud();
      if (r && !K.isWon(state) && steps < 600) { setTimeout(step, 70); return; }
      autoRunning = false;
      changed();
    })();
  }

  /* Second tap within 3 s confirms, so a stray tap never throws a game away. */
  function confirmTap(name, message) {
    var now = Date.now();
    if (now - armed[name] < 3000) { armed[name] = 0; return true; }
    armed[name] = now;
    toast(message);
    return false;
  }

  function requestNewGame() {
    if (state.counted && !state.done && state.moves > 0 &&
        !confirmTap("new", "Toca «Nova» un altre cop per deixar aquesta partida")) return;
    newGame();
  }

  /* ---------- layout ---------- */
  function computeLayout() {
    var W = table.clientWidth, H = table.clientHeight;
    var pad = Math.max(8, Math.round(W * 0.02));
    var gap = Math.max(4, Math.round(Math.min(W, 760) * 0.012));
    var cw = Math.floor((Math.min(W, 760) - 2 * pad - 6 * gap) / 7);
    var byHeight = Math.floor((H - 2 * pad) / 4.4 / 1.4);
    cw = Math.max(26, Math.min(cw, byHeight));
    var ch = Math.round(cw * 1.4);
    var x0 = Math.round((W - (7 * cw + 6 * gap)) / 2);
    var root = document.documentElement.style;
    root.setProperty("--cw", cw + "px");
    root.setProperty("--ch", ch + "px");
    var left = !!prefs.leftHanded;
    function col(i) { return x0 + (left ? 6 - i : i) * (cw + gap); }
    L = {
      W: W, H: H, pad: pad, cw: cw, ch: ch,
      top: pad,
      tabY: pad + ch + Math.max(12, gap * 2),
      fanDir: left ? -1 : 1,
      stockX: col(0), wasteX: col(1),
      // Foundations take the four columns on the side away from the stock.
      foundX: [0, 1, 2, 3].map(function (i) { return x0 + (left ? i : i + 3) * (cw + gap); }),
      tabX: [0, 1, 2, 3, 4, 5, 6].map(function (i) { return x0 + i * (cw + gap); })
    };
  }

  function columnOffsets(p) {
    var fd = L.ch * 0.13, fu = L.ch * 0.30;
    var need = 0;
    for (var i = 0; i < p.length - 1; i++) need += p[i].up ? fu : fd;
    var avail = L.H - L.tabY - L.pad - L.ch;
    var k = need > avail && need > 0 ? Math.max(0.2, avail / need) : 1;
    return { fd: fd * k, fu: fu * k };
  }

  /* ---------- rendering ---------- */
  function build() {
    table.innerHTML = "";
    var mk = function (cls, text, ref) {
      var d = document.createElement("div");
      d.className = "slot " + cls;
      d.textContent = text;
      d.dataset.ref = ref;
      table.appendChild(d);
      slots[ref] = d;
    };
    mk("stock", "↻", "s");
    for (var f = 0; f < 4; f++) mk("found", "A", "f" + f);
    for (var t = 0; t < 7; t++) mk("tab", "K", "t" + t);

    K.SUITS.forEach(function (s) {
      for (var r = 1; r <= 13; r++) {
        var el = document.createElement("div");
        el.className = "card" + (s === "H" || s === "D" ? " red" : "");
        el.dataset.id = s + r;
        el.innerHTML = '<div class="face"><span class="idx">' + RANK[r] + '<span class="s">' + SUIT[s] +
          '</span></span><span class="pip">' + SUIT[s] + '</span></div><div class="back"></div>';
        table.appendChild(el);
        els[s + r] = el;
      }
    });
  }

  function place(el, x, y) { el.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)"; }

  function render(animate) {
    if (!L) return;
    var cards = Object.keys(els);
    cards.forEach(function (id) { els[id].classList.toggle("no-anim", !animate); });
    var moving = false;

    function put(card, ref, index, x, y, z) {
      var el = els[card.id];
      el.classList.toggle("down", !card.up);
      el.classList.remove("dragging");
      place(el, x, y);
      var raise = animate && lastRef[card.id] !== undefined && lastRef[card.id] !== ref;
      if (raise) moving = true;
      el.style.zIndex = raise ? 600 + index : z;
      el.dataset.z = z;
      where[card.id] = { ref: ref, index: index, x: x, y: y };
      lastRef[card.id] = ref;
    }

    place(slots.s, L.stockX, L.top);
    state.stock.forEach(function (c, i) { put(c, "s", i, L.stockX, L.top, 1 + i); });
    slots.s.classList.toggle("can-recycle", !state.stock.length && state.waste.length > 0);
    slots.s.classList.toggle("empty-all", !state.stock.length && !state.waste.length);

    var w = state.waste, shown = state.drawCount === 3 ? 3 : 1;
    var firstShown = Math.max(0, w.length - shown);
    w.forEach(function (c, i) {
      var k = i >= firstShown ? i - firstShown : 0;
      put(c, "w", i, L.wasteX + k * L.cw * 0.36 * L.fanDir, L.top, 100 + i);
    });

    state.foundations.forEach(function (p, f) {
      place(slots["f" + f], L.foundX[f], L.top);
      p.forEach(function (c, i) { put(c, "f" + f, i, L.foundX[f], L.top, 200 + i); });
    });

    state.tableau.forEach(function (p, t) {
      place(slots["t" + t], L.tabX[t], L.tabY);
      var o = columnOffsets(p), y = L.tabY;
      p.forEach(function (c, i) {
        put(c, "t" + t, i, L.tabX[t], y, 300 + i);
        y += c.up ? o.fu : o.fd;
      });
    });

    if (moving) {
      clearTimeout(zTimer);
      zTimer = setTimeout(function () {
        cards.forEach(function (id) { if (!els[id].classList.contains("dragging")) els[id].style.zIndex = els[id].dataset.z; });
      }, 230);
    }
    updateFinish();
  }

  function updateHud() {
    $("hud-time").textContent = fmtTime(elapsed());
    $("hud-moves").textContent = state.moves;
    $("hud-score").textContent = state.score;
    $("btn-undo").disabled = !state.history.length || state.done;
  }

  function updateFinish() {
    $("btn-finish").hidden = autoRunning || state.done || !K.canAutoComplete(state);
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ---------- pointer input ---------- */
  function pileRect(ref) {
    if (ref[0] === "f") { var f = Number(ref[1]); return { x: L.foundX[f], y: L.top, w: L.cw, h: L.ch }; }
    var t = Number(ref[1]), p = state.tableau[t];
    var bottom = p.length ? where[p[p.length - 1].id].y + L.ch : L.tabY + L.ch;
    return { x: L.tabX[t], y: L.tabY, w: L.cw, h: Math.max(L.ch, bottom - L.tabY) };
  }

  function overlap(a, b) {
    var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function dropTarget(d) {
    var r = { x: d.origin[0].x + d.dx, y: d.origin[0].y + d.dy, w: L.cw, h: L.ch };
    var best = null, bestArea = 0;
    K.allRefs().forEach(function (ref) {
      if (ref === d.ref || !K.canMove(state, d.ref, d.index, ref)) return;
      var a = overlap(r, pileRect(ref));
      if (a > bestArea) { bestArea = a; best = ref; }
    });
    return best;
  }

  table.addEventListener("pointerdown", function (e) {
    if (drag || autoRunning || state.done || e.button > 0) return;
    var cardEl = e.target.closest(".card");
    var slotEl = e.target.closest(".slot");
    // The stock's spot always means "draw", even if a card on its way to the waste is passing over it.
    var tr = table.getBoundingClientRect();
    var px = e.clientX - tr.left, py = e.clientY - tr.top;
    if (px >= L.stockX && px <= L.stockX + L.cw && py >= L.top && py <= L.top + L.ch) {
      drag = { stock: true, id: e.pointerId };
      capture(e);
      return;
    }
    if (cardEl) {
      var info = where[cardEl.dataset.id];
      if (info.ref === "s") { drag = { stock: true, id: e.pointerId }; capture(e); return; }
      var cards = K.pickable(state, info.ref, info.index);
      if (!cards) return;
      drag = {
        id: e.pointerId, ref: info.ref, index: info.index,
        ids: cards.map(function (c) { return c.id; }),
        origin: cards.map(function (c) { return { x: where[c.id].x, y: where[c.id].y }; }),
        sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, moved: false
      };
      capture(e);
    } else if (slotEl && slotEl.dataset.ref === "s") {
      drag = { stock: true, id: e.pointerId };
      capture(e);
    }
  });

  // Every press is captured so its release always comes back here, even outside the table.
  function capture(e) {
    try { table.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  // Safety net: if the release is lost anyway, never leave input stuck.
  window.addEventListener("pointerup", function (e) {
    if (drag && e.pointerId === drag.id && !table.hasPointerCapture(e.pointerId)) endPointer(e, true);
  });

  table.addEventListener("pointermove", function (e) {
    if (!drag || drag.stock || e.pointerId !== drag.id) return;
    drag.dx = e.clientX - drag.sx;
    drag.dy = e.clientY - drag.sy;
    if (!drag.moved) {
      if (Math.hypot(drag.dx, drag.dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      clearHint();
      drag.ids.forEach(function (id, k) {
        els[id].classList.add("no-anim", "dragging");
        els[id].style.zIndex = 1000 + k;
      });
    }
    drag.ids.forEach(function (id, k) { place(els[id], drag.origin[k].x + drag.dx, drag.origin[k].y + drag.dy); });
  });

  function endPointer(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    if (d.stock) { if (!cancelled) doDraw(); return; }
    if (d.moved) {
      var to = cancelled ? null : dropTarget(d);
      if (!(to && doMove(d.ref, d.index, to))) render(true);
    } else if (!cancelled) {
      tapCard(d.ref, d.index);
    }
  }
  table.addEventListener("pointerup", function (e) { endPointer(e, false); });
  table.addEventListener("pointercancel", function (e) { endPointer(e, true); });
  table.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  /* ---------- dialogs and menu ---------- */
  function openDialog(id) {
    document.querySelectorAll("dialog[open]").forEach(function (d) { if (d.id !== id) d.close(); });
    var d = $(id);
    if (id === "dlg-stats") fillStats();
    if (id === "dlg-menu") syncMenu();
    if (!d.open) d.showModal();
  }

  function syncMenu() {
    document.querySelectorAll("[data-draw]").forEach(function (b) {
      b.setAttribute("aria-checked", String(Number(b.dataset.draw) === prefs.drawCount));
    });
    $("opt-left").checked = !!prefs.leftHanded;
  }

  function fillStats() {
    var pct = stats.played ? Math.round((stats.won / stats.played) * 100) + "%" : "–";
    var tiles = [
      ["Partides", stats.played], ["Guanyades", stats.won], ["Victòries", pct],
      ["Ratxa", stats.streak], ["Millor ratxa", stats.bestStreak],
      ["Millor temps", stats.bestTimeMs ? fmtTime(stats.bestTimeMs) : "–"]
    ];
    $("stats-grid").innerHTML = tiles.map(function (t) {
      return '<div class="stat"><span class="stat-value">' + t[1] + '</span><span class="stat-label">' + t[0] + "</span></div>";
    }).join("");
    $("stats-empty").hidden = stats.played > 0;
    var reset = document.querySelector('[data-action="reset-stats"]');
    reset.textContent = "Esborra-les";
    armed.reset = 0;
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-action], [data-draw]");
    if (!b) return;
    var dlg = b.closest("dialog");
    if (b.dataset.draw) {
      var n = Number(b.dataset.draw);
      if (n === prefs.drawCount) return;
      prefs.drawCount = n;
      write(KEY.prefs, prefs);
      syncMenu();
      if (state.moves === 0 && !state.done) {
        state = freshGame(state.seed);
        afterDeal();
      } else {
        $("draw-note").hidden = false;
      }
      return;
    }
    switch (b.dataset.action) {
      case "close": dlg.close(); break;
      case "new": if (dlg) dlg.close(); newGame(); break;
      case "restart": dlg.close(); restartGame(); break;
      case "stats": openDialog("dlg-stats"); break;
      case "help": openDialog("dlg-help"); break;
      case "reset-stats":
        if (Date.now() - armed.reset < 3000) {
          stats = defaultStats();
          write(KEY.stats, stats);
          fillStats();
        } else {
          armed.reset = Date.now();
          b.textContent = "Segur? Toca de nou";
        }
        break;
    }
  });

  // Tapping the dark area around a dialog closes it.
  document.querySelectorAll("dialog").forEach(function (d) {
    d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
  });

  $("opt-left").addEventListener("change", function (e) {
    prefs.leftHanded = e.target.checked;
    write(KEY.prefs, prefs);
    computeLayout();
    render(true);
  });

  $("btn-new").addEventListener("click", requestNewGame);
  $("btn-undo").addEventListener("click", undo);
  $("btn-hint").addEventListener("click", showHint);
  $("btn-menu").addEventListener("click", function () { openDialog("dlg-menu"); });
  $("btn-finish").addEventListener("click", autoFinish);

  document.addEventListener("keydown", function (e) {
    if (document.querySelector("dialog[open]")) return;
    var k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); undo(); }
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (k === "u") undo();
    else if (k === "h") showHint();
    else if (k === "n") requestNewGame();
    else if (k === " " || k === "d") { e.preventDefault(); doDraw(); }
  });

  /* ---------- app lifecycle ---------- */
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { computeLayout(); render(false); }, 60);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { stopClock(); saveGame(); }
    else if (state.counted && !state.done) startClock();
  });
  window.addEventListener("pagehide", saveGame);

  function init() {
    prefs = Object.assign({ drawCount: 1, leftHanded: false }, read(KEY.prefs, {}));
    stats = Object.assign(defaultStats(), read(KEY.stats, {}));
    var saved = read(KEY.game, null);
    state = saved && validGame(saved) ? saved : freshGame();
    build();
    computeLayout();
    render(false);
    updateHud();
    if (state.counted && !state.done && !document.hidden) startClock();
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(function () { /* offline cache is optional */ });
    }
  }

  init();
})();
