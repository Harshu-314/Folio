/**
 * FOLIO — Editorial AI Career & Resume Studio
 * Frontend Application Core Engine
 * Fully integrated with Flask Backend API (http://localhost:5000/api)
 */
// Auto-detect API base: uses relative '/api' on cloud hosts or same origin, and http://localhost:5000/api when using standalone dev server
const API_BASE = (window.location.port === '3000')
  ? 'http://localhost:5000/api'
  : (window.location.hostname === 'localhost' && window.location.port !== '5000'
      ? 'http://localhost:5000/api'
      : `${window.location.origin}/api`);

// Same OAuth Client ID as the backend's GOOGLE_CLIENT_ID (get one at
// https://console.cloud.google.com/apis/credentials). This one is public by
// design - Google Client IDs are meant to be embedded in frontend code.
const GOOGLE_CLIENT_ID = '396341924739-nhomu2462h6p9d0k9ku9apev3bm9b1ln.apps.googleusercontent.com';
// CV-only long-form sections: content key -> display title. Mirrors
// CV_SECTIONS in app/services/pdf_service.py so the live preview and the
// PDF export always agree on what a CV template can show.
const CV_SECTIONS_META = [
  ['publications', 'Publications'],
  ['research_experience', 'Research Experience'],
  ['teaching_experience', 'Teaching Experience'],
  ['conferences', 'Conferences & Presentations'],
  ['grants_fellowships', 'Grants & Fellowships'],
  ['awards_honors', 'Awards & Honors'],
  ['affiliations', 'Professional Affiliations'],
  ['references', 'References'],
];

// --- GLOBAL APPLICATION STATE ---
const state = {
  token: localStorage.getItem('folio_jwt_token') || null,
  user: JSON.parse(localStorage.getItem('folio_user_profile') || 'null'),
  resumes: [],
  activeResumeId: null,
  activeTemplate: 'minimal',
  templates: [],           // populated from GET /api/templates
  templatesById: {},
  pendingVerificationEmail: null,  // set between register/blocked-login and a completed /verify-email
  zoomLevel: 100,
  saveTimeout: null,
  isSaving: false,
  wizardStep: 1,

  // AI Recruiter Assistant chat - kept in-memory for the current session only
  recruiterChatHistory: [],
  recruiterChatSending: false,

  // Active Resume Document Model
  resumeData: {
    title: 'Untitled Resume',
    template_id: 'minimal',
    target_job_title: 'Backend Developer',
    target_job_description: '',
    content: {
      personal: {
        name: '',
        email: '',
        phone: '',
        location: '',
        linkedin: '',
        portfolio: ''
      },
      summary: 'Final-year CS student who has shipped 3 full-stack projects and interned as a backend developer, focused on building reliable, well-tested APIs.',
      experience: [
        {
          role: 'Backend Developer Intern',
          company: 'TechNova Pvt Ltd',
          duration: 'May 2025 - Jul 2025',
          bullets: [
            'Built 12 REST API endpoints used by 3 internal teams, cutting manual reporting time by 40%',
            'Reduced average API response time by 220ms by adding database indexes and query caching'
          ]
        }
      ],
      education: [
        {
          degree: 'B.Tech in Computer Science',
          institution: 'JNTU Hyderabad',
          duration: '2022 - 2026',
          details: 'CGPA: 8.7/10'
        }
      ],
      skills: ['Python', 'Flask', 'JavaScript', 'SQL', 'Git', 'REST APIs', 'Docker'],
      projects: [
        {
          name: 'AI Resume Builder',
          description: 'A Micro SaaS platform that generates ATS-friendly resumes using AI.',
          bullets: ['Designed the ATS scoring engine used by 200+ beta testers'],
          tech_stack: ['Flask', 'SQLite', 'Gemini API']
        }
      ],
      certifications: ['Google Data Analytics Certificate']
    }
  }
};

// --- DOM INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  initAuth();
  initGoogleSignIn();
  initSocialAuthButtons();
  initVerifyModal();
  initForgotPassword();
  initPasswordVisibilityToggles();
  initDashboard();
  initWizard();
  initStudioEditor();
  initDrawer();
  initPricing();
  initSimulatedAts();
  initProfile();

  checkBackendHealth();
  // Template metadata (layout/accent/font per template) is needed before
  // any resume can be opened in the Studio, so load it before resuming
  // the user's session.
  await loadTemplates();
  checkAuthSession();
  handleSocialAuthRedirect();
});

// --- TEMPLATE REGISTRY (Resume + CV templates, from the backend) ---
async function loadTemplates() {
  const res = await apiCall('/templates', 'GET');
  const fallback = [
    { id: 'minimal', label: 'Minimal', category: 'resume' },
    { id: 'modern', label: 'Modern', category: 'resume' },
    { id: 'classic', label: 'Classic Serif', category: 'resume' },
  ];
  const templates = (res && res.success && res.data && res.data.templates) ? res.data.templates : fallback;

  state.templates = templates;
  state.templatesById = Object.fromEntries(templates.map(t => [t.id, t]));

  populateTemplateSelect(document.getElementById('wiz-template-select'));
  populateTemplateSelect(document.getElementById('studio-template-select'));

  const tplSelect = document.getElementById('studio-template-select');
  if (tplSelect) tplSelect.value = state.activeTemplate || 'minimal';
}

function populateTemplateSelect(select) {
  if (!select) return;
  const previousValue = select.value;
  select.innerHTML = '';

  const groups = { resume: 'Resume Templates', cv: 'CV Templates' };
  Object.entries(groups).forEach(([category, groupLabel]) => {
    const items = state.templates.filter(t => t.category === category);
    if (items.length === 0) return;
    const optgroup = document.createElement('optgroup');
    optgroup.label = groupLabel;
    items.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = (t.is_premium ? '👑 ' : '') + t.label;
      optgroup.appendChild(opt);
    });
    select.appendChild(optgroup);
  });

  if (previousValue && state.templatesById[previousValue]) {
    select.value = previousValue;
  }
}

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✓';
  if (type === 'error') icon = '⚠️';
  if (type === 'info') icon = '✨';

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// --- API HELPER WRAPPER ---
async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  try {
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${endpoint}`, options);
    
    // Handle 401 Unauthorized (Expired Token)
    if (res.status === 401 && state.token) {
      handleLogout();
      showToast('Session expired. Please sign in again.', 'error');
      return { success: false, error: 'Unauthorized' };
    }

    const data = await res.json();
    if (!res.ok) {
      return { success: false, status: res.status, error: data.error || 'Server request failed', details: data.details };
    }

    return data;
  } catch (err) {
    console.warn(`[API Call Failed]: ${endpoint}`, err);
    return { success: false, offline: true, error: 'Backend unreachable. Operating in offline demo mode.' };
  }
}

// --- BACKEND HEALTH & SESSION CHECK ---
async function checkBackendHealth() {
  const res = await apiCall('/health');
  const pill = document.getElementById('backend-status-pill');
  if (res && res.success) {
    if (pill) {
      pill.className = 'backend-pill online';
      pill.querySelector('.status-label').textContent = 'Backend Connected';
    }
  } else {
    if (pill) {
      pill.className = 'backend-pill offline';
      pill.querySelector('.status-label').textContent = 'Offline Demo Mode';
    }
  }
}

async function checkAuthSession() {
  if (!state.token) {
    if (state.user && state.user.plan === 'premium') {
      state.token = 'demo_premium_token';
      localStorage.setItem('folio_jwt_token', state.token);
    } else {
      updateUserInterface();
      return;
    }
  }

  const res = await apiCall('/auth/me');
  if (res && res.success && res.data && res.data.user) {
    const wasPremium = (state.user && state.user.plan === 'premium');
    state.user = res.data.user;
    if (wasPremium) state.user.plan = 'premium';
    localStorage.setItem('folio_user_profile', JSON.stringify(state.user));
  }
  updateUserInterface();
}

function getUserInitials(name) {
  if (!name || typeof name !== 'string') return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function updateUserInterface() {
  const loggedOutBox = document.getElementById('auth-logged-out');
  const loggedInBox = document.getElementById('auth-logged-in');
  const dashTab = document.getElementById('nav-dashboard-tab');
  const studioTab = document.getElementById('nav-studio-tab');
  const profileTab = document.getElementById('nav-profile-tab');
  const planPill = document.getElementById('nav-plan-pill');
  const nameLbl = document.getElementById('user-display-name');
  const avatarInitials = document.getElementById('user-avatar-initials');
  const dashGreeting = document.getElementById('dash-greeting');
  const statUserPlan = document.getElementById('stat-user-plan');
  const statAts = document.getElementById('stat-ats-remaining');
  const btnStatUpgrade = document.getElementById('btn-stat-upgrade');
  const btnOpenUpgrade = document.getElementById('btn-open-upgrade');
  const btnPriceUpgrade = document.getElementById('btn-price-upgrade');
  const btnPriceFree = document.getElementById('btn-price-free');
  const btnPriceDowngrade = document.getElementById('btn-price-downgrade');

  if (state.token && state.user) {
    const isPremium = state.user.plan === 'premium';
    const displayName = state.user.name || state.user.email?.split('@')[0] || 'User';

    if (loggedOutBox) loggedOutBox.style.display = 'none';
    if (loggedInBox) loggedInBox.style.display = 'flex';
    if (dashTab) dashTab.style.display = 'inline-block';
    if (profileTab) profileTab.style.display = 'inline-block';
    if (nameLbl) nameLbl.textContent = displayName;
    if (avatarInitials) avatarInitials.textContent = getUserInitials(displayName);
    applyAvatarPhoto('user-avatar-photo', 'user-avatar-initials', getProfilePhoto());

    // 1. Dashboard Greeting with actual user's name
    if (dashGreeting) {
      dashGreeting.textContent = `Welcome back, ${displayName}`;
    }

    // 2. Dashboard Plan Status Metric
    if (statUserPlan) {
      statUserPlan.textContent = isPremium ? 'Premium Pro' : 'Free Tier';
      statUserPlan.style.color = isPremium ? 'var(--primary)' : 'inherit';
      statUserPlan.style.fontWeight = isPremium ? '700' : '600';
    }

    // 3. Dashboard ATS Checks Remaining
    if (statAts) {
      statAts.textContent = isPremium ? '∞ Unlimited' : Math.max(0, 3 - (state.user.ats_checks_used || 0));
    }

    if (btnStatUpgrade) {
      if (isPremium) {
        btnStatUpgrade.textContent = 'Active Pro ⭐';
        btnStatUpgrade.className = 'btn btn-ghost btn-xs active-pro-badge';
      } else {
        btnStatUpgrade.textContent = 'Upgrade Limit';
        btnStatUpgrade.className = 'btn btn-ghost btn-xs';
      }
    }

    // 4. Navbar Plan Pill & Upgrade Button
    if (planPill) {
      planPill.textContent = isPremium ? '⭐ Premium Pro' : 'Free Tier';
      planPill.className = `plan-pill ${state.user.plan || 'free'}`;
    }

    if (btnOpenUpgrade) {
      if (isPremium) {
        btnOpenUpgrade.textContent = '⭐ Pro Active';
        btnOpenUpgrade.className = 'btn btn-ghost btn-sm';
      } else {
        btnOpenUpgrade.textContent = 'Upgrade to Premium';
        btnOpenUpgrade.className = 'btn btn-secondary btn-sm';
      }
    }

    // 5. Pricing View Buttons
    const upgradeBtns = document.querySelectorAll('.btn-price-upgrade-action');
    upgradeBtns.forEach(b => {
      if (isPremium) {
        b.innerHTML = '<span>✓ Active Plan (Premium)</span>';
        b.classList.remove('btn-sparkle');
        b.disabled = true;
      } else {
        const plan = b.getAttribute('data-plan');
        const text = plan === 'annual' ? 'Upgrade Annual (₹1,999/yr)' : 'Upgrade Monthly (₹199/mo)';
        b.innerHTML = `<span>${text}</span>`;
        b.classList.add('btn-sparkle');
        b.disabled = false;
      }
    });

    // 6. Email Verification Banner
    const verifyBanner = document.getElementById('verify-email-banner');
    if (verifyBanner) {
      verifyBanner.style.display = state.user.email_verified ? 'none' : 'flex';
    }

  } else {
    if (loggedOutBox) loggedOutBox.style.display = 'flex';
    if (loggedInBox) loggedInBox.style.display = 'none';
    if (dashTab) dashTab.style.display = 'none';
    if (studioTab) studioTab.style.display = 'none';
    if (profileTab) profileTab.style.display = 'none';
    if (dashGreeting) dashGreeting.textContent = 'Welcome back, Developer';
    if (statUserPlan) statUserPlan.textContent = 'Free';
    if (statAts) statAts.textContent = '3';
    if (planPill) {
      planPill.textContent = 'Free Tier';
      planPill.className = 'plan-pill free';
    }
  }
}

// --- NAVIGATION & VIEW SWITCHING ---
// View changes are reflected in the History API (pushState/replaceState +
// a popstate listener) so that the browser Back/Forward buttons move
// between in-app views instead of leaving the site. Every top-level view
// (view-landing, view-dashboard, view-wizard, view-studio, view-pricing,
// view-profile) gets its own history entry, keyed by a `folioView` field
// on history.state and mirrored in the URL hash for reload/deep-link safety.
const FOLIO_VALID_VIEWS = [
  'view-landing', 'view-dashboard', 'view-wizard',
  'view-studio', 'view-pricing', 'view-profile',
];
// Views that require a signed-in user - guards a direct/reloaded #hash
// link the same way the nav tabs are already hidden for logged-out users.
const FOLIO_AUTH_VIEWS = ['view-dashboard', 'view-studio', 'view-profile'];

function initNavigation() {
  const navTabs = document.querySelectorAll('.nav-tab');
  const brandBtn = document.getElementById('nav-brand-btn');

  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetView = tab.dataset.target;
      switchView(targetView);
    });
  });

  if (brandBtn) {
    brandBtn.addEventListener('click', () => switchView('view-landing'));
  }

  // Hero CTAs
  const btnHeroLaunch = document.getElementById('btn-hero-launch');
  const btnHeroWizard = document.getElementById('btn-hero-wizard');

  if (btnHeroLaunch) {
    btnHeroLaunch.addEventListener('click', () => {
      if (!state.token) {
        openAuthModal('login');
      } else {
        switchView('view-dashboard');
      }
    });
  }

  if (btnHeroWizard) {
    btnHeroWizard.addEventListener('click', () => switchView('view-wizard'));
  }

  initHistoryNavigation();
}

// Establishes the initial history entry and wires up Back/Forward handling.
function initHistoryNavigation() {
  // The markup always starts on view-landing (see index.html), so the very
  // first history entry should describe that, not be state-less. Using
  // replaceState (not pushState) here means this doesn't add an extra step
  // Back has to move through - it just labels the entry the browser already
  // created when the page loaded.
  let initialView = getViewIdFromLocation() || 'view-landing';
  if (FOLIO_AUTH_VIEWS.includes(initialView) && !state.token) {
    initialView = 'view-landing';
  }
  history.replaceState({ folioView: initialView }, '', `#${initialView}`);
  if (initialView !== 'view-landing') {
    // Reflect a deep-linked/reloaded hash (e.g. reloading on #view-pricing)
    // in the actual UI, without pushing a new history entry for it.
    switchView(initialView, { pushState: false });
  }

  window.addEventListener('popstate', (event) => {
    let viewId = (event.state && event.state.folioView) || getViewIdFromLocation() || 'view-landing';
    if (FOLIO_AUTH_VIEWS.includes(viewId) && !state.token) {
      viewId = 'view-landing';
    }
    switchView(viewId, { pushState: false });
  });
}

