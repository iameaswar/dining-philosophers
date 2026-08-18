// client.js — role is fixed entirely by the URL path. No picker, no choice.
// /stage -> projector view (white bg)
// /phil0..phil4 -> philosopher control screens
// /fork0..fork4 -> fork status screens
// /waiter -> waiter control screen
//

const path = location.pathname.replace(/^\//, '') || 'stage';
const app = document.getElementById('app');
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');

document.body.className = (path === 'stage') ? 'stage-theme' : 'phone-theme';

let state = null;
let names = null; // { PHIL_NAMES, FORK_NAMES, WAITER_NAME }
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
      if(msg.names) names = msg.names;
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
  if(path === 'waiter') return renderWaiter();
  if(path === 'narrator') return renderNarrator();
  app.innerHTML = `<div class="role-screen"><p class="hint">Unknown role path: ${path}</p></div>`;
}

// ---------------- PHILOSOPHER ----------------
function renderPhilosopher(id){
  const p = state.philosophers[id];
  const act = state.act;
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
  let stateLabel = {
    "thinking":"Thinking", "hungry":"Waiting for a seat", "holding-one":"Holding one fork…",
    "eating":"Eating!", "stuck":"STUCK — deadlocked", "waiting-room":"In the waiting room"
  }[p.state] || p.state;

  let body = "";
  if(act === 1){
    const canPickLeft = leftFork.lockedBy === null && !p.holding.includes(p.leftFork);
    const canPickRight = rightFork.lockedBy === null && !p.holding.includes(p.rightFork);
    body = `
      <div class="status-card">
        <div class="state-label">Your state</div>
        <div class="state-value">${stateLabel}</div>
      </div>
      <div class="fork-pair">
        <div class="fork-slot ${forkClass(leftFork)}">
          <div class="fork-name">Left · ${leftFork.name}</div>
          <span class="fork-icon">${forkIcon(leftFork)}</span>
        </div>
        <div class="fork-slot ${forkClass(rightFork)}">
          <div class="fork-name">Right · ${rightFork.name}</div>
          <span class="fork-icon">${forkIcon(rightFork)}</span>
        </div>
      </div>
      <button class="big-btn pickup" ${!canPickLeft?'disabled':''} onclick="send('philPickup',{philId:${id},side:'left'})">Pick up left fork</button>
      <button class="big-btn pickup" ${!canPickRight?'disabled':''} onclick="send('philPickup',{philId:${id},side:'right'})">Pick up right fork</button>
      <button class="big-btn release" onclick="send('philRelease',{philId:${id}})">Set down forks</button>
      <p class="hint">Wait for the Narrator's cue before pressing. This is <b>scripted</b> — everyone reaches for their left fork together first.</p>
    `;
  } else {
    if(!p.seated && p.state !== "hungry" && p.state !== "waiting-room"){
      body = `
        <div class="status-card"><div class="state-label">Your state</div><div class="state-value">Standing by</div></div>
        <button class="big-btn request" onclick="send('requestSeat',{philId:${id}})">Ask Waiter for a seat</button>
        <p class="hint">In Act II, the Waiter only lets <b>4 of 5</b> sit at once. This breaks the deadlock.</p>
      `;
    } else if(!p.seated){
      body = `
        <div class="status-card"><div class="state-label">Your state</div><div class="state-value">${stateLabel}</div></div>
        <p class="hint">Waiting on the Waiter's phone to approve you. Stay ready.</p>
      `;
    } else {
      const canPickLeft = leftFork.lockedBy === null && !p.holding.includes(p.leftFork);
      const canPickRight = rightFork.lockedBy === null && !p.holding.includes(p.rightFork);
      const bothHeld = p.holding.length === 2;
      body = `
        <div class="status-card"><div class="state-label">Your state</div><div class="state-value">${stateLabel}</div></div>
        <div class="fork-pair">
          <div class="fork-slot ${forkClass(leftFork)}"><div class="fork-name">Left · ${leftFork.name}</div><span class="fork-icon">${forkIcon(leftFork)}</span></div>
          <div class="fork-slot ${forkClass(rightFork)}"><div class="fork-name">Right · ${rightFork.name}</div><span class="fork-icon">${forkIcon(rightFork)}</span></div>
        </div>
        <button class="big-btn pickup" ${!canPickLeft?'disabled':''} onclick="send('philPickupAct2',{philId:${id},side:'left'})">Pick up left fork</button>
        <button class="big-btn pickup" ${!canPickRight?'disabled':''} onclick="send('philPickupAct2',{philId:${id},side:'right'})">Pick up right fork</button>
        ${bothHeld ? `<button class="big-btn eat" onclick="send('philDoneEating',{philId:${id}})">Finish eating &amp; leave table</button>` : ''}
      `;
    }
  }

  app.innerHTML = `
    <div class="role-screen">
      <div class="role-header">
        <div class="who serif">${p.name}</div>
        <div class="badge ${act===1?'act1':'act2'}">Act ${act}</div>
      </div>
      ${body}
      <div class="spacer"></div>
      <p class="hint" style="opacity:0.5">Philosopher · Left = ${leftFork.name}'s fork · Right = ${rightFork.name}'s fork</p>
    </div>
  `;
}

