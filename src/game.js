// The game rules. Only the host runs these: everyone else sends inputs
// and draws the state that comes back.

import { KIT_HOME, ROUTES, RULES, SHOUTS, livePower, newLog, newRaid, playerCount, propHomes, roleTaken, state } from './state.js';
import { PLAYER, lookDirection } from './player.js';
import { BREACH_SPOTS, DOCK, HELM_STANCE, HOOK_HEIGHT, HOOK_SPOTS, SHIP, hookX } from './world.js';
import { hatsOpen, routeOpen } from './log.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const between = ([lo, hi]) => lo + Math.random() * (hi - lo);

// The host's own clocks: when the hull next springs a leak, and when the
// next rock comes at the bow.
let nextBreachIn = 0;
let nextRockIn = 0;
let nextStormIn = 0;
let nextRaidIn = 0;
let raidsLeft = 0;
let raidShotIn = 0; // alongside: the next cannonball
let raidHookIn = 0; // alongside: the next grapple
let boarded = 0; // boarders sent this flight, to take turns at who comes
const BOARDER_KINDS = ['deckhand', 'bosun', 'gunner']; // from pirates.glb

const ROLE_NAMES = { mechanic: 'Mechanic', engineer: 'Engineer', pilot: 'Pilot' };
const TUBE_NAMES = ['Engines', 'Shields', 'Lift'];
const ROOM_OF = Object.fromEntries(BREACH_SPOTS.map((spot) => [spot.id, spot.room]));

const holdsKit = (player) => state.kit.heldBy === player.id;
const handsFull = (player) => holdsKit(player) || player.fuse || player.bucket;

// Fire: which room each station is in, what a room is called, and where a
// fire can spread to (the rooms stand in a row: engine, power, helm).
const ROOMS = ['engine', 'power', 'helm'];
export const ROOM_LABEL = { engine: 'engine room', power: 'power room', helm: 'helm' };
const STATION_ROOM = { stoke: 'engine', power: 'power', powerDown: 'power', steam: 'power', wheel: 'helm' };
const NEXT_ROOMS = { engine: ['power'], power: ['engine', 'helm'], helm: ['power'] };

// The rooms stand in a row along x, with bulkheads at x = -4 and 4.
export const roomAt = (x) => (x < -4 ? 'engine' : x > 4 ? 'helm' : 'power');
const pirateIn = (room) => Object.values(state.raid.boarders).some((b) => roomAt(b.x) === room);
export const hookCount = () => (state.raid.phase === 'alongside' ? Object.keys(state.raid.hooks).length : 0);

// A crew short of three shares out the empty jobs: a player does their
// own role's work, and that of any role nobody wears (or whose wearer's
// line has dropped, until they are back).
export const covers = (player, role) =>
  !!player &&
  (player.role === role || !Object.values(state.players).some((p) => p.role === role && p.signal !== 'lost'));

// How hard the flight pushes, by the crew aboard: hazards come slower
// for two, slower still for one (RULES.crewPace; 1 for a full crew).
export const pace = () => RULES.crewPace[clamp(playerCount(), 1, RULES.maxPlayers)] ?? 1;
export const fireSpreadSeconds = () => RULES.fireSpreadSeconds / pace();

// What each player did this flight, for the crew's titles at the end.
function credit(player, key, n = 1) {
  if (!player || (state.phase !== 'flight' && state.phase !== 'takeoff')) return;
  const mine = (state.stats[player.id] ??= {});
  mine[key] = Math.max(0, (mine[key] ?? 0) + n);
}
const uncredit = (player, key) => credit(player, key, -1);

// Can this player use this station right now? null means yes; otherwise
// the reason, which the prompt shows instead of the action. The host asks
// the same question before it runs anything, so a stale prompt on a
// joiner's screen never lets anything through.
export function canUse(interact, player) {
  if (!player) return 'Not aboard';
  if (interact.role && !covers(player, interact.role)) return `${ROLE_NAMES[interact.role] ?? interact.role} only`;
  const burning = STATION_ROOM[interact.action];
  if (burning && state.fires[burning]) return `The ${ROOM_LABEL[burning]} is on fire!`;
  if (burning && pirateIn(burning)) return 'A pirate is in the way!';
  switch (interact.action) {
    case 'cutHook':
      return state.raid.hooks[interact.hook] ? null : 'Already cut';
    case 'shove':
      return state.raid.boarders[interact.boarder] ? null : 'Already overboard';
    case 'patch':
      if (!holdsKit(player)) return 'Needs the patch kit';
      if (state.kit.planks <= 0) return 'Kit is empty: restock at the supply rack';
      return null;
    case 'pickup':
      if (player.fuse) return 'Hands full: fit the fuse first';
      return player.bucket ? 'Hands full: use the bucket first' : null;
    case 'restock':
      if (!holdsKit(player)) return 'Bring the patch kit here';
      return state.kit.planks >= RULES.kitPlanks ? 'The kit is full' : null;
    case 'takeFuse':
      if (player.fuse) return 'You already carry a fuse';
      if (handsFull(player)) return 'Hands full: drop what you carry';
      return state.fuses <= 0 ? 'No spare fuses left' : null;
    case 'steam':
      if (state.phase === 'flight' && state.ventReadyIn > 0) return `Valve building pressure: ${Math.ceil(state.ventReadyIn)} s`;
      return null;
    case 'powerDown':
      if (state.blown[interact.index]) return `${TUBE_NAMES[interact.index]} fuse blown: tube locked`;
      return state.power[interact.index] <= 0 ? `${TUBE_NAMES[interact.index]} tube is empty` : null;
    case 'power':
      if (state.blown[interact.index]) return `${TUBE_NAMES[interact.index]} fuse blown: tube locked`;
      return state.power[interact.index] >= RULES.maxPerTube ? `${TUBE_NAMES[interact.index]} tube is full` : null;
    case 'fuse':
      if (!state.blown.some(Boolean)) return 'Every fuse is fine';
      return player.fuse ? null : 'Needs a spare fuse from the mechanic';
    case 'takeBucket':
      if (player.bucket) return 'You already carry a bucket';
      return handsFull(player) ? 'Hands full: drop what you carry' : null;
    case 'douse':
      if (!state.fires[interact.room]) return 'The fire is out';
      return player.bucket ? null : 'Needs water: buckets in the engine room';
    default:
      return null;
  }
}

