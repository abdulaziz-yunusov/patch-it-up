// The game rules. Only the host runs these: everyone else sends inputs
// and draws the state that comes back.

import { HATS, KIT_HOME, ROUTES, RULES, SHOUTS, livePower, propHomes, roleTaken, state } from './state.js';
import { lookDirection } from './player.js';
import { BREACH_SPOTS, DOCK, HELM_STANCE, SHIP } from './world.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const between = ([lo, hi]) => lo + Math.random() * (hi - lo);

// The host's own clocks: when the hull next springs a leak, and when the
// next rock comes at the bow.
let nextBreachIn = 0;
let nextRockIn = 0;
let nextStormIn = 0;

const ROLE_NAMES = { mechanic: 'Mechanic', engineer: 'Engineer', pilot: 'Pilot' };
const TUBE_NAMES = ['Engines', 'Shields', 'Lift'];
const ROOM_OF = Object.fromEntries(BREACH_SPOTS.map((spot) => [spot.id, spot.room]));

const holdsKit = (player) => state.kit.heldBy === player.id;
const handsFull = (player) => holdsKit(player) || player.fuse || player.bucket;

// Fire: which room each station is in, what a room is called, and where a
// fire can spread to (the rooms stand in a row: engine, power, helm).
const ROOMS = ['engine', 'power', 'helm'];
export const ROOM_LABEL = { engine: 'engine room', power: 'power room', helm: 'helm' };
const STATION_ROOM = { stoke: 'engine', power: 'power', steam: 'power', wheel: 'helm' };
const NEXT_ROOMS = { engine: ['power'], power: ['engine', 'helm'], helm: ['power'] };

