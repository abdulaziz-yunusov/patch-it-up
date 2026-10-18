// The waiting room from Blender (public/models/waiting_room.glb) replaces
// the coded dock. Game logic stays where it was: lockers still hand out
// uniforms, the gate still bars the gangplank, the board shows the code.
// The dock's toys (bell, speaking tube, mirror, lamp lever, route board,
// kickable crates and barrels) get their interact objects here, and
// updateDock() draws them from the shared state every frame.
//
// Blender to game coordinates: the model's open edge (Blender +X) faces
// the ship, so it is turned a quarter round and moved so that edge sits
// at DOCK.zNear. A Blender point (x, y, z) lands at (y, DOCK.top + z, x - 15).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DOCK, GANGPLANK, createLabel, drawLabel } from './world.js';
import { HATS, ROUTES, propHomes } from './state.js';
import { play } from './sound.js';

const MODEL_URL = `${import.meta.env.BASE_URL}models/waiting_room.glb`;
const OFFSET_Z = DOCK.zNear - 10; // the model's ship-side edge is at Blender x = 10

// The model brings its own little ship and trigger boxes for previewing in
// Blender. The game has the real ship and its own rules, so these go.
const PREVIEW_ONLY = ['ship_', 'col_ship', 'col_gangplank', 'gangplank_rope', 'trigger_', 'room_board_chalk'];

// What a player bumps into and cannot move. Crates and barrels are solid
// too, but their boxes follow them (see updateDock).
const SOLID = ['col_rail', 'locker_mechanic', 'locker_engineer', 'locker_pilot', 'station_', 'route_board_post', 'bench_', 'flag_pole'];
const KICKABLE = /^prop_(crate|barrel)_\d+$/;

// Every station part points at one interact object, so aiming at any
// piece of the bell or the lever works.
const STATIONS = [
  { parts: ['station_dock_bell_post', 'station_dock_bell', 'station_dock_bell_clapper'], interact: { label: 'Ring the bell', action: 'bell' } },
  { parts: ['station_mic_tube_pipe', 'station_mic_tube_horn', 'station_mic_tube_ring'], interact: { label: 'Shout down the tube', action: 'shout' } },
  { parts: ['station_mirror_glass', 'station_mirror_frame'], interact: { label: 'Try on a hat', action: 'hat' } },
  { parts: ['station_lamp_lever_box', 'station_lamp_lever_arm', 'station_lamp_lever_knob'], interact: { label: 'Pull the lamp lever', action: 'lamps' } },
  { parts: ['station_route_board'], interact: { label: 'Change route', action: 'route' } },
];

// Without an environment map a fully metallic surface renders black.
function softenMetal(material) {
  if (material.metalness > 0.5) {
    material.metalness = 0.3;
    material.roughness = Math.min(material.roughness, 0.45);
  }
}

const centreOf = (obj) => new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());

