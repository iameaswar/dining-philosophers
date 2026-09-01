// client.js
//
//   /table            -> the projector view (pentagon, point facing down)
//   /phil0 .. /phil4  -> one phone per philosopher, sits on the table
//   /shoot            -> narrator only. Toggles the TOP-LEFT philosopher
//                        (seat 4) to a skeleton and back.
//
// No console. No operator control. Each philosopher taps their own forks,
// and any one of them can hit DEADLOCK to trigger it for the whole table.

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
  if(path === 'shoot') return renderShoot();
  if(path.startsWith('phil')) return renderPhil(parseInt(path.replace('phil','')));
  return renderTable();
}

// =====================================================
// PHILOSOPHER PHONE
// =====================================================
function renderPhil(id){
  const p = state.philosophers[id];
  if(!p){ app.innerHTML = `<div class="role-screen"><p class="hint">Unknown: ${path}</p></div>`; return; }

  const left  = state.forks[p.leftFork];
  const right = state.forks[p.rightFork];
  const hasLeft  = left.lockedBy === p.id;
  const hasRight = right.lockedBy === p.id;
  const canLeft  = left.lockedBy === null;
  const canRight = right.lockedBy === null;

  const label = p.state === "eating" ? "EATING"
              : p.state === "stuck"  ? "DEADLOCK"
              : p.holding.length === 1 ? "HOLDING ONE"
              : "thinking";

  app.innerHTML = `
    <div class="phil">
      <div class="phil-num">${p.number}</div>
      <div class="phil-state">${label}</div>

      <div class="fork-row">
        <button class="fbtn ${hasLeft?'on':''}" ${(!canLeft && !hasLeft)?'disabled':''}
          onclick="send('${hasLeft?'philDropOne':'philPickup'}',{philId:${id},side:'left'})">
          <span class="fl">${left.letter}</span>
          <span class="fs">${hasLeft ? 'drop' : 'pick up'}</span>
        </button>
        <button class="fbtn ${hasRight?'on':''}" ${(!canRight && !hasRight)?'disabled':''}
          onclick="send('${hasRight?'philDropOne':'philPickup'}',{philId:${id},side:'right'})">
          <span class="fl">${right.letter}</span>
          <span class="fs">${hasRight ? 'drop' : 'pick up'}</span>
        </button>
      </div>

      <button class="dropall" onclick="send('philRelease',{philId:${id}})">put both down</button>

      <div class="spacer"></div>

      <button class="deadlock-btn" onclick="send('forceDeadlock')">DEADLOCK</button>
      <button class="reset-btn" onclick="send('resetAll')">reset table</button>
    </div>
  `;
}

// =====================================================
// SHOOT  (narrator only)
// =====================================================
const SHOOT_TARGET = 4;   // seat 4 = TOP-LEFT with the pentagon pointing down

function renderShoot(){
  const p = state.philosophers[SHOOT_TARGET];
  if(!p){ app.innerHTML = `<div class="role-screen"><p class="hint">no target</p></div>`; return; }

  app.innerHTML = `
    <div class="phil">
      <div class="phil-num">${p.shot ? '💀' : p.number}</div>
      <div class="phil-state">${p.shot ? 'DOWN' : 'alive'}</div>
      <div class="spacer"></div>
      <button class="deadlock-btn" onclick="send('toggleShot',{philId:${SHOOT_TARGET}})">
        ${p.shot ? 'BRING BACK' : 'SHOOT'}
      </button>
    </div>
  `;
}

// =====================================================
// TABLE  (projector)
// =====================================================
function renderTable(){
  const CENTER = 50, SEAT_R = 42, FORK_R = 33;
  // -54 rotates the ring 36 degrees so a POINT faces down
  const seatAngle = i => (-54 + i * 72) * Math.PI / 180;
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
    const icon  = p.shot ? "💀" : (p.state === "eating" ? "😋" : "🙂");
    const label = p.shot ? "dead"
                : p.state === "eating" ? "eating"
                : p.state === "stuck"  ? "DEADLOCK!!!"
                : "thinking";
    return `<div class="seat ${p.shot ? 'shot' : p.state}" style="top:${pos.top}; left:${pos.left};
              transform:translate(-50%,-50%);">
      <span class="seat-icon">${icon}</span>
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
