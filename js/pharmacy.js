/* ==========================================================================
   MediTrack Hospital ERP - Pharmacy

   Prescriptions exist in two places: the global dispensary list and the patient
   record. Dispensing writes to both, otherwise the consultation desk keeps
   showing the order as outstanding.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;

    var prescriptions = [];
    var currentTab = 'pending';
    var searchTerm = '';
    var routeFilter = '';

    var FREQ_LABEL = {
        BID: 'Twice daily (BID)',
        TID: 'Three times daily (TID)',
        QID: 'Four times daily (QID)',
        QD: 'Once daily (QD)',
        PRN: 'As required (PRN)',
        STAT: 'Immediately (STAT)'
    };

    var ROUTE_LABEL = {
        Oral: 'Oral (PO)',
        IV: 'Intravenous (IV)',
        IM: 'Intramuscular (IM)',
        Topical: 'Topical',
        Inhalation: 'Inhalation'
    };

    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }
    function byId(id) { return document.getElementById(id); }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value === null || value === undefined || value === '' ? '—' : value;
    }

    function isDispensed(rx) { return String(rx.status) === 'Dispensed'; }

    /* ==================================================================
       Load / save
       ================================================================== */
    function load() {
        prescriptions = store.read(store.KEYS.prescriptions);
        render();
    }

    function save() {
        store.write(store.KEYS.prescriptions, prescriptions);
    }

    function findRx(id) {
        var hit = null;
        prescriptions.forEach(function (rx) {
            if (String(rx.id) === String(id)) hit = rx;
        });
        return hit;
    }

    function syncToPatient(rx) {
        var patients = store.readPatients();
        var p = store.findPatient(patients, rx.patientId);
        if (!p && rx.trackingId) {
            patients.forEach(function (x) { if (x.trackingId === rx.trackingId) p = x; });
        }
        if (!p) return;

        var existing = null;
        (p.prescriptions || []).forEach(function (o) {
            if (String(o.id) === String(rx.id)) existing = o;
        });

        if (existing) {
            existing.status = rx.status;
            existing.dispensedAt = rx.dispensedAt;
            existing.quantity = rx.quantity;
            existing.batch = rx.batch;
            existing.counselling = rx.counselling;
        } else {
            p.prescriptions.push(rx);
        }

        if (isDispensed(rx) &&
            p.status === store.STATUS.AWAITING &&
            store.openOrderCount(p) === 0) {
            p.status = store.STATUS.PENDING;
        }

        store.writePatients(patients);
    }

    /* ==================================================================
       Render
       ================================================================== */
    function render() {
        var pending = prescriptions;

        setText('pharmPendingCount', pending.length);

        var rows = pending.filter(function (rx) {
            if (routeFilter && rx.route !== routeFilter) return false;
            if (!searchTerm) return true;
            var q = searchTerm.toLowerCase();
            return [rx.patientName, rx.trackingId, rx.medication, rx.doctor].some(function (f) {
                return String(f || '').toLowerCase().indexOf(q) !== -1;
            });
        });

        /* STAT scripts first, then oldest. */
        rows.sort(function (a, b) {
            var d = (a.frequency === 'STAT' ? 0 : 1) - (b.frequency === 'STAT' ? 0 : 1);
            if (d !== 0) return d;
            return new Date(a.time) - new Date(b.time);
        });

        var grid = byId('prescriptionsCardGrid');
        if (!grid) return;

        if (!rows.length) {
            grid.innerHTML = ui.emptyState({
                icon: 'pill',
                title: 'No prescriptions yet',
                text: 'Prescriptions appear here as soon as a clinician sends them from the consultation desk.'
            });
            return;
        }

        grid.innerHTML = rows.map(cardHtml).join('');
        bindCards(grid);
    }

    function cardHtml(rx) {
        var done = isDispensed(rx);
        var stat = rx.frequency === 'STAT';

        return '<article class="rx-card' + (done ? ' is-done' : '') + (stat && !done ? ' is-stat' : '') + '">' +
            '<header class="rc-head">' +
                '<div class="rc-identity">' +
                    '<span class="rc-name">' + esc(rx.patientName) + '</span>' +
                    '<span class="rc-sub">' +
                        '<span class="mono">' + esc(rx.trackingId) + '</span>' +
                        '<span>' + esc(rx.doctor || '—') + '</span>' +
                    '</span>' +
                '</div>' +
                '<span class="badge ' + (done ? 'status-finished' : (stat ? 'status-critical' : 'status-awaiting')) + '">' +
                    esc(done ? 'Dispensed' : (stat ? 'STAT' : 'Prescribed')) +
                '</span>' +
            '</header>' +

            '<div class="rc-med">' +
                '<div class="rc-med-top">' +
                    '<strong class="rc-med-name">' + esc(rx.medication) + '</strong>' +
                    '<span class="rc-dose">' + esc(rx.dosage) + '</span>' +
                '</div>' +
                '<div class="rc-regimen">' +
                    '<span class="tag">' + esc(FREQ_LABEL[rx.frequency] || rx.frequency) + '</span>' +
                    '<span class="tag tag-rx">' + esc(ROUTE_LABEL[rx.route] || rx.route) + '</span>' +
                    (rx.duration ? '<span class="tag">' + esc(rx.duration) + '</span>' : '') +
                '</div>' +
            '</div>' +

            (rx.instructions
                ? '<div class="rc-note">' + icon('file-text', 13) +
                  '<span>' + esc(rx.instructions) + '</span></div>'
                : '') +

            (done && (rx.quantity || rx.batch)
                ? '<div class="rc-dispensed">' +
                    icon('check-circle', 13) +
                    '<span>' + esc([rx.quantity, rx.batch ? 'Batch ' + rx.batch : ''].filter(Boolean).join(' · ')) + '</span>' +
                  '</div>'
                : '') +

            '<footer class="rc-foot">' +
                '<span class="rc-time">' + icon('clock', 13) +
                    '<span>' + esc(done
                        ? 'Prescribed ' + store.relativeTime(rx.dispensedAt || rx.time)
                        : 'Waiting ' + store.elapsed(rx.time)) + '</span>' +
                '</span>' +
                '<div class="rc-actions">' +
                    '<button type="button" class="btn-primary btn-sm" data-slip="' + esc(rx.id) + '">' +
                        icon('print', 14) + '<span>Print slip</span>' +
                    '</button>' +
                '</div>' +
            '</footer>' +
        '</article>';
    }

    function bindCards(grid) {
        ui.qsa('[data-slip]', grid).forEach(function (b) {
            b.addEventListener('click', function () { openSlip(b.getAttribute('data-slip')); });
        });
    }

    /* ==================================================================
       Slip
       ================================================================== */
    function openSlip(id) {
        var rx = findRx(id);
        if (!rx) return;

        setText('rxPatientName', rx.patientName);
        setText('rxTrackingId', rx.trackingId);
        setText('rxDoctorName', rx.doctor);
        setText('rxDateTime', store.formatDateTime(rx.time));
        setText('rxMedName', rx.medication);
        setText('rxDosage', rx.dosage);
        setText('rxFrequency', FREQ_LABEL[rx.frequency] || rx.frequency);
        setText('rxRoute', ROUTE_LABEL[rx.route] || rx.route);
        setText('rxDuration', rx.duration || 'As directed');
        setText('rxInstructions', rx.instructions ||
            'Take exactly as prescribed. Return to the clinic if symptoms worsen or an adverse reaction occurs.');
        setText('rxReference', rx.trackingId + '-RX-' + rx.id);

        var wrap = byId('rxDispenseWrap');
        if (wrap) {
            if (isDispensed(rx)) {
                wrap.hidden = false;
                setText('rxDispenseInfo', [
                    rx.quantity ? 'Issued ' + rx.quantity : null,
                    rx.batch ? 'batch ' + rx.batch : null,
                    'on ' + store.formatDateTime(rx.dispensedAt),
                    rx.counselling ? '— ' + rx.counselling : null
                ].filter(Boolean).join(' · '));
            } else {
                wrap.hidden = true;
            }
        }

        ui.openModal('prescriptionModal');
    }

    /* ==================================================================
       Init
       ================================================================== */
    function init() {
        load();

        ui.initSelect('filterRouteWrapper', function (v) { routeFilter = v; render(); });

        var print = byId('printRxSlipBtn');
        if (print) print.addEventListener('click', function () { ui.printNode('rxPrintArea'); });

        var search = byId('pharmSearch');
        var clear = byId('pharmSearchClear');
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

        var reset = byId('resetPharmFiltersBtn');
        if (reset) {
            reset.addEventListener('click', function () {
                searchTerm = '';
                routeFilter = '';
                if (search) search.value = '';
                if (clear) clear.classList.remove('visible');
                ui.setSelectValue('filterRouteWrapper', '', 'All routes');
                render();
            });
        }

        window.addEventListener('storage', function (e) {
            if (!e.key || e.key === store.KEYS.prescriptions) load();
        });
        window.addEventListener('meditrack:patients-updated', load);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
