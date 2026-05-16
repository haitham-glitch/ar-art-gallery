import { supabase } from './supabase-client.js';
import { getSession, getProfile, signOut } from './auth.js';
import * as cart from './cart.js';

/* ---------- DOM ---------- */
const els = {
  grid:        document.getElementById('galleryGrid'),
  empty:       document.getElementById('emptyState'),
  nav:         document.getElementById('siteNav'),
  toast:       document.getElementById('toast'),

  // Cart toggle + badge
  cartToggle:  document.getElementById('cartToggle'),
  cartBadge:   document.getElementById('cartBadge'),

  // Cart drawer
  cartDrawer:  document.getElementById('cartDrawer'),
  cartOverlay: document.getElementById('cartOverlay'),
  cartClose:   document.getElementById('cartClose'),
  cartItems:   document.getElementById('cartItems'),
  cartEmpty:   document.getElementById('cartEmpty'),
  cartFooter:  document.getElementById('cartFooter'),
  cartTotal:   document.getElementById('cartTotal'),
  cartCheckout: document.getElementById('cartCheckout'),

  // Checkout modal
  checkoutModal:   document.getElementById('checkoutModal'),
  checkoutOverlay: document.getElementById('checkoutOverlay'),
  checkoutClose:   document.getElementById('checkoutClose'),
  checkoutForm:    document.getElementById('checkoutForm'),
  checkoutDone:    document.getElementById('checkoutDone'),
  checkoutTotal:   document.getElementById('checkoutTotal'),
  checkoutSuccessSub: document.getElementById('checkoutSuccessSub'),
  stateForm:       document.querySelector('[data-state="form"]'),
  stateSuccess:    document.querySelector('[data-state="success"]'),
  fldName:    document.getElementById('fldName'),
  fldCard:    document.getElementById('fldCard'),
  fldExpiry:  document.getElementById('fldExpiry'),
  fldCvv:     document.getElementById('fldCvv'),

  // Product modal
  productModal:    document.getElementById('productModal'),
  productOverlay:  document.getElementById('productOverlay'),
  productClose:    document.getElementById('productClose'),
  productViewer:   document.getElementById('productViewer'),
  productTitle:    document.getElementById('product-title'),
  productPrice:    document.getElementById('productPrice'),
  productVariantsSection: document.getElementById('productVariantsSection'),
  productVariants: document.getElementById('productVariants'),
  productVariantHint: document.getElementById('productVariantHint'),
  productCustomSection:   document.getElementById('productCustomSection'),
  productCustom:   document.getElementById('productCustom'),
  productAdd:      document.getElementById('productAdd'),
};

/* ---------- Helpers ---------- */
const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatDate = ts => new Date(ts).toLocaleDateString('en-US',
  { month:'short', day:'numeric', year:'numeric' });

function anyOverlayOpen() {
  return els.cartDrawer.classList.contains('open')
      || els.checkoutModal.classList.contains('open')
      || els.productModal.classList.contains('open');
}

function maybeUnlockScroll() {
  if (!anyOverlayOpen()) document.body.classList.remove('no-scroll');
}

/* =====================================================
   LIGHTWEIGHT EDITORIAL THUMBNAILS
   -----------------------------------------------------
   Instead of mounting a <model-viewer> per card (which
   spins up a WebGL context per item and is what was
   killing mobile), each card gets an inline SVG data-URI
   <img> as a "gallery poster". Deterministic per id so
   the same painting always wears the same colors.
===================================================== */