export async function loadDockModel(world) {
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  } catch (err) {
    console.warn('Waiting room model missing, keeping the coded dock:', err);
    return false;
  }

  const model = gltf.scene;
  model.name = 'waitingRoom';
  model.rotation.y = -Math.PI / 2;
  model.position.set(0, DOCK.top, OFFSET_Z);

  for (const name of PREVIEW_ONLY) {
    model.getObjectsByProperty('isObject3D', true)
      .filter((o) => o.name.startsWith(name))
      .forEach((o) => o.removeFromParent());
  }

  model.traverse((obj) => {
    // Blender custom properties arrive as plain strings ("pick_role");
    // the game expects an interact object, so none survive as-is.
    if (typeof obj.userData.interact === 'string') obj.userData.interact = null;
    if (obj.material) {
      obj.material = obj.material.clone(); // lockers and lamps change their own copy
      softenMetal(obj.material);
    }
  });

  // Out with the coded platform, rails, lockers and labels; the ramp and
  // the room-code board stay, because the game draws on them.
  const dock = world.dock;
  for (const child of [...dock.children]) {
    if (child.name !== 'gangplank' && child !== world.board) child.removeFromParent();
  }
  dock.add(model);
  dock.updateMatrixWorld(true);

  const colliders = [];
  model.traverse((obj) => {
    if (!obj.isMesh || !SOLID.some((s) => obj.name.startsWith(s))) return;
    const box = new THREE.Box3().setFromObject(obj);
    // Everything blocks from the planks up, so nobody ducks under the
    // raised chalkboard or mirror; rails also reach head height.
    box.min.y = DOCK.top;
    if (obj.name.startsWith('col_rail')) box.max.y = DOCK.top + 2;
    colliders.push(box);
  });

  // An invisible wall just behind the visible ship-side rail, in case a
  // sphere squeezes between two posts. The gangplank's mouth stays open.
  const wall = (minX, maxX, minZ, maxZ) =>
    colliders.push(
      new THREE.Box3(new THREE.Vector3(minX, DOCK.top, minZ), new THREE.Vector3(maxX, DOCK.top + 2, maxZ))
    );
  const gap = GANGPLANK.halfWidth;
  wall(-6.1, -gap, DOCK.zNear - 0.1, DOCK.zNear + 0.1);
  wall(gap, 6.1, DOCK.zNear - 0.1, DOCK.zNear + 0.1);

  // The model's lockers become the game's lockers: same rules as before.
  world.lockers = ['mechanic', 'engineer', 'pilot'].map((role) => {
    const locker = model.getObjectByName(`locker_${role}`);
    const free = locker.material.color.clone();
    locker.userData.takes = role;
    locker.userData.freeColor = free;
    locker.userData.darkColor = free.clone().multiplyScalar(0.35);
    locker.userData.freeInteract = { label: `Take the ${role} uniform`, action: 'role', takes: role };
    locker.userData.interact = locker.userData.freeInteract;

    const centre = centreOf(locker);
    const label = createLabel(1.4, 0.36);
    label.position.set(centre.x - 0.4, DOCK.top + 2.7, centre.z);
    label.rotation.y = -Math.PI / 2; // face the players, who stand to the west
    label.visible = false;
    dock.add(label);
    locker.userData.label = label;
    return locker;
  });

  // The room code goes on the Blender chalkboard at the far end.
  const boardMesh = model.getObjectByName('station_room_board');
  if (boardMesh) {
    const centre = centreOf(boardMesh);
    world.board.geometry.dispose();
    world.board.geometry = new THREE.PlaneGeometry(2.8, 0.7);
    world.board.position.set(centre.x, centre.y + 0.25, centre.z + 0.1);
    world.board.rotation.set(0, 0, 0);
  }

  // --- the toys ----------------------------------------------------

  for (const { parts, interact } of STATIONS) {
    for (const name of parts) {
      const mesh = model.getObjectByName(name);
      if (mesh) mesh.userData.interact = interact;
    }
  }
  world.routeInteract = STATIONS.find((s) => s.interact.action === 'route').interact;

  // Route name painted on the route board, facing the spawn points.
  const routeMesh = model.getObjectByName('station_route_board');
  if (routeMesh) {
    const centre = centreOf(routeMesh);
    const label = createLabel(2, 0.5);
    label.position.set(centre.x + 0.06, centre.y, centre.z);
    label.rotation.y = Math.PI / 2;
    dock.add(label);
    world.routeLabel = label;
  }

  // The bell swings from a pivot at the top of its arm.
  const bell = model.getObjectByName('station_dock_bell');
  if (bell) {
    const pivot = new THREE.Group();
    const top = centreOf(bell).add(new THREE.Vector3(0, 0.25, 0));
    pivot.position.copy(top);
    dock.add(pivot);
    pivot.attach(bell);
    const clapper = model.getObjectByName('station_dock_bell_clapper');
    if (clapper) pivot.attach(clapper);
    world.bellPivot = pivot;
  }

  // Lamps: the glowing bulbs from Blender plus a real light in each.
  world.lamps = [];
  model.traverse((obj) => {
    if (!obj.isMesh || !obj.name.startsWith('lamp_bulb')) return;
    const light = new THREE.PointLight('#ffcc80', 6, 9, 1.5);
    light.position.copy(centreOf(obj));
    dock.add(light);
    world.lamps.push({ bulb: obj, light, glow: obj.material.emissiveIntensity ?? 1 });
  });

  // Crates and barrels: each wrapped in a group at its centre so the
  // state can move and spin it, with a collider box that follows.
  world.props = {};
  for (const mesh of model.getObjectsByProperty('isMesh', true)) {
    if (!KICKABLE.test(mesh.name)) continue;
    const box = new THREE.Box3().setFromObject(mesh);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const holder = new THREE.Group();
    holder.position.copy(centre);
    dock.add(holder);
    holder.attach(mesh);
    for (const hoop of model.getObjectsByProperty('isMesh', true)) {
      if (hoop.name.startsWith(`${mesh.name}_hoop`)) holder.attach(hoop);
    }
    mesh.userData.interact = { label: 'Kick', action: 'kick', prop: mesh.name };
    const collider = new THREE.Box3();
    colliders.push(collider);
    propHomes[mesh.name] = { x: centre.x, y: centre.y, z: centre.z, h: size.y / 2 };
    world.props[mesh.name] = { holder, collider, half: size.clone().multiplyScalar(0.5) };
  }

  world.dockColliders = colliders;
  world.lobbyColliders = [...world.colliders, ...colliders];
  world.lobbyGatedColliders = [...world.colliders, ...colliders, world.gateCollider];
  return true;
}

