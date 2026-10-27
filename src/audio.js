// Web Audio for teammates' voices: each one comes from where that player
// stands (left or right, near or far), muffled through a bulkhead when
// they are in another room, and is checked for who is talking.
//
// Chrome only cancels echo for sound played from a peer connection
// through an <audio> element, not for Web Audio. So on Chrome the mixed
// voices take a detour through a peer connection to ourselves and come
// out of an <audio> element: the crew hears no echo even without
// headphones. Other browsers cancel echo on everything and play directly.

const CHROMIUM = /Chrome\/|Chromium\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent);
const SPEAKING_DB = -52; // a voice louder than this is someone talking
const SPEAKING_HOLD_MS = 300; // and still counts as talking this long after

let ctx = null;
let bus = null; // every voice, before the volume setting
let out = null; // the voices and the music together, on their way to the speakers
let output = null; // { element, pcs } while the Chrome loopback plays
let route = 'direct'; // how voices reach the speakers: 'direct', or 'loopback' on Chrome
let volume = 1; // the voices slider times the master volume
const voices = new Map(); // player id -> { track, element, source, gain, filter, pan, analyser, data, loudUntil }

export function audioContext() {
  if (ctx) return ctx;
  const Context = window.AudioContext ?? window.webkitAudioContext;
  if (!Context) return null;
  ctx = new Context({ latencyHint: 'interactive' });
  bus = ctx.createGain();
  bus.gain.value = volume;
  out = ctx.createGain();
  bus.connect(out);
  if (CHROMIUM) routeThroughLoopback();
  else out.connect(ctx.destination);
  return ctx;
}

// Where the music goes in: out the same way as the voices, so on Chrome
// it takes the echo-cancelling detour too and a crew without headphones
// does not send the music back down each other's microphones.
export function musicInput() {
  return audioContext() ? out : null;
}

// Whether the sound is up and running (without starting it).
export function audioRunning() {
  return ctx?.state === 'running';
}

// Browsers keep sound off until the player clicks or presses a key; every
// click and key press asks again, so sound starts at the first chance.
export function wakeAudio() {
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  if (output?.element.paused) output.element.play().catch(() => {});
  for (const voice of voices.values()) {
    if (voice.element.paused) voice.element.play().catch(() => {});
  }
}
addEventListener('pointerdown', wakeAudio, true);
addEventListener('keydown', wakeAudio, true);

// For testing: whether Chrome's echo-cancelling detour is in use.
export function outputRoute() {
  return route;
}

// --- Chrome's echo-cancellation detour --------------------------------------

async function routeThroughLoopback() {
  const sink = ctx.createMediaStreamDestination();
  sink.channelCount = 2;
  out.connect(sink);
  const send = new RTCPeerConnection();
  const take = new RTCPeerConnection();
  let fell = false;
  const fallBack = () => {
    // The detour did not come up (mDNS blocked, say): play directly.
    // Voices still work; only the echo cancellation is lost.
    if (fell) return;
    fell = true;
    route = 'direct';
    send.close();
    take.close();
    if (output) output.element.srcObject = null;
    output = null;
    try {
      out.disconnect(sink);
    } catch {
      // already apart
    }
    out.connect(ctx.destination);
  };
  try {
    send.onicecandidate = (e) => e.candidate && take.addIceCandidate(e.candidate).catch(() => {});
    take.onicecandidate = (e) => e.candidate && send.addIceCandidate(e.candidate).catch(() => {});
    for (const track of sink.stream.getAudioTracks()) send.addTrack(track, sink.stream);
    const arrived = new Promise((resolve) => (take.ontrack = (e) => resolve(e.streams[0] ?? new MediaStream([e.track]))));
    const offer = await send.createOffer();
    await send.setLocalDescription(offer);
    await take.setRemoteDescription({ type: 'offer', sdp: stereo(offer.sdp) });
    const answer = await take.createAnswer();
    await take.setLocalDescription(answer);
    await send.setRemoteDescription({ type: 'answer', sdp: stereo(answer.sdp) });
    const stream = await Promise.race([arrived, new Promise((_, no) => setTimeout(no, 4000))]);
    const element = new Audio();
    element.autoplay = true;
    element.srcObject = stream;
    output = { element, pcs: [send, take] };
    route = 'loopback';
    element.play().catch(() => {}); // before the first click: wakeAudio() retries
    // Connected, or given up on: watch for the line failing later too.
    const watch = () => {
      if (['failed', 'closed'].includes(send.connectionState)) fallBack();
    };
    send.addEventListener('connectionstatechange', watch);
    setTimeout(() => {
      if (output && send.connectionState !== 'connected') fallBack();
    }, 6000);
  } catch {
    fallBack();
  }
}

