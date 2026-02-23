'use strict';

/* ============================================================
   Jeppy – Client-side WebSocket app
   ============================================================ */

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  ws:              null,
  playerId:        null,
  roomCode:        null,
  isHost:          false,
  players:         [],
  board:           null,
  currentQuestion: null,  // { categoryIdx, questionIdx, clue, value }
  hasBuzzed:       false,  // has this client buzzed for the current question?
};

// ── Screen helpers ─────────────────────────────────────────────────────────
const ALL_SCREENS = ['landing', 'lobby', 'board', 'question', 'gameover'];

function showScreen(name) {
  ALL_SCREENS.forEach((id) => {
    const el = document.getElementById(`screen-${id}`);
    if (!el) return;
    el.classList.toggle('active', id === name);
    el.classList.toggle('hidden', id !== name);
  });
}

function showToast(message, type = 'error') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ── WebSocket ──────────────────────────────────────────────────────────────
function connectWS(onOpen) {
  // Re-use open connection
  if (state.ws && state.ws.readyState === WebSocket.OPEN) { onOpen(); return; }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    state.ws = ws;
    onOpen();
  };

  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onerror = () => showToast('Connection error – please try again.');

  ws.onclose = () => {
    const el = document.getElementById('screen-landing');
    if (!el.classList.contains('active')) {
      showToast('Disconnected from server.', 'error');
    }
  };
}

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg));
  }
}

// ── Incoming message handler ───────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {

    case 'room_created':
    case 'room_joined':
      state.playerId = msg.playerId;
      state.roomCode = msg.code;
      state.isHost   = msg.isHost;
      state.players  = msg.players;
      renderLobby();
      showScreen('lobby');
      break;

    case 'player_joined':
    case 'player_left':
      state.players = msg.players;
      renderPlayers();
      break;

    case 'game_started':
      state.board   = msg.board;
      state.players = msg.players;
      renderBoard();
      showScreen('board');
      break;

    case 'question_selected':
      state.currentQuestion = {
        categoryIdx: msg.categoryIdx,
        questionIdx: msg.questionIdx,
        clue:        msg.clue,
        value:       msg.value,
      };
      state.hasBuzzed = false;
      renderQuestion();
      showScreen('question');
      break;

    case 'buzzed_in':
      renderBuzzedIn(msg.playerName, msg.playerId);
      break;

    case 'question_result': {
      // mark tile answered, update scores
      if (state.board) {
        state.board[msg.categoryIdx].questions[msg.questionIdx].answered = true;
      }
      state.players = msg.players;
      // brief pause so players see the outcome, then back to board
      setTimeout(() => {
        state.currentQuestion = null;
        renderBoard();
        showScreen('board');
        checkGameOver();
      }, 1400);
      break;
    }

    case 'question_incorrect':
      // Penalty applied; allow remaining players to buzz again
      state.players = msg.players;
      updateScoreboard();
      resetBuzzUI();
      break;

    case 'question_dismissed':
      if (state.board) {
        state.board[msg.categoryIdx].questions[msg.questionIdx].answered = true;
      }
      state.currentQuestion = null;
      renderBoard();
      showScreen('board');
      checkGameOver();
      break;

    case 'room_closed':
      showToast(msg.message || 'Room closed.', 'error');
      setTimeout(() => {
        Object.assign(state, { playerId: null, roomCode: null, isHost: false, players: [], board: null, currentQuestion: null });
        showScreen('landing');
      }, 2500);
      break;

    case 'error':
      showToast(msg.message, 'error');
      break;
  }
}

// ── Render: Lobby ──────────────────────────────────────────────────────────
function renderLobby() {
  document.getElementById('lobby-code').textContent = state.roomCode;
  renderPlayers();

  const startBtn   = document.getElementById('btn-start');
  const waitingMsg = document.getElementById('waiting-msg');
  if (state.isHost) {
    startBtn.classList.remove('hidden');
    waitingMsg.classList.add('hidden');
  } else {
    startBtn.classList.add('hidden');
    waitingMsg.classList.remove('hidden');
  }
}

function renderPlayers() {
  const list = document.getElementById('players-list');
  if (!list) return;
  list.innerHTML = state.players.map((p) => {
    const isYou = p.id === state.playerId;
    return `<div class="player-item${isYou ? ' you' : ''}">${escHtml(p.name)}${isYou ? ' <em>(you)</em>' : ''}</div>`;
  }).join('');
}

// ── Render: Game Board ─────────────────────────────────────────────────────
function renderBoard() {
  const boardEl = document.getElementById('game-board');
  if (!boardEl || !state.board) return;

  let html = '';

  // Category headers
  state.board.forEach((cat) => {
    html += `<div class="cat-header">${escHtml(cat.name)}</div>`;
  });

  // Question tiles (5 rows)
  for (let qi = 0; qi < 5; qi++) {
    state.board.forEach((cat, ci) => {
      const q = cat.questions[qi];
      if (q.answered) {
        html += `<div class="tile answered"></div>`;
      } else if (state.isHost) {
        html += `<div class="tile" data-ci="${ci}" data-qi="${qi}">$${q.value}</div>`;
      } else {
        html += `<div class="tile no-click">$${q.value}</div>`;
      }
    });
  }

  boardEl.innerHTML = html;

  // Click handlers for host
  if (state.isHost) {
    boardEl.querySelectorAll('.tile[data-ci]').forEach((tile) => {
      tile.addEventListener('click', () => {
        send({ type: 'select_question', categoryIdx: +tile.dataset.ci, questionIdx: +tile.dataset.qi });
      });
    });
  }

  updateScoreboard();
}

