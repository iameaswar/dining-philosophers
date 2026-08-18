// src/game.js — Durable Object holding the single shared game state for the
// whole class. Every phone + the projector connect to THIS SAME instance
// (we always look it up by the same fixed name, see index.js), so everyone
// sees the same table in real time.

import { DurableObject } from "cloudflare:workers";

// ---------------------------------------------------------------------
// EDIT NAMES HERE — the only place you need to hardcode names.
// Keep exactly 5 philosopher names and 5 fork names, in seat order
// (clockwise around the table, seat 0 first).
// ---------------------------------------------------------------------
const PHIL_NAMES = ["Person 1", "Person 2", "Person 3", "Person 4", "Person 5"];
const FORK_NAMES = ["Person 6", "Person 7", "Person 8", "Person 9", "Person 10"];
const WAITER_NAME = "Person 11";
// ---------------------------------------------------------------------

function defaultState() {
  return {
    act: 1,
    philosophers: PHIL_NAMES.map((name, i) => ({
      id: i, name, state: "thinking",
      leftFork: i, rightFork: (i - 1 + 5) % 5,
      holding: [], seated: true, attemptedSecond: false
    })),
    forks: FORK_NAMES.map((name, i) => ({ id: i, name, lockedBy: null })),
    waiterQueue: [],
    seatedCount: 5,
    deadlocked: false,
    log: "Waiting for the feast to begin…"
  };
}

