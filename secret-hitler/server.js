const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
});

app.use(express.static(path.join(__dirname, 'public')));

// =====================
// GAME ROOMS
// =====================
const rooms = {}; // roomCode -> gameRoom

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function assignRoles(count) {
  const configs = {
    5:  { liberals: 3, fascists: 1 },
    6:  { liberals: 4, fascists: 1 },
    7:  { liberals: 4, fascists: 2 },
    8:  { liberals: 5, fascists: 2 },
    9:  { liberals: 5, fascists: 3 },
    10: { liberals: 6, fascists: 3 },
  };
  const cfg = configs[Math.min(10, Math.max(5, count))];
  let roles = [];
  for (let i = 0; i < cfg.liberals; i++) roles.push('liberal');
  for (let i = 0; i < cfg.fascists; i++) roles.push('fascist');
  roles.push('hitler');
  return shuffle(roles);
}

function buildDeck() {
  let deck = [];
  for (let i = 0; i < 11; i++) deck.push('fascist');
  for (let i = 0; i < 6; i++) deck.push('liberal');
  return shuffle(deck);
}

const FASCIST_POWERS = {
  5:  [null, null, null, 'investigate', 'special_election', 'kill'],
  6:  [null, null, null, 'investigate', 'special_election', 'kill'],
  7:  [null, null, 'investigate', 'kill', 'special_election', 'kill'],
  8:  [null, null, 'investigate', 'kill', 'special_election', 'kill'],
  9:  [null, 'investigate', 'investigate', 'kill', 'special_election', 'kill'],
  10: [null, 'investigate', 'investigate', 'kill', 'special_election', 'kill'],
};

function getPower(room) {
  const n = Math.min(10, Math.max(5, room.players.length));
  const powers = FASCIST_POWERS[n];
  return powers[room.fascistPolicies - 1] || null;
}

function createRoom(hostName, hostId) {
  const code = generateCode();
  rooms[code] = {
    code,
    hostId,
    players: [],       // { id, name, role, alive, investigated }
    phase: 'lobby',    // lobby | nominate | vote | president_discard | chancellor_discard | power | gameover
    deck: [],
    discard: [],
    fascistPolicies: 0,
    liberalPolicies: 0,
    electionTracker: 0,
    round: 1,
    presidentIndex: 0,
    chancellorIndex: null,
    prevPresident: null,
    prevChancellor: null,
    votes: {},
    hand: [],           // president's 3 cards
    log: [],
    winner: null,
    winReason: null,
    specialElectionNext: null,
    investigateResult: null, // { targetId, party }
  };
  return rooms[code];
}

function addLog(room, msg) {
  room.log.push({ t: Date.now(), msg });
  if (room.log.length > 50) room.log.shift();
}

// What each player is allowed to see
function playerView(room, playerId) {
  const me = room.players.find(p => p.id === playerId);
  return {
    code: room.code,
    phase: room.phase,
    players: room.players.map(p => {
      const isMe = p.id === playerId;
      // Fascists/Hitler see each other (except Hitler doesn't see fascists in 7+ player)
      const isFascist = me && (me.role === 'fascist' || (me.role === 'hitler' && room.players.length <= 6));
      const showRole = isMe || (isFascist && (p.role === 'fascist' || p.role === 'hitler'));
      return {
        id: p.id,
        name: p.name,
        alive: p.alive,
        investigated: p.investigated,
        role: showRole ? p.role : null,
        isMe,
      };
    }),
    myRole: me ? me.role : null,
    fascistPolicies: room.fascistPolicies,
    liberalPolicies: room.liberalPolicies,
    electionTracker: room.electionTracker,
    round: room.round,
    presidentId: room.players[room.presidentIndex]?.id || null,
    chancellorId: room.chancellorIndex !== null ? room.players[room.chancellorIndex]?.id || null : null,
    prevPresidentId: room.prevPresident !== null ? room.players[room.prevPresident]?.id || null : null,
    prevChancellorId: room.prevChancellor !== null ? room.players[room.prevChancellor]?.id || null : null,
    myVote: me ? room.votes[playerId] : null,
    voteCount: Object.keys(room.votes).length,
    aliveCount: room.players.filter(p => p.alive).length,
    hand: (me && (
      (room.phase === 'president_discard' && room.players[room.presidentIndex]?.id === playerId) ||
      (room.phase === 'chancellor_discard' && room.players[room.chancellorIndex]?.id === playerId)
    )) ? room.hand : null,
    log: room.log.slice(-20),
    winner: room.winner,
    winReason: room.winReason,
    hostId: room.hostId,
    power: room.phase === 'power' ? getPower(room) : null,
    investigateResult: (room.phase === 'power' && room.investigateResult && room.players[room.presidentIndex]?.id === playerId)
      ? room.investigateResult : null,
  };
}