// Can this player use this station right now? null means yes; otherwise
// the reason, which the prompt shows instead of the action. The host asks
// the same question before it runs anything, so a stale prompt on a
// joiner's screen never lets anything through.
export function canUse(interact, player) {
  if (!player) return 'Not aboard';
  if (interact.role && interact.role !== player.role) return `${ROLE_NAMES[interact.role] ?? interact.role} only`;
  const burning = STATION_ROOM[interact.action];
  if (burning && state.fires[burning]) return `The ${ROOM_LABEL[burning]} is on fire!`;
  switch (interact.action) {
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
  power: (interact) => movePower(interact.index),
  wheel: (interact, player, body) => toggleWheel(player, body),
  pickup: (interact, player) => pickUpKit(player),
  role: (interact, player) => pickRole(player, interact.takes),
  bell: () => ringBell(),
  cabinBell: () => ringCabinBell(),
  steam: () => ventSteam(),
  stoke: () => stokeFurnace(),
  shout: (interact, player) => shoutDownTube(player),
  hat: (interact, player) => nextHat(player),
  lamps: () => toggleLamps(),
  route: (interact, player) => nextRoute(player),
  kick: (interact, player) => kickProp(interact.prop, player),
};

// --- the dock's toys ---------------------------------------------------

export function ringBell() {
  state.bell += 1;
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
export function ventSteam() {
  state.steam += 1;
  if (state.phase === 'flight') state.tubeHeat = [0, 0, 0];
  return true;
}

// At the dock it only makes the fire roar; from the climb on a shovel of
// coal is what keeps the engineer's power coming (coal shovelled on the way
// up is banked: the furnace only starts burning down once the round begins).
export function stokeFurnace() {
  state.stoke += 1;
  if (state.phase === 'takeoff' || state.phase === 'flight') state.heat = Math.min(1, state.heat + RULES.heatPerStoke);
  return true;
}

export function shoutDownTube(player) {
  const line = SHOUTS[Math.floor(Math.random() * SHOUTS.length)];
  state.shout = { count: state.shout.count + 1, name: player.name, line };
  return true;
}

export function nextHat(player) {
  player.hat = ((player.hat ?? 0) + 1) % HATS.length;
  return true;
}

export function toggleLamps() {
  state.lampsOn = !state.lampsOn;
  return true;
}

// Only the host picks the route, and only while still at the dock.
export function nextRoute(player) {
  if (player.id !== 'host' || state.phase !== 'lobby') return false;
  state.route = (state.route + 1) % ROUTES.length;
  return true;
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
  if (player.role === 'pilot') {
    if (flying && state.storm.active) return 'Storm wall! Brace and raise the shields!';
    return flying && state.rock.active ? 'Need engines! Rock ahead!' : 'Need power!';
  }
  if (fire && player.role !== 'mechanic') return `Fire in the ${ROOM_LABEL[fire]}!`;
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

// Tear a new hole somewhere nothing is leaking yet.
function openBreach() {
  const sound = BREACH_SPOTS.filter((spot) => !state.breaches[spot.id]);
  if (!sound.length) return false;
  const spot = sound[Math.floor(Math.random() * sound.length)];
  state.breaches[spot.id] = true;
  state.opened += 1;
  return true;
}

// E on a lever takes a spare unit if the furnace has made one, and
// otherwise pulls one over from the fullest other tube.
// A tube with a blown fuse is locked: nothing goes in or comes out.
export function movePower(index) {
  if (state.power[index] >= RULES.maxPerTube || state.blown[index]) return false;
  if (state.spare > 0) {
    state.spare -= 1;
    state.power[index] += 1;
    return true;
  }
  let from = -1;
  state.power.forEach((units, i) => {
    if (i !== index && !state.blown[i] && units > 0 && (from === -1 || units > state.power[from])) from = i;
  });
  if (from === -1) return false;
  state.power[from] -= 1;
  state.power[index] += 1;
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

// While you hold the wheel, A and D steer instead of walking.
export function steerShip(dt, keys) {
  if (keys.KeyA) state.steering = clamp(state.steering - RULES.steerRate * dt, -1, 1);
  if (keys.KeyD) state.steering = clamp(state.steering + RULES.steerRate * dt, -1, 1);
}

export function pickUpKit(player) {
  if (state.kit.heldBy || player.fuse || player.bucket) return false;
  state.kit.heldBy = player.id;
  return true;
}

// The drop key: a carried fuse goes back in its crate, the kit goes on
// the floor in front of you.
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
  state.kit.heldBy = null;
  state.kit.x = body.position.x + ahead.x * 0.8;
  state.kit.y = KIT_HOME.y;
  state.kit.z = body.position.z + ahead.z * 0.8;
  return true;
}

// A locker hands out its uniform only if nobody else is wearing it.
export function pickRole(player, role) {
  if (!role || roleTaken(role, player.id)) return false;
  player.role = role;
  return true;
}

export function aboard(player) {
  return (
    Math.abs(player.x) < SHIP.length / 2 - 0.3 &&
    Math.abs(player.z) < SHIP.width / 2 - 0.1 &&
    player.y > -0.2
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
  state.blown = [false, false, false];
  state.fuses = RULES.spareFuses;
  state.drain = 0;
  state.kit.planks = RULES.kitPlanks;
  state.fires = { engine: null, power: null, helm: null };
  state.storm = { active: false, left: 0, warned: false, hits: 0 };
  for (const player of Object.values(state.players)) {
    player.fuse = false;
    player.bucket = false;
    player.braced = false;
  }
  nextBreachIn = between(route().breachEvery);
  nextRockIn = route().rockEvery;
  nextStormIn = RULES.stormFirstAt + Math.random() * 15;
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
    nextBreachIn = between(route().breachEvery);
  }

  tickFurnace(dt);
  tickTubes(dt);
  tickFires(dt);
  if (state.phase !== 'flight') return; // the fire took the ship
  tickStorm(dt, crew);

  // The ship always sinks a little, and every open hole bleeds more
  // height away; only the lift tube gives it back.
  state.climb =
    livePower(2) * RULES.liftPerUnit -
    RULES.sinkRate -
    openCount() * RULES.altitudeLossPerBreach;
  state.altitude = clamp(state.altitude + state.climb * dt, 0, RULES.altitudeStart);

  // The helm answers slowly when the engines are starved, and barely at
  // all when they are dead.
  const engines = livePower(0);
  const answer = engines === 0 ? 0.25 : engines <= RULES.enginesLow ? 0.5 : 1;
  state.drift = clamp(state.drift + state.steering * RULES.driftRate * answer * dt, -1, 1);

  nextRockIn -= dt;
  if (!state.rock.active && nextRockIn <= 0) {
    state.rock = { lane: Math.random() * 2 - 1, distance: RULES.rockDistance, active: true };
    nextRockIn = route().rockEvery;
  }
  if (state.rock.active) {
    state.rock.distance -= RULES.rockSpeed * dt;
    if (state.rock.distance <= 0) {
      const dodged = Math.abs(state.rock.lane - state.drift) > RULES.rockHitWidth;
      state.rock.active = false;
      if (!dodged) takeHit();
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
  state.heat = Math.max(0, state.heat - RULES.heatDecay * dt);
  state.drain = Object.entries(state.breaches).filter(
    ([id, open]) => open && (ROOM_OF[id] === 'engine' || ROOM_OF[id] === 'power')
  ).length * RULES.breachDrain;
  const budget = Math.max(0, Math.ceil(state.heat * RULES.maxUnits) - state.drain);
  let total = state.spare + state.power.reduce((a, b) => a + b, 0);
  while (total > budget) {
    if (state.spare > 0) state.spare -= 1;
    else state.power[fullestTube()] -= 1;
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
    if (fire.spread >= RULES.fireSpreadSeconds) {
      fire.spread = 0;
      const next = NEXT_ROOMS[room].filter((r) => !state.fires[r]);
      if (next.length) ignite(next[Math.floor(Math.random() * next.length)]);
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
  nextStormIn = between(route().stormEvery);
  const shields = livePower(1);
  for (let i = 0; i < Math.max(0, RULES.stormSafeShields - shields); i++) openBreach();
  if (shields < 2 && Math.random() < 0.5) ignite(ROOMS[Math.floor(Math.random() * ROOMS.length)]);
  state.altitude = Math.max(0, state.altitude - RULES.stormAltitudeLoss);
  for (const player of Object.values(state.players)) {
    if (player.braced) continue;
    const body = crew.bodies?.get(player.id);
    if (!body) continue;
    // Thrown towards the stern, and a little to one side.
    body.push = { x: -RULES.stormPush, z: (Math.random() - 0.5) * RULES.stormPush, t: 0.45 };
    dropKit(player, body, player.yaw ?? 0);
  }
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
// so does anyone whose line has dropped until they are back.
export function tickLobby(dt) {
  if (state.phase !== 'lobby') return;
  tickProps(dt);
  const crew = Object.values(state.players);
  const ready =
    crew.length === RULES.maxPlayers &&
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

// Someone's browser closed: free what they were holding.
export function removePlayer(id, body) {
  const player = state.players[id];
  if (!player) return;
  if (player.atWheel) state.steering = 0; // nobody left holding the wheel
  if (player.fuse) state.fuses += 1; // their fuse goes back in the crate
  player.fuse = false;
  player.bucket = false;
  if (state.kit.heldBy === id && body) dropKit(player, body, player.yaw);
  else if (state.kit.heldBy === id) state.kit.heldBy = null;
  delete state.players[id];
}