// What each action name does, run by the host on behalf of one player.
export const ACTIONS = {
  patch: (interact, player) => patchBreach(interact.id, player),
  restock: (interact, player) => restockKit(player),
  takeFuse: (interact, player) => takeFuse(player),
  fuse: (interact, player) => fitFuse(player),
  takeBucket: (interact, player) => takeBucket(player),
  douse: (interact, player) => douseFire(interact.room, player),
  power: (interact, player) => movePower(interact.index, player),
  powerDown: (interact, player) => powerDown(interact.index, player),
  wheel: (interact, player, body) => toggleWheel(player, body),
  pickup: (interact, player) => pickUpKit(player),
  role: (interact, player) => pickRole(player, interact.takes),
  bell: (interact, player) => ringBell(player),
  cabinBell: () => ringCabinBell(),
  steam: (interact, player) => ventSteam(player),
  stoke: (interact, player) => stokeFurnace(player),
  shout: (interact, player) => shoutDownTube(player),
  hat: (interact, player) => nextHat(player),
  lamps: () => toggleLamps(),
  route: (interact, player) => nextRoute(player),
  kick: (interact, player) => kickProp(interact.prop, player),
  cutHook: (interact, player) => cutHook(interact.hook, player),
  shove: (interact, player) => shoveBoarder(interact.boarder, player),
};

// --- the dock's toys ---------------------------------------------------

// The dock bell. With a crew short of three, the host's ring is the word
// to cast off without the rest; ringing again goes back to waiting.
export function ringBell(player) {
  state.bell += 1;
  if (player?.id === 'host' && state.phase === 'lobby' && playerCount() < RULES.maxPlayers) {
    state.shortHanded = !state.shortHanded;
  }
  return true;
}

// In flight the cabin bell is the storm alarm: rung while a storm wall is
// coming, it warns the whole crew to brace.
export function ringCabinBell() {
  state.cabinBell += 1;
  if (state.phase === 'flight' && state.storm.active) state.storm.warned = true;
  return true;
}

// The power room's valve: a puff of steam at the dock, and in the air it
// cools every tube, so one held at full power can stay there.
export function ventSteam(player) {
  state.steam += 1;
  if (state.phase === 'flight') {
    state.tubeHeat = [0, 0, 0];
    state.ventReadyIn = RULES.ventCooldown; // the valve builds pressure again before the next vent
    credit(player, 'power');
  }
  return true;
}

// At the dock it only makes the fire roar; from the climb on a shovel of
// coal is what keeps the engineer's power coming (coal shovelled on the way
// up is banked: the furnace only starts burning down once the round begins).
export function stokeFurnace(player) {
  state.stoke += 1;
  if (state.phase === 'takeoff' || state.phase === 'flight') {
    state.heat = Math.min(1, state.heat + RULES.heatPerStoke);
    credit(player, 'stokes');
  }
  return true;
}

export function shoutDownTube(player) {
  const line = SHOUTS[Math.floor(Math.random() * SHOUTS.length)];
  state.shout = { count: state.shout.count + 1, name: player.name, line };
  return true;
}

// The mirror offers the hats this player's own log has opened.
export function nextHat(player) {
  player.hat = ((player.hat ?? 0) + 1) % hatsOpen(player.stars ?? 0);
  return true;
}

export function toggleLamps() {
  state.lampsOn = !state.lampsOn;
  return true;
}

// Only the host picks the route, and only while still at the dock, from
// the routes the host's own log has opened.
export function nextRoute(player) {
  if (player.id !== 'host' || state.phase !== 'lobby') return false;
  for (let step = 1; step < ROUTES.length; step++) {
    const next = (state.route + step) % ROUTES.length;
    if (routeOpen(next)) {
      state.route = next;
      return true;
    }
  }
  return false;
}

const route = () => ROUTES[state.route] ?? ROUTES[0];

// The inside of the dock rails, less a crate's half width.
const PROP_BOUNDS = { minX: -5.5, maxX: 5.5, minZ: DOCK.zNear - 19.5, maxZ: DOCK.zNear - 0.5 };

