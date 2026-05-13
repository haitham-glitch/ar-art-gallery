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

  // Fields
  fldName:    document.getElementById('fldName'),
  fldCard:    document.getElementById('fldCard'),
  fldExpiry:  document.getElementById('fldExpiry'),
  fldCvv:     document.getElementById('fldCvv'),
};

/* ---------- Helpers ---------- */
const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatDate = ts => new Date(ts).toLocaleDateString('en-US',
  { month:'short', day:'numeric', year:'numeric' });

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
async function fetchPaintings() {
  const { data, error } = await supabase
    .from('paintings')
    .select('*')
    .order('uploadedAt', { ascending: false });
  if (error) { console.error(error); return []; }
  return data;
}

function cardTemplate(p) {
  const price = cart.priceFor(p.id);
  const inCart = cart.has(p.id);
  return `
    <article class="painting-card" data-id="${p.id}" data-price="${price}" data-name="${escapeHtml(p.name)}">
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
  const paintings = await fetchPaintings();
  els.empty.hidden = paintings.length > 0;
  els.grid.innerHTML = paintings.map(cardTemplate).join('');
}

/* Delegated click on the gallery — Add to Cart */
els.grid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="add-cart"]');
  if (!btn) return;
  const card  = btn.closest('.painting-card');
  const id    = card.dataset.id;
  const name  = card.dataset.name;
  const price = Number(card.dataset.price);

  if (cart.has(id)) {
    openDrawer();
    return;
  }
  cart.add({ id, name, price });
  showToast(`Added "${name}" to your cart.`);
});

/* Sync card button states whenever the cart changes */
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
   CART DRAWER
===================================================== */
function openDrawer() {
  els.cartDrawer.classList.add('open');
  els.cartOverlay.hidden = false;
  // next tick so the transition runs
  requestAnimationFrame(() => els.cartOverlay.classList.add('show'));
  els.cartDrawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}

function closeDrawer() {
  els.cartDrawer.classList.remove('open');
  els.cartOverlay.classList.remove('show');
  els.cartDrawer.setAttribute('aria-hidden', 'true');
  setTimeout(() => { els.cartOverlay.hidden = true; }, 300);
  if (!els.checkoutModal.classList.contains('open')) {
    document.body.classList.remove('no-scroll');
  }
}

els.cartToggle.addEventListener('click', openDrawer);
els.cartClose.addEventListener('click', closeDrawer);
els.cartOverlay.addEventListener('click', closeDrawer);

function renderCartItems(state) {
  els.cartItems.innerHTML = state.items.map(item => `
    <li class="cart-item" data-id="${item.id}">
      <div class="cart-item-thumb" aria-hidden="true">◈</div>
      <div class="cart-item-body">
        <span class="cart-item-name">${escapeHtml(item.name)}</span>
        <span class="cart-item-price">${cart.formatPrice(item.price)}</span>
      </div>
      <button class="cart-item-remove" type="button"
              data-remove="${item.id}" aria-label="Remove ${escapeHtml(item.name)}">×</button>
    </li>
  `).join('');

  els.cartEmpty.hidden = state.count > 0;
  els.cartFooter.hidden = state.count === 0;
  els.cartTotal.textContent = cart.formatPrice(state.total);
}

els.cartItems.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  cart.remove(btn.dataset.remove);
  renderBadge(cart.getState());
});

/* Update badge whenever cart changes */
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
   CHECKOUT MODAL
===================================================== */
function openCheckout() {
  const { total, count } = cart.getState();
  if (count === 0) return;
  els.checkoutTotal.textContent = cart.formatPrice(total);

  // Always start at the form state, clean
  els.stateForm.hidden = false;
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
  if (!els.cartDrawer.classList.contains('open')) {
    document.body.classList.remove('no-scroll');
  }
}

els.cartCheckout.addEventListener('click', openCheckout);
els.checkoutClose.addEventListener('click', closeCheckout);
els.checkoutOverlay.addEventListener('click', closeCheckout);

/* ---------- Input formatters ---------- */
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

/* ---------- Validation ---------- */
function validate() {
  const errors = {};
  const name = els.fldName.value.trim();
  const card = els.fldCard.value.replace(/\s/g, '');
  const exp  = els.fldExpiry.value;
  const cvv  = els.fldCvv.value;

  if (name.length < 3)  errors.name = 'Please enter your full name.';
  if (!/^\d{16}$/.test(card)) errors.card = 'Card number must be 16 digits.';

  const expMatch = exp.match(/^(\d{2})\/(\d{2})$/);
  if (!expMatch) {
    errors.expiry = 'Use MM/YY format.';
  } else {
    const mm = parseInt(expMatch[1], 10);
    const yy = parseInt(expMatch[2], 10);
    const now = new Date();
    const currentYY = now.getFullYear() % 100;
    const currentMM = now.getMonth() + 1;
    if (mm < 1 || mm > 12) errors.expiry = 'Month must be 01–12.';
    else if (yy < currentYY || (yy === currentYY && mm < currentMM)) {
      errors.expiry = 'Card has expired.';
    }
  }

  if (!/^\d{3}$/.test(cvv)) errors.cvv = 'CVV must be 3 digits.';

  return errors;
}

function showError(key, message) {
  const errorEl = document.querySelector(`[data-error="${key}"]`);
  if (errorEl) errorEl.textContent = message;
  const fieldId = { name:'fldName', card:'fldCard', expiry:'fldExpiry', cvv:'fldCvv' }[key];
  document.getElementById(fieldId)?.closest('.field')?.classList.add('error');
}

function clearError(key) {
  const errorEl = document.querySelector(`[data-error="${key}"]`);
  if (errorEl) errorEl.textContent = '';
  const fieldId = { name:'fldName', card:'fldCard', expiry:'fldExpiry', cvv:'fldCvv' }[key];
  document.getElementById(fieldId)?.closest('.field')?.classList.remove('error');
}

function clearAllErrors() {
  ['name','card','expiry','cvv'].forEach(clearError);
}

/* ---------- Submit ---------- */
els.checkoutForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearAllErrors();

  const errors = validate();
  if (Object.keys(errors).length > 0) {
    Object.entries(errors).forEach(([k, v]) => showError(k, v));
    return;
  }

  // ✅ Mock payment confirmed
  cart.clear();  
  renderBadge(cart.getState());                                // empties localStorage cart
  els.stateForm.hidden = true;
  els.stateSuccess.hidden = false;
});

els.checkoutDone.addEventListener('click', () => {
  closeCheckout();
  closeDrawer();
});

/* ---------- Escape key closes overlays ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (els.checkoutModal.classList.contains('open')) closeCheckout();
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