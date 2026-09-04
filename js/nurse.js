/* ==========================================================================
   MediTrack Hospital ERP - Nurse Station

   Two jobs:
   1. Nursing orders live on the patient record; this screen flattens them
      into a worklist and writes completions straight back. Completing a task
      can also record fresh observations, which are re-interpreted by
      js/clinical.js — that is how deterioration reaches the clinician
      without a phone call.
   2. Patient tracking: a nurse can enrol a patient who has to come in for
      check-ups across several days and log every follow-up visit, so the
      whole team can follow the patient without waiting for the doctor.

   Completed tasks older than 24 hours leave the Completed tab automatically
   and stay in the patient record / Past Visits archive instead.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var clinical = window.MediClinical;

    var TRACKING_KEY = 'clinic_nurse_tracking';
    var BEDS_KEY = 'clinic_beds';
    var ARCHIVE_AFTER_MS = 24 * 3600000;   /* completed tasks move to archive after 24h */

    var patients = [];
    var openTasks = [];
    var doneTasks = [];
    var tracking = [];
    var beds = [];
    var searchTerm = '';
    var typeFilter = '';
    var currentTab = 'panelOrders';

    var activeTask = null;       /* { patientId, orderId } */
    var activeTrackingId = null;
    var trackPatientId = null;

    /* The signed-in nurse is the default performer; the name can be edited
       per task (e.g. a colleague covers one injection). */
    function currentStaffName() {
        try {
            var s = window.MediSession && window.MediSession.read();
            if (s && s.name) return s.name;
        } catch (e) {}
        return 'Nurse on duty';
    }

    var OBS_FIELDS = [
        ['obsSystolic', 'systolic'],
        ['obsDiastolic', 'diastolic'],
        ['obsPulse', 'pulse'],
        ['obsTemp', 'temperature'],
        ['obsSpo2', 'spo2'],
        ['obsRespRate', 'respRate']
    ];

    var VISIT_FIELDS = [
        ['visitSystolic', 'systolic'],
        ['visitDiastolic', 'diastolic'],
        ['visitPulse', 'pulse'],
        ['visitTemp', 'temperature']
    ];

    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }
    function byId(id) { return document.getElementById(id); }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value === null || value === undefined || value === '' ? '—' : value;
    }

    function todayKey(d) {
        var t = d || new Date();
        return t.getFullYear() + '-' +
            String(t.getMonth() + 1).padStart(2, '0') + '-' +
            String(t.getDate()).padStart(2, '0');
    }

    /* ==================================================================
        Load
        ================================================================== */
    function load() {
        patients = store.readPatients();
        openTasks = [];
        doneTasks = [];

        /* Auto-archive: completed tasks older than 24h leave the Completed
           tab. They remain part of the patient record and appear in Past
           Visits once the visit itself is finished. */
        var cutoff = Date.now() - ARCHIVE_AFTER_MS;
        var needsArchiveWrite = false;
        patients.forEach(function (p) {
            (p.nurseOrders || []).forEach(function (o) {
                if (!store.isOrderOpen(o) && !o.archivedAt &&
                        o.completedAt && new Date(o.completedAt).getTime() < cutoff) {
                    o.archivedAt = new Date().toISOString();
                    needsArchiveWrite = true;
                }
            });
        });
        /* Deferred: writePatients fires the change event this page listens
           to, so writing synchronously would re-enter load(). */
        if (needsArchiveWrite) {
            var snapshot = patients;
            setTimeout(function () { store.writePatients(snapshot); }, 0);
        }

        patients.forEach(function (p) {
            (p.nurseOrders || []).forEach(function (o) {
                if (o.archivedAt) return;   /* already in the archive */

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

        tracking = store.read(TRACKING_KEY);

        loadBeds();
        render();
    }

    /* ==================================================================
        Beds
        The ward board is the single place bed status lives. Doctors can
        reserve a bed straight from consultation; this screen keeps the
        board truthful as patients move.
        ================================================================== */
    function loadBeds() {
        beds = store.read(BEDS_KEY);
        if (beds.length) return;

        /* First run on an empty hospital: a starter board, not a blank wall. */
        var seed = [];
        var wards = [
            { name: 'Ward A — General', count: 6 },
            { name: 'Ward B — Observation', count: 6 }
        ];
        wards.forEach(function (w) {
            for (var i = 1; i <= w.count; i++) {
                seed.push({
                    id: 'bed_' + w.name.slice(0, 1).toLowerCase() + '_' + i,
                    ward: w.name,
                    label: 'Bed ' + String(i).padStart(2, '0'),
                    status: 'Free',
                    patientId: null,
                    patientName: null,
                    updatedAt: new Date().toISOString(),
                    updatedBy: currentStaffName()
                });
            }
        });
        beds = seed;
        store.write(BEDS_KEY, beds);
    }

    function saveBeds() {
        store.write(BEDS_KEY, beds);
    }

    function bedSummary() {
        var counts = { Free: 0, Occupied: 0, Cleaning: 0, Reserved: 0 };
        beds.forEach(function (b) {
            if (counts[b.status] !== undefined) counts[b.status]++;
        });
        return counts;
    }

    function renderBedBoard() {
        var host = byId('bedBoard');
        if (!host) return;

        setText('tabBedsCount', beds.length);
        var counts = bedSummary();
        var intro = byId('bedIntro');
        if (intro) {
            intro.textContent = beds.length + ' beds — ' + counts.Free + ' free, ' +
                counts.Occupied + ' occupied, ' + counts.Cleaning + ' cleaning, ' +
                counts.Reserved + ' reserved.';
        }

        if (!beds.length) {
            host.innerHTML = ui.emptyState({
                icon: 'bed',
                title: 'No beds on the board',
                text: 'Use "Add bed" to register the wards; doctors can then reserve beds from consultation.'
            });
            return;
        }

        var wards = {};
        beds.forEach(function (b) {
            var w = b.ward || 'General';
            wards[w] = wards[w] || [];
            wards[w].push(b);
        });

        var STATUS_BADGE = {
            Free: 'status-finished',
            Occupied: 'status-critical',
            Cleaning: 'status-awaiting',
            Reserved: 'status-pending'
        };

        host.innerHTML = Object.keys(wards).sort().map(function (ward) {
            var rows = wards[ward].slice().sort(function (a, b) {
                return String(a.label).localeCompare(String(b.label));
            });
            return '<section class="card" style="margin-bottom:16px">' +
                '<div class="card-header">' +
                    '<div class="card-header-text">' +
                        '<h3>' + esc(ward) + '</h3>' +
                        '<span class="card-sub">' + rows.length + ' bed' + (rows.length > 1 ? 's' : '') + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="card-grid">' + rows.map(function (b) {
                    var occupied = b.status === 'Occupied' || b.status === 'Reserved';
                    return '<article class="nurse-card bed-card is-' + b.status.toLowerCase() + '">' +
                        '<header class="nc-head">' +
                            '<span class="avatar-sq urgency-routine">' + icon('bed', 14) + '</span>' +
                            '<div class="nc-identity">' +
                                '<span class="nc-name">' + esc(b.label) + '</span>' +
                                '<span class="nc-sub">' + esc(store.relativeTime(b.updatedAt)) +
                                    (b.updatedBy ? ' · ' + esc(b.updatedBy) : '') + '</span>' +
                            '</div>' +
                            '<span class="badge ' + (STATUS_BADGE[b.status] || 'status-pending') + '">' +
                                esc(b.status) + '</span>' +
                        '</header>' +
                        (occupied && b.patientName
                            ? '<div class="nc-task"><span class="nc-task-label">Patient</span>' +
                              '<strong>' + esc(b.patientName) + '</strong></div>'
                            : '') +
                        '<footer class="nc-foot nc-foot-wrap">' +
                            ['Free', 'Occupied', 'Cleaning'].map(function (s) {
                                return '<button type="button" class="filter-chip' +
                                    (b.status === s ? ' active' : '') +
                                    '" data-bed-status="' + esc(b.id) + '" data-status="' + s + '">' + s + '</button>';
                            }).join('') +
                            '<button type="button" class="filter-chip" data-bed-assign="' + esc(b.id) + '">Assign…</button>' +
                        '</footer>' +
                    '</article>';
                }).join('') + '</div>' +
            '</section>';
        }).join('');

        ui.qsa('[data-bed-status]', host).forEach(function (btn) {
            btn.addEventListener('click', function () {
                setBedStatus(btn.getAttribute('data-bed-status'), btn.getAttribute('data-status'));
            });
        });
        ui.qsa('[data-bed-assign]', host).forEach(function (btn) {
            btn.addEventListener('click', function () {
                assignBedDialog(btn.getAttribute('data-bed-assign'));
            });
        });
    }

    function setBedStatus(bedId, status) {
        var bed = null;
        beds.forEach(function (b) { if (String(b.id) === String(bedId)) bed = b; });
        if (!bed || bed.status === status) return;

        ui.confirmAction({
            title: 'Mark bed ' + status.toLowerCase(),
            subtitle: bed.ward + ' · ' + bed.label,
            message: status === 'Free' && bed.patientName
                ? 'This releases the bed currently held for ' + bed.patientName + '.'
                : 'The board updates for the whole hospital, including the doctors reserving beds.',
            confirmLabel: 'Mark ' + status.toLowerCase()
        }, function () {
            if (status === 'Free') {
                bed.patientId = null;
                bed.patientName = null;
            }
            bed.status = status;
            bed.updatedAt = new Date().toISOString();
            bed.updatedBy = currentStaffName();
            saveBeds();
            renderBedBoard();
        });
    }

    function assignBedDialog(bedId) {
        var bed = null;
        beds.forEach(function (b) { if (String(b.id) === String(bedId)) bed = b; });
        if (!bed) return;

        var candidates = patients.filter(function (p) { return p.status !== store.STATUS.FINISHED; });
        if (!candidates.length) {
            window.MediTrackNotify.flash('No patients', 'Register a patient before assigning a bed.', 'info');
            return;
        }
        var menu = byId('bedAssignMenu');
        if (menu) {
            menu.innerHTML = candidates.map(function (p) {
                return '<li class="cs-option" data-value="' + esc(p.id) + '" data-label="' + esc(p.name) + '">' +
                    esc(p.name) + ' · ' + esc(p.trackingId || '') + '</li>';
            }).join('');
        }
        var head = byId('bedAssignHead');
        if (head) head.textContent = bed.label + ' · ' + bed.ward;
        ui.setSelectValue('bedAssignSelect', candidates[0].id, candidates[0].name);
        ui.openModal('assignBedModal');
        var apply = byId('bedAssignApply');
        if (apply) apply.onclick = function () {
            var pid = ui.getSelectValue('bedAssignSelect');
            var p = candidates.filter(function (x) { return x.id === pid; })[0];
            if (!p) return;
            bed.status = 'Occupied';
            bed.patientId = p.id;
            bed.patientName = p.name;
            bed.updatedAt = new Date().toISOString();
            bed.updatedBy = currentStaffName();
            ui.closeModal('assignBedModal');
            saveBeds();
            renderBedBoard();
            window.MediTrackNotify.flash('Bed assigned', bed.label + ' (' + bed.ward + ') → ' + p.name + '.');
        };
    }

    function openAddBed() {
        byId('bedWardInput').value = '';
        byId('bedLabelInput').value = '';
        ui.clearFieldError('bedWardInput');
        ui.clearFieldError('bedLabelInput');
        ui.openModal('addBedModal');
    }

    function addBed() {
        if (!ui.requireFields([
            { id: 'bedWardInput', message: 'Name the ward this bed belongs to.' },
            { id: 'bedLabelInput', message: 'Give the bed a label, e.g. "Bed 07".' }
        ])) return;

        var ward = byId('bedWardInput').value.trim();
        var label = byId('bedLabelInput').value.trim();
        var clash = beds.some(function (b) {
            return String(b.ward).toLowerCase() === ward.toLowerCase() &&
                String(b.label).toLowerCase() === label.toLowerCase();
        });
        if (clash) {
            ui.fieldError('bedLabelInput', 'That label already exists in this ward.');
            return;
        }

        beds.push({
            id: 'bed_' + Date.now(),
            ward: ward,
            label: label,
            status: 'Free',
            patientId: null,
            patientName: null,
            updatedAt: new Date().toISOString(),
            updatedBy: currentStaffName()
        });
        saveBeds();
        ui.closeModal('addBedModal');
        renderBedBoard();
        window.MediTrackNotify.flash('Bed added', label + ' in ' + ward + ' is now on the board.');
    }

    function saveTracking() {
        store.write(TRACKING_KEY, tracking);
    }

    /* ==================================================================
        Render
        ================================================================== */
    function render() {
        renderTriageQueue();
        setText('nurseActiveCount', openTasks.length);
        setText('nurseCompletedCount', doneTasks.length);
        setText('nurseTrackingCount', tracking.filter(function (t) { return t.status === 'active'; }).length);
        setText('tabOrdersCount', openTasks.length);
        setText('tabCompletedCount', doneTasks.length);

        var activeTracking = tracking.filter(function (t) { return t.status === 'active'; });
        setText('tabTrackingCount', activeTracking.length);

        renderTasks(openTasks, 'nurseOrdersGrid', false);
        renderTasks(doneTasks, 'completedOrdersGrid', true);
        renderTracking(activeTracking);
        renderBedBoard();
    }

    function renderTriageQueue() {
        var host = byId('nurseTriageGrid');
        if (!host) return;

        var triage = patients.filter(function (p) {
            return p.status === store.STATUS.NURSE_TRIAGE;
        });
        triage.sort(function (a, b) { return new Date(a.registered) - new Date(b.registered); });

        setText('tabTriageCount', triage.length);
        if (!triage.length) {
            host.innerHTML = ui.emptyState({
                icon: 'check-circle',
                title: 'No patients awaiting nurse triage',
                text: 'New arrivals appear here before they are released to the doctor queue.'
            });
            return;
        }

        host.innerHTML = triage.map(function (p) {
            var assessment = clinical.assess(p.vitals);
            return '<article class="nurse-card nurse-triage-card">' +
                '<header class="nc-head">' +
                    '<span class="avatar-sq urgency-' + esc(store.normalizeUrgency(p.urgency).toLowerCase()) + '">' + esc(store.initials(p.name)) + '</span>' +
                    '<div class="nc-identity"><span class="nc-name">' + esc(p.name) + '</span>' +
                        '<span class="nc-sub"><span class="mono">' + esc(p.trackingId) + '</span><span>' + esc(store.normalizeUrgency(p.urgency)) + '</span></span></div>' +
                    '<span class="badge status-awaiting">Nurse triage</span>' +
                '</header>' +
                '<div class="nc-task"><span class="nc-task-label">Complaint</span><strong>' + esc(p.description || 'No complaint recorded.') + '</strong></div>' +
                '<div class="triage-observations">' +
                    '<span class="nc-task-label">Nurse observations</span>' +
                    '<div class="triage-observation-grid">' +
                        triageInput(p.id, 'systolic', 'BP sys', p.vitals.systolic, 'mmHg') +
                        triageInput(p.id, 'diastolic', 'BP dia', p.vitals.diastolic, 'mmHg') +
                        triageInput(p.id, 'temperature', 'Temperature', p.vitals.temperature, '°C') +
                        triageInput(p.id, 'pulse', 'Pulse', p.vitals.pulse, 'bpm') +
                        triageInput(p.id, 'spo2', 'SpO₂', p.vitals.spo2, '%') +
                        triageInput(p.id, 'respRate', 'Resp. rate', p.vitals.respRate, '/min') +
                    '</div>' +
                    '<span class="triage-assessment">' + esc(assessment.recordedCount ? assessment.summary : 'Enter observations before sending to the doctor.') + '</span>' +
                '</div>' +
                '<footer class="nc-foot"><span class="nc-meta">' + icon('clock', 13) + '<span>Waiting ' + esc(store.elapsed(p.registered)) + '</span></span>' +
                    '<button type="button" class="btn-primary btn-sm" data-release-patient="' + esc(p.id) + '">' + icon('arrow-right', 14) + '<span>Send to doctor queue</span></button></footer>' +
            '</article>';
        }).join('');

        ui.qsa('[data-release-patient]', host).forEach(function (btn) {
            btn.addEventListener('click', function () { releaseToDoctorQueue(btn.getAttribute('data-release-patient')); });
        });
    }

    function triageInput(patientId, key, label, value, unit) {
        return '<label class="triage-observation"><span>' + esc(label) + '</span>' +
            '<input type="number" step="any" inputmode="decimal" data-triage-patient="' + esc(patientId) + '" data-triage-key="' + esc(key) + '" value="' + (value === null || value === undefined ? '' : esc(value)) + '" aria-label="' + esc(label) + '">' +
            '<small>' + esc(unit) + '</small></label>';
    }

    function releaseToDoctorQueue(id) {
        var all = store.readPatients();
        var p = store.findPatient(all, id);
        if (!p || p.status !== store.STATUS.NURSE_TRIAGE) return;

        var changedVitals = false;
        ui.qsa('[data-triage-patient="' + id + '"]').forEach(function (input) {
            var value = store.toNumber(input.value);
            var key = input.getAttribute('data-triage-key');
            if (value !== null && key) {
                p.vitals[key] = value;
                changedVitals = true;
            }
        });
        if (changedVitals) {
            p.bp = store.bloodPressureText(p.vitals);
            p.hr = p.vitals.pulse;
        }

        p.status = store.STATUS.PENDING;
        p.nurseTriagedAt = new Date().toISOString();
        p.nurseTriagedBy = currentStaffName();
        store.writePatients(all);
        load();
        window.MediTrackNotify.event('nurse.triage.released', {
            key: 'triage-released:' + p.id + ':' + p.nurseTriagedAt,
            title: 'Patient released to doctor queue',
            message: p.name + ' (' + p.trackingId + ') was triaged by ' + p.nurseTriagedBy + ' and is ready for consultation.'
        });
    }

    /* Bed work is highlighted so a bed order never waits behind routine
       obs: doctors dispatch it expecting a bed held for the patient. */
    function taskType(t) {
        var text = String(t.task || '').toLowerCase();
        if (text.indexOf('bed') !== -1) return 'bed';
        if (text.indexOf('vital') !== -1 || text.indexOf('blood pressure') !== -1 ||
            text.indexOf('pulse') !== -1 || text.indexOf('temp') !== -1) return 'vitals';
        return 'other';
    }

    function matches(t) {
        if (typeFilter && taskType(t) !== typeFilter) return false;
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
                title: done ? 'No completed tasks in the last 24 hours' : 'No outstanding nursing orders',
                text: done
                    ? 'Completed tasks are kept here for 24 hours, then moved to the archive (Past Visits).'
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
                    (taskType(t) === 'bed'
                        ? '<span class="badge status-treatment" style="margin-left:8px">' + icon('bed', 11) + ' Bed</span>'
                        : (taskType(t) === 'vitals'
                            ? '<span class="badge status-awaiting" style="margin-left:8px">' + icon('pulse', 11) + ' Vitals</span>'
                            : '')) +
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

    /* ==================================================================
        Patient tracking
        ================================================================== */
    function renderTracking(activeList) {
        var host = byId('trackingGrid');
        if (!host) return;

        var rows = activeList.filter(function (t) {
            if (!searchTerm) return true;
            var q = searchTerm.toLowerCase();
            return [t.patientName, t.reason, t.trackingId].some(function (f) {
                return String(f || '').toLowerCase().indexOf(q) !== -1;
            });
        });

        if (!rows.length) {
            host.innerHTML = ui.emptyState({
                icon: 'pulse',
                title: tracking.length ? 'No tracked patients match the search' : 'No patients are being tracked',
                text: 'Use "Track a patient" when someone needs to come in for check-ups across several days.'
            });
            return;
        }

        host.innerHTML = rows.map(function (t) {
            var days = Math.max(1, Number(t.planDays) || 7);
            var start = new Date(t.startDate);
            var loggedDays = {};
            (t.entries || []).forEach(function (e) { loggedDays[e.date] = e; });

            var pills = '';
            for (var day = 0; day < days; day++) {
                var d = new Date(start.getTime() + day * 86400000);
                var key = todayKey(d);
                var entry = loggedDays[key];
                var cls = entry ? 'is-done'
                    : (key === todayKey() ? 'is-today' : '');
                pills += '<span class="track-day ' + cls + '" title="' + esc(store.formatDate(d.toISOString())) + '">' +
                    (day + 1) + '</span>';
            }

            var lastEntry = (t.entries || []).length
                ? t.entries[t.entries.length - 1] : null;

            return '<article class="nurse-card track-card" data-track="' + esc(t.id) + '">' +
                '<header class="nc-head">' +
                    '<span class="avatar-sq urgency-routine">' + esc(store.initials(t.patientName)) + '</span>' +
                    '<div class="nc-identity">' +
                        '<span class="nc-name">' + esc(t.patientName) + '</span>' +
                        '<span class="nc-sub"><span class="mono">' + esc(t.trackingId) + '</span></span>' +
                    '</div>' +
                    '<span class="badge status-awaiting">Day ' +
                        Math.min(days, (t.entries || []).length ? Math.min(days, daysSoFar(t)) : 1) +
                        ' of ' + days + '</span>' +
                '</header>' +

                (t.reason
                    ? '<div class="nc-task"><span class="nc-task-label">Plan</span><strong>' + esc(t.reason) + '</strong></div>'
                    : '') +

                '<div class="track-days">' + pills + '</div>' +

                (lastEntry
                    ? '<div class="nc-note">' + icon('file-text', 13) +
                      '<span><strong>Last visit:</strong> ' + esc(store.formatDateTime(lastEntry.time)) +
                      ' — ' + esc(lastEntry.note) + '</span></div>'
                    : '<div class="nc-note">' + icon('clock', 13) +
                      '<span>No visits logged yet — started ' + esc(store.formatDate(t.startDate)) + '</span></div>') +

                '<footer class="nc-foot">' +
                    '<span class="nc-meta">' + icon('nurse', 13) +
                        '<span>' + (t.entries || []).length + ' visit' +
                            ((t.entries || []).length === 1 ? '' : 's') + ' logged</span>' +
                    '</span>' +
                    '<span class="nc-actions">' +
                        '<button type="button" class="btn-secondary btn-sm" data-logvisit="' + esc(t.id) + '">' +
                            icon('plus', 14) + '<span>Log visit</span>' +
                        '</button>' +
                        '<button type="button" class="btn-secondary btn-sm" data-endtrack="' + esc(t.id) + '">' +
                            icon('check-circle', 14) + '<span>End</span>' +
                        '</button>' +
                    '</span>' +
                '</footer>' +
            '</article>';
        }).join('');

        ui.qsa('[data-logvisit]', host).forEach(function (btn) {
            btn.addEventListener('click', function () {
                openLogVisit(btn.getAttribute('data-logvisit'));
            });
        });
        ui.qsa('[data-endtrack]', host).forEach(function (btn) {
            btn.addEventListener('click', function () {
                endTracking(btn.getAttribute('data-endtrack'));
            });
        });
    }

    function daysSoFar(t) {
        var span = Math.floor((Date.now() - new Date(t.startDate).getTime()) / 86400000) + 1;
        return Math.max(1, span);
    }

    function openStartTracking() {
        var menu = byId('trackPatientMenu');
        if (!menu) return;

        var options = patients.map(function (p) {
            return '<li class="cs-option" data-value="' + esc(p.id) + '" data-label="' +
                esc(p.name) + '">' + esc(p.name) +
                ' <span class="mono">' + esc(p.trackingId) + '</span>' +
                (p.phone ? ' · ' + esc(p.phone) : '') + '</li>';
        }).join('');

        if (!options.length) {
            /* Local pre-condition, not a hospital-wide alert. */
            window.MediTrackNotify.flash(
                'No patients yet',
                'Register a patient first, then start a tracking plan.',
                'warning'
            );
            return;
        }

        menu.innerHTML = options;
        trackPatientId = patients[0].id;
        ui.initSelect('trackPatientWrapper', function (v) { trackPatientId = v; });
        ui.initSelect('bedAssignSelect');
        ui.setSelectValue('trackPatientWrapper', trackPatientId, store.findPatient(patients, trackPatientId).name);

        byId('trackPlanDays').value = 7;
        byId('trackReason').value = '';
        ui.clearFieldError('trackPlanDays');
        ui.openModal('startTrackingModal');
    }

    function startTracking() {
        var daysEl = byId('trackPlanDays');
        if (!daysEl || !trackPatientId) return;

        var p = store.findPatient(patients, trackPatientId);
        var days = Number(daysEl.value);

        if (!ui.requireFields([
            { id: 'trackPlanDays', message: 'Enter how many days this patient should be followed.' }
        ])) return;

        if (!p || !days || days < 1) return;

        /* One active plan per patient keeps the board honest. */
        var existing = tracking.filter(function (t) {
            return t.status === 'active' && String(t.patientId) === String(p.id);
        });
        existing.forEach(function (t) {
            t.status = 'archived';
            t.endedAt = new Date().toISOString();
        });

        tracking.push({
            id: 'trk_' + Date.now(),
            patientId: p.id,
            patientName: p.name,
            trackingId: p.trackingId,
            phone: p.phone || '',
            planDays: Math.min(30, days),
            reason: byId('trackReason').value.trim(),
            startDate: todayKey(new Date()),
            entries: [],
            status: 'active',
            createdBy: currentStaffName(),
            createdAt: new Date().toISOString()
        });

        saveTracking();
        ui.closeModal('startTrackingModal');
        load();

        window.MediTrackNotify.flash('Tracking started',
            p.name + ' will be followed for ' + Math.min(30, days) + ' days.');
    }

    function openLogVisit(trackId) {
        var t = tracking.filter(function (x) { return String(x.id) === String(trackId); })[0];
        if (!t) return;

        activeTrackingId = t.id;
        setText('logVisitSub', t.patientName + ' · ' + t.trackingId);
        byId('visitNote').value = '';
        VISIT_FIELDS.forEach(function (pair) {
            var el = byId(pair[0]);
            if (el) el.value = '';
        });
        refreshVisitReadout();
        ui.clearFieldError('visitNote');
        ui.openModal('logVisitModal');
    }

    function readVisitObs() {
        var v = {};
        VISIT_FIELDS.forEach(function (pair) {
            var el = byId(pair[0]);
            v[pair[1]] = store.toNumber(el ? el.value : '');
        });
        return v;
    }

    function refreshVisitReadout() {
        var host = byId('visitReadout');
        if (!host) return;

        var assessment = clinical.assess(readVisitObs());
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

    function logVisit() {
        if (!activeTrackingId) return;

        if (!ui.requireFields([
            { id: 'visitNote', message: 'Record what was done or observed at this visit.' }
        ])) return;

        var t = tracking.filter(function (x) { return String(x.id) === String(activeTrackingId); })[0];
        if (!t) return;

        var obs = readVisitObs();
        var parts = [];
        if (obs.systolic !== null && obs.diastolic !== null) parts.push('BP ' + obs.systolic + '/' + obs.diastolic);
        if (obs.pulse !== null) parts.push('Pulse ' + obs.pulse);
        if (obs.temperature !== null) parts.push('Temp ' + obs.temperature + '\u00B0C');

        t.entries = t.entries || [];
        t.entries.push({
            date: todayKey(),
            time: new Date().toISOString(),
            note: byId('visitNote').value.trim(),
            vitals: parts.join(' · '),
            by: currentStaffName()
        });

        /* Write fresh vitals back to the live patient record as well. */
        var all = store.readPatients();
        var p = store.findPatient(all, t.patientId);
        if (p) {
            var changedVitals = false;
            Object.keys(obs).forEach(function (k) {
                if (obs[k] !== null) { p.vitals[k] = obs[k]; changedVitals = true; }
            });
            if (changedVitals) {
                p.bp = store.bloodPressureText(p.vitals);
                p.hr = p.vitals.pulse;
                var assessment = clinical.assess(p.vitals);
                var stamp = 'nurse:' + assessment.overall + ':' + assessment.flagged.length;
                if (assessment.flagged.length && p.vitalsAlerted !== stamp) {
                    p.vitalsAlerted = stamp;
                    clinical.notifyVitals(p.name, assessment, p.id + ':' + stamp);
                }
                store.writePatients(all);
            }
        }

        saveTracking();
        ui.closeModal('logVisitModal');
        activeTrackingId = null;
        load();

        window.MediTrackNotify.flash('Visit logged', t.patientName + ' — day check recorded.');
    }

    function endTracking(trackId) {
        var t = tracking.filter(function (x) { return String(x.id) === String(trackId); })[0];
        if (!t) return;

        ui.confirmAction({
            title: 'End tracking?',
            subtitle: t.patientName + ' · ' + t.trackingId,
            message: 'The plan moves to the archive with its full visit history. The record stays in Past Visits.',
            confirmLabel: 'End tracking'
        }, function () {
            t.status = 'archived';
            t.endedAt = new Date().toISOString();
            saveTracking();
            load();
            window.MediTrackNotify.flash('Tracking ended',
                t.patientName + ' archived after ' + (t.entries || []).length + ' logged visit(s).');
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

        /* A completed bed setup means the patient is in the bed. */
        if (order.bedId) {
            var bedList = store.read(BEDS_KEY);
            bedList.forEach(function (b) {
                if (String(b.id) === String(order.bedId) &&
                    (b.status === 'Reserved' || b.status === 'Free')) {
                    b.status = 'Occupied';
                    b.patientId = p.id;
                    b.patientName = p.name;
                    b.updatedAt = new Date().toISOString();
                    b.updatedBy = order.completedBy;
                }
            });
            store.write(BEDS_KEY, bedList);
        }

        store.writePatients(all);
        ui.closeModal('completeTaskModal');
        activeTask = null;
        load();

        window.MediTrackNotify.flash('Task completed', order.task + ' recorded for ' + p.name + '.');
        window.MediTrackNotify.event('nurse.task.completed', {
            key: 'nursecompleted:' + order.id,
            title: 'Nursing task completed',
            message: order.task + ' for ' + p.name + ' was completed by ' + order.completedBy +
                     '. The ordering clinician can review the outcome.'
        });
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

        var startBtn = byId('startTrackingBtn');
        if (startBtn) startBtn.addEventListener('click', openStartTracking);

        var confirmStart = byId('confirmStartTrackingBtn');
        if (confirmStart) confirmStart.addEventListener('click', startTracking);

        var confirmVisit = byId('confirmLogVisitBtn');
        if (confirmVisit) confirmVisit.addEventListener('click', logVisit);

        ui.bindLiveValidation(['taskOutcome', 'taskNurseName', 'visitNote']);

        OBS_FIELDS.forEach(function (pair) {
            var el = byId(pair[0]);
            if (el) el.addEventListener('input', refreshObsReadout);
        });
        VISIT_FIELDS.forEach(function (pair) {
            var el = byId(pair[0]);
            if (el) el.addEventListener('input', refreshVisitReadout);
        });

        var confirm = byId('confirmCompleteTaskBtn');
        if (confirm) confirm.addEventListener('click', completeTask);

        var addBedBtn = byId('addBedBtn');
        if (addBedBtn) addBedBtn.addEventListener('click', openAddBed);
        var confirmAddBed = byId('confirmAddBedBtn');
        if (confirmAddBed) confirmAddBed.addEventListener('click', addBed);

        ui.initChips('orderTypeFilters', 'data-type-filter', function (value) {
            typeFilter = value || '';
            render();
        });

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
