// The Settings page: four tabs of controls over whatever screen opened it.
// Every control writes straight to settings.js, which saves and tells the
// game; nothing waits for an Apply button. The page redraws itself from
// the settings whenever they change, so a reset shows at once.

import { ACTIONS, bindKey, isReserved, keyLabel, onSettingsChange, resetSettings, setSetting, settings } from './settings.js';
import { play } from './sound.js';
import { listMics, onVoiceChange, startMic, voiceDelays } from './voice.js';
import { state } from './state.js';

const $ = (id) => document.getElementById(id);

// Rows the Controls tab shows that cannot be rebound (yet).
const FIXED_ROWS = [
  { label: 'Menu / free the mouse', key: 'Esc', note: 'Set by the browser' },
  { label: 'Ping', key: 'Middle click', note: 'Soon' },
];

let overlay = null;
let tab = 'audio';
let opener = null; // focus goes back here when the page closes
let onClosed = null;
let listening = null; // the action waiting for a key, while rebinding
let resetArmed = 0; // until when a second click on Reset counts

// --- the voice delay readout -------------------------------------------------

let delayTimer = 0;
async function drawDelays() {
  const rows = await voiceDelays().catch(() => []);
  const list = $('voiceDelay');
  $('voiceDelayRow').hidden = rows.length === 0;
  list.replaceChildren(
    ...rows.map((r) => {
      const li = document.createElement('li');
      const name = state.players[r.id]?.name ?? (r.id === 'host' ? 'The host' : 'Teammate');
      const head = document.createElement('strong');
      head.textContent = r.total == null ? `${name}: measuring...` : `${name}: about ${r.total} ms`;
      head.className = r.total > 400 ? 'slow' : r.total > 200 ? 'meh' : 'fine';
      const parts = [
        r.network != null && `network ${r.network} ms${r.relayed ? ' (through a relay server)' : ''}`,
        r.buffer != null && `buffer ${r.buffer} ms`,
        r.detour ? `echo filter ${r.detour} ms` : null,
        r.viaHost && (r.hostHop != null ? `passed on by the host ~${r.hostHop} ms` : 'passed on by the host'),
      ].filter(Boolean);
      const detail = document.createElement('span');
      detail.textContent = parts.join(' · ');
      li.append(head, detail);
      return li;
    })
  );
}

export function isSettingsOpen() {
  return overlay && !overlay.hidden;
}

export function initSettings() {
  overlay = $('settingsPage');

  // Sliders, ticks and drop-downs: each names its setting in data-setting.
  for (const input of overlay.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    const write = () => {
      if (input.type === 'checkbox') setSetting(key, input.checked);
      else if (input.type === 'range') setSetting(key, Number(input.value));
      else setSetting(key, input.value);
    };
    input.addEventListener(input.type === 'range' ? 'input' : 'change', write);
  }
  // Let go of a volume slider and hear what it sounds like now.
  for (const id of ['set-master', 'set-sfx']) {
    $(id).addEventListener('change', () => play('ui_ping_chime', 0.6));
  }

  for (const button of overlay.querySelectorAll('.tab-btn')) {
    button.addEventListener('click', () => showTab(button.dataset.tab));
  }
  // Arrow keys move between tabs, as a tab list should.
  overlay.querySelector('.settings-nav').addEventListener('keydown', (e) => {
    const order = ['audio', 'controls', 'video', 'access'];
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = order[(order.indexOf(tab) + step + order.length) % order.length];
    showTab(next);
    $(`tab-${next}`).focus();
  });

  $('settingsDone').addEventListener('click', closeSettings);
  $('settingsBack').addEventListener('click', closeSettings);
  $('settingsReset').addEventListener('click', () => {
    const now = performance.now();
    if (now < resetArmed) {
      resetArmed = 0;
      resetSettings();
      $('settingsReset').textContent = 'Reset to defaults';
      $('bindNote').textContent = 'Everything is back to how it started.';
      return;
    }
    // No dialog boxes in a desktop build: the button asks twice instead.
    resetArmed = now + 3000;
    $('settingsReset').textContent = 'Click again to reset';
    setTimeout(() => {
      if (performance.now() >= resetArmed) $('settingsReset').textContent = 'Reset to defaults';
    }, 3100);
  });

  // Rebinding listens before anything else on the page, so the key or
  // click it catches does nothing else.
  addEventListener('keydown', onKeyCapture, true);
  addEventListener('mousedown', onMouseCapture, true);

  onSettingsChange(() => {
    if (isSettingsOpen()) drawAll();
  });
  // A microphone plugged in, or allowed (only then do they have names).
  onVoiceChange(() => {
    if (isSettingsOpen()) fillMics();
  });
}

