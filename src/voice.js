// Voice chat: the microphone, when it sends (open mic with a gate, push-
// to-talk, mute), and the audio lines between the crew.
//
// Voices ride on the same WebRTC link as the game itself, so anyone who
// can play can talk: no second connection to set up, no server to find.
// Once a joiner is seated the host adds audio to that link, offering it
// over the game's own channel ('rtc' messages):
//
//   the duplex slot   host's mic -> joiner, joiner's mic -> host
//   relay slots       the other joiners' voices, passed on by the host
//
// After that one offer nothing is renegotiated: whose voice goes in which
// slot changes with replaceTrack, and a 'voice' message tells the joiner
// which slot is whom. A joiner that reconnects gets a fresh link.

import { RULES } from './state.js';
import { onSettingsChange, setSetting, settings } from './settings.js';
import { audioContext, audioRunning, clearVoices, removeVoice, rmsDb, setVoice, setVoiceVolume, updateSpeaking, wakeAudio } from './audio.js';
import { startPulse } from './pulse.js';
import { play } from './sound.js';

const OPEN_HOLD_MS = 450; // the gate stays open this long after the last loud moment, so words are not chopped
const TALKING_DB = -52;
const OFFER_RETRY_MS = 6000;

let post = () => {}; // (conn, msg): sends on a game connection, set by initVoice

const mic = {
  wanted: false, // someone asked for it and nobody has stopped it since
  state: 'off', // off | asking | on | denied | missing | busy | unsupported | error
  track: null, // what the crew hears (enabled only while sending)
  meter: null, // { track, source, analyser, data }: a copy that is always measured
  starting: null,
  level: -120, // dBFS, right now
  openUntil: 0,
  sending: false,
  loudUntil: 0,
};
let pttHeld = false;
const listeners = new Set();

const hostLinks = new Map(); // host: player id -> { id, conn, pc, duplex, relays, ready, tries, timer }
let toHost = null; // joiner: { conn, pc, duplex }
const watched = new WeakSet(); // peer connections whose ICE candidates we pass on
const copies = new WeakMap(); // remote track -> a local copy, for browsers that cannot forward one directly

export function initVoice({ send }) {
  post = send;
  startPulse(30, tick);
  applyVolume();
  onSettingsChange((key) => {
    if (key === null || key === 'voices' || key === 'master') applyVolume();
    if ((key === null || key === 'micId') && mic.wanted) restartMic();
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
  watchPermission();
}

function applyVolume() {
  setVoiceVolume((settings.voices / 100) * (settings.master / 100));
}

// --- the microphone -----------------------------------------------------------

// fn() runs when the microphone starts, stops or fails, and when one is
// plugged in or pulled out (the screens poll voiceStatus() for the rest).
export function onVoiceChange(fn) {
  listeners.add(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

function setMicState(state) {
  if (mic.state === state) return;
  mic.state = state;
  notify();
}

export function startMic() {
  mic.wanted = true;
  wakeAudio();
  if (mic.state === 'on') return Promise.resolve();
  if (mic.starting) return mic.starting;
  if (!navigator.mediaDevices?.getUserMedia) {
    setMicState('unsupported'); // an http page: browsers only lend the mic to https
    return Promise.resolve();
  }
  setMicState('asking');
  mic.starting = openMic().finally(() => (mic.starting = null));
  return mic.starting;
}

export function stopMic() {
  mic.wanted = false;
  dropMic();
  setMicState('off');
}

function restartMic() {
  dropMic();
  mic.state = 'off';
  startMic();
}

async function openMic() {
  const voice = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  const chosen = settings.micId ? { ...voice, deviceId: { exact: settings.micId } } : voice;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: chosen });
  } catch (err) {
    // The chosen microphone is gone (unplugged): the default will do.
    if (!settings.micId || !['OverconstrainedError', 'NotFoundError'].includes(err?.name)) return micFailed(err);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: voice });
    } catch (again) {
      return micFailed(again);
    }
  }
  if (!mic.wanted) {
    stream.getTracks().forEach((t) => t.stop()); // stopped while the browser was asking
    return;
  }
  useStream(stream);
}

function micFailed(err) {
  const name = err?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') setMicState('denied');
  else if (name === 'NotFoundError' || name === 'OverconstrainedError') setMicState('missing');
  else if (name === 'NotReadableError' || name === 'AbortError') setMicState('busy');
  else setMicState('error');
}