// Opus carries one channel unless both ends ask for two: left and right
// is the whole point here. Plenty of bits, as it never leaves the machine.
function stereo(sdp) {
  const pt = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp)?.[1];
  if (!pt) return sdp;
  return sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`), (line, params) => {
    const extra = ['stereo=1', 'sprop-stereo=1', 'maxaveragebitrate=192000'].filter((p) => !params.includes(p.split('=')[0]));
    return `a=fmtp:${pt} ${[params, ...extra].join(';')}`;
  });
}

// --- the voices --------------------------------------------------------------

// Play this player's voice from this track (a new track replaces the old).
export function setVoice(id, track) {
  const old = voices.get(id);
  if (old?.track === track) return;
  if (old) removeVoice(id);
  if (!track || !audioContext()) return;
  const stream = new MediaStream([track]);
  // Chrome sends a remote track into Web Audio only while some media
  // element is playing it too. This one is muted: Web Audio does the sound.
  const element = new Audio();
  element.muted = true;
  element.srcObject = stream;
  element.play().catch(() => {});

  const source = ctx.createMediaStreamSource(stream);
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 20000;
  const pan = ctx.createStereoPanner();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(gain).connect(filter).connect(pan).connect(bus);
  source.connect(analyser);
  voices.set(id, { track, element, source, gain, filter, pan, analyser, data: new Float32Array(analyser.fftSize), loudUntil: 0 });
}

export function removeVoice(id) {
  const voice = voices.get(id);
  if (!voice) return;
  voice.source.disconnect();
  voice.gain.disconnect();
  voice.filter.disconnect();
  voice.pan.disconnect();
  voice.element.srcObject = null;
  voices.delete(id);
}

export function clearVoices() {
  for (const id of [...voices.keys()]) removeVoice(id);
}

export function hasVoice(id) {
  return voices.has(id);
}

// Teammates' voices slider times the master volume. Kept until the sound
// starts (the first host, join or mic test), so the menu makes none.
export function setVoiceVolume(level) {
  volume = Math.max(0, level);
  if (bus) bus.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
}

// Who is talking, from how loud their voice is right now.
export function updateSpeaking(now) {
  for (const voice of voices.values()) {
    if (rmsDb(voice.analyser, voice.data) > SPEAKING_DB) voice.loudUntil = now + SPEAKING_HOLD_MS;
  }
}

export function isSpeaking(id, now = performance.now()) {
  return (voices.get(id)?.loudUntil ?? 0) > now;
}

export function rmsDb(analyser, data) {
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / data.length);
  return rms > 0 ? 20 * Math.log10(rms) : -120;
}

// --- where each voice comes from ----------------------------------------------

// The ship's three rooms stand in a row along x, with bulkheads between.
function roomAt(x, z) {
  if (Math.abs(x) > 12 || Math.abs(z) > 3.1) return 'outside';
  if (x < -4) return 'engine';
  if (x > 4) return 'helm';
  return 'power';
}

// listener: { x, z, yaw } in ship space; sources: id -> { x, z }; spatial:
// false puts every voice in the middle at full volume (the crew screen,
// or the setting turned off). doorOpen: at the dock, the cargo door joins
// the power room and the outside.
export function placeVoices(listener, sources, { spatial, doorOpen }) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const here = spatial ? roomAt(listener.x, listener.z) : null;
  for (const [id, voice] of voices) {
    let gain = 1;
    let pan = 0;
    let cutoff = 20000;
    const at = sources[id];
    if (spatial && at) {
      const dx = at.x - listener.x;
      const dz = at.z - listener.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.3) {
        // Forward is -sin/-cos of the yaw; right is cos/-sin.
        const side = (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / dist;
        const ahead = (-dx * Math.sin(listener.yaw) - dz * Math.cos(listener.yaw)) / dist;
        pan = side * 0.7;
        if (ahead < -0.3) cutoff = 9000; // behind you: a little duller
      }
      // Full volume close by, fading to half across the ship: never so
      // quiet that the pilot cannot reach the mechanic.
      gain = Math.max(0.5, 1 - Math.max(0, dist - 2.5) / 30);
      const there = roomAt(at.x, at.z);
      const throughDoor = doorOpen && [here, there].includes('outside') && [here, there].includes('power');
      if (there !== here && !throughDoor) {
        gain *= 0.85;
        cutoff = Math.min(cutoff, 1800); // through a bulkhead
      }
    }
    voice.gain.gain.setTargetAtTime(gain, t, 0.08);
    voice.pan.pan.setTargetAtTime(pan, t, 0.08);
    voice.filter.frequency.setTargetAtTime(cutoff, t, 0.08);
  }
}
