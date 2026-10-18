// PeerJS host and join: the room code, the four messages, the rates.
//
//   hello    joiner -> host   once, your name
//   welcome  host -> joiner   your player id and the whole state
//   input    joiner -> host   30 per second: keys, look, E, drop, role
//   state    host -> all      20 per second: players, breaches, power

import Peer from 'peerjs';
import { RULES } from './state.js';

const PREFIX = 'patchitup-';
const WORDS = ['CRAB', 'KITE', 'MOTH', 'BOLT', 'REEF', 'WREN', 'GULL', 'TIDE'];

export function makeCode() {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${word}-${Math.floor(Math.random() * 9) + 1}`;
}

export class Net {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.conns = new Map(); // host: player id -> connection
    this.hostConn = null; // joiner: the one connection that matters
    this.lastInputAt = 0;
    this.lastStateAt = 0;

    // Filled in by main.js.
    this.onHello = null; // (name) -> { id, snapshot } or null when the ship is full
    this.onInput = null; // (id, input)
    this.onLeave = null; // (id)
    this.onState = null; // (snapshot)
    this.onLost = null; // () the host went away
  }

  // The host takes the room code as its peer id, so joiners can find it.
  async host(code) {
    await this.open(PREFIX + code);
    this.isHost = true;
    this.peer.on('connection', (conn) => this.accept(conn));
  }

  async join(code, name) {
    await this.open(null);
    return new Promise((resolve, reject) => {
      const conn = this.peer.connect(PREFIX + code, { serialization: 'json', reliable: true });
      const giveUp = setTimeout(() => reject(new Error('No ship found')), 9000);
      const fail = (err) => {
        clearTimeout(giveUp);
        reject(new Error(err?.type === 'peer-unavailable' ? 'No ship found' : 'Connection failed'));
      };
      this.peer.on('error', fail);

      conn.on('open', () => conn.send({ t: 'hello', name }));
      conn.on('data', (msg) => {
        if (msg.t === 'welcome') {
          clearTimeout(giveUp);
          this.peer.off('error', fail);
          this.hostConn = conn;
          resolve(msg);
        } else if (msg.t === 'full') {
          clearTimeout(giveUp);
          reject(new Error('Ship is full'));
        } else if (msg.t === 'state') {
          this.onState?.(msg.s);
        }
      });
      conn.on('close', () => {
        if (this.hostConn === conn) this.onLost?.();
      });
    });
  }

  // Joiner -> host, 30 times a second. Returns true when it actually went.
  sendInput(input, now) {
    if (!this.hostConn?.open) return false;
    if (now - this.lastInputAt < 1000 / RULES.inputHz) return false;
    this.lastInputAt = now;
    this.hostConn.send({ t: 'input', i: input });
    return true;
  }

  // Host -> everyone, 20 times a second.
  broadcast(snapshot, now) {
    if (!this.isHost) return false;
    if (now - this.lastStateAt < 1000 / RULES.stateHz) return false;
    this.lastStateAt = now;
    for (const conn of this.conns.values()) {
      if (conn.open) conn.send({ t: 'state', s: snapshot });
    }
    return true;
  }

  // A browser that closed abruptly never sends anything again: the host
  // hangs up on it once main.js decides it has gone quiet.
  drop(id) {
    const conn = this.conns.get(id);
    if (!conn) return;
    conn.close();
    this.conns.delete(id);
  }

  close() {
    for (const conn of this.conns.values()) conn.close();
    this.conns.clear();
    this.hostConn = null;
    this.isHost = false;
    this.peer?.destroy();
    this.peer = null;
  }

  // A joiner knocking: give them a seat, or turn them away.
  accept(conn) {
    let seatId = null;
    conn.on('data', (msg) => {
      if (msg.t === 'hello' && !seatId) {
        const seat = this.onHello?.(msg.name);
        if (!seat) {
          conn.send({ t: 'full' });
          setTimeout(() => conn.close(), 300);
          return;
        }
        seatId = seat.id;
        this.conns.set(seatId, conn);
        conn.send({ t: 'welcome', id: seat.id, s: seat.snapshot });
      } else if (msg.t === 'input' && seatId) {
        this.onInput?.(seatId, msg.i);
      }
    });
    conn.on('close', () => {
      if (!seatId) return;
      this.conns.delete(seatId);
      this.onLeave?.(seatId);
    });
    conn.on('error', () => {});
  }

  // An id already in use means that room code is taken: pick another.
  open(id) {
    return new Promise((resolve, reject) => {
      this.peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
      const onError = (err) => {
        reject(new Error(err.type === 'unavailable-id' ? 'taken' : err.type));
      };
      this.peer.once('error', onError);
      this.peer.once('open', () => {
        this.peer.off('error', onError);
        resolve();
      });
    });
  }
}
