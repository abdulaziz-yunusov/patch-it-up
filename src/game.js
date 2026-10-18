// The game rules. Only the host runs these: everyone else sends inputs
// and draws the state that comes back.

import { HATS, KIT_HOME, ROUTES, RULES, SHOUTS, propHomes, roleTaken, state } from './state.js';
import { lookDirection } from './player.js';
import { BREACH_SPOTS, DOCK, HELM_STANCE, SHIP } from './world.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const between = ([lo, hi]) => lo + Math.random() * (hi - lo);

// The host's own clocks: when the hull next springs a leak, and when the
// next rock comes at the bow.
let nextBreachIn = 0;
let nextRockIn = 0;

// Who may touch what: an interactive mesh names the role it belongs to.
export function mayUse(interact, role) {
  return !interact.role || interact.role === role;
}

// What each action name does, run by the host on behalf of one player.
export const ACTIONS = {
  patch: (interact) => patchBreach(interact.id),
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

export function ringCabinBell() {
  state.cabinBell += 1;
  return true;
}

export function ventSteam() {
  state.steam += 1;
  return true;
}

// At the dock it only makes the fire roar; in flight a shovel of coal
// is what keeps the engineer's power coming.
export function stokeFurnace() {
  state.stoke += 1;
  if (state.phase === 'flight') state.heat = Math.min(1, state.heat + RULES.heatPerStoke);
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

export function patchBreach(id) {
  if (!state.breaches[id]) return false; // already mended
  state.breaches[id] = false;
  state.patched += 1;
  return true;
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
export function movePower(index) {
  if (state.power[index] >= RULES.maxPerTube) return false;
  if (state.spare > 0) {
    state.spare -= 1;
    state.power[index] += 1;
    return true;
  }
  let from = -1;
  state.power.forEach((units, i) => {
    if (i !== index && units > 0 && (from === -1 || units > state.power[from])) from = i;
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
  if (state.kit.heldBy) return false;
  state.kit.heldBy = player.id;
  return true;
}

export function dropKit(player, body, yaw) {
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
  nextBreachIn = between(route().breachEvery);
  nextRockIn = route().rockEvery;
}

// Three minutes in the air: the clock, the holes, the helm, the rocks.
export function tickFlight(dt) {
  if (state.phase !== 'flight') return;
  state.timeLeft = Math.max(0, state.timeLeft - dt);

  nextBreachIn -= dt;
  if (nextBreachIn <= 0) {
    openBreach();
    nextBreachIn = between(route().breachEvery);
  }

  tickFurnace(dt);

  // The ship always sinks a little, and every open hole bleeds more
  // height away; only the lift tube gives it back.
  state.climb =
    state.power[2] * RULES.liftPerUnit -
    RULES.sinkRate -
    openCount() * RULES.altitudeLossPerBreach;
  state.altitude = clamp(state.altitude + state.climb * dt, 0, RULES.altitudeStart);

  // The helm answers slowly when the engines are starved, and barely at
  // all when they are dead.
  const engines = state.power[0];
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
function tickFurnace(dt) {
  state.heat = Math.max(0, state.heat - RULES.heatDecay * dt);
  const budget = Math.ceil(state.heat * RULES.maxUnits);
  let total = state.spare + state.power.reduce((a, b) => a + b, 0);
  while (total > budget) {
    if (state.spare > 0) state.spare -= 1;
    else state.power[fullestTube()] -= 1;
    total -= 1;
  }
  state.spare += budget - total;
}

// The fullest tube; a tie goes to whichever the dice pick.
function fullestTube() {
  const most = Math.max(...state.power);
  const tied = state.power.flatMap((units, i) => (units === most ? [i] : []));
  return tied[Math.floor(Math.random() * tied.length)];
}

// Shields at three or more turn half the hits aside.
function takeHit() {
  const shielded = state.power[1] >= RULES.shieldThreshold && Math.random() < 0.5;
  if (!shielded) openBreach();
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
// count down and cast off. Anyone stepping back ashore stops the clock.
export function tickLobby(dt) {
  if (state.phase !== 'lobby') return;
  tickProps(dt);
  const crew = Object.values(state.players);
  const ready =
    crew.length === RULES.maxPlayers && crew.every((p) => p.role !== 'crew' && aboard(p));
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
  if (state.kit.heldBy === id && body) dropKit(player, body, player.yaw);
  else if (state.kit.heldBy === id) state.kit.heldBy = null;
  delete state.players[id];
}
