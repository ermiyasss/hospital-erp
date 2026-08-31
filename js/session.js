/* ==========================================================================
   MediTrack Hospital ERP - Session & Role Access

   When the app is served by the hospital server (server.js), identity comes
   from the server: signing in returns an API token plus the account's real
   role, and every page load re-verifies that token against /api/auth/me.
   Signing out invalidates the token server-side. The local session record is
   only a mirror so the sidebar and page guards can render instantly.

   What this file also provides is the single list of what each role is
   allowed to see, so the sidebar, the page guard and the alert routing can
   never disagree with each other. The server enforces permissions on every
   API call regardless of what this file allows — it is convenience, not
   security.

   Load order: this file must come before ui.js and common.js, and before any
   page script, because pages ask it whether they are allowed to render.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var SESSION_KEY = 'meditrack_session';

    /* ==================================================================
       Pages
       One key per screen. The key is what roles are granted, so renaming
       a file only means changing the map below.
       ================================================================== */
    var PAGES = {
        dashboard:    { file: 'pages/default.html',    title: 'Dashboard',       section: 'Overview' },
        messages:     { file: 'pages/messages.html',   title: 'Messages',        section: 'Overview' },
        appointments: { file: 'pages/appointments.html', title: 'Appointments',  section: 'Overview' },
        announcements:{ file: 'pages/announcements.html', title: 'Announcements', section: 'Overview' },
        attendance:   { file: 'pages/attendance.html', title: 'Attendance',      section: 'Overview' },
        inventory:    { file: 'pages/inventory.html',  title: 'Inventory',       section: 'Overview' },
        registry:     { file: 'pages/patients.html',   title: 'Patient Records', section: 'Patient flow' },
        queue:        { file: 'pages/queue.html',      title: 'Waiting List',    section: 'Patient flow' },
        consultation: { file: 'pages/track.html',      title: 'Consultation',    section: 'Patient flow' },
        laboratory:   { file: 'pages/laboratory.html', title: 'Laboratory',      section: 'Clinical services' },
        nurse:        { file: 'pages/nurse.html',      title: 'Nurse Station',   section: 'Clinical services' },
        pharmacy:     { file: 'pages/pharmacy.html',   title: 'Pharmacy',        section: 'Clinical services' },
        billing:      { file: 'pages/billing.html',    title: 'Billing',         section: 'Front office' },
        archive:      { file: 'pages/storage.html',    title: 'Past Visits',     section: 'Administration' },
        manageStaff:  { file: 'pages/manage-staff.html', title: 'Manage Staff',  section: 'Administration' },
        profile:      { file: 'pages/profile.html',    title: 'My Profile',      section: 'Account' },
        settings:     { file: 'pages/settings.html',   title: 'Settings',        section: 'Administration' }
    };

    /* file name -> page key, for the guard that runs inside the iframe */
    var FILE_TO_KEY = {};
    Object.keys(PAGES).forEach(function (key) {
        FILE_TO_KEY[PAGES[key].file.replace(/^pages\//, '')] = key;
    });

    /* ==================================================================
       Roles

       pages         : what appears in the sidebar and is allowed to load
       landing       : where this role starts after signing in
       settingsScope : 'full' unlocks facility, clinical and data settings.
                       'preferences' is appearance and alerts only — every
                       role gets that much.
       ================================================================== */
    var ROLES = {
        admin: {
            key: 'admin',
            label: 'Administrator',
            short: 'Admin',
            icon: 'shield-check',
            summary: 'Oversees the hospital: dashboard, attendance, appointments, staff settings and data backup.',
            pages: ['dashboard', 'messages', 'attendance', 'appointments', 'inventory', 'manageStaff', 'settings', 'profile'],
            landing: 'dashboard',
            settingsScope: 'full'
        },
        doctor: {
            key: 'doctor',
            label: 'Doctor',
            short: 'Doctor',
            icon: 'stethoscope',
            summary: 'Clinical consultation desk only. Billing, laboratory, pharmacy, nurse, waiting list and patient records are out of scope.',
            pages: ['dashboard', 'messages', 'attendance', 'appointments', 'inventory',
                    'consultation', 'settings', 'profile'],
            landing: 'dashboard',
            settingsScope: 'preferences'
        },
        nurse: {
            key: 'nurse',
            label: 'Nurse',
            short: 'Nurse',
            icon: 'nurse',
            summary: 'Nurse station, patient tracking, pharmacy, waiting list and patient records.',
            pages: ['dashboard', 'messages', 'attendance', 'nurse', 'pharmacy', 'queue',
                    'registry', 'inventory', 'settings', 'profile'],
            landing: 'dashboard',
            settingsScope: 'preferences'
        },
        billing: {
            key: 'billing',
            label: 'Billing',
            short: 'Billing',
            icon: 'receipt',
            summary: 'Waiting list, billing desk, registration and patient records.',
            pages: ['dashboard', 'messages', 'attendance', 'queue', 'billing', 'registry', 'inventory', 'settings', 'profile'],
            landing: 'dashboard',
            settingsScope: 'preferences'
        },
        lab: {
            key: 'lab',
            label: 'Lab Assistant',
            short: 'Lab',
            icon: 'lab',
            summary: 'Laboratory worklist, specimen processing and release of results.',
            pages: ['dashboard', 'messages', 'attendance', 'laboratory', 'queue', 'registry', 'inventory', 'settings', 'profile'],
            landing: 'dashboard',
            settingsScope: 'preferences'
        }
    };

    var ROLE_ORDER = ['admin', 'doctor', 'nurse', 'billing', 'lab'];

    /* Default display name per role, used until Settings overrides it. */
    var DEFAULT_NAMES = {
        admin: 'Site Administrator',
        doctor: 'Dr. Sarah Chen',
        nurse: 'Nurse on Duty',
        billing: 'Billing Desk',
        lab: 'Lab Assistant'
    };

    /* ==================================================================
       Which roles should be told about which kind of alert

       Keyed on the notification category used by js/notifications.js. A
       nurse does not need billing alerts; reception does not need panic
       laboratory values. Anything not listed here goes to everyone.
       ================================================================== */
    var ALERT_AUDIENCE = {
        Vitals:      ['admin', 'doctor', 'nurse'],
        Lab:         ['admin', 'doctor', 'nurse', 'lab'],
        Pharmacy:    ['admin', 'doctor', 'nurse'],
        Inventory:   ['admin', 'doctor', 'nurse'],
        Queue:       ['admin', 'doctor', 'nurse', 'billing', 'lab'],
        Patient:     ['admin', 'doctor', 'nurse', 'billing', 'lab'],
        Doctor:      ['admin', 'doctor'],
        Billing:     ['admin', 'doctor', 'billing'],
        Staff:       ['admin'],
        Attendance:  ['admin'],
        Appointment: ['admin', 'doctor'],
        System:      ['admin', 'doctor', 'nurse', 'billing', 'lab']
    };

    /* ==================================================================
        Storage
        Guarded the same way as js/store.js: localStorage is unavailable on
        opaque origins and can be switched off in private windows.
        ================================================================== */
    var memory = {};

    function rawGet(key) {
        try {
            var v = window.localStorage.getItem(key);
            return v === null ? (memory[key] === undefined ? null : memory[key]) : v;
        } catch (e) {
            return memory[key] === undefined ? null : memory[key];
        }
    }

    function rawSet(key, value) {
        memory[key] = value;
        try { window.localStorage.setItem(key, value); } catch (e) {}
    }

    function rawRemove(key) {
        delete memory[key];
        try { window.localStorage.removeItem(key); } catch (e) {}
    }

    /* ==================================================================
        Server-backed session

        When the app is served by the hospital server, the browser-side
        session record is only a mirror of what the server knows. The API
        bearer token is the real proof of identity: it is verified against
        /api/auth/me once per page load, and signing out invalidates the
        token on the server so a copied token stops working everywhere.
        ================================================================== */
    var ON_SERVER = window.location.protocol === 'http:' || window.location.protocol === 'https:';
    var TOKEN_KEY = 'erp_token';

    function xhr(method, url, body) {
        try {
            var xhrReq = new XMLHttpRequest();
            xhrReq.open(method, url, false);
            var token = rawGet(TOKEN_KEY);
            if (token) xhrReq.setRequestHeader('Authorization', 'Bearer ' + token);
            if (body !== undefined) xhrReq.setRequestHeader('Content-Type', 'application/json');
            xhrReq.send(body === undefined ? null : JSON.stringify(body));
            return { status: xhrReq.status, text: xhrReq.responseText };
        } catch (e) {
            return { status: 0, text: '' };
        }
    }

    function clearStoredIdentity() {
        rawRemove(SESSION_KEY);
        rawRemove(TOKEN_KEY);
    }

    function reconcileWithServer() {
        if (!ON_SERVER) return;
        var res = xhr('GET', '/api/auth/me');
        if (res.status !== 200) {
            /* Expired, revoked or unreachable. A network failure (status 0)
               also blocks every data call, so treating it as signed-out keeps
               the UI honest instead of showing stale records as live. */
            clearStoredIdentity();
            return;
        }
        try {
            var me = JSON.parse(res.text).user;
            if (!me || !me.role) { clearStoredIdentity(); return; }
            var existing = readSession();
            rawSet(SESSION_KEY, JSON.stringify({
                role: normalizeRole(me.role),
                user: me.username || '',
                name: me.name || '',
                since: existing ? existing.since : new Date().toISOString()
            }));
        } catch (e) {
            clearStoredIdentity();
        }
    }

    /* ==================================================================
       Current session
       ================================================================== */
    function normalizeRole(value) {
        var key = String(value == null ? '' : value).trim().toLowerCase();
        if (ROLES[key]) return key;
        /* Tolerate the labels used by the staff directory and any roles that
           existed in older builds, so saved sessions and staff records keep
           working after a role is renamed. */
        if (key === 'registry' || key === 'reception' || key === 'cashier') return 'billing';
        if (key === 'clinician') return 'doctor';
        if (key === 'administrator') return 'admin';
        if (key === 'laboratory' || key === 'lab assistant' || key === 'labassistant') return 'lab';
        if (key === 'pharmacy' || key === 'pharmacist') return 'lab';
        return null;
    }

    function readSession() {
        var raw = rawGet(SESSION_KEY);
        if (!raw) return null;
        var parsed;
        try { parsed = JSON.parse(raw); } catch (e) { return null; }
        if (!parsed || typeof parsed !== 'object') return null;

        var role = normalizeRole(parsed.role);
        if (!role) return null;

        return {
            role: role,
            user: parsed.user || '',
            name: parsed.name || DEFAULT_NAMES[role],
            since: parsed.since || null
        };
    }

    function signIn(details) {
        var role = normalizeRole(details && details.role) || 'admin';
        var session = {
            role: role,
            user: (details && details.user) || '',
            name: (details && details.name) || DEFAULT_NAMES[role],
            since: new Date().toISOString()
        };
        rawSet(SESSION_KEY, JSON.stringify(session));
        return session;
    }

    function signOut() {
        /* Tell the server first, while the token is still in storage — this
           invalidates the session server-side so the token cannot be reused
           from this or any other workstation. */
        if (ON_SERVER) xhr('POST', '/api/auth/logout', {});
        clearStoredIdentity();
    }

    /* Falls back to administrator so a direct page open is never a blank
       screen during frontend development. */
    function role() {
        var s = readSession();
        return s ? s.role : 'admin';
    }

    function roleDefinition(key) {
        return ROLES[normalizeRole(key) || role()] || ROLES.admin;
    }

    function isSignedIn() {
        return !!readSession();
    }

    /* ==================================================================
       Permission checks
       ================================================================== */
    function allowedPages(roleKey) {
        return roleDefinition(roleKey).pages.slice();
    }

    function can(pageKey, roleKey) {
        return roleDefinition(roleKey).pages.indexOf(pageKey) !== -1;
    }

    function canOpenFile(file, roleKey) {
        var key = FILE_TO_KEY[String(file).replace(/^pages\//, '')];
        return key ? can(key, roleKey) : true;
    }

    function settingsScope(roleKey) {
        return roleDefinition(roleKey).settingsScope;
    }

    function hasFullSettings(roleKey) {
        return settingsScope(roleKey) === 'full';
    }

    function landingFile(roleKey) {
        var def = roleDefinition(roleKey);
        var key = def.landing;
        if (def.pages.indexOf(key) === -1) key = def.pages[0];
        return (PAGES[key] || PAGES.dashboard).file;
    }

    /* A notification may carry its own explicit audience list (an array of
       role keys). When it does, that list wins — it lets a single event reach
       exactly the ranks that should act on it (e.g. a "patient called" chime
       for the nurse and billing desk only) while still falling back to the
       category-based ALERT_AUDIENCE map when no explicit audience is set. */
    function wantsAlert(itemOrCategory, roleKey) {
        var item = (itemOrCategory && typeof itemOrCategory === 'object') ? itemOrCategory : { category: itemOrCategory };
        var rk = normalizeRole(roleKey) || role();
        if (Array.isArray(item.audience)) return item.audience.indexOf(rk) !== -1;
        var list = ALERT_AUDIENCE[item.category];
        if (!list) return true;
        return list.indexOf(rk) !== -1;
    }

    /* ==================================================================
       Page guard

       Department pages load inside #content-frame. If someone reaches a
       page their role does not cover — an old bookmark, a stale frame, a
       hand-typed URL — replace the content rather than letting a screen
       render data the role should not see.
       ================================================================== */
    function currentPageKey() {
        var file = String(window.location.pathname || '').split('/').pop();
        return FILE_TO_KEY[file] || null;
    }

    function denyMarkup(def) {
        var icon = window.MediIcons ? window.MediIcons.svg('lock', 24) : '';
        return '<div class="page">' +
            '<div class="access-denied">' +
                '<span class="ad-icon">' + icon + '</span>' +
                '<h1>You do not have access to this page</h1>' +
                '<p>You are signed in as <strong>' + def.label + '</strong>. ' +
                   def.summary + '</p>' +
                '<p class="ad-hint">Ask an administrator if you need this page added to your role.</p>' +
            '</div>' +
        '</div>';
    }

    function guard() {
        var key = currentPageKey();
        if (!key || can(key)) return true;

        var def = roleDefinition();
        function paint() {
            document.body.innerHTML = denyMarkup(def);
            if (window.MediIcons) window.MediIcons.hydrate(document.body);
        }
        if (document.body) paint();
        else document.addEventListener('DOMContentLoaded', paint);
        return false;
    }

    /* ==================================================================
       Public
       ================================================================== */
    window.MediSession = {
        PAGES: PAGES,
        ROLES: ROLES,
        ROLE_ORDER: ROLE_ORDER,
        ALERT_AUDIENCE: ALERT_AUDIENCE,

        read: readSession,
        signIn: signIn,
        signOut: signOut,
        isSignedIn: isSignedIn,
        role: role,
        roleDefinition: roleDefinition,
        normalizeRole: normalizeRole,

        allowedPages: allowedPages,
        can: can,
        canOpenFile: canOpenFile,
        settingsScope: settingsScope,
        hasFullSettings: hasFullSettings,
        landingFile: landingFile,
        wantsAlert: wantsAlert,

        currentPageKey: currentPageKey,
        guard: guard
    };

    /* Pages guard themselves as soon as this file runs, so a disallowed
       screen never gets the chance to paint patient data. Before guarding,
       confirm with the hospital server that this browser really holds a live
       session — an expired or revoked token sends the user back to sign-in.
       The sign-in screen is exempt, or it would reload in a loop. */
    var onSignInScreen = /(^|\/)index\.html$/.test(window.location.pathname) ||
        window.location.pathname === '/' || window.location.pathname === '';
    if (ON_SERVER) reconcileWithServer();
    if (ON_SERVER && !isSignedIn() && !onSignInScreen) {
        window.location.replace('/index.html');
    } else {
        guard();
    }
})(window, document);