function useStream(stream) {
  dropMic();
  const track = stream.getAudioTracks()[0];
  if (!track) return setMicState('missing');
  track.enabled = false; // the gate opens it
  mic.track = track;
  // Unplugged mid-game: carry on with whatever microphone is left.
  track.addEventListener('ended', () => {
    if (mic.track !== track) return;
    dropMic();
    mic.state = 'off';
    if (mic.wanted) setTimeout(() => mic.wanted && startMic(), 400);
    notify();
  });

  const ctx = audioContext();
  if (ctx) {
    const copy = track.clone(); // the gate must hear the mic even while it is not sending
    copy.enabled = true;
    const source = ctx.createMediaStreamSource(new MediaStream([copy]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    mic.meter = { track: copy, source, analyser, data: new Float32Array(analyser.fftSize) };
  }
  attachMic();
  setMicState('on');
}

function dropMic() {
  if (mic.meter) {
    mic.meter.source.disconnect();
    mic.meter.track.stop();
    mic.meter = null;
  }
  if (mic.track) {
    mic.track.stop();
    mic.track = null;
  }
  mic.level = -120;
  mic.sending = false;
  attachMic();
}

// Our microphone into every line that carries it.
function attachMic() {
  const track = mic.track ?? null;
  for (const link of hostLinks.values()) link.duplex.sender.replaceTrack(track).catch(() => {});
  if (toHost?.duplex) toHost.duplex.sender.replaceTrack(track).catch(() => {});
}

export async function listMics() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch {
    return [];
  }
}

// A headset plugged in or pulled out. On the default microphone, follow
// the system to whatever it now calls the default; on a chosen one that
// has gone, fall back. Either way the list in the settings redraws.
async function onDeviceChange() {
  notify();
  if (!mic.wanted) return;
  if (mic.state !== 'on') {
    if (mic.state === 'missing') startMic();
    return;
  }
  if (!settings.micId) {
    restartMic();
    return;
  }
  const mics = await listMics();
  if (!mics.some((m) => m.id === settings.micId)) restartMic();
}

// Allowed later from the address bar: start without making them ask again.
async function watchPermission() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    status.addEventListener('change', () => {
      if (status.state === 'granted' && mic.wanted && mic.state !== 'on') restartMic();
      else if (status.state === 'denied' && mic.state !== 'off') {
        dropMic();
        setMicState('denied');
      }
    });
  } catch {
    // This browser cannot tell us: the Try again button does it instead.
  }
}

// --- when the microphone sends ----------------------------------------------

// Mic sensitivity 0..100 -> the level (dBFS) that opens the gate. 100 is
// an open microphone; lower needs a louder voice, and keeps keyboards out.
export function gateDb() {
  return settings.micSensitivity >= 100 ? -Infinity : -20 - settings.micSensitivity * 0.5;
}

// 30 times a second, from a worker's timer, so a hidden or covered window
// still opens and closes the gate.
function tick() {
  const now = performance.now();
  updateSpeaking(now);
  const running = audioRunning();
  mic.level = mic.meter && running ? rmsDb(mic.meter.analyser, mic.meter.data) : -120;

  let open = false;
  if (!mic.track || settings.micMuted) open = false;
  else if (settings.voiceMode === 'ptt') open = pttHeld;
  else if (!mic.meter || !running) open = true; // nothing to measure with: just send
  else {
    if (mic.level > gateDb()) mic.openUntil = now + OPEN_HOLD_MS;
    open = now < mic.openUntil;
  }
  if (mic.track && mic.track.enabled !== open) mic.track.enabled = open;
  mic.sending = open;
  if (open && mic.level > TALKING_DB) mic.loudUntil = now + 300;
}

// Push-to-talk and mute listen everywhere (the crew screen too), but not
// while a name is being typed.
const typing = (e) => {
  const el = e.target;
  if (!el?.closest) return false;
  if (el.closest('[contenteditable=""], [contenteditable="true"], textarea, select')) return true;
  return el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(el.type);
};
function press(code, e) {
  if (typing(e)) return;
  if (code === settings.keys.talk) pttHeld = true;
  if (code === settings.keys.mute) toggleMute();
}
function release(code) {
  if (code === settings.keys.talk) pttHeld = false;
}
addEventListener('keydown', (e) => !e.repeat && press(e.code, e));
addEventListener('keyup', (e) => release(e.code));
addEventListener('mousedown', (e) => press(`Mouse${e.button}`, e));
addEventListener('mouseup', (e) => release(`Mouse${e.button}`));
addEventListener('blur', () => (pttHeld = false));

