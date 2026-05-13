import { supabase } from './supabase-client.js';
import { requireRole, signOut } from './auth.js';

/* ---- Route guard: only sellers may proceed ---- */
const access = await requireRole('seller');
if (!access) throw new Error('Access denied'); // requireRole has already redirected
const { user: currentUser, profile: currentProfile } = access;

/* ---- DOM ---- */
const els = {
  form:        document.getElementById('uploadForm'),
  submitBtn:   document.getElementById('submitBtn'),
  nameInput:   document.getElementById('paintingName'),
  fileInput:   document.getElementById('paintingFile'),
  fileName:    document.getElementById('fileName'),
  fileDisplay: document.querySelector('.file-input-display'),
  grid:        document.getElementById('galleryGrid'),
  count:       document.getElementById('paintingCount'),
  sellerName:  document.getElementById('sellerName'),
  empty:       document.getElementById('emptyState'),
  toast:       document.getElementById('toast'),
  logoutBtn:   document.getElementById('logoutBtn'),
  variantsInput:document.getElementById('paintingVariants'),
  allowCustomCheckbox: document.getElementById('paintingAllowCustom'),
};

els.sellerName.textContent = currentProfile.display_name || currentUser.email;

els.logoutBtn.addEventListener('click', async () => {
  await signOut();
  window.location.replace('index.html');
});

/* ---- Helpers ---- */
const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatDate = ts => new Date(ts).toLocaleDateString('en-US',
  { month:'short', day:'numeric', year:'numeric' });

/* ---- Data layer ---- */

async function fetchMyPaintings() {
  const { data, error } = await supabase
    .from('paintings')
    .select('*')
    .eq('seller_id', currentUser.id)
    .order('uploadedAt', { ascending: false });
  if (error) { console.error(error); return []; }
  return data;
}

async function uploadPainting(file, name, variants, allowCustom) {
  const storagePath = `${currentUser.id}/${Date.now()}_${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from('paintings')
    .upload(storagePath, file);
  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage
    .from('paintings')
    .getPublicUrl(storagePath);

  const { data, error } = await supabase
    .from('paintings')
    .insert([{
      name,
      modelUrl:     urlData.publicUrl,
      storagePath:  storagePath,
      uploadedAt:   Date.now(),
      seller_id:    currentUser.id,
      variants:     variants,        // ← new
      allow_custom: allowCustom      // ← new
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deletePainting(id) {
  const { data: item } = await supabase
    .from('paintings')
    .select('storagePath')
    .eq('id', id)
    .single();
  if (item?.storagePath) {
    await supabase.storage.from('paintings').remove([item.storagePath]);
  }
  const { error } = await supabase.from('paintings').delete().eq('id', id);
  if (error) throw error;
}

/* ---- Render ---- */

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
        <div class="card-actions">
          <button class="card-delete" data-action="delete" type="button">
            Remove from collection
          </button>
        </div>
      </div>
    </article>
  `;
}

async function renderGallery() {
  const paintings = await fetchMyPaintings();
  els.count.textContent = paintings.length;
  els.empty.hidden = paintings.length > 0;
  els.grid.innerHTML = paintings.map(cardTemplate).join('');
}

/* ---- Events ---- */

els.fileInput.addEventListener('change', () => {
  const file = els.fileInput.files[0];
  if (file) {
    els.fileName.textContent = file.name;
    els.fileDisplay.classList.add('has-file');
  } else {
    els.fileName.textContent = 'Drop a .glb file here, or click to browse';
    els.fileDisplay.classList.remove('has-file');
  }
});

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name        = els.nameInput.value.trim();
  const file        = els.fileInput.files[0];
  const variants    = els.variantsInput.value.trim() || null;
  const allowCustom = els.allowCustomCheckbox.checked;

  if (!name || !file) return;
  if (!file.name.toLowerCase().endsWith('.glb')) {
    showToast('Only .glb files are supported.');
    return;
  }

  setSubmitting(true);
  try {
    await uploadPainting(file, name, variants, allowCustom);
    els.form.reset();
    els.allowCustomCheckbox.checked = false;
    els.fileName.textContent = 'Drop a .glb file here, or click to browse';
    els.fileDisplay.classList.remove('has-file');
    showToast(`"${name}" added to the collection.`);
    await renderGallery();
  } catch (err) {
    console.error(err);
    showToast('Upload failed. ' + (err.message || 'See console.'));
  } finally {
    setSubmitting(false);
  }
});

els.grid.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete"]');
  if (!btn) return;
  const id = btn.closest('.painting-card')?.dataset.id;
  if (!id) return;
  if (!confirm('Remove this work from the collection?')) return;
  try {
    await deletePainting(id);
    showToast('Work removed.');
    renderGallery();
  } catch (err) {
    console.error(err);
    showToast('Could not remove the work.');
  }
});

function setSubmitting(loading) {
  els.submitBtn.disabled = loading;
  els.submitBtn.classList.toggle('loading', loading);
}

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
  }, 3200);
}

renderGallery();