function broadcast(room) {
  room.players.forEach(p => {
    io.to(p.id).emit('gameState', playerView(room, p.id));
  });
}

function startGame(room) {
  const roles = assignRoles(room.players.length);
  room.players.forEach((p, i) => {
    p.role = roles[i];
    p.alive = true;
    p.investigated = false;
  });
  room.deck = buildDeck();
  room.discard = [];
  room.fascistPolicies = 0;
  room.liberalPolicies = 0;
  room.electionTracker = 0;
  room.round = 1;
  room.presidentIndex = Math.floor(Math.random() * room.players.length);
  room.chancellorIndex = null;
  room.prevPresident = null;
  room.prevChancellor = null;
  room.votes = {};
  room.hand = [];
  room.log = [];
  room.winner = null;
  room.winReason = null;
  room.phase = 'nominate';
  const pres = room.players[room.presidentIndex];
  addLog(room, `🏛 Runde 1 beginnt! ${pres.name} ist Präsident.`);
  broadcast(room);
}

function resolveVote(room) {
  const alive = room.players.filter(p => p.alive);
  const ja = alive.filter(p => room.votes[p.id] === 'ja').length;
  const nein = alive.filter(p => room.votes[p.id] === 'nein').length;
  const passed = ja > nein;
  addLog(room, `Abstimmung: ${ja} Ja, ${nein} Nein → ${passed ? '✓ ANGENOMMEN' : '✗ ABGELEHNT'}`);

  if (passed) {
    // Hitler chancellor check
    const chan = room.players[room.chancellorIndex];
    if (room.fascistPolicies >= 3 && chan.role === 'hitler') {
      gameOver(room, 'fascist', 'Hitler wurde Kanzler!');
      return;
    }
    room.electionTracker = 0;
    room.prevPresident = room.presidentIndex;
    room.prevChancellor = room.chancellorIndex;
    dealPolicies(room);
  } else {
    room.electionTracker++;
    room.chancellorIndex = null;
    if (room.electionTracker >= 3) {
      forcePolicy(room);
    } else {
      addLog(room, `⚠️ Wahl-Tracker: ${room.electionTracker}/3`);
      nextRound(room);
    }
  }
}

function dealPolicies(room) {
  if (room.deck.length < 3) {
    room.deck = shuffle([...room.deck, ...room.discard]);
    room.discard = [];
    addLog(room, '🔄 Abwurfstapel wurde neu gemischt.');
  }
  room.hand = [room.deck.pop(), room.deck.pop(), room.deck.pop()];
  room.phase = 'president_discard';
  const pres = room.players[room.presidentIndex];
  addLog(room, `📜 ${pres.name} erhält 3 Gesetze und wählt eines ab.`);
  broadcast(room);
}

function forcePolicy(room) {
  if (room.deck.length < 1) {
    room.deck = shuffle([...room.deck, ...room.discard]);
    room.discard = [];
  }
  const policy = room.deck.pop();
  addLog(room, `⚡ Wahl-Tracker voll! Oberstes Gesetz (${policy === 'fascist' ? 'Faschistisch' : 'Liberal'}) wird automatisch verabschiedet.`);
  room.electionTracker = 0;
  room.prevPresident = null;
  room.prevChancellor = null;
  enactPolicy(room, policy, true);
}

function enactPolicy(room, policy, forced = false) {
  if (policy === 'fascist') {
    room.fascistPolicies++;
    addLog(room, `⚑ Faschistisches Gesetz verabschiedet! (${room.fascistPolicies}/6)`);
    if (room.fascistPolicies >= 6) { gameOver(room, 'fascist', 'Sechs faschistische Gesetze verabschiedet!'); return; }
    const power = forced ? null : getPower(room);
    if (power) {
      room.phase = 'power';
      room.investigateResult = null;
      addLog(room, `⚡ Präsident erhält Sondermacht: ${power}`);
    } else {
      nextRound(room);
    }
  } else {
    room.liberalPolicies++;
    addLog(room, `☮ Liberales Gesetz verabschiedet! (${room.liberalPolicies}/5)`);
    if (room.liberalPolicies >= 5) { gameOver(room, 'liberal', 'Fünf liberale Gesetze verabschiedet!'); return; }
    nextRound(room);
  }
  broadcast(room);
}