// --- drawing the toys every frame ---------------------------------------

const _sphere = new THREE.Sphere(new THREE.Vector3(), 0.45);
const seen = { bell: null, shout: null, lampsOn: null, route: null, hat: null, kicks: {} };
let swingUntil = 0;
let toastUntil = 0;
const toastEl = () => document.getElementById('toast');

export function toast(text, ms = 3000) {
  const el = toastEl();
  if (!el) return;
  el.textContent = text;
  toastUntil = performance.now() + ms;
}

export function updateDock(world, state, local, now) {
  if (!world.props) return; // still loading, or the coded fallback dock

  // Kickable props follow the state; their colliders follow them.
  for (const [name, prop] of Object.entries(world.props)) {
    const home = propHomes[name];
    const p = state.props[name] ?? { x: home.x, y: home.y, z: home.z, ry: 0 };
    prop.holder.position.set(p.x, p.y, p.z);
    prop.holder.rotation.y = p.ry ?? 0;
    prop.collider.setFromCenterAndSize(prop.holder.position, prop.half.clone().multiplyScalar(1.6));
    // A crate that lands on someone must not trap them: its box switches
    // off until they step clear.
    for (const other of Object.values(state.players)) {
      _sphere.center.set(other.x, other.y, other.z);
      if (prop.collider.intersectsSphere(_sphere)) prop.collider.makeEmpty();
    }
    const kicked = p.moving && !seen.kicks[name];
    if (kicked) play('mechanic_cannonball_rack_clunk', 0.5);
    seen.kicks[name] = !!p.moving;
  }

  // The first frame of a session just learns the state, without fanfare.
  const first = seen.bell === null;

  if (state.bell !== seen.bell) {
    if (!first) {
      swingUntil = now + 1600;
      play('dock_ship_bell_ding', 0.7);
    }
    seen.bell = state.bell;
  }
  if (world.bellPivot) {
    const left = Math.max(0, swingUntil - now) / 1600;
    world.bellPivot.rotation.z = Math.sin(now / 90) * 0.5 * left;
  }

  if (state.shout.count !== seen.shout) {
    if (!first && state.shout.line) {
      play('comms_speaking_tube_echo', 0.7);
      toast(`${state.shout.name} shouts down the tube: "${state.shout.line}"`);
    }
    seen.shout = state.shout.count;
  }

  if (state.lampsOn !== seen.lampsOn) {
    if (!first) play('engineer_lever_clunk', 0.6);
    for (const lamp of world.lamps) {
      lamp.light.visible = state.lampsOn;
      lamp.bulb.material.emissiveIntensity = state.lampsOn ? lamp.glow : 0;
    }
    seen.lampsOn = state.lampsOn;
  }

  if (state.route !== seen.route) {
    if (!first) {
      play('ui_button_click', 0.6);
      toast(`Route: ${ROUTES[state.route].name}`);
    }
    if (world.routeLabel) drawLabel(world.routeLabel, `Route: ${ROUTES[state.route].name}`);
    seen.route = state.route;
  }
  // Everyone may look at the route board; only the host may change it.
  if (world.routeInteract) {
    world.routeInteract.label = local.isHost ? 'Change route' : 'Only the host picks the route';
    world.routeInteract.action = local.isHost ? 'route' : null;
  }

  const myHat = state.players[local.id]?.hat ?? 0;
  if (myHat !== seen.hat) {
    if (seen.hat !== null) {
      play('ui_ping_chime', 0.5);
      toast(myHat ? `You put on a ${HATS[myHat]}` : 'You take your hat off');
    }
    seen.hat = myHat;
  }

  const el = toastEl();
  if (el) el.hidden = now > toastUntil;
}

// Back at the menu: forget what was seen, so the next session starts quiet.
export function resetDockEffects() {
  seen.bell = seen.shout = seen.lampsOn = seen.route = seen.hat = null;
  seen.kicks = {};
}
