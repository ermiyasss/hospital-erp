/* ==========================================================================
   MediTrack Hospital ERP - Nurse Station

   Nursing orders live on the patient record, so this screen flattens them into
   a worklist and writes completions straight back. Completing a task can also
   record fresh observations, which are re-interpreted by js/clinical.js — that
   is how deterioration reaches the clinician without a phone call.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var clinical = window.MediClinical;

    var patients = [];
    var openTasks = [];
    var doneTasks = [];
    var directives = [];
    var searchTerm = '';
    var currentTab = 'panelOrders';

    var activeTask = null;   /* { patientId, orderId } */

    /* The signed-in nurse is the default performer; the name can be edited
       per task (e.g. a colleague covers one injection). */
    function currentStaffName() {
        try {
            var s = window.MediSession && window.MediSession.read();
            if (s && s.name) return s.name;
        } catch (e) {}
        return 'Nurse on duty';
    }
    var NURSE = 'Nurse on duty';

    var OBS_FIELDS = [
        ['obsSystolic', 'systolic'],
        ['obsDiastolic', 'diastolic'],
        ['obsPulse', 'pulse'],
        ['obsTemp', 'temperature'],
        ['obsSpo2', 'spo2'],
        ['obsRespRate', 'respRate']
    ];

    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }
    function byId(id) { return document.getElementById(id); }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value === null || value === undefined || value === '' ? '—' : value;
    }

    /* ==================================================================
       Load
       ================================================================== */
    function load() {
        patients = store.readPatients();
        openTasks = [];
        doneTasks = [];

        patients.forEach(function (p) {
            (p.nurseOrders || []).forEach(function (o) {
                var entry = {
                    patientId: p.id,
                    orderId: o.id,
                    patientName: p.name,
                    trackingId: p.trackingId,
                    urgency: store.normalizeUrgency(p.urgency),
                    task: o.task,
                    note: o.note,
                    doctor: o.doctor,
                    time: o.time,
                    status: o.status || 'Dispatched',
                    outcome: o.outcome,
                    completedBy: o.completedBy,
                    completedAt: o.completedAt
                };
                if (store.isOrderOpen(o)) openTasks.push(entry);
                else doneTasks.push(entry);
            });
        });

        /* Oldest outstanding first: a nursing worklist, not a news feed. */
        openTasks.sort(function (a, b) { return new Date(a.time) - new Date(b.time); });
        doneTasks.sort(function (a, b) {
            return new Date(b.completedAt || b.time) - new Date(a.completedAt || a.time);
        });

        directives = store.read('clinic_nurse_directives');
        if (!directives.length) {
            directives = seedDirectives();
            store.write('clinic_nurse_directives', directives);
        }

        render();
    }

    function seedDirectives() {
        var hoursAgo = function (h) { return new Date(Date.now() - h * 3600000).toISOString(); };
        return [
            {
                id: 1,
                title: 'Hand hygiene audit this shift',
                body: 'Complete the hand hygiene compliance checklist before the first bedside round. Antiseptic dispensers have been refilled at every bay.',
                from: 'Nursing supervisor',
                time: hoursAgo(2),
                acknowledged: false
            },
            {
                id: 2,
                title: 'Crash cart verification',
                body: 'Verify defibrillator pads, adrenaline and IV cannulation kits on your floor. Report shortages to pharmacy before handover.',
                from: 'Nursing supervisor',
                time: hoursAgo(5),
                acknowledged: false
            }
        ];
    }

    /* ==================================================================
       Render
       ================================================================== */
    function render() {
        setText('nurseActiveCount', openTasks.length);
        setText('nurseCompletedCount', doneTasks.length);
        setText('tabOrdersCount', openTasks.length);
        setText('tabCompletedCount', doneTasks.length);

        var unread = directives.filter(function (d) { return !d.acknowledged; }).length;
        var dirCount = byId('tabDirectivesCount');
        if (dirCount) {
            dirCount.textContent = unread;
            dirCount.classList.toggle('count-alert', unread > 0);
        }

        renderTasks(openTasks, 'nurseOrdersGrid', false);
        renderTasks(doneTasks, 'completedOrdersGrid', true);
        renderDirectives();
    }

    function matches(t) {
        if (!searchTerm) return true;
        var q = searchTerm.toLowerCase();
        return [t.patientName, t.task, t.doctor, t.trackingId].some(function (f) {
            return String(f || '').toLowerCase().indexOf(q) !== -1;
        });
    }

    function renderTasks(list, hostId, done) {
        var host = byId(hostId);
        if (!host) return;

        var rows = list.filter(matches);

        if (!rows.length) {
            host.innerHTML = ui.emptyState({
                icon: done ? 'check-circle' : 'clipboard',
                title: done ? 'No completed tasks yet' : 'No outstanding nursing orders',
                text: done
                    ? 'Completed tasks are kept here with the outcome recorded by the nurse.'
                    : 'Orders appear here as soon as a clinician dispatches them from the consultation desk.'
            });
            return;
        }

        host.innerHTML = rows.map(function (t) {
            return '<article class="nurse-card' + (done ? ' is-done' : '') + '">' +
                '<header class="nc-head">' +
                    '<span class="avatar-sq urgency-' + esc(t.urgency.toLowerCase()) + '">' +
                        esc(store.initials(t.patientName)) +
                    '</span>' +
                    '<div class="nc-identity">' +
                        '<span class="nc-name">' + esc(t.patientName) + '</span>' +
                        '<span class="nc-sub">' +
                            '<span class="mono">' + esc(t.trackingId) + '</span>' +
                            '<span class="badge urgency-' + esc(t.urgency.toLowerCase()) + '">' + esc(t.urgency) + '</span>' +
                        '</span>' +
                    '</div>' +
                    '<span class="badge ' + (done ? 'status-finished' : 'status-awaiting') + '">' +
                        esc(done ? 'Completed' : t.status) +
                    '</span>' +
                '</header>' +

                '<div class="nc-task">' +
                    '<span class="nc-task-label">Task</span>' +
                    '<strong>' + esc(t.task) + '</strong>' +
                '</div>' +

                (t.note
                    ? '<div class="nc-note">' + icon('file-text', 13) +
                      '<span><strong>Instruction:</strong> ' + esc(t.note) + '</span></div>'
                    : '') +

                (done && t.outcome
                    ? '<div class="nc-outcome">' +
                        '<span class="nc-task-label">Outcome</span>' +
                        '<span>' + esc(t.outcome) + '</span>' +
                      '</div>'
                    : '') +

                (done && t.completedBy
                    ? '<div class="nc-note">' + icon('nurse', 13) +
                      '<span><strong>Performed by:</strong> ' + esc(t.completedBy) + '</span></div>'
                    : '') +

                '<footer class="nc-foot">' +
                    '<span class="nc-meta">' + icon('clock', 13) +
                        '<span>' + esc(done
                            ? 'Completed ' + store.relativeTime(t.completedAt || t.time)
                            : 'Outstanding ' + store.elapsed(t.time)) +
                        '</span>' +
                    '</span>' +
                    (done
                        ? '<span class="nc-from">' + esc(t.doctor || '—') + '</span>'
                        : '<button type="button" class="btn-primary btn-sm" data-complete="' +
                          esc(t.patientId) + '" data-order="' + esc(t.orderId) + '">' +
                            icon('check', 14) + '<span>Complete</span>' +
                          '</button>') +
                '</footer>' +
            '</article>';
        }).join('');

        if (!done) {
            ui.qsa('[data-complete]', host).forEach(function (btn) {
                btn.addEventListener('click', function () {
                    openCompleteModal(btn.getAttribute('data-complete'), btn.getAttribute('data-order'));
                });
            });
        }
    }

    function renderDirectives() {
        var host = byId('directivesList');
        if (!host) return;

        if (!directives.length) {
            host.innerHTML = ui.emptyState({
                icon: 'list',
                title: 'No standing directives',
                text: 'Ward-level instructions from the nursing supervisor appear here.'
            });
            return;
        }

        host.innerHTML = directives.map(function (d) {
            return '<article class="directive' + (d.acknowledged ? ' is-ack' : '') + '">' +
                '<header class="dir-head">' +
                    '<h4>' + esc(d.title) + '</h4>' +
                    '<span class="dir-time">' + esc(store.formatDateTime(d.time)) + '</span>' +
                '</header>' +
                '<p class="dir-body">' + esc(d.body) + '</p>' +
                '<footer class="dir-foot">' +
                    '<span class="dir-from">' + esc(d.from) + '</span>' +
                    (d.acknowledged
                        ? '<span class="badge status-finished">' + icon('check', 12) + '<span>Acknowledged</span></span>'
                        : '<button type="button" class="btn-secondary btn-sm" data-ack="' + esc(d.id) + '">' +
                            icon('check', 14) + '<span>Acknowledge</span>' +
                          '</button>') +
                '</footer>' +
            '</article>';
        }).join('');

        ui.qsa('[data-ack]', host).forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-ack');
                directives.forEach(function (d) {
                    if (String(d.id) === String(id)) {
                        d.acknowledged = true;
                        d.acknowledgedAt = new Date().toISOString();
                    }
                });
                store.write('clinic_nurse_directives', directives);
                render();
            });
        });
    }

    /* ==================================================================
       Complete a task
       ================================================================== */
    function openCompleteModal(patientId, orderId) {
        var p = store.findPatient(patients, patientId);
        if (!p) return;
        var order = null;
        (p.nurseOrders || []).forEach(function (o) {
            if (String(o.id) === String(orderId)) order = o;
        });
        if (!order) return;

        activeTask = { patientId: p.id, orderId: order.id };

        setText('completeTaskSub', p.name + ' · ' + p.trackingId);
        setText('taskName', order.task);
        setText('taskInstruction', order.note || 'No additional instruction given.');

        byId('taskNurseName').value = currentStaffName();
        byId('taskOutcome').value = '';
        ui.clearFieldError('taskNurseName');
        ui.clearFieldError('taskOutcome');

        /* Pre-fill with the last recorded values so the nurse edits, not retypes. */
        OBS_FIELDS.forEach(function (pair) {
            var v = p.vitals[pair[1]];
            byId(pair[0]).value = v === null || v === undefined ? '' : v;
        });

        refreshObsReadout();
        ui.openModal('completeTaskModal');
    }

    function readObs() {
        var v = {};
        OBS_FIELDS.forEach(function (pair) {
            var el = byId(pair[0]);
            v[pair[1]] = store.toNumber(el ? el.value : '');
        });
        return v;
    }

    function refreshObsReadout() {
        var host = byId('obsReadout');
        if (!host) return;

        var assessment = clinical.assess(readObs());
        if (!assessment.recordedCount) { host.innerHTML = ''; return; }

        var tone = assessment.overall === 'critical' ? 'notice-danger'
            : (assessment.overall === 'normal' ? 'notice-success' : 'notice-warning');

        host.innerHTML =
            '<div class="notice ' + tone + '">' +
                '<span class="ico" data-icon="' +
                    (assessment.overall === 'normal' ? 'check-circle' : 'warning') + '" data-icon-size="15"></span>' +
                '<div><strong>' + esc(assessment.overallLabel) + ' observations</strong>' +
                esc(assessment.summary) + '</div>' +
            '</div>';

        if (window.MediIcons) window.MediIcons.hydrate(host);
    }

    function completeTask() {
        if (!activeTask) return;

        if (!ui.requireFields([
            { id: 'taskNurseName', message: 'Enter the name of the nurse who performed the task.' },
            { id: 'taskOutcome', message: 'Record what was done or observed.' }
        ])) return;

        var all = store.readPatients();
        var p = store.findPatient(all, activeTask.patientId);
        if (!p) return;

        var order = null;
        (p.nurseOrders || []).forEach(function (o) {
            if (String(o.id) === String(activeTask.orderId)) order = o;
        });
        if (!order) return;

        order.status = 'Completed';
        order.completedAt = new Date().toISOString();
        order.outcome = byId('taskOutcome').value.trim();
        order.completedBy = byId('taskNurseName').value.trim() || currentStaffName();

        /* Only overwrite vitals the nurse actually entered. */
        var obs = readObs();
        var changed = false;
        Object.keys(obs).forEach(function (k) {
            if (obs[k] !== null) { p.vitals[k] = obs[k]; changed = true; }
        });

        var assessment = null;
        if (changed) {
            p.bp = store.bloodPressureText(p.vitals);
            p.hr = p.vitals.pulse;
            assessment = clinical.assess(p.vitals);
            var stamp = 'nurse:' + assessment.overall + ':' + assessment.flagged.length;
            if (assessment.flagged.length && p.vitalsAlerted !== stamp) {
                p.vitalsAlerted = stamp;
            } else {
                assessment = null;   /* nothing new to raise */
            }
        }

        /* Nothing left outstanding means the patient can be seen again. */
        if (p.status === store.STATUS.AWAITING && store.openOrderCount(p) === 0) {
            p.status = store.STATUS.PENDING;
        }

        store.writePatients(all);
        ui.closeModal('completeTaskModal');
        activeTask = null;
        load();

        window.MediTrackNotify.flash('Task completed', order.task + ' recorded for ' + p.name + '.');
        if (assessment) clinical.notifyVitals(p.name, assessment, p.id + ':' + p.vitalsAlerted);
    }

    /* ==================================================================
       Init
       ================================================================== */
    function init() {
        load();

        ui.initTabs({
            buttonSelector: '[data-nursetab]',
            panelSelector: '.tab-panel',
            attribute: 'data-nursetab',
            onChange: function (id) { currentTab = id; }
        });

        ui.bindLiveValidation(['taskOutcome', 'taskNurseName']);

        OBS_FIELDS.forEach(function (pair) {
            var el = byId(pair[0]);
            if (el) el.addEventListener('input', refreshObsReadout);
        });

        var confirm = byId('confirmCompleteTaskBtn');
        if (confirm) confirm.addEventListener('click', completeTask);

        var search = byId('nurseSearch');
        var clear = byId('nurseSearchClear');
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

        store.onPatientsChanged(load);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