function getViewIdFromLocation() {
  const hash = window.location.hash.replace('#', '');
  return FOLIO_VALID_VIEWS.includes(hash) ? hash : null;
}

function switchView(viewId, options = {}) {
  const { pushState = true } = options;

  if (!FOLIO_VALID_VIEWS.includes(viewId)) return;

  const panes = document.querySelectorAll('.view-pane');
  const navTabs = document.querySelectorAll('.nav-tab');
  const currentView = document.querySelector('.view-pane.active')?.id;

  panes.forEach(pane => pane.classList.remove('active'));
  navTabs.forEach(tab => tab.classList.remove('active'));

  const activePane = document.getElementById(viewId);
  const activeTab = document.querySelector(`.nav-tab[data-target="${viewId}"]`);

  if (activePane) activePane.classList.add('active');
  if (activeTab) activeTab.classList.add('active');

  // Record the navigation in browser history so Back/Forward can retrace
  // it. Skip this when we're already responding to a popstate event
  // (pushState: false), and skip no-op re-selections of the current view
  // so clicking the same nav tab twice doesn't pile up duplicate entries.
  if (pushState && viewId !== currentView) {
    history.pushState({ folioView: viewId }, '', `#${viewId}`);
  }

  if (viewId === 'view-dashboard') {
    loadDashboardResumes();
  }
  if (viewId === 'view-wizard') {
    autofillWizardUserProfile();
  }
  if (viewId === 'view-studio') {
    renderStudioFormValues();
    renderPaperCanvas();
  }
  if (viewId === 'view-profile') {
    loadUserProfile();
  }
}

// --- AUTHENTICATION MODAL & LOGIC ---
function initAuth() {
  const modal = document.getElementById('auth-modal');
  const btnOpenLogin = document.getElementById('btn-open-login');
  const btnOpenRegister = document.getElementById('btn-open-register');
  const btnClose = document.getElementById('btn-close-auth-modal');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');
  const btnLogout = document.getElementById('btn-logout');

  if (btnOpenLogin) btnOpenLogin.addEventListener('click', () => openAuthModal('login'));
  if (btnOpenRegister) btnOpenRegister.addEventListener('click', () => openAuthModal('register'));
  if (btnClose) btnClose.addEventListener('click', closeAuthModal);

  if (tabLogin) {
    tabLogin.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      formLogin.classList.add('active');
      formRegister.classList.remove('active');
    });
  }

  if (tabRegister) {
    tabRegister.addEventListener('click', () => {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      formRegister.classList.add('active');
      formLogin.classList.remove('active');
    });
  }

  // Handle Login Submit
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      const res = await apiCall('/auth/login', 'POST', { email, password });
      if (res && res.success && res.data) {
        state.token = res.data.token;
        state.user = res.data.user;
        localStorage.setItem('folio_jwt_token', state.token);
        localStorage.setItem('folio_user_profile', JSON.stringify(state.user));

        closeAuthModal();
        updateUserInterface();
        showToast('Welcome back! Signed in successfully.', 'success');
        switchView('view-dashboard');
      } else if (res && res.details && res.details.email_verification_required) {
        state.pendingVerificationEmail = res.details.email || email;
        closeAuthModal();
        showToast('Please verify your email first — we sent you a fresh code.', 'error');
        openVerifyModal();
      } else {
        showToast((res && res.error) || 'Invalid credentials.', 'error');
      }
    });
  }

  // Live password strength hint
  const regPasswordInput = document.getElementById('reg-password');
  if (regPasswordInput) {
    regPasswordInput.addEventListener('input', () => {
      updatePasswordStrengthHint(regPasswordInput.value);
    });
  }

  // Handle Register Submit
  if (formRegister) {
    formRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('reg-name').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;

      if (!isStrongPassword(password)) {
        showToast('Password must have 8+ characters, an uppercase letter, a lowercase letter, a number, and a special character.', 'error');
        updatePasswordStrengthHint(password);
        return;
      }

      const res = await apiCall('/auth/register', 'POST', { name, email, password });
      if (res && res.success && res.data) {
        // No token yet on purpose - registration no longer starts a session.
        // Verifying the emailed code is what logs them in (see form-verify-otp).
        state.pendingVerificationEmail = res.data.user.email;
        closeAuthModal();
        showToast('Account created! Enter the code we emailed you to finish signing in.', 'success');
        openVerifyModal();
      } else {
        showToast((res && res.error) || 'Registration failed.', 'error');
      }
    });
  }

  if (btnLogout) btnLogout.addEventListener('click', handleLogout);
}

function openAuthModal(mode = 'login') {
  const modal = document.getElementById('auth-modal');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');

  if (!modal) return;
  modal.classList.add('active');

  if (mode === 'login') {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    formLogin.classList.add('active');
    formRegister.classList.remove('active');
  } else {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    formRegister.classList.add('active');
    formLogin.classList.remove('active');
  }
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.remove('active');
}

// --- EMAIL VERIFICATION (OTP) ---
let resendCooldownTimer = null;

function openVerifyModal(emailToVerify = null) {
  const modal = document.getElementById('verify-modal');
  if (!modal) return;
  if (emailToVerify) {
    state.pendingVerificationEmail = emailToVerify;
    localStorage.setItem('folio_pending_verify_email', emailToVerify);
  }
  const target = document.getElementById('verify-email-target');
  const email = state.pendingVerificationEmail || localStorage.getItem('folio_pending_verify_email') || (state.user && state.user.email);
  if (target) target.textContent = email || 'your email';
  const input = document.getElementById('verify-otp-input');
  if (input) { input.value = ''; }
  modal.classList.add('active');
  if (input) input.focus();
}

function closeVerifyModal() {
  const modal = document.getElementById('verify-modal');
  if (modal) modal.classList.remove('active');
}

function startResendCooldown(seconds) {
  const link = document.getElementById('btn-resend-otp');
  const note = document.getElementById('resend-cooldown-note');
  if (!link || !note) return;

  clearInterval(resendCooldownTimer);
  let remaining = seconds;
  link.classList.add('disabled-link');
  note.textContent = `(wait ${remaining}s)`;

  resendCooldownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(resendCooldownTimer);
      link.classList.remove('disabled-link');
      note.textContent = '';
    } else {
      note.textContent = `(wait ${remaining}s)`;
    }
  }, 1000);
}

// --- FORGOT PASSWORD ---
let forgotResendCooldownTimer = null;
let forgotPasswordEmail = null;

function openForgotPasswordModal() {
  const modal = document.getElementById('forgot-password-modal');
  if (!modal) return;

  const stepRequest = document.getElementById('form-forgot-request');
  const stepReset = document.getElementById('form-forgot-reset');
  if (stepRequest) stepRequest.classList.add('active');
  if (stepReset) stepReset.classList.remove('active');

  const emailInput = document.getElementById('forgot-email-input');
  if (emailInput) emailInput.value = '';
  const otpInput = document.getElementById('forgot-otp-input');
  if (otpInput) otpInput.value = '';
  const pwInput = document.getElementById('forgot-new-password');
  if (pwInput) pwInput.value = '';

  forgotPasswordEmail = null;
  modal.classList.add('active');
  if (emailInput) emailInput.focus();
}

function closeForgotPasswordModal() {
  const modal = document.getElementById('forgot-password-modal');
  if (modal) modal.classList.remove('active');
  clearInterval(forgotResendCooldownTimer);
}

function goToForgotStep2(email) {
  forgotPasswordEmail = email;
  const stepRequest = document.getElementById('form-forgot-request');
  const stepReset = document.getElementById('form-forgot-reset');
  if (stepRequest) stepRequest.classList.remove('active');
  if (stepReset) stepReset.classList.add('active');

  const target = document.getElementById('forgot-email-target');
  if (target) target.textContent = email;
  const otpInput = document.getElementById('forgot-otp-input');
  if (otpInput) { otpInput.value = ''; otpInput.focus(); }
}

function startForgotResendCooldown(seconds) {
  const link = document.getElementById('btn-resend-forgot-otp');
  const note = document.getElementById('forgot-resend-cooldown-note');
  if (!link || !note) return;

  clearInterval(forgotResendCooldownTimer);
  let remaining = seconds;
  link.classList.add('disabled-link');
  note.textContent = `(wait ${remaining}s)`;

  forgotResendCooldownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(forgotResendCooldownTimer);
      link.classList.remove('disabled-link');
      note.textContent = '';
    } else {
      note.textContent = `(wait ${remaining}s)`;
    }
  }, 1000);
}

function initForgotPassword() {
  const modal = document.getElementById('forgot-password-modal');
  const btnOpen = document.getElementById('btn-open-forgot-password');
  const btnClose = document.getElementById('btn-close-forgot-modal');
  const formRequest = document.getElementById('form-forgot-request');
  const formReset = document.getElementById('form-forgot-reset');
  const btnResend = document.getElementById('btn-resend-forgot-otp');
  const newPasswordInput = document.getElementById('forgot-new-password');

  if (btnOpen) {
    btnOpen.addEventListener('click', (e) => {
      e.preventDefault();
      closeAuthModal();
      openForgotPasswordModal();
    });
  }
  if (btnClose) btnClose.addEventListener('click', closeForgotPasswordModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeForgotPasswordModal();
    });
  }

  if (newPasswordInput) {
    newPasswordInput.addEventListener('input', () => {
      updatePasswordStrengthHint(newPasswordInput.value, 'forgot-password-hint');
    });
  }

  if (formRequest) {
    formRequest.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgot-email-input').value.trim();
      if (!email) return;

      const res = await apiCall('/auth/forgot-password', 'POST', { email });
      if (res && res.success) {
        showToast('A reset code has been sent to your email.', 'success');
        goToForgotStep2(email);
        startForgotResendCooldown(60);
      } else {
        showToast((res && res.error) || 'Could not send reset code.', 'error');
      }
    });
  }

  if (formReset) {
    formReset.addEventListener('submit', async (e) => {
      e.preventDefault();
      const otp = document.getElementById('forgot-otp-input').value.trim();
      const newPassword = document.getElementById('forgot-new-password').value;

      if (!/^\d{6}$/.test(otp)) {
        showToast('Enter the 6-digit code from your email.', 'error');
        return;
      }
      if (!isStrongPassword(newPassword)) {
        showToast('Password must have 8+ characters, an uppercase letter, a lowercase letter, a number, and a special character.', 'error');
        updatePasswordStrengthHint(newPassword, 'forgot-password-hint');
        return;
      }
      if (!forgotPasswordEmail) {
        showToast('Something went wrong — please start over.', 'error');
        openForgotPasswordModal();
        return;
      }

      const res = await apiCall('/auth/reset-password', 'POST', {
        email: forgotPasswordEmail, otp, new_password: newPassword,
      });
      if (res && res.success && res.data) {
        state.token = res.data.token;
        state.user = res.data.user;
        localStorage.setItem('folio_jwt_token', state.token);
        localStorage.setItem('folio_user_profile', JSON.stringify(state.user));

        closeForgotPasswordModal();
        updateUserInterface();
        showToast('Password reset! You\'re signed in.', 'success');
        switchView('view-dashboard');
      } else {
        showToast((res && res.error) || 'Password reset failed.', 'error');
      }
    });
  }

  if (btnResend) {
    btnResend.addEventListener('click', async (e) => {
      e.preventDefault();
      if (btnResend.classList.contains('disabled-link') || !forgotPasswordEmail) return;

      const res = await apiCall('/auth/forgot-password', 'POST', { email: forgotPasswordEmail });
      if (res && res.success) {
        showToast('A new reset code has been sent.', 'success');
        startForgotResendCooldown(60);
      } else {
        showToast((res && res.error) || 'Could not resend code.', 'error');
      }
    });
  }
}

function initVerifyModal() {
  const modal = document.getElementById('verify-modal');
  const btnClose = document.getElementById('btn-close-verify-modal');
  const btnOpenFromBanner = document.getElementById('btn-open-verify-banner');
  const form = document.getElementById('form-verify-otp');
  const btnResend = document.getElementById('btn-resend-otp');

  if (btnClose) btnClose.addEventListener('click', closeVerifyModal);
  if (btnOpenFromBanner) btnOpenFromBanner.addEventListener('click', () => openVerifyModal());
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeVerifyModal();
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const otpInput = document.getElementById('verify-otp-input');
      const otp = (otpInput.value || '').trim();
      const email = state.pendingVerificationEmail || localStorage.getItem('folio_pending_verify_email') || (state.user && state.user.email);
      if (!email) {
        showToast('Missing email — please register or log in again.', 'error');
        return;
      }
      if (!/^\d{6}$/.test(otp)) {
        showToast('Enter the 6-digit code from your email.', 'error');
        return;
      }

      const res = await apiCall('/auth/verify-email', 'POST', { email, otp });
      if (res && res.success && res.data) {
        // Verification is what creates the session now.
        state.token = res.data.token;
        state.user = res.data.user;
        state.pendingVerificationEmail = null;
        localStorage.removeItem('folio_pending_verify_email');
        localStorage.setItem('folio_jwt_token', state.token);
        localStorage.setItem('folio_user_profile', JSON.stringify(state.user));

        updateUserInterface();
        closeVerifyModal();
        showToast('Email verified! You\'re signed in.', 'success');
        switchView('view-dashboard');
      } else {
        showToast((res && res.error) || 'Verification failed.', 'error');
      }
    });
  }

  if (btnResend) {
    btnResend.addEventListener('click', async (e) => {
      e.preventDefault();
      if (btnResend.classList.contains('disabled-link')) return;
      const email = state.pendingVerificationEmail || localStorage.getItem('folio_pending_verify_email') || (state.user && state.user.email);
      if (!email) {
        showToast('Missing email — please register or log in again.', 'error');
        return;
      }

      const res = await apiCall('/auth/resend-verification', 'POST', { email });
      if (res && res.success) {
        if (res.data && res.data.already_verified) {
          showToast('Your email is already verified! Please sign in.', 'info');
          closeVerifyModal();
          openAuthModal('login');
          return;
        }
        showToast('A new verification code has been sent to your email.', 'success');
        startResendCooldown(60);
      } else {
        if (res && res.details && res.details.wait_seconds) {
          startResendCooldown(res.details.wait_seconds);
        }
        showToast((res && res.error) || 'Could not resend code.', 'error');
      }
    });
  }
}

// --- SHOW/HIDE PASSWORD ---
function initPasswordVisibilityToggles() {
  document.querySelectorAll('.toggle-password-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;
      const nowShowing = input.type === 'password';
      input.type = nowShowing ? 'text' : 'password';
      btn.textContent = nowShowing ? '🙈' : '👁️';
      btn.setAttribute('aria-label', nowShowing ? 'Hide password' : 'Show password');
    });
  });
}

// --- PASSWORD STRENGTH (mirrors backend rule in app/utils/validators.py) ---
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]).{8,}$/;

function isStrongPassword(password) {
  return PASSWORD_PATTERN.test(password || '');
}

function updatePasswordStrengthHint(password, hintId = 'reg-password-hint') {
  const hint = document.getElementById(hintId);
  if (!hint) return;

  const checks = {
    length: (password || '').length >= 8,
    upper: /[A-Z]/.test(password || ''),
    lower: /[a-z]/.test(password || ''),
    digit: /\d/.test(password || ''),
    special: /[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/.test(password || ''),
  };

  const allGood = Object.values(checks).every(Boolean);
  hint.className = allGood ? 'password-hint valid' : 'password-hint';
  hint.innerHTML = [
    ['length', '8+ characters'],
    ['upper', 'Uppercase letter'],
    ['lower', 'Lowercase letter'],
    ['digit', 'Number'],
    ['special', 'Special character'],
  ].map(([key, label]) => `<span class="${checks[key] ? 'ok' : ''}">${checks[key] ? '✓' : '•'} ${label}</span>`).join(' ');
}

function handleLogout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('folio_jwt_token');
  localStorage.removeItem('folio_user_profile');
  updateUserInterface();
  showToast('Signed out.', 'info');
  switchView('view-landing');
}

