// game.js — Integral Racing rules and state

const HR = {
  "Discontinuity": "Cont. Patch",
  "Asymptote": "L'Hôpital's",
  "Neg. Derivative": "Critical Point"
};
const HS = {
  "Discontinuity": "IVT",
  "Asymptote": "FTC",
  "Neg. Derivative": "MVT"
};
const HAZARDS = new Set(Object.keys(HR));
const REMEDIES = new Set(Object.values(HR));
const SAFETIES = new Set(Object.values(HS));

const TARGET = 2500;
const HAND_SIZE = 6;
const MAX_FREEZE = 3;

function buildDeck() {
  const d = [];
  const add = (c, n) => { for (let i = 0; i < n; i++) d.push(c); };
  // Adds (33)
  add("+2", 7); add("+3", 8); add("+4", 6); add("+5", 5); add("+t", 7);
  // Transforms (15)
  add("Add a t", 9); add("Square", 4); add("Cube", 2);
  // Group boosts (4)
  add("×2 Group", 3); add("×3 Group", 1);
  // Group attacks (13)
  add("÷2 Group", 2); add("Derive", 3); add("Flip Sign", 6); add("√ Group", 2);
  // Item attack (3)
  add("Halve Item", 3);
  // Hazards (9), Remedies (12), Safeties (3)
  add("Discontinuity", 3); add("Asymptote", 3); add("Neg. Derivative", 3);
  add("Cont. Patch", 4); add("L'Hôpital's", 4); add("Critical Point", 4);
  add("IVT", 1); add("FTC", 1); add("MVT", 1);
  return d;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const newItem = (coeff, power = 0) => ({ coeff, power });
const itemEv = (i, t) => i.power === 0 ? i.coeff : i.coeff * Math.pow(t, i.power);
const itemDeriv = (i) => i.power === 0 ? null : newItem(i.coeff * i.power, i.power - 1);
const itemSimple = (i) => i.power === 0 || (i.power === 1 && i.coeff === 1);
const itemLoneT = (i) => i.power === 1 && i.coeff === 1;
function itemStr(i) {
  if (i.power === 0) return String(i.coeff);
  const c = i.coeff === 1 ? "" : (i.coeff === -1 ? "-" : String(i.coeff));
  const v = i.power === 1 ? "t" : `t^${i.power}`;
  return c + v;
}

const newGroup = (items) => ({
  items: items.map(it => ({ ...it })),
  mult: 1, neg: false, halved: false, sqrtApplied: false
});
function groupEv(g, t) {
  let v = g.items.reduce((s, i) => s + itemEv(i, t), 0) * g.mult;
  if (g.halved) v = Math.floor(v / 2);
  if (g.sqrtApplied) v = v >= 0 ? Math.floor(Math.sqrt(v)) : -Math.floor(Math.sqrt(-v));
  if (g.neg) v = -v;
  return v;
}
function groupStr(g) {
  const inner = g.items.map(itemStr).join(" + ");
  const prefix = g.neg ? "−" : "";
  let base = g.mult !== 1 ? `${g.mult}(${inner})` : `(${inner})`;
  if (g.halved) base = `${base}/2`;
  if (g.sqrtApplied) base = `√${base}`;
  return prefix + base;
}

function newPlayer(id, name, seat) {
  return {
    id, name, seat,
    groups: [], ungrouped: [newItem(10)],
    dist: 0, hand: [],
    hazard: null, freezeTurns: 0,
    safeties: [], immune: [],
    handSize: 0, connected: true
  };
}
const playerEqStr = (p) => {
  const parts = [...p.groups.map(groupStr), ...p.ungrouped.map(itemStr)];
  return parts.join(" + ") || "0";
};
const playerEv = (p, t) =>
  p.groups.reduce((s, g) => s + groupEv(g, t), 0) +
  p.ungrouped.reduce((s, i) => s + itemEv(i, t), 0);

function addItemToPlayer(p, item) {
  p.ungrouped.push(item);
  if (p.ungrouped.length >= 4) {
    p.groups.push(newGroup(p.ungrouped.slice(0, 3)));
    p.ungrouped = p.ungrouped.slice(3);
  }
}

class Game {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = [];
    this.draw = [];
    this.discard = [];
    this.turn = 0;
    this.currentSeat = 0;
    this.started = false;
    this.winner = null;
    this.log = [];
    this.eventCounter = 0;
  }

  log_(type, text) {
    this.eventCounter++;
    this.log.push({ id: this.eventCounter, type, text, ts: Date.now() });
    if (this.log.length > 200) this.log = this.log.slice(-200);
  }

  addPlayer(socketId, name) {
    if (this.started) return { error: "Game already started" };
    if (this.players.length >= 4) return { error: "Room is full" };
    if (this.players.some(p => p.name === name)) return { error: "Name already taken" };
    const seat = this.players.length;
    const p = newPlayer(socketId, name, seat);
    this.players.push(p);
    this.log_("event", `${name} joined seat ${seat + 1}`);
    return { player: p };
  }

  removePlayer(socketId) {
    const p = this.players.find(x => x.id === socketId);
    if (!p) return;
    if (this.started) {
      p.connected = false;
      this.log_("event", `${p.name} disconnected`);
    } else {
      this.players = this.players.filter(x => x.id !== socketId);
      this.players.forEach((x, i) => x.seat = i);
      this.log_("event", `${p.name} left`);
    }
  }

  start() {
    if (this.started) return { error: "Already started" };
    if (this.players.length < 2) return { error: "Need at least 2 players" };
    this.started = true;
    this.draw = shuffle(buildDeck());
    for (const p of this.players) {
      while (p.hand.length < HAND_SIZE) {
        const c = this._drawCard();
        if (!c) break;
        p.hand.push(c);
      }
      p.handSize = p.hand.length;
    }
    this.turn = 1;
    this.currentSeat = 0;
    this.log_("turn", `── Turn 1 ──`);
    return { ok: true };
  }

  current() { return this.players[this.currentSeat]; }

  _removeFromHand(p, card) {
    const idx = p.hand.indexOf(card);
    if (idx >= 0) {
      p.hand.splice(idx, 1);
      if (!SAFETIES.has(card)) this.discard.push(card);
    }
    p.handSize = p.hand.length;
  }

  _drawCard() {
    if (this.draw.length === 0 && this.discard.length > 0) {
      this.draw = shuffle(this.discard);
      this.discard = [];
      this.log_("event", `🔄 Reshuffled discard pile (${this.draw.length} cards)`);
    }
    return this.draw.length > 0 ? this.draw.pop() : null;
  }

  applyMove(socketId, move) {
    if (this.winner) return { error: "Game is over" };
    const p = this.current();
    if (!p || p.id !== socketId) return { error: "Not your turn" };
    if (move.kind !== "skip" && !p.hand.includes(move.card)) return { error: "Card not in hand" };

    const k = move.kind;
    let r;
    if (k === "playAdd") r = this._add(p, move);
    else if (k === "playTransform") r = this._transform(p, move);
    else if (k === "playGroupBoost") r = this._groupBoost(p, move);
    else if (k === "playGroupAttack") r = this._groupAttack(p, move);
    else if (k === "playHalveItem") r = this._halveItem(p, move);
    else if (k === "playHazard") r = this._hazard(p, move);
    else if (k === "playRemedy") r = this._remedy(p, move);
    else if (k === "playSafety") r = this._safety(p, move);
    else if (k === "discard") r = this._discard(p, move);
    else if (k === "skip") { this.log_("event", `${p.name}: skips`); r = { ok: true }; }
    else return { error: "Unknown move" };

    if (r && r.error) return r;
    this._endTurn(p);
    return { ok: true };
  }

  _lookupItem(player, tgt) {
    if (!tgt) return null;
    if (tgt.loc === "u") return player.ungrouped[tgt.ii] || null;
    if (tgt.loc === "g") return player.groups[tgt.gi] ? (player.groups[tgt.gi].items[tgt.ii] || null) : null;
    return null;
  }

  _add(p, move) {
    if (p.hazard) return { error: "Frozen" };
    const c = move.card;
    if (!["+2","+3","+4","+5","+t"].includes(c)) return { error: "Not Add" };
    this._removeFromHand(p, c);
    const it = c === "+t" ? newItem(1, 1) : newItem(parseInt(c[1]));
    addItemToPlayer(p, it);
    this.log_("event", `${p.name}: ${c} → ${playerEqStr(p)}`);
    return { ok: true };
  }

  _transform(p, move) {
    if (p.hazard) return { error: "Frozen" };
    const c = move.card;
    if (!["Add a t","Square","Cube"].includes(c)) return { error: "Not Transform" };
    const item = this._lookupItem(p, move.target);
    if (!item) return { error: "Bad target" };
    if (c === "Add a t" && !itemSimple(item)) return { error: "Add a t: simple items only" };
    if (c === "Square" && !itemLoneT(item)) return { error: "Square: lone t only" };
    if (c === "Cube" && !itemLoneT(item)) return { error: "Cube: lone t only" };
    this._removeFromHand(p, c);
    let newIt;
    if (c === "Add a t") newIt = itemLoneT(item) ? newItem(1, 2) : newItem(item.coeff, 1);
    else if (c === "Square") newIt = newItem(1, 2);
    else newIt = newItem(1, 3);
    const old = itemStr(item);
    if (move.target.loc === "u") p.ungrouped[move.target.ii] = newIt;
    else p.groups[move.target.gi].items[move.target.ii] = newIt;
    this.log_("boost", `${p.name}: ${c} on ${old} → ${playerEqStr(p)}`);
    return { ok: true };
  }

  _groupBoost(p, move) {
    if (p.hazard) return { error: "Frozen" };
    const c = move.card;
    if (!["×2 Group","×3 Group"].includes(c)) return { error: "Not Boost" };
    const g = p.groups[move.gi];
    if (!g) return { error: "Bad group" };
    this._removeFromHand(p, c);
    g.mult *= (c.includes("×3") ? 3 : 2);
    this.log_("boost", `${p.name}: ${c} → ${groupStr(g)}`);
    return { ok: true };
  }

  _groupAttack(p, move) {
    const c = move.card;
    const tgt = this.players[move.targetSeat];
    if (!tgt) return { error: "Bad target seat" };
    const g = tgt.groups[move.gi];
    if (!g) return { error: "Bad group" };
    const isSelf = tgt.id === p.id;

    if (c === "Flip Sign" && isSelf) {
      if (!g.neg) return { error: "Group is not negated" };
      this._removeFromHand(p, c);
      g.neg = false;
      this.log_("boost", `${p.name}: self-flips group → ${groupStr(g)}`);
      const drawn = this._drawCard();
      if (drawn) p.hand.push(drawn);
      p.handSize = p.hand.length;
      return { ok: true };
    }

    if (p.hazard) return { error: "Frozen" };
    if (isSelf) return { error: "Cannot self-target" };
    this._removeFromHand(p, c);

    if (c === "Flip Sign" && tgt.hand.includes("Flip Sign")) {
      this._removeFromHand(tgt, "Flip Sign");
      const drawn = this._drawCard();
      if (drawn) tgt.hand.push(drawn);
      tgt.handSize = tgt.hand.length;
      this.log_("boost", `${p.name} flips ${tgt.name}'s group → COUNTERED!`);
    } else if (c === "Derive") {
      const old = groupStr(g);
      const newItems = g.items.map(itemDeriv).filter(x => x !== null);
      if (newItems.length === 0) {
        tgt.groups.splice(move.gi, 1);
        this.log_("attack", `${p.name}: derives ${tgt.name}'s ${old} → DESTROYED`);
      } else if (newItems.length === 1) {
        tgt.groups.splice(move.gi, 1);
        tgt.ungrouped.push(newItems[0]);
        this.log_("attack", `${p.name}: derives ${tgt.name}'s ${old} → ${itemStr(newItems[0])}`);
      } else {
        g.items = newItems;
        this.log_("attack", `${p.name}: derives ${tgt.name}'s ${old} → ${groupStr(g)}`);
      }
    } else if (c === "Flip Sign") {
      g.neg = !g.neg;
      this.log_("attack", `${p.name}: flips ${tgt.name}'s group → ${groupStr(g)}`);
    } else if (c === "√ Group") {
      g.sqrtApplied = true;
      this.log_("attack", `${p.name}: √ on ${tgt.name}'s group → ${groupStr(g)}`);
    } else if (c === "÷2 Group") {
      g.halved = true;
      this.log_("attack", `${p.name}: ÷2 on ${tgt.name}'s group → ${groupStr(g)}`);
    } else {
      return { error: "Unknown group attack" };
    }
    return { ok: true };
  }

  _halveItem(p, move) {
    if (p.hazard) return { error: "Frozen" };
    const tgt = this.players[move.targetSeat];
    if (!tgt || tgt.id === p.id) return { error: "Bad target" };
    const item = this._lookupItem(tgt, move.target);
    if (!item) return { error: "Bad item" };
    if (item.power !== 0) return { error: "Halve: plain numbers only" };
    this._removeFromHand(p, "Halve Item");
    const old = item.coeff;
    item.coeff = Math.floor(item.coeff / 2);
    this.log_("attack", `${p.name}: halves ${old} → ${item.coeff} on ${tgt.name}`);
    return { ok: true };
  }

  _hazard(p, move) {
    if (p.hazard) return { error: "Frozen" };
    const c = move.card;
    if (!HAZARDS.has(c)) return { error: "Not Hazard" };
    const tgt = this.players[move.targetSeat];
    if (!tgt || tgt.id === p.id) return { error: "Bad target" };
    if (tgt.hazard) return { error: "Already frozen" };
    if (tgt.immune.includes(c)) return { error: "Immune" };
    this._removeFromHand(p, c);
    const matchSafety = HS[c];
    if (tgt.hand.includes(matchSafety)) {
      this._removeFromHand(tgt, matchSafety);
      tgt.safeties.push(matchSafety);
      for (const [haz, saf] of Object.entries(HS)) {
        if (saf === matchSafety && !tgt.immune.includes(haz)) tgt.immune.push(haz);
      }
      const drawnCF = this._drawCard();
      if (drawnCF) tgt.hand.push(drawnCF);
      tgt.handSize = tgt.hand.length;
      this.log_("boost", `${p.name}: ${c} on ${tgt.name} → COUP FOURRÉ! ${matchSafety}!`);
    } else {
      tgt.hazard = c;
      tgt.freezeTurns = 0;
      this.log_("attack", `${p.name}: ${c} on ${tgt.name} → FROZEN`);
    }
    return { ok: true };
  }

  _remedy(p, move) {
    if (!p.hazard) return { error: "No hazard" };
    const c = move.card;
    if (!REMEDIES.has(c)) return { error: "Not Remedy" };
    if (HR[p.hazard] !== c) return { error: "Wrong remedy" };
    this._removeFromHand(p, c);
    this.log_("boost", `${p.name}: ${c} clears ${p.hazard}`);
    p.hazard = null; p.freezeTurns = 0;
    return { ok: true };
  }

  _safety(p, move) {
    const c = move.card;
    if (!SAFETIES.has(c)) return { error: "Not Safety" };
    this._removeFromHand(p, c);
    p.safeties.push(c);
    for (const [haz, saf] of Object.entries(HS)) {
      if (saf === c && !p.immune.includes(haz)) p.immune.push(haz);
    }
    if (p.hazard && HS[p.hazard] === c) {
      this.log_("boost", `${p.name}: SAFETY ${c} → clears + immunity!`);
      p.hazard = null; p.freezeTurns = 0;
    } else {
      this.log_("boost", `${p.name}: SAFETY ${c} → permanent immunity`);
    }
    return { ok: true };
  }

  _discard(p, move) {
    this._removeFromHand(p, move.card);
    this.log_("event", `${p.name}: discards ${move.card}`);
    return { ok: true };
  }

  _endTurn(p) {
    const t = this.turn;
    let wasFrozen = !!p.hazard;
    if (p.hazard) {
      p.freezeTurns++;
      if (p.freezeTurns >= MAX_FREEZE) {
        this.log_("event", `${p.name}: ${p.hazard} auto-clears (${MAX_FREEZE} turns)`);
        p.hazard = null; p.freezeTurns = 0;
      }
    }
    if (!wasFrozen) {
      const v = playerEv(p, t);
      const d = Math.max(0, v);
      p.dist += d;
      this.log_("event", `   v(${t})=${v}, +${d} → ${p.dist} mi`);
    } else {
      this.log_("event", `   FROZEN (${p.hazard ? p.freezeTurns : MAX_FREEZE}/${MAX_FREEZE}) → ${p.dist} mi`);
    }
    if (p.dist >= TARGET) {
      this.winner = { seat: p.seat, name: p.name, dist: p.dist };
      this.log_("win", `🏁 ${p.name} WINS with ${p.dist} mi on turn ${t}!`);
      return;
    }
    while (p.hand.length < HAND_SIZE) {
      const c = this._drawCard();
      if (!c) break;
      p.hand.push(c);
    }
    p.handSize = p.hand.length;

    let nextSeat = (this.currentSeat + 1) % this.players.length;
    if (nextSeat === 0) {
      this.turn++;
      this.log_("turn", `── Turn ${this.turn} ──`);
    }
    this.currentSeat = nextSeat;
  }

  snapshotFor(socketId) {
    return {
      roomId: this.roomId,
      started: this.started,
      turn: this.turn,
      currentSeat: this.currentSeat,
      target: TARGET,
      handSize: HAND_SIZE,
      maxFreeze: MAX_FREEZE,
      winner: this.winner,
      log: this.log.slice(-50),
      players: this.players.map(p => ({
        id: p.id, name: p.name, seat: p.seat,
        groups: p.groups, ungrouped: p.ungrouped,
        dist: p.dist, hazard: p.hazard, freezeTurns: p.freezeTurns,
        safeties: p.safeties, immune: p.immune,
        handSize: p.handSize, connected: p.connected,
        eqStr: playerEqStr(p),
        hand: p.id === socketId ? p.hand : null
      }))
    };
  }
}

module.exports = { Game };
