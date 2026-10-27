// Training: a solo flight that teaches every job aboard, one at a time.
//
// It runs offline (no room is opened) on the host's own rules, with the
// game in its gentle mode (game.setTraining): nothing happens by chance,
// the clock stands still and the ship cannot be lost. Each lesson sets up
// one thing through game.js's training helpers (a hole, a fire, a rock...),
// says what to do in a card on the left, puts a marker over where to do it,
// and moves on once the state shows it done.
//
// The player wears each job's uniform in turn (mechanic, engineer, pilot);
// flying solo, every station is theirs anyway.

import * as THREE from 'three';
import { RULES, local, state } from './state.js';
import * as game from './game.js';
import { BREACH_SPOTS, FIRE_SPOTS, HOOK_HEIGHT, hookX } from './world.js';
import { keyLabel, moveLabel, settings } from './settings.js';
import { play } from './sound.js';
import { load, save } from './save.js';

// Where things are, in ship space (the Blender rooms put them there).
// Each is the point the marker's tip hangs over.
const AT = {
  rack: { x: -6, y: 1.95, z: 2.6 }, // supply rack, engine room, by the door
  furnace: { x: -8.2, y: 1.15, z: -1.86 },
  crate: { x: -14.45, y: 1.35, z: 2.5 }, // the big crate of spare fuses
  buckets: { x: -14.3, y: 1.7, z: -2.8 }, // the bucket rail
  vent: { x: 2, y: 1.75, z: -2.5 }, // the steam valve, power room
  fuseBox: { x: 4.3, y: 2.05, z: -2.8 },
  wheel: { x: 13.4, y: 1.6, z: 0 },
};
const LEVER_X = [-1.2, 0, 1.2]; // engines, shields, lift
const lever = (i) => ({ x: LEVER_X[i], y: 1.35, z: 2.09 });
const downHandle = (i) => ({ x: LEVER_X[i], y: 0.85, z: 1.9 });
const hole = (id) => {
  const spot = BREACH_SPOTS.find((s) => s.id === id);
  return { x: spot.x, y: 0.55, z: spot.z };
};

// Where the player starts: the engine room, looking toward the bow.
export const TRAINING_START = { x: -10.6, y: 0.4, z: 0.6, yaw: -Math.PI / 2 };

const HOOK_SPOT = 2; // the helm's wall: the pirates come at the pilot
const RAID_SIDE = 1; // starboard

const key = (action) => keyLabel(settings.keys[action]);
const me = () => state.players[local.id];
const kitAt = () => ({ x: state.kit.x, y: 0.75, z: state.kit.z });
const near = (a, b, d) => Math.hypot(a.x - b.x, a.z - b.z) < d;

// --- the lessons --------------------------------------------------------------
// chapter: whose job; role: the uniform worn for it. setup(t) runs once when
// the lesson starts (t: the lesson's own scratch object); done(t) is asked
// every frame; target(t) is where the marker goes (null: none); text(t)
// says what to do; watch(t, now) may run every frame to retry a missed try.

