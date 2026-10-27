// The music: a calm tune at the dock, a steady one in the air, an epic one
// when things go wrong, and a short sting for each ending. main.js says
// which mood fits (setMood) and when an ending starts (sting); this file
// fades between the loops and keeps them seamless.
//
// The tracks are original, written for the game (art/music/compose.py
// makes them). Each is an Ogg file with an MP3 beside it for browsers
// that cannot decode Ogg. Loops play from decoded buffers, so they repeat
// without a gap, and each keeps its place while another mood plays: back
// at the dock, the harbour tune carries on where it left off.

import { audioContext, musicInput } from './audio.js';
import { onSettingsChange, settings } from './settings.js';

const BASE = `${import.meta.env.BASE_URL}music/`;
// Exact loop lengths, in seconds: whole bars, so the end meets the start.
const LOOPS = { harbour: 77.142857, underway: 68.571429, storm: 53.333333 };
const STINGS = ['down', 'home'];
const LEVEL = 0.8; // the whole mix, at 100% music
const FADE_IN = 2.2; // seconds
const FADE_OUT = 1.6;
const RESTART_AFTER = 25; // seconds of silence before the epic loop starts over from its top
const DUCK = 0.5; // under a teammate's voice
// Each track is fetched and decoded only when it may soon be wanted: the
// menu needs the harbour tune alone, the dock the flight tune too, and
// the flight the storm tune and the stings.
const NEXT = { harbour: ['underway'], underway: ['storm', ...STINGS], storm: [...STINGS] };

const tracks = {}; // name -> { buffer, loading, gain, source, startedAt, offset, stopAt, silentSince }
let ctx = null;
let mix = null;
let mood = null;
let ducked = false;
let allowed = false; // browsers keep sound off until the first click or key

function ready() {
  if (mix) return true;
  if (!allowed) return false;
  ctx = audioContext();
  const input = musicInput();
  if (!ctx || !input) return false;
  mix = ctx.createGain();
  mix.gain.value = volume();
  mix.connect(input);
  return true;
}

function volume() {
  return LEVEL * (settings.music / 100) * (settings.master / 100) * (ducked ? DUCK : 1);
}

onSettingsChange((key) => {
  if (mix && (key === null || key === 'music' || key === 'master')) mix.gain.setTargetAtTime(volume(), ctx.currentTime, 0.05);
});

async function decode(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return ctx.decodeAudioData(await response.arrayBuffer());
}

function load(name) {
  const track = (tracks[name] ??= { buffer: null, loading: null, gain: null, source: null, startedAt: 0, offset: 0, stopAt: 0, silentSince: 0 });
  track.loading ??= decode(`${BASE}${name}.ogg`)
    .catch(() => decode(`${BASE}${name}.mp3`))
    .then((buffer) => {
      track.buffer = buffer;
      if (name === mood) start(name); // asked for while it was still on its way
    })
    .catch(() => {}); // no music is better than a broken game
  return track;
}

// Where in its loop a playing track is now.
function position(track, name) {
  return (track.offset + ctx.currentTime - track.startedAt) % LOOPS[name];
}

function start(name) {
  const track = load(name);
  if (!track.buffer || track.source) return;
  if (name === 'storm' && track.silentSince && ctx.currentTime - track.silentSince > RESTART_AFTER) track.offset = 0;
  track.gain ??= ctx.createGain();
  track.gain.connect(mix);
  track.gain.gain.cancelScheduledValues(ctx.currentTime);
  track.gain.gain.setValueAtTime(0, ctx.currentTime);
  track.gain.gain.setTargetAtTime(1, ctx.currentTime, FADE_IN / 3);
  const source = ctx.createBufferSource();
  source.buffer = track.buffer;
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = Math.min(LOOPS[name], track.buffer.duration);
  source.connect(track.gain);
  source.start(ctx.currentTime, track.offset % source.loopEnd);
  track.source = source;
  track.startedAt = ctx.currentTime;
  track.stopAt = 0;
}

function fadeOut(name, seconds = FADE_OUT) {
  const track = tracks[name];
  if (!track?.source || track.stopAt) return;
  track.gain.gain.cancelScheduledValues(ctx.currentTime);
  track.gain.gain.setTargetAtTime(0, ctx.currentTime, seconds / 3);
  track.stopAt = ctx.currentTime + seconds * 1.6;
}

// A fading track that is wanted again comes straight back up.
function revive(name) {
  const track = tracks[name];
  if (!track?.source || !track.stopAt) return false;
  track.stopAt = 0;
  track.gain.gain.cancelScheduledValues(ctx.currentTime);
  track.gain.gain.setTargetAtTime(1, ctx.currentTime, FADE_IN / 3);
  return true;
}

// 'harbour', 'underway', 'storm', or null for silence.
export function setMood(next, { fast = false } = {}) {
  if (next === mood) return;
  mood = next;
  apply(fast);
}

function apply(fast = false) {
  if (!ready()) return;
  for (const name of Object.keys(LOOPS)) {
    if (name === mood) {
      if (!revive(name)) start(name);
    } else fadeOut(name, fast ? 0.5 : FADE_OUT);
  }
  for (const name of NEXT[mood] ?? []) load(name);
}

// The first click or key press: the sound can start, and the music with it
// (the context is made inside the click, so it is allowed to run).
function allow() {
  if (allowed) return;
  allowed = true;
  removeEventListener('pointerdown', allow, true);
  removeEventListener('keydown', allow, true);
  apply();
}
addEventListener('pointerdown', allow, true);
addEventListener('keydown', allow, true);

// The ending's sting, over whatever is left of the loops.
export function sting(name) {
  if (!ready()) return;
  const track = tracks[name];
  if (!track?.buffer) return;
  const source = ctx.createBufferSource();
  source.buffer = track.buffer;
  source.connect(mix);
  source.start();
  stings.push(name);
}
const stings = []; // for testing: the stings played so far

// Softer while a teammate is talking.
export function duckMusic(on) {
  if (on === ducked) return;
  ducked = on;
  if (mix) mix.gain.setTargetAtTime(volume(), ctx.currentTime, on ? 0.15 : 0.6);
}

// Every frame: stop the loops that have faded out, keeping their place.
export function updateMusic() {
  if (!mix) return;
  for (const [name, track] of Object.entries(tracks)) {
    if (!track.source || !track.stopAt || ctx.currentTime < track.stopAt) continue;
    track.offset = position(track, name);
    track.source.stop();
    track.source.disconnect();
    track.source = null;
    track.stopAt = 0;
    track.silentSince = ctx.currentTime;
  }
}

// For testing: what is playing, and how loud.
export function musicState() {
  const playing = Object.fromEntries(
    Object.entries(tracks)
      .filter(([, t]) => t.source)
      .map(([name, t]) => [name, +t.gain.gain.value.toFixed(2)])
  );
  return { mood, loaded: Object.keys(tracks).filter((n) => tracks[n].buffer), playing, stings, running: ctx?.state === 'running', volume: mix ? +mix.gain.value.toFixed(2) : 0 };
}
