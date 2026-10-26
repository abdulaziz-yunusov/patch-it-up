// One plain object with everything the game knows.
// The host owns it, changes it, and sends it to everyone; every browser
// draws the 3D scene from the copy it last received.

export const RULES = {
  // The round, as the plan's table sets it out.
  roundSeconds: 180,
  altitudeStart: 100,
  altitudeLossPerBreach: 2, // per cent per second, per open breach
  sinkRate: 1, // per cent per second the ship sinks with no lift at all
  liftPerUnit: 0.5, // per cent per second each unit in the lift tube gives back
  breachEvery: [8, 15], // seconds between new breaches
  rockEvery: 10, // seconds between rocks
  rockDistance: 42, // metres ahead when one appears
  rockSpeed: 6, // metres per second
  rockHitWidth: 0.35, // how closely a rock has to line up to hit
  shieldThreshold: 3, // shields at 3+ turn half the hits aside
  enginesLow: 1, // engines at 0 or 1 halve the pilot's steering
  driftRate: 0.55, // how fast a full helm slides the ship aside

  // The furnace: its heat sets how many power units the engineer has.
  heatStart: 0.75, // 6 of 8 units: the 2-2-2 the ship casts off with
  heatDecay: 1 / 50, // a full furnace burns down to nothing in 50 s
  heatPerStoke: 0.2,
  stokeSeconds: 1, // hold E at the furnace this long for one shovel of coal
  maxUnits: 8, // power units a roaring furnace makes

  // Tubes run hot at full power: 15 s at 4 units blows the fuse. Below
  // full they cool slowly (a quarter as fast as they heat), so heat from
  // bursts at full power adds up; only venting clears it at once.
  overheatSeconds: 15,
  overheatWarn: 10, // from here the tube glows and the crew is warned
  coolRate: 0.25,
  ventSeconds: 3, // hold the vent valve this long
  ventCooldown: 20, // seconds before the valve can vent again (a tube blows after 15 s at full)
  fuseSeconds: 2, // hold at the fuse box this long to fit a new fuse
  spareFuses: 3, // in the engine room's crate, per round
  breachDrain: 1, // power units lost per breach in the engine or power room

  // The patch kit: one plank per breach, restocked at the supply rack.
  kitPlanks: 3,
  restockSeconds: 1.5,

  calloutCooldownMs: 2000, // one call-out per player this often

  // Fire: a burning room's station stops working, and every 20 s a fire
  // spreads to the next room. Two buckets of water put one out. All
  // three rooms alight and the ship is lost.
  fireSpreadSeconds: 20,
  fireBuckets: 2,
  rockFireChance: 0.4, // a rock that gets through may set the helm alight

  // Storm walls: the pilot sees one coming and has this long to ring the
  // bell; braced crew (holding the interact key) are not thrown about.
  stormWarnSeconds: 6,
  stormFirstAt: 40, // seconds into the flight before the first can come
  stormPush: 5, // metres per second an unbraced player is thrown
  stormAltitudeLoss: 5,
  stormSafeShields: 2, // each shield unit short of this tears a hole at impact

  // Sky pirates (a raid or two a flight). The pilot spots their ship and
  // engines can outrun it; alongside it fires on the hull, throws grapples
  // that drag the ship down, and sends a boarder down any grapple left too
  // long. Cut every grapple and throw every boarder off, and they give up.
  raidFirstAt: 45, // seconds into the flight before the first can come
  raidApproach: 15, // seconds from sighting to alongside
  raidOutrunEngines: 3, // engines at this many units during the approach...
  raidOutrun: 9, // ...for this many seconds, and they fall behind
  raidCannonEvery: 7, // seconds between cannonballs
  raidShieldBlock: 3, // shields at this many units stop a cannonball
  raidFireChance: 0.25, // a cannonball through the hull may start a fire
  raidHookEvery: 3, // seconds between grapples biting into the hull
  hookDrag: 0.5, // altitude per cent per second, for each grapple
  hookPull: 0.04, // how hard each grapple drags the helm toward the pirates
  cutSeconds: 2, // hold the interact key this long to cut a grapple
  boardAfter: 12, // a grapple left this long sends a boarder down it
  maxBoarders: 2,
  shovesToRepel: 3, // shoves to put a boarder overboard (one bucket does it too)
  raidMaxSeconds: 60, // alongside this long, they take their loot and go
  raidLeaveSeconds: 6, // the pirate ship sailing off
  lootFuses: 2, // spare fuses they take (and every plank in the kit)

  maxPerTube: 4,
  patchSeconds: 2.5,
  // The wheel: A and D turn it, letting go eases it back to centre, and
  // steering against the lock swings it faster.
  steerRate: 1.4, // full lock in 0.7 s
  steerReturn: 2, // back to centre from full lock in 0.5 s
  steerCounter: 2, // twice as fast when steering against the lock
  reach: 2.5, // metres you can interact from
  maxPlayers: 3,
  // Fewer than three can fly too: the host rings the dock bell to cast off
  // short-handed, a role nobody wears is anyone's job, and the hazards come
  // at this pace for the crew aboard (1 = the full three-crew flight).
  crewPace: [1, 0.4, 0.7, 1], // by crew size; index 0 unused
  landingGoal: 50, // the second star: land with at least this much altitude
  inputHz: 30, // joiner -> host
  stateHz: 20, // host -> all
  timeoutMs: 8000, // silence this long means that browser's line is dead
  rejoinMs: 30000, // and its seat is held this much longer for it to reconnect
  weakSignalMs: 1000, // silence this long shows them as lagging on the crew screen
  countdown: 5, // seconds on the deck before the ship casts off
  takeoffSeconds: 7, // the climb away from the dock, before the round starts
  correction: 0.25, // how hard your own sphere is pulled to the host's answer

  // The dock's toys.
  kickSpeed: 5.5, // metres per second a kicked crate leaves your foot at
  kickLift: 3, // and how hard it hops
};