const LESSONS = [
  {
    chapter: 'Mechanic',
    role: 'mechanic',
    title: 'Look and walk',
    text: () => `Move the mouse to look around and ${moveLabel()} to walk. The orange box on the floor is the patch kit: walk over to it.`,
    target: kitAt,
    done: () => near(me(), state.kit, 1.6),
  },
  {
    title: 'Pick up the patch kit',
    text: () => `Look at the patch kit and press ${key('interact')}.`,
    target: kitAt,
    done: () => state.kit.heldBy === local.id,
  },
  {
    title: 'Patch a hole',
    setup: () => game.tearHole('e0'),
    text: () => `A hole has torn in the hull! Every open hole drags the ship down. Look at the hole and hold ${key('interact')} until the bar fills.`,
    target: () => (state.kit.heldBy === local.id ? hole('e0') : kitAt()),
    done: () => !state.breaches.e0,
  },
  {
    title: 'Restock the kit',
    setup: () => {
      state.kit.planks = Math.min(state.kit.planks, 1);
    },
    text: () =>
      `The kit holds ${RULES.kitPlanks} planks, one for each hole, and it's nearly empty. Hold ${key('interact')} at the supply rack (the shelves near the door) to fill it up.`,
    target: () => (state.kit.heldBy === local.id ? AT.rack : kitAt()),
    done: () => state.kit.planks >= RULES.kitPlanks,
  },
  {
    title: 'Put the kit down',
    text: () => `You carry one thing at a time, and the next jobs need empty hands. Put the kit down: ${key('drop')}.`,
    target: () => null,
    done: () => state.kit.heldBy !== local.id,
  },
  {
    title: 'Stoke the furnace',
    setup: () => {
      state.heat = 0.3;
    },
    text: () =>
      `The furnace makes the ship's power, and it burns down. Hold ${key('interact')} at the furnace to shovel coal until the Furnace bar at the top of the screen is past 70%.`,
    target: () => AT.furnace,
    done: () => state.heat >= 0.7,
  },
  {
    chapter: 'Engineer',
    role: 'engineer',
    title: 'Share out the power',
    setup: () => {
      // A clean layout to start from: one unit in each tube, three spare.
      state.heat = 0.74; // makes 6 units
      state.power = [1, 1, 1];
      state.spare = 3;
      state.blown = [false, false, false];
      state.tubeHeat = [0, 0, 0];
    },
    text: () =>
      `Walk into the power room. Each brass lever puts a spare unit into its tube: Engines steer, Shields stop rocks, Lift holds the ship up. Pull the Lift lever (the left one, under the LIFT sign, ${key('interact')}) until Lift has 3 units.`,
    target: () => lever(2),
    done: () => state.power[2] >= 3,
  },
  {
    title: 'Take power out',
    setup: (t) => {
      if (state.power[0] < 1) {
        state.power[0] = 1;
        state.spare = Math.max(0, state.spare - 1);
      }
      t.from = state.power[0];
    },
    text: () => `The red handle under each lever takes a unit back out, into the spares. Take one unit out of Engines (the right tube, under the ENGINES sign).`,
    target: () => downHandle(0),
    done: (t) => state.power[0] < t.from,
  },
  {
    title: 'Vent a hot tube',
    setup: (t) => {
      state.tubeHeat[1] = RULES.overheatWarn + 1;
      state.ventReadyIn = 0;
      t.steam = state.steam;
    },
    text: () =>
      `A tube held at 4 units heats up, and after ${RULES.overheatSeconds} s its fuse blows. Shields is running hot (it glows red). Hold ${key('interact')} on the steam valve by the door for ${RULES.ventSeconds} seconds. It needs ${RULES.ventCooldown} s to build pressure again after.`,
    target: () => AT.vent,
    done: (t) => state.steam > t.steam && state.tubeHeat[1] < 1,
  },
  {
    title: 'Fetch a spare fuse',
    setup: () => {
      state.blown[0] = true;
      state.tubeHeat[0] = 0;
      state.fuses = Math.max(state.fuses, 1);
    },
    text: () =>
      `The Engines fuse has blown: that tube is dead until it gets a new one. Fetch a spare fuse from the big crate at the back of the engine room (${key('interact')}). Hands full? ${key('drop')} puts things down.`,
    target: () => AT.crate,
    done: () => !!me().fuse || !state.blown[0],
  },
  {
    title: 'Fit the fuse',
    text: () => `Now take it to the fuse box on the power room wall and hold ${key('interact')} there.`,
    target: () => (me().fuse ? AT.fuseBox : AT.crate),
    done: () => !state.blown[0],
  },
  {
    title: 'Put out a fire',
    setup: () => game.ignite('power'),
    text: () =>
      `Fire in the power room! A fire shuts down its room's stations, and in a real flight it spreads every ${RULES.fireSpreadSeconds} s. Take a bucket from the rail at the back of the engine room (${key('interact')}), carry it to the fire and press ${key('interact')}. Two buckets put it out.`,
    target: () => (me().bucket ? { x: FIRE_SPOTS.power.x, y: 2.1, z: FIRE_SPOTS.power.z } : AT.buckets),
    done: () => !state.fires.power,
  },
  {
    chapter: 'Pilot',
    role: 'pilot',
    title: 'Take the wheel',
    setup: () => {
      // The engineer's job done right: engines at 2, or the wheel answers
      // at half speed (at 0, a quarter).
      state.heat = Math.max(state.heat, 0.74);
      state.blown = [false, false, false];
      state.power = [2, 1, 3];
      state.spare = 0;
    },
    text: () => `Walk to the helm at the bow and take the wheel (${key('interact')}).`,
    target: () => AT.wheel,
    done: () => !!me().atWheel,
  },
  {
    title: 'Dodge a rock',
    setup: (t) => {
      t.hits = state.log.rockHits;
      t.throwAt = performance.now() + 1500;
      t.passed = false;
    },
    text: (t) =>
      `${t.missed ? 'It hit you! Here comes another. ' : ''}A rock is coming at the bow. Hold ${key('left')} or ${key('right')} to steer; let go and the wheel centres. Keep your marker on the gauge out of the red band. (With less than 2 units in Engines, the wheel answers slowly.)`,
    watch: (t, now) => {
      if (t.throwAt && now >= t.throwAt) {
        t.throwAt = 0;
        game.throwRock(state.drift); // dead ahead
        t.thrown = true;
      }
      if (t.thrown && !state.rock.active) {
        t.thrown = false;
        if (state.log.rockHits > t.hits) {
          t.hits = state.log.rockHits;
          t.missed = true;
          t.throwAt = now + 1500;
        } else t.passed = true;
      }
    },
    target: () => null,
    done: (t) => t.passed,
  },
  {
    title: 'Brace for a storm wall',
    setup: (t) => {
      t.hits = state.storm.hits;
      t.thrown = state.log.thrown;
      t.rang = false;
      game.startStorm(12);
    },
    text: (t) =>
      `${t.again ? 'Not quite. Here comes another! ' : ''}A storm wall is coming, and only the pilot can see it. Ring the bell (${key('bell')}) so the crew braces. At the wheel you're braced already; anywhere else, hold ${key('interact')}.`,
    watch: (t) => {
      if (state.storm.active && state.storm.warned) t.rang = true;
      if (state.storm.hits > t.hits) {
        t.hits = state.storm.hits;
        if (t.rang && state.log.thrown === t.thrown) t.passed = true;
        else {
          t.again = true;
          t.rang = false;
          t.thrown = state.log.thrown;
          game.startStorm(12);
        }
      }
    },
    target: () => null,
    done: (t) => t.passed,
  },
  {
    title: 'Repel a boarder',
    setup: (t) => {
      game.startRaid(RAID_SIDE);
      game.throwHook(HOOK_SPOT);
      game.boardNow(HOOK_SPOT);
      t.overboard = state.raid.overboard;
    },
    text: () =>
      `Pirates! One has swung aboard at the helm and blocks the wheel. Tap ${key('interact')} on him to shove him back: ${RULES.shovesToRepel} shoves, or one bucket of water, and he's overboard.`,
    target: () => {
      const b = Object.values(state.raid.boarders)[0];
      return b ? { x: b.x, y: b.y + 1.7, z: b.z } : null;
    },
    done: (t) => state.raid.overboard > t.overboard,
  },
  {
    title: 'Cut the grapple',
    text: () => `Their grapple hook drags the ship down and pulls her sideways. Hold ${key('interact')} on it to cut it loose.`,
    target: () => ({ x: hookX(HOOK_SPOT, RAID_SIDE), y: HOOK_HEIGHT + 0.75, z: RAID_SIDE * 2.5 }),
    done: () => !Object.keys(state.raid.hooks).length,
  },
];

