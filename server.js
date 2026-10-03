// Nova Grid — serveur multijoueur (salons à code, relais temps réel)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, 'public', 'index.html');
const MAX_PLAYERS = 16;

// ---------- classement contre-la-montre ----------
// En mémoire + fichier data/tt.json. Si UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN
// sont définis, le classement est aussi sauvegardé dans Upstash (survit aux redémarrages).
const DATA_FILE = path.join(__dirname, 'data', 'tt.json');
const UP_URL = process.env.UPSTASH_REDIS_REST_URL, UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
let tt = {}; // circuit -> { name -> {name,total,lap,ghost,hull,liv,date} }
async function upstash(cmd) {
  const r = await fetch(UP_URL, { method: 'POST', headers: { Authorization: `Bearer ${UP_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  return (await r.json()).result;
}
async function loadTT() {
  try { tt = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { tt = {}; }
  if (UP_URL && UP_TOKEN) {
    try { const v = await upstash(['GET', 'novagrid:tt']); if (v) tt = JSON.parse(v); console.log('Classement chargé depuis Upstash'); }
    catch (e) { console.log('Upstash indisponible :', e.message); }
  }
}
let saveTimer = null;
function saveTT() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const json = JSON.stringify(tt);
    try { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, json); } catch {}
    if (UP_URL && UP_TOKEN) { try { await upstash(['SET', 'novagrid:tt', json]); } catch (e) { console.log('Sauvegarde Upstash ratée :', e.message); } }
  }, 3000);
}
function ttRows(circ) {
  return Object.values(tt[circ] || {}).sort((a, b) => a.total - b.total).slice(0, 100)
    .map((r) => ({ name: r.name, total: r.total, lap: r.lap, ghost: !!r.ghost }));
}
function ttSubmit(m) {
  const circ = String(m.circ || '').slice(0, 40), name = clean(m.name);
  const total = +m.total, lap = +m.lap;
  if (!circ || !(total > 5 && total < 3600) || !(lap > 2 && lap < 1200)) return;
  const board = (tt[circ] = tt[circ] || {});
  const cur = board[name] || { name };
  if (!cur.total || total < cur.total) {
    cur.total = total;
    // fantôme = la course complète (3 tours) du meilleur total
    if (m.gv === 2 && Array.isArray(m.ghost) && m.ghost.length < 8000) { cur.ghost = m.ghost; cur.hull = m.hull | 0; cur.gv = 2; }
  }
  if (!cur.lap || lap < cur.lap) cur.lap = lap;
  cur.date = Date.now(); board[name] = cur;
  // ne garder les fantômes que pour les 10 meilleurs tours du circuit
  Object.values(board).sort((a, b) => a.total - b.total).slice(10).forEach((r) => { delete r.ghost; });
  saveTT();
}


const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); res.end('index.html introuvable'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(data);
    });
  } else if (url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok');
  } else {
    res.writeHead(404); res.end('404');
  }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 * 1024 });
const rooms = new Map(); // code -> room
let nextId = 1;

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join(''); } while (rooms.has(c));
  return c;
}
const clean = (s) => String(s || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Pilote';
const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c) : d);
const cleanLiv = (l) => ({ c1: hex(l?.c1, '#ffb547'), c2: hex(l?.c2, '#14102a'), h: Math.min(8, Math.max(0, l?.h | 0)) });

function send(ws, msg) { if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }
function broadcast(room, msg, except) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) if (p.ws !== except) send(p.ws, data);
}
function lobby(room) {
  broadcast(room, {
    t: 'lobby', code: room.code, host: room.host, cfg: room.cfg, inRace: room.inRace, points: room.points,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, liv: p.liv })),
  });
}
function leave(ws) {
  const room = ws.room && rooms.get(ws.room);
  ws.room = null;
  if (!room) return;
  room.players.delete(ws.id);
  if (!room.players.size) { rooms.delete(room.code); return; }
  broadcast(room, { t: 'left', id: ws.id });
  if (room.host === ws.id) {
    room.host = room.players.keys().next().value;
    if (room.inRace) { room.inRace = false; broadcast(room, { t: 'abort' }); }
  }
  lobby(room);
}

wss.on('connection', (ws) => {
  ws.id = nextId++;
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  send(ws, { t: 'hello', id: ws.id });

  ws.on('message', (buf) => {
    if (buf.length > 512 * 1024) return;
    let m; try { m = JSON.parse(buf); } catch { return; }
    const room = ws.room && rooms.get(ws.room);
    switch (m.t) {
      case 'create': {
        leave(ws);
        const code = newCode();
        const r = { code, host: ws.id, players: new Map(), cfg: { circ: 0, ai: 1, fill: 40 }, inRace: false, points: {} };
        rooms.set(code, r);
        r.players.set(ws.id, { id: ws.id, ws, name: clean(m.name), liv: cleanLiv(m.liv) });
        ws.room = code; lobby(r); break;
      }
      case 'join': {
        const r = rooms.get(String(m.code || '').toUpperCase());
        if (!r) { send(ws, { t: 'err', msg: 'Salon introuvable. Vérifie le code.' }); break; }
        if (r.players.size >= MAX_PLAYERS) { send(ws, { t: 'err', msg: 'Salon complet (16 joueurs).' }); break; }
        if (r.inRace) { send(ws, { t: 'err', msg: 'Une course est en cours, réessaie à la fin.' }); break; }
        leave(ws);
        r.players.set(ws.id, { id: ws.id, ws, name: clean(m.name), liv: cleanLiv(m.liv) });
        ws.room = r.code; lobby(r); break;
      }
      case 'leave': leave(ws); break;
      case 'ttsub': ttSubmit(m); send(ws, { t: 'ttboard', circ: m.circ, rows: ttRows(m.circ) }); break;
      case 'ttget': send(ws, { t: 'ttboard', circ: m.circ, rows: ttRows(m.circ) }); break;
      case 'ttghost': {
        const best = Object.values(tt[m.circ] || {}).filter((r) => r.ghost && r.gv === 2).sort((a, b) => a.total - b.total)[0];
        if (best) send(ws, { t: 'ttghostdata', circ: m.circ, name: best.name, total: best.total, ghost: best.ghost, hull: best.hull });
        break;
      }
      case 'cfg':
        if (room && room.host === ws.id && !room.inRace) {
          room.cfg = { circ: m.cfg.circ | 0, ai: m.cfg.ai | 0, fill: m.cfg.fill | 0 }; lobby(room);
        } break;
      case 'start':
        if (room && room.host === ws.id && !room.inRace) { room.inRace = true; broadcast(room, m); } break;
      case 'st':
        if (room && room.inRace) broadcast(room, { t: 'st', id: ws.id, d: m.d }, ws); break;
      case 'ai':
        if (room && room.inRace && room.host === ws.id) broadcast(room, m, ws); break;
      case 'res':
        if (room && room.host === ws.id) {
          room.inRace = false; room.points = m.points || room.points;
          broadcast(room, m); lobby(room);
        } break;
    }
  });
  ws.on('close', () => leave(ws));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 20000);

loadTT().then(() => server.listen(PORT, () => console.log(`Nova Grid en ligne sur http://localhost:${PORT}`)));
