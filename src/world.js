// Builds the ship and the dock from boxes. 1 unit = 1 metre.
// Replace with Blender .glb models later (public/models/).

import * as THREE from 'three';
import { RULES } from './state.js';

export const SHIP = {
  length: 24, // x: -12 .. 12
  width: 6, // z: -3 .. 3
  wallHeight: 3,
  doorWidth: 1.5,
  doorHeight: 2.2,
  thickness: 0.2,
};

// The dock lies off the port side. While the ship is moored it does not
// rock, so dock and ship share one set of coordinates.
export const DOCK = {
  length: 20, // x: -10 .. 10
  width: 10, // z: -15 .. -5
  top: -1.2, // one long stride below the deck
  zFar: -15,
  zNear: -5,
};

// The cargo door in the port wall, and the gangplank that climbs to it.
export const GANGPLANK = { halfWidth: 1, zFoot: -5, zTop: -3 };

// Where the pilot stands when they take the wheel: one stride behind it.
export const HELM_STANCE = { x: 8.9, z: 0, look: -Math.PI / 2 };

// Power tubes: 0 units is a stub, maxPerTube fills the tube.
// Starboard wall: the port side of the power room is the cargo doorway.
const TUBE = { min: 0.4, max: 2, size: 0.4, z: 2.4, xs: [-1.2, 0, 1.2] };

// floor = a muted inlay underfoot, color = the bright stripe along the walls.
export const ROOMS = [
  { id: 'engine', name: 'Engine room', x: -8, color: '#e2574c', floor: '#8e4039' },
  { id: 'power', name: 'Power room', x: 0, color: '#49b97a', floor: '#2f6e4f' },
  { id: 'helm', name: 'Helm', x: 8, color: '#4a86e8', floor: '#35548e' },
];

// Where the hull can spring a leak: three spots in each room, clear of
// the stations and of the cargo doorway. The host opens them one at a
// time during a flight.
export const BREACH_SPOTS = [
  { id: 'e0', room: 'engine', x: -9.5, z: 1.9 },
  { id: 'e1', room: 'engine', x: -6.5, z: 1.6 },
  { id: 'e2', room: 'engine', x: -10.5, z: -1.5 },
  { id: 'p0', room: 'power', x: -2.6, z: 1.6 },
  { id: 'p1', room: 'power', x: 2.6, z: -1.6 },
  { id: 'p2', room: 'power', x: 0.2, z: 0.6 },
  { id: 'h0', room: 'helm', x: 6.2, z: 1.8 },
  { id: 'h1', room: 'helm', x: 9.5, z: -1.8 },
  { id: 'h2', room: 'helm', x: 7, z: -1.2 },
];

// One locker per role, in role order, along the far rail of the dock.
export const LOCKERS = [
  { role: 'mechanic', x: -3, color: '#e2574c' },
  { role: 'engineer', x: 0, color: '#49b97a' },
  { role: 'pilot', x: 3, color: '#4a86e8' },
];

const WINDOW = { width: 3, bottom: 1.1, top: 2.4 };

export function addSky(scene) {
  scene.background = new THREE.Color('#353a68');
  scene.fog = new THREE.Fog('#353a68', 30, 160);
}

export function addLights(scene) {
  // The ground colour matters indoors: it is what lights the ceiling and
  // every downward face, and without it the hull reads as a cave.
  scene.add(new THREE.HemisphereLight('#ffd9a0', '#b5a493', 2.8));
  const sun = new THREE.DirectionalLight('#fff2d6', 1.3);
  sun.position.set(8, 12, 10);
  scene.add(sun);
}

// How high the floor is under a given spot. Flat ground was enough until
// the dock arrived: now there is a platform, a ramp and the deck.
export function groundHeight(x, z, phase) {
  // The wall slab counts as inside, or the threshold under the cargo door
  // would be a 10 cm strip of thin air.
  const insideHull = Math.abs(x) < SHIP.length / 2 - 0.1 && Math.abs(z) < SHIP.width / 2 + 0.05;
  if (insideHull) return 0;
  if (phase === 'flight') return 0; // the dock is gone; nothing else to stand on

  const { halfWidth, zFoot, zTop } = GANGPLANK;
  if (Math.abs(x) <= halfWidth && z >= zFoot && z <= zTop) {
    const climbed = (z - zFoot) / (zTop - zFoot); // 0 at the dock, 1 at the door
    return DOCK.top + climbed * -DOCK.top;
  }
  return DOCK.top;
}

