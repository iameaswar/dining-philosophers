// client.js — ONLY TWO ROUTES.
//
//   /table    -> the projector view. Philosophers shown by COLOUR.
//   /console  -> the operator's single control panel. She drives everything.
//
// No per-philosopher phones. No fork phones. No waiter. The operator
// clicks along with what she sees on stage, and has one big button to
// force the deadlock instantly.

const path = location.pathname.replace(/^\//, '') || 'table';
const app = document.getElementById('app');
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');

document.body.className = (path === 'table') ? 'stage-theme' : 'phone-theme';

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
    if(msg.type === 'state'){ state = msg.state; render(); }
  };
}
connect();

function send(action, extra){
  if(!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ action, ...extra }));
}

function render(){
  if(!state){ app.innerHTML = `<div class="role-screen"><p class="hint">Loading…</p></div>`; return; }
  if(path === 'console') return renderConsole();
  return renderTable();
}

// =====================================================
// CONSOLE  (operator only)
// =====================================================
function renderConsole(){
  const rows = state.philosophers.map(p => {
    const left  = state.forks[p.leftFork];
    const right = state.forks[p.rightFork];
    const hasLeft  = left.lockedBy === p.id;
    const hasRight = right.lockedBy === p.id;
    const canLeft  = left.lockedBy === null;
    const canRight = right.lockedBy === null;

    const label = p.state === "eating" ? "EATING"
                : p.state === "stuck"  ? "STUCK"
                : p.holding.length === 1 ? "HAS 1 FORK"
                : "thinking";

    return `
      <div class="crow" style="border-left:10px solid #${p.hex};">
        <div class="crow-head">
          <span class="cname" style="color:#${p.hex};">${p.colour}</span>
          <span class="cstate">${label}</span>
        </div>
        <div class="cbtns">
          <button class="cbtn ${hasLeft?'on':''}" ${(!canLeft && !hasLeft)?'disabled':''}
            onclick="send('${hasLeft?'philDropOne':'philPickup'}',{philId:${p.id},side:'left'})">
            ${left.letter}
          </button>
          <button class="cbtn ${hasRight?'on':''}" ${(!canRight && !hasRight)?'disabled':''}
            onclick="send('${hasRight?'philDropOne':'philPickup'}',{philId:${p.id},side:'right'})">
            ${right.letter}
          </button>
          <button class="cbtn drop" onclick="send('philRelease',{philId:${p.id}})">drop</button>
        </div>
      </div>`;
  }).join("");

  app.innerHTML = `
    <div class="console">
      <button class="big-red" onclick="send('forceDeadlock')">DEADLOCK</button>
      <button class="big-grey" onclick="send('resetAll')">RESET</button>
      ${rows}
    </div>
  `;
}

// =====================================================
// TABLE  (projector)
// =====================================================
function renderTable(){
  const CENTER = 50, SEAT_R = 42, FORK_R = 33;
  const seatAngle = i => (-90 + i * 72) * Math.PI / 180;
  const pointAt = (a, r) => ({
    top:  `${CENTER + r * Math.sin(a)}%`,
    left: `${CENTER + r * Math.cos(a)}%`
  });

  const seatPos = [0,1,2,3,4].map(i => pointAt(seatAngle(i), SEAT_R));

  function forkAngle(forkId){
    const l = state.philosophers.find(p => p.leftFork === forkId);
    const r = state.philosophers.find(p => p.rightFork === forkId);
    if(!l || !r) return 0;
    let a1 = seatAngle(l.id) * 180 / Math.PI;
    let a2 = seatAngle(r.id) * 180 / Math.PI;
    if (Math.abs(a2 - a1) > 180) { if (a2 > a1) a1 += 360; else a2 += 360; }
    return ((a1 + a2) / 2) * Math.PI / 180;
  }
  const forkPos = state.forks.map(f => pointAt(forkAngle(f.id), FORK_R));

  const seats = state.philosophers.map((p,i) => {
    const pos = seatPos[i];
    const icon  = p.state === "eating" ? "😋" : "🙂";
    const label = p.state === "eating" ? "eating"
                : p.state === "stuck"  ? "DEADLOCK!!!"
                : "thinking";
    return `<div class="seat ${p.state}" style="top:${pos.top}; left:${pos.left};
              transform:translate(-50%,-50%); border-color:#${p.hex};">
      <span class="seat-icon">${icon}</span>
      <span class="seat-name" style="color:#${p.hex};">${p.colour}</span>
      <span class="seat-state">${label}</span>
    </div>`;
  }).join("");

  const forks = state.forks.map((f,i) => {
    const pos = forkPos[i];
    const locked = f.lockedBy !== null;
    return `<div class="fork ${locked?'locked':'free'}" style="top:${pos.top}; left:${pos.left};
              transform:translate(-50%,-50%);">
      <span class="fork-emoji">🍴</span><span class="fork-label">${f.letter}</span>
    </div>`;
  }).join("");

  const centre = state.deadlocked ? "DEADLOCK!!!"
    : (state.philosophers.some(p => p.state === "eating") ? "eating" : "thinking");
  const centreClass = state.deadlocked ? "deadlocked"
    : (state.philosophers.some(p => p.state === "eating") ? "eating" : "");

  app.innerHTML = `
    <div class="stage">
      <div class="table-wrap ${state.deadlocked?'deadlocked':''}">
        <div class="table-center ${centreClass}"><div class="tc-value">${centre}</div></div>
        ${seats}
        ${forks}
      </div>
    </div>
  `;
}