const FINALE = {
  title: 'Training complete!',
  text: () =>
    `That's every job aboard. In a real flight it all happens at once, for three minutes, with a crew of up to three: tell each other what you need with ${key('callout')}. Good luck up there!`,
};

// --- running it -----------------------------------------------------------------

let active = false;
let finished = false;
let index = 0;
let lesson = null; // { def, t, doneAt }
let marker = null;
let ui = null;
let onFinish = null;

export const trainingActive = () => active;
export const trainingFinished = () => active && finished;
export const trainingDoneBefore = () => !!load().trainingDone;

// world: the scene's world (for the marker); finish(): called once the last
// lesson is done, with the player's mouse freed for the buttons.
export function startTraining({ world, finish }) {
  active = true;
  finished = false;
  index = 0;
  onFinish = finish ?? null;
  ui ??= findUi();
  marker ??= buildMarker(world.ship);
  ui.card.hidden = false;
  ui.done.hidden = true;
  begin(0);
}

export function stopTraining() {
  active = false;
  finished = false;
  lesson = null;
  if (marker) marker.visible = false;
  if (ui) {
    ui.card.hidden = true;
    ui.done.hidden = true;
  }
}

// From the pause menu: move on without doing it (the lesson after it may
// need what this one would have left, so the next setup is run as usual).
export function skipLesson() {
  if (!active || finished || !lesson) return;
  // Clear what the skipped lesson left behind, so it cannot block the next.
  for (const id of Object.keys(state.breaches)) state.breaches[id] = false;
  for (const room of Object.keys(state.fires)) state.fires[room] = null;
  state.blown = [false, false, false];
  state.storm.active = false;
  if (state.raid.phase === 'alongside') {
    state.raid.hooks = {};
    state.raid.boarders = {};
  }
  state.rock.active = false;
  next();
}