export function kickProp(name, player) {
  const home = propHomes[name];
  if (!home) return false;
  const now = state.props[name] ?? { x: home.x, y: home.y, z: home.z, ry: 0 };
  const ahead = lookDirection(player.yaw ?? 0, 0);
  state.props[name] = {
    ...now,
    vx: ahead.x * RULES.kickSpeed,
    vy: RULES.kickLift,
    vz: ahead.z * RULES.kickSpeed,
    spin: (Math.random() - 0.5) * 8,
    moving: true,
  };
  // Nothing stacks once the pile is disturbed: anything left hanging in
  // the air drops to the planks.
  for (const [other, otherHome] of Object.entries(propHomes)) {
    const p = state.props[other] ?? { x: otherHome.x, y: otherHome.y, z: otherHome.z, ry: 0 };
    if (other !== name && p.y > DOCK.top + otherHome.h + 0.05 && !p.moving) {
      state.props[other] = { ...p, vx: 0, vy: 0, vz: 0, spin: 0, moving: true };
    }
  }
  return true;
}

// Host only: kicked props fly, bounce off the rails and slide to a stop.
export function tickProps(dt) {
  for (const [name, p] of Object.entries(state.props)) {
    if (!p.moving) continue;
    const floor = DOCK.top + (propHomes[name]?.h ?? 0.4);
    p.vy -= 14 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.ry += p.spin * dt;

    const onFloor = p.y <= floor;
    if (onFloor) {
      p.y = floor;
      p.vy = Math.abs(p.vy) > 1.2 ? -p.vy * 0.3 : 0;
      const grip = Math.max(0, 1 - 4 * dt); // planks slow a sliding crate fast
      p.vx *= grip;
      p.vz *= grip;
      p.spin *= grip;
    }
    const { minX, maxX, minZ, maxZ } = PROP_BOUNDS;
    if (p.x < minX || p.x > maxX) {
      p.x = clamp(p.x, minX, maxX);
      p.vx *= -0.4;
    }
    if (p.z < minZ || p.z > maxZ) {
      p.z = clamp(p.z, minZ, maxZ);
      p.vz *= -0.4;
    }
    if (onFloor && p.vy === 0 && Math.hypot(p.vx, p.vz) < 0.1) p.moving = false;
  }
}

// A plank from the kit over the hole.
export function patchBreach(id, player) {
  if (!state.breaches[id] || canUse({ action: 'patch' }, player)) return false;
  state.breaches[id] = false;
  state.patched += 1;
  state.kit.planks -= 1;
  credit(player, 'patched');
  return true;
}

// The supply rack fills the kit back up.
export function restockKit(player) {
  if (canUse({ action: 'restock' }, player)) return false;
  state.kit.planks = RULES.kitPlanks;
  return true;
}

// A spare fuse from the crate in the engine room: empty hands only.
export function takeFuse(player) {
  if (canUse({ action: 'takeFuse' }, player)) return false;
  state.fuses -= 1;
  player.fuse = true;
  return true;
}

// The fuse box in the power room: a new fuse brings the first dead tube
// back, with the units that were stuck in it.
export function fitFuse(player) {
  if (canUse({ action: 'fuse' }, player)) return false;
  const tube = state.blown.findIndex(Boolean);
  state.blown[tube] = false;
  state.tubeHeat[tube] = 0;
  player.fuse = false;
  credit(player, 'power');
  return true;
}

// A bucket of water from the rail in the engine room: empty hands only.
export function takeBucket(player) {
  if (canUse({ action: 'takeBucket' }, player)) return false;
  player.bucket = true;
  return true;
}

// Throw it on the fire: enough buckets and the room is safe again.
export function douseFire(room, player) {
  if (canUse({ action: 'douse', room }, player)) return false;
  player.bucket = false;
  credit(player, 'doused');
  const fire = state.fires[room];
  fire.water += 1;
  if (fire.water >= RULES.fireBuckets) state.fires[room] = null;
  return true;
}

// A room catches fire (if it is not already burning).
export function ignite(room) {
  if (!ROOMS.includes(room) || state.fires[room]) return false;
  state.fires[room] = { burn: 0, spread: 0, water: 0 };
  if (room === 'helm') {
    // Nobody can hold a burning wheel: the pilot lets go.
    for (const player of Object.values(state.players)) player.atWheel = false;
    state.steering = 0;
  }
  return true;
}

// Call-outs: one key, and what it says depends on who you are and what
// is going on. Everyone sees it; a call-out every two seconds at most.
const lastCallout = new Map();
export function callOut(player) {
  const now = Date.now();
  if (now - (lastCallout.get(player.id) ?? 0) < RULES.calloutCooldownMs) return false;
  lastCallout.set(player.id, now);
  state.callout = {
    count: state.callout.count + 1,
    id: player.id,
    name: player.name,
    role: player.role,
    text: calloutText(player),
  };
  return true;
}