// The route board at the dock. The host picks; the flight's pace follows.
// raids: pirate raids a flight at most; hooks: grapples each raid throws;
// raidEvery: seconds after one raid ends before the next can be sighted.
// rockSpeed: metres per second a rock closes in (RULES.rockSpeed if left out).
// challenge: the route's third star (log.js); open: what unlocks it in the
// host's log (null: always open).
export const ROUTES = [
  { name: 'Calm Cliffs', breachEvery: [10, 18], rockEvery: 12, rockSpeed: 6, stormEvery: [55, 80], raids: 1, hooks: 2, raidEvery: [60, 80], challenge: 'noSpread', open: null },
  { name: 'Thunder Pass', breachEvery: [6, 11], rockEvery: 8, rockSpeed: 8, stormEvery: [35, 55], raids: 2, hooks: 3, raidEvery: [30, 45], challenge: 'allBraced', open: { landedOn: 0 } },
  // Pirate waters: fewer storms, raid after raid.
  { name: 'Skull Straits', breachEvery: [9, 15], rockEvery: 11, rockSpeed: 7, stormEvery: [75, 100], raids: 3, hooks: 3, raidEvery: [12, 20], challenge: 'noLoot', open: { stars: 4 } },
];

// What the dock mirror can put on your head. Index 0 is bare. HAT_STARS:
// how many stars in your log open each one.
export const HATS = ['no hat', 'beanie', 'captain hat', 'top hat', 'propeller cap'];
export const HAT_STARS = [0, 0, 2, 5, 8];

// Sailor lines for the speaking tube, until there is real voice chat.
export const SHOUTS = [
  'Ahoy, crew!',
  'All hands on deck!',
  'Anyone seen my hammer?',
  'Is this thing on?',
  'Last one aboard swabs the deck!',
  'Patch it up!',
];

// Where each kickable crate and barrel starts, filled in by dock.js from
// the Blender model so host and joiners agree. name -> { x, y, z, h }
export const propHomes = {};

export const ROLES = ['mechanic', 'engineer', 'pilot'];

// What each power tube feeds: engines steer, shields turn rocks aside,
// lift holds the ship up against the sink and the leaks.
export const TUBES = ['engines', 'shields', 'lift'];

// On the Blender dock (public/models/waiting_room.glb), at its spawn_1..3
// markers. y = the platform (-1.2) plus the sphere's radius, which is
// where a standing player's middle sits. SPAWN_YAW faces the lockers.
export const SPAWNS = [
  { x: -1.5, y: -0.8, z: -19 },
  { x: -1.5, y: -0.8, z: -15 },
  { x: -1.5, y: -0.8, z: -11 },
];
export const SPAWN_YAW = -Math.PI / 2;
export const KIT_HOME = { x: -6.6, y: 0.15, z: 1.6 };

