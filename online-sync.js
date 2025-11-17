// URL role and room
const u = new URL(location.href);
const role = u.searchParams.get('role'); // host|player
let room = u.searchParams.get('room');

// DOM helpers
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// PLAYER VIEW (mobile)
const pView = document.createElement('section');
pView.id = 'olPlayerView';
pView.innerHTML = `
  <div class="card">
    <div style="font-weight:700; margin-bottom:6px">Csatlakozás</div>
    <div class="ol-row" style="margin-bottom:6px">
      <input id="olPlayerName" placeholder="Neved">
      <button id="olJoin">Belépés</button>
    </div>
    <div id="olJoinMsg" class="small"></div>
  </div>
  <div class="card">
    <div style="font-weight:700; margin-bottom:6px">Állapot</div>
    <div class="ol-badges">
      <div class="ol-badge"><span class="k">Tó</span><span id="olLake" class="v">-</span></div>
      <div class="ol-badge"><span class="k">Vagyon</span><span id="olWallet" class="v">-</span></div>
      <div class="ol-badge"><span class="k">Előző fogás</span><span id="olLast" class="v">-</span></div>
      <div class="ol-badge"><span class="k">Aktív hatás</span><span id="olEffect" class="v">-</span></div>
    </div>
  </div>
  <div class="card">
    <div style="font-weight:700; margin-bottom:6px">Aktuális kör beküldése</div>
    <div class="ol-row">
      <input id="olIntent" type="number" min="0" step="1" placeholder="Hány halat fogsz?">
      <button id="olSend">Küldés</button>
    </div>
    <div id="olSendMsg" class="small"></div>
  </div>
`;
document.body.appendChild(pView);

// HOST TOOLS (floating)
const hTools = document.createElement('div');
hTools.id = 'olHostTools';
hTools.innerHTML = `
  <div class="panel">
    <h4>Online játék</h4>
    <div class="small">Szoba: <span id="olRoomLbl">-</span></div>
    <div class="ol-row" style="margin:8px 0">
      <button id="olQrBtn">QR</button>
      <button id="olSyncNow">Kényszerített szinkron</button>
    </div>
    <div class="small" style="margin-top:6px">Játékos-hozzárendelés</div>
    <div id="olMapList"></div>
  </div>`;
document.body.appendChild(hTools);

// QR MODAL
const qrModal = document.createElement('div');
qrModal.id = 'olQrModal';
qrModal.innerHTML = `
  <div class="inner">
    <h3 style="margin:0 0 8px 0">Csatlakozás QR-kóddal</h3>
    <div id="olQrBox" style="display:flex;justify-content:center;margin:12px 0"></div>
    <div class="small" id="olJoinLink" style="word-break:break-all"></div>
    <div class="ol-row" style="margin-top:8px">
      <button id="olQrClose">Bezár</button>
      <button id="olCopy">Link másolása</button>
    </div>
  </div>`;
document.body.appendChild(qrModal);

// ROLE GATING
function showPlayerOnly() {
  const kids = Array.from(document.body.children);
  for (const el of kids) {
    if (el.id === 'olPlayerView' || el.id === 'olQrModal') continue;
    el.style.display = 'none';
  }
  $('#olPlayerView').style.display = 'block';
}
function showHostOnly() {
  $('#olHostTools').style.display = 'block';
}

// Firebase (modular)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
  getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, getDocs, addDoc,
  serverTimestamp, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Firebase config (kitöltve)
const firebaseConfig = { apiKey:"AIzaSyBUifQpABjjbrIdI5pZaY3gys5N5W5wopw", authDomain:"fishpond-238c3.firebaseapp.com", projectId:"fishpond-238c3", storageBucket:"fishpond-238c3.firebasestorage.app", messagingSenderId:"334427651378", appId:"1:334427651378:web:5bf16ef09f54fe4cb1ab2b" };
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Paths
const S = (id) => doc(db, "sessions", id);
const P = (id) => collection(db, "sessions", id, "players");
const R = (id, r) => doc(db, "sessions", id, "rounds", String(r));
const C = (id, r) => collection(db, "sessions", id, "rounds", String(r), "catches");
const CD = (id, r, pid) => doc(db, "sessions", id, "rounds", String(r), "catches", pid);