// Returns the ship group plus the boxes a player cannot walk through.
// The colliders are in ship space, so they stay correct while the ship rocks.
export function buildShip() {
  const ship = new THREE.Group();
  const colliders = [];
  const { length, width, wallHeight, doorWidth, doorHeight, thickness } = SHIP;

  const wood = new THREE.MeshStandardMaterial({ color: '#8a5a36', flatShading: true });
  const deck = new THREE.MeshStandardMaterial({ color: '#a87447', flatShading: true });
  const metal = new THREE.MeshStandardMaterial({ color: '#6b7183', flatShading: true });

  // Scenery: seen, but walked through (floor, ceiling, accents, balloon).
  const part = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    ship.add(mesh);
    return mesh;
  };

  // A solid part: added to the ship and remembered as a collider.
  const solid = (geometry, material, x, y, z) => {
    const mesh = part(geometry, material, x, y, z);
    mesh.updateMatrixWorld(true);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    return mesh;
  };

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // Hull: floor, ceiling, starboard wall, stern wall.
  part(box(length, 0.3, width), deck, 0, -0.15, 0);
  part(box(length, thickness, width), wood, 0, wallHeight + 0.1, 0);
  solid(box(length, wallHeight, thickness), wood, 0, wallHeight / 2, width / 2);
  solid(box(thickness, wallHeight, width), wood, -length / 2, wallHeight / 2, 0);

  // Port wall, with the cargo door the gangplank climbs to.
  const portZ = -width / 2;
  const gap = GANGPLANK.halfWidth;
  const panel = length / 2 - gap;
  for (const side of [-1, 1]) {
    solid(box(panel, wallHeight, thickness), wood, side * (gap + panel / 2), wallHeight / 2, portZ);
  }
  solid(box(gap * 2, wallHeight - doorHeight, thickness), wood, 0, (wallHeight + doorHeight) / 2, portZ);

  // The hatch that closes once the ship casts off (step 6 hides it at the dock).
  const hatch = part(box(gap * 2, doorHeight, thickness), wood, 0, doorHeight / 2, portZ);
  hatch.updateMatrixWorld(true);
  const hatchCollider = new THREE.Box3().setFromObject(hatch);

  // Bow wall with a window gap, so the pilot can see what is coming.
  const bowX = length / 2;
  const sidePiece = (width - WINDOW.width) / 2;
  for (const side of [-1, 1]) {
    solid(
      box(thickness, wallHeight, sidePiece),
      wood,
      bowX,
      wallHeight / 2,
      side * (WINDOW.width / 2 + sidePiece / 2)
    );
  }
  solid(box(thickness, WINDOW.bottom, WINDOW.width), wood, bowX, WINDOW.bottom / 2, 0);
  solid(
    box(thickness, wallHeight - WINDOW.top, WINDOW.width),
    wood,
    bowX,
    (wallHeight + WINDOW.top) / 2,
    0
  );

  // Two inner walls, each with a door gap you can walk through.
  for (const x of [-4, 4]) {
    const side = (width - doorWidth) / 2;
    for (const sign of [-1, 1]) {
      solid(box(thickness, wallHeight, side), wood, x, wallHeight / 2, sign * (doorWidth / 2 + side / 2));
    }
    solid(box(thickness, wallHeight - doorHeight, doorWidth), wood, x, (wallHeight + doorHeight) / 2, 0);
  }

  // Room accents: a colored floor inlay and a stripe along both side walls.
  for (const room of ROOMS) {
    const accent = new THREE.MeshStandardMaterial({ color: room.color, flatShading: true });
    const inlay = new THREE.MeshStandardMaterial({ color: room.floor, flatShading: true });
    part(box(7.4, 0.06, 5.4), inlay, room.x, 0.03, 0);
    for (const z of [-width / 2, width / 2]) {
      part(box(7.4, 0.22, 0.06), accent, room.x, 2.55, z - Math.sign(z) * 0.08);
    }
  }

  const stations = buildStations(ship, colliders, solid, box, metal);
  const breaches = buildBreaches(ship, part, box);

  // The gas bag overhead: decoration, never walked into.
  const balloon = part(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshStandardMaterial({ color: '#c86a33', flatShading: true }),
    0,
    9,
    0
  );
  balloon.scale.set(14, 4, 5);

  // The rock the pilot dodges, waiting out of sight until one is thrown.
  const rock = part(
    box(1.6, 1.6, 1.6),
    new THREE.MeshStandardMaterial({ color: '#6f6a63', flatShading: true }),
    0,
    1.7,
    0
  );
  rock.name = 'rock';
  rock.visible = false;

  const dock = buildDock(ship, box);

  return {
    ship,
    rock,
    colliders,
    breaches,
    hatch,
    ...stations,
    ...dock,
    // Which boxes block a player depends on where the game is: at the dock
    // the hatch is open and the dock is solid, in flight the opposite.
    lobbyColliders: [...colliders, ...dock.dockColliders],
    lobbyGatedColliders: [...colliders, ...dock.dockColliders, dock.gateCollider],
    flightColliders: [...colliders, hatchCollider],
  };
}