export const state = {
  // 'gathering' on the host's crew screen, 'lobby' at the dock, 'takeoff'
  // climbing away, 'flight' in the air, 'result' after
  phase: 'lobby',
  takeoff: 0, // seconds into the climb, while phase is 'takeoff'
  countdown: null, // seconds left once the whole crew is aboard
  code: '', // the room code, painted on the board at the dock
  players: {}, // id -> { id, name, role, x, y, z, yaw, atWheel }
  power: [2, 2, 2], // units in the engine, shield and lift tubes
  spare: 0, // units the furnace has made that no tube holds yet
  tubeHeat: [0, 0, 0], // seconds each tube has run at full power
  ventReadyIn: 0, // seconds until the vent valve can be used again
  lostUnit: { count: 0, tube: -1 }, // the furnace cooled and a tube lost a unit: clients flash it
  blown: [false, false, false], // a blown fuse: that tube is offline, its units stuck
  fuses: RULES.spareFuses, // spare fuses left in the engine room crate
  drain: 0, // power units the breaches in the engine and power rooms cost now
  callout: { count: 0, id: '', name: '', role: '', text: '' }, // the last call-out
  fires: { engine: null, power: null, helm: null }, // room -> { burn, spread, water } while alight
  storm: { active: false, left: 0, warned: false, hits: 0 }, // a storm wall on its way; hits counts impacts
  raid: newRaid(), // the sky pirates: see newRaid()
  shortHanded: false, // the host rang the dock bell: cast off without a full crew
  flight: 0, // counts up at every cast-off, so each flight is logged once
  log: newLog(), // what happened this flight, for its stars: see newLog()
  stats: {}, // player id -> what they did this flight, for the crew's titles (log.js)
  heat: RULES.heatStart, // the furnace, 0 (out) .. 1 (roaring)
  climb: 0, // per cent per second altitude is changing, for the HUD
  breaches: {}, // id -> true while that hole is open
  opened: 0, // how many have torn open all round: clients flash on a change
  patched: 0, // and how many the mechanic has closed
  steering: 0, // -1 (hard to port) .. 1 (hard to starboard)
  drift: 0, // where the helm has put the ship, -1 .. 1
  rock: { lane: 0, distance: 0, active: false },
  altitude: RULES.altitudeStart,
  timeLeft: RULES.roundSeconds,
  result: null, // 'landed' or 'down', once the round ends
  kit: { heldBy: null, planks: RULES.kitPlanks, ...KIT_HOME },

  // The dock's toys, all shared so everyone sees the same thing.
  route: 0, // index into ROUTES
  stoke: 0, // stokes of the engine room's furnace
  steam: 0, // turns of the power room's steam valve
  cabinBell: 0, // the helm's bell, counted apart from the dock's
  bell: 0, // rings so far: clients swing the bell when it goes up
  shout: { count: 0, name: '', line: '' }, // the speaking tube
  lampsOn: true,
  props: {}, // name -> { x, y, z, ry, vx, vy, vz, spin, moving } once kicked
};

// A pirate raid, as everyone draws it. phase: 'none', 'sighted' (on its
// way), 'alongside', 'leaving' (with ending 'outrun', 'repelled' or
// 'looted'). side: 1 starboard (+z), -1 port. t: seconds in this phase.
// hooks: id -> { spot, held } (spot = which room's wall: HOOK_SPOTS in
// world.js). boarders: id -> { kind, x, y, z, yaw, shoves, waves }.
// Counters (shots, blocked, count, overboard) survive a lost packet.
export function newRaid() {
  return {
    phase: 'none',
    side: 1,
    t: 0,
    outrun: 0,
    shots: 0,
    blocked: 0,
    hooks: {},
    thrown: 0,
    boarders: {},
    serial: 0,
    ending: '',
    count: 0,
    overboard: 0,
    repelled: 0,
  };
}

// What a flight's stars are judged on, kept by the host as it flies.
// spread: fires that reached another room; thrown: crew a storm wall threw
// about unbraced; looted: raids that got away with the goods; raids: raids
// sighted; rockHits: rocks through the hull.
export function newLog() {
  return { spread: 0, thrown: 0, looted: 0, raids: 0, rockHits: 0 };
}

// Who this browser is. Never sent anywhere.
export const local = { id: null, name: 'Deckhand', isHost: false, code: '', token: null }; // token: claims our seat back after a drop

