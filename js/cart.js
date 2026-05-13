// js/cart.js
const STORAGE_KEY = 'ar_gallery_cart';

let items = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
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
  fn(getState());            // emit current state immediately
  return () => listeners.delete(fn);
}

export function add(item) {
  if (items.some(i => i.id === item.id)) return false;   // no duplicates
  items.push({ id: item.id, name: item.name, price: item.price });
  persist();
  return true;
}

export function remove(id) {
  items = items.filter(i => i.id !== id);
  persist();
}

export function clear() {
  items = [];
  persist();
}

export function has(id) {
  return items.some(i => i.id === id);
}

export function formatPrice(amount) {
  return `$${amount.toLocaleString('en-US')}`;
}

/**
 * Deterministic pseudo-random price per painting id.
 * Same painting always shows the same price. Range: $400 – $1500 (step $50).
 */
export function priceFor(id) {
  const str = String(id);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const steps = Math.abs(hash) % 23;       // 0..22
  return 400 + steps * 50;                  // $400..$1500
}