// --- GOOGLE SIGN-IN ---
function initGoogleSignIn() {
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('your_google_oauth_client_id')) {
    // No client ID configured yet - hide the slots instead of showing a broken button.
    ['google-signin-btn-login', 'google-signin-btn-register'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<p class="field-note">Google Sign-In not configured yet.</p>';
    });
    return;
  }

  const tryInit = () => {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      return setTimeout(tryInit, 200); // GSI script may still be loading
    }
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredentialResponse,
    });
    ['google-signin-btn-login', 'google-signin-btn-register'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        window.google.accounts.id.renderButton(el, {
          theme: 'outline', size: 'large', width: 280, text: 'continue_with',
        });
      }
    });
  };
  tryInit();
}

async function handleGoogleCredentialResponse(response) {
  const res = await apiCall('/auth/google', 'POST', { id_token: response.credential });

  if (res && res.success && res.data) {
    _applySocialAuthSession(res.data, 'Google');
  } else {
    showToast((res && res.error) || 'Google Sign-In failed.', 'error');
  }
}

function _applySocialAuthSession(data, providerLabel) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem('folio_jwt_token', state.token);
  localStorage.setItem('folio_user_profile', JSON.stringify(state.user));

  closeAuthModal();
  updateUserInterface();
  showToast(`Welcome, ${state.user.name}!`, 'success');
  switchView('view-dashboard');
}

// --- GITHUB SIGN-IN (redirect-based OAuth) ---
// Unlike Google (client-side ID-token verification), GitHub doesn't offer
// a JS SDK for this, so the button does a full browser navigation to the
// backend, which redirects to the provider, then back.
function initSocialAuthButtons() {
  document.querySelectorAll('.social-auth-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const provider = btn.dataset.provider; // 'github'
      if (!provider) return;
      window.location.href = `${API_BASE}/auth/${provider}`;
    });
  });
}

// Called once on page load. After GitHub redirect back, the URL
// carries either ?social_auth=<one-time code> (success) or
// ?social_auth_error=<message> (cancelled/failed) - see auth_routes.py.
async function handleSocialAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('social_auth');
  const error = params.get('social_auth_error');

  if (!code && !error) return;

  // Strip these params from the URL immediately so the code can't be
  // reused (it's one-time/60s anyway) and the URL isn't left bookmarkable.
  params.delete('social_auth');
  params.delete('social_auth_error');
  const cleanUrl = window.location.pathname + (params.toString() ? `?${params}` : '') + window.location.hash;
  // Preserve the existing history.state (in particular `folioView`, set up
  // by initHistoryNavigation) - this call is only meant to strip the
  // one-time auth params from the URL, not to reset navigation state.
  window.history.replaceState(window.history.state || {}, document.title, cleanUrl);

  if (error) {
    showToast(error, 'error');
    return;
  }

  const res = await apiCall('/auth/exchange', 'POST', { code });
  if (res && res.success && res.data) {
    _applySocialAuthSession(res.data);
  } else {
    showToast((res && res.error) || 'Sign-in failed. Please try again.', 'error');
  }
}

// --- USER DASHBOARD ---
function initDashboard() {
  const btnCreate = document.getElementById('btn-dash-create');
  const btnWizard = document.getElementById('btn-dash-wizard');
  const btnEmptyCreate = document.getElementById('btn-empty-create');
  const btnStatUpgrade = document.getElementById('btn-stat-upgrade');

  if (btnCreate) btnCreate.addEventListener('click', createNewBlankResume);
  if (btnEmptyCreate) btnEmptyCreate.addEventListener('click', createNewBlankResume);
  if (btnWizard) btnWizard.addEventListener('click', () => switchView('view-wizard'));
  if (btnStatUpgrade) {
    btnStatUpgrade.addEventListener('click', () => {
      if (!state.token) return openAuthModal('login');
      openPaymentModal();
    });
  }
}

async function loadDashboardResumes() {
  if (!state.token) return;
  updateUserInterface();

  const res = await apiCall('/resumes', 'GET');
  const grid = document.getElementById('resumes-list-grid');
  const countLbl = document.getElementById('gallery-count-lbl');
  const statCount = document.getElementById('stat-resume-count');
  const statAts = document.getElementById('stat-ats-remaining');

  if (res && res.success && res.data && res.data.resumes) {
    state.resumes = res.data.resumes;
    if (statCount) statCount.textContent = state.resumes.length;
    if (countLbl) countLbl.textContent = `${state.resumes.length} document${state.resumes.length === 1 ? '' : 's'}`;

    if (state.user) {
      const remaining = state.user.plan === 'premium' ? '∞' : Math.max(0, 3 - (state.user.ats_checks_used || 0));
      if (statAts) statAts.textContent = remaining;
    }

    renderResumesGrid(state.resumes);
  }
}

