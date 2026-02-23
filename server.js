'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Game data – 5 categories × 5 questions
// ---------------------------------------------------------------------------
const CATEGORIES = [
  {
    name: 'Science',
    questions: [
      { value: 200,  clue: 'This force keeps planets in orbit around the sun.',           answer: 'gravity' },
      { value: 400,  clue: 'The chemical symbol for gold.',                                answer: 'Au' },
      { value: 600,  clue: 'The organelle known as "the powerhouse of the cell".',         answer: 'mitochondria' },
      { value: 800,  clue: 'The number of chromosomes in a normal human body cell.',       answer: '46' },
      { value: 1000, clue: 'Einstein\'s equation relating energy, mass, and light speed.', answer: 'E = mc²' },
    ],
  },
  {
    name: 'History',
    questions: [
      { value: 200,  clue: 'The year World War II ended.',                                      answer: '1945' },
      { value: 400,  clue: 'The first president of the United States.',                         answer: 'George Washington' },
      { value: 600,  clue: 'The ancient wonder of the world located in Egypt.',                 answer: 'Pyramids of Giza' },
      { value: 800,  clue: 'The year the Berlin Wall fell.',                                    answer: '1989' },
      { value: 1000, clue: 'The Roman emperor who converted the empire to Christianity.',       answer: 'Constantine' },
    ],
  },
  {
    name: 'Geography',
    questions: [
      { value: 200,  clue: 'The largest continent by area.',              answer: 'Asia' },
      { value: 400,  clue: 'The capital city of Australia.',              answer: 'Canberra' },
      { value: 600,  clue: 'The longest river in the world.',             answer: 'Nile' },
      { value: 800,  clue: 'The country that contains the most lakes.',   answer: 'Canada' },
      { value: 1000, clue: 'The smallest country in the world by area.',  answer: 'Vatican City' },
    ],
  },
  {
    name: 'Pop Culture',
    questions: [
      { value: 200,  clue: 'The boy wizard created by J.K. Rowling.',                  answer: 'Harry Potter' },
      { value: 400,  clue: 'The streaming service behind "Stranger Things".',           answer: 'Netflix' },
      { value: 600,  clue: 'The band behind "Bohemian Rhapsody".',                      answer: 'Queen' },
      { value: 800,  clue: 'The director of Inception and Interstellar.',               answer: 'Christopher Nolan' },
      { value: 1000, clue: 'The fictional kingdom in Disney\'s "Frozen".',              answer: 'Arendelle' },
    ],
  },
  {
    name: 'Sports',
    questions: [
      { value: 200,  clue: 'The sport played at Wimbledon.',                            answer: 'tennis' },
      { value: 400,  clue: 'Number of players per team on a basketball court.',         answer: '5' },
      { value: 600,  clue: 'Country that invented the ancient Olympic Games.',           answer: 'Greece' },
      { value: 800,  clue: 'The most decorated Olympian of all time.',                  answer: 'Michael Phelps' },
      { value: 1000, clue: 'Number of holes in a standard golf course.',                answer: '18' },
    ],
  },
];

// ---------------------------------------------------------------------------
// In-memory room storage
// ---------------------------------------------------------------------------
const rooms = {};

function generateRoomCode() {
  // Excludes I, O, 1, 0 to avoid ambiguity when reading the code aloud.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function generatePlayerId() {
  return crypto.randomBytes(8).toString('hex');
}

function getPlayersInfo(room) {
  return room.players.map(({ id, name, score }) => ({ id, name, score }));
}

