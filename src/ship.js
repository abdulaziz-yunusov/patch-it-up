import * as THREE from 'three';

// Placeholder ship: engine room (red), power room (green), helm (blue).
// Replace with Blender .glb models later (public/models/).
export function buildShip() {
  const ship = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#8a5a36', flatShading: true });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(24, 0.3, 6), new THREE.MeshStandardMaterial({ color: '#a87447' }));
  floor.position.y = -0.15;
  ship.add(floor);

  const rooms = [
    { name: 'Engine room', x: -8, color: '#e2574c' },
    { name: 'Power room', x: 0, color: '#49b97a' },
    { name: 'Helm', x: 8, color: '#4a86e8' },
  ];
  for (const room of rooms) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 0.2), wood);
    back.position.set(room.x, 1.5, -3);
    ship.add(back);
    const front = back.clone();
    front.position.z = 3;
    ship.add(front);
    const station = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.2, 1.2),
      new THREE.MeshStandardMaterial({ color: room.color, flatShading: true })
    );
    station.position.set(room.x, 0.6, -2);
    station.name = room.name;
    ship.add(station);
  }
  for (const x of [-4, 4]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 2), wood);
    wall.position.set(x, 1.5, -2);
    ship.add(wall);
  }

  const balloon = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshStandardMaterial({ color: '#c86a33', flatShading: true })
  );
  balloon.scale.set(14, 4, 5);
  balloon.position.y = 9;
  ship.add(balloon);
  return ship;
}
