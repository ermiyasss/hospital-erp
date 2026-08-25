/* ==========================================================================
   MediTrack Hospital ERP - Session & Role Access

   This build has no server, so "who is signed in" is a value in localStorage
   chosen at the sign-in screen. That is honest about what it is: a way to see
   the application from each role's point of view, not a security boundary.
   Anyone who can open the developer tools can change it.

   Real enforcement has to live in the backend. What this file does provide is
   the single list of what each role is allowed to see, so the sidebar, the
   page guard and the alert routing can never disagree with each other.

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
        registry:     { file: 'pages/patients.html',   title: 'Patient Records', section: 'Patient flow' },
        queue:        { file: 'pages/queue.html',      title: 'Waiting List',    section: 'Patient flow' },
        consultation: { file: 'pages/track.html',      title: 'Consultation',    section: 'Patient flow' },
        laboratory:   { file: 'pages/laboratory.html', title: 'Laboratory',      section: 'Clinical services' },
        nurse:        { file: 'pages/nurse.html',      title: 'Nurse Station',   section: 'Clinical services' },
        pharmacy:     { file: 'pages/pharmacy.html',   title: 'Pharmacy',        section: 'Clinical services' },
        billing:      { file: 'pages/billing.html',    title: 'Billing',         section: 'Front office' },
        archive:      { file: 'pages/storage.html',    title: 'Past Visits',     section: 'Administration' },
        staff:        { file: 'pages/staff.html',      title: 'Staff',           section: 'Administration' },
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
            summary: 'Full access to every screen, including past visits and staff records.',
            pages: ['dashboard', 'registry', 'queue', 'consultation', 'laboratory',
                    'nurse', 'pharmacy', 'billing', 'archive', 'staff', 'settings'],
            landing: 'dashboard',
            settingsScope: 'full'
        },
        doctor: {
            key: 'doctor',
            label: 'Doctor',
            short: 'Doctor',
            icon: 'stethoscope',
            summary: 'Full access apart from the past visits archive.',
            pages: ['dashboard', 'registry', 'queue', 'consultation', 'laboratory',
                    'nurse', 'pharmacy', 'billing', 'staff', 'settings'],
            landing: 'dashboard',
            settingsScope: 'full'
        },
        nurse: {
            key: 'nurse',
            label: 'Nurse',
            short: 'Nurse',
            icon: 'nurse',
            summary: 'Nurse station, pharmacy, waiting list and patient records.',
            pages: ['nurse', 'pharmacy', 'queue', 'registry', 'settings'],
            landing: 'nurse',
            settingsScope: 'full'
        },
        reception: {
            key: 'reception',
            label: 'Reception',
            short: 'Reception',
            icon: 'patients',
            summary: 'Waiting list, billing and patient records.',
            pages: ['queue', 'billing', 'registry', 'settings'],
            landing: 'queue',
            settingsScope: 'full'
        }
    };

    var ROLE_ORDER = ['admin', 'doctor', 'nurse', 'reception'];

    /* Default display name per role, used until Settings overrides it. */
    var DEFAULT_NAMES = {
        admin: 'Site Administrator',
        doctor: 'Dr. Sarah Chen',
        nurse: 'Nurse on Duty',
        reception: 'Reception Desk'
    };

    /* ==================================================================
       Which roles should be told about which kind of alert

       Keyed on the notification category used by js/notifications.js. A
       nurse does not need billing alerts; reception does not need panic
       laboratory values. Anything not listed here goes to everyone.
       ================================================================== */
    var ALERT_AUDIENCE = {
        Vitals:    ['admin', 'doctor', 'nurse'],
        Lab:       ['admin', 'doctor', 'nurse'],
        Pharmacy:  ['admin', 'doctor', 'nurse'],
        Inventory: ['admin', 'doctor', 'nurse'],
        Queue:     ['admin', 'doctor', 'nurse', 'reception'],
        Patient:   ['admin', 'doctor', 'nurse', 'reception'],
        Doctor:    ['admin', 'doctor'],
        Billing:   ['admin', 'doctor', 'reception'],
        Staff:     ['admin'],
        System:    ['admin', 'doctor', 'nurse', 'reception']
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
       Current session
       ================================================================== */
    function normalizeRole(value) {
        var key = String(value == null ? '' : value).trim().toLowerCase();
        if (ROLES[key]) return key;
        /* Tolerate the labels used by the staff directory. */
        if (key === 'registry') return 'reception';
        if (key === 'clinician') return 'doctor';
        if (key === 'administrator') return 'admin';
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
        rawRemove(SESSION_KEY);
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

    function wantsAlert(category, roleKey) {
        var list = ALERT_AUDIENCE[category];
        if (!list) return true;
        return list.indexOf(normalizeRole(roleKey) || role()) !== -1;
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
       screen never gets the chance to paint patient data. */
    guard();
})(window, document);