function begin(i) {
  index = i;
  const def = LESSONS[i];
  const t = {};
  const role = roleFor(i);
  if (me() && role) me().role = role;
  def.setup?.(t);
  lesson = { def, t, doneAt: 0 };
  draw();
}

// The uniform for a lesson: its chapter's.
function roleFor(i) {
  for (let k = i; k >= 0; k--) if (LESSONS[k].role) return LESSONS[k].role;
  return null;
}
function chapterFor(i) {
  for (let k = i; k >= 0; k--) if (LESSONS[k].chapter) return LESSONS[k].chapter;
  return '';
}

function next() {
  if (index + 1 < LESSONS.length) begin(index + 1);
  else finish();
}

function finish() {
  finished = true;
  lesson = null;
  marker.visible = false;
  save({ ...load(), trainingDone: true });
  ui.chapter.textContent = 'Training';
  ui.title.textContent = FINALE.title;
  ui.text.textContent = FINALE.text();
  ui.check.hidden = true;
  ui.bar.style.width = '100%';
  ui.card.hidden = true;
  ui.doneTitle.textContent = FINALE.title;
  ui.doneText.textContent = FINALE.text();
  ui.done.hidden = false;
  play('ui_ping_chime', 0.7);
  onFinish?.();
}

// Every frame, while training: check the lesson, run its timers, place the
// marker, redraw the card if its words changed.
export function updateTraining(now) {
  if (!active || finished || !lesson || !me()) return;
  const { def, t } = lesson;
  def.watch?.(t, now);
  if (!lesson.doneAt && def.done(t)) {
    lesson.doneAt = now;
    play('ui_ping_chime', 0.6);
  }
  if (lesson.doneAt && now - lesson.doneAt > 1100) {
    next();
    return;
  }
  const target = lesson.doneAt ? null : def.target?.(t);
  marker.visible = !!target;
  if (target) {
    marker.position.set(target.x, target.y + Math.sin(now / 260) * 0.08, target.z);
    marker.rotation.y = now / 600;
  }
  draw();
}

function draw() {
  if (!lesson) return;
  const { def, t, doneAt } = lesson;
  const chapter = `${chapterFor(index)} · ${index + 1} of ${LESSONS.length}`;
  const text = def.text(t);
  if (ui.chapter.textContent !== chapter) ui.chapter.textContent = chapter;
  if (ui.title.textContent !== def.title) ui.title.textContent = def.title;
  if (ui.text.textContent !== text) ui.text.textContent = text;
  ui.check.hidden = !doneAt;
  ui.card.classList.toggle('lesson-done', !!doneAt);
  ui.bar.style.width = `${Math.round(((index + (doneAt ? 1 : 0)) / LESSONS.length) * 100)}%`;
}

function findUi() {
  const $ = (id) => document.getElementById(id);
  return {
    card: $('trainingCard'),
    chapter: $('trainingChapter'),
    title: $('trainingTitle'),
    text: $('trainingText'),
    check: $('trainingCheck'),
    bar: $('trainingBar'),
    done: $('trainingDone'),
    doneTitle: $('trainingDoneTitle'),
    doneText: $('trainingDoneText'),
  };
}

// A gold arrow hanging over the next place to go, seen through walls so it
// can be found from the next room.
function buildMarker(ship) {
  const gold = new THREE.MeshBasicMaterial({ color: '#ffd84d', depthTest: false, transparent: true, opacity: 0.95 });
  const group = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 12), gold);
  cone.rotation.x = Math.PI; // pointing down
  cone.position.y = 0.16; // its tip at the group's origin
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 8), gold);
  stem.position.y = 0.42;
  group.add(cone, stem);
  group.traverse((obj) => {
    obj.renderOrder = 999;
    obj.raycast = () => {}; // never in the way of a look-ray
  });
  group.visible = false;
  ship.add(group);
  return group;
}
