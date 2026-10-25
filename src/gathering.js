// The crew screen between the menu and the dock: the room code to read
// out, who has joined so far, and (for the host) the button that takes
// everyone to the dock. Joiners see the same screen, waiting.
//
// Names come from other people's browsers, so they only ever go into the
// page as text, never as HTML.

import { RULES } from './state.js';

const SVG = 'http://www.w3.org/2000/svg';
const PERSON = ['M4 21a8 8 0 0 1 16 0'];
const PENCIL = ['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4'];

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(paths, circle) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (circle) {
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', '12');
    c.setAttribute('cy', '8');
    c.setAttribute('r', '4');
    svg.append(c);
  }
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

let nameInput = null; // the host's own row: their name, editable in place
let rowKeys = []; // what each row last showed, so rows only rebuild on a change
let copiedUntil = 0;

// onBack() leaves, onGo() heads to the dock, onRename(name) as the host types.
export function initGathering({ onBack, onGo, onRename }) {
  $('gatherBack').addEventListener('click', onBack);
  $('goToDock').addEventListener('click', onGo);

  nameInput = el('input', 'name-input');
  nameInput.type = 'text';
  nameInput.maxLength = 12;
  nameInput.autocomplete = 'off';
  nameInput.placeholder = 'Deckhand';
  nameInput.setAttribute('aria-label', 'Your name');
  nameInput.addEventListener('input', () => onRename(nameInput.value.trim()));
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') nameInput.blur();
  });

  $('copyCode').addEventListener('click', async () => {
    const code = $('gatherCode').textContent;
    try {
      await navigator.clipboard.writeText(code);
      $('copyLabel').textContent = 'Copied!';
    } catch {
      $('copyLabel').textContent = 'Copy failed';
    }
    copiedUntil = performance.now() + 1600;
  });
}

// Back at the menu: the next visit builds its rows afresh.
export function resetGathering() {
  rowKeys = [];
  $('crewList').replaceChildren();
}

// talking(id): whether that crew member is talking right now (a ring
// round their picture).
export function updateGathering(state, local, now, talking = () => false) {
  const players = Object.values(state.players);
  const host = state.players.host;
  const hostName = host?.name ?? 'The host';
  const full = players.length >= RULES.maxPlayers;
  const isHost = local.isHost;

  $('gatherTitle').textContent = full ? 'Crew is ready!' : isHost ? 'Host a game' : `${hostName}'s ship`;
  $('gatherBack').setAttribute('aria-label', isHost ? 'Close the room and go back' : 'Leave the ship');
  $('gatherCode').textContent = state.code || local.code;
  if (copiedUntil && now > copiedUntil) {
    $('copyLabel').textContent = 'Copy';
    copiedUntil = 0;
  }

  $('roomFullTag').hidden = !full;
  $('gatherCodeHint').textContent = full
    ? `All ${RULES.maxPlayers} crew members are aboard.`
    : isHost
      ? 'Shout it to your crew. They press Join game and type it in.'
      : 'Friends can join with this code too.';

  const count = $('crewCount');
  count.textContent = `${players.length} of ${RULES.maxPlayers} aboard`;
  count.classList.toggle('full', full);

  const go = $('goToDock');
  go.hidden = !isHost;
  go.classList.toggle('ready', full);
  const hint = $('gatherHint');
  hint.classList.toggle('waiting', !isHost);
  hint.textContent = !isHost
    ? `Waiting for ${hostName} to head to the dock…`
    : full
      ? 'Everyone heads to the dock together. Pick your uniform at the lockers.'
      : 'Your crew can join you at the dock at any time before you set sail.';

  // The host first, then joiners in seat order, then empty seats.
  const crew = [host, ...players.filter((p) => p.id !== 'host').sort((a, b) => a.id.localeCompare(b.id))];
  const list = $('crewList');
  for (let i = 0; i < RULES.maxPlayers; i++) {
    const p = crew[i];
    const editable = p && isHost && p.id === local.id;
    // The editable row keeps its input while the host types in it.
    const key = !p ? 'empty' : editable ? 'me-editable' : `${p.id}|${p.name}|${p.signal}|${p.id === local.id}`;
    if (rowKeys[i] === key && list.children[i]) continue;
    rowKeys[i] = key;
    const row = p ? crewRow(p, local, editable) : emptyRow();
    if (list.children[i]) list.children[i].replaceWith(row);
    else list.append(row);
  }
  for (let i = 0; i < RULES.maxPlayers; i++) {
    list.children[i]?.querySelector('.avatar')?.classList.toggle('speaking', !!crew[i] && talking(crew[i].id));
  }
}

function crewRow(p, local, editable) {
  const row = el('div', 'crew-row');
  const avatar = el('div', 'avatar');
  avatar.append(icon(PERSON, true));

  const who = el('div', 'crew-who');
  const me = p.id === local.id;
  if (editable) {
    const line = el('div', 'name-line');
    if (document.activeElement !== nameInput) nameInput.value = p.name;
    line.append(nameInput, icon(PENCIL));
    who.append(line, el('div', 'crew-sub', 'Your name · click to edit · role picked at the dock'));
  } else {
    const sub = p.id === 'host'
      ? 'Host · role picked at the dock'
      : me
        ? 'You · role picked at the dock'
        : p.signal === 'lost'
          ? 'Joined · connection dropped, waiting for them'
          : `Joined · ${p.signal === 'weak' ? 'weak' : 'good'} connection`;
    who.append(el('div', 'crew-name', me ? `${p.name} (you)` : p.name), el('div', 'crew-sub', sub));
  }

  const badge =
    p.signal === 'lost'
      ? el('div', 'badge lost', 'Reconnecting')
      : p.signal === 'weak'
        ? el('div', 'badge weak', 'Lagging')
        : el('div', 'badge', 'Connected');
  row.append(avatar, who, badge);
  return row;
}

function emptyRow() {
  const row = el('div', 'crew-row empty');
  row.append(el('div', 'avatar'), el('div', 'crew-wait', 'Waiting for crew member…'));
  return row;
}
