// How each role looks: its colour (three palettes, two of them for colour
// blindness) and its symbol (wrench, lightning bolt, steering wheel), so a
// role never has to be told apart by colour alone.

import * as THREE from 'three';

// Okabe-Ito colours: chosen so every kind of colour vision tells them
// apart, and they differ in lightness too.
export const PALETTES = {
  off: { mechanic: '#e2574c', engineer: '#49b97a', pilot: '#4a86e8' },
  redgreen: { mechanic: '#e69f00', engineer: '#0072b2', pilot: '#cc79a7' },
  blueyellow: { mechanic: '#d55e00', engineer: '#009e73', pilot: '#f0e442' },
};

// 24 x 24 icon paths, the same ones the menus use.
export const ROLE_ICONS = {
  mechanic: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  engineer: 'M13 2L4 14h7l-1 8 9-12h-7z',
  pilot: 'M20 12a8 8 0 1 1-16 0a8 8 0 1 1 16 0z M14 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0z M12 4v6M12 14v6M4 12h6M14 12h6',
};

// Dark ink for a symbol drawn on a light colour, light ink on a dark one.
export function inkFor(color) {
  const c = new THREE.Color(color);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear
  return lum > 0.22 ? '#2a1608' : '#fff4dc';
}

// A round badge with the role's symbol, for floating over a teammate.
const textures = new Map();
function badgeTexture(role, color) {
  const key = `${role}|${color}`;
  if (textures.has(key)) return textures.get(key);
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#3b2516';
  ctx.stroke();
  ctx.save();
  ctx.translate(size * 0.2, size * 0.2);
  ctx.scale((size * 0.6) / 24, (size * 0.6) / 24);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = inkFor(color);
  ctx.stroke(new Path2D(ROLE_ICONS[role]));
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, texture);
  return texture;
}

// Show, swap or hide the badge over one teammate's sphere.
export function setRoleBadge(playerMesh, role, color, show) {
  let badge = playerMesh.userData.badge;
  const wanted = show && ROLE_ICONS[role];
  if (!wanted) {
    if (badge) badge.visible = false;
    return;
  }
  if (!badge) {
    badge = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
    badge.scale.setScalar(0.34);
    // Never a target: the host's look-rays have no camera, which a sprite
    // needs to be hit-tested, and nobody interacts with a badge anyway.
    badge.raycast = () => {};
    badge.position.set(0, 1.05, 0); // clear of the tallest hat
    playerMesh.add(badge);
    playerMesh.userData.badge = badge;
  }
  const texture = badgeTexture(role, color);
  if (badge.material.map !== texture) {
    badge.material.map = texture;
    badge.material.needsUpdate = true;
  }
  badge.visible = true;
}

// The same symbol as inline SVG for the HTML screens.
export function roleIconSvg(role, ink) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ROLE_ICONS[role]);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', ink);
  path.setAttribute('stroke-width', '2.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

// A row of the three roles, coloured from the palette, with their symbols
// when those are on: the menu's corner key and the settings preview.
export function fillRoleKey(el, palette, symbols) {
  el.replaceChildren(
    ...['mechanic', 'engineer', 'pilot'].map((role) => {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.background = palette[role];
      if (symbols) {
        swatch.className = 'with-icon';
        swatch.append(roleIconSvg(role, inkFor(palette[role])));
      }
      item.append(swatch, role[0].toUpperCase() + role.slice(1));
      return item;
    })
  );
}
