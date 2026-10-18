// One plain object with everything the game knows.
// The host changes it, sends it to everyone (step 5), and every browser
// draws the 3D scene from it.

export const RULES = {
  maxPerTube: 4, // step 7: 6 units shared across three tubes
  patchSeconds: 2.5,
  steerRate: 0.9, // wheel units per second
  reach: 2.5, // metres you can interact from
};

export const state = {
  power: [2, 2, 2], // units in the engine, shield and lift tubes
  breaches: { b0: false, b1: false, b2: false }, // id -> patched?
  steering: 0, // -1 (hard to port) .. 1 (hard to starboard)

  // Step 5 turns this into one entry per player; for now it is just you.
  role: 'mechanic',
  atWheel: false,
};