export class DiningPhilosophersRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.state = null; // lazy-loaded from storage on first use
  }

  async ensureState() {
    if (this.state) return this.state;
    const stored = await this.ctx.storage.get("gameState");
    this.state = stored || defaultState();
    return this.state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Hibernation-aware accept -- lets the Durable Object sleep between
      // messages instead of staying billed/active the whole 30 minutes.
      this.ctx.acceptWebSocket(server);

      await this.ensureState();
      server.send(JSON.stringify({ type: "state", state: this.state }));

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws, message) {
    let msg;
    try { msg = JSON.parse(message); } catch (e) { return; }

    await this.ensureState();
    const s = this.state;

    switch (msg.action) {
      case "philPickup": this.philPickup(msg.philId, msg.side); break;
      case "philRelease": this.philRelease(msg.philId); break;
      case "forceDeadlockReset": this.forceDeadlockReset(); break;
      case "goToAct2": this.goToAct2(); break;
      case "requestSeat": this.requestSeat(msg.philId); break;
      case "waiterApprove": this.waiterApprove(msg.philId); break;
      case "waiterDeny": this.waiterDeny(msg.philId); break;
      case "philPickupAct2": this.philPickupAct2(msg.philId, msg.side); break;
      case "philDoneEating": this.philDoneEating(msg.philId); break;
      case "resetAll": this.resetAll(); break;
      default: return;
    }

    await this.ctx.storage.put("gameState", this.state);
    this.broadcast();
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code, reason); } catch (e) { /* already closing */ }
  }

  async webSocketError(ws, error) {
    // Swallow -- hibernation will naturally drop and the client's own
    // reconnect logic (see client.js) handles recovery.
  }

  broadcast() {
    const payload = JSON.stringify({ type: "state", state: this.state });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch (e) { /* socket gone, ignore */ }
    }
  }

  // ---------------- Game logic (identical rules throughout all versions) ----------------
  philPickup(philId, side) {
    const s = this.state;
    const p = s.philosophers[philId];
    const forkId = side === 'left' ? p.leftFork : p.rightFork;
    const fork = s.forks[forkId];
    if (fork.lockedBy !== null) {
      if (p.holding.length === 1) {
        p.state = "stuck";
        p.attemptedSecond = true;
        s.log = `${p.name} reaches for their other fork — already taken.`;
        this.checkDeadlock();
      }
      return;
    }
    fork.lockedBy = philId;
    p.holding.push(forkId);
    if (p.holding.length === 1) p.state = "holding-one";
    if (p.holding.length === 2) p.state = "eating";
    s.log = `${p.name} picks up ${fork.name}'s fork.`;
    this.checkDeadlock();
  }
  philRelease(philId) {
    const s = this.state;
    const p = s.philosophers[philId];
    p.holding.forEach(fid => { s.forks[fid].lockedBy = null; });
    p.holding = [];
    p.state = "thinking";
    p.attemptedSecond = false;
    s.log = `${p.name} sets down both forks.`;
    s.deadlocked = false;
  }
  checkDeadlock() {
    const s = this.state;
    const allStuckAndTried = s.philosophers.every(p => p.holding.length === 1 && p.attemptedSecond);
    const anyoneEating = s.philosophers.some(p => p.holding.length === 2);
    if (allStuckAndTried && !anyoneEating) {
      s.deadlocked = true;
      s.log = "DEADLOCK — every philosopher holds one fork and can't get the other. No one can eat.";
    }
  }
  forceDeadlockReset() {
    const s = this.state;
    s.philosophers.forEach(p => { p.state = "thinking"; p.holding = []; p.attemptedSecond = false; });
    s.forks.forEach(f => { f.lockedBy = null; });
    s.deadlocked = false;
    s.log = "Table reset. Act 1 ready to run again.";
  }
  goToAct2() {
    const s = this.state;
    s.act = 2;
    s.philosophers.forEach(p => { p.state = "thinking"; p.holding = []; p.seated = false; p.attemptedSecond = false; });
    s.forks.forEach(f => { f.lockedBy = null; });
    s.waiterQueue = [];
    s.seatedCount = 0;
    s.deadlocked = false;
    s.log = "The Waiter takes the floor. Act II begins.";
  }
  requestSeat(philId) {
    const s = this.state;
    const p = s.philosophers[philId];
    if (p.seated) return;
    if (s.waiterQueue.find(q => q.philId === philId)) return;
    s.waiterQueue.push({ philId });
    p.state = "hungry";
    s.log = `${p.name} asks the Waiter for a seat.`;
  }
  waiterApprove(philId) {
    const s = this.state;
    if (s.seatedCount >= 4) { s.log = "Table full — Waiter holds the line."; return; }
    const p = s.philosophers[philId];
    p.seated = true;
    p.state = "thinking";
    s.seatedCount += 1;
    s.waiterQueue = s.waiterQueue.filter(q => q.philId !== philId);
    s.log = `Waiter seats ${p.name}. (${s.seatedCount}/4 seats filled)`;
  }
  waiterDeny(philId) {
    const s = this.state;
    const p = s.philosophers[philId];
    s.waiterQueue = s.waiterQueue.filter(q => q.philId !== philId);
    p.state = "waiting-room";
    s.log = `Waiter asks ${p.name} to wait.`;
  }
  philPickupAct2(philId, side) {
    const s = this.state;
    const p = s.philosophers[philId];
    if (!p.seated) return;
    const forkId = side === 'left' ? p.leftFork : p.rightFork;
    const fork = s.forks[forkId];
    if (fork.lockedBy !== null) return;
    fork.lockedBy = philId;
    p.holding.push(forkId);
    if (p.holding.length === 1) p.state = "holding-one";
    if (p.holding.length === 2) {
      p.state = "eating";
      s.log = `${p.name} is eating! The system resolves.`;
    } else {
      s.log = `${p.name} picks up ${fork.name}'s fork.`;
    }
  }
  philDoneEating(philId) {
    const s = this.state;
    const p = s.philosophers[philId];
    p.holding.forEach(fid => s.forks[fid].lockedBy = null);
    p.holding = [];
    p.seated = false;
    p.state = "thinking";
    s.seatedCount -= 1;
    s.log = `${p.name} finishes and leaves the table. A seat opens.`;
  }
  resetAll() {
    this.state = defaultState();
  }
}
