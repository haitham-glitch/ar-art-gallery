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
   THUMBNAIL CAPTURE QUEUE
   -----------------------------------------------------
   Real snapshots of each painting are rendered ONCE by
   a single hidden <model-viewer> living off-screen.
   Cards initially show a generic placeholder SVG; as
   each capture completes, the corresponding <img> in
   the grid swaps its src to the real blob URL.

   One model is processed at a time — never N parallel
   WebGL contexts. The hidden viewer's WebGL context is
   reused for every painting in the queue.
===================================================== */

// Tiny shared placeholder (~600 bytes). Same for every card.
const PLACEHOLDER_THUMB = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ECE5D6"/>
      <stop offset="100%" stop-color="#E0D4B8"/>
    </linearGradient>
  </defs>
  <rect width="400" height="500" fill="url(#g)"/>
  <text x="200" y="275" font-family="Fraunces,Georgia,serif" font-size="72"
        font-style="italic" text-anchor="middle"
        fill="#1A1614" fill-opacity="0.22">◈</text>
</svg>`)}`;

const SNAPSHOT_TIMEOUT_MS = 15000;   // hard timeout per model
const QUEUE_BREATHER_MS   = 60;      // tiny gap between captures
const thumbCache          = new Map(); // modelUrl  →  blob object URL
const thumbQueue          = [];        // { modelUrl }[]
let   thumbQueueRunning   = false;
let   hiddenViewer        = null;

/** Lazily create the single off-screen capture viewer. */
function ensureHiddenViewer() {
  if (hiddenViewer) return hiddenViewer;
  hiddenViewer = document.createElement('model-viewer');
  hiddenViewer.id = 'thumbCaptureViewer';
  // No auto-rotate (we want a stable frame). Camera-controls keep the
  // framing logic active so model-viewer auto-frames each new model.
  hiddenViewer.setAttribute('camera-controls', '');
  hiddenViewer.setAttribute('interaction-prompt', 'none');
  hiddenViewer.setAttribute('disable-zoom', '');
  hiddenViewer.setAttribute('disable-tap', '');
  hiddenViewer.setAttribute('shadow-intensity', '1.2');
  hiddenViewer.setAttribute('exposure', '1.05');
  hiddenViewer.setAttribute('environment-image', 'neutral');
  hiddenViewer.setAttribute('loading', 'eager');
  hiddenViewer.setAttribute('reveal', 'auto');
  hiddenViewer.setAttribute('aria-hidden', 'true');
  // Styling is in index.html (#thumbCaptureViewer)
  document.body.appendChild(hiddenViewer);
  return hiddenViewer;
}

/**
 * Load `modelUrl` into the hidden viewer, wait for the model to be ready,
 * take a 2D snapshot, return a blob object-URL. Result is cached.
 * Resolves to null on failure/timeout (caller leaves the placeholder in place).
 */
async function captureSnapshot(modelUrl) {
  if (thumbCache.has(modelUrl)) return thumbCache.get(modelUrl);

  const viewer = ensureHiddenViewer();

  // 1) wait for `load` (or `error`/timeout)
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      viewer.removeEventListener('load',  onLoad);
      viewer.removeEventListener('error', onError);
      clearTimeout(timer);
      resolve();
    };
    const onLoad  = () => finish();
    const onError = () => finish();
    const timer   = setTimeout(finish, SNAPSHOT_TIMEOUT_MS);

    viewer.addEventListener('load',  onLoad,  { once: true });
    viewer.addEventListener('error', onError, { once: true });

    // Trigger the load
    viewer.setAttribute('src', modelUrl);
  });

  // 2) give the renderer two frames to actually paint the first frame
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // 3) snapshot
  try {
    const blob = await viewer.toBlob({ idealAspect: false, mimeType: 'image/png' });
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    thumbCache.set(modelUrl, url);
    return url;
  } catch (err) {
    console.warn('toBlob failed for', modelUrl, err);
    return null;
  }
}

/** Apply a captured URL to every gallery <img> that points at this model. */
function applyThumbToGrid(modelUrl, url) {
  if (!url) return;
  els.grid.querySelectorAll('.card-thumb').forEach(img => {
    if (img.dataset.modelUrl !== modelUrl) return;
    img.src = url;
    img.classList.remove('is-loading');
    img.classList.add('is-loaded');
  });
}

/** Mark every gallery <img> for this model as failed (keeps placeholder visible). */
function markThumbFailed(modelUrl) {
  els.grid.querySelectorAll('.card-thumb').forEach(img => {
    if (img.dataset.modelUrl !== modelUrl) return;
    img.classList.remove('is-loading');
    img.classList.add('is-error');
  });
}

