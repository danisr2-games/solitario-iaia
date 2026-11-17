/* Calma · table, input, storage, shop. Rules live in game.js, coins and shop in economy.js. */
(function () {
  "use strict";

  var K = window.Klondike;
  var E = window.Economy;
  var SUIT = { S: "♠︎", H: "♥︎", D: "♦︎", C: "♣︎" };
  var RANK = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  var KEY = { game: "calma.game", stats: "calma.stats", prefs: "calma.prefs", profile: "calma.profile" };
  var PEEK_MS = 1500;
  var DRAG_THRESHOLD = 8;

  var $ = function (id) { return document.getElementById(id); };
  var table = $("table");

  var state, prefs, stats, profile, L;
  var peekMode = false, shopTab = "help";
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
  function saveProfile() { write(KEY.profile, profile); }

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
    s.hintsUsed = 0;      // free hints used in this game
    s.restarted = false;  // a replayed deal pays half the coins
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
    state.restarted = true;
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

    var pay = E.coinsForWin(t, { drawCount: state.drawCount, boost: !!profile.upgrades.coinBoost, restarted: !!state.restarted });
    E.addCoins(profile, pay.total);
    saveProfile();
    state.coinsWon = pay.total;
    var parts = [pay.base + " por ganar", pay.speed + " por rapidez"];
    var why = [];
    if (state.drawCount === 3) why.push("×1,5 por 3 cartas");
    if (profile.upgrades.coinBoost) why.push("×1,25 bolsa de la suerte");
    if (state.restarted) why.push("×0,5 partida repetida");
    $("win-coins").textContent = pay.total;
    $("win-breakdown").textContent = parts.join(" + ") + (why.length ? " · " + why.join(" · ") : "");

    $("win-summary").textContent = fmtTime(t) + " · " + state.moves + " movimientos · " + sc + " puntos";
    $("win-record").hidden = !record;
    bumpCoins();
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
    if (!K.draw(state)) { toast("No quedan cartas en el mazo"); return; }
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
    if (!K.undo(state)) { toast("No hay nada que deshacer"); return; }
    clearHint();
    render(true);
    updateHud();
    saveGame();
  }

  function showHint() {
    if (state.done || autoRunning) return;
    clearHint();
    var h = K.hint(state);
    if (!h) { toast("No quedan movimientos. Deshaz o empieza una partida nueva."); return; }
    // Pay for the hint: first the free ones of this game, then the bought ones.
    if ((state.hintsUsed || 0) < E.freeHints(profile)) {
      state.hintsUsed = (state.hintsUsed || 0) + 1;
      saveGame();
    } else if (profile.hints > 0) {
      profile.hints--;
      saveProfile();
    } else {
      toast("No te quedan pistas. Consigue más en la tienda.");
      return;
    }
    updateHud();
    var marked = [];
    if (h.draw) {
      var s = state.stock;
      if (s.length) marked.push(els[s[s.length - 1].id]); else marked.push(slots.s);
      toast(state.stock.length ? "Saca una carta del mazo" : "Dale la vuelta al mazo");
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

  /* ---------- peek (bought in the shop) ---------- */
  function togglePeek() {
    if (state.done || autoRunning) return;
    if (peekMode) { setPeekMode(false); return; }
    if (profile.peeks <= 0) { toast("No tienes vistazos. Cómpralos en la tienda."); return; }
    var hidden = state.tableau.some(function (p) { return p.some(function (c) { return !c.up; }); });
    if (!hidden) { toast("No queda ninguna carta boca abajo en las columnas"); return; }
    setPeekMode(true);
    toast("Toca una carta boca abajo para verla");
  }

  function setPeekMode(on) {
    peekMode = on;
    table.classList.toggle("peek-mode", on);
    $("btn-peek").classList.toggle("active", on);
  }

  function peekAt(id) {
    var el = els[id];
    profile.peeks--;
    saveProfile();
    setPeekMode(false);
    updateHud();
    el.classList.add("peeking");
    setTimeout(function () { el.classList.remove("peeking"); }, PEEK_MS);
  }

  /* ---------- coins, looks and shop ---------- */
  function bumpCoins() {
    updateHud();
    var c = $("hud-coins");
    c.classList.remove("bump");
    void c.offsetWidth;
    c.classList.add("bump");
  }

  function applyLook() {
    var b = document.body;
    E.CATALOG.forEach(function (it) {
      if (it.kind === "back" || it.kind === "table") b.classList.remove(it.id);
    });
    b.classList.add(profile.equipped.back, profile.equipped.table);
    b.classList.toggle("four-color", E.owns(profile, "fourColor") && profile.equipped.fourColor !== false);
  }

  var GROUPS = {
    help: [["consumable", "Para esta y otras partidas"], ["upgrade", "Mejoras para siempre"]],
    look: [["deck", "Baraja"], ["back", "Dorsos"], ["table", "Tapetes"]]
  };
  var ICON = { hints5: "?", hints20: "??", peek3: "◉", moreHints: "+?", coinBoost: "◈" };

  function esc(t) { return String(t).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); }

  function thumb(it) {
    if (it.kind === "back") return '<span class="thumb back-swatch ' + it.id + '"></span>';
    if (it.kind === "table") return '<span class="thumb table-swatch ' + it.id + '"></span>';
    if (it.kind === "deck") return '<span class="thumb deck-swatch"><span class="s">♠&#xFE0E;</span><span class="h">♥&#xFE0E;</span><span class="c">♣&#xFE0E;</span><span class="d">♦&#xFE0E;</span></span>';
    return '<span class="thumb icon">' + (ICON[it.id] || "★") + "</span>";
  }

  function priceTag(n) { return n ? '<span class="coin" aria-hidden="true"></span>' + n : "Gratis"; }

  function actionButton(it) {
    var owned = E.owns(profile, it.id);
    if (it.kind === "back" || it.kind === "table") {
      if (profile.equipped[it.kind] === it.id) return '<button class="buy equipped" disabled>En uso</button>';
      if (owned) return '<button class="buy equip" data-equip="' + it.id + '">Usar</button>';
    } else if (it.kind === "deck" && owned) {
      var on = profile.equipped.fourColor !== false;
      return '<button class="buy ' + (on ? "equipped" : "equip") + '" data-toggle-deck="1">' + (on ? "Activada" : "Activar") + "</button>";
    } else if (it.kind === "upgrade" && owned) {
      return '<button class="buy equipped" disabled>Comprada</button>';
    }
    var short = profile.coins < it.price;
    return '<button class="buy" data-buy="' + it.id + '"' + (short ? ' aria-disabled="true"' : "") +
      ' aria-label="Comprar ' + esc(it.name) + " por " + it.price + ' monedas">' + priceTag(it.price) + "</button>";
  }

  function renderShop() {
    $("shop-coins").textContent = profile.coins;
    document.querySelectorAll("#dlg-shop [data-tab]").forEach(function (t) {
      t.setAttribute("aria-selected", String(t.dataset.tab === shopTab));
    });
    var html = "";
    GROUPS[shopTab].forEach(function (g) {
      html += '<p class="shop-group">' + g[1] + "</p>";
      E.CATALOG.filter(function (it) { return it.kind === g[0]; }).forEach(function (it) {
        var have = "";
        if (it.id === "hints5" || it.id === "hints20") have = ' <span class="owned-count">Tienes ' + profile.hints + "</span>";
        if (it.id === "peek3") have = ' <span class="owned-count">Tienes ' + profile.peeks + "</span>";
        html += '<div class="shop-item">' + thumb(it) +
          "<div><h3>" + esc(it.name) + "</h3><p>" + esc(it.desc) + have + "</p></div>" +
          actionButton(it) + "</div>";
      });
    });
    $("shop-list").innerHTML = html;
  }

  function buyItem(id) {
    var why = E.blocker(profile, id);
    if (why === "coins") {
      toast("Te faltan " + (E.item(id).price - profile.coins) + " monedas");
      return;
    }
    if (!E.buy(profile, id)) return;
    saveProfile();
    applyLook();
    renderShop();
    updateHud();
    toast("Comprado: " + E.item(id).name);
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
        !confirmTap("new", "Toca «Nueva» otra vez para dejar esta partida")) return;
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
        el.className = "card suit-" + s + (s === "H" || s === "D" ? " red" : "");
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
    $("coins-value").textContent = profile.coins;
    var hintsLeft = Math.max(0, E.freeHints(profile) - (state.hintsUsed || 0)) + profile.hints;
    $("hint-badge").textContent = hintsLeft;
    $("hint-badge").classList.toggle("empty", hintsLeft === 0);
    $("peek-badge").textContent = profile.peeks;
    $("peek-badge").classList.toggle("empty", profile.peeks === 0);
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
    if (peekMode) {
      var pk = cardEl && where[cardEl.dataset.id];
      if (pk && pk.ref[0] === "t" && cardEl.classList.contains("down")) peekAt(cardEl.dataset.id);
      else { setPeekMode(false); toast("Vistazo cancelado"); }
      return;
    }
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
    if (id === "dlg-shop") renderShop();
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
      ["Partidas", stats.played], ["Ganadas", stats.won], ["Victorias", pct],
      ["Racha", stats.streak], ["Mejor racha", stats.bestStreak],
      ["Mejor tiempo", stats.bestTimeMs ? fmtTime(stats.bestTimeMs) : "–"],
      ["Monedas ganadas", profile.earned], ["Monedas", profile.coins], ["Pistas compradas", profile.hints]
    ];
    $("stats-grid").innerHTML = tiles.map(function (t) {
      return '<div class="stat"><span class="stat-value">' + t[1] + '</span><span class="stat-label">' + t[0] + "</span></div>";
    }).join("");
    $("stats-empty").hidden = stats.played > 0;
    var reset = document.querySelector('[data-action="reset-stats"]');
    reset.textContent = "Borrarlas";
    armed.reset = 0;
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-action], [data-draw], [data-buy], [data-equip], [data-toggle-deck], [data-tab]");
    if (!b) return;
    if (b.dataset.buy) { buyItem(b.dataset.buy); return; }
    if (b.dataset.equip) {
      if (E.equip(profile, b.dataset.equip)) { saveProfile(); applyLook(); renderShop(); }
      return;
    }
    if (b.dataset.toggleDeck) {
      profile.equipped.fourColor = profile.equipped.fourColor === false;
      saveProfile(); applyLook(); renderShop();
      return;
    }
    if (b.dataset.tab) { shopTab = b.dataset.tab; renderShop(); return; }
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
      case "shop": openDialog("dlg-shop"); break;
      case "reset-stats":
        if (Date.now() - armed.reset < 3000) {
          stats = defaultStats();
          write(KEY.stats, stats);
          fillStats();
        } else {
          armed.reset = Date.now();
          b.textContent = "¿Seguro? Toca otra vez";
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
  $("btn-shop").addEventListener("click", function () { openDialog("dlg-shop"); });
  $("hud-coins").addEventListener("click", function () { openDialog("dlg-shop"); });
  $("btn-peek").addEventListener("click", togglePeek);
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
    profile = E.normalize(read(KEY.profile, null));
    applyLook();
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
