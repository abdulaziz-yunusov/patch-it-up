// Builds the ship from boxes. 1 unit = 1 metre.
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

// Room centres along x. The stations are placeholders for step 4.
// floor = a muted inlay underfoot, color = the bright stripe along the walls.
export const ROOMS = [
  { id: 'engine', name: 'Engine room', x: -8, color: '#e2574c', floor: '#8e4039' },
  { id: 'power', name: 'Power room', x: 0, color: '#49b97a', floor: '#2f6e4f' },
  { id: 'helm', name: 'Helm', x: 8, color: '#4a86e8', floor: '#35548e' },
];

const WINDOW = { width: 3, bottom: 1.1, top: 2.4 };

// Power tubes: 0 units is a stub, maxPerTube fills the tube.
const TUBE = { min: 0.4, max: 2, size: 0.4, z: -2.4, xs: [-1.2, 0, 1.2] };

// Where the pilot stands when they take the wheel: one stride behind it.
export const HELM_STANCE = { x: 8.9, z: 0, look: -Math.PI / 2 };

// Where the hull springs a leak. Step 7 opens these during a flight;
// for now all three are open so there is always something to patch.
export const BREACH_SPOTS = [
  { id: 'b0', x: -8.5, z: 1.9 },
  { id: 'b1', x: 0.8, z: 1.9 },
  { id: 'b2', x: 7.4, z: -1.9 },
];

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

// Returns the ship group plus the boxes a player cannot walk through.
// The colliders are in ship space, so they stay correct while the ship rocks.
export function buildShip() {
  const ship = new THREE.Group();
  const colliders = [];
  const { length, width, wallHeight, doorWidth, doorHeight, thickness } = SHIP;

  const wood = new THREE.MeshStandardMaterial({ color: '#8a5a36', flatShading: true });
  const deck = new THREE.MeshStandardMaterial({ color: '#a87447', flatShading: true });
  const metal = new THREE.MeshStandardMaterial({ color: '#6b7183', flatShading: true });

  // A solid part: added to the ship and remembered as a collider.
  const solid = (geometry, material, x, y, z) => {
    const mesh = part(geometry, material, x, y, z);
    mesh.updateMatrixWorld(true);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    return mesh;
  };

  // Scenery: seen, but walked through (floor, ceiling, accents, balloon).
  const part = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    ship.add(mesh);
    return mesh;
  };

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // Hull: floor, ceiling, two side walls, stern wall.
  part(box(length, 0.3, width), deck, 0, -0.15, 0);
  part(box(length, thickness, width), wood, 0, wallHeight + 0.1, 0);
  for (const z of [-width / 2, width / 2]) {
    solid(box(length, wallHeight, thickness), wood, 0, wallHeight / 2, z);
  }
  solid(box(thickness, wallHeight, width), wood, -length / 2, wallHeight / 2, 0);

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
    const panel = (width - doorWidth) / 2;
    for (const side of [-1, 1]) {
      solid(box(thickness, wallHeight, panel), wood, x, wallHeight / 2, side * (doorWidth / 2 + panel / 2));
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

  return { ship, colliders, breaches, ...stations };
}

// Draw the ship the way the state says it is: tube heights, patched
// breaches, the angle of the wheel.
export function applyState(world, state, localAtWheel = false) {
  world.tubes.forEach((tube, i) => {
    const height = TUBE.min + (state.power[i] / RULES.maxPerTube) * (TUBE.max - TUBE.min);
    tube.scale.y = height;
    tube.position.y = height / 2;
  });
  for (const [id, mesh] of Object.entries(world.breaches)) mesh.visible = !state.breaches[id];
  world.wheelDisc.rotation.y = state.steering * 2.2;
  world.wheelMount.userData.interact.label = localAtWheel ? 'Leave the wheel' : 'Take the wheel';
}

function buildBreaches(ship, part, box) {
  const torn = new THREE.MeshStandardMaterial({ color: '#241a12', flatShading: true });
  const breaches = {};
  for (const spot of BREACH_SPOTS) {
    const mesh = part(box(1, 0.08, 1), torn, spot.x, 0.04, spot.z);
    mesh.name = spot.id;
    mesh.userData.interact = {
      label: 'Patch',
      role: 'mechanic',
      action: 'patch',
      hold: RULES.patchSeconds,
      id: spot.id,
    };
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
    lever.position.set(x, 1.05, TUBE.z + 0.31);
    lever.name = `lever${i}`;
    lever.userData.interact = { label: 'Power up', role: 'engineer', action: 'power', index: i };
    ship.add(lever);
    levers.push(lever);
  });

  // Helm: the wheel on its mount, spokes so you can see it turn.
  const wheelMount = new THREE.Group();
  // At 1.35 m the wheel meets a level crosshair, and a 0.4 m disc still
  // leaves most of the window visible around it.
  wheelMount.position.set(10.4, 1.35, 0);
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

  return { tubes, levers, wheelMount, wheelDisc, kit };
}
