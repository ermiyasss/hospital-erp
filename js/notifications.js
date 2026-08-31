/* ==========================================================================
   MediTrack Hospital ERP - Notification Service

   Design goal: the bell is a clinical alert channel, not an activity log.
   Every event is assigned a priority, and only events that a clinician must
   act on are allowed to interrupt with a toast:

     critical  -> toast + persisted + sticky (no auto-dismiss)   e.g. panic labs, abnormal vitals
     high      -> toast + persisted                              e.g. lab/imaging results released
     normal    -> persisted only (visible in the bell panel)     e.g. patient registered
     low       -> transient toast, never persisted               e.g. "saved", "copied"

   Routine CRUD confirmations therefore no longer pile up in the panel.

   Alerts are also filtered by role (js/session.js): a receptionist has no use
   for a panic potassium, and a nurse has no use for a billing notice. Critical
   alerts still reach every role that is clinically involved, because the point
   of a critical alert is that somebody acts on it.
   ========================================================================== */

(function (window) {
    'use strict';

    var STORAGE_NOTIFS_KEY = 'clinic_notifications_log';
    var STORAGE_KEY_PATIENTS = 'clinic_patients_data';
    var STORAGE_KEY_LAB = 'clinic_lab_requests';
    var STORAGE_CALL_ALERT = 'meditrack_call_alert';

    var MAX_LOG = 60;
    var DEDUPE_WINDOW_MS = 20000;   /* identical alert inside this window is dropped */

    var container = null;
    var prevPatientCount = 0;
    var prevPatientsState = {};
    var prevLabCompletedCount = 0;
    var prevLabCount = 0;

    /* This module also loads on the sign-in screen, where js/store.js is not
       present, so it carries its own guarded storage access. localStorage is
       unavailable on opaque origins (file://) and in some private windows.
       The shared alert log goes through MediStore.read/write when available,
       which keeps it on the LAN server rather than this browser. */
    var memory = {};

    function lsGet(key) {
        if (window.MediStore) {
            if (key === STORAGE_NOTIFS_KEY && window.MediStore.SERVER_MODE) {
                return JSON.stringify(window.MediStore.read(key));
            }
            return window.MediStore.rawGet(key);
        }
        try { return window.localStorage.getItem(key); }
        catch (e) { return memory[key] === undefined ? null : memory[key]; }
    }

    function lsSet(key, value) {
        if (window.MediStore) {
            if (key === STORAGE_NOTIFS_KEY && window.MediStore.SERVER_MODE) {
                try { return window.MediStore.write(key, JSON.parse(value || '[]')); }
                catch (e) { return false; }
            }
            return window.MediStore.rawSet(key, value);
        }
        try { window.localStorage.setItem(key, value); }
        catch (e) { memory[key] = value; }
    }

    /* Event catalogue: single source of truth for how each event behaves.
       Pages should prefer MediTrackNotify.event('lab.result.ready', {...}). */
    var EVENTS = {
        'vitals.critical':      { type: 'error',   priority: 'critical', category: 'Vitals',   audience: ['admin', 'doctor', 'nurse', 'lab'] },
        'vitals.abnormal':      { type: 'warning', priority: 'high',     category: 'Vitals',   audience: ['admin', 'doctor', 'nurse', 'lab'] },
        'lab.result.critical':  { type: 'error',   priority: 'critical', category: 'Lab',      audience: ['admin', 'doctor', 'nurse', 'lab'] },
        'lab.result.ready':     { type: 'success', priority: 'high',     category: 'Lab',      audience: ['admin', 'doctor', 'nurse', 'lab'] },
        'lab.request.urgent':   { type: 'warning', priority: 'high',     category: 'Lab',      audience: ['admin', 'doctor', 'nurse', 'lab'] },
        'lab.request.created':  { type: 'info',    priority: 'normal',   category: 'Lab',      audience: ['admin', 'doctor', 'nurse', 'lab'] },
        'pharmacy.dispensed':   { type: 'success', priority: 'normal',   category: 'Pharmacy', audience: ['admin', 'doctor', 'nurse'] },
        'pharmacy.stock.low':   { type: 'warning', priority: 'high',     category: 'Inventory',audience: ['admin', 'doctor', 'nurse'] },
        'queue.emergency':      { type: 'error',   priority: 'critical', category: 'Queue',    audience: ['admin', 'doctor', 'nurse', 'billing', 'lab'] },
        'queue.called':         { type: 'info',    priority: 'high',     category: 'Queue',    audience: ['admin', 'nurse', 'billing'] },
        'patient.registered':   { type: 'info',    priority: 'normal',   category: 'Patient',  audience: ['admin', 'billing', 'nurse', 'lab'] },
        'consult.completed':    { type: 'success', priority: 'normal',   category: 'Doctor',   audience: ['admin', 'doctor'] },
        'record.saved':         { type: 'success', priority: 'low',      category: 'System' }
    };

    /* Only these priorities interrupt the user with a toast. */
    var TOAST_PRIORITIES = { critical: true, high: true, low: true };
    /* Only these priorities are written to the persistent bell log. */
    var LOG_PRIORITIES = { critical: true, high: true, normal: true };

    var TYPE_ICON = { info: 'info', success: 'check-circle', warning: 'warning', error: 'critical' };

    /* ------------------------------------------------------------- routing */
    /* Settings (pages/settings.html) can mute categories of alert. Critical
       events are deliberately absent from this map: a panic laboratory value
       or a critical observation must never be silenceable from a preferences
       screen. */
    var ROUTING_KEY = 'clinic_settings';

    var EVENT_SETTING = {
        'lab.result.ready':    'alertLabResults',
        'vitals.abnormal':     'alertAbnormalVitals',
        'lab.request.urgent':  'alertStatRequests',
        'pharmacy.stock.low':  'alertLowStock'
    };

    var ROUTING_DEFAULTS = {
        alertLabResults: true,
        alertAbnormalVitals: true,
        alertStatRequests: true,
        alertLowStock: true,
        alertRoutineLog: true,
        alertConfirmations: true,
        toastDuration: '6000'
    };

    function routing() {
        try {
            var raw = lsGet(ROUTING_KEY);
            var parsed = raw ? JSON.parse(raw) : null;
            if (!parsed || typeof parsed !== 'object') return ROUTING_DEFAULTS;
            var out = {};
            Object.keys(ROUTING_DEFAULTS).forEach(function (k) {
                out[k] = parsed[k] === undefined ? ROUTING_DEFAULTS[k] : parsed[k];
            });
            return out;
        } catch (e) {
            return ROUTING_DEFAULTS;
        }
    }

    /* Returns 'allow', 'log-only' or 'drop' for a prepared item. */
    function routeFor(item, cfg) {
        /* Role comes first. An alert a role has no use for is not logged for
           them at all, otherwise the panel fills with other people's work. */
        if (window.MediSession && !window.MediSession.wantsAlert(item)) {
            return 'drop';
        }

        if (item.priority === 'critical') return 'allow';

        if (item.priority === 'low') {
            return cfg.alertConfirmations ? 'allow' : 'drop';
        }

        if (item.priority === 'normal') {
            return cfg.alertRoutineLog ? 'allow' : 'drop';
        }

        /* high: muted categories fall back to a silent log entry rather than
           vanishing, so nothing is lost from the audit trail. */
        var key = item.event ? EVENT_SETTING[item.event] : null;
        if (key && cfg[key] === false) return 'log-only';
        return 'allow';
    }

    function icon(name, size) {
        return window.MediIcons ? window.MediIcons.svg(name, size || 18) : '';
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function ensureContainer() {
        if (container && document.body && document.body.contains(container)) return container;
        container = document.createElement('div');
        container.className = 'notification-container';
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
        return container;
    }

    function getStoredNotifications() {
        try {
            var raw = lsGet(STORAGE_NOTIFS_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function saveStoredNotifications(notifs) {
        lsSet(STORAGE_NOTIFS_KEY, JSON.stringify(notifs.slice(0, MAX_LOG)));
    }

    /* ------------------------------------------------------------------ sound */
    /* js/theme.js owns the audio. Pages run inside an iframe, and browsers
       only allow audio in a frame the user has actually interacted with, so
       the request is also relayed to the shell — which the user has clicked
       on to navigate — giving it a second chance to be heard. */
    function playSound(priority) {
        if (window.MediTheme) {
            try { window.MediTheme.playAlert(priority); } catch (e) {}
        }
        if (window.parent && window.parent !== window) {
            try {
                window.parent.postMessage({ action: 'play_alert_sound', kind: priority }, '*');
            } catch (e) {}
        }
    }

    /* ------------------------------------------------------------------ toast */
    function dismissToast(toast) {
        if (!toast) return;
        toast.classList.remove('visible');
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 260);
    }

    function showToast(item) {
        var c = ensureContainer();

        /* Cap simultaneous toasts so the corner never becomes a wall of cards. */
        var existing = c.querySelectorAll('.notification-toast');
        if (existing.length >= 3) dismissToast(existing[0]);

        var toast = document.createElement('div');
        toast.className = 'notification-toast type-' + item.type +
            (item.priority === 'critical' ? ' is-critical' : '');
        toast.dataset.id = item.id;

        toast.innerHTML =
            '<span class="notif-icon">' + icon(TYPE_ICON[item.type] || 'info', 18) + '</span>' +
            '<div class="notif-body">' +
                '<div class="notif-head-row">' +
                    '<span class="notif-title">' + escapeHtml(item.title) + '</span>' +
                    '<span class="notif-cat">' + escapeHtml(item.category) + '</span>' +
                '</div>' +
                '<span class="notif-message">' + escapeHtml(item.message) + '</span>' +
            '</div>' +
            '<button type="button" class="notif-dismiss" aria-label="Dismiss notification">' +
                icon('close', 14) +
            '</button>';

        c.appendChild(toast);
        requestAnimationFrame(function () {
            requestAnimationFrame(function () { toast.classList.add('visible'); });
        });

        /* Critical alerts stay until acknowledged. */
        var autoTimer = null;
        if (item.priority !== 'critical') {
            var configured = parseInt(routing().toastDuration, 10);
            if (isNaN(configured) || configured < 1500) configured = 6000;
            var life = item.priority === 'low' ? Math.min(3000, configured) : configured;
            autoTimer = setTimeout(function () { dismissToast(toast); }, life);
        }

        toast.querySelector('.notif-dismiss').addEventListener('click', function (e) {
            e.stopPropagation();
            if (autoTimer) clearTimeout(autoTimer);
            dismissToast(toast);
        });
        toast.addEventListener('mouseenter', function () {
            if (autoTimer) clearTimeout(autoTimer);
        });
    }

    /* ------------------------------------------------------------ dispatching */
    /* Pages raise their own events, and the storage watchers below raise the
       same events for other frames/tabs. Without a stable key the two paths
       produce near-identical duplicates, which is exactly the noise this
       module exists to prevent. Every alert therefore carries a dedupe key. */
    function isDuplicate(notifs, item) {
        var cutoff = Date.now() - DEDUPE_WINDOW_MS;
        for (var i = 0; i < notifs.length; i++) {
            var n = notifs[i];
            if (new Date(n.timestamp).getTime() < cutoff) break;
            if (item.key && n.key && n.key === item.key) return true;
            if (n.title === item.title && n.message === item.message) return true;
        }
        return false;
    }

    function dispatch(opts) {
        var item = {
            id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            title: opts.title || 'Notification',
            message: opts.message || '',
            type: opts.type || 'info',
            priority: opts.priority || 'normal',
            category: opts.category || 'System',
            event: opts.event || null,
            key: opts.key || null,
            audience: opts.audience || null,
            timestamp: new Date().toISOString(),
            read: false
        };

        var decision = routeFor(item, routing());
        if (decision === 'drop') return null;

        var shouldLog = !!LOG_PRIORITIES[item.priority];

        if (shouldLog) {
            var notifs = getStoredNotifications();
            if (isDuplicate(notifs, item)) return null;
            notifs.unshift(item);
            saveStoredNotifications(notifs);
        }

        if (decision === 'allow' && TOAST_PRIORITIES[item.priority]) showToast(item);

        /* Sound is tied to the toast: if it was not important enough to
           interrupt visually, it is not important enough to make a noise. */
        if (decision === 'allow' && TOAST_PRIORITIES[item.priority] && item.priority !== 'low') {
            playSound(item.priority);
        }

        if (window.parent && window.parent !== window) {
            try {
                window.parent.postMessage({ action: 'new_notification', notification: item }, '*');
            } catch (e) {}
        }
        window.dispatchEvent(new CustomEvent('meditrack:notification', { detail: item }));
        return item;
    }

    /* --------------------------------------------------------------- public API */
    function MediTrackNotify(title, message, type, category) {
        return MediTrackNotify.push(title, message, type, category);
    }

    /* Legacy signature. Priority is inferred from the type so existing call
       sites immediately benefit from the new gating rules. */
    var TYPE_TO_PRIORITY = { error: 'critical', warning: 'high', success: 'normal', info: 'normal' };

    MediTrackNotify.push = function (title, message, type, category, priority) {
        type = type || 'info';
        return dispatch({
            title: title,
            message: message,
            type: type,
            category: category || 'System',
            priority: priority || TYPE_TO_PRIORITY[type] || 'normal'
        });
    };

    /* Preferred entry point: semantic event key + payload. */
    MediTrackNotify.event = function (eventKey, payload) {
        var def = EVENTS[eventKey];
        payload = payload || {};
        if (!def) return MediTrackNotify.push(payload.title, payload.message, payload.type, payload.category);
        return dispatch({
            title: payload.title || eventKey,
            message: payload.message || '',
            type: payload.type || def.type,
            priority: payload.priority || def.priority,
            category: payload.category || def.category,
            audience: payload.audience || def.audience || null,
            event: eventKey,
            key: payload.key || null
        });
    };

    /* Transient confirmation: toast only, never stored in the bell panel. */
    MediTrackNotify.flash = function (title, message, type) {
        return dispatch({
            title: title,
            message: message || '',
            type: type || 'success',
            priority: 'low',
            category: 'System'
        });
    };

    /* Back-compat alias kept so older pages keep working. */
    MediTrackNotify.toast = MediTrackNotify.push;

    MediTrackNotify.getAll = getStoredNotifications;

    MediTrackNotify.getUnreadCount = function () {
        return getStoredNotifications().filter(function (n) { return !n.read; }).length;
    };

    MediTrackNotify.getCriticalCount = function () {
        return getStoredNotifications().filter(function (n) {
            return !n.read && n.priority === 'critical';
        }).length;
    };

    MediTrackNotify.markAsRead = function (id) {
        var notifs = getStoredNotifications();
        var changed = false;
        for (var i = 0; i < notifs.length; i++) {
            if (notifs[i].id === id) { notifs[i].read = true; changed = true; break; }
        }
        if (!changed) return;
        saveStoredNotifications(notifs);
        window.dispatchEvent(new CustomEvent('meditrack:notifications-updated'));
        relayToParent('notifications_read');
    };

    MediTrackNotify.markAllAsRead = function () {
        var notifs = getStoredNotifications();
        notifs.forEach(function (n) { n.read = true; });
        saveStoredNotifications(notifs);
        window.dispatchEvent(new CustomEvent('meditrack:notifications-updated'));
        relayToParent('notifications_read');
    };

    MediTrackNotify.clearAll = function () {
        saveStoredNotifications([]);
        window.dispatchEvent(new CustomEvent('meditrack:notifications-updated'));
        relayToParent('notifications_cleared');
    };

    function relayToParent(action) {
        if (window.parent && window.parent !== window) {
            try { window.parent.postMessage({ action: action }, '*'); } catch (e) {}
        }
    }

    window.MediTrackNotify = MediTrackNotify;

    /* ==================================================================
       Storage watchers
       Only meaningful clinical transitions raise alerts. Plain edits,
       re-saves and re-orderings are intentionally ignored.
       ================================================================== */
    function snapshotCounts() {
        try {
            var patients = window.MediStore
                ? window.MediStore.readPatients()
                : JSON.parse(lsGet(STORAGE_KEY_PATIENTS) || '[]');
            prevPatientCount = patients.length;
            prevPatientsState = {};
            patients.forEach(function (p) {
                prevPatientsState[p.id] = { status: p.status, urgency: p.urgency };
            });
        } catch (e) {
            prevPatientCount = 0;
            prevPatientsState = {};
        }

        try {
            var labs = window.MediStore
                ? window.MediStore.read(window.MediStore.KEYS.labRequests)
                : JSON.parse(lsGet(STORAGE_KEY_LAB) || '[]');
            prevLabCount = labs.length;
            prevLabCompletedCount = labs.filter(function (l) { return l.status === 'Completed'; }).length;
        } catch (e) {
            prevLabCount = 0;
            prevLabCompletedCount = 0;
        }
    }

    function handlePatientChange(newValue) {
        var patients;
        try { patients = JSON.parse(newValue || '[]'); } catch (e) { return; }

        if (patients.length > prevPatientCount) {
            var latest = patients[patients.length - 1] || {};
            /* Emergency arrivals interrupt; routine registrations only log. */
            if (String(latest.urgency || '').toLowerCase() === 'emergency') {
                MediTrackNotify.event('queue.emergency', {
                    key: 'emergency:' + latest.id,
                    title: 'Emergency Arrival',
                    message: (latest.name || 'Patient') + ' (' + (latest.trackingId || '—') + ') requires immediate assessment.'
                });
            } else {
                MediTrackNotify.event('patient.registered', {
                    key: 'registered:' + latest.id,
                    title: 'Patient Registered',
                    message: (latest.name || 'Patient') + ' added to the registry as ' + (latest.urgency || 'Routine') + '.'
                });
            }
        } else {
            patients.forEach(function (p) {
                var old = prevPatientsState[p.id];
                if (!old) return;

                if (old.urgency !== p.urgency && String(p.urgency).toLowerCase() === 'emergency') {
                    MediTrackNotify.event('queue.emergency', {
                        key: 'escalated:' + p.id,
                        title: 'Escalated to Emergency',
                        message: p.name + ' (' + (p.trackingId || '—') + ') escalated to emergency priority.'
                    });
                    return;
                }
                if (old.status !== p.status && p.status === 'Finished') {
                    MediTrackNotify.event('consult.completed', {
                        key: 'completed:' + p.id,
                        title: 'Consultation Closed',
                        message: p.name + ' has completed the care pathway.'
                    });
                }
            });
        }

        prevPatientCount = patients.length;
        prevPatientsState = {};
        patients.forEach(function (p) {
            prevPatientsState[p.id] = { status: p.status, urgency: p.urgency };
        });
    }

    /* A clinician called a patient in another tab: the queue manager and
       the nurse station must hear it. Critical priority keeps the toast on
       screen until dismissed, and the chime repeats three times so it is
       unmistakable across a busy room. */
    function handleCallAlert(newValue) {
        var data;
        try { data = JSON.parse(newValue); } catch (e) { return; }
        if (!data || !data.name || !data.at) return;

        var doctor = data.doctor ? ' to ' + data.doctor : '';
        MediTrackNotify.event('queue.called', {
            key: 'callalert:' + data.trackingId + ':' + data.at,
            title: 'Now Calling Patient',
            message: data.name + ' (' + (data.trackingId || '—') + ') has been called' +
                     doctor + '. Please direct them to the consultation room.',
            audience: ['admin', 'nurse', 'billing']
        });

        /* The repeating chime must only sound for the ranks that act on a call
           (nurse and billing desk), so a doctor at their desk is not disturbed by
           every patient call. */
        if (window.MediSession && ['admin', 'nurse', 'billing'].indexOf(window.MediSession.role()) !== -1) {
            [0, 900, 1800].forEach(function (delay) {
                setTimeout(function () { playSound('critical'); }, delay);
            });
        }
    }

    function handleLabChange(newValue) {
        var labs;
        try { labs = JSON.parse(newValue || '[]'); } catch (e) { return; }

        var completed = labs.filter(function (l) { return l.status === 'Completed'; });

        if (completed.length > prevLabCompletedCount) {
            var order = completed[completed.length - 1] || {};
            var flag = String(order.flag || '');
            var critical = flag === 'Critical';
            var abnormal = critical || flag === 'Abnormal';

            MediTrackNotify.event(critical ? 'lab.result.critical' : 'lab.result.ready', {
                key: 'labresult:' + order.id,
                type: abnormal && !critical ? 'warning' : undefined,
                title: critical ? 'Critical Lab Result' : (abnormal ? 'Abnormal Lab Result' : 'Lab Result Released'),
                message: (order.test || 'Diagnostic panel') + ' for ' + (order.patientName || 'patient') +
                         (abnormal ? ' is outside the reference range — review now.' : ' is ready for review.')
            });
        } else if (labs.length > prevLabCount) {
            /* New orders only interrupt when marked urgent/STAT. */
            var newOrder = labs[labs.length - 1] || {};
            var priority = String(newOrder.priority || 'Routine').toLowerCase();
            if (priority === 'urgent' || priority === 'stat') {
                MediTrackNotify.event('lab.request.urgent', {
                    key: 'laborder:' + newOrder.id,
                    title: newOrder.priority + ' Lab Request',
                    message: (newOrder.test || 'Test') + ' for ' + (newOrder.patientName || 'patient') +
                             ' flagged ' + newOrder.priority + '.'
                });
            }
        }

        prevLabCount = labs.length;
        prevLabCompletedCount = completed.length;
    }

    function init() {
        snapshotCounts();

        window.addEventListener('storage', function (e) {
            if (e.key === STORAGE_NOTIFS_KEY) {
                window.dispatchEvent(new CustomEvent('meditrack:notifications-updated'));
            } else if (e.key === STORAGE_KEY_PATIENTS) {
                handlePatientChange(e.newValue);
            } else if (e.key === STORAGE_KEY_LAB) {
                handleLabChange(e.newValue);
            } else if (e.key === STORAGE_CALL_ALERT && e.newValue) {
                handleCallAlert(e.newValue);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window);
