// Home page: the name field (kept between visits) and the four buttons.

import { showScreen } from './screens.js';

const NAME_KEY = 'patchitup.name';
const DEFAULT_NAME = 'Deckhand';

export function playerName() {
  return localStorage.getItem(NAME_KEY)?.trim() || DEFAULT_NAME;
}

// onHost() runs for "Host game", onJoin(code) for "Climb aboard".
// Step 5 replaces both with real PeerJS calls.
export function initMenu({ onHost, onJoin }) {
  const nameInput = document.getElementById('playerName');
  const codeInput = document.getElementById('roomCode');
  const joinError = document.getElementById('joinError');

  nameInput.value = localStorage.getItem(NAME_KEY) ?? '';
  nameInput.addEventListener('input', () => localStorage.setItem(NAME_KEY, nameInput.value.trim()));

  document.getElementById('hostGame').addEventListener('click', () => onHost());

  document.getElementById('joinGame').addEventListener('click', () => {
    joinError.hidden = true;
    showScreen('join');
    codeInput.focus();
  });

  for (const id of ['training', 'settings']) {
    document.getElementById(id).addEventListener('click', () => alert('Coming soon'));
  }

  // Room codes are always upper case, so typing is forgiving.
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase();
    joinError.hidden = true;
  });
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') climbAboard();
  });

  document.getElementById('climbAboard').addEventListener('click', climbAboard);
  document.getElementById('joinBack').addEventListener('click', () => showScreen('menu'));
  document.getElementById('resultBack').addEventListener('click', () => showScreen('menu'));

  function climbAboard() {
    const code = codeInput.value.trim();
    if (!code) {
      joinError.textContent = 'Enter a room code';
      joinError.hidden = false;
      return;
    }
    onJoin(code);
  }
}