// Draw the ship and the dock the way the state says they are.
export function applyState(world, state, localAtWheel = false) {
  world.tubes.forEach((tube, i) => {
    const height = TUBE.min + (state.power[i] / RULES.maxPerTube) * (TUBE.max - TUBE.min);
    tube.scale.y = height;
    tube.position.y = height / 2;
  });
  // A breach is drawn while it is open; patching it closes the hole.
  // The prompt goes with it, so a mended spot cannot be patched twice.
  for (const [id, mesh] of Object.entries(world.breaches)) {
    const open = !!state.breaches[id];
    mesh.visible = open;
    mesh.userData.interact = open ? mesh.userData.openInteract : null;
  }

  // The rock flies at the bow window, sliding aside as the helm answers.
  world.rock.visible = state.rock.active;
  if (state.rock.active) {
    // High enough to clear the wheel: a rock lined up to hit is the one
    // the pilot most needs to see, and the wheel sits dead centre.
    world.rock.position.set(
      SHIP.length / 2 + state.rock.distance,
      2.5,
      (state.rock.lane - state.drift) * 3.2
    );
    world.rock.rotation.set(state.rock.distance * 0.08, state.rock.distance * 0.05, 0);
  }
  world.wheelDisc.rotation.y = state.steering * 2.2;
  world.wheelMount.userData.interact.label = localAtWheel ? 'Leave the wheel' : 'Take the wheel';

  const atDock = state.phase === 'lobby';
  world.dock.visible = atDock;
  world.hatch.visible = !atDock;

  // A taken locker goes dark and wears its owner's name.
  for (const locker of world.lockers) {
    const owner = Object.values(state.players).find((p) => p.role === locker.userData.takes);
    const taken = Boolean(owner);
    locker.material.color.set(taken ? locker.userData.darkColor : locker.userData.freeColor);
    locker.userData.interact = taken ? null : locker.userData.freeInteract;
    const label = locker.userData.label;
    label.visible = taken;
    if (taken) drawLabel(label, owner.name);
  }
  drawLabel(world.board, state.code ? `Room ${state.code}` : 'Room ...');
}

function buildBreaches(ship, part, box) {
  const torn = new THREE.MeshStandardMaterial({ color: '#241a12', flatShading: true });
  const breaches = {};
  for (const spot of BREACH_SPOTS) {
    const mesh = part(box(1, 0.08, 1), torn, spot.x, 0.04, spot.z);
    mesh.name = spot.id;
    mesh.visible = false; // nothing is leaking until the host says so
    mesh.userData.openInteract = {
      label: 'Patch',
      role: 'mechanic',
      action: 'patch',
      hold: RULES.patchSeconds,
      id: spot.id,
    };
    mesh.userData.interact = null;
    breaches[spot.id] = mesh;
  }
  return breaches;
}