// ---------------------------------------------------------------------------
// WebSocket helpers
// ---------------------------------------------------------------------------
function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(room, msg, excludeId = null) {
  const data = JSON.stringify(msg);
  room.clients.forEach((ws, id) => {
    if (id !== excludeId && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function broadcastAll(room, msg) {
  broadcast(room, msg, null);
}

// ---------------------------------------------------------------------------
// Room helpers
// ---------------------------------------------------------------------------
function createRoom(hostWs, hostName) {
  const code = generateRoomCode();
  const playerId = generatePlayerId();

  const room = {
    code,
    host: playerId,
    players: [{ id: playerId, name: hostName, score: 0 }],
    clients: new Map([[playerId, hostWs]]),
    state: 'lobby',  // 'lobby' | 'playing' | 'question'
    board: null,
    currentQuestion: null,  // { categoryIdx, questionIdx }
    buzzedPlayer: null,
    buzzedPlayers: new Set(),  // players who already buzzed this question
  };

  rooms[code] = room;
  hostWs.playerId = playerId;
  hostWs.roomCode = code;

  return { room, playerId };
}

function joinRoom(code, playerName, ws) {
  const room = rooms[code];
  if (!room) return { error: 'Room not found. Check the code and try again.' };
  if (room.state !== 'lobby') return { error: 'Game already in progress.' };

  const playerId = generatePlayerId();
  room.players.push({ id: playerId, name: playerName, score: 0 });
  room.clients.set(playerId, ws);
  ws.playerId = playerId;
  ws.roomCode = code;

  return { playerId };
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type } = msg;

    // ── create_room ─────────────────────────────────────────────────────────
    if (type === 'create_room') {
      const name = (msg.name || '').trim();
      if (!name) { send(ws, { type: 'error', message: 'Name is required.' }); return; }

      const { room, playerId } = createRoom(ws, name);
      send(ws, { type: 'room_created', code: room.code, playerId, isHost: true, players: getPlayersInfo(room) });
    }

    // ── join_room ────────────────────────────────────────────────────────────
    else if (type === 'join_room') {
      const name = (msg.name || '').trim();
      const code = (msg.code || '').trim().toUpperCase();
      if (!name) { send(ws, { type: 'error', message: 'Name is required.' }); return; }
      if (!code) { send(ws, { type: 'error', message: 'Room code is required.' }); return; }

      const result = joinRoom(code, name, ws);
      if (result.error) { send(ws, { type: 'error', message: result.error }); return; }

      const room = rooms[code];
      send(ws, { type: 'room_joined', code: room.code, playerId: result.playerId, isHost: false, players: getPlayersInfo(room) });
      broadcast(room, { type: 'player_joined', players: getPlayersInfo(room) }, result.playerId);
    }

    // ── start_game ───────────────────────────────────────────────────────────
    else if (type === 'start_game') {
      const room = rooms[ws.roomCode];
      if (!room || room.host !== ws.playerId || room.state !== 'lobby') return;

      room.board = CATEGORIES.map((cat) => ({
        name: cat.name,
        questions: cat.questions.map((q) => ({ value: q.value, clue: q.clue, answered: false })),
      }));
      room.state = 'playing';

      const boardForClient = room.board.map((cat) => ({
        name: cat.name,
        questions: cat.questions.map((q) => ({ value: q.value, answered: q.answered })),
      }));

      broadcastAll(room, { type: 'game_started', board: boardForClient, players: getPlayersInfo(room) });
    }

    // ── select_question ──────────────────────────────────────────────────────
    else if (type === 'select_question') {
      const room = rooms[ws.roomCode];
      if (!room || room.state !== 'playing' || room.host !== ws.playerId) return;

      const { categoryIdx, questionIdx } = msg;
      const question = room.board[categoryIdx]?.questions[questionIdx];
      if (!question || question.answered) return;

      room.state = 'question';
      room.currentQuestion = { categoryIdx, questionIdx };
      room.buzzedPlayer = null;
      room.buzzedPlayers = new Set();

      broadcastAll(room, { type: 'question_selected', categoryIdx, questionIdx, clue: question.clue, value: question.value });
    }

    // ── buzz_in ──────────────────────────────────────────────────────────────
    else if (type === 'buzz_in') {
      const room = rooms[ws.roomCode];
      if (!room || room.state !== 'question') return;
      if (room.buzzedPlayer !== null) return;  // someone already buzzed
      if (ws.playerId === room.host) return;  // host doesn't buzz
      if (room.buzzedPlayers.has(ws.playerId)) return;  // already buzzed this round

      room.buzzedPlayer = ws.playerId;
      room.buzzedPlayers.add(ws.playerId);

      const player = room.players.find((p) => p.id === ws.playerId);
      broadcastAll(room, { type: 'buzzed_in', playerId: ws.playerId, playerName: player?.name });
    }

    // ── mark_correct ─────────────────────────────────────────────────────────
    else if (type === 'mark_correct') {
      const room = rooms[ws.roomCode];
      if (!room || room.host !== ws.playerId || !room.buzzedPlayer) return;

      const { categoryIdx, questionIdx } = room.currentQuestion;
      const question = room.board[categoryIdx].questions[questionIdx];
      const player = room.players.find((p) => p.id === room.buzzedPlayer);
      if (player) player.score += question.value;

      question.answered = true;
      room.state = 'playing';
      room.currentQuestion = null;
      room.buzzedPlayer = null;

      broadcastAll(room, { type: 'question_result', correct: true, categoryIdx, questionIdx, players: getPlayersInfo(room) });
    }

    // ── mark_incorrect ───────────────────────────────────────────────────────
    else if (type === 'mark_incorrect') {
      const room = rooms[ws.roomCode];
      if (!room || room.host !== ws.playerId || !room.buzzedPlayer) return;

      const { categoryIdx, questionIdx } = room.currentQuestion;
      const question = room.board[categoryIdx].questions[questionIdx];
      const player = room.players.find((p) => p.id === room.buzzedPlayer);
      if (player) player.score -= question.value;

      room.buzzedPlayer = null;  // allow others to buzz

      broadcastAll(room, { type: 'question_incorrect', categoryIdx, questionIdx, players: getPlayersInfo(room) });
    }

    // ── dismiss_question ─────────────────────────────────────────────────────
    else if (type === 'dismiss_question') {
      const room = rooms[ws.roomCode];
      if (!room || room.host !== ws.playerId || !room.currentQuestion) return;

      const { categoryIdx, questionIdx } = room.currentQuestion;
      room.board[categoryIdx].questions[questionIdx].answered = true;
      room.state = 'playing';
      room.currentQuestion = null;
      room.buzzedPlayer = null;

      broadcastAll(room, { type: 'question_dismissed', categoryIdx, questionIdx });
    }
  });

  ws.on('close', () => {
    const { roomCode, playerId } = ws;
    if (!roomCode || !playerId) return;
    const room = rooms[roomCode];
    if (!room) return;

    room.clients.delete(playerId);

    if (room.host === playerId) {
      broadcast(room, { type: 'room_closed', message: 'The host disconnected. Room closed.' });
      delete rooms[roomCode];
    } else {
      room.players = room.players.filter((p) => p.id !== playerId);
      broadcastAll(room, { type: 'player_left', players: getPlayersInfo(room) });
    }
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Jeppy running at http://localhost:${PORT}`);
});
