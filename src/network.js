// PeerJS host and join: the room code, the messages, the rates.
//
//   hello    joiner -> host   once per connection: your name, and your
//                             seat's token when you are coming back
//   welcome  host -> joiner   your player id, your seat's token, the whole state
//   full     host -> joiner   no seat for you
//   input    joiner -> host   30 per second: keys, look, E, drop, role. It is
//                             also how the host knows you are still there.
//   state    host -> all      20 per second: players, breaches, power
//   bye      either way       leaving on purpose: nobody waits for you to come back
//   rtc      either way       voice: adding audio to this same link (see voice.js)
//   voice    host -> joiner   voice: whose voice comes in which audio slot
//
// Messages go as JSON text on a 'raw' channel, encoded here: once per
// broadcast rather than once per joiner, with numbers cut to 3 decimals.
// (PeerJS's own 'json' mode silently drops anything over 16 KB.)

import Peer from 'peerjs';
import { RULES } from './state.js';

const PREFIX = 'patchitup-';

// The signalling server that introduces players (the game itself runs peer
// to peer). The free public PeerJS server unless a build names another:
// VITE_PEER_HOST, and optionally VITE_PEER_PORT, VITE_PEER_PATH and
// VITE_PEER_SECURE ('false' for plain ws://), e.g. in a .env file.
const env = import.meta.env ?? {};
const SERVER = env.VITE_PEER_HOST
  ? {
      host: env.VITE_PEER_HOST,
      port: Number(env.VITE_PEER_PORT) || 443,
      path: env.VITE_PEER_PATH || '/',
      secure: env.VITE_PEER_SECURE !== 'false',
    }
  : {};
const WORDS = ['CRAB', 'KITE', 'MOTH', 'BOLT', 'REEF', 'WREN', 'GULL', 'TIDE'];
const OPEN_TIMEOUT_MS = 10000; // reaching the signalling server
const JOIN_TIMEOUT_MS = 12000; // finding the ship and opening a line to it
const BACKLOG_BYTES = 32 * 1024; // a line this far behind skips a state: the next one replaces it anyway
const GOODBYE_MS = 250; // time for a last message to get out before the line is cut