function calloutText(player) {
  const flying = state.phase === 'flight';
  const fire = ROOMS.find((room) => state.fires[room]);
  const raid = state.raid;
  const side = raid.side > 0 ? 'starboard' : 'port';
  const boarder = Object.values(raid.boarders)[0];
  if (player.role === 'pilot') {
    if (flying && state.storm.active) return 'Storm wall! Brace and raise the shields!';
    if (flying && raid.phase === 'sighted') return `Pirates to ${side}! Power to engines!`;
    if (flying && boarder) return `Pirate aboard in the ${ROOM_LABEL[roomAt(boarder.x)]}!`;
    if (flying && raid.phase === 'alongside') return 'Pirates! Cut the grapples! Shields up!';
    return flying && state.rock.active ? 'Need engines! Rock ahead!' : 'Need power!';
  }
  if (fire && player.role !== 'mechanic') return `Fire in the ${ROOM_LABEL[fire]}!`;
  if (flying && boarder) return `Pirate aboard in the ${ROOM_LABEL[roomAt(boarder.x)]}!`;
  if (flying && raid.phase === 'alongside' && hookCount()) return 'Cutting the grapples!';
  if (player.role === 'engineer') {
    if (state.blown.some(Boolean)) return 'Need a fuse!';
    if (flying && state.heat < 0.35) return 'Stoke the furnace!';
    if (Object.entries(state.breaches).some(([id, open]) => open && ROOM_OF[id] === 'power')) return 'Breach in the power room!';
    return 'Power is set!';
  }
  if (player.role === 'mechanic') return fire ? 'Fetching water!' : 'On my way!';
  return 'Ahoy!';
}

export function openCount() {
  return Object.values(state.breaches).filter(Boolean).length;
}

// Tear a new hole somewhere nothing is leaking yet: on the given side of
// the hull (1 starboard, -1 port) if there is room there. Returns the spot.
function openBreach(side = 0) {
  const sound = BREACH_SPOTS.filter((spot) => !state.breaches[spot.id]);
  if (!sound.length) return null;
  const near = side ? sound.filter((spot) => Math.sign(spot.z) === side) : [];
  const pool = near.length ? near : sound;
  const spot = pool[Math.floor(Math.random() * pool.length)];
  state.breaches[spot.id] = true;
  state.opened += 1;
  return spot;
}

// E on a lever takes a spare unit if the furnace has made one, and
// otherwise pulls one over from the fullest other tube.
// A tube with a blown fuse is locked: nothing goes in or comes out.
export function movePower(index, player) {
  if (state.power[index] >= RULES.maxPerTube || state.blown[index]) return false;
  credit(player, 'power');
  if (state.spare > 0) {
    state.spare -= 1;
    state.power[index] += 1;
    return true;
  }
  let from = -1;
  state.power.forEach((units, i) => {
    if (i !== index && !state.blown[i] && units > 0 && (from === -1 || units > state.power[from])) from = i;
  });
  if (from === -1) {
    uncredit(player, 'power');
    return false;
  }
  state.power[from] -= 1;
  state.power[index] += 1;
  return true;
}

// The handle under each lever: a unit out of that tube and back into the
// spares, for the engineer to place where it is needed.
export function powerDown(index, player) {
  if (state.blown[index] || state.power[index] <= 0) return false;
  state.power[index] -= 1;
  state.spare += 1;
  credit(player, 'power');
  return true;
}

// One pair of hands on the wheel at a time.
export function toggleWheel(player, body) {
  if (player.atWheel) {
    player.atWheel = false;
    body.atWheel = false;
    state.steering = 0; // the wheel spins back to centre when let go
    return true;
  }
  if (Object.values(state.players).some((p) => p.atWheel)) return false;
  player.atWheel = true;
  body.atWheel = true;
  body.position.set(HELM_STANCE.x, body.position.y, HELM_STANCE.z);
  return true;
}

// While you hold the wheel, A and D steer instead of walking. Let go and
// the wheel eases back to centre; steering against the lock turns it
// faster, so a pilot can swing from one side to the other. Pure, so a
// joining pilot's browser can turn its own wheel the same way (main.js).
export function nextSteering(steering, keys, dt) {
  const turn = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  if (!turn) {
    const back = Math.max(0, Math.abs(steering) - RULES.steerReturn * dt);
    return Math.sign(steering) * back;
  }
  const against = steering !== 0 && Math.sign(steering) !== turn;
  const rate = RULES.steerRate * (against ? RULES.steerCounter : 1);
  return clamp(steering + turn * rate * dt, -1, 1);
}

export function steerShip(dt, keys) {
  state.steering = nextSteering(state.steering, keys, dt);
}

// How well the helm answers: slowly with starved engines, barely when dead.
export const helmAnswer = () => {
  const engines = livePower(0);
  return engines === 0 ? 0.25 : engines <= RULES.enginesLow ? 0.5 : 1;
};

// How fast the ship is sliding sideways right now, in drift units a
// second, from the wheel and any grapples; 0 once she is pressed against
// the edge she is heading for. Every browser draws the slide from this.
export function sideSpeed() {
  if (state.phase !== 'flight') return 0;
  const v = state.steering * RULES.driftRate * helmAnswer() + state.raid.side * RULES.hookPull * hookCount();
  if ((v > 0 && state.drift >= 1) || (v < 0 && state.drift <= -1)) return 0;
  return v;
}

export function pickUpKit(player) {
  if (state.kit.heldBy || player.fuse || player.bucket) return false;
  state.kit.heldBy = player.id;
  return true;
}

// Where a dropped kit may lie: inside the hull, in the room you stand in,
// a little clear of every wall (the bulkheads stand at x = -4 and 4).
const ROOM_X = { engine: [-SHIP.length / 2, -4], power: [-4, 4], helm: [4, SHIP.length / 2] };
const KIT_CLEAR = SHIP.thickness / 2 + 0.3;
function kitSpot(x, z) {
  const [lo, hi] = ROOM_X[roomAt(x)];
  return {
    x: clamp(x, lo + KIT_CLEAR, hi - KIT_CLEAR),
    z: clamp(z, -SHIP.width / 2 + KIT_CLEAR, SHIP.width / 2 - KIT_CLEAR),
  };
}

