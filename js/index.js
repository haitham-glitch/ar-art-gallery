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
   NAV
===================================================== */
async function renderNav() {
  const session = await getSession();
  if (!session) {
    els.nav.innerHTML = `<a href="login.html" class="nav-link">Sign in →</a>`;
    return;
  }
  const profile = await getProfile(session.user.id);
  const link = profile?.role === 'seller'
    ? `<a href="dashboard.html" class="nav-link">Dashboard</a>`
    : `<span class="nav-greeting">${escapeHtml(profile?.display_name || 'Welcome')}</span>`;

  els.nav.innerHTML = `
    ${link}
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

function cardTemplate(p) {
  const price = cart.priceFor(p.id);
  const inCart = cart.has(p.id);
  return `
    <article class="painting-card" data-id="${p.id}">
      <div class="card-viewer">
        <model-viewer src="${p.modelUrl}"
          alt="3D model of the painting '${escapeHtml(p.name)}'"
          ar ar-modes="webxr scene-viewer quick-look"
          camera-controls auto-rotate
          shadow-intensity="1.2" exposure="1.05"
          environment-image="neutral" ar-scale="auto"
          loading="lazy">
          <button slot="ar-button" class="ar-launch" type="button">
            <span>View in your space</span>
            <span class="ar-glyph">↗</span>
          </button>
        </model-viewer>
      </div>
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
   - Add to cart button  → quick add (no variant)
   - AR launch button    → let model-viewer handle it
   - Anywhere else       → open the product modal
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
  // 2) AR button — ignore
  if (e.target.closest('.ar-launch')) return;
  // 3) anywhere else on the card → open modal
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
===================================================== */
let currentProductId = null;
let selectedVariant  = null;

function openProductModal(paintingId) {
  const p = findPainting(paintingId);
  if (!p) return;

  currentProductId = p.id;
  selectedVariant  = null;

  // Viewer
  els.productViewer.src = p.modelUrl;
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
  // Free model resources
  els.productViewer.removeAttribute('src');
  currentProductId = null;
  selectedVariant = null;
  maybeUnlockScroll();
}

els.productClose.addEventListener('click', closeProductModal);
els.productOverlay.addEventListener('click', closeProductModal);

/* Variant selection */
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
   CHECKOUT MODAL  (unchanged from Phase 2)
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

els.checkoutForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearAllErrors();
  const errors = validate();
  if (Object.keys(errors).length > 0) {
    Object.entries(errors).forEach(([k, v]) => showError(k, v));
    return;
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