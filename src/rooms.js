// Shared loader for the rooms built in Blender (helm cabin, power room).
// Each model sits in ship space as-is: a Blender point (x, y, z) lands at
// (x, z, -y) in the game. The coded walls, stations and breaches stay;
// a model only adds furniture around them.
//
// Names from Blender mean something here:
//   col_*        blocks players, from the floor to the top of the piece
//   lamp_*       glowing glass, warmed up so it reads as light
//   light_*      empty that gets a point light (only those listed)
//   `interact`   custom property naming a station (looked up in stations)
//   `drive`      custom property: a needle or wheel the room code turns

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Without an environment map a fully metallic surface renders black.
export function softenMetal(material) {
  if (material.metalness > 0.5) {
    material.metalness = 0.3;
    material.roughness = Math.min(material.roughness, 0.45);
  }
}

// options:
//   url       model path under public/
//   name      name for the root group
//   stations  { interactName: { label, action, ... } }
//   groups    [RegExp]: every mesh matching one becomes part of a single
//             collider box (a shelf of many little pieces, say)
//   solid     extra mesh names, besides col_*, that block players
//   lights    names of light_* empties that get a real point light
//   lampColor glass tint for lamp_* meshes (null keeps their own colour)
export async function loadRoom(world, options) {
  const { url, name, stations = {}, groups = [], solid = [], lights = [], lampColor = '#ffd38a' } = options;
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(url);
  } catch (err) {
    console.warn(`${name} model missing, the room stays bare:`, err);
    return null;
  }
  const ship = world.ship;
  const model = gltf.scene;
  model.name = name;

  const drives = {};
  model.traverse((obj) => {
    if (obj.material) {
      obj.material = obj.material.clone(); // rooms change their own copies
      softenMetal(obj.material);
    }
    const kind = obj.userData.interact;
    if (typeof kind === 'string') obj.userData.interact = stations[kind] ?? null;
    if (obj.userData.drive) drives[obj.userData.drive] = obj;
    if (obj.name.startsWith('lamp_') && obj.material && lampColor) {
      obj.material.color.set(lampColor);
      obj.material.emissive.set(lampColor).multiplyScalar(0.9);
      obj.material.emissiveIntensity = 1.6;
    }
  });

  for (const lightName of lights) {
    const spot = model.getObjectByName(lightName);
    if (!spot) continue;
    const d = spot.userData;
    spot.add(new THREE.PointLight(d.light_color ?? '#ffc070', (d.light_intensity ?? 3) * 0.6, d.light_distance ?? 6, 2));
  }

  // Colliders are measured with the ship standing still, in ship space.
  const saved = ship.quaternion.clone();
  ship.quaternion.identity();
  ship.add(model);
  ship.updateMatrixWorld(true);
  const colliders = [];
  const grouped = groups.map(() => new THREE.Box3());
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    const g = groups.findIndex((re) => re.test(obj.name));
    if (g !== -1) {
      grouped[g].expandByObject(obj);
      return;
    }
    if (!obj.name.startsWith('col_') && !solid.includes(obj.name)) return;
    colliders.push(new THREE.Box3().setFromObject(obj));
  });
  colliders.push(...grouped.filter((b) => !b.isEmpty()));
  for (const box of colliders) box.min.y = 0; // nobody crawls under a table
  ship.quaternion.copy(saved);
  ship.updateMatrixWorld(true);

  // The dock may rebuild its lobby lists later from world.colliders, so
  // the room goes in there as well as in every list in use now.
  for (const list of [world.lobbyColliders, world.lobbyGatedColliders, world.flightColliders]) {
    if (list && list !== world.colliders) list.push(...colliders);
  }
  world.colliders.push(...colliders);

  return { model, drives };
}

// A part that should swing or turn about a point other than its own origin
// (a bell from its bracket) goes into a pivot group placed there.
export function pivotAt(model, obj, offset) {
  const pivot = new THREE.Group();
  pivot.position.copy(obj.position).add(offset);
  model.add(pivot);
  pivot.attach(obj);
  return pivot;
}