export function toggleMute() {
  setSetting('micMuted', !settings.micMuted);
  play('ui_button_click', 0.5);
}

// What the others are told about our microphone.
export function micState() {
  if (mic.state !== 'on') return 'none';
  return settings.micMuted ? 'muted' : 'on';
}

export function voiceStatus(now = performance.now()) {
  return {
    state: mic.state,
    level: mic.level,
    sending: mic.sending,
    talking: mic.sending && mic.loudUntil > now,
    muted: settings.micMuted,
    mode: settings.voiceMode,
  };
}

// --- the lines between the crew ---------------------------------------------

// Messages for voice, from network.js. seatId: who sent it (host only).
export function handleSignal(msg, conn, seatId) {
  if (msg.t === 'voice') return onMap(conn, msg.map);
  if (msg.t !== 'rtc') return;
  if (msg.kind === 'ice') {
    const pc = seatId ? hostLinks.get(seatId)?.pc : toHost?.conn === conn ? toHost.pc : null;
    if (pc && msg.c && typeof msg.c === 'object') pc.addIceCandidate(msg.c).catch(() => {});
    return;
  }
  if (seatId) {
    const link = hostLinks.get(seatId);
    if (!link || link.conn !== conn) return;
    if (msg.kind === 'answer' && typeof msg.sdp === 'string') onAnswer(link, msg.sdp);
    else if (msg.kind === 'failed') retryOffer(link);
  } else if (msg.kind === 'offer' && typeof msg.sdp === 'string') {
    onOffer(conn, msg);
  }
}

// Candidates gathered while adding audio (rare: the audio shares the game's
// own transport) go over the game's channel, not via the signalling server.
function passCandidates(conn, pc) {
  if (watched.has(pc)) return;
  watched.add(pc);
  pc.addEventListener('icecandidate', (e) => {
    if (e.candidate && conn.open) post(conn, { t: 'rtc', kind: 'ice', c: e.candidate.toJSON() });
  });
}

// Voices first when the line is busy: a late word is worse than a late crate.
function prioritize(sender) {
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    params.encodings[0].priority = 'high';
    params.encodings[0].networkPriority = 'high';
    sender.setParameters(params).catch(() => {});
  } catch {
    // not supported here: fine
  }
}

// Host: a joiner has a seat on this connection. Add the audio slots and
// offer them.
export function hostLink(id, conn) {
  hostUnlink(id, { quiet: true });
  const pc = conn.peerConnection;
  if (!pc || pc.signalingState === 'closed') return;
  try {
    const duplex = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const relays = [];
    for (let i = 0; i < RULES.maxPlayers - 2; i++) relays.push(pc.addTransceiver('audio', { direction: 'sendonly' }));
    const link = { id, conn, pc, duplex, relays, ready: false, tries: 0, timer: null };
    hostLinks.set(id, link);
    duplex.sender.replaceTrack(mic.track ?? null).catch(() => {});
    passCandidates(conn, pc);
    sendOffer(link);
  } catch {
    // An old browser without transceivers: this joiner plays without voice.
  }
}

export function hostUnlink(id, { quiet = false } = {}) {
  const link = hostLinks.get(id);
  if (!link) return;
  clearTimeout(link.timer);
  hostLinks.delete(id);
  removeVoice(id);
  if (!quiet) rewire();
}

async function sendOffer(link) {
  try {
    if (link.pc.signalingState === 'have-local-offer') await link.pc.setLocalDescription({ type: 'rollback' });
    const offer = await link.pc.createOffer();
    await link.pc.setLocalDescription(offer);
    if (hostLinks.get(link.id) !== link) return;
    post(link.conn, {
      t: 'rtc',
      kind: 'offer',
      sdp: link.pc.localDescription.sdp,
      duplex: link.duplex.mid,
      relays: link.relays.map((r) => r.mid),
    });
    clearTimeout(link.timer);
    link.timer = setTimeout(() => retryOffer(link), OFFER_RETRY_MS);
  } catch {
    retryOffer(link);
  }
}

