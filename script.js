// استدعاء مكتبة Supabase عن طريق CDN
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// إعدادات الربط - استبدل KEY_HERE بمفتاح الـ anon/publishable الذي نسخته
const SUPABASE_URL = 'https://wfqcygkgshoyvdgsbnqr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_C8ClLruKmK3e7iKVdXrCyg_qK-zdW4D'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// 🔥 FIREBASE: replace with auth.currentUser.displayName once auth is live
const SELLER_NAME = 'AR Art Gallery';




/* =====================================================
   BACKEND PLACEHOLDERS
   ─────────────────────────────────────────────────────
   Modular async functions — call signatures stay the
   same when you swap localStorage for Firebase.
===================================================== */

/**
 * Fetch all paintings, newest first.
 * @returns {Promise<Array<{id, name, modelUrl, uploadedAt, isDemo?}>>}
 */
async function fetchPaintings() {
  const { data, error } = await supabase
    .from('paintings')
    .select('*')
    .order('uploadedAt', { ascending: false });

  if (error) {
    console.error("Error fetching:", error);
    return [];
  }
  return data;
}

/**
 * Upload a new painting.
 * @param {File} file - the .glb file
 * @param {string} name - the painting title
 * @returns {Promise<{id, name, modelUrl, uploadedAt}>}
 */
async function uploadPainting(file, name) {
  const fileName = `${Date.now()}_${file.name}`;
  
  // 1. رفع الملف إلى الـ Bucket اللي سميناه paintings
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('paintings')
    .upload(fileName, file);

  if (uploadError) throw uploadError;

  // 2. الحصول على الرابط العام للملف
  const { data: urlData } = supabase.storage
    .from('paintings')
    .getPublicUrl(fileName);

  const modelUrl = urlData.publicUrl;

  // 3. حفظ البيانات في جدول الـ Database
  const { data: dbData, error: dbError } = await supabase
    .from('paintings')
    .insert([{
      name: name,
      modelUrl: modelUrl,
      storagePath: fileName,
      uploadedAt: Date.now()
    }])
    .select();

  if (dbError) throw dbError;
  return dbData[0];
}

/**
 * Delete a painting by id.
 * @param {string} id
 */
async function deletePainting(id) {
  // جلب مسار الملف أولاً لحذفه من التخزين
  const { data: item } = await supabase.from('paintings').select('storagePath').eq('id', id).single();
  
  if (item?.storagePath) {
    await supabase.storage.from('paintings').remove([item.storagePath]);
  }

  // حذف السجل من قاعدة البيانات
  await supabase.from('paintings').delete().eq('id', id);
}


/* -----------------------------------------------------
   HELPERS
----------------------------------------------------- */

function simulateLatency(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
    year:  'numeric'
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}


/* =====================================================
   UI LAYER
===================================================== */

const $ = sel => document.querySelector(sel);

const els = {
  form:          $('#uploadForm'),
  submitBtn:     $('#submitBtn'),
  nameInput:     $('#paintingName'),
  fileInput:     $('#paintingFile'),
  fileName:      $('#fileName'),
  fileDisplay:   document.querySelector('.file-input-display'),
  grid:          $('#galleryGrid'),
  count:         $('#paintingCount'),
  sellerName:    $('#sellerName'),
  empty:         $('#emptyState'),
  toast:         $('#toast')
};

/* ---------- Render ---------- */

async function renderGallery() {
  const paintings = await fetchPaintings();

  els.count.textContent = paintings.length;
  els.empty.hidden = paintings.length > 0;

  els.grid.innerHTML = paintings.map(cardTemplate).join('');
}

function cardTemplate(p) {
  return `
    <article class="painting-card" data-id="${p.id}">
      <div class="card-viewer">
        <model-viewer
          src="${p.modelUrl}"
          alt="3D model of the painting '${escapeHtml(p.name)}'"
          ar
          ar-modes="webxr scene-viewer quick-look"
          camera-controls
          auto-rotate
          shadow-intensity="1.2"
          exposure="1.05"
          environment-image="neutral"
          ar-scale="auto"
          loading="lazy">
          <button slot="ar-button" class="ar-launch" type="button">
            <span>View in your space</span>
            <span class="ar-glyph">↗</span>
          </button>
        </model-viewer>
      </div>
      <div class="card-body">
        <div class="card-meta">
          <span>${formatDate(p.uploadedAt)}</span>
          ${p.isDemo ? '<span class="badge">Demo</span>' : ''}
        </div>
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

/* ---------- Header ---------- */

function renderHeader() {
  els.sellerName.textContent = SELLER_NAME;
}

/* ---------- Form events ---------- */

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

  const name = els.nameInput.value.trim();
  const file = els.fileInput.files[0];

  if (!name || !file) return;

  if (!file.name.toLowerCase().endsWith('.glb')) {
    showToast('Only .glb files are supported.');
    return;
  }

  setSubmitting(true);

  try {
    await uploadPainting(file, name);

    els.form.reset();
    els.fileName.textContent = 'Drop a .glb file here, or click to browse';
    els.fileDisplay.classList.remove('has-file');

    showToast(`"${name}" added to the collection.`);
    await renderGallery();

  } catch (err) {
    console.error(err);
    if (err.message === 'QUOTA_EXCEEDED') {
      showToast('File too large for local storage. Firebase Storage will handle this in production — AR-Art-Gallery.');
    } else {
      showToast('Upload failed. Check the console for details.');
    }
  } finally {
    setSubmitting(false);
  }
});

function setSubmitting(isLoading) {
  els.submitBtn.disabled = isLoading;
  els.submitBtn.classList.toggle('loading', isLoading);
}

/* ---------- Gallery events (delegated) ---------- */

els.grid.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete"]');
  if (!btn) return;

  const card = btn.closest('.painting-card');
  const id   = card?.dataset.id;
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

/* ---------- Toast ---------- */

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  // force reflow so the transition triggers
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

renderHeader();
renderGallery();
