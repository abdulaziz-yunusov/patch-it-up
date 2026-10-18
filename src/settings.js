// Every player setting: its default, what it may be, and where it is
// kept (inside the one save, via save.js). Anything that cares listens
// with onSettingsChange() and reads the current value from `settings`.
//
// A save from an older version, or one edited by hand, can hold anything:
// each value is checked on the way in, and a bad one falls back to the
// default rather than breaking the game.

import { load, save } from './save.js';

// The actions a key can be bound to, in the order the Controls tab lists them.
export const ACTIONS = [
  { id: 'forward', label: 'Move forward' },
  { id: 'back', label: 'Move back' },
  { id: 'left', label: 'Move left' },
  { id: 'right', label: 'Move right' },
  { id: 'jump', label: 'Jump' },
  { id: 'interact', label: 'Interact' },
  { id: 'drop', label: 'Drop item' },
  { id: 'bell', label: 'Ring bell (pilot)' },
];

const DEFAULT_KEYS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  interact: 'KeyE',
  drop: 'Mouse2',
  bell: 'KeyF',
};

// Esc always frees the mouse (the browser insists); the rest would close
// the game, reload it or open the browser's own tools.
const RESERVED = ['Escape', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu'];

const range = (min, max) => (v) => (Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : undefined);
const oneOf = (...options) => (v) => (options.includes(v) ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);

const SPEC = {
  master: { def: 80, check: range(0, 100) },
  sfx: { def: 90, check: range(0, 100) },
  sensitivity: { def: 50, check: range(0, 100) },
  invertY: { def: false, check: bool },
  fov: { def: 80, check: range(60, 100) },
  quality: { def: 'medium', check: oneOf('low', 'medium', 'high') },
  showFps: { def: false, check: bool },
  rain: { def: true, check: bool },
  colorblind: { def: 'off', check: oneOf('off', 'redgreen', 'blueyellow') },
  roleSymbols: { def: true, check: bool },
  subtitles: { def: true, check: bool },
  cameraMotion: { def: 100, check: range(0, 100) },
  headBob: { def: true, check: bool },
  textSize: { def: 'normal', check: oneOf('normal', 'large', 'xlarge') },
};

export const settings = { keys: { ...DEFAULT_KEYS } };
const listeners = new Set();

function readSaved() {
  const saved = load().settings;
  const from = saved && typeof saved === 'object' ? saved : {};
  for (const [key, { def, check }] of Object.entries(SPEC)) {
    settings[key] = check(from[key]) ?? def;
  }
  // Keys: only real-looking codes, never a reserved one, never one key on
  // two actions. Anything doubtful goes back to its default.
  const keys = { ...DEFAULT_KEYS };
  const savedKeys = from.keys && typeof from.keys === 'object' ? from.keys : {};
  for (const { id } of ACTIONS) {
    const code = savedKeys[id];
    if (typeof code === 'string' && /^[A-Za-z0-9]{1,24}$/.test(code) && !RESERVED.includes(code)) keys[id] = code;
  }
  const seen = new Set();
  for (const { id } of ACTIONS) {
    if (seen.has(keys[id])) keys[id] = DEFAULT_KEYS[id];
    seen.add(keys[id]);
  }
  // A default can still collide with a saved key: then all go back.
  settings.keys = new Set(Object.values(keys)).size === ACTIONS.length ? keys : { ...DEFAULT_KEYS };
}

function store() {
  const out = { keys: { ...settings.keys } };
  for (const key of Object.keys(SPEC)) out[key] = settings[key];
  save({ ...load(), settings: out });
}

function changed(key) {
  for (const fn of listeners) fn(key);
}

// fn(key) runs after any setting changes; key is null after a reset.
export function onSettingsChange(fn) {
  listeners.add(fn);
}

export function setSetting(key, value) {
  const spec = SPEC[key];
  if (!spec) return false;
  const clean = spec.check(value);
  if (clean === undefined || clean === settings[key]) return false;
  settings[key] = clean;
  store();
  changed(key);
  return true;
}

export function resetSettings() {
  for (const [key, { def }] of Object.entries(SPEC)) settings[key] = def;
  settings.keys = { ...DEFAULT_KEYS };
  store();
  changed(null);
}

export function isReserved(code) {
  return RESERVED.includes(code);
}

// Bind an action to a key or mouse button. If another action had that
// key, the two swap, so nothing is ever left unbound. Returns the action
// that was swapped (or null), or false if the key is not allowed.
export function bindKey(action, code) {
  if (!(action in settings.keys) || isReserved(code)) return false;
  const old = settings.keys[action];
  if (old === code) return null;
  const other = Object.keys(settings.keys).find((a) => settings.keys[a] === code) ?? null;
  settings.keys = { ...settings.keys, [action]: code };
  if (other) settings.keys[other] = old;
  store();
  changed('keys');
  return other;
}

// What a key code looks like to a player: KeyW -> W, Mouse2 -> Right click.
const NAMED = {
  Space: 'Space',
  Mouse0: 'Left click',
  Mouse1: 'Middle click',
  Mouse2: 'Right click',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  CapsLock: 'Caps Lock',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

export function keyLabel(code) {
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

// The four movement keys as one word when they are letters (WASD),
// otherwise spelled out.
export function moveLabel() {
  const parts = ['forward', 'left', 'back', 'right'].map((a) => keyLabel(settings.keys[a]));
  return parts.every((p) => p.length === 1) ? parts.join('') : parts.join(' ');
}

readSaved();