// State
let uid=null, playerId=null, currentRound=1;
let mapping = {}; // remotePlayerId -> hostPlayerId
let hostUid=null;

// Sign-in and boot
signInAnonymously(auth).catch(console.error);
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  uid = user.uid;
  if (role === 'player') {
    if (!room) { room = prompt('Room azonosító:'); }
    showPlayerOnly();
    playerBoot();
  } else {
    showHostOnly();
    hostBoot();
  }
});

// ---------------- PLAYER ----------------
async function playerBoot() {
  $('#olJoin').onclick = joinRoom;
  $('#olSend').onclick = sendIntent;

  onSnapshot(S(room), (snap) => {
    const d = snap.data() || {};
    currentRound = d.round || 1;
    $('#olLake').textContent = Math.floor(d?.lake?.stock ?? 0);
  });

  bindOwnPlayerRealtime();
}

async function joinRoom() {
  const name = ($('#olPlayerName').value || 'Játékos').trim();
  const s = await getDoc(S(room));
  if (!s.exists()) { $('#olJoinMsg').textContent = 'A szoba nem létezik.'; return; }
  const q = query(P(room), where('uid','==',uid));
  const ex = await getDocs(q);
  if (ex.size === 0) {
    const ref = await addDoc(P(room), { name, wallet:0, lastCatch:0, activeEffect:null, joinedAt: serverTimestamp(), uid });
    playerId = ref.id;
  } else {
    playerId = ex.docs[0].id;
    await updateDoc(doc(db, 'sessions', room, 'players', playerId), { name });
  }
  $('#olJoinMsg').textContent = 'Sikeres csatlakozás.';
  bindOwnPlayerRealtime();
}

async function bindOwnPlayerRealtime() {
  onSnapshot(S(room), async (snap) => {
    const d = snap.data() || {};
    const my = d?.publicPlayers?.[uid];
    if (my) {
      $('#olWallet').textContent = Math.floor(my.wallet ?? 0);
      $('#olLast').textContent = Math.floor(my.lastCatch ?? 0);
      $('#olEffect').textContent = my.activeEffect ?? '-';
    }
  });
}

async function sendIntent() {
  if (!playerId) { $('#olSendMsg').textContent = 'Előbb csatlakozz!'; return; }
  const s = await getDoc(S(room));
  const r = Number(s.data()?.round || 1);
  const v = Number($('#olIntent').value);
  if (!(v>=0)) { $('#olSendMsg').textContent = 'Adj meg 0 vagy pozitív számot.'; return; }
  const myDoc = CD(room, r, playerId);
  const exists = await getDoc(myDoc);
  if (exists.exists()) { $('#olSendMsg').textContent = 'Már beküldted ebben a körben.'; return; }
  await setDoc(myDoc, { intent: v, submittedAt: serverTimestamp(), uid });
  $('#olSendMsg').textContent = 'Beküldve.';
  $('#olSend').disabled = true;
}

// ---------------- HOST ----------------
async function hostBoot() {
  if (!room) { room = Math.random().toString(36).slice(2,8); u.searchParams.set('room', room); history.replaceState({}, "", u); }
  $('#olRoomLbl').textContent = room;

  const sref = S(room);
  const s = await getDoc(sref);
  if (!s.exists()) {
    await setDoc(sref, { code: room, createdAt: serverTimestamp(), status:'lobby', round:1, lake:{ stock: 100, sustainableCatch: 10 }, hostUid: uid });
  } else if (!s.data().hostUid) {
    await updateDoc(sref, { hostUid: uid });
  }

  $('#olQrBtn').onclick = () => {
    const link = buildJoinUrl();
    $('#olJoinLink').textContent = link;
    $('#olQrModal').style.display = 'flex';
    const box = $('#olQrBox'); box.innerHTML = ''; new QRCode(box, { text: link, width: 220, height: 220 });
  };
  $('#olQrClose').onclick = () => $('#olQrModal').style.display = 'none';
  $('#olCopy').onclick = async () => { await navigator.clipboard.writeText(buildJoinUrl()); alert('Link másolva'); };

  renderMappingUI();
  onSnapshot(P(room), () => renderMappingUI());
  bindIntentsToInputs();

  patchEndRoundPublish();
  $('#olSyncNow').onclick = publishStateFromDashboard;
}