function nextRound(room) {
  const n = room.players.length;
  if (room.specialElectionNext !== null) {
    room.presidentIndex = room.specialElectionNext;
    room.specialElectionNext = null;
  } else {
    let next = (room.presidentIndex + 1) % n;
    while (!room.players[next].alive) next = (next + 1) % n;
    room.presidentIndex = next;
  }
  room.chancellorIndex = null;
  room.votes = {};
  room.hand = [];
  room.phase = 'nominate';
  room.round++;
  const pres = room.players[room.presidentIndex];
  addLog(room, `🏛 Runde ${room.round}: ${pres.name} ist Präsident.`);
  broadcast(room);
}

function gameOver(room, winner, reason) {
  room.phase = 'gameover';
  room.winner = winner;
  room.winReason = reason;
  addLog(room, `🏁 SPIELENDE: ${winner === 'liberal' ? 'Liberale' : 'Faschisten'} gewinnen! ${reason}`);
  broadcast(room);
}

function findRoomByPlayerId(id) {
  return Object.values(rooms).find(r => r.players.some(p => p.id === id));
}

// =====================
// SOCKET EVENTS
// =====================
io.on('connection', (socket) => {

  socket.on('createRoom', ({ name }) => {
    const room = createRoom(name, socket.id);
    room.players.push({ id: socket.id, name, role: null, alive: true, investigated: false });
    socket.join(room.code);
    socket.emit('roomCreated', { code: room.code });
    broadcast(room);
  });

  socket.on('joinRoom', ({ name, code }) => {
    const room = rooms[code.toUpperCase()];
    if (!room) { socket.emit('error', 'Raum nicht gefunden!'); return; }
    if (room.phase !== 'lobby') { socket.emit('error', 'Spiel läuft bereits!'); return; }
    if (room.players.length >= 10) { socket.emit('error', 'Raum ist voll!'); return; }
    if (room.players.find(p => p.name.toLowerCase() === name.toLowerCase())) {
      socket.emit('error', 'Name bereits vergeben!'); return;
    }
    room.players.push({ id: socket.id, name, role: null, alive: true, investigated: false });
    socket.join(code.toUpperCase());
    socket.emit('roomJoined', { code: room.code });
    broadcast(room);
  });

  socket.on('startGame', () => {
    const room = findRoomByPlayerId(socket.id);
    if (!room) return;
    if (room.hostId !== socket.id) { socket.emit('error', 'Nur der Host kann starten!'); return; }
    if (room.players.length < 5) { socket.emit('error', 'Mindestens 5 Spieler benötigt!'); return; }
    startGame(room);
  });

  socket.on('nominate', ({ targetId }) => {
    const room = findRoomByPlayerId(socket.id);
    if (!room || room.phase !== 'nominate') return;
    if (room.players[room.presidentIndex].id !== socket.id) { socket.emit('error', 'Du bist nicht Präsident!'); return; }
    const targetIdx = room.players.findIndex(p => p.id === targetId);
    if (targetIdx === -1) return;
    const target = room.players[targetIdx];
    if (!target.alive) { socket.emit('error', 'Spieler ist tot!'); return; }
    if (targetIdx === room.presidentIndex) { socket.emit('error', 'Nicht dich selbst!'); return; }
    const aliveCount = room.players.filter(p => p.alive).length;
    if (aliveCount > 5) {
      if (targetIdx === room.prevChancellor || targetIdx === room.prevPresident) {
        socket.emit('error', 'Dieser Spieler ist nicht wählbar (vorherige Amtsinhaber)!'); return;
      }
    } else {
      if (targetIdx === room.prevChancellor) {
        socket.emit('error', 'Dieser Spieler war letzter Kanzler und ist nicht wählbar!'); return;
      }
    }
    room.chancellorIndex = targetIdx;
    room.phase = 'vote';
    room.votes = {};
    addLog(room, `${room.players[room.presidentIndex].name} nominiert ${target.name} als Kanzler.`);
    broadcast(room);
  });

  socket.on('vote', ({ vote }) => {
    const room = findRoomByPlayerId(socket.id);
    if (!room || room.phase !== 'vote') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.alive) return;
    if (room.votes[socket.id] !== undefined) return;
    room.votes[socket.id] = vote; // 'ja' | 'nein'
    broadcast(room);
    const alive = room.players.filter(p => p.alive);
    if (Object.keys(room.votes).length >= alive.length) {
      resolveVote(room);
    }
  });

  socket.on('presidentDiscard', ({ cardIndex }) => {
    const room = findRoomByPlayerId(socket.id);
    if (!room || room.phase !== 'president_discard') return;
    if (room.players[room.presidentIndex].id !== socket.id) return;
    if (cardIndex < 0 || cardIndex >= room.hand.length) return;
    room.discard.push(room.hand.splice(cardIndex, 1)[0]);
    room.phase = 'chancellor_discard';
    addLog(room, `Präsident hat eine Karte abgeworfen.`);
    broadcast(room);
  });

  socket.on('chancellorEnact', ({ cardIndex }) => {
    const room = findRoomByPlayerId(socket.id);
    if (!room || room.phase !== 'chancellor_discard') return;
    if (room.players[room.chancellorIndex].id !== socket.id) return;
    if (cardIndex < 0 || cardIndex >= room.hand.length) return;
    const policy = room.hand.splice(cardIndex, 1)[0];
    room.discard.push(...room.hand);
    room.hand = [];
    addLog(room, `Kanzler hat ein Gesetz verabschiedet.`);
    enactPolicy(room, policy);
  });

  socket.on('usePower', ({ targetId }) => {
    const room = findRoomByPlayerId(socket.id);
    if (!room || room.phase !== 'power') return;
    if (room.players[room.presidentIndex].id !== socket.id) return;
    const targetIdx = room.players.findIndex(p => p.id === targetId);
    if (targetIdx === -1) return;
    const target = room.players[targetIdx];
    const power = getPower(room);

    if (power === 'kill') {
      if (!target.alive) { socket.emit('error', 'Spieler ist bereits tot!'); return; }
      target.alive = false;
      addLog(room, `☠ ${target.name} wurde hingerichtet!`);
      if (target.role === 'hitler') {
        gameOver(room, 'liberal', `Hitler (${target.name}) wurde erschossen!`);
        return;
      }
      nextRound(room);
    } else if (power === 'investigate') {
      if (target.investigated) { socket.emit('error', 'Dieser Spieler wurde bereits untersucht!'); return; }
      target.investigated = true;
      const party = target.role === 'liberal' ? 'Liberal' : 'Faschistisch';
      room.investigateResult = { targetName: target.name, party };
      addLog(room, `🔍 ${room.players[room.presidentIndex].name} untersucht ${target.name}. (Ergebnis nur für Präsident sichtbar)`);
      broadcast(room);
      // After president sees it, they click continue
    } else if (power === 'special_election') {
      room.specialElectionNext = targetIdx;
      addLog(room, `⚡ Sonderwahl: ${target.name} wird nächster Präsident.`);
      nextRound(room);
    }
  });

  socket.on('investigateDone', () => {
    const room = findRoomByPlayerId(socket.id);
    if (!room || room.phase !== 'power') return;
    if (room.players[room.presidentIndex].id !== socket.id) return;
    room.investigateResult = null;
    nextRound(room);
  });

  socket.on('playAgain', () => {
    const room = findRoomByPlayerId(socket.id);
    if (!room || room.phase !== 'gameover') return;
    if (room.hostId !== socket.id) { socket.emit('error', 'Nur der Host kann neu starten!'); return; }
    room.phase = 'lobby';
    room.winner = null;
    room.winReason = null;
    room.log = [];
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const room = findRoomByPlayerId(socket.id);
    if (!room) return;
    if (room.phase === 'lobby') {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[room.code];
        return;
      }
      if (room.hostId === socket.id) room.hostId = room.players[0].id;
      broadcast(room);
    } else {
      const p = room.players.find(p => p.id === socket.id);
      if (p) {
        addLog(room, `⚠️ ${p.name} hat die Verbindung getrennt.`);
        p.alive = false; // Treat as dead for game flow
        broadcast(room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Secret Hitler server running on port ${PORT}`);
});