function buildStations(ship, colliders, solid, box, metal) {
  const orange = new THREE.MeshStandardMaterial({ color: '#e08a2e', flatShading: true });
  const brass = new THREE.MeshStandardMaterial({ color: '#b9892f', flatShading: true });

  // Engine room: the engine block, the furnace, and the mechanic's kit.
  solid(box(2.2, 1.8, 2), metal, -8, 0.9, -1.8).name = 'engine';
  solid(box(0.7, 0.7, 0.7), orange, -6.2, 0.35, -2.2).name = 'furnace';

  const kit = new THREE.Mesh(box(0.36, 0.3, 0.26), orange);
  kit.position.set(-6.6, 0.15, 1.6);
  kit.name = 'patchKit';
  kit.userData.interact = { label: 'Pick up patch kit', role: 'mechanic', action: 'pickup' };
  ship.add(kit);

  // Power room: three tubes and the lever that feeds each one.
  const tubes = [];
  const levers = [];
  TUBE.xs.forEach((x, i) => {
    // Unit-height geometry, scaled by applyState as power moves.
    const tube = new THREE.Mesh(box(TUBE.size, 1, TUBE.size), metal);
    tube.name = `tube${i}`;
    tube.position.set(x, 0.5, TUBE.z);
    ship.add(tube);
    tubes.push(tube);

    // The collider covers a full tube, so it does not change as power moves.
    colliders.push(
      new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(x, TUBE.max / 2, TUBE.z),
        new THREE.Vector3(TUBE.size, TUBE.max, TUBE.size)
      )
    );

    const lever = new THREE.Mesh(box(0.22, 0.22, 0.22), brass);
    lever.position.set(x, 1.05, TUBE.z - 0.31);
    lever.name = `lever${i}`;
    lever.userData.interact = { label: 'Power up', role: 'engineer', action: 'power', index: i };
    ship.add(lever);
    levers.push(lever);
  });

  // Helm: the wheel on its mount, spokes so you can see it turn. It sits
  // low, below the pilot's sightline, or it hides the one rock that is
  // lined up to hit - the one they most need to see.
  const wheelMount = new THREE.Group();
  wheelMount.position.set(10.4, 1, 0);
  wheelMount.rotation.z = Math.PI / 2; // tip the disc upright, facing the bow
  wheelMount.name = 'wheel';
  wheelMount.userData.interact = { label: 'Take the wheel', role: 'pilot', action: 'wheel' };

  const wheelDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 16), brass);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(box(1, 0.09, 0.09), brass);
    spoke.rotation.y = (i * Math.PI) / 3;
    wheelDisc.add(spoke);
  }
  wheelMount.add(wheelDisc);
  ship.add(wheelMount);
  wheelMount.updateMatrixWorld(true);
  colliders.push(new THREE.Box3().setFromObject(wheelMount));

  // The wheel is now too low for a level crosshair, so the station is
  // taken and left through an invisible pane at eye height. Three still
  // raycasts meshes it does not draw, and nothing is hidden behind it.
  const helmStation = new THREE.Mesh(box(0.1, 0.9, 1.4), brass);
  helmStation.position.set(10.4, 1.7, 0);
  helmStation.name = 'helmStation';
  helmStation.visible = false;
  helmStation.userData.interact = wheelMount.userData.interact; // one label, two targets
  ship.add(helmStation);

  return { tubes, levers, wheelMount, wheelDisc, helmStation, kit };
}