// The microphone list: the system default, then each one by name. A chosen
// one that is not plugged in stays in the list, so it is not lost.
async function fillMics() {
  const select = $('set-mic');
  const mics = await listMics();
  const options = [{ id: '', label: 'Default microphone' }, ...mics];
  if (settings.micId && !mics.some((m) => m.id === settings.micId)) {
    options.push({ id: settings.micId, label: 'Chosen microphone (not plugged in)' });
  }
  select.replaceChildren(
    ...options.map(({ id, label }) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      return option;
    })
  );
  select.value = settings.micId;
}

export function openSettings(whenClosed = null) {
  opener = document.activeElement;
  onClosed = whenClosed;
  resetArmed = 0;
  $('settingsReset').textContent = 'Reset to defaults';
  $('bindNote').textContent = '';
  overlay.hidden = false;
  drawAll();
  clearInterval(delayTimer);
  delayTimer = setInterval(drawDelays, 1000);
  drawDelays();
  fillMics();
  showTab(tab);
  $(`tab-${tab}`).focus();
}

export function closeSettings() {
  stopListening();
  clearInterval(delayTimer);
  overlay.hidden = true;
  if (opener && document.contains(opener)) opener.focus();
  const done = onClosed;
  onClosed = null;
  done?.();
}

function showTab(name) {
  tab = name;
  for (const button of overlay.querySelectorAll('.tab-btn')) {
    const on = button.dataset.tab === name;
    button.classList.toggle('active', on);
    button.setAttribute('aria-selected', String(on));
    button.tabIndex = on ? 0 : -1;
  }
  for (const pane of overlay.querySelectorAll('.pane')) pane.hidden = pane.id !== `pane-${name}`;
  stopListening();
  // The voice settings come with a mic test: the microphone has to be on.
  if (name === 'audio') startMic();
}

// --- drawing the controls from the settings -------------------------------

function drawAll() {
  for (const input of overlay.querySelectorAll('[data-setting]')) {
    const value = settings[input.dataset.setting];
    if (input.type === 'checkbox') input.checked = value;
    else if (input.type === 'radio') input.checked = input.value === value;
    else if (input.tagName === 'SELECT' && ![...input.options].some((o) => o.value === String(value))) continue;
    else input.value = String(value);
    if (input.type === 'range') showValue(input);
  }
  // The strength slider only means something while shake is on.
  $('set-roll').disabled = !settings.cameraShake;
  $('rollRow').classList.toggle('soon', !settings.cameraShake);
  // Sensitivity is for the open mic; push-to-talk sends while the key is held.
  $('set-thr').disabled = settings.voiceMode === 'ptt';
  $('sensRow').classList.toggle('soon', settings.voiceMode === 'ptt');
  drawBindings();
}

function showValue(input) {
  const out = overlay.querySelector(`output[for="${input.id}"]`);
  if (!out) return;
  const v = Number(input.value);
  const unit = input.dataset.unit;
  out.textContent = unit === 'x' ? `${(2 ** ((v - 50) / 25)).toFixed(2)}×` : `${v}${unit}`;
}

// Keep the number beside a slider in step while it is dragged.
addEventListener('input', (e) => {
  if (overlay && e.target.matches?.('#settingsPage input[type=range][data-setting]')) showValue(e.target);
});

