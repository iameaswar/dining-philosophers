// client.js — role is fixed entirely by the URL path. No picker, no choice.
// /stage -> projector view (white bg)
// /phil0..phil4 -> philosopher control screens (labeled 1-5 on screen)
// /fork0..fork4 -> fork status screens (labeled A-E on screen)
//
// DELIBERATELY MINIMAL: no Waiter, no Narrator, no second act, no explanatory
// text anywhere. Every label on screen is a single bare word — "thinking",
// "eating", "DEADLOCK!!!" — nothing more. The Waiter is 100% live theater and
// has no route or state here at all.

const path = location.pathname.replace(/^\//, '') || 'stage';
const app = document.getElementById('app');
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');

document.body.className = (path === 'stage') ? 'stage-theme' : 'phone-theme';

let state = null;
let ws = null;
let reconnectTimer = null;

function connect(){
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen = () => {
    connDot.className = 'conn-dot ok';
    connText.textContent = 'connected';
    if(reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer = null; }
  };
  ws.onclose = () => {
    connDot.className = 'conn-dot bad';
    connText.textContent = 'reconnecting…';
    reconnectTimer = setTimeout(connect, 1000);
  };
  ws.onerror = () => { ws.close(); };
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if(msg.type === 'state'){
      state = msg.state;
      render();
    }
  };
}
connect();

function send(action, extra){
  if(!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ action, ...extra }));
}

// ---------------- RENDER ROUTER ----------------
function render(){
  if(!state){ app.innerHTML = `<div class="role-screen"><p class="hint">Loading…</p></div>`; return; }
  if(path === 'stage') return renderStage();
  if(path.startsWith('phil')) return renderPhilosopher(parseInt(path.replace('phil','')));
  if(path.startsWith('fork')) return renderFork(parseInt(path.replace('fork','')));
  app.innerHTML = `<div class="role-screen"><p class="hint">Unknown role path: ${path}</p></div>`;
}

// ---------------- PHILOSOPHER ----------------
function renderPhilosopher(id){
  const p = state.philosophers[id];
  const leftFork = state.forks[p.leftFork];
  const rightFork = state.forks[p.rightFork];

  function forkClass(fork){
    if(fork.lockedBy === null) return "free";
    if(fork.lockedBy === id) return "locked-mine";
    return "locked-other";
  }
  function forkIcon(fork){
    if(fork.lockedBy === null) return "🍴";
    if(fork.lockedBy === id) return "✋";
    return "🔒";
  }

  // Bare state word only -- no sentences, no explanation.
  let stateLabel = {
    "thinking": "thinking",
    "holding-one": "thinking",
    "eating": "eating",
    "stuck": "DEADLOCK!!!"
  }[p.state] || p.state;

  const canPickLeft = leftFork.lockedBy === null && !p.holding.includes(p.leftFork);
  const canPickRight = rightFork.lockedBy === null && !p.holding.includes(p.rightFork);

  const body = `
    <div class="status-card">
      <div class="state-value">${stateLabel}</div>
    </div>
    <div class="fork-pair">
      <div class="fork-slot ${forkClass(leftFork)}">
        <div class="fork-name">Left · ${leftFork.letter}</div>
        <span class="fork-icon">${forkIcon(leftFork)}</span>
      </div>
      <div class="fork-slot ${forkClass(rightFork)}">
        <div class="fork-name">Right · ${rightFork.letter}</div>
        <span class="fork-icon">${forkIcon(rightFork)}</span>
      </div>
    </div>
    <button class="big-btn pickup" ${!canPickLeft?'disabled':''} onclick="send('philPickup',{philId:${id},side:'left'})">Pick up left fork</button>
    <button class="big-btn pickup" ${!canPickRight?'disabled':''} onclick="send('philPickup',{philId:${id},side:'right'})">Pick up right fork</button>
    <button class="big-btn release" onclick="send('philRelease',{philId:${id}})">Set down forks</button>
  `;

  app.innerHTML = `
    <div class="role-screen">
      <div class="role-header">
        <div class="who serif">${p.number}</div>
      </div>
      ${body}
      <div class="spacer"></div>
    </div>
  `;
}

