// Home page: the name field (kept between visits) and the four buttons.

import { showScreen } from './screens.js';
import { load, save } from './save.js';

const DEFAULT_NAME = 'Deckhand';

export function playerName() {
  return load().name?.trim() || DEFAULT_NAME;
}

// onHost() opens a room, onJoin(code) connects to one.
export function initMenu({ onHost, onJoin }) {
  const nameInput = document.getElementById('playerName');
  const codeInput = document.getElementById('roomCode');
  const joinError = document.getElementById('joinError');
  const menuNote = document.getElementById('menuNote');

  nameInput.value = load().name ?? '';
  nameInput.addEventListener('input', () => save({ ...load(), name: nameInput.value.trim() }));

  document.getElementById('hostGame').addEventListener('click', () => onHost());

  document.getElementById('joinGame').addEventListener('click', () => {
    joinError.hidden = true;
    showScreen('join');
    codeInput.focus();
  });

  // On the page, not in an alert box: a desktop build has no browser dialogs.
  for (const id of ['training', 'settings']) {
    document.getElementById(id).addEventListener('click', () => {
      menuNote.textContent = `${id[0].toUpperCase()}${id.slice(1)} is coming soon`;
      menuNote.hidden = false;
    });
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
