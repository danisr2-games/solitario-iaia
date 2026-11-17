/*
 * Calma · Klondike rules engine.
 * Pure logic, no DOM: works in the browser (window.Klondike) and in Node (require).
 *
 * Pile refs: "s" stock, "w" waste, "f0".."f3" foundations, "t0".."t6" tableau.
 * A card is { id, suit, rank, up }. suit is S H D C, rank is 1 (ace) .. 13 (king).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Klondike = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SUITS = ["S", "H", "D", "C"];
  var HISTORY_LIMIT = 300;
  var SCORE = { wasteToTableau: 5, toFoundation: 10, flip: 5, foundationToTableau: -15, recycle: -100 };

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newDeck() {
    var deck = [];
    SUITS.forEach(function (s) {
      for (var r = 1; r <= 13; r++) deck.push({ id: s + r, suit: s, rank: r, up: false });
    });
    return deck;
  }

  function randomSeed() {
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }

  function deal(seed, drawCount) {
    if (seed === undefined || seed === null) seed = randomSeed();
    var deck = newDeck();
    var rand = rng(seed);
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    var tableau = [[], [], [], [], [], [], []];
    for (var row = 0; row < 7; row++) {
      for (var col = row; col < 7; col++) tableau[col].push(deck.pop());
    }
    tableau.forEach(function (p) { p[p.length - 1].up = true; });
    return {
      seed: seed >>> 0,
      drawCount: drawCount === 3 ? 3 : 1,
      stock: deck,
      waste: [],
      foundations: [[], [], [], []],
      tableau: tableau,
      moves: 0,
      score: 0,
      passes: 0,
      history: []
    };
  }

  function isRed(card) { return card.suit === "H" || card.suit === "D"; }
  function top(pile) { return pile.length ? pile[pile.length - 1] : null; }

  function pile(state, ref) {
    if (ref === "s") return state.stock;
    if (ref === "w") return state.waste;
    var i = Number(ref.slice(1));
    if (ref[0] === "f") return state.foundations[i];
    if (ref[0] === "t") return state.tableau[i];
    throw new Error("bad pile ref " + ref);
  }

  function allRefs() {
    return ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "f0", "f1", "f2", "f3"];
  }

  /* The cards that would move if the player picks the card at `index` of `from`. */
  function pickable(state, from, index) {
    if (from === "s") return null;
    var p = pile(state, from);
    if (index < 0 || index >= p.length) return null;
    if (from === "w" || from[0] === "f") return index === p.length - 1 ? [p[index]] : null;
    for (var i = index; i < p.length; i++) if (!p[i].up) return null;
    return p.slice(index);
  }

  function accepts(state, to, cards) {
    if (!cards || !cards.length) return false;
    var first = cards[0];
    var p = pile(state, to);
    var t = top(p);
    if (to[0] === "f") {
      if (cards.length !== 1) return false;
      if (!t) return first.rank === 1;
      return t.suit === first.suit && t.rank + 1 === first.rank;
    }
    if (to[0] === "t") {
      if (!t) return first.rank === 13;
      return t.up && isRed(t) !== isRed(first) && t.rank === first.rank + 1;
    }
    return false;
  }

  function canMove(state, from, index, to) {
    if (from === to) return false;
    return accepts(state, to, pickable(state, from, index));
  }

  function snapshot(state) {
    return JSON.stringify({
      stock: state.stock, waste: state.waste, foundations: state.foundations,
      tableau: state.tableau, moves: state.moves, score: state.score, passes: state.passes
    });
  }

  function remember(state) {
    state.history.push(snapshot(state));
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
  }

  function addScore(state, n) { state.score = Math.max(0, state.score + n); }

  /* Moves cards; returns true if it happened. Mutates state. */
  function move(state, from, index, to) {
    if (!canMove(state, from, index, to)) return false;
    remember(state);
    var src = pile(state, from);
    var cards = src.splice(index, src.length - index);
    var dst = pile(state, to);
    cards.forEach(function (c) { dst.push(c); });
    if (from === "w" && to[0] === "t") addScore(state, SCORE.wasteToTableau);
    if (to[0] === "f" && from[0] !== "f") addScore(state, SCORE.toFoundation);
    if (from[0] === "f" && to[0] === "t") addScore(state, SCORE.foundationToTableau);
    if (from[0] === "t") {
      var t = top(src);
      if (t && !t.up) { t.up = true; addScore(state, SCORE.flip); }
    }
    state.moves++;
    return true;
  }

  /* Tap on the stock: draw, or turn the waste back over when the stock is empty. */
  function draw(state) {
    if (!state.stock.length && !state.waste.length) return false;
    remember(state);
    if (!state.stock.length) {
      while (state.waste.length) {
        var c = state.waste.pop();
        c.up = false;
        state.stock.push(c);
      }
      state.passes++;
      if (state.drawCount === 1) addScore(state, SCORE.recycle);
    } else {
      var n = Math.min(state.drawCount, state.stock.length);
      for (var i = 0; i < n; i++) {
        var d = state.stock.pop();
        d.up = true;
        state.waste.push(d);
      }
    }
    state.moves++;
    return true;
  }

  function undo(state) {
    var prev = state.history.pop();
    if (!prev) return false;
    var s = JSON.parse(prev);
    state.stock = s.stock; state.waste = s.waste; state.foundations = s.foundations;
    state.tableau = s.tableau; state.moves = s.moves; state.score = s.score; state.passes = s.passes;
    return true;
  }

  function isWon(state) {
    return state.foundations.reduce(function (n, f) { return n + f.length; }, 0) === 52;
  }

  /* Where a tapped card should go: foundation first, then a column with cards, then an empty column. */
  function bestTarget(state, from, index) {
    var cards = pickable(state, from, index);
    if (!cards) return null;
    var i;
    if (cards.length === 1 && from[0] !== "f") {
      for (i = 0; i < 4; i++) if (accepts(state, "f" + i, cards)) return "f" + i;
    }
    var empty = null;
    for (i = 0; i < 7; i++) {
      var ref = "t" + i;
      if (ref === from || !accepts(state, ref, cards)) continue;
      if (state.tableau[i].length) return ref;
      if (empty === null) empty = ref;
    }
    // A king already at the bottom of a column gains nothing by moving to another empty one.
    if (empty && from[0] === "t" && index === 0) return null;
    return empty;
  }

  /* A move worth suggesting, or { draw: true }, or null when nothing is left. */
  function hint(state) {
    var i, j, t, ref, cards;
    var sources = [];
    if (state.waste.length) sources.push({ from: "w", index: state.waste.length - 1 });
    for (i = 0; i < 7; i++) if (state.tableau[i].length) sources.push({ from: "t" + i, index: state.tableau[i].length - 1 });
    // 1. Anything onto a foundation.
    for (i = 0; i < sources.length; i++) {
      cards = pickable(state, sources[i].from, sources[i].index);
      for (j = 0; j < 4; j++) if (accepts(state, "f" + j, cards)) return { from: sources[i].from, index: sources[i].index, to: "f" + j };
    }
    // 2. A column move that turns a card over or empties a column for a king.
    var kingWaiting = state.waste.length && top(state.waste).rank === 13;
    for (i = 0; i < 7; i++) {
      t = state.tableau[i];
      var first = -1;
      for (j = 0; j < t.length; j++) if (t[j].up) { first = j; break; }
      if (first < 0) continue;
      if (first === 0 && t[0].rank === 13) continue;
      var reveals = first > 0;
      for (j = 0; j < 7; j++) {
        ref = "t" + j;
        if (j === i || !canMove(state, "t" + i, first, ref)) continue;
        if (!state.tableau[j].length && !reveals) continue;
        if (reveals || kingWaiting || hasKingToFree(state)) return { from: "t" + i, index: first, to: ref };
      }
    }
    // 3. The waste card onto a column.
    if (state.waste.length) {
      for (j = 0; j < 7; j++) if (canMove(state, "w", state.waste.length - 1, "t" + j)) return { from: "w", index: state.waste.length - 1, to: "t" + j };
    }
    // 4. Draw.
    if (state.stock.length || state.waste.length) return { draw: true };
    return null;
  }

  function hasKingToFree(state) {
    for (var i = 0; i < 7; i++) {
      var t = state.tableau[i];
      for (var j = 1; j < t.length; j++) if (t[j].up && t[j].rank === 13 && !t[j - 1].up) return true;
    }
    return false;
  }

  /* Auto-finish is offered once every column card is face up (and, in draw 3, the stock is used up). */
  function canAutoComplete(state) {
    if (isWon(state)) return false;
    for (var i = 0; i < 7; i++) {
      for (var j = 0; j < state.tableau[i].length; j++) if (!state.tableau[i][j].up) return false;
    }
    if (state.drawCount === 3 && (state.stock.length || state.waste.length)) return false;
    return true;
  }

  /* One step of the auto-finish: the lowest card that can go up goes up, otherwise draw. */
  function autoStep(state) {
    var best = null;
    var sources = [];
    if (state.waste.length) sources.push({ from: "w", index: state.waste.length - 1 });
    for (var i = 0; i < 7; i++) if (state.tableau[i].length) sources.push({ from: "t" + i, index: state.tableau[i].length - 1 });
    sources.forEach(function (src) {
      var card = pile(state, src.from)[src.index];
      for (var j = 0; j < 4; j++) {
        if (accepts(state, "f" + j, [card]) && (!best || card.rank < best.rank)) {
          best = { from: src.from, index: src.index, to: "f" + j, rank: card.rank };
        }
      }
    });
    if (best) return move(state, best.from, best.index, best.to) ? { from: best.from, to: best.to } : null;
    if (state.stock.length || state.waste.length) return draw(state) ? { draw: true } : null;
    return null;
  }

  return {
    SUITS: SUITS,
    SCORE: SCORE,
    deal: deal,
    randomSeed: randomSeed,
    isRed: isRed,
    pile: pile,
    allRefs: allRefs,
    pickable: pickable,
    accepts: accepts,
    canMove: canMove,
    move: move,
    draw: draw,
    undo: undo,
    isWon: isWon,
    bestTarget: bestTarget,
    hint: hint,
    canAutoComplete: canAutoComplete,
    autoStep: autoStep
  };
});