function retryOffer(link) {
  clearTimeout(link.timer);
  if (link.ready || hostLinks.get(link.id) !== link || link.pc.signalingState === 'closed') return;
  if (link.tries++ >= 3) return; // this pair plays without voice; the game goes on
  link.timer = setTimeout(() => sendOffer(link), 500);
}

async function onAnswer(link, sdp) {
  if (link.pc.signalingState !== 'have-local-offer') return;
  try {
    await link.pc.setRemoteDescription({ type: 'answer', sdp });
  } catch {
    retryOffer(link);
    return;
  }
  clearTimeout(link.timer);
  link.ready = true;
  prioritize(link.duplex.sender);
  link.relays.forEach((r) => prioritize(r.sender));
  rewire();
}

// Host: whose voice goes down which slot, told to every joiner, and the
// joiners' voices played here.
function rewire() {
  const ready = [...hostLinks.values()].filter((l) => l.ready).sort((a, b) => a.id.localeCompare(b.id));
  for (const link of ready) {
    const others = ready.filter((o) => o !== link);
    const map = { [link.duplex.mid]: 'host' };
    link.relays.forEach((slot, i) => {
      const other = others[i];
      relay(slot.sender, other ? other.duplex.receiver.track : null);
      map[slot.mid] = other?.id ?? null;
    });
    post(link.conn, { t: 'voice', map });
    setVoice(link.id, link.duplex.receiver.track);
  }
}

// Pass one joiner's voice on to another. Most browsers forward a received
// track as it is; where that is refused, a copy made through Web Audio goes.
function relay(sender, track) {
  if (sender.track === track || (track && sender.track === copies.get(track))) return;
  sender.replaceTrack(track).catch(() => {
    const ctx = audioContext();
    if (!track || !ctx) return;
    let copy = copies.get(track);
    if (!copy) {
      const sink = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream([track])).connect(sink);
      copy = sink.stream.getAudioTracks()[0];
      copies.set(track, copy);
    }
    sender.replaceTrack(copy).catch(() => {});
  });
}

// Joiner: the host offers audio on our link. Send our mic in the duplex
// slot, take whatever comes in the relays.
async function onOffer(conn, msg) {
  const pc = conn.peerConnection;
  if (!pc || pc.signalingState === 'closed') return;
  if (toHost?.conn !== conn) {
    clearVoices(); // a new link (we reconnected): the old one's voices are gone
    toHost = { conn, pc, duplex: null };
    passCandidates(conn, pc);
  }
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
    const relays = Array.isArray(msg.relays) ? msg.relays : [];
    for (const transceiver of pc.getTransceivers()) {
      if (transceiver.mid === msg.duplex) {
        transceiver.direction = 'sendrecv';
        toHost.duplex = transceiver;
      } else if (relays.includes(transceiver.mid)) {
        transceiver.direction = 'recvonly';
      }
    }
    if (toHost.duplex) await toHost.duplex.sender.replaceTrack(mic.track ?? null);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    post(conn, { t: 'rtc', kind: 'answer', sdp: pc.localDescription.sdp });
    if (toHost.duplex) prioritize(toHost.duplex.sender);
  } catch {
    post(conn, { t: 'rtc', kind: 'failed' });
  }
}

// Joiner: which slot carries whose voice.
function onMap(conn, map) {
  if (toHost?.conn !== conn || !map || typeof map !== 'object') return;
  const heard = new Set();
  for (const transceiver of toHost.pc.getTransceivers()) {
    const id = map[transceiver.mid];
    if (typeof id !== 'string' || heard.has(id)) continue;
    heard.add(id);
    setVoice(id, transceiver.receiver.track);
  }
  for (const id of knownVoices) if (!heard.has(id)) removeVoice(id);
  knownVoices = heard;
}
let knownVoices = new Set(); // joiner: the voices the last map named

// Back at the menu: every line and voice goes (the mic is stopped apart).
export function endVoice() {
  for (const link of hostLinks.values()) clearTimeout(link.timer);
  hostLinks.clear();
  toHost = null;
  knownVoices = new Set();
  clearVoices();
}