function renderResumesGrid(resumesList) {
  const grid = document.getElementById('resumes-list-grid');
  if (!grid) return;

  if (!resumesList || resumesList.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-icon">📁</div>
        <h4>No Resumes Created Yet</h4>
        <p>Get started by creating a new blank resume or using our guided AI generator wizard.</p>
        <button class="btn btn-primary btn-sm" onclick="createNewBlankResume()">Create Your First Resume</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = resumesList.map(r => {
    const scoreVal = r.ats_score !== null && r.ats_score !== undefined ? r.ats_score : null;
    let scorePill = '<span class="ats-score-pill none">Unchecked</span>';
    if (scoreVal !== null) {
      const cls = scoreVal >= 80 ? 'high' : 'mid';
      scorePill = `<span class="ats-score-pill ${cls}">ATS: ${scoreVal}/100</span>`;
    }

    const updatedDate = r.updated_at ? new Date(r.updated_at).toLocaleDateString() : 'Recently';

    return `
      <div class="resume-card">
        <div class="resume-card-header">
          <div>
            <div class="resume-card-title">${r.title || 'Untitled Resume'}</div>
            <div class="resume-card-target">${r.target_job_title || 'General Position'}</div>
          </div>
          ${scorePill}
        </div>
        <div class="resume-card-footer">
          <span class="card-date">Updated ${updatedDate}</span>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-outline btn-xs" onclick="openResumeInStudio('${r.id}')">Edit</button>
            <button class="btn btn-ghost btn-xs" onclick="openCoverLetterForResume('${r.id}')" title="Generate AI Cover Letter">✉️ Cover Letter</button>
            <button class="btn btn-ghost btn-xs" onclick="deleteResumeCard('${r.id}')" title="Delete">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.openCoverLetterForResume = async function(resumeId) {
  await openResumeInStudio(resumeId);
  const drawer = document.getElementById('studio-drawer-panel');
  if (drawer) drawer.classList.add('open');
  switchDrawerTab('cover');
};

async function createNewBlankResume() {
  const newResumePayload = {
    title: 'New Resume Draft',
    template_id: 'minimal',
    target_job_title: 'Full Stack Engineer',
    target_job_description: '',
    content: state.resumeData.content
  };

  const res = await apiCall('/resumes', 'POST', newResumePayload);
  if (res && res.success && res.data && res.data.resume) {
    showToast('Created new resume draft.', 'success');
    openResumeInStudio(res.data.resume.id);
  } else {
    showToast('Failed to create resume.', 'error');
  }
}

async function openResumeInStudio(id) {
  const res = await apiCall(`/resumes/${id}`, 'GET');
  if (res && res.success && res.data && res.data.resume) {
    const r = res.data.resume;
    state.activeResumeId = r.id;
    state.activeTemplate = r.template_id || 'minimal';
    state.resumeData = {
      title: r.title,
      template_id: r.template_id,
      target_job_title: r.target_job_title || '',
      target_job_description: r.target_job_description || '',
      content: r.content || {}
    };

    const studioTab = document.getElementById('nav-studio-tab');
    if (studioTab) studioTab.style.display = 'inline-block';

    // Pre-fill the shared Job Description box with anything saved on this
    // resume already, and start the AI Recruiter chat fresh for this resume.
    const jdBox = document.getElementById('cover-job-desc');
    if (jdBox) jdBox.value = state.resumeData.target_job_description || '';
    resetRecruiterChat();

    switchView('view-studio');
  } else {
    showToast('Could not load resume.', 'error');
  }
}

async function deleteResumeCard(id) {
  if (!confirm('Are you sure you want to delete this resume?')) return;
  const res = await apiCall(`/resumes/${id}`, 'DELETE');
  if (res && res.success) {
    showToast('Resume deleted.', 'info');
    loadDashboardResumes();
  }
}

function autofillWizardUserProfile() {
  const nameEl = document.getElementById('wiz-name');
  const emailEl = document.getElementById('wiz-email');
  const phoneEl = document.getElementById('wiz-phone');
  const locEl = document.getElementById('wiz-location');

  if (state.user) {
    if (nameEl && !nameEl.value) nameEl.value = state.user.name || '';
    if (emailEl && !emailEl.value) emailEl.value = state.user.email || '';
    if (phoneEl && !phoneEl.value) phoneEl.value = state.user.phone || '';
    if (locEl && !locEl.value) locEl.value = state.user.location || '';
  }
}

// --- AI GUIDED GENERATOR WIZARD ---
function initWizard() {
  const btnNext = document.getElementById('btn-wiz-next');
  const btnPrev = document.getElementById('btn-wiz-prev');
  const btnSubmit = document.getElementById('btn-wiz-submit');

  if (btnNext) btnNext.addEventListener('click', () => changeWizardStep(1));
  if (btnPrev) btnPrev.addEventListener('click', () => changeWizardStep(-1));
  if (btnSubmit) btnSubmit.addEventListener('click', submitAiWizard);
  autofillWizardUserProfile();
}

function changeWizardStep(dir) {
  state.wizardStep = Math.min(5, Math.max(1, state.wizardStep + dir));
  
  const steps = document.querySelectorAll('.wizard-step-content');
  const progressChips = document.querySelectorAll('.progress-step');
  const btnNext = document.getElementById('btn-wiz-next');
  const btnPrev = document.getElementById('btn-wiz-prev');
  const btnSubmit = document.getElementById('btn-wiz-submit');

  steps.forEach((s, idx) => {
    s.classList.toggle('active', idx + 1 === state.wizardStep);
  });

  progressChips.forEach((chip, idx) => {
    chip.classList.toggle('active', idx + 1 === state.wizardStep);
  });

  if (btnPrev) btnPrev.disabled = state.wizardStep === 1;

  if (state.wizardStep === 5) {
    if (btnNext) btnNext.style.display = 'none';
    if (btnSubmit) btnSubmit.style.display = 'inline-flex';
    updateWizardSummaryReview();
  } else {
    if (btnNext) btnNext.style.display = 'inline-flex';
    if (btnSubmit) btnSubmit.style.display = 'none';
  }
}

function updateWizardSummaryReview() {
  const nameVal = document.getElementById('wiz-name').value;
  const roleVal = document.getElementById('wiz-target-title').value;
  const skillsVal = document.getElementById('wiz-skills-list').value;

  const sumName = document.getElementById('wiz-sum-name');
  const sumRole = document.getElementById('wiz-sum-role');
  const sumSkills = document.getElementById('wiz-sum-skills');

  if (sumName) sumName.textContent = nameVal || 'Candidate';
  if (sumRole) sumRole.textContent = roleVal || 'General';
  if (sumSkills) sumSkills.textContent = skillsVal || 'None';
}

async function submitAiWizard() {
  const wizTpl = state.templatesById[(document.getElementById('wiz-template-select') || {}).value];
  if (wizTpl && wizTpl.is_premium && !(state.user && state.user.plan === 'premium')) {
    showToast(`👑 ${wizTpl.label} is a Premium template. Upgrade to use it.`, 'info');
    switchView('view-pricing');
    return;
  }
  const loadingBox = document.getElementById('wiz-ai-loading');
  if (loadingBox) loadingBox.style.display = 'block';

  const profile = {
    personal: {
      name: document.getElementById('wiz-name').value,
      email: document.getElementById('wiz-email').value,
      phone: document.getElementById('wiz-phone').value,
      location: document.getElementById('wiz-location').value,
      linkedin: document.getElementById('wiz-linkedin').value,
      portfolio: document.getElementById('wiz-portfolio').value
    },
    target_job_title: document.getElementById('wiz-target-title').value,
    summary_notes: document.getElementById('wiz-career-summary-notes').value,
    raw_experience: [
      {
        role: document.getElementById('wiz-exp-role').value,
        company: document.getElementById('wiz-exp-company').value,
        duration: document.getElementById('wiz-exp-duration').value,
        notes: document.getElementById('wiz-exp-notes').value
      }
    ],
    education: [
      {
        degree: document.getElementById('wiz-edu-degree').value,
        institution: document.getElementById('wiz-edu-inst').value,
        duration: document.getElementById('wiz-edu-duration').value,
        details: document.getElementById('wiz-edu-details').value
      }
    ],
    skills: document.getElementById('wiz-skills-list').value.split(',').map(s => s.trim()).filter(Boolean)
  };

  const targetRole = document.getElementById('wiz-target-title').value;
  const templateChoice = document.getElementById('wiz-template-select').value;

  const res = await apiCall('/ai/generate-resume', 'POST', {
    profile,
    target_job_title: targetRole
  });

  if (loadingBox) loadingBox.style.display = 'none';

  if (res && res.success && res.data) {
    const generatedContent = res.data.content || res.data.resume?.content || profile;

    // Create a new resume draft in backend with generated content
    const createRes = await apiCall('/resumes', 'POST', {
      title: `${profile.personal.name || 'AI'} - ${targetRole || 'Resume'}`,
      template_id: templateChoice,
      target_job_title: targetRole,
      content: generatedContent
    });

    if (createRes && createRes.success && createRes.data && createRes.data.resume) {
      showToast('AI Generated Resume successfully!', 'success');
      openResumeInStudio(createRes.data.resume.id);
    } else {
      // Offline / Fallback
      state.resumeData.content = generatedContent;
      state.activeTemplate = templateChoice;
      switchView('view-studio');
    }
  } else {
    showToast(res.error || 'AI generation failed. Loading draft template.', 'error');
    switchView('view-studio');
  }
}

// --- SPLIT-PANE RESUME STUDIO EDITOR ---
function initStudioEditor() {
  initStudioPhoto();
  // Title inline change
  const titleInput = document.getElementById('studio-resume-title');
  if (titleInput) {
    titleInput.addEventListener('input', (e) => {
      state.resumeData.title = e.target.value;
      triggerAutoSave();
    });
  }

  // Template select change
  const tplSelect = document.getElementById('studio-template-select');
  if (tplSelect) {
    tplSelect.addEventListener('change', (e) => {
      const chosenTpl = state.templatesById[e.target.value];
      if (chosenTpl && chosenTpl.is_premium && !(state.user && state.user.plan === 'premium')) {
        e.target.value = state.activeTemplate || 'minimal';
        showToast(`👑 ${chosenTpl.label} is a Premium template. Upgrade to unlock it.`, 'info');
        switchView('view-pricing');
        return;
      }
      state.activeTemplate = e.target.value;
      state.resumeData.template_id = e.target.value;
      renderPaperCanvas();
      triggerAutoSave();
    });
  }

  // Section Tab Navigation
  const secTabs = document.querySelectorAll('.editor-tab-btn');
  secTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      secTabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.editor-section-panel').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetSec = document.getElementById(tab.dataset.sec);
      if (targetSec) targetSec.classList.add('active');
    });
  });

  // Sync Input Events
  document.querySelectorAll('.sync-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const path = e.target.dataset.path;
      updateStateValueByPath(path, e.target.value);
      renderPaperCanvas();
      triggerAutoSave();
    });
  });

  // Back button
  const btnBack = document.getElementById('btn-studio-back');
  if (btnBack) btnBack.addEventListener('click', () => switchView('view-dashboard'));

  // PDF Download Button
  const btnPdf = document.getElementById('btn-studio-pdf-download');
  if (btnPdf) btnPdf.addEventListener('click', downloadResumePdf);

  // Zoom buttons
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const zoomVal = document.getElementById('zoom-val');

  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => {
      state.zoomLevel = Math.min(140, state.zoomLevel + 10);
      if (zoomVal) zoomVal.textContent = `${state.zoomLevel}%`;
      const canvas = document.getElementById('paper-render-canvas');
      if (canvas) canvas.style.transform = `scale(${state.zoomLevel / 100})`;
    });
  }

  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => {
      state.zoomLevel = Math.max(70, state.zoomLevel - 10);
      if (zoomVal) zoomVal.textContent = `${state.zoomLevel}%`;
      const canvas = document.getElementById('paper-render-canvas');
      if (canvas) canvas.style.transform = `scale(${state.zoomLevel / 100})`;
    });
  }

  // Summary AI Polish
  const btnSummaryPolish = document.getElementById('btn-ai-summary-improve');
  if (btnSummaryPolish) {
    btnSummaryPolish.addEventListener('click', async () => {
      const summaryText = state.resumeData.content.summary || '';
      if (!summaryText) return showToast('Please enter a summary first.', 'info');

      const res = await apiCall('/ai/improve-bullets', 'POST', {
        bullets: [summaryText],
        role_context: state.resumeData.target_job_title
      });

      if (res && res.success && res.data && res.data.bullets && res.data.bullets[0]) {
        state.resumeData.content.summary = res.data.bullets[0];
        document.getElementById('ed-summary').value = res.data.bullets[0];
        renderPaperCanvas();
        triggerAutoSave();
        showToast('Summary polished with AI!', 'success');
      } else {
        showToast(res.error || 'AI polish failed.', 'error');
      }
    });
  }

  // Repeater Buttons
  const btnAddExp = document.getElementById('btn-add-experience');
  const btnAddProj = document.getElementById('btn-add-project');
  const btnAddEdu = document.getElementById('btn-add-education');
  const btnAddCustomSection = document.getElementById('btn-add-custom-section');

  if (btnAddExp) btnAddExp.addEventListener('click', addExperienceItem);
  if (btnAddProj) btnAddProj.addEventListener('click', addProjectItem);
  if (btnAddEdu) btnAddEdu.addEventListener('click', addEducationItem);
  if (btnAddCustomSection) btnAddCustomSection.addEventListener('click', addCustomSection);
}

function updateStateValueByPath(path, value) {
  if (path === 'summary') {
    state.resumeData.content.summary = value;
  } else if (path.startsWith('personal.')) {
    const key = path.split('.')[1];
    if (!state.resumeData.content.personal) state.resumeData.content.personal = {};
    state.resumeData.content.personal[key] = value;
  } else if (path === 'skills_csv') {
    state.resumeData.content.skills = value.split(',').map(s => s.trim()).filter(Boolean);
  } else if (path === 'certs_lines') {
    state.resumeData.content.certifications = value.split('\n').map(s => s.trim()).filter(Boolean);
  } else if (path.startsWith('cv_lines:')) {
    const key = path.split(':')[1];
    state.resumeData.content[key] = value.split('\n').map(s => s.trim()).filter(Boolean);
  } else if (path === 'target_job_title') {
    state.resumeData.target_job_title = value;
  } else if (path === 'target_job_description') {
    state.resumeData.target_job_description = value;
  }
}

function renderStudioFormValues() {
  const c = state.resumeData.content || {};
  const p = c.personal || {};

  const titleInput = document.getElementById('studio-resume-title');
  if (titleInput) titleInput.value = state.resumeData.title || 'Untitled Resume';

  const tplSelect = document.getElementById('studio-template-select');
  if (tplSelect) tplSelect.value = state.activeTemplate || 'minimal';

  // Personal
  setValueIfElem('ed-name', p.name);
  setValueIfElem('ed-email', p.email);
  setValueIfElem('ed-phone', p.phone);
  setValueIfElem('ed-location', p.location);
  setValueIfElem('ed-linkedin', p.linkedin);
  setValueIfElem('ed-portfolio', p.portfolio);

  // Summary
  setValueIfElem('ed-summary', c.summary);

  // Skills & Certs
  setValueIfElem('ed-skills', (c.skills || []).join(', '));
  setValueIfElem('ed-certs', (c.certifications || []).join('\n'));

  // CV-only sections
  const cvFieldIds = {
    publications: 'ed-cv-publications',
    research_experience: 'ed-cv-research',
    teaching_experience: 'ed-cv-teaching',
    conferences: 'ed-cv-conferences',
    grants_fellowships: 'ed-cv-grants',
    awards_honors: 'ed-cv-awards',
    affiliations: 'ed-cv-affiliations',
    references: 'ed-cv-references',
  };
  CV_SECTIONS_META.forEach(([key]) => {
    setValueIfElem(cvFieldIds[key], (c[key] || []).join('\n'));
  });

  // Target Job
  setValueIfElem('ed-target-title', state.resumeData.target_job_title);
  setValueIfElem('ed-target-jd', state.resumeData.target_job_description);

  // Photo (auto-use the saved profile photo the first time, unless the user removed it)
  if (state.resumeData.content && !c.photo && !c.photo_declined) {
    const savedProfilePhoto = getProfilePhoto();
    if (savedProfilePhoto) {
      state.resumeData.content.photo = savedProfilePhoto;
      if (state.activeResumeId) triggerAutoSave();
    }
  }
  syncStudioPhotoUI();

  // Repeaters
  renderExperienceRepeater();
  renderProjectsRepeater();
  renderEducationRepeater();
  renderCustomSectionsRepeater();
}

function setValueIfElem(id, val) {
  const elem = document.getElementById(id);
  if (elem) elem.value = val || '';
}

// Repeater Item Handlers
function renderExperienceRepeater() {
  const container = document.getElementById('experience-items-container');
  if (!container) return;

  const exps = state.resumeData.content.experience || [];
  container.innerHTML = exps.map((exp, idx) => `
    <div class="repeater-card">
      <div class="repeater-card-header">
        <span class="repeater-card-title">Role #${idx + 1}</span>
        <button class="btn btn-ghost btn-xs" onclick="removeExperienceItem(${idx})">Remove</button>
      </div>
      <div class="form-grid dual">
        <div class="form-group">
          <label>Job Title</label>
          <input type="text" value="${exp.role || ''}" oninput="updateExpField(${idx}, 'role', this.value)">
        </div>
        <div class="form-group">
          <label>Company</label>
          <input type="text" value="${exp.company || ''}" oninput="updateExpField(${idx}, 'company', this.value)">
        </div>
      </div>
      <div class="form-group margin-top">
        <label>Duration</label>
        <input type="text" value="${exp.duration || ''}" oninput="updateExpField(${idx}, 'duration', this.value)">
      </div>
      <div class="form-group margin-top">
        <label>Bullet Points</label>
        ${(exp.bullets || ['']).map((bullet, bIdx) => `
          <div class="bullet-input-row">
            <textarea rows="2" oninput="updateExpBullet(${idx}, ${bIdx}, this.value)">${bullet}</textarea>
            <button class="btn btn-ghost btn-xs btn-sparkle" onclick="improveExpBullet(${idx}, ${bIdx})" title="AI Improve Bullet">✨</button>
          </div>
        `).join('')}
        <button class="btn btn-ghost btn-xs margin-top" onclick="addExpBullet(${idx})">+ Add Bullet</button>
      </div>
    </div>
  `).join('');
}

function addExperienceItem() {
  if (!state.resumeData.content.experience) state.resumeData.content.experience = [];
  state.resumeData.content.experience.push({
    role: 'Software Engineer',
    company: 'Company Name',
    duration: '2024 - Present',
    bullets: ['Designed and developed scalable software components.']
  });
  renderExperienceRepeater();
  renderPaperCanvas();
  triggerAutoSave();
}

function removeExperienceItem(idx) {
  state.resumeData.content.experience.splice(idx, 1);
  renderExperienceRepeater();
  renderPaperCanvas();
  triggerAutoSave();
}

function updateExpField(idx, field, val) {
  state.resumeData.content.experience[idx][field] = val;
  renderPaperCanvas();
  triggerAutoSave();
}

function updateExpBullet(expIdx, bIdx, val) {
  state.resumeData.content.experience[expIdx].bullets[bIdx] = val;
  renderPaperCanvas();
  triggerAutoSave();
}

function addExpBullet(expIdx) {
  state.resumeData.content.experience[expIdx].bullets.push('');
  renderExperienceRepeater();
}

async function improveExpBullet(expIdx, bIdx) {
  const currentBullet = state.resumeData.content.experience[expIdx].bullets[bIdx];
  if (!currentBullet) return showToast('Enter a bullet point first.', 'info');

  showToast('Improving bullet with AI...', 'info');
  const res = await apiCall('/ai/improve-bullets', 'POST', {
    bullets: [currentBullet],
    role_context: `${state.resumeData.content.experience[expIdx].role || ''} at ${state.resumeData.content.experience[expIdx].company || ''}`
  });

  if (res && res.success && res.data && res.data.bullets && res.data.bullets[0]) {
    state.resumeData.content.experience[expIdx].bullets[bIdx] = res.data.bullets[0];
    renderExperienceRepeater();
    renderPaperCanvas();
    triggerAutoSave();
    showToast('Bullet improved with AI!', 'success');
  } else {
    showToast(res.error || 'Could not improve bullet.', 'error');
  }
}

// Projects Repeater
function renderProjectsRepeater() {
  const container = document.getElementById('projects-items-container');
  if (!container) return;

  const projs = state.resumeData.content.projects || [];
  container.innerHTML = projs.map((proj, idx) => `
    <div class="repeater-card">
      <div class="repeater-card-header">
        <span class="repeater-card-title">Project #${idx + 1}</span>
        <button class="btn btn-ghost btn-xs" onclick="removeProjectItem(${idx})">Remove</button>
      </div>
      <div class="form-group">
        <label>Project Name</label>
        <input type="text" value="${proj.name || ''}" oninput="updateProjField(${idx}, 'name', this.value)">
      </div>
      <div class="form-group margin-top">
        <label>Tech Stack (Comma-separated)</label>
        <input type="text" value="${(proj.tech_stack || []).join(', ')}" oninput="updateProjTechStack(${idx}, this.value)">
      </div>
      <div class="form-group margin-top">
        <label>Description</label>
        <textarea rows="2" oninput="updateProjField(${idx}, 'description', this.value)">${proj.description || ''}</textarea>
      </div>
    </div>
  `).join('');
}

function addProjectItem() {
  if (!state.resumeData.content.projects) state.resumeData.content.projects = [];
  state.resumeData.content.projects.push({
    name: 'New Project',
    tech_stack: ['Python', 'Flask'],
    description: 'Developed a high-performance web service.'
  });
  renderProjectsRepeater();
  renderPaperCanvas();
  triggerAutoSave();
}

function removeProjectItem(idx) {
  state.resumeData.content.projects.splice(idx, 1);
  renderProjectsRepeater();
  renderPaperCanvas();
  triggerAutoSave();
}

function updateProjField(idx, field, val) {
  state.resumeData.content.projects[idx][field] = val;
  renderPaperCanvas();
  triggerAutoSave();
}

function updateProjTechStack(idx, val) {
  state.resumeData.content.projects[idx].tech_stack = val.split(',').map(s => s.trim()).filter(Boolean);
  renderPaperCanvas();
  triggerAutoSave();
}

// Education Repeater
function renderEducationRepeater() {
  const container = document.getElementById('education-items-container');
  if (!container) return;

  const edus = state.resumeData.content.education || [];
  container.innerHTML = edus.map((edu, idx) => `
    <div class="repeater-card">
      <div class="repeater-card-header">
        <span class="repeater-card-title">Education #${idx + 1}</span>
        <button class="btn btn-ghost btn-xs" onclick="removeEducationItem(${idx})">Remove</button>
      </div>
      <div class="form-grid dual">
        <div class="form-group">
          <label>Degree</label>
          <input type="text" value="${edu.degree || ''}" oninput="updateEduField(${idx}, 'degree', this.value)">
        </div>
        <div class="form-group">
          <label>Institution</label>
          <input type="text" value="${edu.institution || ''}" oninput="updateEduField(${idx}, 'institution', this.value)">
        </div>
      </div>
      <div class="form-grid dual margin-top">
        <div class="form-group">
          <label>Duration / Year</label>
          <input type="text" value="${edu.duration || ''}" oninput="updateEduField(${idx}, 'duration', this.value)">
        </div>
        <div class="form-group">
          <label>Details / GPA</label>
          <input type="text" value="${edu.details || ''}" oninput="updateEduField(${idx}, 'details', this.value)">
        </div>
      </div>
    </div>
  `).join('');
}

function addEducationItem() {
  if (!state.resumeData.content.education) state.resumeData.content.education = [];
  state.resumeData.content.education.push({
    degree: 'B.Tech in Computer Science',
    institution: 'University Name',
    duration: '2022 - 2026',
    details: 'CGPA: 8.5/10'
  });
  renderEducationRepeater();
  renderPaperCanvas();
  triggerAutoSave();
}

function removeEducationItem(idx) {
  state.resumeData.content.education.splice(idx, 1);
  renderEducationRepeater();
  renderPaperCanvas();
  triggerAutoSave();
}

function updateEduField(idx, field, val) {
  state.resumeData.content.education[idx][field] = val;
  renderPaperCanvas();
  triggerAutoSave();
}

// Custom Sections Repeater
function renderCustomSectionsRepeater() {
  const container = document.getElementById('custom-sections-container');
  if (!container) return;

  const sections = state.resumeData.content.custom_sections || [];
  if (sections.length === 0) {
    container.innerHTML = `<p class="field-hint" style="font-size:0.8rem; color:var(--text-muted);">No custom sections yet. Click "+ Add Custom Section" above to add one.</p>`;
    return;
  }

  container.innerHTML = sections.map((sec, idx) => `
    <div class="repeater-card">
      <div class="repeater-card-header">
        <span class="repeater-card-title">${sec.title || `Custom Section #${idx + 1}`}</span>
        <button class="btn btn-ghost btn-xs" onclick="removeCustomSection(${idx})">Remove</button>
      </div>
      <div class="form-group">
        <label>Section Heading</label>
        <input type="text" value="${sec.title || ''}" placeholder="e.g. Key Achievements" oninput="updateCustomSectionField(${idx}, 'title', this.value)">
      </div>
      <div class="form-group margin-top">
        <label>Bullet Points</label>
        ${(sec.items && sec.items.length > 0 ? sec.items : ['']).map((item, iIdx) => `
          <div class="bullet-input-row">
            <textarea rows="2" oninput="updateCustomSectionItem(${idx}, ${iIdx}, this.value)">${item}</textarea>
            <button class="btn btn-ghost btn-xs" onclick="removeCustomSectionItem(${idx}, ${iIdx})" title="Remove line">✕</button>
          </div>
        `).join('')}
        <button class="btn btn-ghost btn-xs margin-top" onclick="addCustomSectionItem(${idx})">+ Add Line</button>
      </div>
    </div>
  `).join('');
}

function addCustomSection() {
  if (!state.resumeData.content.custom_sections) state.resumeData.content.custom_sections = [];
  state.resumeData.content.custom_sections.push({
    title: 'Key Achievements',
    items: ['']
  });
  renderCustomSectionsRepeater();
  renderPaperCanvas();
  triggerAutoSave();
}

function removeCustomSection(idx) {
  state.resumeData.content.custom_sections.splice(idx, 1);
  renderCustomSectionsRepeater();
  renderPaperCanvas();
  triggerAutoSave();
}

function updateCustomSectionField(idx, field, val) {
  state.resumeData.content.custom_sections[idx][field] = val;
  renderPaperCanvas();
  triggerAutoSave();
  // Card title label reflects the heading as you type without a full re-render.
  const header = document.querySelectorAll('#custom-sections-container .repeater-card-title')[idx];
  if (header && field === 'title') header.textContent = val || `Custom Section #${idx + 1}`;
}

function updateCustomSectionItem(secIdx, itemIdx, val) {
  state.resumeData.content.custom_sections[secIdx].items[itemIdx] = val;
  renderPaperCanvas();
  triggerAutoSave();
}

function addCustomSectionItem(secIdx) {
  state.resumeData.content.custom_sections[secIdx].items.push('');
  renderCustomSectionsRepeater();
}

function removeCustomSectionItem(secIdx, itemIdx) {
  state.resumeData.content.custom_sections[secIdx].items.splice(itemIdx, 1);
  if (state.resumeData.content.custom_sections[secIdx].items.length === 0) {
    state.resumeData.content.custom_sections[secIdx].items.push('');
  }
  renderCustomSectionsRepeater();
  renderPaperCanvas();
  triggerAutoSave();
}

// --- LIVE TACTILE PAPER CANVAS RENDERER ---
// Mirrors app/services/pdf_service.py: same 5 layout engines (single,
// compact, banner, timeline, sidebar_left/right), same accent/font/
// title-style/header-align params, same CV_SECTIONS -- so what's shown
// here matches the downloaded PDF.
function paperSectionHtml(title, innerHtml) {
  return `
    <div class="paper-section">
      <div class="paper-section-title">${title}</div>
      ${innerHtml}
    </div>
  `;
}

function paperSummaryHtml(c) {
  if (!c.summary) return '';
  return paperSectionHtml('Professional Summary', `<p class="paper-summary" style="font-size:0.85rem; line-height:1.4;">${c.summary}</p>`);
}

function paperExperienceHtml(c) {
  if (!c.experience || c.experience.length === 0) return '';
  return paperSectionHtml('Experience', c.experience.map(exp => `
    <div class="paper-item">
      <div class="paper-item-header">
        <span>${exp.role || ''} — ${exp.company || ''}</span>
        <span>${exp.duration || ''}</span>
      </div>
      ${exp.bullets && exp.bullets.length > 0 ? `
        <ul class="paper-bullets">
          ${exp.bullets.filter(Boolean).map(b => `<li>${b}</li>`).join('')}
        </ul>
      ` : ''}
    </div>
  `).join(''));
}

function paperProjectsHtml(c) {
  if (!c.projects || c.projects.length === 0) return '';
  return paperSectionHtml('Projects', c.projects.map(proj => `
    <div class="paper-item">
      <div class="paper-item-header">
        <span>${proj.name || ''}</span>
        ${proj.tech_stack && proj.tech_stack.length > 0 ? `<span style="font-size:0.8rem; font-style:italic;">${proj.tech_stack.join(', ')}</span>` : ''}
      </div>
      ${proj.description ? `<p style="font-size:0.85rem;">${proj.description}</p>` : ''}
      ${proj.bullets && proj.bullets.length > 0 ? `
        <ul class="paper-bullets">
          ${proj.bullets.filter(Boolean).map(b => `<li>${b}</li>`).join('')}
        </ul>
      ` : ''}
    </div>
  `).join(''));
}

function paperEducationHtml(c) {
  if (!c.education || c.education.length === 0) return '';
  return paperSectionHtml('Education', c.education.map(edu => `
    <div class="paper-item">
      <div class="paper-item-header">
        <span>${edu.degree || ''}</span>
        <span>${edu.duration || ''}</span>
      </div>
      <div class="paper-item-sub">
        <span>${edu.institution || ''}</span>
        <span>${edu.details || ''}</span>
      </div>
    </div>
  `).join(''));
}

function paperSkillsHtml(c) {
  if (!c.skills || c.skills.length === 0) return '';
  return paperSectionHtml('Skills', `<p style="font-size:0.85rem;">${c.skills.join(' • ')}</p>`);
}

function paperCertificationsHtml(c) {
  if (!c.certifications || c.certifications.length === 0) return '';
  return paperSectionHtml('Certifications', `
    <ul class="paper-bullets">
      ${c.certifications.map(cert => `<li>${cert}</li>`).join('')}
    </ul>
  `);
}

// Renders one CV-only section (publications, research_experience, etc.)
// if its content array is non-empty. Items may be plain strings.
function paperCvSectionHtml(c, key, title) {
  const items = c[key];
  if (!items || items.length === 0) return '';
  return paperSectionHtml(title, `
    <ul class="paper-bullets">
      ${items.map(item => `<li>${typeof item === 'string' ? item : (item.title || item.name || '')}</li>`).join('')}
    </ul>
  `);
}

function paperAllCvSectionsHtml(c, skipKeys = []) {
  return CV_SECTIONS_META
    .filter(([key]) => !skipKeys.includes(key))
    .map(([key, title]) => paperCvSectionHtml(c, key, title))
    .join('');
}

// --- A4 PAGE FLOW: per-item HTML for repeatable entries, used to build
// pagination "blocks" below (kept separate from paperExperienceHtml etc.
// so those whole-section helpers are untouched). ---
function paperExperienceItemHtml(exp) {
  return `
    <div class="paper-item">
      <div class="paper-item-header">
        <span>${exp.role || ''} — ${exp.company || ''}</span>
        <span>${exp.duration || ''}</span>
      </div>
      ${exp.bullets && exp.bullets.length > 0 ? `
        <ul class="paper-bullets">
          ${exp.bullets.filter(Boolean).map(b => `<li>${b}</li>`).join('')}
        </ul>
      ` : ''}
    </div>
  `;
}

function paperProjectItemHtml(proj) {
  return `
    <div class="paper-item">
      <div class="paper-item-header">
        <span>${proj.name || ''}</span>
        ${proj.tech_stack && proj.tech_stack.length > 0 ? `<span style="font-size:0.8rem; font-style:italic;">${proj.tech_stack.join(', ')}</span>` : ''}
      </div>
      ${proj.description ? `<p style="font-size:0.85rem;">${proj.description}</p>` : ''}
      ${proj.bullets && proj.bullets.length > 0 ? `
        <ul class="paper-bullets">
          ${proj.bullets.filter(Boolean).map(b => `<li>${b}</li>`).join('')}
        </ul>
      ` : ''}
    </div>
  `;
}

function paperEducationItemHtml(edu) {
  return `
    <div class="paper-item">
      <div class="paper-item-header">
        <span>${edu.degree || ''}</span>
        <span>${edu.duration || ''}</span>
      </div>
      <div class="paper-item-sub">
        <span>${edu.institution || ''}</span>
        <span>${edu.details || ''}</span>
      </div>
    </div>
  `;
}

function paperCustomSectionItemHtml(item) {
  return `<ul class="paper-bullets"><li>${item}</li></ul>`;
}

// Pushes one block per non-empty custom section, reusing the same
// title-glued-to-first-item pattern as Experience/Projects/Education.
function pushCustomSectionFlowBlocks(blocks, customSections) {
  (customSections || []).forEach(sec => {
    const items = (sec.items || []).filter(Boolean);
    if (items.length === 0) return;
    pushRepeaterFlowBlocks(blocks, items, sec.title || 'Custom Section', paperCustomSectionItemHtml);
  });
}

// Pushes one block per repeater entry, keeping the section title glued to
// only the first entry so a title never ends up alone at a page bottom.
function pushRepeaterFlowBlocks(blocks, items, title, itemHtmlFn) {
  if (!items || items.length === 0) return;
  items.forEach((item, idx) => {
    const itemHtml = itemHtmlFn(item);
    blocks.push(idx === 0 ? paperSectionHtml(title, itemHtml) : `<div class="paper-section paper-section-continued">${itemHtml}</div>`);
  });
}

// Ordered, self-contained HTML blocks for the single-column layouts.
// Each entry is one top-level element so it can be measured and placed
// on a page independently by paginateFlowBlocks().
function buildMainFlowBlocks(c, headerHtml) {
  const blocks = [headerHtml];
  if (c.summary) {
    blocks.push(paperSectionHtml('Professional Summary', `<p class="paper-summary" style="font-size:0.85rem; line-height:1.4;">${c.summary}</p>`));
  }
  pushRepeaterFlowBlocks(blocks, c.experience, 'Experience', paperExperienceItemHtml);
  pushRepeaterFlowBlocks(blocks, c.projects, 'Projects', paperProjectItemHtml);
  pushRepeaterFlowBlocks(blocks, c.education, 'Education', paperEducationItemHtml);
  if (c.skills && c.skills.length > 0) blocks.push(paperSkillsHtml(c));
  if (c.certifications && c.certifications.length > 0) blocks.push(paperCertificationsHtml(c));
  CV_SECTIONS_META.forEach(([key, title]) => {
    const block = paperCvSectionHtml(c, key, title);
    if (block) blocks.push(block);
  });
  pushCustomSectionFlowBlocks(blocks, c.custom_sections);
  return blocks;
}

// Same flow, for the two-column sidebar layouts. Education is shown in
// the (repeating) sidebar itself, so it's left out of the main flow here.
function buildSidebarMainFlowBlocks(c) {
  const blocks = [];
  if (c.summary) {
    blocks.push(paperSectionHtml('Professional Summary', `<p class="paper-summary" style="font-size:0.85rem; line-height:1.4;">${c.summary}</p>`));
  }
  pushRepeaterFlowBlocks(blocks, c.experience, 'Experience', paperExperienceItemHtml);
  pushRepeaterFlowBlocks(blocks, c.projects, 'Projects', paperProjectItemHtml);
  CV_SECTIONS_META.forEach(([key, title]) => {
    if (key === 'affiliations') return;
    const block = paperCvSectionHtml(c, key, title);
    if (block) blocks.push(block);
  });
  pushCustomSectionFlowBlocks(blocks, c.custom_sections);
  return blocks;
}

let _mmToPxRatio = null;
function mmToPx(mm) {
  if (_mmToPxRatio === null) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute; visibility:hidden; left:-99999px; top:0; height:100mm; width:1px;';
    document.body.appendChild(probe);
    _mmToPxRatio = probe.getBoundingClientRect().height / 100;
    document.body.removeChild(probe);
  }
  return mm * _mmToPxRatio;
}

function getMeasureSandbox() {
  let el = document.getElementById('paper-measure-sandbox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'paper-measure-sandbox';
    el.style.cssText = 'position:absolute; visibility:hidden; left:-99999px; top:0; pointer-events:none; width:210mm;';
    document.body.appendChild(el);
  }
  return el;
}

// Splits `blocks` (an array of self-contained top-level HTML strings) into
// pages that each fit inside one printable A4 page. Renders them off-screen
// inside `shellHtml` (which must contain an element marked
// data-flow-target="1" for single-column shells, that IS the shell itself)
// and reads back real layout positions so the split matches true rendering,
// fonts, and template spacing.
function paginateFlowBlocks(blocks, sheetClassName, styleVars, shellHtml) {
  const nonEmpty = blocks.filter(Boolean);
  if (nonEmpty.length === 0) return [[]];

  const budgetPx = mmToPx(257); // 297mm page minus 20mm top/bottom padding
  const sandbox = getMeasureSandbox();
  sandbox.className = sheetClassName;
  sandbox.style.height = 'auto';
  sandbox.style.overflow = 'visible';
  Object.keys(styleVars).forEach(k => sandbox.style.setProperty(k, styleVars[k]));
  sandbox.innerHTML = shellHtml;
  const target = sandbox.querySelector('[data-flow-target]') || sandbox;
  target.innerHTML = nonEmpty.join('');

  const children = Array.from(target.children);
  const positions = children.map(el => ({
    top: el.offsetTop,
    bottom: el.offsetTop + el.getBoundingClientRect().height
  }));
  sandbox.innerHTML = '';

  const pages = [];
  let currentPage = [];
  let pageStartTop = null;
  positions.forEach((pos, i) => {
    if (pageStartTop === null) pageStartTop = pos.top;
    const relBottom = pos.bottom - pageStartTop;
    if (relBottom > budgetPx && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [i];
      pageStartTop = pos.top;
    } else {
      currentPage.push(i);
    }
  });
  if (currentPage.length > 0) pages.push(currentPage);

  return pages.map(idxArr => idxArr.map(i => nonEmpty[i]));
}

function renderPaperCanvas() {
  const container = document.getElementById('paper-render-canvas');
  if (!container) return;

  const templateId = state.activeTemplate || 'minimal';
  const tpl = state.templatesById[templateId] || { layout: 'single', accent: '#1E1E1E', font: 'Helvetica', category: 'resume' };
  const layout = tpl.layout || 'single';

  const sheetClassName = `a4-paper-sheet layout-${layout.replace('_', '-')} title-${tpl.title_style || 'underline'} header-${tpl.header_align || 'left'}`;
  const styleVars = {
    '--tpl-accent': tpl.accent || '#1E1E1E',
    '--tpl-font': tpl.font === 'Times' ? "'Newsreader', Georgia, serif" : (tpl.font === 'Courier' ? "'Courier New', monospace" : "Inter, Arial, sans-serif")
  };

  const c = state.resumeData.content || {};
  const p = c.personal || {};
  const contactBits = [p.email, p.phone, p.location, p.linkedin, p.portfolio].filter(Boolean);

  const photoLayouts = ['photo_header', 'creative_pro', 'executive_sidebar', 'fresher_pro'];
  const photoHtml = (tpl.supports_photo || photoLayouts.includes(layout)) ? paperPhotoHtml(c, p) : '';

  const headerHtml = `
    <div class="paper-header${photoHtml ? ' has-photo' : ''}">
      ${photoHtml}
      <div class="paper-header-text">
        <h1 class="paper-name">${p.name || 'Your Name'}</h1>
        <div class="paper-contact">
          ${contactBits.map(b => `<span>${b}</span>`).join(' • ')}
        </div>
      </div>
    </div>
  `;

  const isColumns = ['sidebar_left', 'sidebar_right', 'photo_header', 'executive_sidebar'].includes(layout);

  let pagesHtml;

  if (isColumns) {
    const sidebarHtml = `
      <div class="paper-sidebar">
        ${photoHtml}
        <h1 class="paper-name">${p.name || 'Your Name'}</h1>
        <div class="paper-contact">${contactBits.map(b => `<div>${b}</div>`).join('')}</div>
        ${c.skills && c.skills.length > 0 ? `<div class="sidebar-block"><div class="sidebar-block-title">Skills</div><p>${c.skills.join(', ')}</p></div>` : ''}
        ${c.education && c.education.length > 0 ? `<div class="sidebar-block"><div class="sidebar-block-title">Education</div>${c.education.map(edu => `<p><strong>${edu.degree || ''}</strong><br>${edu.institution || ''} ${edu.duration || ''}</p>`).join('')}</div>` : ''}
        ${c.certifications && c.certifications.length > 0 ? `<div class="sidebar-block"><div class="sidebar-block-title">Certifications</div><ul>${c.certifications.map(x => `<li>${x}</li>`).join('')}</ul></div>` : ''}
        ${c.affiliations && c.affiliations.length > 0 ? `<div class="sidebar-block"><div class="sidebar-block-title">Affiliations</div><ul>${c.affiliations.map(x => `<li>${typeof x === 'string' ? x : (x.title || x.name || '')}</li>`).join('')}</ul></div>` : ''}
      </div>
    `;

    const mainBlocks = buildSidebarMainFlowBlocks(c);
    const shellHtml = `<div class="paper-columns">${sidebarHtml}<div class="paper-main" data-flow-target="1"></div></div>`;
    const pages = paginateFlowBlocks(mainBlocks, sheetClassName, styleVars, shellHtml);

    pagesHtml = pages.map(pageBlocks => {
      const mainHtml = `<div class="paper-main">${pageBlocks.join('')}</div>`;
      const order = layout === 'sidebar_right' ? [mainHtml, sidebarHtml] : [sidebarHtml, mainHtml];
      return `<div class="paper-columns">${order.join('')}</div>`;
    });
  } else {
    const mainBlocks = buildMainFlowBlocks(c, headerHtml);
    const pages = paginateFlowBlocks(mainBlocks, sheetClassName, styleVars, `<div data-flow-target="1"></div>`);
    pagesHtml = pages.map(pageBlocks => pageBlocks.join(''));
  }

  container.innerHTML = pagesHtml.map((innerHtml, idx) => `
    <div class="a4-page-wrap">
      <div class="${sheetClassName}" style="--tpl-accent:${styleVars['--tpl-accent']}; --tpl-font:${styleVars['--tpl-font']};">
        ${innerHtml}
      </div>
      <div class="a4-page-badge">Page ${idx + 1} of ${pagesHtml.length}</div>
    </div>
  `).join('');
}

// --- PHOTO UPLOAD (resume photo + profile photo) ---
const PHOTO_MAX_FILE_BYTES = 8 * 1024 * 1024;

// Reads an image file, centre-crops it to a square and returns a small JPEG data-URI.
function readPhotoFile(file, size = 360) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      return reject(new Error('Please choose an image file (JPG, PNG or WEBP).'));
    }
    if (file.size > PHOTO_MAX_FILE_BYTES) {
      return reject(new Error('Image is too large. Please choose a photo under 8 MB.'));
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 4;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (err) {
        reject(new Error('Could not process this image.'));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this image. Please try a JPG or PNG file.'));
    };
    img.src = url;
  });
}

