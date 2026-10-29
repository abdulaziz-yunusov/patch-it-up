// The Join a game screen: your name, the room code, recent crews to rejoin
// with one click. While the connection is made the button turns into
// "Climbing aboard…"; if it fails, the card says why, in red.
//
// Recent crew names come from other people's browsers, so they only ever
// go into the page as text.

import { showScreen } from './screens.js';
import { load, save } from './save.js';

const RECENT_MAX = 3;
const CODE = /^[A-Z]{4}-[1-9]$/; // network.js makes them: a word, a dash, a digit

const $ = (id) => document.getElementById(id);

let busy = false;

// "crab7", "crab 7" and "Crab-7" all mean CRAB-7.
export function tidyCode(text) {
  const bare = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const parts = /^([A-Z]{4})(\d)$/.exec(bare);
  return parts ? `${parts[1]}-${parts[2]}` : text.trim().toUpperCase();
}

// onJoin(code) connects; onCancel() gives up on a connection in progress.
export function initJoin({ onJoin, onCancel, onLeave }) {
  const nameInput = $('joinName');
  const codeInput = $('roomCode');

  nameInput.addEventListener('input', () => save({ ...load(), name: nameInput.value.trim() }));

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase();
    clearError();
  });

  $('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    const code = tidyCode(codeInput.value);
    codeInput.value = code;
    if (!code) return showError('Enter a room code', 'Ask your host for the code shown on their screen.');
    if (!CODE.test(code)) {
      return showError("That doesn't look like a room code", 'Codes are 4 letters, a dash and a number, like CRAB-7.');
    }
    setBusy(true);
    onJoin(code);
  });

  // While connecting, the back arrow cancels; otherwise it goes home.
  $('joinBack').addEventListener('click', () => {
    if (busy) {
      setBusy(false);
      onCancel();
    } else {
      onLeave();
    }
  });
}

export function openJoin() {
  $('joinName').value = load().name ?? '';
  $('climbLabel').textContent = 'Climb aboard';
  clearError();
  setBusy(false);
  drawRecent();
  showScreen('join');
  $('roomCode').focus();
}

export function setBusy(on) {
  busy = on;
  const button = $('climbAboard');
  button.disabled = on;
  button.classList.toggle('busy', on);
  $('climbLabel').textContent = on ? 'Climbing aboard…' : $('joinError').hidden ? 'Climb aboard' : 'Try again';
  $('joinName').disabled = on;
  $('roomCode').disabled = on;
  $('joinBack').setAttribute('aria-label', on ? 'Stop joining' : 'Back to main menu');
}

// net.js says what went wrong in a few words; the player gets the why
// and what to do about it.
export function joinFailed(message, code) {
  setBusy(false);
  if (message === 'No ship found') {
    showError(`No ship found with code ${code}`, 'Check it with your host. Codes are 4 letters, a dash and a number.');
  } else if (message === 'Ship is full') {
    showError(`Ship ${code} is full`, 'A ship takes 3 crew at most. If someone leaves, a seat opens up.');
  } else if (message === 'Busy') {
    showError('Your own room is still opening', 'Wait for it, or leave it, before joining another ship.');
  } else {
    showError("Couldn't reach the ship", 'Pause your ad blocker for this site, or try another network.');
  }
}

// The saved list, keeping only well-formed entries: an older version or a
// hand edit must not stop the Join screen opening, or throw a player off a
// ship they just boarded.
function savedRecent() {
  const recent = load().recentCrews;
  if (!Array.isArray(recent)) return [];
  return recent
    .filter((r) => r && typeof r === 'object' && typeof r.code === 'string' && CODE.test(r.code))
    .map((r) => ({ code: r.code, host: typeof r.host === 'string' ? r.host : 'The host' }))
    .slice(0, RECENT_MAX);
}

// Aboard: remember whose ship it was, newest first.
export function joinSucceeded(code, hostName) {
  setBusy(false);
  const data = load();
  const recent = savedRecent().filter((r) => r.code !== code);
  recent.unshift({ code, host: hostName });
  save({ ...data, recentCrews: recent.slice(0, RECENT_MAX) });
}

function showError(title, detail) {
  $('joinErrorTitle').textContent = title;
  $('joinErrorDetail').textContent = detail;
  $('joinError').hidden = false;
  $('roomCode').classList.add('bad');
  $('climbLabel').textContent = 'Try again';
}

function clearError() {
  $('joinError').hidden = true;
  $('roomCode').classList.remove('bad');
  if (!busy) $('climbLabel').textContent = 'Climb aboard';
}

function drawRecent() {
  const list = $('recentCrews');
  const recent = savedRecent();
  if (!recent.length) {
    const empty = document.createElement('p');
    empty.className = 'recent-empty';
    empty.textContent = 'Ships you join show up here, so you can hop back aboard in one click.';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(
    ...recent.map(({ code, host }) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'recent-row';
      const who = document.createElement('span');
      who.textContent = `${host}'s ship`;
      const tag = document.createElement('span');
      tag.className = 'recent-code';
      tag.textContent = code;
      row.append(who, tag);
      // Fill in the code and go: the same as typing it and pressing the button.
      row.addEventListener('click', () => {
        $('roomCode').value = code;
        $('joinForm').requestSubmit();
      });
      return row;
    })
  );
}