// The drop key: a bucket is spilt, a carried fuse goes back in its crate,
// the kit goes down just in front of you, on your side of any wall.
export function dropKit(player, body, yaw) {
  if (player.bucket) {
    player.bucket = false; // the water goes on the floor
    return true;
  }
  if (player.fuse) {
    player.fuse = false;
    state.fuses += 1;
    return true;
  }
  if (state.kit.heldBy !== player.id) return false;
  const ahead = lookDirection(yaw, 0);
  const spot = kitSpot(body.position.x + ahead.x * 0.5, body.position.z + ahead.z * 0.5);
  state.kit.heldBy = null;
  state.kit.x = spot.x;
  state.kit.y = KIT_HOME.y;
  state.kit.z = spot.z;
  return true;
}

// A locker hands out its uniform only if nobody else is wearing it.
export function pickRole(player, role) {
  if (!role || roleTaken(role, player.id)) return false;
  player.role = role;
  return true;
}

// Inside the hull: within its walls, above the dock, and under its roof.
// Someone standing on the roof (flown up from the dock) is not aboard, or
// the ship would cast off with them stuck outside for the whole flight.
export function aboard(player) {
  return (
    Math.abs(player.x) < SHIP.length / 2 - 0.3 &&
    Math.abs(player.z) < SHIP.width / 2 - 0.1 &&
    player.y > -0.2 &&
    player.y < SHIP.wallHeight
  );
}

// A fresh round: full altitude, three minutes, a sound hull.
export function startRound() {
  state.altitude = RULES.altitudeStart;
  state.timeLeft = RULES.roundSeconds;
  state.breaches = {};
  state.opened = 0;
  state.patched = 0;
  state.power = [2, 2, 2];
  state.spare = 0;
  state.heat = RULES.heatStart;
  state.climb = 0;
  state.steering = 0;
  state.drift = 0;
  state.rock = { lane: 0, distance: 0, active: false };
  state.result = null;
  state.tubeHeat = [0, 0, 0];
  state.ventReadyIn = 0;
  state.blown = [false, false, false];
  state.fuses = RULES.spareFuses;
  state.drain = 0;
  state.kit.planks = RULES.kitPlanks;
  state.fires = { engine: null, power: null, helm: null };
  state.storm = { active: false, left: 0, warned: false, hits: 0 };
  state.raid = newRaid();
  state.log = newLog();
  state.stats = {};
  for (const player of Object.values(state.players)) {
    player.fuse = false;
    player.bucket = false;
    player.braced = false;
  }
  // A smaller crew gets the same flight, slower: hazards further apart.
  const slow = 1 / pace();
  nextBreachIn = between(route().breachEvery) * slow;
  nextRockIn = route().rockEvery * slow;
  nextStormIn = (RULES.stormFirstAt + Math.random() * 15) * slow;
  nextRaidIn = RULES.raidFirstAt + Math.random() * 15;
  raidsLeft = route().raids ? Math.max(1, Math.round(route().raids * pace())) : 0;
  boarded = 0;
}

// Three minutes in the air: the clock, the holes, the helm, the rocks,
// fires and storm walls. crew gives the host's bodies and inputs, which a
// storm wall needs to throw people about.
export function tickFlight(dt, crew = {}) {
  if (state.phase !== 'flight') return;
  state.timeLeft = Math.max(0, state.timeLeft - dt);

  nextBreachIn -= dt;
  if (nextBreachIn <= 0) {
    openBreach();
    nextBreachIn = between(route().breachEvery) / pace();
  }

  tickFurnace(dt);
  tickTubes(dt);
  tickFires(dt);
  if (state.phase !== 'flight') return; // the fire took the ship
  tickStorm(dt, crew);
  tickRaid(dt);

  // The ship always sinks a little, every open hole bleeds more height
  // away, and every pirate grapple drags her down; only the lift tube
  // gives it back.
  state.climb =
    livePower(2) * RULES.liftPerUnit -
    RULES.sinkRate -
    openCount() * RULES.altitudeLossPerBreach -
    hookCount() * RULES.hookDrag;
  state.altitude = clamp(state.altitude + state.climb * dt, 0, RULES.altitudeStart);

  // The helm answers slowly when the engines are starved, and barely at
  // all when they are dead.
  state.drift = clamp(state.drift + state.steering * RULES.driftRate * helmAnswer() * dt, -1, 1);
  // Grapples haul her over toward the pirate ship.
  state.drift = clamp(state.drift + state.raid.side * RULES.hookPull * hookCount() * dt, -1, 1);

  nextRockIn -= dt;
  if (!state.rock.active && nextRockIn <= 0) {
    state.rock = { lane: Math.random() * 2 - 1, distance: RULES.rockDistance, active: true };
    nextRockIn = route().rockEvery / pace();
  }
  if (state.rock.active) {
    state.rock.distance -= (route().rockSpeed ?? RULES.rockSpeed) * dt;
    if (state.rock.distance <= 0) {
      const dodged = Math.abs(state.rock.lane - state.drift) > RULES.rockHitWidth;
      state.rock.active = false;
      if (dodged) credit(Object.values(state.players).find((p) => p.atWheel), 'dodged');
      else takeHit();
    }
  }

  if (state.altitude <= 0) endRound('down');
  else if (state.timeLeft <= 0) endRound('landed');
}