function profilePhotoKey() {
  return `folio_profile_photo_${(state.user && state.user.id) || 'guest'}`;
}
function getProfilePhoto() {
  try { return localStorage.getItem(profilePhotoKey()) || ''; } catch (e) { return ''; }
}
function setProfilePhoto(dataUrl) {
  try {
    if (dataUrl) localStorage.setItem(profilePhotoKey(), dataUrl);
    else localStorage.removeItem(profilePhotoKey());
  } catch (e) { /* storage full or blocked */ }
}

function setPhotoPreview(imgId, placeholderId, removeId, dataUrl) {
  const img = document.getElementById(imgId);
  const ph = document.getElementById(placeholderId);
  const rm = document.getElementById(removeId);
  const has = !!(dataUrl && String(dataUrl).startsWith('data:image/'));
  if (img) { img.src = has ? dataUrl : ''; img.style.display = has ? 'block' : 'none'; }
  if (ph) ph.style.display = has ? 'none' : 'flex';
  if (rm) rm.style.display = has ? '' : 'none';
}
function syncStudioPhotoUI() {
  const c = (state.resumeData && state.resumeData.content) || {};
  setPhotoPreview('studio-photo-preview', 'studio-photo-placeholder', 'btn-remove-studio-photo', c.photo);
}
function syncProfilePhotoUI() {
  setPhotoPreview('edit-photo-preview', 'edit-photo-placeholder', 'btn-remove-profile-photo', getProfilePhoto());
  // Keep the account-menu avatar and the "My Profile" avatar showing the
  // real saved photo (not just initials) as soon as it changes.
  applyAvatarPhoto('user-avatar-photo', 'user-avatar-initials', getProfilePhoto());
  applyAvatarPhoto('prof-avatar-photo', 'prof-avatar-text', getProfilePhoto());
}

