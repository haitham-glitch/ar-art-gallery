// js/cart.js
const STORAGE_KEY = 'ar_gallery_cart';

let items = load();
const listeners = new Set();

function newLineId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalize(raw) {
  return {
    lineId:     raw.lineId     || newLineId(),
    id:         raw.id,
    name:       raw.name,
    price:      raw.price,
    variant:    raw.variant    || null,
    customNote: raw.customNote || ''
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return arr.map(normalize);
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.error('Cart persist failed:', err);
  }
  notify();
}

function notify() {
  const state = getState();
  listeners.forEach(fn => fn(state));
}

/* ---------- Public API ---------- */

export function getState() {
  return {
    items: [...items],
    count: items.length,
    total: items.reduce((sum, i) => sum + (i.price || 0), 0)
  };
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(getState());
  return () => listeners.delete(fn);
}

/**
 * Add an item.
 *   item = { id, name, price, variant?, customNote? }
 * Same painting with a different variant or note creates a new line.
 * Exact duplicates (same id + variant + note) are ignored.
 */
export function add(item) {
  const variant    = item.variant    || null;
  const customNote = item.customNote || '';

  const duplicate = items.some(i =>
    i.id === item.id &&
    (i.variant || null) === variant &&
    (i.customNote || '') === customNote
  );
  if (duplicate) return false;

  items.push({
    lineId: newLineId(),
    id:     item.id,
    name:   item.name,
    price:  item.price,
    variant,
    customNote
  });
  persist();
  return true;
}

export function remove(lineId) {
  items = items.filter(i => i.lineId !== lineId);
  persist();
}

export function clear() {
  items = [];
  persist();
}

/** True if the given painting appears in the cart in any form */
export function has(paintingId) {
  return items.some(i => i.id === paintingId);
}

export function formatPrice(amount) {
  return `$${amount.toLocaleString('en-US')}`;
}

/** Stable pseudo-random price per painting id ($400–$1500, step $50) */
export function priceFor(id) {
  const str = String(id);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const steps = Math.abs(hash) % 23;
  return 400 + steps * 50;
}