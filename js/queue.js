/* ==========================================================================
   MediTrack Hospital ERP - Triage Queue

   This is the only screen that may change the calling order, and it does so by
   setting a persisted policy in js/store.js rather than a local sort. Search
   and priority filters affect what is displayed, never the queue positions.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var STATUS = store.STATUS;

    var patients = [];
    var searchTerm = '';
    var urgencyFilter = '';
    var ticketPatientId = null;
    var ticketPosition = '01';

    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }
    function byId(id) { return document.getElementById(id); }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value;
    }

    function urgencyClass(u) {
        return 'urgency-' + String(store.normalizeUrgency(u)).toLowerCase();
    }

    /* ==================================================================
       Render
       ================================================================== */
    function render() {
        var queue = store.queueOrder(patients);         /* authoritative order */
        var consulting = store.consultingPatients(patients);

        var emergencies = queue.filter(function (p) {
            return store.normalizeUrgency(p.urgency) === store.URGENCY.EMERGENCY;
        }).length;

        setText('queueTotalCount', queue.length);
        setText('queueConsultingCount', consulting.length);

        var emPill = byId('queueEmergencyPill');
        if (emPill) {
            emPill.hidden = emergencies === 0;
            setText('queueEmergencyCount', emergencies);
        }

        renderPolicy();

        /* Positions are assigned before filtering so a filtered view still
           shows each patient's true place in the queue. */
        var withPositions = queue.map(function (p, i) {
            return { patient: p, position: i + 1 };
        });

        var visible = withPositions.filter(function (row) {
            var p = row.patient;
            if (urgencyFilter && store.normalizeUrgency(p.urgency) !== urgencyFilter) return false;
            if (!searchTerm) return true;
            var q = searchTerm.toLowerCase();
            return String(p.name || '').toLowerCase().indexOf(q) !== -1 ||
                String(p.trackingId || '').toLowerCase().indexOf(q) !== -1 ||
                String(p.phone || '').replace(/\s+/g, '').indexOf(q.replace(/\s+/g, '')) !== -1;
        });

        var grid = byId('queueCardGrid');
        if (!grid) return;

        if (!visible.length) {
            grid.innerHTML = ui.emptyState({
                icon: queue.length ? 'search' : 'check-circle',
                title: queue.length ? 'No patients match this search' : 'The queue is clear',
                text: queue.length
                    ? 'Clear the search or priority filter to see the full queue.'
                    : 'Patients appear here as soon as reception completes registration and triage.'
            });
            return;
        }

        grid.innerHTML = visible.map(function (row) {
            return cardHtml(row.patient, row.position);
        }).join('');

        bind(grid);
    }

    function renderPolicy() {
        var policy = store.queuePolicy();
        var fifo = policy === store.POLICIES.FIFO;

        setText('policyName', store.policyLabel(policy));
        setText('policyExplain', fifo
            ? 'Strict registration order. Clinical priority is ignored, so emergency arrivals wait their turn.'
            : 'Emergency, then Urgent, then Routine. Within the same priority, whoever arrived first is called first.');

        ui.setSelectValue('queuePolicySelect', policy, store.policyLabel(policy));

        var bar = document.querySelector('.policy-bar');
        if (bar) bar.classList.toggle('policy-risk', fifo);
    }

    function cardHtml(p, position) {
        var urgency = store.normalizeUrgency(p.urgency);
        var vitals = p.vitals;
        var bp = store.bloodPressureText(vitals);

        return '<article class="queue-card ' + urgencyClass(urgency) + '" data-id="' + esc(p.id) + '">' +
            '<header class="qc-head">' +
                '<span class="qc-position">' + String(position).padStart(2, '0') + '</span>' +
                '<div class="qc-identity">' +
                    '<span class="qc-name">' + esc(p.name) + '</span>' +
                    '<span class="qc-sub">' +
                        '<span class="mono">' + esc(p.trackingId) + '</span>' +
                        (p.age !== null ? '<span>' + esc(p.age) + ' yrs</span>' : '') +
                        (p.sex ? '<span>' + esc(p.sex) + '</span>' : '') +
                    '</span>' +
                '</div>' +
                '<span class="badge ' + urgencyClass(urgency) + '">' + esc(urgency) + '</span>' +
            '</header>' +

            '<p class="qc-complaint">' + esc(p.description || 'No complaint recorded at triage.') + '</p>' +

            '<div class="qc-vitals">' +
                vitalChip('BP', bp, 'mmHg') +
                vitalChip('Pulse', vitals.pulse === null ? '—' : Math.round(vitals.pulse), 'bpm') +
                vitalChip('Temp', vitals.temperature === null ? '—' : vitals.temperature.toFixed(1), '\u00B0C') +
                vitalChip('SpO\u2082', vitals.spo2 === null ? '—' : Math.round(vitals.spo2), '%') +
            '</div>' +

            '<footer class="qc-foot">' +
                '<span class="qc-waited">' + icon('clock', 13) +
                    '<span>Waiting <strong data-elapsed="' + esc(p.registered) + '">' +
                        esc(store.elapsed(p.registered)) + '</strong></span>' +
                '</span>' +
                '<div class="qc-actions">' +
                    '<button type="button" class="btn-icon" data-ticket="' + esc(p.id) + '" data-pos="' +
                        String(position).padStart(2, '0') + '" title="Print queue slip" aria-label="Print queue slip">' +
                        icon('print', 15) +
                    '</button>' +
                    '<button type="button" class="btn-secondary btn-sm" data-escalate="' + esc(p.id) + '">' +
                        icon('warning', 14) + '<span>Escalate</span>' +
                    '</button>' +
                '</div>' +
            '</footer>' +
        '</article>';
    }

    function vitalChip(label, value, unit) {
        return '<div class="qc-vital">' +
            '<span class="qc-vital-label">' + esc(label) + '</span>' +
            '<span class="qc-vital-value">' + esc(value) +
                (String(value) === '—' ? '' : '<small>' + esc(unit) + '</small>') +
            '</span>' +
        '</div>';
    }

    function bind(grid) {
        ui.qsa('[data-ticket]', grid).forEach(function (btn) {
            btn.addEventListener('click', function () {
                openTicket(btn.getAttribute('data-ticket'), btn.getAttribute('data-pos'));
            });
        });
        ui.qsa('[data-escalate]', grid).forEach(function (btn) {
            btn.addEventListener('click', function () {
                escalate(btn.getAttribute('data-escalate'));
            });
        });
    }

    /* ==================================================================
       Actions
       ================================================================== */
    /* Reception can raise priority when a waiting patient deteriorates.
       Priority is never lowered here: that is a clinical decision. */
    function escalate(id) {
        var p = store.findPatient(patients, id);
        if (!p) return;

        var current = store.normalizeUrgency(p.urgency);
        if (current === store.URGENCY.EMERGENCY) {
            window.MediTrackNotify.flash('Already highest priority', p.name + ' is already flagged Emergency.', 'info');
            return;
        }
        var next = current === store.URGENCY.URGENT ? store.URGENCY.EMERGENCY : store.URGENCY.URGENT;

        ui.confirmAction({
            title: 'Escalate to ' + next,
            subtitle: p.name + ' · ' + p.trackingId,
            message: 'This moves ' + p.name + ' up the calling order immediately and alerts the consultation desk.',
            confirmLabel: 'Escalate to ' + next,
            tone: next === store.URGENCY.EMERGENCY ? 'danger' : 'warning',
            icon: 'warning'
        }, function () {
            p.urgency = next;
            store.writePatients(patients);

            if (next === store.URGENCY.EMERGENCY) {
                window.MediTrackNotify.event('queue.emergency', {
                    key: 'escalated:' + p.id,
                    title: 'Escalated to Emergency',
                    message: p.name + ' (' + p.trackingId + ') requires immediate assessment.'
                });
            } else {
                window.MediTrackNotify.flash('Priority raised', p.name + ' is now ' + next + '.');
            }
        });
    }

    function changePolicy(value) {
        var current = store.queuePolicy();
        if (value === current) return;

        var toFifo = value === store.POLICIES.FIFO;

        ui.confirmAction({
            title: 'Change the calling policy',
            subtitle: store.policyLabel(current) + ' \u2192 ' + store.policyLabel(value),
            message: toFifo
                ? 'Arrival order ignores clinical priority. Emergency and Urgent patients will wait behind earlier routine arrivals until the policy is changed back. This affects the whole department.'
                : 'Triage priority calls Emergency and Urgent patients ahead of Routine arrivals. This is the clinical default.',
            confirmLabel: 'Apply ' + store.policyLabel(value).toLowerCase(),
            tone: toFifo ? 'danger' : 'info',
            icon: toFifo ? 'warning' : 'shield-check'
        }, function () {
            store.setQueuePolicy(value);
            render();
            if (toFifo) {
                window.MediTrackNotify.push(
                    'Calling Policy Changed',
                    'The queue now runs in strict arrival order. Clinical priority is not applied.',
                    'warning', 'Queue', 'high'
                );
            } else {
                window.MediTrackNotify.flash('Policy restored', 'Queue is calling by triage priority again.');
            }
        });

        /* Revert the control until the change is actually confirmed. */
        ui.setSelectValue('queuePolicySelect', current, store.policyLabel(current));
    }

    /* ------------------------------------------------------------ ticket */
    function openTicket(id, position) {
        var p = store.findPatient(patients, id);
        if (!p) return;

        ticketPatientId = p.id;
        ticketPosition = position || '01';

        setText('ticketQueueNumber', ticketPosition);
        setText('ticketTrackingId', p.trackingId);
        setText('ticketPatientName', p.name);
        setText('ticketAge', p.age === null ? '—' : p.age + ' yrs');
        setText('ticketUrgency', store.normalizeUrgency(p.urgency));
        setText('ticketRegistered', store.formatDateTime(p.registered));

        ui.openModal('ticketModal');
    }

    /* ==================================================================
       Init
       ================================================================== */
    function tickElapsed() {
        ui.qsa('[data-elapsed]').forEach(function (el) {
            el.textContent = store.elapsed(el.getAttribute('data-elapsed'));
        });
    }

    function init() {
        patients = store.seedIfEmpty();
        if (!patients.length) patients = store.readPatients();
        render();

        ui.initSelect('queuePolicySelect', changePolicy);
        ui.initSelect('filterUrgencyWrapper', function (value) {
            urgencyFilter = value;
            render();
        });

        var search = byId('queueSearch');
        var clear = byId('queueSearchClear');
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

        var reset = byId('resetFiltersBtn');
        if (reset) {
            reset.addEventListener('click', function () {
                searchTerm = '';
                urgencyFilter = '';
                if (search) search.value = '';
                if (clear) clear.classList.remove('visible');
                ui.setSelectValue('filterUrgencyWrapper', '', 'All priorities');
                render();
            });
        }

        var print = byId('printTicketBtn');
        if (print) {
            print.addEventListener('click', function () {
                ui.printNode('ticketPaper');
            });
        }

        store.onPatientsChanged(function () {
            patients = store.readPatients();
            render();
        });

        setInterval(tickElapsed, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