// Shows `dataUrl` in the avatar <img> (imgId) and hides the initials
// fallback (initialsId) beneath it, or the reverse when there's no photo.
function applyAvatarPhoto(imgId, initialsId, dataUrl) {
  const img = document.getElementById(imgId);
  const initials = document.getElementById(initialsId);
  const has = !!(dataUrl && String(dataUrl).startsWith('data:image/'));
  if (img) { img.src = has ? dataUrl : ''; img.style.display = has ? 'block' : 'none'; }
  if (initials) initials.style.visibility = has ? 'hidden' : 'visible';
}

function initStudioPhoto() {
  const input = document.getElementById('studio-photo-file-input');
  const btnRemove = document.getElementById('btn-remove-studio-photo');

  if (input) {
    input.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = ''; // lets the same file be picked again later
      if (!file) return;
      try {
        const dataUrl = await readPhotoFile(file);
        if (!state.resumeData.content) state.resumeData.content = {};
        state.resumeData.content.photo = dataUrl;
        delete state.resumeData.content.photo_declined;
        syncStudioPhotoUI();
        renderPaperCanvas();
        triggerAutoSave();
        showToast('Photo added to your resume.', 'success');
      } catch (err) {
        showToast(err.message || 'Photo upload failed.', 'error');
      }
    });
  }

  if (btnRemove) {
    btnRemove.addEventListener('click', () => {
      if (!state.resumeData.content) return;
      delete state.resumeData.content.photo;
      state.resumeData.content.photo_declined = true;
      syncStudioPhotoUI();
      renderPaperCanvas();
      triggerAutoSave();
      showToast('Photo removed from this resume.', 'info');
    });
  }
}

function initProfilePhoto() {
  const input = document.getElementById('edit-photo-file-input');
  const btnRemove = document.getElementById('btn-remove-profile-photo');

  if (input) {
    input.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        setProfilePhoto(await readPhotoFile(file));
        syncProfilePhotoUI();
        showToast('Profile photo saved on this device. It is used by photo resume templates.', 'success');
      } catch (err) {
        showToast(err.message || 'Photo upload failed.', 'error');
      }
    });
  }

  if (btnRemove) {
    btnRemove.addEventListener('click', () => {
      setProfilePhoto('');
      syncProfilePhotoUI();
      showToast('Profile photo removed.', 'info');
    });
  }
}

function paperPhotoHtml(c, p) {
  if (c.photo && String(c.photo).startsWith('data:image/')) {
    return `<img class="paper-photo" src="${c.photo}" alt="Profile photo">`;
  }
  const initials = ((p.name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '?')
    .toUpperCase().replace(/[<>&"']/g, '');
  return `<div class="paper-photo paper-photo-initials">${initials}</div>`;
}

// --- AUTOSAVE ENGINE ---
function triggerAutoSave() {
  const badge = document.getElementById('studio-save-status');
  if (badge) {
    badge.textContent = 'Saving...';
    badge.className = 'save-status-badge saving';
  }

  if (state.saveTimeout) clearTimeout(state.saveTimeout);

  state.saveTimeout = setTimeout(async () => {
    if (!state.activeResumeId || !state.token) return;

    const payload = {
      title: state.resumeData.title,
      template_id: state.activeTemplate,
      target_job_title: state.resumeData.target_job_title,
      target_job_description: state.resumeData.target_job_description,
      content: state.resumeData.content
    };

    const res = await apiCall(`/resumes/${state.activeResumeId}`, 'PUT', payload);
    if (res && res.success) {
      if (badge) {
        badge.textContent = 'Saved';
        badge.className = 'save-status-badge saved';
      }
    }
  }, 1200);
}

// --- PDF DOWNLOAD SERVICE ---
async function downloadResumePdf() {
  if (!state.activeResumeId || !state.token) {
    // Client-side HTML2PDF fallback
    const element = document.getElementById('paper-render-canvas');
    if (!element) return;
    const opt = {
      margin: 10,
      filename: `${state.resumeData.title || 'resume'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(element).save();
    showToast('Downloaded PDF via client print fallback.', 'info');
    return;
  }

  showToast('Generating backend PDF...', 'info');

  try {
    const response = await fetch(`${API_BASE}/pdf/download/${state.activeResumeId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });

    if (!response.ok) {
      throw new Error('PDF download failed');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(state.resumeData.title || 'resume').replace(/\s+/g, '_')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);

    showToast('PDF downloaded successfully!', 'success');
  } catch (err) {
    showToast('Backend PDF server busy. Using browser PDF fallback...', 'info');
    const element = document.getElementById('paper-render-canvas');
    if (element) {
      const opt = {
        margin: 10,
        filename: `${state.resumeData.title || 'resume'}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      html2pdf().set(opt).from(element).save();
    }
  }
}

// --- DRAWER PANEL MANAGEMENT (ATS & AI ADVISOR) ---
function initDrawer() {
  const drawer = document.getElementById('studio-drawer-panel');
  const btnClose = document.getElementById('btn-close-drawer');
  const btnAtsToggle = document.getElementById('btn-toggle-ats-drawer');
  const btnAdvisorToggle = document.getElementById('btn-toggle-advisor-drawer');
  const btnCoverToggle = document.getElementById('btn-toggle-cover-drawer');

  if (btnClose) btnClose.addEventListener('click', () => drawer.classList.remove('open'));

  if (btnAtsToggle) {
    btnAtsToggle.addEventListener('click', () => {
      drawer.classList.add('open');
      switchDrawerTab('ats');
    });
  }

  if (btnAdvisorToggle) {
    btnAdvisorToggle.addEventListener('click', () => {
      drawer.classList.add('open');
      switchDrawerTab('advisor');
    });
  }

  // Bug fix: this button previously had no click handler at all, so
  // "AI Cover Letter" did nothing when clicked from the studio toolbar.
  if (btnCoverToggle) {
    btnCoverToggle.addEventListener('click', () => {
      drawer.classList.add('open');
      switchDrawerTab('cover');
    });
  }

  // Bug fix: the tab buttons *inside* the open drawer (ATS / Advisor /
  // Cover Letter) had no click handler either, so once the drawer was
  // open there was no way to switch between them.
  document.querySelectorAll('.drawer-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.drawer-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.target || '';
      const tabName = target.replace('drawer-', '').replace('-content', '');
      switchDrawerTab(tabName);
    });
  });

  // ATS Check Run
  const btnRunAts = document.getElementById('btn-run-ats-check');
  if (btnRunAts) btnRunAts.addEventListener('click', runAtsCheck);

  // Advisor Run
  const btnRunAdvisor = document.getElementById('btn-run-advisor');
  if (btnRunAdvisor) btnRunAdvisor.addEventListener('click', runAdvisorCheck);

  // Cover Letter Run
  const btnRunCover = document.getElementById('btn-run-cover-letter');
  if (btnRunCover) btnRunCover.addEventListener('click', runCoverLetterGen);

  const btnCopyCover = document.getElementById('btn-copy-cover');
  if (btnCopyCover) {
    btnCopyCover.addEventListener('click', () => {
      const txt = document.getElementById('cover-letter-output').value;
      navigator.clipboard.writeText(txt);
      showToast('Copied cover letter to clipboard!', 'success');
    });
  }

  const jdTextarea = document.getElementById('cover-job-desc');
  if (jdTextarea) jdTextarea.addEventListener('input', clearJobDescriptionError);

  // --- AI RECRUITER ASSISTANT: Job Search ---
  const btnLinkedIn = document.getElementById('btn-search-linkedin-jobs');
  if (btnLinkedIn) {
    btnLinkedIn.addEventListener('click', () => {
      const title = (document.getElementById('recruiter-job-title')?.value || '').trim();
      const location = (document.getElementById('recruiter-job-location')?.value || '').trim();
      if (!title && !location) {
        return showToast('Enter a job title or location to search.', 'info');
      }
      const params = new URLSearchParams();
      if (title) params.set('keywords', title);
      if (location) params.set('location', location);
      const url = `https://www.linkedin.com/jobs/search/?${params.toString()}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

  // --- AI RECRUITER ASSISTANT: Resume vs Job Analysis ---
  const btnRunAnalysis = document.getElementById('btn-run-recruiter-analysis');
  if (btnRunAnalysis) btnRunAnalysis.addEventListener('click', runRecruiterAnalysis);

  // --- AI RECRUITER ASSISTANT: Chat ---
  const btnSendChat = document.getElementById('btn-send-recruiter-chat');
  if (btnSendChat) btnSendChat.addEventListener('click', sendRecruiterChatMessage);

  const chatInput = document.getElementById('recruiter-chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendRecruiterChatMessage();
      }
    });
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 90) + 'px';
    });
  }
}

// --- AI RECRUITER ASSISTANT: Resume vs Job Analysis ---
// The Job Description textarea lives in the Cover Letter tab, while the
// Analyze/Chat controls that read it live in the Advisor tab - so these
// helpers touch both tabs' error spans regardless of which one is active.
function clearJobDescriptionError() {
  const advisorErr = document.getElementById('jd-error-msg');
  const coverErr = document.getElementById('jd-error-msg-cover');
  if (advisorErr) advisorErr.style.display = 'none';
  if (coverErr) coverErr.style.display = 'none';
}

function getJobDescriptionOrShowError() {
  const jd = (document.getElementById('cover-job-desc')?.value || '').trim();
  const errEl = document.getElementById('jd-error-msg');
  if (!jd) {
    if (errEl) errEl.style.display = 'block';
    showToast('Please paste a job description in the Cover Letter tab first.', 'info');
    return null;
  }
  if (errEl) errEl.style.display = 'none';
  return jd;
}

async function runRecruiterAnalysis() {
  if (!state.activeResumeId) return showToast('Please save your resume draft first.', 'info');

  const jd = getJobDescriptionOrShowError();
  if (!jd) return;

  const loading = document.getElementById('recruiter-analysis-loading');
  const results = document.getElementById('recruiter-analysis-results');
  if (loading) loading.style.display = 'block';
  if (results) results.style.display = 'none';

  const res = await apiCall(`/ai/recruiter-analysis/${state.activeResumeId}`, 'POST', { job_description: jd });

  if (loading) loading.style.display = 'none';

  if (res && res.success && res.data && res.data.analysis) {
    renderRecruiterAnalysis(res.data.analysis);
    showToast('Recruiter analysis ready!', 'success');
  } else if (res && res.status === 402) {
    showToast('AI Recruiter Assistant analysis is a Premium feature. Upgrade to unlock.', 'error');
    switchView('view-pricing');
  } else {
    showToast((res && res.error) || 'Recruiter analysis failed.', 'error');
  }
}