// ---------------- FORK ----------------
function renderFork(id){
  const fork = state.forks[id];
  const heldBy = fork.lockedBy !== null ? state.philosophers[fork.lockedBy] : null;
  const leftOwner = state.philosophers.find(p=>p.rightFork===id);
  const rightOwner = state.philosophers.find(p=>p.leftFork===id);

  app.innerHTML = `
    <div class="role-screen">
      <div class="role-header">
        <div class="who serif">${fork.name}</div>
        <div class="badge ${state.act===1?'act1':'act2'}">Act ${state.act}</div>
      </div>
      <div class="status-card" style="padding:36px 20px;">
        <div class="state-label">Status</div>
        <div class="state-value" style="font-size:34px; color:${heldBy? '#E8A33D':'#5C8A5C'};">
          ${heldBy? '🔒 LOCKED' : '🟢 FREE'}
        </div>
        ${heldBy ? `<p class="hint" style="margin-top:14px;">Held by <b>${heldBy.name}</b></p>` : `<p class="hint" style="margin-top:14px;">Anyone can pick this up</p>`}
      </div>
      <div class="spacer"></div>
      <p class="hint">You sit between <b>${leftOwner?leftOwner.name:'—'}</b> and <b>${rightOwner?rightOwner.name:'—'}</b>. No buttons — hold your phone up so the room sees your status. Raise it high when you go LOCKED.</p>
    </div>
  `;
}

// ---------------- WAITER ----------------
function renderWaiter(){
  const queue = state.waiterQueue.map(q=>{
    const p = state.philosophers[q.philId];
    return `<div class="queue-item">
      <div><div class="name">${p.name}</div><div class="req">wants a seat</div></div>
      <div class="queue-btns">
        <button class="mini-btn approve" onclick="send('waiterApprove',{philId:${q.philId}})">Seat</button>
        <button class="mini-btn deny" onclick="send('waiterDeny',{philId:${q.philId}})">Hold</button>
      </div>
    </div>`;
  }).join("") || `<p class="hint">No one waiting right now.</p>`;

  const seatPills = state.philosophers.map(p=>{
    let cls = "empty", label = "—";
    if(p.seated){ cls="seated"; label = p.name; }
    else if(state.waiterQueue.find(q=>q.philId===p.id)){ cls="waiting"; label = p.name; }
    return `<div class="seat-pill ${cls}">${label}</div>`;
  }).join("");

  app.innerHTML = `
    <div class="role-screen">
      <div class="role-header">
        <div class="who serif">The Waiter</div>
        <div class="badge ${state.act===1?'act1':'act2'}">Act ${state.act}</div>
      </div>
      ${state.act===1 ? `
        <div class="status-card"><div class="state-label">Not active yet</div><div class="state-value" style="font-size:18px;">You take the floor in Act II — after the deadlock lands.</div></div>
      ` : `
        <div class="status-card"><div class="state-label">Seats filled</div><div class="state-value">${state.seatedCount} / 4</div></div>
        <div><p class="hint" style="text-align:left; margin-bottom:8px;"><b>Requests</b></p>${queue}</div>
        <div><p class="hint" style="text-align:left; margin-bottom:6px;"><b>Table</b></p><div class="seats-mini">${seatPills}</div></div>
        <p class="hint">Rule: never seat a 5th philosopher. Capping at 4 guarantees someone always has both forks free.</p>
      `}
    </div>
  `;
}