// ---------------- FORK ----------------
function renderFork(id){
  const fork = state.forks[id];
  const heldBy = fork.lockedBy !== null ? state.philosophers[fork.lockedBy] : null;

  // Which of THIS fork's two neighbors currently holds it, if any.
  //
  // IMPORTANT -- this is NOT the same lookup as the stage view's leftOwner/
  // rightOwner (used only for symmetric angle math, where calling either
  // neighbor "left" or "right" makes no visual difference either way). Here
  // the label gets shown to a real person as the literal word LEFT or RIGHT,
  // so it has to be correct, not just symmetric. Verified directly against
  // the stage standing order (PHIL1-FORK_A-PHIL2-...): the philosopher who
  // calls this fork their OWN leftFork is the one physically standing on
  // this fork's audience-LEFT side, and vice versa. Confirmed by tracing
  // all 5 forks against both of their legitimate owners before shipping.
  const leftNeighbor = state.philosophers.find(p => p.leftFork === id);
  const rightNeighbor = state.philosophers.find(p => p.rightFork === id);

  let sideWord = "FREE";
  let sideColor = "#5C8A5C"; // green
  if (heldBy) {
    if (leftNeighbor && heldBy.id === leftNeighbor.id) { sideWord = "LEFT"; sideColor = "#E8A33D"; }
    else if (rightNeighbor && heldBy.id === rightNeighbor.id) { sideWord = "RIGHT"; sideColor = "#E8A33D"; }
  }

  app.innerHTML = `
    <div class="role-screen">
      <div class="role-header">
        <div class="who serif">${fork.letter}</div>
      </div>
      <div class="status-card" style="padding:36px 20px;">
        <div class="state-value" style="font-size:56px; font-weight:900; color:${sideColor};">
          ${sideWord}
        </div>
        <div class="state-value" style="font-size:34px; margin-top:8px;">
          ${heldBy? '🔒' : '🟢'}
        </div>
      </div>
      <div class="spacer"></div>
    </div>
  `;
}

// ---------------- STAGE / PROJECTOR ----------------
function renderStage(){
  // Seat/fork geometry. Fork positions are NOT computed from fork index
  // rotation independently of the game rules -- each fork's position is
  // derived directly from the SAME leftFork/rightFork data the game logic
  // uses to decide who can pick it up. One source of truth for adjacency.
  const CENTER = 50; // percent
  const SEAT_RADIUS = 42; // percent, distance of seats from center
  const FORK_RADIUS = 33; // percent, forks sit closer in, between seats

  // Seat 0 at top (-90deg), then clockwise every 72deg.
  function seatAngleDeg(i){ return -90 + i * 72; }

  function pointAt(angleDeg, radius){
    const rad = (angleDeg * Math.PI) / 180;
    return {
      top: `${CENTER + radius * Math.sin(rad)}%`,
      left: `${CENTER + radius * Math.cos(rad)}%`
    };
  }

  const seatPositions = [0,1,2,3,4].map(i => pointAt(seatAngleDeg(i), SEAT_RADIUS));

  function forkAngleDeg(forkId){
    const leftOwner = state.philosophers.find(p => p.rightFork === forkId);
    const rightOwner = state.philosophers.find(p => p.leftFork === forkId);
    if (!leftOwner || !rightOwner) return 0;
    let a1 = seatAngleDeg(leftOwner.id);
    let a2 = seatAngleDeg(rightOwner.id);
    if (Math.abs(a2 - a1) > 180) {
      if (a2 > a1) a1 += 360; else a2 += 360;
    }
    return (a1 + a2) / 2;
  }
  const forkPositions = state.forks.map(f => pointAt(forkAngleDeg(f.id), FORK_RADIUS));

  const seatEls = state.philosophers.map((p,i)=>{
    const pos = seatPositions[i];
    // Only two faces exist: thinking-ish (🙂) and eating (😋). "stuck" still
    // gets its own border/glow treatment via CSS class, but the FACE stays
    // 🙂 -- no third expression, per the "only smiley + eating smiley" rule.
    let icon = p.state === "eating" ? "😋" : "🙂";
    // Bare word only under the seat -- "thinking", "eating", "DEADLOCK!!!"
    let label = p.state === "eating" ? "eating"
      : p.state === "stuck" ? "DEADLOCK!!!"
      : "thinking";
    return `<div class="seat ${p.state}" style="top:${pos.top}; left:${pos.left}; transform:translate(-50%,-50%);">
      <span class="seat-icon">${icon}</span>
      <span class="seat-name">${p.number}</span>
      <span class="seat-state">${label}</span>
    </div>`;
  }).join("");

  const forkEls = state.forks.map((f,i)=>{
    const pos = forkPositions[i];
    const locked = f.lockedBy !== null;
    return `<div class="fork ${locked?'locked':'free'}" style="top:${pos.top}; left:${pos.left}; transform:translate(-50%,-50%);">
      <span class="fork-emoji">🍴</span><span class="fork-label">${f.letter}</span>
    </div>`;
  }).join("");

  // Center of the table: bare word only. Nothing else.
  const centerWord = state.deadlocked ? "DEADLOCK!!!" : (state.philosophers.some(p=>p.state==="eating") ? "eating" : "thinking");
  const centerClass = state.deadlocked ? "deadlocked" : (state.philosophers.some(p=>p.state==="eating") ? "eating" : "");

  app.innerHTML = `
    <div class="stage">
      <div class="table-wrap ${state.deadlocked?'deadlocked':''}">
        <div class="table-center ${centerClass}">
          <div class="tc-value">${centerWord}</div>
        </div>
        ${seatEls}
        ${forkEls}
      </div>
    </div>
  `;
}
