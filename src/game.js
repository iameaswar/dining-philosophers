// src/game.js — Durable Object holding the single shared game state for the
// whole class. Every phone + the projector connect to THIS SAME instance
// (we always look it up by the same fixed name, see index.js), so everyone
// sees the same table in real time.
//
// DELIBERATELY MINIMAL: this is only ever the "deadlock" state — no Waiter,
// no seat limits, no second act. The Waiter is 100% live theater (a real
// person tapping shoulders on stage) and never touches this code at all.
// Philosophers are labeled 1-5, Forks are labeled A-E.
// Nothing else on screen but a one-word state.

import { DurableObject } from "cloudflare:workers";

const FORK_LETTERS = ["A", "B", "C", "D", "E"];

function defaultState() {
  return {
    philosophers: [0, 1, 2, 3, 4].map(i => ({
      id: i,
      number: i + 1,
      state: "thinking",
      shot: false,
      dead: false,
      leftFork: i, rightFork: (i - 1 + 5) % 5,
      holding: [], attemptedSecond: false
    })),
    forks: FORK_LETTERS.map((letter, i) => ({ id: i, letter, lockedBy: null })),
    deadlocked: false
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

    switch (msg.action) {
      case "philPickup": this.philPickup(msg.philId, msg.side); break;
      case "philRelease": this.philRelease(msg.philId); break;
      case "philDropOne": this.philDropOne(msg.philId, msg.side); break;
      case "toggleShot": this.toggleShot(msg.philId); break;
      case "philKill": this.philKill(msg.philId); break;
      case "philRevive": this.philRevive(msg.philId); break;
      case "forceDeadlock": this.forceDeadlock(); break;
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

  // ---------------- Game logic — deadlock only, nothing else ----------------
  philPickup(philId, side) {
    const s = this.state;
    const p = s.philosophers[philId];
    const forkId = side === 'left' ? p.leftFork : p.rightFork;
    const fork = s.forks[forkId];
    if (fork.lockedBy !== null) {
      if (p.holding.length === 1) {
        p.state = "stuck";
        p.attemptedSecond = true;
        this.checkDeadlock();
      }
      return;
    }
    fork.lockedBy = philId;
    p.holding.push(forkId);
    if (p.holding.length === 1) p.state = "holding-one";
    if (p.holding.length === 2) p.state = "eating";
    this.checkDeadlock();
  }
  philRelease(philId) {
    const s = this.state;
    const p = s.philosophers[philId];
    p.holding.forEach(fid => { s.forks[fid].lockedBy = null; });
    p.holding = [];
    p.state = "thinking";
    p.attemptedSecond = false;
    s.deadlocked = false;
  }
  checkDeadlock() {
    const s = this.state;
    const allStuckAndTried = s.philosophers.every(p => p.holding.length === 1 && p.attemptedSecond);
    const anyoneEating = s.philosophers.some(p => p.holding.length === 2);
    if (allStuckAndTried && !anyoneEating) {
      s.deadlocked = true;
    }
  }
  // One tap -> jump straight to the full deadlock state.
  // Every philosopher holds their LEFT fork and has already failed
  // to get their right one. This is what five people pressing
  // buttons simultaneously would produce - but guaranteed, on cue.
  // put back a single fork (console toggle), leaving the other in hand
  philDropOne(philId, side) {
    const s = this.state;
    const p = s.philosophers[philId];
    const forkId = side === 'left' ? p.leftFork : p.rightFork;
    if (s.forks[forkId].lockedBy !== philId) return;
    s.forks[forkId].lockedBy = null;
    p.holding = p.holding.filter(f => f !== forkId);
    p.state = p.holding.length === 0 ? "thinking" : "holding-one";
    p.attemptedSecond = false;
    s.deadlocked = false;
  }

  // narrator-only: show a philosopher as dead. Purely for the shooting
  // beat -- drops whatever forks they were holding so the table can
  // keep working without them.
  philKill(philId) {
    const s = this.state;
    const p = s.philosophers[philId];
    p.holding.forEach(fid => { s.forks[fid].lockedBy = null; });
    p.holding = [];
    p.state = "thinking";
    p.attemptedSecond = false;
    p.dead = true;
    s.deadlocked = false;
  }

  philRevive(philId) {
    this.state.philosophers[philId].dead = false;
  }

  // narrator-only: flips one philosopher to a skeleton and back.
  // purely cosmetic - does not touch forks or the deadlock logic.
  toggleShot(philId) {
    const p = this.state.philosophers[philId];
    if (!p) return;
    p.shot = !p.shot;
  }

  forceDeadlock() {
    const s = this.state;
    s.forks.forEach(f => { f.lockedBy = null; });
    s.philosophers.filter(p => !p.dead).forEach(p => {
      p.holding = [p.leftFork];
      p.state = "stuck";
      p.attemptedSecond = true;
      s.forks[p.leftFork].lockedBy = p.id;
    });
    s.deadlocked = true;
  }

  resetAll() {
    this.state = defaultState();
  }
}
