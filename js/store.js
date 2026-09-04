/* ==========================================================================
   MediTrack Hospital ERP - Shared Data Layer

   Every page previously parsed localStorage on its own, with slightly
   different assumptions about field names, urgency labels and statuses. That
   is where most of the inconsistent behaviour came from (a patient marked
   "Non-Urgent" in the queue showing as unranked in tracking, vitals stored as
   a "135/88" string in one place and as numbers in another).

   This module is the single source of truth:
     - canonical urgency  : Emergency | Urgent | Routine
     - canonical status   : Pending | In Consultation | Awaiting Results | Finished
     - canonical vitals   : numeric object, legacy strings migrated on read
     - queue order        : triage priority, then arrival time (never shuffled)

   No framework, no build step, safe to load from file:// offline.
   ========================================================================== */

(function (window) {
    'use strict';

    var KEYS = {
        patients: 'clinic_patients_data',
        labRequests: 'clinic_lab_requests',
        labArchive: 'clinic_lab_archive',
        prescriptions: 'clinic_prescriptions_data',
        nurseTasks: 'clinic_nurse_tasks',
        inventory: 'clinic_storage_items',
        staff: 'clinic_staff_data',
        settings: 'clinic_settings',
        notifications: 'clinic_notifications_log',
        invoices: 'clinic_invoices',
        priceList: 'clinic_price_list',
        messages: 'clinic_messages',
        groups: 'clinic_groups',
        staffMembers: 'clinic_staff_members',
        chatHidden: 'clinic_chat_hidden',
        appointments: 'clinic_appointments',
        beds: 'clinic_beds',
        profiles: 'clinic_profiles',
        attendance: 'clinic_attendance',
        inventory: 'clinic_inventory',
        seeded: 'clinic_seeded'
    };

    /* Canonical vocabularies -------------------------------------------- */
    var URGENCY = { EMERGENCY: 'Emergency', URGENT: 'Urgent', ROUTINE: 'Routine' };
    var STATUS = {
        NURSE_TRIAGE: 'Awaiting Nurse Triage',
        PENDING: 'Pending',
        CONSULTING: 'In Consultation',
        AWAITING: 'Awaiting Results',
        AWAITING_PAYMENT: 'Awaiting Payment',
        FINISHED: 'Finished'
    };

    var URGENCY_RANK = { Emergency: 0, Urgent: 1, Routine: 2 };

    /* Historic spellings that must keep working after an upgrade. */
    var URGENCY_ALIASES = {
        emergency: URGENCY.EMERGENCY,
        critical: URGENCY.EMERGENCY,
        immediate: URGENCY.EMERGENCY,
        urgent: URGENCY.URGENT,
        high: URGENCY.URGENT,
        priority: URGENCY.URGENT,
        routine: URGENCY.ROUTINE,
        'non-urgent': URGENCY.ROUTINE,
        nonurgent: URGENCY.ROUTINE,
        normal: URGENCY.ROUTINE,
        medium: URGENCY.ROUTINE,
        low: URGENCY.ROUTINE,
        standard: URGENCY.ROUTINE
    };

    var STATUS_ALIASES = {
        'awaiting nurse triage': STATUS.NURSE_TRIAGE,
        'nurse triage': STATUS.NURSE_TRIAGE,
        pending: STATUS.PENDING,
        waiting: STATUS.PENDING,
        queued: STATUS.PENDING,
        'in treatment': STATUS.CONSULTING,
        'in consultation': STATUS.CONSULTING,
        consulting: STATUS.CONSULTING,
        active: STATUS.CONSULTING,
        'awaiting results': STATUS.AWAITING,
        'awaiting lab': STATUS.AWAITING,
        'awaiting labs': STATUS.AWAITING,
        parked: STATUS.AWAITING,
        'awaiting payment': STATUS.AWAITING_PAYMENT,
        unpaid: STATUS.AWAITING_PAYMENT,
        'at billing': STATUS.AWAITING_PAYMENT,
        finished: STATUS.FINISHED,
        completed: STATUS.FINISHED,
        discharged: STATUS.FINISHED,
        archived: STATUS.FINISHED
    };

    /* --------------------------------------------------------------- utils */
    function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

    /* ------------------------------------------------------------- storage */
    /* Some browsers refuse localStorage on file:// (opaque origin), and private
       windows can refuse it outright. Rather than letting every screen throw on
       first access, fall back to an in-memory store for the session and tell the
       user their work will not survive a reload. */
    var memory = {};
    var persistent = null;      /* null = not yet probed */

    function storageAvailable() {
        if (persistent !== null) return persistent;
        try {
            var probe = '__meditrack_probe__';
            window.localStorage.setItem(probe, '1');
            window.localStorage.removeItem(probe);
            persistent = true;
        } catch (e) {
            persistent = false;
        }
        return persistent;
    }

    function rawGet(key) {
        if (!storageAvailable()) return memory[key] === undefined ? null : memory[key];
        try { return window.localStorage.getItem(key); } catch (e) { return null; }
    }

    function rawSet(key, value) {
        if (!storageAvailable()) { memory[key] = value; return true; }
        try {
            window.localStorage.setItem(key, value);
            return true;
        } catch (e) {
            /* Quota exceeded: keep the session usable in memory. */
            memory[key] = value;
            return false;
        }
    }

    function rawRemove(key) {
        delete memory[key];
        if (!storageAvailable()) return;
        try { window.localStorage.removeItem(key); } catch (e) {}
    }

    /* Session-scoped handoff between screens (which patient to open). */
    function sessionGet(key) {
        try { return window.sessionStorage.getItem(key); } catch (e) { return memory['__s_' + key] || null; }
    }

    function sessionSet(key, value) {
        try { window.sessionStorage.setItem(key, value); } catch (e) { memory['__s_' + key] = value; }
    }

    function sessionRemove(key) {
        try { window.sessionStorage.removeItem(key); } catch (e) { delete memory['__s_' + key]; }
    }

    /* ==================================================================
       LAN server transport

       When this app is served over http(s) by server.js, every hospital
       collection lives in the server's SQLite database and this browser is
       only a cache. The single source of truth is always the server:

         - on load      : one snapshot fetch fills the cache (/api/state)
         - on write     : the cache updates immediately (UI stays snappy)
                          and an authenticated PUT persists to the server
         - other devices: a light version poll notices changes and fires the
                          same events the old cross-tab localStorage sync
                          used, so no page component needed rewriting

       Preferences under 'clinic_settings' (theme, accent, sound…) are NOT
       hospital data and deliberately stay in this browser only.
       ================================================================== */
    var TOKEN_KEY = 'erp_token';
    var SERVER_MODE = false;
    try {
        SERVER_MODE = window.location.protocol === 'http:' || window.location.protocol === 'https:';
    } catch (e) { SERVER_MODE = false; }

    var serverVersion = -1;
    var serverCache = {};        /* storage key -> array */
    var serverScalarCache = {};  /* storage key -> string */
    var serverManaged = {};      /* keys the server stores at all */
    var serverGranted = {};      /* keys the server sent to THIS role */
    var serverReachable = true;
    var pollTimer = null;

    var OFFLINE_TEXT = 'Unable to reach the hospital server. Check the network connection — ' +
        'changes cannot be saved until it is back.';

    function authToken() {
        if (!storageAvailable()) return memory[TOKEN_KEY] || null;
        try { return window.localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
    }

    function setAuthToken(token) {
        if (token === null || token === undefined) { rawRemove(TOKEN_KEY); return; }
        rawSet(TOKEN_KEY, token);
    }

    function authHeaders(extra) {
        var h = extra || {};
        h['Authorization'] = 'Bearer ' + (authToken() || '');
        return h;
    }

    /* Synchronous request — used only for the initial snapshot so that every
       page keeps reading its data synchronously exactly as before. */
    function xhrSync(method, url, body) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, false);
            xhr.setRequestHeader('Authorization', 'Bearer ' + (authToken() || ''));
            if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(body === undefined ? null : JSON.stringify(body));
            return { status: xhr.status, text: xhr.responseText };
        } catch (e) {
            return { status: 0, text: '' };
        }
    }

    function sessionExpired() {
        setAuthToken(null);
        try { window.localStorage.removeItem('meditrack_session'); } catch (e) {}
        try {
            if (window.top && window.top !== window.self) window.top.location.href = '/index.html';
            else window.location.href = '/index.html';
        } catch (e) {}
    }

    /* A red strip pinned to the top of whatever screen is open. */
    function connectionBanner(text, sticky) {
        var id = 'meditrack-connection-banner';
        var el = document.getElementById(id);
        if (!text) {
            if (el && el.parentNode) el.parentNode.removeChild(el);
            return;
        }
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
                'background:#A31B22;color:#fff;padding:9px 16px;font-size:13px;' +
                'font-family:sans-serif;text-align:center;';
            (document.body || document.documentElement).appendChild(el);
        }
        el.textContent = text;
        if (!sticky) setTimeout(function () { connectionBanner(null); }, 6000);
    }

    function applyStatePayload(payload) {
        var changed = [];
        serverVersion = payload.version;

        /* Which keys the server stores at all, and which it handed to this
           role. The two together let serverWrite() block a write that would
           otherwise replace a withheld collection with an empty list. */
        serverManaged = {};
        (payload.managed || []).forEach(function (k) { serverManaged[k] = true; });
        serverGranted = {};
        Object.keys(payload.collections || {}).forEach(function (k) { serverGranted[k] = true; });

        Object.keys(payload.collections || {}).forEach(function (key) {
            var incoming = payload.collections[key];
            if (key === 'clinic_queue_policy') {
                if (String(incoming) !== String(serverScalarCache[key])) changed.push(key);
                serverScalarCache[key] = incoming;
                return;
            }
            var prev = JSON.stringify(serverCache[key] || []);
            var next = JSON.stringify(incoming === undefined ? [] : incoming);
            if (prev !== next) changed.push(key);
            serverCache[key] = incoming === undefined ? [] : incoming;
        });
        serverReachable = true;
        connectionBanner(null);
        return changed;
    }

    /* Fire the same signals pages already listen to. */
    function announceChanges(keys) {
        keys.forEach(function (key) {
            try { window.dispatchEvent(new StorageEvent('storage', { key: key })); } catch (e) {}
        });
        if (keys.indexOf('clinic_patients_data') !== -1 ||
            keys.indexOf('clinic_lab_requests') !== -1 ||
            keys.indexOf('clinic_queue_policy') !== -1) {
            try { window.dispatchEvent(new CustomEvent('meditrack:patients-updated')); } catch (e) {}
        }
    }

    function refreshFromServer(thenAnnounce) {
        return fetch('/api/state', { headers: authHeaders() })
            .then(function (r) {
                if (r.status === 401) { sessionExpired(); return null; }
                return r.json().then(function (j) { return { ok: r.status === 200, j: j }; });
            })
            .then(function (out) {
                if (!out) return;
                if (!out.ok) throw new Error(out.j && out.j.error);
                var changed = applyStatePayload(out.j);
                if (thenAnnounce && changed.length) announceChanges(changed);
                else if (thenAnnounce) announceChanges([]);   /* repaint anyway */
            })
            .catch(function () {
                serverReachable = false;
                connectionBanner(OFFLINE_TEXT, true);
            });
    }

    function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(function () {
            fetch('/api/version', { headers: authHeaders() })
                .then(function (r) {
                    if (r.status === 401) { sessionExpired(); return null; }
                    return r.json();
                })
                .then(function (j) {
                    if (!j) return;
                    serverReachable = true;
                    connectionBanner(null);
                    if (Number(j.version) !== serverVersion) refreshFromServer(true);
                })
                .catch(function () {
                    if (serverReachable) {
                        serverReachable = false;
                        connectionBanner(OFFLINE_TEXT, true);
                    }
                });
        }, 4000);
    }

    function persistToServer(key, value) {
        fetch('/api/data/' + encodeURIComponent(key), {
            method: 'PUT',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(value)
        })
            .then(function (r) {
                return r.json().then(function (j) { return { status: r.status, j: j }; });
            })
            .then(function (out) {
                if (out.status === 200) {
                    serverVersion = Number(out.j.version);
                    if (!serverReachable) { serverReachable = true; connectionBanner(null); }
                } else if (out.status === 401) {
                    sessionExpired();
                } else {
                    /* Rejected by validation or permissions: the local edit is
                       NOT authoritative — pull the server copy back over it. */
                    connectionBanner((out.j && out.j.error) || 'The server rejected this change.');
                    refreshFromServer(true);
                }
            })
            .catch(function () {
                serverReachable = false;
                connectionBanner(OFFLINE_TEXT, true);
                /* Keep retrying through the poll loop; when connectivity
                   returns the version poll reconciles the data. */
            });
    }

    function hydrateOnLoad() {
        var res = xhrSync('GET', '/api/state');
        if (res.status === 200) {
            try {
                applyStatePayload(JSON.parse(res.text));
            } catch (e) {
                serverReachable = false;
            }
        } else if (res.status === 401) {
            sessionExpired();
        } else {
            serverReachable = false;
        }
        startPolling();
    }

    function documentReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else { fn(); }
    }

    if (SERVER_MODE) {
        hydrateOnLoad();
        if (!serverReachable) {
            documentReady(function () { connectionBanner(OFFLINE_TEXT, true); });
        }
    }

    /* Server-mode implementations of read/write below branch on these. */
    function serverRead(key) {
        return (key in serverCache) ? JSON.parse(JSON.stringify(serverCache[key])) : [];
    }

    function serverWrite(key, value) {
        /* The server withholds collections a role is not cleared for, and
           serverRead() then reports them as empty. Persisting that empty list
           back would erase the real data for everyone, so a write to a
           server-managed key this role was never granted is refused outright
           and the authoritative copy is pulled back over it. */
        if (serverManaged[key] && !serverGranted[key]) {
            connectionBanner('Your role cannot change "' + key + '". The server copy has been restored.', true);
            refreshFromServer(true);
            return false;
        }
        serverCache[key] = JSON.parse(JSON.stringify(value));
        persistToServer(key, value);
        return true;
    }

    /* Shown once per page so the operator knows records are volatile. */
    function warnIfVolatile() {
        if (storageAvailable() || warnIfVolatile.done) return;
        warnIfVolatile.done = true;
        if (!window.MediTrackNotify) return;
        window.MediTrackNotify.push(
            'Storage unavailable',
            'This browser is blocking local storage, so records will be lost when the page is closed. ' +
            'Serve the application over http:// on the workstation instead of opening the file directly.',
            'error', 'System', 'critical'
        );
    }

    function read(key) {
        if (SERVER_MODE) return serverRead(key);
        try {
            var parsed = JSON.parse(rawGet(key) || '[]');
            return isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function write(key, value) {
        if (SERVER_MODE) return serverWrite(key, value);
        var ok = rawSet(key, JSON.stringify(value));
        warnIfVolatile();
        return ok;
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function toNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        var n = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? null : n;
    }

    function initials(name) {
        if (!name) return 'PT';
        var parts = String(name).trim().split(/\s+/).slice(0, 2);
        var out = parts.map(function (p) { return p.charAt(0); }).join('');
        return (out || 'PT').toUpperCase();
    }

    /* ------------------------------------------------------- phone numbers */
    /* Ethiopian mobile and landline numbers are ten digits starting with 09,
       07 (mobile) or 011 and similar (landline) — always a leading zero. Staff
       type them in every imaginable spacing, and previous visits are matched on
       the number, so it is stored as bare digits and only formatted for display.

       +251 is accepted on input and converted, because that is what people copy
       out of their contacts. */
    var PHONE_LENGTH = 10;

    function phoneDigits(value) {
        var digits = String(value == null ? '' : value).replace(/\D/g, '');

        /* 251912345678 -> 0912345678 */
        if (digits.length > PHONE_LENGTH && digits.indexOf('251') === 0) {
            digits = '0' + digits.slice(3);
        }
        /* 912345678 -> 0912345678, for people who drop the leading zero. */
        if (digits.length === PHONE_LENGTH - 1 && digits.charAt(0) !== '0') {
            digits = '0' + digits;
        }
        return digits.slice(0, PHONE_LENGTH);
    }

    function isValidPhone(value) {
        var d = phoneDigits(value);
        return d.length === PHONE_LENGTH && d.charAt(0) === '0';
    }

    /* 0912 345 678 — grouped the way it is read aloud. */
    function formatPhone(value) {
        var d = phoneDigits(value);
        if (d.length !== PHONE_LENGTH) return d || '';
        return d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7);
    }

    /* ---------------------------------------------------- medicine amounts */
    /* Prescribing used to record only a dose ("500 mg"), which left the
       dispensary guessing how much to actually hand over. A prescription now
       carries a countable amount and the form it comes in, so "10" is never
       ambiguous: 10 tablets, 10 pieces, 10 mL.

       `unit` is what gets printed after the number. `step` allows halves where
       splitting is normal practice (tablets) and whole numbers where it is not
       (capsules, vials). */
    var MED_FORMS = {
        Tablet:       { label: 'Tablet',       unit: 'tablets',      short: 'tab',    step: 0.5 },
        Capsule:      { label: 'Capsule',      unit: 'capsules',     short: 'cap',    step: 1 },
        Piece:        { label: 'Piece',        unit: 'pieces',       short: 'pcs',    step: 1 },
        Syrup:        { label: 'Syrup',        unit: 'mL',           short: 'mL',     step: 1 },
        Suspension:   { label: 'Suspension',   unit: 'mL',           short: 'mL',     step: 1 },
        Drops:        { label: 'Drops',        unit: 'mL',           short: 'mL',     step: 1 },
        Injection:    { label: 'Injection',    unit: 'ampoules',     short: 'amp',    step: 1 },
        Vial:         { label: 'Vial',         unit: 'vials',        short: 'vial',   step: 1 },
        Sachet:       { label: 'Sachet',       unit: 'sachets',      short: 'sachet', step: 1 },
        Suppository:  { label: 'Suppository',  unit: 'suppositories',short: 'supp',   step: 1 },
        Cream:        { label: 'Cream',        unit: 'tubes',        short: 'tube',   step: 1 },
        Inhaler:      { label: 'Inhaler',      unit: 'inhalers',     short: 'inh',    step: 1 }
    };

    var MED_FORM_ORDER = ['Tablet', 'Capsule', 'Piece', 'Syrup', 'Suspension', 'Drops',
                          'Injection', 'Vial', 'Sachet', 'Suppository', 'Cream', 'Inhaler'];

    function medForm(form) {
        return MED_FORMS[form] || { label: form || 'Unit', unit: 'units', short: 'unit', step: 1 };
    }

    /* "10 tablets", "1 tablet", "120 mL". Volumes are never singularised. */
    function formatMedAmount(count, form) {
        var n = toNumber(count);
        if (n === null) return '';
        var unit = medForm(form).unit;

        if (n === 1 && unit !== 'mL') {
            /* tablets -> tablet, suppositories -> suppository */
            unit = unit === 'suppositories' ? 'suppository' : unit.replace(/s$/, '');
        }
        return n + ' ' + unit;
    }

    /* What the dispensary is expected to hand over for the whole course:
       amount per dose x doses per day x days. Returns null when the
       prescription does not carry enough information to work it out. */
    var DOSES_PER_DAY = { QD: 1, BID: 2, TID: 3, QID: 4, STAT: 1 };

    function courseQuantity(rx) {
        var perDose = toNumber(rx && rx.amount);
        if (perDose === null || perDose <= 0) return null;

        var perDay = DOSES_PER_DAY[rx.frequency];
        if (!perDay) return null;                 /* PRN: as required, so unknown */

        var days = toNumber(String(rx.duration || '').replace(/[^0-9.]/g, ''));
        if (rx.frequency === 'STAT') days = 1;
        if (days === null || days <= 0) return null;

        return Math.ceil(perDose * perDay * days);
    }

    /* ------------------------------------------------------------- money */
    /* Amounts are held as numbers and only ever formatted here, so every
       screen shows the same currency and the same two decimal places. */
    var CURRENCY = 'ETB';

    function formatMoney(amount) {
        var n = toNumber(amount);
        if (n === null) n = 0;
        var fixed = Math.abs(n).toFixed(2);
        var parts = fixed.split('.');
        /* Thousands separators without Intl, which behaves inconsistently
           across the offline browsers this may be opened in. */
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (n < 0 ? '-' : '') + CURRENCY + ' ' + parts.join('.');
    }

    function normalizeUrgency(value) {
        var key = String(value == null ? '' : value).trim().toLowerCase();
        return URGENCY_ALIASES[key] || URGENCY.ROUTINE;
    }

    function normalizeStatus(value) {
        var key = String(value == null ? '' : value).trim().toLowerCase();
        return STATUS_ALIASES[key] || STATUS.PENDING;
    }

    function urgencyRank(urgency) {
        var r = URGENCY_RANK[normalizeUrgency(urgency)];
        return r === undefined ? 2 : r;
    }

    /* ------------------------------------------------------------- dates */
    function parseDate(value) {
        if (!value) return null;
        var d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }

    /* All timestamps are stored as UTC. The hospital runs on East Africa Time
       (Addis Ababa, UTC+3), so display them in that zone everywhere instead of
       the browser's local clock — the ward clock must read the same in every
       workstation. */
    var EAT_ZONE = 'Africa/Addis_Ababa';

    function formatDate(value) {
        var d = parseDate(value);
        if (!d) return '—';
        try {
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: EAT_ZONE });
        } catch (e) {
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
    }

    function formatTime(value) {
        var d = parseDate(value);
        if (!d) return '—';
        try {
            return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: EAT_ZONE }) + ' EAT';
        } catch (e) {
            var h = (d.getUTCHours() + 3) % 24;
            var m = String(d.getUTCMinutes()).padStart(2, '0');
            return String(h).padStart(2, '0') + ':' + m + ' EAT';
        }
    }

    function formatDateTime(value) {
        var d = parseDate(value);
        if (!d) return '—';
        return formatDate(value) + ' · ' + formatTime(value);
    }

    /* Elapsed time in the compact form clinicians expect: 4m, 1h 20m. */
    function elapsed(since, until) {
        var start = parseDate(since);
        if (!start) return '—';
        var end = parseDate(until) || new Date();
        var mins = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm';
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        return m ? h + 'h ' + m + 'm' : h + 'h';
    }

    function relativeTime(value) {
        var d = parseDate(value);
        if (!d) return '—';
        var secs = Math.floor((Date.now() - d.getTime()) / 1000);
        if (secs < 45) return 'just now';
        if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
        if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
        return formatDate(value);
    }

    /* ------------------------------------------------------------ vitals */
    /* Legacy records stored blood pressure as "135/88" and pulse as `hr`. */
    function normalizeVitals(patient) {
        var v = (patient && patient.vitals && typeof patient.vitals === 'object') ? patient.vitals : {};
        var out = {
            systolic: toNumber(v.systolic),
            diastolic: toNumber(v.diastolic),
            pulse: toNumber(v.pulse),
            temperature: toNumber(v.temperature),
            spo2: toNumber(v.spo2),
            respRate: toNumber(v.respRate),
            glucose: toNumber(v.glucose),
            weight: toNumber(v.weight),
            height: toNumber(v.height)
        };

        if ((out.systolic === null || out.diastolic === null) && patient && patient.bp) {
            var parts = String(patient.bp).split('/');
            if (out.systolic === null) out.systolic = toNumber(parts[0]);
            if (out.diastolic === null) out.diastolic = toNumber(parts[1]);
        }
        if (out.pulse === null && patient) out.pulse = toNumber(patient.hr || patient.pulse);
        if (out.temperature === null && patient) out.temperature = toNumber(patient.temp);
        if (out.spo2 === null && patient) out.spo2 = toNumber(patient.spo2);
        if (out.respRate === null && patient) out.respRate = toNumber(patient.respRate || patient.rr);
        if (out.glucose === null && patient) out.glucose = toNumber(patient.glucose);
        if (out.weight === null && patient) out.weight = toNumber(patient.weight);
        if (out.height === null && patient) out.height = toNumber(patient.height);

        return out;
    }

    function bloodPressureText(vitals) {
        if (!vitals) return '—';
        if (vitals.systolic === null || vitals.diastolic === null) return '—';
        return Math.round(vitals.systolic) + '/' + Math.round(vitals.diastolic);
    }

    function bmi(weightKg, heightCm) {
        var w = toNumber(weightKg);
        var h = toNumber(heightCm);
        if (!w || !h || h <= 0) return null;
        var m = h / 100;
        var value = w / (m * m);
        var category = 'Normal';
        if (value < 18.5) category = 'Underweight';
        else if (value >= 30) category = 'Obese';
        else if (value >= 25) category = 'Overweight';
        return { value: Math.round(value * 10) / 10, category: category };
    }

    /* ----------------------------------------------------------- patients */
    var seedCounter = 0;
    var idCounter = 0;

    /* Tracking IDs are read aloud when calling patients, so they must be short
       and unambiguous, but they are also the key staff use to match a specimen
       to a person — a collision would be a patient-safety incident. Timestamp
       plus a per-session counter plus randomness makes one practically
       impossible, even when registering several patients in the same second. */
    function generateTrackingId() {
        var stamp = Date.now().toString(36).toUpperCase().slice(-5);
        var seq = ((++idCounter) % 1296).toString(36).toUpperCase();
        while (seq.length < 2) seq = '0' + seq;
        var rand = Math.floor(Math.random() * 46656).toString(36).toUpperCase();
        while (rand.length < 3) rand = '0' + rand;
        return 'TRK-' + stamp + seq + rand;
    }

    function normalizePatient(raw) {
        var p = raw && typeof raw === 'object' ? raw : {};

        var patient = {
            id: p.id !== undefined && p.id !== null ? p.id : (Date.now() + (++seedCounter)),
            trackingId: p.trackingId || generateTrackingId(),
            name: p.name || 'Unnamed patient',
            age: toNumber(p.age),
            sex: p.sex || p.gender || '',
            /* Stored as bare digits so previous visits match regardless of how
               the number was typed. Screens call formatPhone() to display it. */
            phone: phoneDigits(p.phone),
            urgency: normalizeUrgency(p.urgency),
            status: normalizeStatus(p.status),
            description: p.description || p.complaint || '',
            preferredDoctor: p.preferredDoctor || null,
            registered: p.registered || p.registeredAt || new Date().toISOString(),
            calledAt: p.calledAt || null,
            nurseTriagedAt: p.nurseTriagedAt || null,
            nurseTriagedBy: p.nurseTriagedBy || null,
            completedAt: p.completedAt || null,
            clinicalNotes: isArray(p.clinicalNotes) ? p.clinicalNotes : [],
            labOrders: isArray(p.labOrders) ? p.labOrders : [],
            nurseOrders: isArray(p.nurseOrders) ? p.nurseOrders : [],
            prescriptions: isArray(p.prescriptions) ? p.prescriptions : [],
            medicationHistory: isArray(p.medicationHistory) ? p.medicationHistory : [],
            assist: p.assist || null,
            vitalsAlerted: p.vitalsAlerted || null
        };

        patient.vitals = normalizeVitals(p);
        patient.weight = patient.vitals.weight;
        patient.height = patient.vitals.height;

        /* Compatibility migration: records created before nurse-first triage
           used Pending for every unreleased patient. Only move records with
           no nurse release and no consultation start; released or active
           consultations must remain in their current workflow stage. */
        if (patient.status === STATUS.PENDING && !p.nurseTriagedAt && !p.calledAt) {
            patient.status = STATUS.NURSE_TRIAGE;
        }

        /* Mirror blood pressure back as a display string for older templates. */
        patient.bp = bloodPressureText(patient.vitals);
        patient.hr = patient.vitals.pulse;

        return patient;
    }

    function readPatients() {
        return read(KEYS.patients).map(normalizePatient);
    }

    function writePatients(patients) {
        var clean = (patients || []).map(normalizePatient);
        var ok = write(KEYS.patients, clean);
        /* Same-tab listeners: the native storage event only fires cross-tab. */
        try {
            window.dispatchEvent(new CustomEvent('meditrack:patients-updated'));
        } catch (e) {}
        return ok;
    }

    function findPatient(patients, id) {
        for (var i = 0; i < patients.length; i++) {
            /* IDs arrive as both numbers and strings depending on the source. */
            if (String(patients[i].id) === String(id)) return patients[i];
        }
        return null;
    }

    function nextPatientId(patients) {
        var max = 0;
        (patients || []).forEach(function (p) {
            var n = toNumber(p.id);
            if (n !== null && n > max) max = n;
        });
        return max + 1;
    }

    /* Patients still inside the care pathway. */
    function activePatients(patients) {
        return (patients || []).filter(function (p) { return p.status !== STATUS.FINISHED; });
    }

    /* ------------------------------------------------------- queue policy */
    /* The triage queue owns the calling order. Consultation only reads it, so
       the policy lives here and is persisted, not held in page state. */
    var QUEUE_POLICY_KEY = 'clinic_queue_policy';
    var POLICIES = { PRIORITY: 'priority_first', FIFO: 'arrival_order' };

    function queuePolicy() {
        if (SERVER_MODE) {
            return serverScalarCache[QUEUE_POLICY_KEY] === POLICIES.FIFO
                ? POLICIES.FIFO : POLICIES.PRIORITY;
        }
        var v = rawGet(QUEUE_POLICY_KEY);
        return v === POLICIES.FIFO ? POLICIES.FIFO : POLICIES.PRIORITY;
    }

    function setQueuePolicy(policy) {
        var value = policy === POLICIES.FIFO ? POLICIES.FIFO : POLICIES.PRIORITY;
        if (SERVER_MODE) {
            serverScalarCache[QUEUE_POLICY_KEY] = value;
            persistToServer(QUEUE_POLICY_KEY, value);
        } else {
            rawSet(QUEUE_POLICY_KEY, value);
        }
        try { window.dispatchEvent(new CustomEvent('meditrack:patients-updated')); } catch (e) {}
        return value;
    }

    function policyLabel(policy) {
        return (policy || queuePolicy()) === POLICIES.FIFO
            ? 'Arrival order'
            : 'Triage priority';
    }

    /* THE queue order. Every screen that shows "who is next" must call this;
       nothing is allowed to present a different ordering. */
    function queueOrder(patients) {
        var fifo = queuePolicy() === POLICIES.FIFO;
        return (patients || [])
            .filter(function (p) { return p.status === STATUS.PENDING; })
            .sort(function (a, b) {
                if (!fifo) {
                    var d = urgencyRank(a.urgency) - urgencyRank(b.urgency);
                    if (d !== 0) return d;
                }
                var ta = parseDate(a.registered);
                var tb = parseDate(b.registered);
                return (ta ? ta.getTime() : 0) - (tb ? tb.getTime() : 0);
            });
    }

    function consultingPatients(patients) {
        return (patients || []).filter(function (p) { return p.status === STATUS.CONSULTING; });
    }

    function awaitingPatients(patients) {
        return (patients || []).filter(function (p) { return p.status === STATUS.AWAITING; });
    }

    /* ------------------------------------------------------- order status */
    /* An order is outstanding until the performing department closes it. */
    function isOrderOpen(order) {
        var s = String(order && order.status || '').toLowerCase();
        return s !== 'completed' && s !== 'cancelled' && s !== 'dispensed' && s !== 'done';
    }

    function openOrderCount(patient) {
        var n = 0;
        ['labOrders', 'nurseOrders', 'prescriptions'].forEach(function (k) {
            (patient[k] || []).forEach(function (o) { if (isOrderOpen(o)) n++; });
        });
        return n;
    }

    /* Results delivered but not yet acknowledged by the clinician. */
    function unreviewedResults(patient) {
        var out = [];
        (patient.labOrders || []).forEach(function (o) {
            if (!isOrderOpen(o) && !o.reviewed) out.push(o);
        });
        return out;
    }

    function pathwayOf(patient) {
        var lab = (patient.labOrders || []).some(isOrderOpen);
        var nurse = (patient.nurseOrders || []).some(isOrderOpen);
        var rx = (patient.prescriptions || []).some(isOrderOpen);
        var out = [];
        if (lab) out.push('lab');
        if (nurse) out.push('nurse');
        if (rx) out.push('pharmacy');
        return out;
    }

    /* ------------------------------------------------------- navigation */
    /* Pages run inside #content-frame, so navigation is delegated upward. */
    function navigate(target) {
        if (window.parent && window.parent !== window) {
            try {
                window.parent.postMessage({ action: 'navigate', target: target }, '*');
                return;
            } catch (e) {}
        }
        var file = String(target).replace(/^pages\//, '');
        window.location.href = file;
    }

    /* ----------------------------------------------------- staff messaging */
    /* Messages live in one shared server collection. Delivery is resolved
       from the signed-in account, so the same helpers work in the shell
       (badge) and inside the messages page. */
    function sessionUser() {
        try {
            var raw = rawGet('meditrack_session');
            var parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (e) {
            return null;
        }
    }

    /* Group rosters are read once per pass, not once per message. */
    function groupMemberIndex() {
        var index = {};
        var groups = read('clinic_groups');
        (groups || []).forEach(function (g) {
            if (!g) return;
            index[String(g.id)] = (g.members || []).map(function (m) {
                return String(m.username || '').toLowerCase();
            });
        });
        return index;
    }

    function messagesForUser(messages, user) {
        var who = user || sessionUser() || {};
        var username = String(who.user || '');
        var role = String(who.role || '');
        var lower = username.toLowerCase();
        var groups = null;                 /* built lazily, only if needed */
        return (messages || []).filter(function (m) {
            if (!m || typeof m !== 'object') return false;
            if (m.fromUsername && m.fromUsername === username) return true;
            if (m.toType === 'user') return String(m.toUsername || '').toLowerCase() === lower;
            if (m.toType === 'role') return String(m.toRole || '') === role;
            /* Group traffic reaches members only, otherwise every group in
               the hospital would ring the badge on every workstation. */
            if (m.toType === 'group') {
                if (!groups) groups = groupMemberIndex();
                var roster = groups[String(m.groupId)];
                return !!roster && roster.indexOf(lower) !== -1;
            }
            return true;   /* 'all' */
        });
    }

    function messageReadKey() {
        var who = sessionUser() || {};
        return 'meditrack_msg_read_' + String(who.user || 'anon').toLowerCase();
    }

    function lastMessageReadAt() {
        var v = rawGet(messageReadKey());
        var n = toNumber(v);
        return n === null ? 0 : n;
    }

    function markMessagesRead() {
        rawSet(messageReadKey(), String(Date.now()));
    }

    function unreadMessageCount(messages) {
        var cutoff = lastMessageReadAt();
        var who = sessionUser() || {};
        var username = String(who.user || '');
        return messagesForUser(messages || [], who).filter(function (m) {
            if (!m || m.fromUsername === username) return false;
            var t = parseDate(m.time);
            return t ? t.getTime() > cutoff : false;
        }).length;
    }

    /* Send through the dedicated server endpoint so the author is stamped
       server-side; falls back to a local write when no server is present. */
    function sendMessage(payload) {
        var body = {
            toType: payload.toType || 'all',
            toRole: payload.toRole,
            toUsername: payload.toUsername,
            groupId: payload.groupId,
            groupName: payload.groupName,
            /* 'system' marks a notice the UI renders as a centred line
               ("Abebe deleted the chat on …") instead of a chat bubble. */
            kind: payload.kind === 'system' ? 'system' : 'chat',
            body: payload.body || '',
            attachments: payload.attachments || []
        };
        if (SERVER_MODE) {
            var res = xhrSync('POST', '/api/messages', body);
            if (res.status === 200) {
                try {
                    var out = JSON.parse(res.text);
                    serverVersion = Number(out.version) || serverVersion;
                    /* The server is the only writer, so its copy of the
                       thread is the truth. Push it straight into the cache
                       and announce the change: without this the sender's own
                       message stayed invisible until the whole page was
                       reloaded, because the version poll now matched the
                       version we just received and never re-fetched. */
                    if (out.message) {
                        var cached = ('clinic_messages' in serverCache)
                            ? serverCache['clinic_messages'].slice() : [];
                        if (!cached.some(function (m) { return m && m.id === out.message.id; })) {
                            cached.unshift(out.message);
                            serverCache['clinic_messages'] = cached.slice(0, 500);
                        }
                        announceChanges([KEYS.messages]);
                    }
                    return { ok: true, message: out.message };
                } catch (e) {}
            }
            var errText = '';
            try { errText = (JSON.parse(res.text || '{}') || {}).error || ''; } catch (e) {}
            return { ok: false, error: errText || 'The message could not be sent.' };
        }
        var who = sessionUser() || {};
        var msg = {
            id: 'msg_' + Date.now(),
            fromUsername: who.user || '',
            fromName: who.name || 'Unknown',
            fromRole: who.role || '',
            toType: body.toType,
            toRole: body.toRole || null,
            toUsername: body.toUsername || null,
            toName: payload.toName || body.toUsername || null,
            kind: body.kind,
            body: body.body,
            attachments: body.attachments || [],
            time: new Date().toISOString()
        };
        var list = read(KEYS.messages);
        list.unshift(msg);
        write(KEYS.messages, list.slice(0, 500));
        return { ok: true, message: msg };
    }

    /* Remove one message. The thread is append-only for ordinary writes, so
       deletion goes through its own endpoint where the server can check that
       you actually wrote the thing. Falls back to a local splice offline. */
    function deleteMessage(id) {
        if (!id) return { ok: false, error: 'No message was chosen.' };
        if (SERVER_MODE) {
            var res = xhrSync('POST', '/api/messages/delete', { id: id });
            if (res.status === 200) {
                try {
                    var out = JSON.parse(res.text);
                    serverVersion = Number(out.version) || serverVersion;
                    var cached = ('clinic_messages' in serverCache)
                        ? serverCache['clinic_messages'].slice() : [];
                    serverCache['clinic_messages'] = cached.filter(function (m) {
                        return !m || m.id !== id;
                    });
                    announceChanges([KEYS.messages]);
                    return { ok: true };
                } catch (e) {}
            }
            var errText = '';
            try { errText = (JSON.parse(res.text || '{}') || {}).error || ''; } catch (e) {}
            return { ok: false, error: errText || 'The message could not be deleted.' };
        }
        var kept = read(KEYS.messages).filter(function (m) { return !m || m.id !== id; });
        write(KEYS.messages, kept);
        return { ok: true };
    }

    function setOverlayBlur(state) {
        if (window.parent && window.parent !== window) {
            try { window.parent.postMessage({ action: 'toggleBlur', state: !!state }, '*'); } catch (e) {}
        }
    }

    /* Fires whenever any tab changes patient data, plus same-tab writes. */
    function onPatientsChanged(handler) {
        window.addEventListener('storage', function (e) {
            if (!e.key || e.key === KEYS.patients || e.key === KEYS.labRequests ||
                e.key === QUEUE_POLICY_KEY) handler();
        });
        window.addEventListener('meditrack:patients-updated', handler);
    }

    /* --------------------------------------------------------- demo seed */
    /* Only used when storage is completely empty, so a fresh offline install
       is not a blank screen. Real data always wins. A deliberate wipe sets
       the seeded flag to "none" so the demo data never comes back. */
    function seedIfEmpty() {
        /* The server database starts empty on purpose — a hospital does not
           want demo patients mixed into real records. */
        if (SERVER_MODE) return readPatients();
        if (rawGet(KEYS.patients)) return readPatients();
        if (rawGet(KEYS.seeded) === 'none') return [];

        var now = Date.now();
        var mins = function (m) { return new Date(now - m * 60000).toISOString(); };

        var seed = [
            {
                id: 1, name: 'Miriam Tesfaye', age: 58, sex: 'Female', phone: '0912 345 678',
                urgency: URGENCY.EMERGENCY, status: STATUS.PENDING,
                description: 'Crushing central chest pain for 40 minutes radiating to the left arm, sweating and short of breath.',
                registered: mins(12),
                vitals: { systolic: 86, diastolic: 54, pulse: 124, temperature: 36.4, spo2: 91, respRate: 26, glucose: 138, weight: 68, height: 162 }
            },
            {
                id: 2, name: 'Daniel Bekele', age: 34, sex: 'Male', phone: '0911 222 333',
                urgency: URGENCY.URGENT, status: STATUS.PENDING,
                description: 'Productive cough and fever for four days, now breathless on climbing stairs.',
                registered: mins(38),
                vitals: { systolic: 128, diastolic: 82, pulse: 104, temperature: 38.6, spo2: 93, respRate: 24, glucose: 96, weight: 74, height: 178 }
            },
            {
                id: 3, name: 'Hanna Girma', age: 27, sex: 'Female', phone: '0987 654 321',
                urgency: URGENCY.ROUTINE, status: STATUS.PENDING,
                description: 'Burning on passing urine with lower abdominal discomfort for two days.',
                registered: mins(52),
                vitals: { systolic: 116, diastolic: 74, pulse: 82, temperature: 37.6, spo2: 98, respRate: 16, glucose: 90, weight: 59, height: 165 }
            },
            {
                id: 4, name: 'Yohannes Alemu', age: 46, sex: 'Male', phone: '0913 444 555',
                urgency: URGENCY.URGENT, status: STATUS.AWAITING,
                description: 'Known diabetic, excessive thirst and polyuria for one week with blurred vision.',
                registered: mins(96),
                calledAt: mins(70),
                vitals: { systolic: 148, diastolic: 92, pulse: 96, temperature: 36.9, spo2: 97, respRate: 18, glucose: 268, weight: 88, height: 172 },
                labOrders: [{
                    id: 9001, patientId: 4, trackingId: 'TRK-SEED004', patientName: 'Yohannes Alemu',
                    test: 'HbA1c, renal panel, urine ketones', priority: 'Urgent',
                    note: 'Assess glycaemic control and exclude ketosis.',
                    doctor: 'Dr. Sarah Chen', time: mins(64), status: 'In Progress', results: ''
                }]
            },
            {
                id: 5, name: 'Selam Wolde', age: 63, sex: 'Female', phone: '0914 777 888',
                urgency: URGENCY.ROUTINE, status: STATUS.AWAITING,
                description: 'Follow-up for hypertension review and repeat electrolytes.',
                registered: mins(150),
                calledAt: mins(120),
                vitals: { systolic: 158, diastolic: 96, pulse: 78, temperature: 36.7, spo2: 98, respRate: 16, glucose: 104, weight: 71, height: 158 },
                labOrders: [{
                    id: 9002, patientId: 5, trackingId: 'TRK-SEED005', patientName: 'Selam Wolde',
                    test: 'Serum electrolytes, creatinine', priority: 'Routine',
                    note: 'Monitoring on thiazide therapy.',
                    doctor: 'Dr. Sarah Chen', time: mins(112), status: 'Completed',
                    flag: 'Abnormal', reviewed: false,
                    results: 'Potassium 3.1 mmol/L (low). Sodium 139 mmol/L. Creatinine 84 µmol/L.'
                }]
            }
        ];

        writePatients(seed);
        rawSet(KEYS.seeded, 'demo');
        return readPatients();
    }

    /* Wipe every record on this workstation — patients, orders, results,
       bills, staff, inventory, notifications, the demo seed AND the saved
       settings/appearance defaults. The app restarts from a completely
       blank slate. The demo data set is never re-seeded afterwards. */
    function clearAllData() {
        /* Server mode: wipe the hospital data on the server (accounts are
           kept), then fall through to clearing this browser's own prefs. */
        if (SERVER_MODE) {
            var res = xhrSync('POST', '/api/admin/reset', {});
            if (res.status !== 200) {
                try {
                    var j = JSON.parse(res.text || '{}');
                    connectionBanner(j.error ||
                        (res.status === 0 ? OFFLINE_TEXT : 'The server refused to reset data.'), true);
                } catch (e) {}
                if (res.status === 401) { sessionExpired(); return; }
            }
        }
        Object.keys(KEYS).forEach(function (name) {
            rawRemove(KEYS[name]);
        });
        rawRemove(QUEUE_POLICY_KEY);
        /* Anything else the app may have written under our namespace,
           including session and appearance defaults. */
        try {
            var stale = [];
            for (var i = 0; i < window.localStorage.length; i++) {
                var k = window.localStorage.key(i);
                if (k && (k.indexOf('clinic_') === 0 || k.indexOf('meditrack_') === 0)) stale.push(k);
            }
            stale.forEach(rawRemove);
        } catch (e) {}
        /* A deliberate wipe stays wiped: the demo seed never comes back. */
        rawSet(KEYS.seeded, 'none');
    }

    /* ==================================================================
       Billing: price list + invoices
       The front office creates bills, takes payments, and only a settled
       bill moves a newly registered patient into the waiting list.
       ================================================================== */
    var DEFAULT_PRICE_LIST = [
        { category: 'Consultation', name: 'Standard consultation', amount: 300 },
        { category: 'Consultation', name: 'Follow-up consultation', amount: 200 },
        { category: 'Laboratory', name: 'Complete blood count', amount: 250 },
        { category: 'Laboratory', name: 'Malaria blood film', amount: 120 },
        { category: 'Laboratory', name: 'Urinalysis', amount: 150 },
        { category: 'Laboratory', name: 'Blood glucose', amount: 90 },
        { category: 'Pharmacy', name: 'Medication (per course)', amount: 180 },
        { category: 'Nursing', name: 'Nursing care', amount: 100 },
        { category: 'Nursing', name: 'Vital signs observation', amount: 50 },
        { category: 'Other', name: 'Queue card', amount: 300 },
        { category: 'Other', name: 'Dressing / procedure', amount: 140 }
    ];

    /* The price list is hospital-wide (every billing desk must quote the
       same amounts), so in server mode it lives in the shared database
       exactly like every other collection. */
    function readPriceList() {
        var list = read(KEYS.priceList);
        return isArray(list) && list.length ? list : DEFAULT_PRICE_LIST.slice();
    }

    function writePriceList(list) {
        return write(KEYS.priceList, isArray(list) ? list : []);
    }

    function lookupPrice(category, name) {
        var list = readPriceList();
        var q = String(name || '').trim().toLowerCase();

        /* Exact name match first, then anything containing it. */
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].name || '').toLowerCase() === q) return toNumber(list[i].amount) || 0;
        }
        for (var j = 0; j < list.length; j++) {
            var n = String(list[j].name || '').toLowerCase();
            if (q && n.indexOf(q) !== -1) return toNumber(list[j].amount) || 0;
        }

        /* Fall back to the standard amount for the charge type. */
        var catFallbacks = { Consultation: 300, Laboratory: 180, Pharmacy: 180, Nursing: 100 };
        return catFallbacks[category] || 150;
    }

    function readInvoices() {
        return read(KEYS.invoices).map(function (inv) {
            inv.items = isArray(inv.items) ? inv.items : [];
            inv.payments = isArray(inv.payments) ? inv.payments : [];
            if (!inv.status) inv.status = 'Unpaid';
            return inv;
        });
    }

    function writeInvoices(list) {
        var ok = write(KEYS.invoices, list);
        try { window.dispatchEvent(new CustomEvent('meditrack:invoices-updated')); } catch (e) {}
        return ok;
    }

    var invoiceSeq = 0;
    function nextInvoiceNumber(list) {
        var max = 0;
        (list || []).forEach(function (inv) {
            var m = String(inv.number || '').match(/(\d+)$/);
            if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
        });
        var next = max + 1;
        var out = String(next);
        while (out.length < 4) out = '0' + out;
        return 'INV-' + out;
    }

    function createInvoice(data) {
        var list = readInvoices();
        var items = (data.items || []).filter(function (it) {
            return it && (toNumber(it.price) || 0) > 0;
        }).map(function (it) {
            return {
                category: it.category || 'Other',
                description: it.description || 'Charge',
                qty: toNumber(it.qty) || 1,
                price: toNumber(it.price) || 0
            };
        });

        var invoice = {
            id: 'inv_' + Date.now().toString(36) + (++invoiceSeq),
            number: nextInvoiceNumber(list),
            patientId: data.patientId !== undefined ? data.patientId : null,
            patientName: data.patientName || '',
            trackingId: data.trackingId || '',
            kind: data.kind || 'service',          /* registration | service | final */
            status: 'Unpaid',
            items: items,
            discount: toNumber(data.discount) || 0,
            discountType: data.discountType === 'amount' ? 'amount' : 'percent',
            note: data.note || '',
            payments: [],
            createdAt: new Date().toISOString()
        };

        list.unshift(invoice);
        writeInvoices(list);
        return invoice;
    }

    function findInvoice(id) {
        var list = readInvoices();
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].id) === String(id)) return list[i];
        }
        return null;
    }

    function saveInvoice(updated) {
        var list = readInvoices();
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].id) === String(updated.id)) {
                list[i] = updated;
                writeInvoices(list);
                return updated;
            }
        }
        return null;
    }

    function invoiceTotals(inv) {
        var subtotal = 0;
        ((inv && inv.items) || []).forEach(function (it) {
            subtotal += (toNumber(it.qty) || 1) * (toNumber(it.price) || 0);
        });

        var discount = toNumber(inv && inv.discount) || 0;
        var discountAmount = (inv && inv.discountType === 'amount')
            ? Math.min(discount, subtotal)
            : subtotal * Math.min(discount, 100) / 100;

        var total = Math.max(0, subtotal - discountAmount);

        var paid = 0;
        ((inv && inv.payments) || []).forEach(function (p) {
            paid += toNumber(p.amount) || 0;
        });

        var balance = Math.max(0, total - paid);
        return { subtotal: subtotal, discountAmount: discountAmount, total: total, paid: paid, balance: balance };
    }

    /* A payment settles the invoice; the moment a bill tied to a patient who
       is still waiting to pay clears, that patient joins the waiting list.
       This is deliberate: no one is queued ahead of an unsettled bill. */
    function recordPayment(invoiceId, payment) {
        var inv = findInvoice(invoiceId);
        if (!inv) return null;

        var amount = toNumber(payment.amount);
        if (amount === null || amount <= 0) return null;

        inv.payments.push({
            amount: amount,
            method: payment.method || 'Cash',
            reference: payment.reference || '',
            phone: payment.phone || '',
            at: new Date().toISOString()
        });

        var totals = invoiceTotals(inv);
        inv.status = totals.balance <= 0.009 ? 'Paid' :
                     (totals.paid > 0 ? 'Partly Paid' : 'Unpaid');
        if (totals.balance > 0.009 && inv.status === 'Paid') inv.status = 'Partly Paid';

        saveInvoice(inv);

        /* Queue promotion ------------------------------------------------ */
        var promoted = null;
        if (inv.status === 'Paid' && inv.patientId !== null) {
            var patients = readPatients();
            var patient = findPatient(patients, inv.patientId);
            if (patient && patient.status === STATUS.AWAITING_PAYMENT) {
                patient.status = STATUS.NURSE_TRIAGE;
                writePatients(patients);
                promoted = patient;
            }
        }

        try {
            window.dispatchEvent(new CustomEvent('meditrack:invoice-paid', {
                detail: { invoice: inv, promoted: promoted, payment: payment }
            }));
        } catch (e) {}

        return { invoice: inv, promoted: promoted };
    }

    /* Every newly registered patient gets a "queue card" bill the moment
       they are put on file. Routine patients settle it before joining the
       waiting list; urgent/emergency arrivals queue first and the unpaid
       card stays on the billing desk to be settled later. */
    function hasOpenRegistrationInvoice(patientId) {
        var list = readInvoices();
        for (var i = 0; i < list.length; i++) {
            var inv = list[i];
            if (String(inv.patientId) === String(patientId) &&
                inv.kind === 'registration' &&
                inv.status !== 'Cancelled') return true;
        }
        return false;
    }

    function ensureRegistrationInvoice(patient) {
        if (!patient || patient.status === STATUS.FINISHED) return null;
        if (hasOpenRegistrationInvoice(patient.id)) return null;

        var invoice = createInvoice({
            patientId: patient.id,
            patientName: patient.name,
            trackingId: patient.trackingId,
            kind: 'registration',
            items: [{
                category: 'Queue card',
                description: lookupPriceName('Other', 'Queue card'),
                qty: 1,
                price: lookupPrice('Other', 'Queue card')
            }]
        });

        try {
            window.dispatchEvent(new CustomEvent('meditrack:invoices-updated', {
                detail: { invoice: invoice }
            }));
        } catch (e) {}

        return invoice;
    }

    /* Backfill: any awaiting-payment patient without a registration bill
       (older records, seeded demo data) gets one on the next billing sweep. */
    function ensureRegistrationInvoices(patients) {
        var created = [];
        (patients || []).forEach(function (p) {
            var inv = ensureRegistrationInvoice(p);
            if (inv) created.push(inv);
        });
        return created;
    }

    /* Pull every chargeable thing off the patient record as bill lines. */
    function buildChargesFromRecord(patient) {
        var items = [];
        if (!patient) return items;

        items.push({
            category: 'Consultation',
            description: lookupPriceName('Consultation', 'Standard consultation'),
            qty: 1,
            price: lookupPrice('Consultation', 'Standard consultation')
        });

        (patient.labOrders || []).forEach(function (o) {
            if (!isOrderOpen(o)) return;
            var name = o.test || 'Laboratory test';
            items.push({ category: 'Laboratory', description: name, qty: 1, price: lookupPrice('Laboratory', name) });
        });

        (patient.prescriptions || []).forEach(function (rx) {
            if (!isOrderOpen(rx)) return;
            var qty = courseQuantity(rx) || 1;
            var name = rx.medication || 'Medication';
            items.push({ category: 'Pharmacy', description: name, qty: qty, price: lookupPrice('Pharmacy', name) });
        });

        (patient.nurseOrders || []).forEach(function (o) {
            if (!isOrderOpen(o)) return;
            var name = o.task || o.name || 'Nursing care';
            items.push({ category: 'Nursing', description: name, qty: 1, price: lookupPrice('Nursing', name) });
        });

        return items;
    }

    function lookupPriceName(category, fallback) {
        var list = readPriceList();
        for (var i = 0; i < list.length; i++) {
            if (list[i].category === category &&
                String(list[i].name || '').toLowerCase() === fallback.toLowerCase()) {
                return list[i].name;
            }
        }
        return fallback;
    }


    window.MediStore = {
        KEYS: KEYS,
        URGENCY: URGENCY,
        STATUS: STATUS,
        POLICIES: POLICIES,

        SERVER_MODE: SERVER_MODE,
        authToken: authToken,
        setAuthToken: setAuthToken,

        read: read,
        write: write,
        rawGet: rawGet,
        rawSet: rawSet,
        remove: rawRemove,
        storageAvailable: storageAvailable,
        sessionGet: sessionGet,
        sessionSet: sessionSet,
        sessionRemove: sessionRemove,

        readPatients: readPatients,
        writePatients: writePatients,
        normalizePatient: normalizePatient,
        findPatient: findPatient,
        nextPatientId: nextPatientId,
        generateTrackingId: generateTrackingId,
        seedIfEmpty: seedIfEmpty,
        clearAllData: clearAllData,

        activePatients: activePatients,
        queueOrder: queueOrder,
        queuePolicy: queuePolicy,
        setQueuePolicy: setQueuePolicy,
        policyLabel: policyLabel,
        consultingPatients: consultingPatients,
        awaitingPatients: awaitingPatients,

        normalizeUrgency: normalizeUrgency,
        normalizeStatus: normalizeStatus,
        urgencyRank: urgencyRank,

        normalizeVitals: normalizeVitals,
        bloodPressureText: bloodPressureText,
        bmi: bmi,

        isOrderOpen: isOrderOpen,
        openOrderCount: openOrderCount,
        unreviewedResults: unreviewedResults,
        pathwayOf: pathwayOf,

        escapeHtml: escapeHtml,
        initials: initials,
        toNumber: toNumber,
        phoneDigits: phoneDigits,
        isValidPhone: isValidPhone,
        formatPhone: formatPhone,
        MED_FORMS: MED_FORMS,
        MED_FORM_ORDER: MED_FORM_ORDER,
        medForm: medForm,
        formatMedAmount: formatMedAmount,
        courseQuantity: courseQuantity,
        formatMoney: formatMoney,
        CURRENCY: CURRENCY,

        readPriceList: readPriceList,
        writePriceList: writePriceList,
        lookupPrice: lookupPrice,
        readInvoices: readInvoices,
        writeInvoices: writeInvoices,
        createInvoice: createInvoice,
        findInvoice: findInvoice,
        saveInvoice: saveInvoice,
        invoiceTotals: invoiceTotals,
        recordPayment: recordPayment,
        ensureRegistrationInvoice: ensureRegistrationInvoice,
        ensureRegistrationInvoices: ensureRegistrationInvoices,
        buildChargesFromRecord: buildChargesFromRecord,
        formatDate: formatDate,
        formatTime: formatTime,
        formatDateTime: formatDateTime,
        relativeTime: relativeTime,
        elapsed: elapsed,

        navigate: navigate,
        setOverlayBlur: setOverlayBlur,
        onPatientsChanged: onPatientsChanged,

        sessionUser: sessionUser,
        messagesForUser: messagesForUser,
        unreadMessageCount: unreadMessageCount,
        lastMessageReadAt: lastMessageReadAt,
        markMessagesRead: markMessagesRead,
        sendMessage: sendMessage,
        deleteMessage: deleteMessage,

        /* Pull the latest snapshot from the server now (used after an admin
           action so the screen reflects the change without waiting for the
           background poll). */
        refresh: function (thenAnnounce) {
            if (!SERVER_MODE) return;
            refreshFromServer(!!thenAnnounce);
        }
    };
})(window);
