/*
 * Solitario Iaia · coins and shop. Pure logic, no DOM: works in the browser (window.Economy) and in Node.
 *
 * Profile (stored on the phone):
 *   { coins, earned, hints, peeks, owned: [ids], equipped: { back, table }, upgrades: { ids: true } }
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Economy = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BASE_COINS = 20;          // just for winning
  var FAST_LIMIT_S = 600;       // after 10 minutes there is no speed bonus
  var SPEED_DIVISOR = 4;        // 1 coin for every 4 seconds under 10 minutes (up to 150)
  var DRAW3_MULT = 1.5;         // draw 3 is harder
  var BOOST_MULT = 1.25;        // the "Bolsa de la suerte" upgrade
  var RESTART_MULT = 0.5;       // a deal replayed from the start is easier
  var FREE_HINTS = 3;
  var EXTRA_FREE_HINTS = 2;

  /* kind: consumable (adds to a counter), upgrade (bought once), back / table / deck (cosmetic, bought once, equipped). */
  var CATALOG = [
    { id: "hints5", kind: "consumable", give: { hints: 5 }, price: 40, name: "5 pistas", desc: "Para cuando se acaban las gratis de la partida." },
    { id: "peek3", kind: "consumable", give: { peeks: 3 }, price: 60, name: "3 vistazos", desc: "Mira una carta boca abajo durante un momento." },
    { id: "hints20", kind: "consumable", give: { hints: 20 }, price: 140, name: "20 pistas", desc: "El paquete grande, más barato por pista." },

    { id: "moreHints", kind: "upgrade", price: 600, name: "Más pistas gratis", desc: "Cada partida empieza con " + (FREE_HINTS + EXTRA_FREE_HINTS) + " pistas gratis en vez de " + FREE_HINTS + "." },
    { id: "coinBoost", kind: "upgrade", price: 1000, name: "Bolsa de la suerte", desc: "Ganas un 25 % más de monedas en cada victoria." },

    { id: "fourColor", kind: "deck", price: 250, name: "Baraja de 4 colores", desc: "Tréboles verdes y diamantes azules: se distinguen de un vistazo." },

    { id: "back-classic", kind: "back", price: 0, name: "Dorso Clásico", desc: "El de siempre." },
    { id: "back-ember", kind: "back", price: 150, name: "Dorso Brasa", desc: "Rojo cálido con rombos." },
    { id: "back-night", kind: "back", price: 200, name: "Dorso Noche", desc: "Azul oscuro con estrellas." },
    { id: "back-gold", kind: "back", price: 400, name: "Dorso Oro", desc: "Para los que ganan mucho." },

    { id: "table-dusk", kind: "table", price: 0, name: "Tapete Atardecer", desc: "El de siempre." },
    { id: "table-forest", kind: "table", price: 200, name: "Tapete Bosque", desc: "Verde profundo." },
    { id: "table-wine", kind: "table", price: 250, name: "Tapete Burdeos", desc: "Granate de casino." },
    { id: "table-slate", kind: "table", price: 300, name: "Tapete Pizarra", desc: "Gris neutro, cansa poco la vista." }
  ];

  function item(id) {
    for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].id === id) return CATALOG[i];
    return null;
  }

  function newProfile() {
    return {
      coins: 0, earned: 0, hints: 0, peeks: 0,
      owned: ["back-classic", "table-dusk"],
      equipped: { back: "back-classic", table: "table-dusk" },
      upgrades: {}
    };
  }

  /* Fills in anything missing from an older or damaged saved profile. */
  function normalize(p) {
    var d = newProfile();
    if (!p || typeof p !== "object") return d;
    var out = {
      coins: Math.max(0, Math.floor(Number(p.coins) || 0)),
      earned: Math.max(0, Math.floor(Number(p.earned) || 0)),
      hints: Math.max(0, Math.floor(Number(p.hints) || 0)),
      peeks: Math.max(0, Math.floor(Number(p.peeks) || 0)),
      owned: Array.isArray(p.owned) ? p.owned.filter(function (id) { return !!item(id); }) : [],
      equipped: Object.assign({}, d.equipped, p.equipped || {}),
      upgrades: Object.assign({}, p.upgrades || {})
    };
    d.owned.forEach(function (id) { if (out.owned.indexOf(id) < 0) out.owned.push(id); });
    ["back", "table"].forEach(function (k) {
      if (out.owned.indexOf(out.equipped[k]) < 0) out.equipped[k] = d.equipped[k];
    });
    return out;
  }

  /* Coins for a win: the faster, the more. Returns the total and the parts, for the win screen. */
  function coinsForWin(elapsedMs, opts) {
    opts = opts || {};
    var secs = Math.max(0, Math.floor(elapsedMs / 1000));
    var speed = Math.max(0, Math.round((FAST_LIMIT_S - secs) / SPEED_DIVISOR));
    var mult = 1;
    if (opts.drawCount === 3) mult *= DRAW3_MULT;
    if (opts.boost) mult *= BOOST_MULT;
    if (opts.restarted) mult *= RESTART_MULT;
    var total = Math.round((BASE_COINS + speed) * mult);
    return { base: BASE_COINS, speed: speed, mult: mult, total: total };
  }

  function freeHints(profile) {
    return FREE_HINTS + (profile.upgrades.moreHints ? EXTRA_FREE_HINTS : 0);
  }

  function owns(profile, id) {
    var it = item(id);
    if (!it) return false;
    if (it.kind === "upgrade") return !!profile.upgrades[id];
    return profile.owned.indexOf(id) >= 0;
  }

  /* Why an item can't be bought right now, or null if it can. */
  function blocker(profile, id) {
    var it = item(id);
    if (!it) return "unknown";
    if (it.kind !== "consumable" && owns(profile, id)) return "owned";
    if (profile.coins < it.price) return "coins";
    return null;
  }

  /* Buys an item; returns true if it happened. Mutates the profile. */
  function buy(profile, id) {
    if (blocker(profile, id)) return false;
    var it = item(id);
    profile.coins -= it.price;
    if (it.kind === "consumable") {
      Object.keys(it.give).forEach(function (k) { profile[k] += it.give[k]; });
    } else if (it.kind === "upgrade") {
      profile.upgrades[id] = true;
    } else {
      profile.owned.push(id);
      if (it.kind === "back" || it.kind === "table") profile.equipped[it.kind] = id;
    }
    return true;
  }

  function equip(profile, id) {
    var it = item(id);
    if (!it || (it.kind !== "back" && it.kind !== "table") || !owns(profile, id)) return false;
    profile.equipped[it.kind] = id;
    return true;
  }

  function addCoins(profile, n) {
    profile.coins += n;
    profile.earned += n;
  }

  return {
    CATALOG: CATALOG,
    FREE_HINTS: FREE_HINTS,
    FAST_LIMIT_S: FAST_LIMIT_S,
    item: item,
    newProfile: newProfile,
    normalize: normalize,
    coinsForWin: coinsForWin,
    freeHints: freeHints,
    owns: owns,
    blocker: blocker,
    buy: buy,
    equip: equip,
    addCoins: addCoins
  };
});