export function newPlayer(id, name, index) {
  const spawn = SPAWNS[index % SPAWNS.length];
  return {
    id,
    name,
    role: 'crew', // white until a uniform is taken from a locker
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    yaw: SPAWN_YAW, // on the dock you arrive facing the lockers
    atWheel: false,
    hat: 0, // index into HATS, changed at the mirror
    signal: 'good', // 'weak' when the host has not heard from them lately, 'lost' while it waits for them to reconnect
    fuse: false, // carrying a spare fuse from the engine room
    bucket: false, // carrying a bucket of water
    stars: 0, // stars in their own log: opens hats at the mirror
  };
}

export function snapshot() {
  return {
    phase: state.phase,
    countdown: state.countdown,
    takeoff: state.takeoff,
    code: state.code,
    players: state.players,
    power: state.power,
    spare: state.spare,
    tubeHeat: state.tubeHeat,
    ventReadyIn: state.ventReadyIn,
    lostUnit: state.lostUnit,
    blown: state.blown,
    fuses: state.fuses,
    drain: state.drain,
    callout: state.callout,
    fires: state.fires,
    storm: state.storm,
    raid: state.raid,
    shortHanded: state.shortHanded,
    flight: state.flight,
    log: state.log,
    stats: state.stats,
    heat: state.heat,
    climb: state.climb,
    breaches: state.breaches,
    opened: state.opened,
    patched: state.patched,
    steering: state.steering,
    drift: state.drift,
    rock: state.rock,
    altitude: state.altitude,
    timeLeft: state.timeLeft,
    result: state.result,
    kit: state.kit,
    route: state.route,
    bell: state.bell,
    cabinBell: state.cabinBell,
    steam: state.steam,
    stoke: state.stoke,
    shout: state.shout,
    lampsOn: state.lampsOn,
    props: state.props,
  };
}

export function applySnapshot(s) {
  state.phase = s.phase ?? state.phase;
  state.countdown = s.countdown ?? null;
  state.takeoff = s.takeoff ?? 0;
  state.code = s.code ?? state.code;
  state.players = s.players ?? {};
  state.power = s.power ?? state.power;
  state.spare = s.spare ?? state.spare;
  state.tubeHeat = s.tubeHeat ?? state.tubeHeat;
  state.ventReadyIn = s.ventReadyIn ?? 0;
  state.lostUnit = s.lostUnit ?? state.lostUnit;
  state.blown = s.blown ?? state.blown;
  state.fuses = s.fuses ?? state.fuses;
  state.drain = s.drain ?? 0;
  state.callout = s.callout ?? state.callout;
  state.fires = s.fires ?? state.fires;
  state.storm = s.storm ?? state.storm;
  state.raid = s.raid ?? state.raid;
  state.shortHanded = s.shortHanded ?? false;
  state.flight = s.flight ?? state.flight;
  state.log = s.log ?? state.log;
  state.stats = s.stats ?? state.stats;
  state.heat = s.heat ?? state.heat;
  state.climb = s.climb ?? 0;
  state.breaches = s.breaches ?? state.breaches;
  state.opened = s.opened ?? state.opened;
  state.patched = s.patched ?? state.patched;
  state.steering = s.steering ?? 0;
  state.drift = s.drift ?? 0;
  state.rock = s.rock ?? state.rock;
  state.altitude = s.altitude ?? state.altitude;
  state.timeLeft = s.timeLeft ?? state.timeLeft;
  state.result = s.result ?? null;
  state.kit = s.kit ?? state.kit;
  state.route = s.route ?? state.route;
  state.bell = s.bell ?? state.bell;
  state.cabinBell = s.cabinBell ?? state.cabinBell;
  state.steam = s.steam ?? state.steam;
  state.stoke = s.stoke ?? state.stoke;
  state.shout = s.shout ?? state.shout;
  state.lampsOn = s.lampsOn ?? state.lampsOn;
  state.props = s.props ?? state.props;
}

// What a tube actually delivers: nothing while its fuse is blown.
export function livePower(i) {
  return state.blown[i] ? 0 : state.power[i];
}

export function roleTaken(role, exceptId) {
  return Object.values(state.players).some((p) => p.role === role && p.id !== exceptId);
}

export function playerCount() {
  return Object.keys(state.players).length;
}
