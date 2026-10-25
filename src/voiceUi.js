// What the player sees of voice chat: the Voice check cards on the join
// and crew screens, the mic test in the settings, and the in-game list of
// who is talking (top left).
//
// Names come from other people's browsers, so they only ever go into the
// page as text.

import { isSpeaking } from './audio.js';
import { keyLabel, setSetting, settings } from './settings.js';
import { gateDb, startMic, voiceStatus } from './voice.js';

const SVG = 'http://www.w3.org/2000/svg';
const MIC = ['M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'];
const MIC_OFF = [...MIC, 'M4 4l16 16'];

// The meters run from -70 dBFS (silence) to -10 (shouting).
const meterFraction = (db) => Math.min(1, Math.max(0, (db + 70) / 60));

const PROBLEMS = {
  off: 'Microphone off',
  asking: 'Allow the microphone in your browser…',
  denied: 'Microphone blocked: allow it from the icon in the address bar',
  missing: 'No microphone found. You can still hear the crew.',
  busy: 'Another app is using your microphone',
  unsupported: 'Voice needs the https:// address of the game',
  error: "Couldn't start your microphone",
};

function statusLine(v) {
  if (v.state !== 'on') return PROBLEMS[v.state] ?? PROBLEMS.error;
  if (v.muted) return `Muted · press ${keyLabel(settings.keys.mute)} to unmute`;
  if (v.mode === 'ptt') return v.sending ? 'Talking: the crew can hear you' : `Hold ${keyLabel(settings.keys.talk)} to talk`;
  return v.sending ? 'The crew can hear you' : 'Mic on · say something to test it';
}

export function initVoiceUi() {
  for (const card of document.querySelectorAll('.voice-check')) {
    card.querySelector('.voice-retry').addEventListener('click', () => startMic());
    card.querySelector('.voice-ptt').addEventListener('change', (e) => setSetting('voiceMode', e.target.checked ? 'ptt' : 'open'));
  }
}

// Every frame: the cards and the mic test where they are on screen, the
// in-game list while playing.
export function updateVoiceUi(now, { players, localId, playing, colorOf }) {
  const v = voiceStatus(now);
  for (const card of document.querySelectorAll('.voice-check')) {
    if (card.offsetParent === null) continue; // its screen is hidden
    drawCard(card, v);
  }
  const test = document.getElementById('micTest');
  if (test?.offsetParent) drawMeter(test, v);
  const note = document.getElementById('micTestNote');
  if (note?.offsetParent) note.textContent = v.state === 'on' ? statusLine(v) : PROBLEMS[v.state] ?? PROBLEMS.error;
  drawHud(now, v, { players, localId, playing, colorOf });
}

function drawCard(card, v) {
  const text = statusLine(v);
  const status = card.querySelector('.voice-status');
  if (status.textContent !== text) status.textContent = text;
  card.classList.toggle('live', v.state === 'on' && !v.muted);
  card.classList.toggle('problem', v.state !== 'on' && v.state !== 'asking');
  drawMeter(card.querySelector('.meter'), v);
  const retry = card.querySelector('.voice-retry');
  const broken = ['off', 'denied', 'missing', 'busy', 'error'].includes(v.state);
  retry.hidden = !broken;
  retry.textContent = v.state === 'off' ? 'Turn on microphone' : 'Try again';
  const ptt = card.querySelector('.voice-ptt');
  ptt.checked = settings.voiceMode === 'ptt';
}

// The bar shows how loud the mic hears you; the notch is where the gate
// opens (open mic only). Green while the crew can hear you.
function drawMeter(meter, v) {
  const fill = meter.querySelector('.meter-fill');
  fill.style.width = `${Math.round(meterFraction(v.state === 'on' ? v.level : -120) * 100)}%`;
  fill.classList.toggle('sending', v.sending);
  const gate = meter.querySelector('.meter-gate');
  const db = gateDb();
  gate.hidden = v.mode === 'ptt' || !Number.isFinite(db);
  if (!gate.hidden) gate.style.left = `${Math.round(meterFraction(db) * 100)}%`;
}

// --- in game ---------------------------------------------------------------------

let hudKey = '';

function icon(paths) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function drawHud(now, v, { players, localId, playing, colorOf }) {
  const hud = document.getElementById('voiceHud');
  if (!playing) {
    if (hudKey) hud.replaceChildren();
    hudKey = '';
    return;
  }
  const crew = Object.values(players).sort((a, b) => (a.id === localId ? -1 : b.id === localId ? 1 : a.id.localeCompare(b.id)));
  const rows = crew.map((p) => {
    const me = p.id === localId;
    let mode;
    let note = '';
    if (me) {
      if (v.state !== 'on') [mode, note] = ['off', 'No mic'];
      else if (v.muted) [mode, note] = ['muted', `Muted (${keyLabel(settings.keys.mute)})`];
      else if (v.talking) mode = 'talking';
      else if (v.mode === 'ptt') [mode, note] = ['idle', `Hold ${keyLabel(settings.keys.talk)}`];
      else mode = 'idle';
    } else if (p.signal === 'lost') [mode, note] = ['off', 'Reconnecting'];
    else if (p.mic === 'muted') [mode, note] = ['muted', 'Muted'];
    else if (p.mic === 'none') [mode, note] = ['off', 'No mic'];
    else mode = isSpeaking(p.id, now) ? 'talking' : 'idle';
    return { name: me ? `${p.name} (you)` : p.name, color: colorOf(p.role), mode, note };
  });
  const key = JSON.stringify(rows);
  if (key === hudKey) return;
  hudKey = key;
  hud.replaceChildren(
    ...rows.map(({ name, color, mode, note }) => {
      const row = document.createElement('div');
      row.className = `vh-row ${mode}`;
      row.style.setProperty('--role', color);
      const mic = document.createElement('span');
      mic.className = 'vh-mic';
      mic.append(icon(mode === 'muted' || mode === 'off' ? MIC_OFF : MIC));
      const label = document.createElement('span');
      label.className = 'vh-name';
      label.textContent = name;
      row.append(mic, label);
      if (note) {
        const extra = document.createElement('span');
        extra.className = 'vh-note';
        extra.textContent = note;
        row.append(extra);
      }
      return row;
    })
  );
}