// The fire burns down; the power it makes follows. A dying fire takes
// spare units first, then units out of the fullest tube. A fresh shovel
// of coal hands new units to the spare pool for the engineer to place.
//
// Every breach in the engine or power room also costs a unit until it is
// patched: the water gets into the works.
function tickFurnace(dt) {
  state.heat = Math.max(0, state.heat - RULES.heatDecay * pace() * dt);
  state.drain = Object.entries(state.breaches).filter(
    ([id, open]) => open && (ROOM_OF[id] === 'engine' || ROOM_OF[id] === 'power')
  ).length * RULES.breachDrain;
  const budget = Math.max(0, Math.ceil(state.heat * RULES.maxUnits) - state.drain);
  let total = state.spare + state.power.reduce((a, b) => a + b, 0);
  while (total > budget) {
    if (state.spare > 0) state.spare -= 1;
    else {
      // Out of a tube the engineer set: every browser flashes it.
      const tube = fullestTube();
      state.power[tube] -= 1;
      state.lostUnit = { count: state.lostUnit.count + 1, tube };
    }
    total -= 1;
  }
  state.spare += budget - total;
}

// The fullest tube that is still working (a dead one only once the rest
// are empty); a tie goes to whichever the dice pick.
function fullestTube() {
  const working = [0, 1, 2].filter((i) => !state.blown[i] && state.power[i] > 0);
  const pool = working.length ? working : [0, 1, 2].filter((i) => state.power[i] > 0);
  const most = Math.max(...pool.map((i) => state.power[i]));
  const tied = pool.filter((i) => state.power[i] === most);
  return tied[Math.floor(Math.random() * tied.length)];
}

// A tube held at full power heats up; fifteen seconds of it and the fuse
// blows, taking that tube offline until a new fuse goes in. Below full it
// cools off, and the vent valve cools everything at once.
function tickTubes(dt) {
  state.ventReadyIn = Math.max(0, state.ventReadyIn - dt);
  for (let i = 0; i < 3; i++) {
    if (state.blown[i]) continue;
    if (state.power[i] >= RULES.maxPerTube) state.tubeHeat[i] += dt;
    else state.tubeHeat[i] = Math.max(0, state.tubeHeat[i] - RULES.coolRate * dt);
    if (state.tubeHeat[i] >= RULES.overheatSeconds) {
      state.blown[i] = true;
      state.tubeHeat[i] = 0;
      ignite('power'); // a fuse that blows throws sparks
    }
  }
}

export const tubeName = (i) => TUBE_NAMES[i];

// Shields at three or more turn half the hits aside. A rock that gets
// through may also set the helm alight.
function takeHit() {
  const shielded = livePower(1) >= RULES.shieldThreshold && Math.random() < 0.5;
  if (shielded) return;
  state.log.rockHits += 1;
  openBreach();
  if (Math.random() < RULES.rockFireChance) ignite('helm');
}

// Each fire spreads to a next-door room every 20 s it burns. All three
// rooms alight and the ship is lost.
function tickFires(dt) {
  for (const room of ROOMS) {
    const fire = state.fires[room];
    if (!fire) continue;
    fire.burn += dt;
    fire.spread += dt;
    if (fire.spread >= fireSpreadSeconds()) {
      fire.spread = 0;
      const next = NEXT_ROOMS[room].filter((r) => !state.fires[r]);
      if (next.length && ignite(next[Math.floor(Math.random() * next.length)])) state.log.spread += 1;
    }
  }
  if (ROOMS.every((room) => state.fires[room])) endRound('burned');
}

// Storm walls: one comes every so often, and only the pilot can see it.
// Ringing the bell warns the crew to brace. At impact the shields decide
// the damage, and anyone not braced (holding interact, or at the wheel)
// is thrown back and drops what they carry.
function tickStorm(dt, crew) {
  const storm = state.storm;
  for (const player of Object.values(state.players)) {
    const input = crew.inputs?.get(player.id);
    player.braced = storm.active && (player.atWheel || !!input?.use);
  }
  if (!storm.active) {
    nextStormIn -= dt;
    if (nextStormIn <= 0) {
      storm.active = true;
      storm.left = RULES.stormWarnSeconds;
      storm.warned = false;
    }
    return;
  }
  storm.left = Math.max(0, storm.left - dt);
  if (storm.left > 0) return;

  // Impact. The warning is over with it.
  storm.active = false;
  storm.warned = false;
  storm.hits += 1;
  nextStormIn = between(route().stormEvery) / pace();
  const shields = livePower(1);
  for (let i = 0; i < Math.max(0, RULES.stormSafeShields - shields); i++) openBreach();
  if (shields < 2 && Math.random() < 0.5) ignite(ROOMS[Math.floor(Math.random() * ROOMS.length)]);
  state.altitude = Math.max(0, state.altitude - RULES.stormAltitudeLoss);
  for (const player of Object.values(state.players)) {
    if (player.braced) continue;
    const body = crew.bodies?.get(player.id);
    if (!body) continue;
    state.log.thrown += 1;
    // Thrown towards the stern, and a little to one side.
    body.push = { x: -RULES.stormPush, z: (Math.random() - 0.5) * RULES.stormPush, t: 0.45 };
    dropKit(player, body, player.yaw ?? 0);
  }
}

