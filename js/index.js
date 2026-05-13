import { supabase } from './supabase-client.js';
import { getSession, getProfile, signOut } from './auth.js';

const els = {
  grid:  document.getElementById('galleryGrid'),
  empty: document.getElementById('emptyState'),
  nav:   document.getElementById('siteNav'),
};

/* ---- Helpers ---- */
const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatDate = ts => new Date(ts).toLocaleDateString('en-US',
  { month:'short', day:'numeric', year:'numeric' });

/* ---- Nav (login state aware) ---- */
async function renderNav() {
  const session = await getSession();
  if (!session) {
    els.nav.innerHTML = `<a href="login.html" class="nav-link">Sign in →</a>`;
    return;
  }
  const profile = await getProfile(session.user.id);
  const dashLink = profile?.role === 'seller'
    ? `<a href="dashboard.html" class="nav-link">Dashboard</a>`
    : `<span class="nav-greeting">${escapeHtml(profile?.display_name || 'Welcome')}</span>`;

  els.nav.innerHTML = `
    ${dashLink}
    <button class="nav-btn" id="logoutBtn" type="button">Sign out</button>
  `;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut();
    window.location.reload();
  });
}

/* ---- Gallery ---- */
async function fetchPaintings() {
  const { data, error } = await supabase
    .from('paintings')
    .select('*')
    .order('uploadedAt', { ascending: false });
  if (error) { console.error(error); return []; }
  return data;
}

function cardTemplate(p) {
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
      </div>
    </article>
  `;
}

async function renderGallery() {
  const paintings = await fetchPaintings();
  els.empty.hidden = paintings.length > 0;
  els.grid.innerHTML = paintings.map(cardTemplate).join('');
}

renderNav();
renderGallery();