/** Add a model to the capture queue (dedup by modelUrl). */
function enqueueThumb(modelUrl) {
  if (!modelUrl) return;
  if (thumbCache.has(modelUrl)) {
    applyThumbToGrid(modelUrl, thumbCache.get(modelUrl));
    return;
  }
  if (thumbQueue.some(t => t.modelUrl === modelUrl)) return;  // already queued
  thumbQueue.push({ modelUrl });
  if (!thumbQueueRunning) runThumbQueue();
}

async function runThumbQueue() {
  thumbQueueRunning = true;
  while (thumbQueue.length > 0) {
    const { modelUrl } = thumbQueue.shift();

    // Skip if no card still needs this thumb (gallery may have re-rendered)
    const stillNeeded = !!els.grid.querySelector(
      `.card-thumb.is-loading[data-model-url="${cssAttrEscape(modelUrl)}"]`
    );
    if (!stillNeeded && !thumbCache.has(modelUrl)) {
      // queue moves on even if no card needs it right now — harmless
    }

    try {
      const url = await captureSnapshot(modelUrl);
      if (url) applyThumbToGrid(modelUrl, url);
      else     markThumbFailed(modelUrl);
    } catch (err) {
      console.warn('Snapshot pipeline error:', err);
      markThumbFailed(modelUrl);
    }

    // Let the main thread breathe between captures
    await new Promise(r => setTimeout(r, QUEUE_BREATHER_MS));
  }
  thumbQueueRunning = false;
}

/** Minimal CSS attribute-selector escape (handles quotes/backslashes). */
function cssAttrEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
   The <img> starts on a shared placeholder and gets swapped to a real
   snapshot when the capture queue gets to this painting. */
function cardTemplate(p) {
  const price  = cart.priceFor(p.id);
  const inCart = cart.has(p.id);

  return `
    <article class="painting-card" data-id="${p.id}">
      <button class="card-viewer card-viewer--thumb"
              type="button" data-action="open-product"
              aria-label="Open ${escapeHtml(p.name)} in 3D">
        <img class="card-thumb is-loading"
             src="${PLACEHOLDER_THUMB}"
             data-model-url="${escapeHtml(p.modelUrl)}"
             loading="lazy"
             alt="Preview of ${escapeHtml(p.name)}" />
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

  // Hand each model off to the snapshot queue in display order. Already-
  // cached thumbs are applied immediately by enqueueThumb itself.
  for (const p of allPaintings) {
    enqueueThumb(p.modelUrl);
  }
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
   PRODUCT MODAL
   -----------------------------------------------------
   The product modal is the *only* place the heavy
   <model-viewer> is alive for user interaction.
   We attach `src` on open, strip it on close → one
   active WebGL context for the gallery experience
   (the hidden capture viewer is a second one,
   reused sequentially, never parallel).

   Variants are presented as selectable pills only —
   they record the user's chosen size in the cart and
   in the eventual order row. AR uses ar-scale="auto"
   so the user can resize the model with native pinch
   gestures; the exact size lives in the variant label
   (in cm) and is reinforced by the disclaimer text
   in the markup.
===================================================== */
let currentProductId = null;
let selectedVariant  = null;

function openProductModal(paintingId) {
  const p = findPainting(paintingId);
  if (!p) return;

  currentProductId = p.id;
  selectedVariant  = null;

  // ---- Mount the heavy viewer ON DEMAND ----
  els.productViewer.setAttribute('src', p.modelUrl);
  els.productViewer.setAttribute('alt', `3D model of the painting '${p.name}'`);

  // Title + price
  els.productTitle.textContent = p.name;
  els.productPrice.textContent = cart.formatPrice(cart.priceFor(p.id));

  // Variants
  const list = (p.variants || '')
    .split(',').map(v => v.trim()).filter(Boolean);

  if (list.length > 0) {
    els.productVariants.innerHTML = list.map((v, i) => `
      <button class="variant-pill ${i === 0 ? 'selected' : ''}"
              type="button" data-variant="${escapeHtml(v)}">
        ${escapeHtml(v)}
      </button>
    `).join('');
    selectedVariant = list[0];
    els.productVariantsSection.hidden = false;
  } else {
    els.productVariants.innerHTML = '';
    els.productVariantsSection.hidden = true;
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
  // Free model resources so we never keep an idle WebGL context
  els.productViewer.removeAttribute('src');
  currentProductId = null;
  selectedVariant = null;
  maybeUnlockScroll();
}

els.productClose.addEventListener('click', closeProductModal);
els.productOverlay.addEventListener('click', closeProductModal);

/* Variant selection — pills are pure UI state now.
   The AR preview is NOT scaled; the cm value in the variant label
   is what tells the buyer the real-world size. */
els.productVariants.addEventListener('click', (e) => {
  const btn = e.target.closest('.variant-pill');
  if (!btn) return;
  els.productVariants.querySelectorAll('.variant-pill')
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedVariant = btn.dataset.variant;
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
