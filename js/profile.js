import { supabase } from './supabase-client.js';
import { getSession, getProfile, signOut } from './auth.js';

/* =====================================================
   ROUTE GUARD
   ----------------------------------------------------
   The profile page is for any authenticated user
   (customer OR seller — both can buy works).
   If there's no session, bounce to login.
===================================================== */
const session = await getSession();
if (!session) {
  window.location.replace('login.html');
  throw new Error('Not authenticated');
}

const profile = await getProfile(session.user.id);

/* ---------- DOM ---------- */
const els = {
  avatar:        document.getElementById('accountAvatar'),
  name:          document.getElementById('accountName'),
  email:         document.getElementById('accountEmail'),
  role:          document.getElementById('accountRole'),
  ordersList:    document.getElementById('ordersList'),
  ordersEmpty:   document.getElementById('ordersEmpty'),
  ordersLoading: document.getElementById('ordersLoading'),
  logoutBtn:     document.getElementById('logoutBtn'),
  toast:         document.getElementById('toast'),
};

/* ---------- Helpers ---------- */
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const formatMoney = n =>
  `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const formatLongDate = ts =>
  new Date(ts).toLocaleDateString('en-US',
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

const shortOrderId = (id) => {
  const s = String(id || '');
  return s.length > 8 ? s.slice(0, 8).toUpperCase() : s.toUpperCase();
};

/* Normalize the status string into a CSS modifier */
function statusClass(status) {
  const s = String(status || 'Processing').toLowerCase();
  if (s.includes('cancel'))   return 'order-status--cancelled';
  if (s.includes('deliver'))  return 'order-status--delivered';
  if (s.includes('ship'))     return 'order-status--shipped';
  return 'order-status--processing';
}

/* =====================================================
   RENDER — ACCOUNT IDENTITY
===================================================== */
function renderAccount() {
  const displayName = profile?.display_name || session.user.email?.split('@')[0] || 'Visitor';
  const initial     = (displayName.trim()[0] || '·').toUpperCase();

  els.avatar.textContent = initial;
  els.name.textContent   = displayName;
  els.email.textContent  = session.user.email || '—';

  if (profile?.role) {
    els.role.textContent = profile.role === 'seller' ? 'Seller · Curator' : 'Customer';
    els.role.hidden = false;
  }
}

/* =====================================================
   FETCH + RENDER — ORDER HISTORY
===================================================== */
async function fetchOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load orders:', error);
    showToast('Could not load your order history.');
    return [];
  }
  return data || [];
}

function orderItemTemplate(item) {
  const name    = escapeHtml(item.name || 'Untitled work');
  const variant = item.variant
    ? `<span class="order-item-meta">${escapeHtml(item.variant)}</span>` : '';
  const note    = item.customNote
    ? `<p class="order-item-note">"${escapeHtml(item.customNote)}"</p>` : '';

  return `
    <li class="order-item">
      <div class="order-item-body">
        <span class="order-item-name">${name}</span>
        ${variant}
        ${note}
      </div>
      <span class="order-item-price">${formatMoney(item.price)}</span>
    </li>
  `;
}

function orderCardTemplate(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.length
    ? items.map(orderItemTemplate).join('')
    : `<li class="order-item">
         <div class="order-item-body">
           <span class="order-item-name">Order details unavailable</span>
         </div>
       </li>`;

  const status = order.status || 'Processing';

  return `
    <li class="order-card">
      <header class="order-card-header">
        <div class="order-card-meta">
          <p class="order-card-eyebrow">
            Order placed
            <span class="order-id">#${escapeHtml(shortOrderId(order.id))}</span>
          </p>
          <h3 class="order-card-date">${formatLongDate(order.created_at)}</h3>
        </div>
        <span class="order-status ${statusClass(status)}">
          ${escapeHtml(status)}
        </span>
      </header>

      <ul class="order-items" role="list">
        ${itemsHtml}
      </ul>

      <footer class="order-card-footer">
        <span class="order-card-total-label">Total</span>
        <span class="order-card-total">${formatMoney(order.total_amount)}</span>
      </footer>
    </li>
  `;
}

async function renderOrders() {
  els.ordersLoading.hidden = false;
  els.ordersEmpty.hidden   = true;
  els.ordersList.innerHTML = '';

  const orders = await fetchOrders();

  els.ordersLoading.hidden = true;
  els.ordersEmpty.hidden   = orders.length > 0;
  els.ordersList.innerHTML = orders.map(orderCardTemplate).join('');
}

/* =====================================================
   ACTIONS
===================================================== */
els.logoutBtn.addEventListener('click', async () => {
  try {
    await signOut();
  } finally {
    window.location.replace('index.html');
  }
});

/* =====================================================
   TOAST
===================================================== */
let toastTimer = null;
function showToast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.hidden = false;
  void els.toast.offsetWidth;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => { els.toast.hidden = true; }, 300);
  }, 3200);
}

/* =====================================================
   INIT
===================================================== */
renderAccount();
renderOrders();
