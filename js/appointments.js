/* ==========================================================================
   MediTrack Hospital ERP - Appointments

   Online booking requests land here as "Pending". A doctor may only decide
   the appointments addressed to them; administrators see and manage all of
   them. Every decision records who made it and composes the patient
   notification that the online integration will deliver.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var session = window.MediSession;

    var appointments = [];
    var filter = 'all';
    var searchTerm = '';

    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }
    function byId(id) { return document.getElementById(id); }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value;
    }

    function me() {
        try { return session.read() || {}; }
        catch (e) { return {}; }
    }

    function isAdmin() { return session.role() === 'admin'; }
    function isDoctor() { return session.role() === 'doctor'; }

    function todayKey() {
        var t = new Date();
        return t.getFullYear() + '-' +
            String(t.getMonth() + 1).padStart(2, '0') + '-' +
            String(t.getDate()).padStart(2, '0');
    }

    function api(path, body) {
        return fetch(path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (store.authToken() || '')
            },
            body: JSON.stringify(body || {})
        }).then(function (r) {
            return r.json().then(function (j) { return { status: r.status, j: j }; });
        });
    }

    /* ==================================================================
        Render
        ================================================================== */
    var STATUS_BADGE = {
        Pending:   'status-pending',
        Accepted:  'status-finished',
        Declined:  'status-critical',
        Completed: 'status-awaiting',
        Cancelled: 'status-awaiting'
    };

    function visibleAppointments() {
        var who = me();
        var list = appointments.slice();

        /* Doctors only see the appointments addressed to them. */
        if (isDoctor()) {
            list = list.filter(function (a) { return a.doctor === who.name; });
        }

        if (filter === 'today') {
            list = list.filter(function (a) { return a.date === todayKey() && a.status === 'Accepted'; });
        } else if (filter === 'online') {
            list = list.filter(function (a) { return a.source === 'online'; });
        } else if (filter !== 'all') {
            list = list.filter(function (a) { return a.status === filter; });
        }

        if (searchTerm) {
            var q = searchTerm.toLowerCase();
            list = list.filter(function (a) {
                return String(a.patientName || '').toLowerCase().indexOf(q) !== -1 ||
                    String(a.doctor || '').toLowerCase().indexOf(q) !== -1 ||
                    String(a.patientPhone || '').indexOf(q) !== -1;
            });
        }

        list.sort(function (a, b) {
            /* Pending first, then soonest. */
            var pa = a.status === 'Pending' ? 0 : 1;
            var pb = b.status === 'Pending' ? 0 : 1;
            if (pa !== pb) return pa - pb;
            return String(a.date).localeCompare(String(b.date)) ||
                String(a.time || '').localeCompare(String(b.time || ''));
        });
        return list;
    }

    function render() {
        var pending = appointments.filter(function (a) { return a.status === 'Pending'; }).length;
        var today = appointments.filter(function (a) {
            return a.date === todayKey() && a.status === 'Accepted';
        }).length;
        var accepted = appointments.filter(function (a) { return a.status === 'Accepted'; }).length;
        var declined = appointments.filter(function (a) { return a.status === 'Declined'; }).length;

        setText('apptStatPending', pending);
        setText('apptStatToday', today);
        setText('apptStatAccepted', accepted);
        setText('apptStatDeclined', declined);

        var grid = byId('apptGrid');
        if (!grid) return;

        var rows = visibleAppointments();
        if (!rows.length) {
            grid.innerHTML = ui.emptyState({
                icon: 'calendar-check',
                title: searchTerm || filter !== 'all' ? 'Nothing matches' : 'No appointments yet',
                text: isDoctor()
                    ? 'Appointments your patients book with you appear here to accept or decline.'
                    : 'Online booking requests and staff bookings appear here.'
            });
            return;
        }

        grid.innerHTML = rows.map(function (a) {
            var decidable = a.status === 'Pending' &&
                (isAdmin() || (isDoctor() && a.doctor === me().name));
            return '<article class="appt-card" data-id="' + esc(a.id) + '">' +
                '<div class="appt-head">' +
                    '<div>' +
                        '<div class="appt-patient">' + esc(a.patientName) + '</div>' +
                        '<div class="appt-doctor">' + icon('phone', 12) + '<span>' + esc(store.formatPhone(a.patientPhone) || a.patientPhone) + '</span></div>' +
                    '</div>' +
                    '<span class="badge ' + (STATUS_BADGE[a.status] || 'status-pending') + '">' + esc(a.status) + '</span>' +
                '</div>' +
                '<div class="appt-when">' +
                    '<span class="appt-date">' + icon('calendar-check', 13) + '<span>' + esc(a.date) + '</span></span>' +
                    '<span>' + icon('clock', 13) + ' ' + esc(a.time || '—') + '</span>' +
                    '<span class="appt-doctor">' + icon('stethoscope', 13) + ' ' + esc(a.doctor || 'First available doctor') + '</span>' +
                '</div>' +
                (a.reason ? '<p class="appt-reason">' + esc(a.reason) + '</p>' : '') +
                '<div class="appt-flags">' +
                    '<span class="badge ' + (a.source === 'online' ? 'status-awaiting' : 'status-pending') + '">' +
                        icon(a.source === 'online' ? 'megaphone' : 'user-check', 11) +
                        '<span>' + (a.source === 'online' ? 'Online booking' : 'Booked by staff') + '</span>' +
                    '</span>' +
                    (a.decidedBy ? '<span class="badge status-finished">' + icon('user', 11) +
                        '<span>' + esc(a.decidedBy) + '</span></span>' : '') +
                '</div>' +
                (a.patientNotification && a.patientNotification.text
                    ? '<div class="appt-notify-note">' + icon('bell', 12) + ' Patient notification' +
                      (a.patientNotification.due ? ' (to deliver)' : ' (delivered)') + ': ' +
                      esc(a.patientNotification.text) + '</div>'
                    : '') +
                '<div class="appt-foot">' +
                    '<span class="req-time" style="font-size:12px;color:var(--text-soft,#64748b)">' +
                        esc(store.relativeTime(a.createdAt)) + ' · ' + esc(a.createdBy || '') + '</span>' +
                    '<div class="appt-actions">' +
                        (decidable
                            ? '<button type="button" class="btn-secondary btn-sm" data-accept="' + esc(a.id) + '">' +
                              icon('check', 13) + '<span>Accept</span></button>' +
                              '<button type="button" class="btn-danger btn-sm" data-decline="' + esc(a.id) + '">' +
                              icon('close', 13) + '<span>Decline</span></button>'
                            : '') +
                        (isAdmin() && a.status === 'Pending'
                            ? '<button type="button" class="btn-icon" data-cancel="' + esc(a.id) + '" title="Cancel request" aria-label="Cancel request">' +
                              icon('trash', 14) + '</button>'
                            : '') +
                    '</div>' +
                '</div>' +
            '</article>';
        }).join('');

        bind(grid);
    }

    function bind(grid) {
        ui.qsa('[data-accept]', grid).forEach(function (b) {
            b.addEventListener('click', function () { decide(b.getAttribute('data-accept'), 'Accepted'); });
        });
        ui.qsa('[data-decline]', grid).forEach(function (b) {
            b.addEventListener('click', function () { decide(b.getAttribute('data-decline'), 'Declined'); });
        });
        ui.qsa('[data-cancel]', grid).forEach(function (b) {
            b.addEventListener('click', function () { cancelAppointment(b.getAttribute('data-cancel')); });
        });
    }

    /* ==================================================================
        Actions
        ================================================================== */
    function findAppt(id) {
        var out = null;
        appointments.forEach(function (a) { if (String(a.id) === String(id)) out = a; });
        return out;
    }

    function applyUpdate(updated) {
        appointments = appointments.map(function (a) {
            return String(a.id) === String(updated.id) ? updated : a;
        });
        render();
    }

    function decide(id, decision) {
        var appt = findAppt(id);
        if (!appt) return;

        ui.confirmAction({
            title: decision === 'Accepted' ? 'Accept appointment' : 'Decline appointment',
            subtitle: appt.patientName + ' · ' + appt.date + ' ' + (appt.time || ''),
            message: decision === 'Accepted'
                ? appt.patientName + ' will be told the appointment with ' + appt.doctor + ' is confirmed.'
                : appt.patientName + ' will be told this appointment could not be taken and should rebook.',
            confirmLabel: decision,
            tone: decision === 'Accepted' ? 'info' : 'danger',
            icon: decision === 'Accepted' ? 'check-circle' : 'close'
        }, function () {
            api('/api/appointments/decision', { id: id, decision: decision })
                .then(function (out) {
                    if (out.status === 200 && out.j.appointment) {
                        applyUpdate(out.j.appointment);
                        /* Pull the server snapshot so the cards and the
                           counters agree without a manual reload. */
                        store.refresh(true);
                        window.MediTrackNotify.flash('Appointment ' + decision.toLowerCase(),
                            appt.patientName + ' · ' + appt.date + '.');
                    } else {
                        window.MediTrackNotify.flash('Not recorded',
                            (out.j && out.j.error) || 'The decision could not be saved.', 'error');
                        if (out.status === 401) store.setAuthToken(null);
                    }
                })
                .catch(function () {
                    window.MediTrackNotify.flash('Server unreachable',
                        'Check the network connection and try again.', 'error');
                });
        });
    }

    function cancelAppointment(id) {
        var appt = findAppt(id);
        if (!appt) return;
        ui.confirmAction({
            title: 'Cancel this request',
            subtitle: appt.patientName + ' · ' + appt.date,
            message: 'The request is removed from the pending list and marked cancelled.',
            confirmLabel: 'Cancel request',
            tone: 'danger',
            icon: 'trash'
        }, function () {
            appt.status = 'Cancelled';
            appt.decidedBy = me().name || 'Administrator';
            appt.decidedAt = new Date().toISOString();
            store.write(store.KEYS.appointments, appointments);
            render();
        });
    }

    /* ==================================================================
       Init
       ================================================================== */
    function load() {
        appointments = store.read(store.KEYS.appointments);
        render();
    }

    function init() {
        load();

        ui.initChips('apptFilterChips', 'data-appt-filter', function (value) {
            filter = value || 'all';
            render();
        });

        var search = byId('apptSearch');
        var clear = byId('apptSearchClear');
        if (search) {
            search.addEventListener('input', function () {
                searchTerm = search.value.trim();
                if (clear) clear.classList.toggle('visible', !!searchTerm);
                render();
            });
        }
        if (clear) {
            clear.addEventListener('click', function () {
                if (search) search.value = '';
                searchTerm = '';
                clear.classList.remove('visible');
                render();
            });
        }

        ui.bindLiveValidation(['apptPatientName', 'apptPatientPhone']);

        window.addEventListener('storage', function (e) {
            if (!e.key || e.key === store.KEYS.appointments || e.key === 'clinic_staff_members') load();
        });
        /* Redraw only when something actually moved: the list is rebuilt
           from scratch each time, and a repaint every 8 seconds with no
           change is pure waste on the reception machine. */
        var lastSig = '';
        setInterval(function () {
            if (document.hidden) return;
            var fresh = store.read(store.KEYS.appointments);
            var sig = fresh.length + '|' + (fresh.length ? (fresh[0] && fresh[0].id) || '' : '') + '|' + filter;
            if (sig === lastSig) return;
            lastSig = sig;
            appointments = fresh;
            render();
        }, 8000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