// --- sky pirates ----------------------------------------------------------

// A raid: sighted far off one side (only the pilot is told), alongside
// with cannon fire and grapples, then gone: outrun, repelled, or away
// with the loot. Grapples and boarders are the whole crew's job.
function tickRaid(dt) {
  const raid = state.raid;
  raid.t += dt;
  if (raid.phase === 'none') {
    // Never so late that the raid would outlast the flight.
    if (raidsLeft <= 0 || state.timeLeft < RULES.raidApproach + 25) return;
    nextRaidIn -= dt;
    if (nextRaidIn > 0) return;
    raidsLeft -= 1;
    state.log.raids += 1;
    Object.assign(raid, {
      phase: 'sighted',
      side: Math.random() < 0.5 ? -1 : 1,
      t: 0,
      outrun: 0,
      hooks: {},
      thrown: 0,
      boarders: {},
      ending: '',
      count: raid.count + 1,
    });
  } else if (raid.phase === 'sighted') {
    // Full engines through the approach and they never catch up.
    if (livePower(0) >= RULES.raidOutrunEngines) raid.outrun += dt;
    if (raid.outrun >= RULES.raidOutrun) endRaid('outrun');
    else if (raid.t >= RULES.raidApproach) {
      raid.phase = 'alongside';
      raid.t = 0;
      raidShotIn = RULES.raidCannonEvery / 2 / pace();
      raidHookIn = 1;
    }
  } else if (raid.phase === 'alongside') {
    tickAlongside(dt);
  } else if (raid.phase === 'leaving' && raid.t >= RULES.raidLeaveSeconds) {
    raid.phase = 'none';
    raid.t = 0;
    nextRaidIn = between(route().raidEvery ?? [60, 80]) / pace();
  }
}

function tickAlongside(dt) {
  const raid = state.raid;
  // A broadside every few seconds: the shields stop it, or it holes the
  // hull on the side facing them.
  raidShotIn -= dt;
  if (raidShotIn <= 0) {
    raidShotIn = RULES.raidCannonEvery / pace();
    raid.shots += 1;
    if (livePower(1) >= RULES.raidShieldBlock) raid.blocked += 1;
    else {
      const spot = openBreach(raid.side);
      if (spot && Math.random() < RULES.raidFireChance) ignite(ROOM_OF[spot.id]);
    }
  }

  // The grapples bite one after another, one per room at most.
  const hooks = Math.max(1, Math.round((route().hooks ?? 2) * pace()));
  raidHookIn -= dt;
  if (raid.thrown < hooks && raidHookIn <= 0) {
    raidHookIn = RULES.raidHookEvery;
    const taken = new Set(Object.values(raid.hooks).map((h) => h.spot));
    const free = HOOK_SPOTS.map((_, i) => i).filter((i) => !taken.has(i));
    if (free.length) {
      raid.thrown += 1;
      raid.serial += 1;
      raid.hooks[`h${raid.serial}`] = { spot: free[Math.floor(Math.random() * free.length)], held: 0 };
    }
  }

  // A grapple left long enough sends a pirate down it.
  for (const hook of Object.values(raid.hooks)) {
    hook.held += dt;
    if (hook.held >= RULES.boardAfter / pace() && Object.keys(raid.boarders).length < RULES.maxBoarders) {
      hook.held = 0;
      sendBoarder(hook.spot);
    }
  }
  tickBoarders(dt);

  if (raid.thrown >= hooks && !Object.keys(raid.hooks).length && !Object.keys(raid.boarders).length) {
    raid.repelled += 1;
    endRaid('repelled');
  } else if (raid.t >= RULES.raidMaxSeconds) {
    // Still hooked on: they help themselves and cast off.
    state.kit.planks = 0;
    state.fuses = Math.max(0, state.fuses - RULES.lootFuses);
    state.log.looted += 1;
    endRaid('looted');
  }
}

function sendBoarder(spot) {
  const raid = state.raid;
  raid.serial += 1;
  const kind = BOARDER_KINDS[boarded % BOARDER_KINDS.length];
  boarded += 1;
  const x = hookX(spot, raid.side);
  raid.boarders[`b${raid.serial}`] = {
    kind,
    x,
    y: HOOK_HEIGHT, // down the line from the hook
    z: raid.side * 2.4,
    vy: 0,
    yaw: raid.side > 0 ? 0 : Math.PI, // facing into the ship
    stand: raid.side * 1.4, // where they stop, a few steps in
    shoves: 0,
    waves: 0,
    waveIn: 2 + Math.random() * 3,
  };
  // Nobody steers with a pirate at their elbow.
  if (roomAt(x) === 'helm') {
    for (const player of Object.values(state.players)) player.atWheel = false;
    state.steering = 0;
  }
}

function tickBoarders(dt) {
  for (const b of Object.values(state.raid.boarders)) {
    // The deckhand floats down on his propeller pack; the rest drop.
    if (b.y > PLAYER.radius) {
      b.vy -= (b.kind === 'deckhand' ? 3 : 14) * dt;
      b.y = Math.max(PLAYER.radius, b.y + b.vy * dt);
      if (b.y === PLAYER.radius) b.vy = 0;
    }
    // A few steps in from the wall (and back in after a shove).
    const dz = b.stand - b.z;
    if (Math.abs(dz) > 0.01) b.z += Math.sign(dz) * Math.min(Math.abs(dz), 1.3 * dt);
    // A wave now and then, to rub it in.
    b.waveIn -= dt;
    if (b.waveIn <= 0) {
      b.waves += 1;
      b.waveIn = 4 + Math.random() * 4;
    }
  }
}