// The dock: a plank platform with a rail round it, three lockers, the
// gangplank, and a board with the room code on it.
function buildDock(ship, box) {
  const dock = new THREE.Group();
  dock.name = 'dock';
  ship.add(dock);

  const dockColliders = [];
  const plank = new THREE.MeshStandardMaterial({ color: '#7d5b3c', flatShading: true });
  const post = new THREE.MeshStandardMaterial({ color: '#5d4228', flatShading: true });

  const add = (geometry, material, x, y, z, solid = false) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    dock.add(mesh);
    if (solid) {
      mesh.updateMatrixWorld(true);
      dockColliders.push(new THREE.Box3().setFromObject(mesh));
    }
    return mesh;
  };

  const midZ = (DOCK.zFar + DOCK.zNear) / 2;
  add(box(DOCK.length, 0.4, DOCK.width), plank, 0, DOCK.top - 0.2, midZ);

  // Rails all the way round except the gangplank, so the only way off the
  // dock is onto the ship.
  const railY = DOCK.top + 0.5;
  add(box(DOCK.length, 1, 0.2), post, 0, railY, DOCK.zFar, true);
  for (const x of [-DOCK.length / 2, DOCK.length / 2]) {
    add(box(0.2, 1, DOCK.width), post, x, railY, midZ, true);
  }
  const sideRail = DOCK.length / 2 - GANGPLANK.halfWidth;
  for (const sign of [-1, 1]) {
    add(
      box(sideRail, 1, 0.2),
      post,
      sign * (GANGPLANK.halfWidth + sideRail / 2),
      railY,
      DOCK.zNear,
      true
    );
  }

  // The gangplank itself: a sloped board from the dock up to the door.
  const run = GANGPLANK.zTop - GANGPLANK.zFoot;
  const rise = -DOCK.top;
  const ramp = add(
    box(GANGPLANK.halfWidth * 2, 0.16, Math.hypot(run, rise)),
    plank,
    0,
    DOCK.top / 2,
    (GANGPLANK.zFoot + GANGPLANK.zTop) / 2
  );
  ramp.rotation.x = -Math.atan2(rise, run);
  ramp.name = 'gangplank'; // the Blender dock keeps this one

  // An invisible gate at the foot of the ramp. It is a collider only for
  // players who have not taken a uniform yet.
  const gateCollider = new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(0, DOCK.top + 1, GANGPLANK.zFoot - 0.1),
    new THREE.Vector3(GANGPLANK.halfWidth * 2, 2, 0.3)
  );

  const lockers = LOCKERS.map((spec) => {
    const material = new THREE.MeshStandardMaterial({ color: spec.color, flatShading: true });
    const locker = add(box(1, 1.8, 0.6), material, spec.x, DOCK.top + 0.9, DOCK.zFar + 1.2, true);
    locker.name = `locker-${spec.role}`;
    locker.userData.takes = spec.role;
    locker.userData.freeColor = new THREE.Color(spec.color);
    locker.userData.darkColor = new THREE.Color(spec.color).multiplyScalar(0.35);
    locker.userData.freeInteract = {
      label: `Take the ${spec.role} uniform`,
      action: 'role',
      takes: spec.role,
    };
    locker.userData.interact = locker.userData.freeInteract;

    const label = createLabel(1.4, 0.36);
    label.position.set(spec.x, DOCK.top + 2.1, DOCK.zFar + 1.6);
    label.visible = false;
    dock.add(label);
    locker.userData.label = label;
    return locker;
  });

  // The room code, big enough to read out loud across a room.
  const board = createLabel(5, 1.2, 512, 128);
  board.position.set(0, DOCK.top + 3.4, DOCK.zFar + 0.4);
  dock.add(board);

  return { dock, dockColliders, gateCollider, lockers, board };
}

// A plane with text painted on it: good enough for a name over a locker.
export function createLabel(width, height, pixelWidth = 256, pixelHeight = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true })
  );
  mesh.userData.canvas = canvas;
  mesh.userData.texture = texture;
  mesh.userData.text = null;
  return mesh;
}

// Only repaint when the words change: this runs every frame.
export function drawLabel(mesh, text) {
  if (mesh.userData.text === text) return;
  mesh.userData.text = text;
  const canvas = mesh.userData.canvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(20, 24, 48, 0.85)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff4dc';
  ctx.font = `bold ${Math.round(canvas.height * 0.52)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width * 0.9);
  mesh.userData.texture.needsUpdate = true;
}