// ---------------- NARRATOR (host controls) ----------------
function renderNarrator(){
  app.innerHTML = `
    <div class="role-screen">
      <div class="role-header">
        <div class="who serif">Host Controls</div>
        <div class="badge ${state.act===1?'act1':'act2'}">Act ${state.act}</div>
      </div>
      <div class="status-card">
        <div class="state-label">Live log</div>
        <div class="state-value" style="font-size:16px;">${state.log}</div>
      </div>
      <button class="big-btn pickup" onclick="send('forceDeadlockReset')">Reset table (redo Act I)</button>
      ${state.act===1 ? `<button class="big-btn eat" onclick="send('goToAct2')">Advance to Act II →</button>` : ''}
      <button class="big-btn release" onclick="send('resetAll')">Full reset (new run)</button>
      <div class="spacer"></div>
      <p class="hint">This is YOUR phone — separate from the projector at <b>/stage</b>. Use this to peek at state without the audience seeing your screen.</p>
      <div style="margin-top:10px;">
        <p class="hint" style="text-align:left;"><b>Quick state</b></p>
        <div class="seats-mini">
          ${state.philosophers.map(p=>`<div class="seat-pill ${p.state==='eating'?'seated':(p.state==='stuck'?'waiting':'empty')}">${p.name.slice(0,6)}</div>`).join("")}
        </div>
      </div>
    </div>
  `;
}

// ---------------- STAGE / PROJECTOR ----------------
function renderStage(){
  // Seats are placed at 5 fixed points around a circle. Forks are NOT a
  // separate hardcoded list -- each fork sits at the ANGULAR MIDPOINT
  // between the two seats it belongs to (fork i is shared by philosopher i's
  // right hand and philosopher (i+1)%5's left hand, matching leftFork/
  // rightFork in game.js). Deriving position from the seat angles instead of
  // hand-placing two separate arrays is what guarantees a fork always
  // visually sits next to the correct two philosophers.
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

  // Fork i sits between seat i and seat (i+1)%5 -- the midpoint angle,
  // taking the shorter way around so fork 4 (between seat 4 and seat 0)
  // doesn't wrap the long way round the circle.
  function forkAngleDeg(i){
    const a1 = seatAngleDeg(i);
    let a2 = seatAngleDeg((i + 1) % 5);
    if (a2 < a1) a2 += 360; // unwrap so the midpoint is the short arc
    return (a1 + a2) / 2;
  }
  const forkPositions = [0,1,2,3,4].map(i => pointAt(forkAngleDeg(i), FORK_RADIUS));

  const seatEls = state.philosophers.map((p,i)=>{
    const pos = seatPositions[i];
    let cls = p.state;
    if(state.act===2 && !p.seated){
      cls = state.waiterQueue.find(q=>q.philId===p.id) ? "hungry" : "waiting-room";
    }
    let icon = "🙂";
    if(p.state==="eating") icon="😋";
    else if(p.state==="stuck") icon="😵";
    else if(p.state==="holding-one") icon="🤔";
    else if(p.state==="waiting-room") icon="⏳";
    return `<div class="seat ${cls}" style="top:${pos.top}; left:${pos.left}; transform:translate(-50%,-50%);">
      <span class="seat-icon">${icon}</span>
      <span class="seat-name">${p.name}</span>
      <span class="seat-state">${p.state.replace('-',' ')}</span>
    </div>`;
  }).join("");

  const forkEls = state.forks.map((f,i)=>{
    const pos = forkPositions[i];
    const locked = f.lockedBy !== null;
    return `<div class="fork ${locked?'locked':'free'}" style="top:${pos.top}; left:${pos.left}; transform:translate(-50%,-50%);">
      <span class="fork-emoji">🍴</span><span class="fork-label">${f.name}</span>
    </div>`;
  }).join("");

  const centerLabel = state.deadlocked ? "DEADLOCK" : (state.act===2 && state.philosophers.some(p=>p.state==="eating") ? "RESOLVED" : (state.act===1 ? "Act I — No Rules" : "Act II — The Waiter"));
  const centerValue = state.deadlocked
    ? "Every seat holds one fork. No one can eat."
    : (state.act===2 ? `${state.seatedCount}/4 seated` : "Watch what happens when 5 reach at once.");
  const centerClass = state.deadlocked ? "deadlocked" : (state.philosophers.some(p=>p.state==="eating") ? "eating" : "");

  app.innerHTML = `
    <div class="stage">
      <div class="stage-header">
        <div class="stage-title"><span class="dot">●</span> The Dining Philosophers</div>
        <div class="stage-badge ${state.deadlocked?'deadlock':(state.act===1?'':'act2')}">${state.deadlocked?'DEADLOCK':'Act '+state.act}</div>
      </div>
      <div class="table-wrap ${state.deadlocked?'deadlocked':''}">
        <div class="table-center ${centerClass}">
          <div class="tc-label">${centerLabel}</div>
          <div class="tc-value">${centerValue}</div>
        </div>
        ${seatEls}
        ${forkEls}
      </div>
      <div class="stage-footer"><div class="log-line">${state.log}</div></div>
    </div>
  `;
}
