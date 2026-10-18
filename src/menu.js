// Home page: the name field (kept between visits) and the four buttons.

import { load, save } from './save.js';

const DEFAULT_NAME = 'Deckhand';

export function playerName() {
  return load().name?.trim() || DEFAULT_NAME;
}

// The name may change elsewhere (the host's crew screen): show it again.
export function refreshNameChip() {
  document.getElementById('nameShown').textContent = playerName();
  document.getElementById('playerName').value = load().name ?? '';
}

// onHost() opens a room, onJoin() opens the Join a game screen,
// onSettings() opens the settings.
export function initMenu({ onHost, onJoin, onSettings }) {
  const nameInput = document.getElementById('playerName');
  const menuNote = document.getElementById('menuNote');

  // "Playing as Deckhand ✎" in the corner: click it to type a new name.
  // Enter or clicking away keeps it, Esc puts the old one back.
  const nameChip = document.getElementById('nameChip');
  const nameShown = document.getElementById('nameShown');
  const nameEdit = nameInput.closest('.name-edit');
  let nameBefore = '';

  refreshNameChip();

  nameChip.addEventListener('click', () => {
    nameBefore = nameInput.value;
    nameChip.hidden = true;
    nameEdit.hidden = false;
    nameInput.focus();
    nameInput.select();
  });
  nameInput.addEventListener('input', () => save({ ...load(), name: nameInput.value.trim() }));
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      nameInput.value = nameBefore;
      save({ ...load(), name: nameBefore.trim() });
    }
    if (e.key === 'Enter' || e.key === 'Escape') nameInput.blur();
  });
  nameInput.addEventListener('blur', () => {
    nameShown.textContent = playerName();
    nameEdit.hidden = true;
    nameChip.hidden = false;
  });

  document.getElementById('hostGame').addEventListener('click', () => onHost());

  document.getElementById('joinGame').addEventListener('click', () => {
    menuNote.hidden = true;
    onJoin();
  });

  document.getElementById('settings').addEventListener('click', () => {
    menuNote.hidden = true;
    onSettings();
  });

  // On the page, not in an alert box: a desktop build has no browser dialogs.
  document.getElementById('training').addEventListener('click', () => {
    menuNote.textContent = 'Training is coming soon';
    menuNote.hidden = false;
  });
}