export function makeCode() {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${word}-${Math.floor(Math.random() * 9) + 1}`;
}

// Millimetres and thousandths of a radian are plenty, and half the bytes.
const trim = (key, value) =>
  typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 1000) / 1000 : value;
const encode = (msg) => JSON.stringify(msg, trim);
function decode(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const msg = JSON.parse(raw);
    return msg && typeof msg === 'object' ? msg : null;
  } catch {
    return null;
  }
}

// A reliable line delivers everything in order, so one that falls behind
// would fall further behind with every state. Skip one instead.
function backedUp(conn) {
  return (conn.dataChannel?.bufferedAmount ?? 0) > BACKLOG_BYTES || conn.bufferSize > 0;
}

function send(conn, text) {
  if (!conn?.open) return false;
  try {
    conn.send(text);
    return true;
  } catch {
    return false; // the line died between the check and the send
  }
}

export class Net {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.conns = new Map(); // host: player id -> the connection that seat listens to now
    this.hostConn = null; // joiner: the one connection that matters
    this.nextInputAt = 0;
    this.nextStateAt = 0;
    this.serverWatch = null;

    // Filled in by main.js.
    this.onHello = null; // (name, token) -> { id, token, snapshot } or null when the ship is full
    this.onInput = null; // (id, input)
    this.onDrop = null; // (id) a joiner's line broke: hold their seat for a while
    this.onLeave = null; // (id) a joiner said goodbye
    this.onState = null; // (snapshot, hostTime)
    this.onLost = null; // () the line to the host broke
    this.onClosed = null; // () the host said goodbye
    this.onSeated = null; // (id, conn) host: a joiner's seat now listens to this connection
    this.onSignal = null; // (msg, conn, id) voice messages; id is the sender's seat on the host, null on a joiner
  }

  // Any message on a given connection (voice.js uses it for its own).
  post(conn, msg) {
    return send(conn, encode(msg));
  }

  // The host takes the room code as its peer id, so joiners can find it.
  async host(code) {
    const peer = await this.open(PREFIX + code);
    this.isHost = true;
    this.nextStateAt = 0;
    peer.on('connection', (conn) => {
      if (peer === this.peer) this.accept(conn);
      else conn.close();
    });
    // A joiner that vanished mid-handshake, a server hiccup: nothing to do
    // here, but an error with no listener must not go unhandled.
    peer.on('error', () => {});
    // The signalling server is only needed to find the ship: the crew's
    // own lines run peer to peer and carry on without it. But while it has
    // lost us nobody new, and nobody coming back, can find the room, so
    // keep knocking until it lets us back on.
    const knock = () => {
      if (peer !== this.peer || peer.destroyed || !peer.disconnected) return;
      try {
        peer.reconnect();
      } catch {
        // destroyed in the meantime
      }
    };
    peer.on('disconnected', () => setTimeout(knock, 500));
    this.serverWatch = setInterval(knock, 4000);
  }

  // token: the seat this browser held before its line broke, if any.
  async join(code, name, token = null) {
    const peer = await this.open(null);
    return new Promise((resolve, reject) => {
      const conn = peer.connect(PREFIX + code, { serialization: 'raw', reliable: true });
      let settled = false;
      const finish = (err, welcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(giveUp);
        peer.off('error', onPeerError);
        if (err) {
          conn.close();
          reject(err);
        } else {
          resolve(welcome);
        }
      };
      // The server answers at once if no such ship exists, so a ship that
      // never answers was found but could not be reached.
      const giveUp = setTimeout(() => finish(new Error('Connection failed')), JOIN_TIMEOUT_MS);
      const onPeerError = (err) =>
        finish(new Error(err?.type === 'peer-unavailable' ? 'No ship found' : 'Connection failed'));
      peer.on('error', onPeerError);

      conn.on('open', () => send(conn, encode({ t: 'hello', name, token })));
      conn.on('data', (raw) => {
        const msg = decode(raw);
        if (!msg) return;
        if (!settled) {
          if (msg.t === 'welcome') {
            this.hostConn = conn;
            finish(null, msg);
          } else if (msg.t === 'full') {
            finish(new Error('Ship is full'));
          }
          return;
        }
        if (this.hostConn !== conn) return; // an old line, already given up on
        if (msg.t === 'state') this.onState?.(msg.s, msg.at);
        else if (msg.t === 'rtc' || msg.t === 'voice') this.onSignal?.(msg, conn, null);
        else if (msg.t === 'bye') {
          this.hostConn = null;
          this.onClosed?.();
        }
      });
      conn.on('close', () => {
        if (!settled) finish(new Error('Connection failed'));
        else if (this.hostConn === conn) {
          this.hostConn = null;
          this.onLost?.();
        }
      });
      conn.on('error', () => {});
    });
  }

  get connected() {
    return !!this.hostConn?.open;
  }

  // Joiner -> host, 30 times a second. Returns true when it actually went.
  sendInput(input, now) {
    const conn = this.hostConn;
    if (!conn?.open || now < this.nextInputAt || backedUp(conn)) return false;
    this.nextInputAt = nextTick(this.nextInputAt, now, 1000 / RULES.inputHz);
    return send(conn, encode({ t: 'input', i: input }));
  }

  // Host -> everyone, 20 times a second. at: the host's clock, so joiners
  // can space the crew's movement out evenly however the packets bunch up.
  broadcast(snapshot, now) {
    if (!this.isHost || now < this.nextStateAt) return false;
    this.nextStateAt = nextTick(this.nextStateAt, now, 1000 / RULES.stateHz);
    if (!this.conns.size) return true;
    const text = encode({ t: 'state', at: Math.round(now), s: snapshot });
    for (const conn of this.conns.values()) {
      if (!backedUp(conn)) send(conn, text);
    }
    return true;
  }

  // Host: stop listening to a seat's line (it went quiet, or its player
  // was removed). Its late 'close' is ignored, so it can never knock out
  // whoever sits in that seat next.
  release(id, { bye = false } = {}) {
    const conn = this.conns.get(id);
    if (!conn) return;
    this.conns.delete(id);
    if (bye) send(conn, encode({ t: 'bye' }));
    setTimeout(() => conn.close(), bye ? GOODBYE_MS : 0);
  }

  // Leave: everyone still connected hears goodbye first, unless bye is
  // false (a joiner whose line broke and who is about to try again).
  close({ bye = true } = {}) {
    clearInterval(this.serverWatch);
    this.serverWatch = null;
    const peer = this.peer;
    const conns = [...this.conns.values(), this.hostConn].filter(Boolean);
    this.conns.clear();
    this.hostConn = null;
    this.isHost = false;
    this.peer = null;
    let said = false;
    if (bye) for (const conn of conns) said = send(conn, encode({ t: 'bye' })) || said;
    if (peer) setTimeout(() => peer.destroy(), said ? GOODBYE_MS : 0);
  }

  // A joiner knocking: give them a seat (their old one, if they bring its
  // token), or turn them away.
  accept(conn) {
    let seatId = null;
    const current = () => seatId !== null && this.conns.get(seatId) === conn;
    conn.on('data', (raw) => {
      const msg = decode(raw);
      if (!msg) return;
      if (msg.t === 'hello' && seatId === null) {
        const token = typeof msg.token === 'string' ? msg.token : null;
        const seat = this.onHello?.(String(msg.name ?? ''), token);
        if (!seat) {
          send(conn, encode({ t: 'full' }));
          setTimeout(() => conn.close(), GOODBYE_MS);
          return;
        }
        seatId = seat.id;
        // Back on a new line before the old one was noticed dead: the new
        // one takes over first, so the old one's 'close' finds it is not
        // current and changes nothing.
        const old = this.conns.get(seatId);
        this.conns.set(seatId, conn);
        if (old && old !== conn) old.close();
        send(conn, encode({ t: 'welcome', id: seat.id, token: seat.token, s: seat.snapshot }));
        this.onSeated?.(seat.id, conn);
      } else if (!current()) {
        // Nothing from a line that has been replaced or released.
      } else if (msg.t === 'input') {
        this.onInput?.(seatId, msg.i);
      } else if (msg.t === 'rtc') {
        this.onSignal?.(msg, conn, seatId);
      } else if (msg.t === 'bye') {
        this.conns.delete(seatId);
        this.onLeave?.(seatId);
        setTimeout(() => conn.close(), GOODBYE_MS);
      }
    });
    conn.on('close', () => {
      if (!current()) return;
      this.conns.delete(seatId);
      this.onDrop?.(seatId);
    });
    conn.on('error', () => {});
  }

  // A fresh peer (any old one is shut down first). An id already in use
  // means that room code is taken: the error says 'taken'.
  open(id) {
    this.close({ bye: false });
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, { debug: 0, ...SERVER }) : new Peer({ debug: 0, ...SERVER });
      this.peer = peer;
      const fail = (err) => {
        clearTimeout(giveUp);
        peer.off('open', onOpen);
        peer.off('error', fail);
        if (this.peer === peer) this.peer = null;
        peer.destroy();
        reject(new Error(err?.type === 'unavailable-id' ? 'taken' : err?.type ?? 'network'));
      };
      const onOpen = () => {
        clearTimeout(giveUp);
        peer.off('error', fail);
        resolve(peer);
      };
      const giveUp = setTimeout(() => fail({ type: 'network' }), OPEN_TIMEOUT_MS);
      peer.once('error', fail);
      peer.once('open', onOpen);
    });
  }
}

// A steady rate however the frames fall: the next send is one period after
// the last was due, not after it went, so 60 fps frames still give 30 a
// second. Far behind (a stall), it starts afresh rather than bursting.
function nextTick(due, now, period) {
  return due + period > now - period ? Math.max(due + period, now - period / 2) : now + period;
}