function renderRecruiterAnalysis(a) {
  const results = document.getElementById('recruiter-analysis-results');
  if (results) results.style.display = 'block';

  const scoreNum = document.getElementById('recruiter-match-score');
  if (scoreNum) scoreNum.textContent = (a.match_score ?? '--');

  const circle = document.getElementById('recruiter-match-circle');
  if (circle) {
    const s = a.match_score || 0;
    circle.style.borderColor = s >= 80 ? 'var(--ats-excellent)' : (s >= 60 ? 'var(--ats-good)' : 'var(--ats-poor)');
  }

  const setTags = (id, arr, emptyLabel) => {
    const el = document.getElementById(id);
    if (!el) return;
    const items = (arr && arr.length) ? arr : [emptyLabel];
    el.innerHTML = items.map(w => `<span>${escapeHtml(String(w))}</span>`).join('');
  };
  setTags('rec-strong-matches', a.strong_matches, 'None identified');
  setTags('rec-missing-areas', a.missing_or_weak_areas, 'None identified');
  setTags('rec-keywords', a.important_keywords, 'None identified');

  const expEl = document.getElementById('rec-exp-match');
  if (expEl) expEl.textContent = a.relevant_experience_match || '--';

  const setList = (id, arr) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = (arr && arr.length) ? arr.map(s => `<li>${escapeHtml(String(s))}</li>`).join('') : '<li>None noted.</li>';
  };
  setList('rec-strengths', a.strengths);
  setList('rec-improvements', a.improvements);

  const verdictEl = document.getElementById('rec-verdict');
  if (verdictEl) verdictEl.textContent = a.recruiter_verdict || '--';
}

// --- AI RECRUITER ASSISTANT: Chatbot ---
function resetRecruiterChat() {
  state.recruiterChatHistory = [];
  const win = document.getElementById('recruiter-chat-window');
  if (win) {
    win.innerHTML = `<div class="chat-msg chat-msg-ai"><p>Hello! I have your resume ready. Paste a job description above, then ask me anything about your fit, resume improvements, skills, keywords, or interview prep.</p></div>`;
  }
}

