/* =====================================================
   AR-Art-Gallery — Prototype script
   ─────────────────────────────────────────────────────
   All persistence currently uses localStorage + base64
   data URLs so the app works without any backend.
   
   Replace the marked sections with the Firebase SDK
   when wiring up production:
   
     • fetchPaintings   →  Firestore  getDocs(...)
     • uploadPainting   →  Storage    uploadBytes(...) + Firestore addDoc(...)
     • deletePainting   →  Firestore  deleteDoc(...)  + Storage deleteObject(...)
   
   Look for the 🔥 FIREBASE markers throughout this file.
===================================================== */


/* -----------------------------------------------------
   CONFIG
----------------------------------------------------- */

const STORAGE_KEY = 'aether_gallery_v1';

// 🔥 FIREBASE: replace with auth.currentUser.displayName once auth is live
const SELLER_NAME = 'Elena Marchetti';

// Demo entries shown on first load so the gallery isn't empty.
// In production these will live in Firestore.
const DEMO_PAINTINGS = [
  {
    id: 'demo_astronaut',
    name: 'Suspended Astronaut',
    modelUrl: 'https://modelviewer.dev/shared-assets/models/Astronaut.glb',
    uploadedAt: Date.now() - 86400000 * 3,
    isDemo: true
  },
  {
    id: 'demo_neilarmstrong',
    name: 'Lunar Footprint',
    modelUrl: 'https://modelviewer.dev/shared-assets/models/NeilArmstrong.glb',
    uploadedAt: Date.now() - 86400000 * 2,
    isDemo: true
  },
  {
    id: 'demo_robot',
    name: 'Expressive Form',
    modelUrl: 'https://modelviewer.dev/shared-assets/models/RobotExpressive.glb',
    uploadedAt: Date.now() - 86400000,
    isDemo: true
  }
];


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
  // 🔥 FIREBASE — replace the whole block below with:
  //
  //   import { collection, getDocs, orderBy, query } from 'firebase/firestore';
  //   const q = query(collection(db, 'paintings'), orderBy('uploadedAt', 'desc'));
  //   const snap = await getDocs(q);
  //   return snap.docs.map(d => ({ id: d.id, ...d.data() }));

  await simulateLatency(200);

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    // first run — seed with demos
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEMO_PAINTINGS));
    return [...DEMO_PAINTINGS];
  }

  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Upload a new painting.
 * @param {File} file - the .glb file
 * @param {string} name - the painting title
 * @returns {Promise<{id, name, modelUrl, uploadedAt}>}
 */
async function uploadPainting(file, name) {
  // 🔥 FIREBASE — replace the whole block below with:
  //
  //   import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
  //   import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
  //
  //   const storageRef = ref(storage, `paintings/${crypto.randomUUID()}.glb`);
  //   const snap       = await uploadBytes(storageRef, file);
  //   const modelUrl   = await getDownloadURL(snap.ref);
  //
  //   const docRef = await addDoc(collection(db, 'paintings'), {
  //     name,
  //     modelUrl,
  //     storagePath: snap.ref.fullPath,
  //     sellerId:    auth.currentUser.uid,
  //     uploadedAt:  serverTimestamp()
  //   });
  //
  //   return { id: docRef.id, name, modelUrl, uploadedAt: Date.now() };

  await simulateLatency(400);

  const modelUrl = await fileToDataUrl(file);

  const painting = {
    id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name,
    modelUrl,
    uploadedAt: Date.now(),
    isDemo: false
  };

  const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  current.unshift(painting);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (err) {
    // localStorage quota is small (~5 MB). Firebase Storage has no such limit.
    throw new Error('QUOTA_EXCEEDED');
  }

  return painting;
}

/**
 * Delete a painting by id.
 * @param {string} id
 */
async function deletePainting(id) {
  // 🔥 FIREBASE — replace the whole block below with:
  //
  //   import { doc, deleteDoc, getDoc } from 'firebase/firestore';
  //   import { ref, deleteObject } from 'firebase/storage';
  //
  //   const snap = await getDoc(doc(db, 'paintings', id));
  //   const data = snap.data();
  //   await deleteDoc(doc(db, 'paintings', id));
  //   if (data?.storagePath) await deleteObject(ref(storage, data.storagePath));

  await simulateLatency(150);

  const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const updated = current.filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
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