// Cheap stable hash from a string → unsigned int
function hashOf(input) {
  const s = String(input);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Curated palette pairs that match the cream / terracotta / ink system.
// Each pair = [light gradient top, light gradient bottom, ink overlay tint].
const THUMB_PALETTES = [
  ['#ECE5D6', '#E0D4B8', '#B8654A'],
  ['#EFE7D3', '#D9CCA8', '#9F5238'],
  ['#E8E1D3', '#CFC2A0', '#7A4A36'],
  ['#F0E6D0', '#DDC8A0', '#B25E45'],
  ['#E5DEC9', '#C9B98F', '#8F4D34'],
  ['#EADFC8', '#D3BC8E', '#A4583F'],
  ['#EBE2CE', '#D6C09A', '#6F4434'],
  ['#F1E9D6', '#E1CFA6', '#C2684D'],
];

function thumbnailFor(painting) {
  const h        = hashOf(painting.id ?? painting.name ?? 'x');
  const palette  = THUMB_PALETTES[h % THUMB_PALETTES.length];
  const [top, bottom, accent] = palette;
  const initial  = (String(painting.name || '◈').trim()[0] || '◈').toUpperCase();

  // Subtle organic tilt + offset on the inner "frame" so no two cards
  // sit at exactly the same angle (varies ± 1.4°)
  const tilt     = (((h >>> 4) % 280) - 140) / 100;   // -1.4 … +1.4
  const offsetX  = ((h >>> 12) % 14) - 7;             // -7 … +7
  const offsetY  = ((h >>> 18) % 12) - 6;

  // Pseudo-glyph in the corner — single mark stamped per painting,
  // picked from a short curated set (no real characters, just glyphs).
  const marks    = ['◈','◇','◆','◊','✦','✧','❖','✶'];
  const mark     = marks[(h >>> 8) % marks.length];

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${escapeHtml(painting.name || 'Untitled work')}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${top}"/>
      <stop offset="100%" stop-color="${bottom}"/>
    </linearGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#1A1614" stop-opacity="0.07"/>
    </linearGradient>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0"/>
    </filter>
  </defs>

  <rect width="400" height="500" fill="url(#bg)"/>
  <rect width="400" height="500" fill="#1A1614" filter="url(#grain)" opacity="0.18"/>

  <!-- The painting "frame" — slightly tilted for an organic feel -->
  <g transform="translate(${200 + offsetX} ${250 + offsetY}) rotate(${tilt})">
    <rect x="-160" y="-200" width="320" height="400"
          fill="url(#frame)"
          stroke="#1A1614" stroke-opacity="0.18" stroke-width="1"/>
    <rect x="-152" y="-192" width="304" height="384"
          fill="none"
          stroke="#1A1614" stroke-opacity="0.08" stroke-width="0.5"/>

    <!-- Display initial — Fraunces falls back gracefully to Georgia inside SVG -->
    <text x="0" y="38"
          font-family="Fraunces, Georgia, 'Times New Roman', serif"
          font-size="180" font-style="italic" font-weight="400"
          text-anchor="middle"
          fill="#1A1614" fill-opacity="0.78">${escapeHtml(initial)}</text>
  </g>

  <!-- Corner mark + format hint -->
  <text x="24" y="36"
        font-family="Manrope, system-ui, sans-serif"
        font-size="11" font-weight="600"
        letter-spacing="2"
        fill="${accent}">${mark}</text>
  <text x="376" y="476"
        font-family="Manrope, system-ui, sans-serif"
        font-size="9" font-weight="600"
        letter-spacing="3"
        text-anchor="end"
        fill="#1A1614" fill-opacity="0.45">3D · AR READY</text>
</svg>`.trim();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* =====================================================
   NAV
===================================================== */
async function renderNav() {
  const session = await getSession();
  if (!session) {
    els.nav.innerHTML = `<a href="login.html" class="nav-link">Sign in →</a>`;
    return;
  }
  const profile = await getProfile(session.user.id);
  const isSeller = profile?.role === 'seller';

  const primary = isSeller
    ? `<a href="dashboard.html" class="nav-link">Dashboard</a>`
    : `<a href="profile.html" class="nav-link">Your profile</a>`;

  const greeting = profile?.display_name
    ? `<span class="nav-greeting">${escapeHtml(profile.display_name)}</span>`
    : '';

  els.nav.innerHTML = `
    ${greeting}
    ${primary}
    <button class="nav-btn" id="logoutBtn" type="button">Sign out</button>
  `;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut();
    window.location.reload();
  });
}

/* =====================================================
   GALLERY
===================================================== */
let allPaintings = [];

async function fetchPaintings() {
  const { data, error } = await supabase
    .from('paintings')
    .select('*')
    .order('uploadedAt', { ascending: false });
  if (error) { console.error(error); return []; }
  return data;
}

function findPainting(id) {
  return allPaintings.find(p => String(p.id) === String(id));
}

/* Lightweight 2D card — NO model-viewer here.
   The heavy WebGL viewer is only mounted inside the product modal
   when a user actually opens an item. */
function cardTemplate(p) {
  const price  = cart.priceFor(p.id);
  const inCart = cart.has(p.id);
  const thumb  = thumbnailFor(p);

  return `
    <article class="painting-card" data-id="${p.id}">
      <button class="card-viewer card-viewer--thumb"
              type="button" data-action="open-product"
              aria-label="Open ${escapeHtml(p.name)} in 3D">
        <img class="card-thumb" src="${thumb}" loading="lazy"
             alt="Editorial preview of ${escapeHtml(p.name)}" />
        <span class="card-3d-tag" aria-hidden="true">
          <span class="ar-glyph">↗</span> View in 3D
        </span>
      </button>
      <div class="card-body">
        <div class="card-meta"><span>${formatDate(p.uploadedAt)}</span></div>
        <h3 class="card-title">${escapeHtml(p.name)}</h3>
        <div class="card-actions card-actions-shop">
          <span class="card-price">${cart.formatPrice(price)}</span>
          <button class="card-cart-btn ${inCart ? 'in-cart' : ''}"
                  data-action="add-cart" type="button">
            ${inCart ? 'In cart ✓' : 'Add to cart'}
          </button>
        </div>
      </div>
    </article>
  `;
}

async function renderGallery() {
  allPaintings = await fetchPaintings();
  els.empty.hidden = allPaintings.length > 0;
  els.grid.innerHTML = allPaintings.map(cardTemplate).join('');
}

/* ---- Click delegation ----
   - "Add to cart" button   → quick add (no variant)
   - Anywhere else on card  → open the product modal (this is where
                              the heavy 3D viewer is actually loaded)
------------------------------------------------- */
els.grid.addEventListener('click', (e) => {
  // 1) quick add to cart
  const addBtn = e.target.closest('[data-action="add-cart"]');
  if (addBtn) {
    e.stopPropagation();
    const card = addBtn.closest('.painting-card');
    const p = findPainting(card.dataset.id);
    if (!p) return;
    if (cart.has(p.id)) { openDrawer(); return; }
    cart.add({ id: p.id, name: p.name, price: cart.priceFor(p.id) });
    showToast(`Added "${p.name}" to your cart.`);
    return;
  }
  // 2) anywhere else on the card → open modal
  const card = e.target.closest('.painting-card');
  if (card) openProductModal(card.dataset.id);
});

/* Sync card buttons whenever cart changes */
function syncCardButtons(state) {
  const ids = new Set(state.items.map(i => i.id));
  els.grid.querySelectorAll('.painting-card').forEach(card => {
    const btn = card.querySelector('[data-action="add-cart"]');
    if (!btn) return;
    const inCart = ids.has(card.dataset.id);
    btn.classList.toggle('in-cart', inCart);
    btn.textContent = inCart ? 'In cart ✓' : 'Add to cart';
  });
}

/* =====================================================
   PRODUCT MODAL  +  DYNAMIC AR SCALING
   -----------------------------------------------------
   The product modal is the *only* place the heavy
   <model-viewer> is alive. We attach `src` on open,
   strip it on close → one WebGL context at a time.
===================================================== */
let currentProductId = null;
let selectedVariant  = null;
let currentVariants  = [];   // array of variant strings for the active painting

/**
 * Map a chosen variant to a real-world scale factor.
 * 1) keyword matching:  S / M / L  →  0.7 / 1.0 / 1.4
 * 2) fallback: spread positions across [0.7, 1.4] so any custom
 *    variant labels (e.g. "A2", "Studio", "Oversized") still get
 *    a sensible relative size.
 */
function variantToScale(variant, variants = currentVariants) {
  if (!variant) return '1 1 1';
  const v = String(variant).trim().toLowerCase();

  if (/(^|\W)(extra ?large|x ?large|xl|oversized|huge)(\W|$)/.test(v)) return '1.4 1.4 1.4';
  if (/(^|\W)(large|big|l|lg)(\W|$)/.test(v))                          return '1.4 1.4 1.4';
  if (/(^|\W)(medium|med|m|md|standard|regular)(\W|$)/.test(v))        return '1 1 1';
  if (/(^|\W)(small|s|sm|mini|petite)(\W|$)/.test(v))                  return '0.7 0.7 0.7';

  // Fallback: interpolate by position in the variant list.
  const idx = variants.indexOf(variant);
  const total = variants.length;
  if (idx < 0 || total <= 1) return '1 1 1';
  const t = idx / (total - 1);                  // 0 … 1
  const f = (0.7 + t * 0.7).toFixed(2);          // 0.70 … 1.40
  return `${f} ${f} ${f}`;
}

/**
 * Apply the chosen variant's scale to the live <model-viewer>.
 * Because the viewer has ar-scale="fixed", this exact scale
 * is what users see in AR — no pinch-to-zoom override.
 */
function applyVariantScale(variant) {
  const scale = variantToScale(variant);
  els.productViewer.setAttribute('scale', scale);
  // Also keep the JS property in sync for model-viewer's internal updates
  try { els.productViewer.scale = scale; } catch { /* property may be read-only on some builds */ }
}

function openProductModal(paintingId) {
  const p = findPainting(paintingId);
  if (!p) return;

  currentProductId = p.id;
  selectedVariant  = null;
  currentVariants  = [];

  // ---- Mount the heavy viewer ON DEMAND ----
  els.productViewer.setAttribute('src', p.modelUrl);
  els.productViewer.setAttribute('alt', `3D model of the painting '${p.name}'`);
  els.productViewer.setAttribute('scale', '1 1 1');  // reset

  // Title + price
  els.productTitle.textContent = p.name;
  els.productPrice.textContent = cart.formatPrice(cart.priceFor(p.id));

  // Variants
  const list = (p.variants || '')
    .split(',').map(v => v.trim()).filter(Boolean);
  currentVariants = list;

  if (list.length > 0) {
    els.productVariants.innerHTML = list.map((v, i) => `
      <button class="variant-pill ${i === 0 ? 'selected' : ''}"
              type="button" data-variant="${escapeHtml(v)}">
        ${escapeHtml(v)}
      </button>
    `).join('');
    selectedVariant = list[0];
    els.productVariantsSection.hidden = false;
    els.productVariantHint.hidden = false;

    // Apply the initial variant's scale so AR launches at the right size
    applyVariantScale(selectedVariant);
  } else {
    els.productVariants.innerHTML = '';
    els.productVariantsSection.hidden = true;
    els.productVariantHint.hidden = true;
  }

  // Custom requests
  els.productCustom.value = '';
  els.productCustomSection.hidden = !p.allow_custom;

  // Show
  els.productModal.classList.add('open');
  els.productModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}

function closeProductModal() {
  els.productModal.classList.remove('open');
  els.productModal.setAttribute('aria-hidden', 'true');
  // Free model resources so we never keep a WebGL context idle
  els.productViewer.removeAttribute('src');
  currentProductId = null;
  selectedVariant = null;
  currentVariants = [];
  maybeUnlockScroll();
}

els.productClose.addEventListener('click', closeProductModal);
els.productOverlay.addEventListener('click', closeProductModal);

/* Variant selection — also re-scales the live model */
els.productVariants.addEventListener('click', (e) => {
  const btn = e.target.closest('.variant-pill');
  if (!btn) return;
  els.productVariants.querySelectorAll('.variant-pill')
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedVariant = btn.dataset.variant;
  applyVariantScale(selectedVariant);
});

/* Add to cart from modal */
els.productAdd.addEventListener('click', () => {
  if (!currentProductId) return;
  const p = findPainting(currentProductId);
  if (!p) return;

  const added = cart.add({
    id:         p.id,
    name:       p.name,
    price:      cart.priceFor(p.id),
    variant:    selectedVariant,
    customNote: els.productCustom.value.trim()
  });

  if (added) {
    const variantLabel = selectedVariant ? ` (${selectedVariant})` : '';
    showToast(`Added "${p.name}${variantLabel}" to your cart.`);
    closeProductModal();
  } else {
    showToast('This exact option is already in your cart.');
  }
});

/* =====================================================
   CART DRAWER
===================================================== */
function openDrawer() {
  els.cartDrawer.classList.add('open');
  els.cartOverlay.hidden = false;
  requestAnimationFrame(() => els.cartOverlay.classList.add('show'));
  els.cartDrawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}

function closeDrawer() {
  els.cartDrawer.classList.remove('open');
  els.cartOverlay.classList.remove('show');
  els.cartDrawer.setAttribute('aria-hidden', 'true');
  setTimeout(() => { els.cartOverlay.hidden = true; }, 300);
  maybeUnlockScroll();
}

els.cartToggle.addEventListener('click', openDrawer);
els.cartClose.addEventListener('click', closeDrawer);
els.cartOverlay.addEventListener('click', closeDrawer);

function renderCartItems(state) {
  els.cartItems.innerHTML = state.items.map(item => `
    <li class="cart-item" data-line="${item.lineId}">
      <div class="cart-item-thumb" aria-hidden="true">◈</div>
      <div class="cart-item-body">
        <span class="cart-item-name">${escapeHtml(item.name)}</span>
        ${item.variant ? `<span class="cart-item-variant">${escapeHtml(item.variant)}</span>` : ''}
        ${item.customNote ? `<span class="cart-item-note">"${escapeHtml(item.customNote)}"</span>` : ''}
        <span class="cart-item-price">${cart.formatPrice(item.price)}</span>
      </div>
      <button class="cart-item-remove" type="button"
              data-remove="${item.lineId}" aria-label="Remove ${escapeHtml(item.name)}">×</button>
    </li>
  `).join('');

  els.cartEmpty.hidden  = state.count > 0;
  els.cartFooter.hidden = state.count === 0;
  els.cartTotal.textContent = cart.formatPrice(state.total);
}

els.cartItems.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  cart.remove(btn.dataset.remove);
});

function renderBadge(state) {
  if (state.count > 0) {
    els.cartBadge.textContent = state.count;
    els.cartBadge.hidden = false;
  } else {
    els.cartBadge.hidden = true;
  }
}

cart.subscribe((state) => {
  renderBadge(state);
  renderCartItems(state);
  syncCardButtons(state);
});

/* =====================================================
   CHECKOUT MODAL  +  SUPABASE ORDER PERSISTENCE
===================================================== */
function openCheckout() {
  const { total, count } = cart.getState();
  if (count === 0) return;
  els.checkoutTotal.textContent = cart.formatPrice(total);
  els.stateForm.hidden    = false;
  els.stateSuccess.hidden = true;
  els.checkoutForm.reset();
  clearAllErrors();
  els.checkoutModal.classList.add('open');
  els.checkoutModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}

function closeCheckout() {
  els.checkoutModal.classList.remove('open');
  els.checkoutModal.setAttribute('aria-hidden', 'true');
  maybeUnlockScroll();
}

els.cartCheckout.addEventListener('click', openCheckout);
els.checkoutClose.addEventListener('click', closeCheckout);
els.checkoutOverlay.addEventListener('click', closeCheckout);

els.fldCard.addEventListener('input', (e) => {
  const digits = e.target.value.replace(/\D/g, '').slice(0, 16);
  e.target.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  clearError('card');
});

els.fldExpiry.addEventListener('input', (e) => {
  const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
  e.target.value = digits.length <= 2 ? digits : digits.slice(0, 2) + '/' + digits.slice(2);
  clearError('expiry');
});

els.fldCvv.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 3);
  clearError('cvv');
});

els.fldName.addEventListener('input', () => clearError('name'));

function validate() {
  const errors = {};
  const name = els.fldName.value.trim();
  const card = els.fldCard.value.replace(/\s/g, '');
  const exp  = els.fldExpiry.value;
  const cvv  = els.fldCvv.value;

  if (name.length < 3) errors.name = 'Please enter your full name.';
  if (!/^\d{16}$/.test(card)) errors.card = 'Card number must be 16 digits.';

  const m = exp.match(/^(\d{2})\/(\d{2})$/);
  if (!m) errors.expiry = 'Use MM/YY format.';
  else {
    const mm = parseInt(m[1], 10);
    const yy = parseInt(m[2], 10);
    const now = new Date();
    const curYY = now.getFullYear() % 100;
    const curMM = now.getMonth() + 1;
    if (mm < 1 || mm > 12) errors.expiry = 'Month must be 01–12.';
    else if (yy < curYY || (yy === curYY && mm < curMM)) errors.expiry = 'Card has expired.';
  }
  if (!/^\d{3}$/.test(cvv)) errors.cvv = 'CVV must be 3 digits.';
  return errors;
}

function showError(key, message) {
  const errEl = document.querySelector(`[data-error="${key}"]`);
  if (errEl) errEl.textContent = message;
  const fldId = { name:'fldName', card:'fldCard', expiry:'fldExpiry', cvv:'fldCvv' }[key];
  document.getElementById(fldId)?.closest('.field')?.classList.add('error');
}

function clearError(key) {
  const errEl = document.querySelector(`[data-error="${key}"]`);
  if (errEl) errEl.textContent = '';
  const fldId = { name:'fldName', card:'fldCard', expiry:'fldExpiry', cvv:'fldCvv' }[key];
  document.getElementById(fldId)?.closest('.field')?.classList.remove('error');
}

function clearAllErrors() {
  ['name','card','expiry','cvv'].forEach(clearError);
}

/**
 * Persist the order to Supabase. Called after mock-payment validation.
 * Returns true if the order was actually saved against a signed-in user,
 * false if it was completed as a guest (cart still clears, but no record).
 */
async function persistOrder() {
  const { items, total } = cart.getState();
  if (items.length === 0) return false;

  const session = await getSession();
  if (!session) return false;        // guest checkout — no row to insert

  // Strip lineId before writing — it was only useful in-browser
  const payload = items.map(({ id, name, price, variant, customNote }) => ({
    id, name, price, variant, customNote
  }));

  const { error } = await supabase.from('orders').insert([{
    user_id:      session.user.id,
    items:        payload,
    total_amount: total,
    status:       'Processing'
  }]);

  if (error) {
    console.error('Order insert failed:', error);
    return false;
  }
  return true;
}

els.checkoutForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAllErrors();
  const errors = validate();
  if (Object.keys(errors).length > 0) {
    Object.entries(errors).forEach(([k, v]) => showError(k, v));
    return;
  }

  const submitBtn = els.checkoutForm.querySelector('button[type="submit"]');
  submitBtn?.classList.add('loading');
  submitBtn && (submitBtn.disabled = true);

  let saved = false;
  try {
    saved = await persistOrder();
  } catch (err) {
    console.error(err);
  } finally {
    submitBtn?.classList.remove('loading');
    submitBtn && (submitBtn.disabled = false);
  }

  // Adapt the success copy to whether the order is trackable or not
  if (els.checkoutSuccessSub) {
    els.checkoutSuccessSub.textContent = saved
      ? 'Your order has been placed (mock). You can track its status from your profile.'
      : 'Your order has been placed (mock). Sign in next time to track orders from your profile.';
  }

  cart.clear();
  els.stateForm.hidden    = true;
  els.stateSuccess.hidden = false;
});

els.checkoutDone.addEventListener('click', () => {
  closeCheckout();
  closeDrawer();
});

/* ---------- Escape closes top-most overlay ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (els.checkoutModal.classList.contains('open')) closeCheckout();
  else if (els.productModal.classList.contains('open')) closeProductModal();
  else if (els.cartDrawer.classList.contains('open')) closeDrawer();
});

/* =====================================================
   TOAST
===================================================== */
let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  void els.toast.offsetWidth;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => { els.toast.hidden = true; }, 300);
  }, 2400);
}

/* =====================================================
   INIT
===================================================== */
renderNav();
renderGallery();