function appendRecruiterChatMessage(role, text) {
  const win = document.getElementById('recruiter-chat-window');
  if (!win) return;
  const bubble = document.createElement('div');
  bubble.className = `chat-msg ${role === 'user' ? 'chat-msg-user' : 'chat-msg-ai'}`;
  bubble.innerHTML = `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
  win.appendChild(bubble);
  win.scrollTop = win.scrollHeight;
}

async function sendRecruiterChatMessage() {
  if (state.recruiterChatSending) return; // prevent duplicate sends while loading
  if (!state.activeResumeId) return showToast('Please save your resume draft first.', 'info');

  const input = document.getElementById('recruiter-chat-input');
  const message = (input?.value || '').trim();
  if (!message) return;

  const jd = getJobDescriptionOrShowError();
  if (!jd) return;

  appendRecruiterChatMessage('user', message);
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  const sendBtn = document.getElementById('btn-send-recruiter-chat');
  const loading = document.getElementById('recruiter-chat-loading');
  state.recruiterChatSending = true;
  if (sendBtn) sendBtn.disabled = true;
  if (loading) loading.style.display = 'block';

  const res = await apiCall(`/ai/recruiter-chat/${state.activeResumeId}`, 'POST', {
    job_description: jd,
    message,
    conversation_history: state.recruiterChatHistory
  });

  state.recruiterChatSending = false;
  if (sendBtn) sendBtn.disabled = false;
  if (loading) loading.style.display = 'none';

  if (res && res.success && res.data && res.data.reply) {
    appendRecruiterChatMessage('assistant', res.data.reply);
    state.recruiterChatHistory.push({ role: 'user', content: message });
    state.recruiterChatHistory.push({ role: 'assistant', content: res.data.reply });
    // Keep the client-side history bounded so the payload doesn't grow forever.
    if (state.recruiterChatHistory.length > 16) {
      state.recruiterChatHistory = state.recruiterChatHistory.slice(-16);
    }
  } else if (res && res.status === 402) {
    appendRecruiterChatMessage('assistant', 'The AI Recruiter Assistant chat is a Premium feature. Upgrade to unlock unlimited chat.');
    showToast('AI Recruiter Assistant chat is a Premium feature.', 'error');
  } else {
    appendRecruiterChatMessage('assistant', "Sorry, I couldn't process that just now. Please try again in a moment.");
    showToast((res && res.error) || 'Recruiter chat failed.', 'error');
  }
}

function switchDrawerTab(tabName) {
  const title = document.getElementById('drawer-title');
  const contentAts = document.getElementById('drawer-ats-content');
  const contentAdvisor = document.getElementById('drawer-advisor-content');
  const contentCover = document.getElementById('drawer-cover-content');

  contentAts.classList.remove('active');
  contentAdvisor.classList.remove('active');
  contentCover.classList.remove('active');

  if (tabName === 'ats') {
    if (title) title.textContent = 'ATS Check Inspection';
    contentAts.classList.add('active');
  } else if (tabName === 'advisor') {
    if (title) title.textContent = 'Recruiter AI Advisor';
    contentAdvisor.classList.add('active');
  } else if (tabName === 'cover') {
    if (title) title.textContent = 'Job Search & Cover Letter';
    contentCover.classList.add('active');
  }
}

async function runAtsCheck() {
  if (!state.activeResumeId) return showToast('Please save your resume draft first.', 'info');

  const res = await apiCall(`/ats/check/${state.activeResumeId}`, 'POST', {
    job_description: state.resumeData.target_job_description || ''
  });

  if (res && res.success && res.data) {
    const result = res.data.ats_result;
    const checksRem = res.data.checks_remaining;

    if (state.user) {
      if (checksRem !== null) state.user.ats_checks_used = (state.user.ats_checks_used || 0) + 1;
      updateUserInterface();
    }

    renderAtsResults(result, checksRem);
    showToast(`ATS Grade Evaluated: ${result.score}/100`, 'success');
  } else {
    showToast(res.error || 'ATS check limit reached. Upgrade to Premium.', 'error');
  }
}

function renderAtsResults(result, checksRemaining) {
  const scoreNum = document.getElementById('ats-score-number');
  const scoreCircle = document.getElementById('ats-score-circle');
  const breakdownBox = document.getElementById('ats-breakdown-box');
  const breakdownItems = document.getElementById('ats-breakdown-items');
  const matchedTags = document.getElementById('ats-matched-tags');
  const missingTags = document.getElementById('ats-missing-tags');
  const suggestionsList = document.getElementById('ats-suggestions-list');
  const remHint = document.getElementById('drawer-checks-rem');

  if (scoreNum) scoreNum.textContent = result.score;
  if (scoreCircle) {
    scoreCircle.style.borderColor = result.score >= 80 ? 'var(--ats-excellent)' : (result.score >= 60 ? 'var(--ats-good)' : 'var(--ats-poor)');
  }

  if (remHint) {
    remHint.textContent = checksRemaining === null ? 'Unlimited Premium Checks' : `${checksRemaining} free checks remaining`;
  }

  if (breakdownBox) breakdownBox.style.display = 'block';

  if (breakdownItems && result.breakdown) {
    breakdownItems.innerHTML = Object.entries(result.breakdown).map(([k, v]) => `
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:4px;">
        <span style="text-transform:capitalize;">${k.replace('_', ' ')}</span>
        <strong>${v} pts</strong>
      </div>
    `).join('');
  }

  if (matchedTags) {
    matchedTags.innerHTML = (result.matched_keywords || ['General Tech']).map(w => `<span>✓ ${w}</span>`).join('');
  }

  if (missingTags) {
    missingTags.innerHTML = (result.missing_keywords || ['None']).map(w => `<span>+ ${w}</span>`).join('');
  }

  if (suggestionsList) {
    suggestionsList.innerHTML = (result.suggestions || ['Resume structure looks solid!']).map(s => `<li>${s}</li>`).join('');
  }

  // Update topbar pill
  const studioPill = document.getElementById('studio-ats-badge');
  if (studioPill) {
    studioPill.querySelector('.score-text').textContent = `ATS: ${result.score}/100`;
  }
}

async function runAdvisorCheck() {
  if (!state.activeResumeId) return showToast('Please save your resume first.', 'info');

  showToast('Analyzing resume with Recruiter AI...', 'info');
  const res = await apiCall(`/ai/advisor/${state.activeResumeId}`, 'POST');

  if (res && res.success && res.data && res.data.advisor_feedback) {
    const f = res.data.advisor_feedback;
    const box = document.getElementById('advisor-results-box');
    if (box) box.style.display = 'block';

    const imp = document.getElementById('adv-impression');
    if (imp) imp.textContent = f.overall_impression || '';

    const str = document.getElementById('adv-strengths');
    if (str) str.innerHTML = (f.strengths || []).map(s => `<li>✓ ${s}</li>`).join('');

    const impr = document.getElementById('adv-improvements');
    if (impr) impr.innerHTML = (f.improvements || []).map(i => `<li>• ${i}</li>`).join('');

    const skl = document.getElementById('adv-skills');
    if (skl) skl.innerHTML = (f.suggested_skills_to_add || []).map(s => `<span>${s}</span>`).join('');

    showToast('Advisor Feedback Ready!', 'success');
  } else if (res && res.status === 402) {
    showToast('Recruiter AI Advisor is a Premium feature. Upgrade to unlock.', 'error');
    switchView('view-pricing');
  } else {
    showToast((res && res.error) || 'Advisor analysis failed.', 'error');
  }
}

async function runCoverLetterGen() {
  if (!state.activeResumeId) return showToast('Save resume first.', 'info');

  // Bug fix: this used to ignore the "Target Job Description" textarea in the
  // Cover Letter tab entirely and always sent stale/default text instead.
  const jdInput = document.getElementById('cover-job-desc');
  const jd = (jdInput && jdInput.value.trim())
    || state.resumeData.target_job_description
    || '';

  const coverErr = document.getElementById('jd-error-msg-cover');
  if (!jd) {
    if (coverErr) coverErr.style.display = 'block';
    return showToast('Paste a target job description first.', 'info');
  }
  if (coverErr) coverErr.style.display = 'none';

  const loading = document.getElementById('cover-letter-loading');
  if (loading) loading.style.display = 'block';

  const res = await apiCall(`/ai/cover-letter/${state.activeResumeId}`, 'POST', { job_description: jd });

  if (loading) loading.style.display = 'none';

  if (res && res.success && res.data) {
    const box = document.getElementById('cover-letter-results');
    const txt = document.getElementById('cover-letter-output');
    if (box) box.style.display = 'block';
    if (txt) txt.value = res.data.cover_letter_opening;
    showToast('Cover letter intro generated!', 'success');
  } else {
    if (res.status === 402) {
      showToast('Cover Letter is a Premium feature. Upgrade to unlock.', 'error');
      switchView('view-pricing');
    } else {
      showToast(res.error || 'Generation failed.', 'error');
    }
  }
}

// --- HTML ESCAPER HELPER ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- PRICING & PAYMENT GATEWAY INTEGRATION ---
let currentCheckoutPlan = 'monthly';

function initPricing() {
  const btnUpgradeNav = document.getElementById('btn-upgrade-nav');
  const btnOpenUpgrade = document.getElementById('btn-open-upgrade');
  const btnStatUpgrade = document.getElementById('btn-stat-upgrade');

  // Navigation & Upgrade Modal Triggers
  if (btnUpgradeNav) btnUpgradeNav.addEventListener('click', () => switchView('view-pricing'));
  
  if (btnOpenUpgrade) {
    btnOpenUpgrade.addEventListener('click', () => {
      if (!state.token) {
        showToast('Please sign in to upgrade your plan.', 'info');
        return openAuthModal('login');
      }
      openPaymentModal('monthly');
    });
  }
  
  if (btnStatUpgrade) {
    btnStatUpgrade.addEventListener('click', () => {
      if (!state.token) {
        showToast('Please sign in to upgrade your plan.', 'info');
        return openAuthModal('login');
      }
      openPaymentModal('monthly');
    });
  }

  // Open Payment Modal from Pricing Page Cards
  document.querySelectorAll('.btn-price-upgrade-action').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.token) {
        showToast('Please sign in or create an account first.', 'info');
        return openAuthModal('login');
      }
      const plan = btn.getAttribute('data-plan') || 'monthly';
      openPaymentModal(plan);
    });
  });

  // Modals & Close buttons
  const paymentModal = document.getElementById('payment-modal');
  const btnClosePayment = document.getElementById('btn-close-payment-modal');
  const receiptModal = document.getElementById('receipt-modal');
  const btnCloseReceipt = document.getElementById('btn-close-receipt-modal');
  const btnPrintReceipt = document.getElementById('btn-print-receipt');
  const btnContinueStudio = document.getElementById('btn-continue-studio');

  if (btnClosePayment) btnClosePayment.addEventListener('click', closePaymentModal);
  if (btnCloseReceipt) btnCloseReceipt.addEventListener('click', closeReceiptModal);
  
  if (paymentModal) {
    paymentModal.addEventListener('click', (e) => {
      if (e.target === paymentModal) closePaymentModal();
    });
  }
  if (receiptModal) {
    receiptModal.addEventListener('click', (e) => {
      if (e.target === receiptModal) closeReceiptModal();
    });
  }

  if (btnContinueStudio) {
    btnContinueStudio.addEventListener('click', () => {
      closeReceiptModal();
      switchView('view-studio');
    });
  }
  if (btnPrintReceipt) {
    btnPrintReceipt.addEventListener('click', () => window.print());
  }

  // UPI VPA verification (format check)
  const btnVerifyUpi = document.getElementById('btn-verify-upi');
  const upiInput = document.getElementById('pay-upi-id');
  const upiVerifiedBadge = document.getElementById('upi-verified-badge');

  if (btnVerifyUpi && upiInput) {
    btnVerifyUpi.addEventListener('click', () => {
      const val = upiInput.value.trim();
      const isValid = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(val);
      if (isValid) {
        if (upiVerifiedBadge) {
          upiVerifiedBadge.style.display = 'block';
          upiVerifiedBadge.textContent = `✓ Valid UPI ID (${val})`;
        }
        showToast('UPI ID format looks valid. Complete the payment using the QR code above.', 'success');
      } else {
        if (upiVerifiedBadge) upiVerifiedBadge.style.display = 'none';
        showToast('Please enter a valid UPI format (e.g. name@okaxis, mobile@paytm)', 'error');
      }
    });
  }

  // UPI Payment Form Submission
  const upiForm = document.getElementById('form-pay-upi');
  if (upiForm) {
    upiForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const utrInput = document.getElementById('pay-upi-utr');
      const utrVal = utrInput ? utrInput.value.trim() : '';

      if (!utrVal || utrVal.replace(/\D/g, '').length < 12) {
        showToast('Please enter a valid 12-digit UPI UTR / Reference number from your payment receipt.', 'error');
        if (utrInput) utrInput.focus();
        return;
      }

      await executePayment({
        utr: utrVal,
        payment_id: utrVal,
        plan_type: currentCheckoutPlan,
        method: 'UPI',
        bank: 'UPI Network'
      });
    });
  }

  // Status Modals Action Handlers
  const btnCloseFailed = document.getElementById('btn-close-failed-modal');
  const btnCancelFailed = document.getElementById('btn-cancel-failed');
  const btnRetry = document.getElementById('btn-retry-payment');
  const btnClosePending = document.getElementById('btn-close-pending-modal');
  const btnCloseCancelled = document.getElementById('btn-close-cancelled-modal');
  const btnReopen = document.getElementById('btn-reopen-checkout');

  const closeAllStatusModals = () => {
    ['payment-failed-modal', 'payment-pending-modal', 'payment-cancelled-modal'].forEach(id => {
      const m = document.getElementById(id);
      if (m) m.classList.remove('active');
    });
  };

  if (btnCloseFailed) btnCloseFailed.addEventListener('click', closeAllStatusModals);
  if (btnCancelFailed) btnCancelFailed.addEventListener('click', closeAllStatusModals);
  if (btnRetry) btnRetry.addEventListener('click', () => { closeAllStatusModals(); openPaymentModal(currentCheckoutPlan); });
  if (btnClosePending) btnClosePending.addEventListener('click', closeAllStatusModals);
  if (btnCloseCancelled) btnCloseCancelled.addEventListener('click', closeAllStatusModals);
  if (btnReopen) btnReopen.addEventListener('click', () => { closeAllStatusModals(); openPaymentModal(currentCheckoutPlan); });
}

// --- PAYMENT PROCESSING & MODAL CONTROLLERS ---
function openPaymentModal(planType = 'monthly') {
  const modal = document.getElementById('payment-modal');
  if (!modal) return;

  currentCheckoutPlan = (planType === 'annual') ? 'annual' : 'monthly';

  const planTitle = document.getElementById('checkout-plan-title');
  const planSub = document.getElementById('checkout-plan-subtitle');
  const amountDisp = document.getElementById('checkout-amount-display');
  const periodDisp = document.getElementById('checkout-period-display');
  const upiAmountText = document.getElementById('upi-amount-text');
  const utrInput = document.getElementById('pay-upi-utr');

  if (utrInput) utrInput.value = '';

  if (currentCheckoutPlan === 'annual') {
    if (planTitle) planTitle.textContent = 'Folio Premium Annual';
    if (planSub) planSub.textContent = 'Best Value — Full access to all AI features & templates for 1 year';
    if (amountDisp) amountDisp.textContent = '1,999';
    if (periodDisp) periodDisp.textContent = '/ year';
    if (upiAmountText) upiAmountText.textContent = '₹1,999';
  } else {
    if (planTitle) planTitle.textContent = 'Folio Premium Monthly';
    if (planSub) planSub.textContent = 'Full access to all AI features & templates for 1 month';
    if (amountDisp) amountDisp.textContent = '199';
    if (periodDisp) periodDisp.textContent = '/ month';
    if (upiAmountText) upiAmountText.textContent = '₹199';
  }

  // Render user uploaded PhonePe QR Code for UPI
  const qrBox = document.getElementById('dynamic-qr-box');
  if (qrBox) {
    qrBox.innerHTML = `<img src="/images/upi_qr1.jpeg" alt="PhonePe UPI Scan & Pay QR Code" class="upi-qr-image">`;
  }

  modal.classList.add('active');
}

function closePaymentModal() {
  const modal = document.getElementById('payment-modal');
  const overlay = document.getElementById('payment-processing-overlay');
  if (modal) modal.classList.remove('active');
  if (overlay) overlay.style.display = 'none';
}

function openPaymentFailedModal(errorMsg, txId) {
  closePaymentModal();
  const modal = document.getElementById('payment-failed-modal');
  const desc = document.getElementById('failed-modal-desc');
  const txCode = document.getElementById('failed-tx-id');
  if (desc) desc.textContent = errorMsg || 'Payment verification could not be completed.';
  if (txCode) txCode.textContent = txId || 'TXN_UNVERIFIED';
  if (modal) modal.classList.add('active');
}

function openReceiptModal(receipt) {
  const modal = document.getElementById('receipt-modal');
  const body = document.getElementById('receipt-details-body');
  if (!modal || !body) return;

  const isAnnual = (receipt && receipt.plan && receipt.plan.toLowerCase().includes('annual'));
  const r = receipt || {
    transaction_id: 'TXN_' + Math.random().toString(36).substring(2, 10).toUpperCase(),
    amount: isAnnual ? 1999 : 199,
    currency: 'INR',
    method: 'UPI',
    bank_or_provider: 'UPI Network',
    plan: isAnnual ? 'Premium Annual' : 'Premium Monthly',
    timestamp: new Date().toLocaleString(),
    status: 'Payment submitted for verification',
    customer_name: (state.user && state.user.name) || 'Valued Customer',
    customer_email: (state.user && state.user.email) || 'user@example.com'
  };

  body.innerHTML = `
    <div class="receipt-table">
      <div class="receipt-row">
        <span class="receipt-label">Transaction Reference</span>
        <span class="receipt-val">${r.transaction_id}</span>
      </div>
      <div class="receipt-row">
        <span class="receipt-label">Customer Name</span>
        <span class="receipt-val">${escapeHtml(r.customer_name)}</span>
      </div>
      <div class="receipt-row">
        <span class="receipt-label">Customer Email</span>
        <span class="receipt-val">${escapeHtml(r.customer_email)}</span>
      </div>
      <div class="receipt-row">
        <span class="receipt-label">Plan Purchased</span>
        <span class="receipt-val">${r.plan}</span>
      </div>
      <div class="receipt-row">
        <span class="receipt-label">Payment Method</span>
        <span class="receipt-val">${r.method}</span>
      </div>
      <div class="receipt-row">
        <span class="receipt-label">Date & Time</span>
        <span class="receipt-val">${r.timestamp}</span>
      </div>
      <div class="receipt-row">
        <span class="receipt-label">Amount</span>
        <span class="receipt-val" style="color: var(--primary); font-size: 1.05rem;">₹${r.amount}.00 ${r.currency}</span>
      </div>
      <div class="receipt-row">
        <span class="receipt-label">Verification Status</span>
        <span class="receipt-val" style="color: var(--ats-excellent); font-weight: 700;">● ${r.status}</span>
      </div>
    </div>
  `;

  modal.classList.add('active');
}

function closeReceiptModal() {
  const modal = document.getElementById('receipt-modal');
  if (modal) modal.classList.remove('active');
}

async function executePayment(paymentDetails) {
  const overlay = document.getElementById('payment-processing-overlay');
  const title = document.getElementById('proc-status-title');
  const desc = document.getElementById('proc-status-desc');
  const fill = document.getElementById('proc-progress-fill');

  if (overlay) overlay.style.display = 'flex';
  if (fill) fill.style.width = '30%';
  if (title) title.textContent = 'Submitting Payment Information...';
  if (desc) desc.textContent = 'Submitting transaction reference for verification.';

  await new Promise(r => setTimeout(r, 400));
  if (title) title.textContent = 'Verifying Reference...';
  if (desc) desc.textContent = 'Processing UTR reference number...';
  if (fill) fill.style.width = '70%';

  await new Promise(r => setTimeout(r, 400));
  if (title) title.textContent = 'Upgrading Account...';
  if (desc) desc.textContent = 'Updating your subscription plan...';
  if (fill) fill.style.width = '90%';

  const res = await apiCall('/billing/verify-payment', 'POST', paymentDetails);

  if (fill) fill.style.width = '100%';
  await new Promise(r => setTimeout(r, 300));
  if (overlay) overlay.style.display = 'none';

  if (res && res.success && res.data) {
    if (res.data.token) {
      state.token = res.data.token;
      localStorage.setItem('folio_jwt_token', state.token);
    }
    if (res.data.user) {
      state.user = res.data.user;
    }
    state.user.plan = 'premium';
    localStorage.setItem('folio_user_profile', JSON.stringify(state.user));
    updateUserInterface();
    closePaymentModal();
    openReceiptModal(res.data.receipt);
    showToast('Payment submitted for verification. Account upgraded to Premium ⭐', 'success');
  } else {
    const errorMsg = (res && res.error) || 'Payment submission could not be processed.';
    openPaymentFailedModal(errorMsg, paymentDetails.utr || 'TXN_UNVERIFIED');
    showToast(errorMsg, 'error');
  }
}

// --- INTERACTIVE ATS SIMULATOR ON LANDING ---
function initSimulatedAts() {
  const textarea = document.getElementById('sim-bullet-input');
  if (!textarea) return;

  textarea.addEventListener('input', (e) => {
    const text = e.target.value;
    let score = 50;
    const insights = [];

    if (/\b(led|built|created|designed|developed|implemented|improved|reduced|optimized)\b/i.test(text)) {
      score += 20;
      insights.push('<div class="insight-chip pass">✓ Action Verb Detected</div>');
    }

    if (/\d+%|\d+\s*ms|\$\d+|\d+\s*users/i.test(text)) {
      score += 20;
      insights.push('<div class="insight-chip pass">✓ Quantified Impact Metric</div>');
    }

    if (/\b(python|flask|javascript|sql|react|api|docker)\b/i.test(text)) {
      score += 10;
      insights.push('<div class="insight-chip pass">✓ Tech Stack Keyword</div>');
    }

    const scoreVal = document.getElementById('sim-score-val');
    const insightsList = document.getElementById('sim-insights-list');

    if (scoreVal) scoreVal.textContent = Math.min(100, score);
    if (insightsList) insightsList.innerHTML = insights.join('') || '<div class="insight-chip">Add strong verbs & numbers to improve grade</div>';
  });
}

// --- USER PROFILE & CAREER SETTINGS ---
async function loadUserProfile() {
  if (!state.token) return;
  const res = await apiCall('/profile', 'GET');
  if (res && res.success && res.data) {
    state.user = res.data.user;
    localStorage.setItem('folio_user_profile', JSON.stringify(state.user));
    updateUserInterface();
    renderUserProfile(res.data.user, res.data.stats);
  } else {
    // Fallback if offline or server error
    renderUserProfile(state.user || {}, { total_resumes: state.resumes ? state.resumes.length : 0 });
  }
}

function renderUserProfile(user, stats = {}) {
  if (!user) return;
  const name = user.name || user.email?.split('@')[0] || 'User';
  const initials = getUserInitials(name);

  // Profile Header
  const avatarCircle = document.getElementById('prof-avatar-circle');
  const avatarText = document.getElementById('prof-avatar-text');
  const fullName = document.getElementById('prof-full-name');
  const headline = document.getElementById('prof-headline');
  const email = document.getElementById('prof-email');
  const planPill = document.getElementById('prof-plan-pill');
  const authProvider = document.getElementById('prof-auth-provider');

  if (avatarText) avatarText.textContent = initials;
  applyAvatarPhoto('prof-avatar-photo', 'prof-avatar-text', getProfilePhoto());
  if (fullName) fullName.textContent = name;
  if (headline) headline.textContent = user.headline || 'Professional Headline Not Set';
  if (email) email.textContent = user.email || '';
  if (planPill) {
    const isPremium = user.plan === 'premium';
    planPill.textContent = isPremium ? '⭐ Premium Pro' : 'Free Tier';
    planPill.className = `plan-pill ${user.plan || 'free'}`;
  }
  if (authProvider) {
    const providerName = user.auth_provider === 'google' ? 'Google Account' : (user.auth_provider === 'github' ? 'GitHub Account' : 'Password Account');
    authProvider.textContent = providerName;
  }

  // Personal Information
  const phone = document.getElementById('prof-phone');
  const location = document.getElementById('prof-location');
  const headlineVal = document.getElementById('prof-headline-val');

  if (phone) phone.textContent = user.phone || 'Not specified';
  if (location) location.textContent = user.location || 'Not specified';
  if (headlineVal) headlineVal.textContent = user.headline || 'Not specified';

  // AI Career Profile
  const currentStatus = document.getElementById('prof-current-status');
  const targetRole = document.getElementById('prof-target-role');
  const yearsExp = document.getElementById('prof-years-exp');
  const prefLocation = document.getElementById('prof-pref-location');
  const careerGoal = document.getElementById('prof-career-goal');

  if (currentStatus) currentStatus.textContent = user.current_status || 'Not specified';
  if (targetRole) targetRole.textContent = user.target_role || 'Not specified';
  if (yearsExp) yearsExp.textContent = user.years_of_experience || 'Not specified';
  if (prefLocation) prefLocation.textContent = user.preferred_location || 'Not specified';
  if (careerGoal) careerGoal.textContent = user.career_goal || 'Not specified';

  // Activity Stats
  const statResumes = document.getElementById('prof-stat-resumes');
  if (statResumes) {
    statResumes.textContent = typeof stats.total_resumes === 'number' ? stats.total_resumes : (state.resumes ? state.resumes.length : 0);
  }

  // Connected Accounts
  updateAccountStatusElement('prof-status-google', !!user.google_connected, 'google');
  updateAccountStatusElement('prof-status-github', !!user.github_connected, 'github');
}

function updateAccountStatusElement(containerId, isConnected, provider) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (isConnected) {
    container.innerHTML = `<span class="status-badge connected">Connected ✓</span>`;
  } else {
    if (provider === 'github') {
      container.innerHTML = `<button type="button" class="btn btn-xs btn-outline social-auth-btn" data-provider="github" style="cursor:pointer;">Connect GitHub</button>`;
      const btn = container.querySelector('.social-auth-btn');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          window.location.href = `${API_BASE}/auth/github`;
        });
      }
    } else {
      container.innerHTML = `<span class="status-badge">Not Connected</span>`;
    }
  }
}

function initProfile() {
  initProfilePhoto();
  const btnAvatar = document.getElementById('btn-user-profile-avatar');
  const btnOpenEdit = document.getElementById('btn-open-edit-profile');
  const modalEdit = document.getElementById('modal-edit-profile');
  const btnCloseEdit = document.getElementById('btn-close-edit-profile');
  const btnCancelEdit = document.getElementById('btn-cancel-edit-profile');
  const formEdit = document.getElementById('form-edit-profile');

  if (btnAvatar) {
    btnAvatar.addEventListener('click', () => switchView('view-profile'));
  }

  if (btnOpenEdit) {
    btnOpenEdit.addEventListener('click', () => {
      populateEditProfileForm();
      if (modalEdit) modalEdit.classList.add('active');
    });
  }

  const closeEditModal = () => {
    if (modalEdit) modalEdit.classList.remove('active');
  };

  if (btnCloseEdit) btnCloseEdit.addEventListener('click', closeEditModal);
  if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeEditModal);

  if (modalEdit) {
    modalEdit.addEventListener('click', (e) => {
      if (e.target === modalEdit) closeEditModal();
    });
  }

  if (formEdit) {
    formEdit.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        name: document.getElementById('edit-name')?.value || '',
        headline: document.getElementById('edit-headline')?.value || '',
        phone: document.getElementById('edit-phone')?.value || '',
        location: document.getElementById('edit-location')?.value || '',
        current_status: document.getElementById('edit-current-status')?.value || '',
        target_role: document.getElementById('edit-target-role')?.value || '',
        years_of_experience: document.getElementById('edit-years-exp')?.value || '',
        preferred_location: document.getElementById('edit-pref-location')?.value || '',
        career_goal: document.getElementById('edit-career-goal')?.value || '',
      };

      const res = await apiCall('/profile', 'PUT', payload);
      if (res && res.success && res.data) {
        state.user = res.data.user;
        localStorage.setItem('folio_user_profile', JSON.stringify(state.user));
        updateUserInterface();
        renderUserProfile(res.data.user, res.data.stats);
        closeEditModal();
        showToast('Profile updated successfully!', 'success');
      } else {
        showToast(res.error || 'Failed to update profile.', 'error');
      }
    });
  }
}

function populateEditProfileForm() {
  const user = state.user || {};
  const el = (id) => document.getElementById(id);

  if (el('edit-name')) el('edit-name').value = user.name || '';
  if (el('edit-headline')) el('edit-headline').value = user.headline || '';
  if (el('edit-phone')) el('edit-phone').value = user.phone || '';
  if (el('edit-location')) el('edit-location').value = user.location || '';
  if (el('edit-current-status')) el('edit-current-status').value = user.current_status || '';
  if (el('edit-target-role')) el('edit-target-role').value = user.target_role || '';
  if (el('edit-years-exp')) el('edit-years-exp').value = user.years_of_experience || '';
  if (el('edit-pref-location')) el('edit-pref-location').value = user.preferred_location || '';
  if (el('edit-career-goal')) el('edit-career-goal').value = user.career_goal || '';

  updateAccountStatusElement('edit-status-google', !!user.google_connected, 'google');
  updateAccountStatusElement('edit-status-github', !!user.github_connected, 'github');
  syncProfilePhotoUI();
}