function drawBindings() {
  const list = $('bindList');
  const rows = ACTIONS.map(({ id, label }) => {
    const row = document.createElement('div');
    row.className = 'bind-row';
    const name = document.createElement('div');
    name.className = 'bind-name';
    name.textContent = label;
    const key = document.createElement('div');
    key.className = 'key-cap';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rebind-btn';
    if (listening === id) {
      row.classList.add('listening');
      key.textContent = 'Press a key…';
      button.textContent = 'Cancel';
      button.dataset.cancel = 'true';
      button.setAttribute('aria-label', `Stop rebinding ${label}`);
    } else {
      key.textContent = keyLabel(settings.keys[id]);
      button.textContent = 'Rebind';
      button.setAttribute('aria-label', `Rebind ${label}, now ${keyLabel(settings.keys[id])}`);
      button.addEventListener('click', () => startListening(id));
    }
    row.append(name, key, button);
    return row;
  });
  for (const fixed of FIXED_ROWS) {
    const row = document.createElement('div');
    row.className = 'bind-row fixed';
    const name = document.createElement('div');
    name.className = 'bind-name';
    name.textContent = fixed.label;
    const key = document.createElement('div');
    key.className = 'key-cap';
    key.textContent = fixed.key;
    const note = document.createElement('span');
    note.className = 'soon-chip';
    note.textContent = fixed.note;
    row.append(name, key, note);
    rows.push(row);
  }
  list.replaceChildren(...rows);
  // Keep the keyboard where the player was: on the Cancel button while
  // listening, on the row's Rebind button afterwards.
  const focusIndex = listening ? ACTIONS.findIndex((a) => a.id === listening) : lastIndex;
  if (focusIndex >= 0 && wantFocus) list.children[focusIndex]?.querySelector('button')?.focus();
  wantFocus = false;
}

let lastIndex = -1;
let wantFocus = false;

function startListening(action) {
  listening = action;
  lastIndex = ACTIONS.findIndex((a) => a.id === action);
  wantFocus = true;
  $('bindNote').textContent = '';
  drawBindings();
}

function stopListening() {
  if (!listening) return;
  listening = null;
  wantFocus = true;
  drawBindings();
}

function finishBinding(code) {
  const action = listening;
  const label = ACTIONS.find((a) => a.id === action).label;
  if (isReserved(code)) {
    $('bindNote').textContent = `${keyLabel(code)} is kept for the browser. Pick another key.`;
    return; // still listening
  }
  listening = null;
  wantFocus = true;
  const swapped = bindKey(action, code); // redraws through onSettingsChange
  if (swapped) {
    const other = ACTIONS.find((a) => a.id === swapped).label;
    $('bindNote').textContent = `${label} is now ${keyLabel(code)}. ${other} moved to ${keyLabel(settings.keys[swapped])}.`;
  } else {
    $('bindNote').textContent = `${label} is now ${keyLabel(code)}.`;
  }
  drawBindings();
}

function onKeyCapture(e) {
  if (!isSettingsOpen()) return;
  if (listening) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      $('bindNote').textContent = 'Rebinding cancelled.';
      stopListening();
      return;
    }
    finishBinding(e.code);
    return;
  }
  if (e.code === 'Escape') {
    e.preventDefault();
    closeSettings();
  }
}

// Any mouse button can be bound, except a click on the Cancel button.
function onMouseCapture(e) {
  if (!isSettingsOpen() || !listening) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  // The click this press turns into must not also press a button
  // underneath, and a right click must not open a menu. Only the events
  // this button really produces are caught: a middle press never becomes
  // a left click, so the next left click must still work.
  const follows = e.button === 0 ? ['click'] : e.button === 2 ? ['auxclick', 'contextmenu'] : ['auxclick'];
  const swallow = (ev) => {
    if (ev.button !== e.button && ev.type !== 'contextmenu') return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };
  for (const type of follows) addEventListener(type, swallow, true);
  const release = (up) => {
    if (up.button !== e.button) return;
    removeEventListener('mouseup', release, true);
    // The click (and on Windows the context menu) follow mouseup at once.
    setTimeout(() => follows.forEach((type) => removeEventListener(type, swallow, true)), 50);
  };
  addEventListener('mouseup', release, true);
  if (e.target.closest?.('[data-cancel]')) {
    $('bindNote').textContent = 'Rebinding cancelled.';
    stopListening();
    return;
  }
  finishBinding(`Mouse${e.button}`);
}