function updateScoreboard() {
  const el = document.getElementById('scoreboard');
  if (!el) return;
  el.innerHTML = state.players.map((p) => {
    const isYou = p.id === state.playerId;
    const negClass = p.score < 0 ? ' negative' : '';
    return `<div class="score-item${isYou ? ' you' : ''}">
      <span class="score-name">${escHtml(p.name)}${isYou ? ' (you)' : ''}</span>
      <span class="score-value${negClass}">$${p.score}</span>
    </div>`;
  }).join('');
}

// ── Render: Question ───────────────────────────────────────────────────────
function renderQuestion() {
  const q = state.currentQuestion;
  if (!q) return;

  document.getElementById('q-value').textContent = `$${q.value}`;
  document.getElementById('q-clue').textContent  = q.clue;

  // Category name
  const catEl = document.getElementById('q-category');
  if (state.board && catEl) {
    catEl.textContent = state.board[q.categoryIdx]?.name || '';
  }

  const buzzBtn      = document.getElementById('btn-buzz');
  const buzzedDisp   = document.getElementById('buzzed-display');
  const hostControls = document.getElementById('host-controls');

  buzzedDisp.classList.add('hidden');
  buzzedDisp.textContent = '';

  if (state.isHost) {
    buzzBtn.classList.add('hidden');
    hostControls.classList.remove('hidden');
    document.getElementById('btn-correct').disabled   = true;
    document.getElementById('btn-incorrect').disabled = true;
  } else {
    buzzBtn.classList.remove('hidden');
    buzzBtn.disabled    = false;
    buzzBtn.textContent = 'BUZZ IN';
    hostControls.classList.add('hidden');
  }
}

function renderBuzzedIn(playerName, playerId) {
  const buzzedDisp = document.getElementById('buzzed-display');
  buzzedDisp.textContent = `${escHtml(playerName)} buzzed in!`;
  buzzedDisp.classList.remove('hidden');

  if (state.isHost) {
    document.getElementById('btn-correct').disabled   = false;
    document.getElementById('btn-incorrect').disabled = false;
  }

  const buzzBtn = document.getElementById('btn-buzz');
  if (playerId === state.playerId) {
    buzzBtn.textContent = '🔔 YOU BUZZED IN!';
    buzzBtn.disabled    = true;
  } else {
    // Disable buzz for others while someone is answering
    buzzBtn.disabled = true;
  }
}

function resetBuzzUI() {
  // Called after mark_incorrect – allow other players to buzz again
  const buzzedDisp = document.getElementById('buzzed-display');
  buzzedDisp.classList.add('hidden');
  buzzedDisp.textContent = '';

  if (!state.isHost) {
    const buzzBtn = document.getElementById('btn-buzz');
    if (!state.hasBuzzed) {
      buzzBtn.disabled    = false;
      buzzBtn.textContent = 'BUZZ IN';
    }
  }

  if (state.isHost) {
    document.getElementById('btn-correct').disabled   = true;
    document.getElementById('btn-incorrect').disabled = true;
  }
}

// ── Game-over detection ────────────────────────────────────────────────────
function checkGameOver() {
  if (!state.board) return;
  const allDone = state.board.every((cat) => cat.questions.every((q) => q.answered));
  if (!allDone) return;

  // Sort players by score desc
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const medals = ['🥇', '🥈', '🥉'];
  const finalEl = document.getElementById('final-scores');
  finalEl.innerHTML = sorted.map((p, i) => {
    const isFirst = i === 0;
    const negClass = p.score < 0 ? ' negative' : '';
    return `<div class="final-row${isFirst ? ' first' : ''}">
      <span><span class="medal">${medals[i] || ''}</span>${escHtml(p.name)}</span>
      <span class="final-score-val${negClass}">$${p.score}</span>
    </div>`;
  }).join('');

  showScreen('gameover');
}

// ── Utility ────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Event listeners ────────────────────────────────────────────────────────

// Landing: Create Room
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('landing-name').value.trim();
  if (!name) { showToast('Please enter your name.'); return; }
  connectWS(() => send({ type: 'create_room', name }));
});

// Landing: open Join modal
document.getElementById('btn-join-open').addEventListener('click', () => {
  const name = document.getElementById('landing-name').value.trim();
  document.getElementById('join-name').value = name;
  document.getElementById('join-code').value = '';
  document.getElementById('modal-join').classList.remove('hidden');
  document.getElementById('join-code').focus();
});

// Join modal: Cancel
document.getElementById('btn-join-cancel').addEventListener('click', () => {
  document.getElementById('modal-join').classList.add('hidden');
});

// Join modal: Submit
document.getElementById('btn-join-submit').addEventListener('click', submitJoin);
document.getElementById('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitJoin(); });
document.getElementById('join-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('join-code').focus(); });

function submitJoin() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) { showToast('Please enter your name.'); return; }
  if (code.length !== 4) { showToast('Room code must be 4 characters.'); return; }
  document.getElementById('modal-join').classList.add('hidden');
  connectWS(() => send({ type: 'join_room', name, code }));
}

// Auto-uppercase room code as the user types
document.getElementById('join-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// Lobby: Start Game
document.getElementById('btn-start').addEventListener('click', () => {
  send({ type: 'start_game' });
});

// Question: Buzz In
document.getElementById('btn-buzz').addEventListener('click', () => {
  if (state.hasBuzzed) return;
  state.hasBuzzed = true;
  send({ type: 'buzz_in' });
});

// Question host controls
document.getElementById('btn-correct').addEventListener('click', () => {
  send({ type: 'mark_correct' });
});
document.getElementById('btn-incorrect').addEventListener('click', () => {
  send({ type: 'mark_incorrect' });
});
document.getElementById('btn-dismiss').addEventListener('click', () => {
  send({ type: 'dismiss_question' });
});