export function cutHook(id, player) {
  if (!state.raid.hooks[id]) return false;
  delete state.raid.hooks[id];
  credit(player, 'cut');
  return true;
}

// A shove sends a boarder staggering back toward the wall; enough of
// them, or one bucket of water, and over the side they go.
export function shoveBoarder(id, player) {
  const raid = state.raid;
  const b = raid.boarders[id];
  if (!b) return false;
  if (player.bucket) {
    player.bucket = false;
    b.shoves = RULES.shovesToRepel;
  } else {
    b.shoves += 1;
    b.z = clamp(b.z + raid.side * 0.45, -2.5, 2.5);
  }
  if (b.shoves >= RULES.shovesToRepel) {
    delete raid.boarders[id];
    raid.overboard += 1;
    credit(player, 'overboard');
  }
  return true;
}

// from: how far along its approach the pirate ship was when the raid
// ended, so it is drawn sailing off from where it was.
function endRaid(ending) {
  const raid = state.raid;
  raid.from = raid.phase === 'sighted' ? Math.min(1, raid.t / RULES.raidApproach) : 1;
  raid.phase = 'leaving';
  raid.t = 0;
  raid.ending = ending;
  raid.hooks = {};
  raid.boarders = {}; // looters climb back with the goods
}

function endRound(result) {
  state.result = result;
  state.phase = 'result';
  state.rock.active = false;
}

// From the result screen back to the dock, uniforms still on.
export function backToDock() {
  if (state.phase !== 'result') return false;
  startRound();
  state.phase = 'lobby';
  state.countdown = null;
  // Short-handed was the word for that flight: the next one waits for a
  // full crew again until the host rings the dock bell, so a friend on
  // their way is not left behind.
  state.shortHanded = false;
  state.kit.heldBy = null;
  state.kit.x = KIT_HOME.x;
  state.kit.y = KIT_HOME.y;
  state.kit.z = KIT_HOME.z;
  for (const player of Object.values(state.players)) player.atWheel = false;
  return true;
}

// The host leaves the crew screen: everyone walks onto the dock together.
export function goToDock() {
  if (state.phase !== 'gathering') return false;
  state.phase = 'lobby';
  state.countdown = null;
  return true;
}

// At the dock: once the whole crew is dressed and standing on the deck,
// count down and cast off. Anyone stepping back ashore stops the clock, and
// so does anyone whose line has dropped until they are back. A crew short
// of three only goes once the host has rung the dock bell for it.
export function tickLobby(dt) {
  if (state.phase !== 'lobby') return;
  tickProps(dt);
  const crew = Object.values(state.players);
  const ready =
    (crew.length >= RULES.maxPlayers || state.shortHanded) &&
    crew.every((p) => p.role !== 'crew' && p.signal !== 'lost' && aboard(p));
  if (!ready) {
    state.countdown = null;
    return;
  }
  state.countdown = (state.countdown ?? RULES.countdown) - dt;
  if (state.countdown <= 0) {
    state.countdown = null;
    castOff();
  }
}

// The hatch slams, the moorings go, and the dock drops away below. The
// round is set up now so every gauge already reads right on the way up,
// but nothing tears and no clock runs until the climb is over.
function castOff() {
  startRound();
  state.flight += 1;
  state.phase = 'takeoff';
  state.takeoff = 0;
  state.stoke += 1; // the furnace roars and the bell rings for everyone
  state.cabinBell += 1;
}

export function tickTakeoff(dt) {
  if (state.phase !== 'takeoff') return;
  state.takeoff += dt;
  if (state.takeoff >= RULES.takeoffSeconds) {
    state.takeoff = 0;
    state.phase = 'flight';
  }
}

// Hands off everything: the wheel, the kit, a fuse, a bucket. For a player
// whose line has dropped (their seat is held, but the crew cannot wait 30 s
// for the wheel or the kit) and for one who has gone for good.
export function letGo(player, body) {
  if (player.atWheel) {
    player.atWheel = false;
    state.steering = 0; // the wheel spins back to centre
  }
  if (body) body.atWheel = false;
  if (player.fuse) state.fuses += 1; // their fuse goes back in the crate
  player.fuse = false;
  player.bucket = false; // the water goes on the floor
  if (state.kit.heldBy === player.id) {
    if (body) dropKit(player, body, player.yaw ?? 0); // at their feet, for whoever needs it
    else state.kit.heldBy = null;
  }
}

// Someone's browser closed: free what they were holding.
export function removePlayer(id, body) {
  const player = state.players[id];
  if (!player) return;
  letGo(player, body);
  delete state.players[id];
}

// A new session (a room opened, or back at the menu): nothing of the last
// one carries over. The hull is sound, no fire, no pirates, the kit on its
// rack, no flights flown, and the ship waits for a full crew.
export function newSession() {
  startRound();
  state.phase = 'lobby';
  state.countdown = null;
  state.takeoff = 0;
  state.result = null;
  state.flight = 0;
  state.shortHanded = false;
  state.kit = { heldBy: null, planks: RULES.kitPlanks, ...KIT_HOME };
  state.props = {};
}
