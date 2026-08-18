// src/index.js — Worker entry point.
// Static files (public/) are served automatically via the "assets" binding
// in wrangler.jsonc for any request this fetch handler doesn't explicitly
// handle itself (see run_worker_first note in wrangler.jsonc).
// This file only needs to intercept the one dynamic path: /ws

import { DiningPhilosophersRoom } from "./game.js";
export { DiningPhilosophersRoom };

// Every single connection -- every phone, the projector, everyone -- looks
// up the Durable Object using this exact same fixed name. That's what makes
// them all land on the SAME instance and see the SAME table live. This is
// intentional: it's one class party, one shared table, no rooms to pick.
const ROOM_NAME = "the-only-table";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const id = env.DINING_ROOM.idFromName(ROOM_NAME);
      const stub = env.DINING_ROOM.get(id);
      return stub.fetch(request);
    }

    // Anything else falls through to static asset serving, configured via
    // the "assets" binding in wrangler.jsonc.
    return env.ASSETS.fetch(request);
  }
};