function buildJoinUrl(){
  const base = location.href.split('?')[0];
  return `${base}?role=player&room=${encodeURIComponent(room)}`;
}

function renderMappingUI() {
  const el = $('#olMapList'); el.innerHTML='';
  onSnapshot(P(room), (snap) => {
    el.innerHTML='';
    const hostPlayers = (window.gameState?.players || []).map(p => ({ id:p.id, name:p.name }));
    snap.forEach(d => {
      const pl = d.data(); const pid = d.id;
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div style="font-weight:600">${pl.name || 'Játékos'}</div>`;
      const sel = document.createElement('select');
      sel.innerHTML = `<option value="">— hozzárendelés a helyi játékoshoz —</option>` + hostPlayers.map(hp => `<option value="${hp.id}">${hp.name}</option>`).join('');
      sel.onchange = () => { mapping[pid] = sel.value; localStorage.setItem('ol_mapping_'+room, JSON.stringify(mapping)); };
      const saved = JSON.parse(localStorage.getItem('ol_mapping_'+room) || '{}');
      Object.assign(mapping, saved);
      if (mapping[pid]) sel.value = mapping[pid];
      wrap.appendChild(sel);
      el.appendChild(wrap);
    });
  });
}

function bindIntentsToInputs() {
  onSnapshot(S(room), (snap) => { currentRound = snap.data()?.round || 1; });
  onSnapshot(collection(db, 'sessions', room, 'rounds', String(currentRound), 'catches'), (snap) => {
    snap.docChanges().forEach(ch => {
      const remotePid = ch.doc.id;
      const hostPid = mapping[remotePid];
      if (!hostPid) return;
      const intent = Number(ch.doc.data()?.intent || 0);
      const input = document.getElementById(`player-${hostPid}-catch`);
      if (input) {
        input.value = intent;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });
}

function patchEndRoundPublish() {
  const orig = window.endRound;
  if (typeof orig !== 'function') return;
  window.endRound = function patchedEndRound() {
    const prevRound = window.gameState?.round;
    const res = orig.apply(this, arguments);
    publishStateFromDashboard(prevRound);
    return res;
  };
}

async function publishStateFromDashboard(prevRoundGuess) {
  try {
    const gs = window.gameState || {};
    const sref = S(room);
    const sSnap = await getDoc(sref);
    const r = gs.round || sSnap.data()?.round || 1;
    const pubPlayers = {};
    (gs.players || []).forEach(p => {
      const remotePid = Object.keys(mapping).find(k => mapping[k] === p.id);
      const remote = remotePid ? (await getDoc(doc(db, 'sessions', room, 'players', remotePid))).data() : null;
      const key = remote?.uid || ('local_'+p.id);
      pubPlayers[key] = { wallet: Math.floor(p.fish||0), lastCatch: Math.floor(p.lastCatch||0), activeEffect: (p.effects||[])[0]?.name || null };
    });
    await updateDoc(sref, { 
      lake: { stock: Math.floor(gs.pond || 0), sustainableCatch: Math.floor(gs.mff || 0) || (sSnap.data()?.lake?.sustainableCatch ?? 0) },
      round: r,
      publicPlayers: pubPlayers
    });
    bindIntentsToInputs();
  } catch(e){ console.error(e); }
}

// Final role gate on first load
if (role === 'player') {
  showPlayerOnly();
} else {
  showHostOnly();
}
