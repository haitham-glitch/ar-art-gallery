import { signUp, signIn, getSession, getProfile } from './auth.js';

/* ---- If already signed in, route them away from /login ---- */
(async () => {
  const session = await getSession();
  if (!session) return;
  const profile = await getProfile(session.user.id);
  window.location.replace(profile?.role === 'seller' ? 'dashboard.html' : 'index.html');
})();

/* ---- Tab switching ---- */
const tabs = document.querySelectorAll('.auth-tab');
const panels = document.querySelectorAll('.auth-panel');
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    tabs.forEach(t => t.classList.toggle('active', t === tab));
    panels.forEach(p => p.classList.toggle('active', p.dataset.panel === target));
  });
});

/* ---- Login ---- */
const loginForm = document.getElementById('loginForm');
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  setLoading(btn, true);
  try {
    const { user } = await signIn({ email, password });
    const profile = await getProfile(user.id);
    showToast('Welcome back.');
    setTimeout(() => {
      window.location.replace(profile?.role === 'seller' ? 'dashboard.html' : 'index.html');
    }, 400);
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Login failed.');
    setLoading(btn, false);
  }
});

/* ---- Signup ---- */
const signupForm = document.getElementById('signupForm');
signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email       = document.getElementById('signupEmail').value.trim();
  const password    = document.getElementById('signupPassword').value;
  const displayName = document.getElementById('signupName').value.trim();
  const role        = document.querySelector('input[name="role"]:checked')?.value;

  if (!role) { showToast('Please select an account type.'); return; }

  const btn = document.getElementById('signupBtn');
  setLoading(btn, true);
  try {
    const { session } = await signUp({ email, password, role, displayName });
    if (session) {
      // Email confirmation is OFF → user is signed in immediately
      showToast('Account created.');
      setTimeout(() => {
        window.location.replace(role === 'seller' ? 'dashboard.html' : 'index.html');
      }, 400);
    } else {
      // Email confirmation is ON → user must verify before login works
      showToast('Check your email to confirm your account.');
      setLoading(btn, false);
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Sign up failed.');
    setLoading(btn, false);
  }
});

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.hidden = true; }, 300);
  }, 3200);
}