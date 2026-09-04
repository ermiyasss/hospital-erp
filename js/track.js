/* ==========================================================================
   MediTrack Hospital ERP - Consultation Desk

   Design rules enforced here:

   1. The clinician does not choose a patient. js/store.js owns the queue order
      (triage priority, then arrival time) and this screen renders whatever sits
      at position 1. There is no sort control, no filter and no patient picker.

   2. Patients parked while diagnostics run are handled in a separate workbench
      with two tabs: Awaiting Results and Completed Results.

   3. Vitals are interpreted automatically (js/clinical.js) and abnormal or
      critical observations are surfaced before the clinician has to look for
      them.

    4. Everything recorded here is stamped with the signed-in clinician's name
       so the record always shows who did what.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var clinical = window.MediClinical;

    var STATUS = store.STATUS;

    /* ------------------------------------------------------------- state */
    var patients = [];
    var currentId = null;        /* patient currently in the workspace */
    var awaitFilter = 'all';

    /* The signed-in clinician owns everything they record here: notes,
       lab orders, nursing orders and prescriptions are all stamped with
       their name so the record always shows who did what. */
    function currentStaffName() {
        try {
            var s = window.MediSession && window.MediSession.read();
            if (s && s.name) return s.name;
        } catch (e) {}
        return 'Doctor';
    }

    /* ----------------------------------------------------------- helpers */
    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }
    function byId(id) { return document.getElementById(id); }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value === null || value === undefined || value === '' ? '\u2014' : value;
    }

    function urgencyClass(urgency) {
        return 'urgency-' + String(store.normalizeUrgency(urgency)).toLowerCase();
    }

    function statusClass(status) {
        switch (status) {
            case STATUS.CONSULTING:        return 'status-consulting';
            case STATUS.AWAITING:          return 'status-awaiting';
            case STATUS.AWAITING_PAYMENT:  return 'status-awaiting-payment';
            case STATUS.FINISHED:          return 'status-finished';
            default:                       return 'status-pending';
        }
    }

    /* Every write goes through here so all open pages refresh together. */
    function persist() {
        store.writePatients(patients);
    }

    function currentPatient() {
        return currentId === null ? null : store.findPatient(patients, currentId);
    }

    function appendGlobal(key, record) {
        var list = store.read(key);
        list.push(record);
        store.write(key, list);
    }

    /* ==================================================================
        Load
        ================================================================== */
    function load(preserveView) {
        patients = store.seedIfEmpty();
        if (!patients.length) patients = store.readPatients();

        /* A patient opened from another screen (dashboard, queue). */
        var requested = store.sessionGet('selected_tracking_patient_id');
        if (requested) {
            store.sessionRemove('selected_tracking_patient_id');
            var target = store.findPatient(patients, requested);
            if (target && target.status !== STATUS.FINISHED) {
                openWorkspace(target.id, true);
                return;
            }
        }

        if (currentId !== null && !currentPatient()) currentId = null;

        if (currentId !== null && preserveView !== false) {
            renderWorkspace();
        } else {
            renderIntake();
        }
    }

    /* ==================================================================
        View switching
        ================================================================== */
    function showIntake() {
        byId('trackIntakeView').hidden = false;
        byId('trackWorkspaceView').hidden = true;
        currentId = null;
        renderIntake();
    }

    function showWorkspace() {
        byId('trackIntakeView').hidden = true;
        byId('trackWorkspaceView').hidden = false;
    }

    /* ==================================================================
        INTAKE - counters, next patient, workbench
        ================================================================== */
    function renderIntake() {
        showIntakeCounters();
        renderNextPatient();
        renderWorkbench();
    }

    function showIntakeCounters() {
        var queue = store.queueOrder(patients);
        var awaiting = store.awaitingPatients(patients);

        var ready = 0;
        patients.forEach(function (p) {
            if (store.unreviewedResults(p).length) ready++;
        });

        setText('pillWaiting', queue.length);
        setText('pillAwaiting', awaiting.length);

        var readyWrap = byId('pillReadyWrap');
        if (readyWrap) {
            readyWrap.hidden = ready === 0;
            setText('pillReady', ready);
        }
    }

    /* ------------------------------------------------- next patient card */
    function myName() {
        return currentStaffName();
    }

    /* A doctor is served their own queue first: patients who specifically
       chose them at registration. When nobody booked them and they are
       free, the general queue is theirs — the next unassigned patient is
       redirected to whoever is free. */
    function doctorNextFromQueue(queue) {
        if (window.MediSession && window.MediSession.role() !== 'doctor') return null;
        var mine = myName();
        var booked = queue.filter(function (p) { return p.preferredDoctor === mine; });
        return booked.length ? { patient: booked[0], booked: true } :
            (queue.length ? { patient: queue[0], booked: false } : null);
    }

    function renderNextPatient() {
        var host = byId('nextPatientHost');
        if (!host) return;

        /* If someone is mid-consultation they are the active patient, not the
           next queue entry: resuming must take priority over calling. */
        var consulting = store.consultingPatients(patients);
        if (consulting.length) {
            var mineConsulting = consulting.filter(function (p) {
                return p.assignedDoctor === myName();
            });
            host.innerHTML = nextCardHtml(mineConsulting[0] || consulting[0], 0, true);
            bindNextCard(host);
            return;
        }

        var queue = store.queueOrder(patients);
        if (!queue.length) {
            host.innerHTML =
                '<div class="np-empty">' +
                    '<span class="np-empty-icon">' + icon('check-circle', 22) + '</span>' +
                    '<div class="np-empty-text">' +
                        '<h3>No patients waiting</h3>' +
                        '<p>The triage queue is clear. New arrivals appear here automatically once reception completes registration.</p>' +
                    '</div>' +
                '</div>';
            return;
        }

        var pick = doctorNextFromQueue(queue);
        var next = pick ? pick.patient : queue[0];
        var booked = pick ? pick.booked : false;
        var position = queue.indexOf(next) + 1;
        host.innerHTML = nextCardHtml(next, position, false, booked);
        bindNextCard(host);
    }

    function nextCardHtml(p, position, resuming, booked) {
        var urgency = store.normalizeUrgency(p.urgency);
        var assessment = clinical.assess(p.vitals);
        var frame = urgency === 'Emergency' ? ' is-emergency' : (urgency === 'Urgent' ? ' is-urgent' : '');

        var vitalCells = assessment.results.map(function (r) {
            var unit = r.key === 'bloodPressure' ? 'mmHg' : r.unit;
            return '<div class="np-vital level-' + r.level + '">' +
                '<span class="np-vital-label">' + esc(r.label) + '</span>' +
                '<span class="np-vital-value">' + esc(r.display) +
                    (unit ? '<small>' + esc(unit) + '</small>' : '') +
                '</span>' +
                '<span class="np-vital-flag">' + esc(r.levelLabel) + '</span>' +
            '</div>';
        }).join('');

        if (!vitalCells) {
            vitalCells = '<div class="np-vital level-normal">' +
                '<span class="np-vital-label">Vitals</span>' +
                '<span class="np-vital-value">\u2014</span>' +
                '<span class="np-vital-flag">Not recorded</span>' +
            '</div>';
        }

        var ageSex = [];
        if (p.age !== null) ageSex.push(p.age + ' yrs');
        if (p.sex) ageSex.push(esc(p.sex));

        var assignedDoctor = lastDoctorOf(p);

        return '<article class="np-card' + frame + '" data-patient="' + esc(p.id) + '">' +
            '<div class="np-main">' +
                '<header class="np-head">' +
                    '<div class="np-position">' +
                        '<span class="np-pos-label">' + (resuming ? 'Active' : 'Next') + '</span>' +
                        '<span class="np-pos-value">' + (resuming ? '\u2014' : String(position).padStart(2, '0')) + '</span>' +
                    '</div>' +
                    '<div class="np-identity">' +
                        '<div class="np-name-row">' +
                            '<h3>' + esc(p.name) + '</h3>' +
                            '<span class="tracking-id-pill">' + esc(p.trackingId) + '</span>' +
                        '</div>' +
                        '<div class="np-meta-row">' +
                            (ageSex.length ? '<span>' + ageSex.join(' \u00b7 ') + '</span><span class="sep">|</span>' : '') +
                            '<span>' + (p.phone ? esc(p.phone) : 'No contact number') + '</span>' +
                            '<span class="sep">|</span>' +
                            '<span>Registered ' + esc(store.formatTime(p.registered)) + '</span>' +
                        '</div>' +
                        '<div class="np-badges">' +
                            '<span class="badge ' + urgencyClass(urgency) + '">' + esc(urgency) + '</span>' +
                            '<span class="badge ' + statusClass(p.status) + '">' + esc(p.status) + '</span>' +
                            (booked === true
                                ? '<span class="badge status-treatment">' + icon('stethoscope', 12) + ' Booked for you</span>'
                                : (booked === false
                                    ? '<span class="badge status-treatment">General queue</span>'
                                    : '')) +
                            (p.preferredDoctor
                                ? '<span class="badge status-treatment">' + icon('stethoscope', 12) + ' Requests ' +
                                      esc(p.preferredDoctor) + '</span>'
                                : '') +
                            (assignedDoctor
                                ? '<span class="badge status-treatment">' + icon('stethoscope', 12) + ' ' +
                                      esc(assignedDoctor) + '</span>'
                                : '') +
                        '</div>' +
                    '</div>' +
                '</header>' +

                '<div class="np-complaint">' +
                    '<span class="np-complaint-label">Presenting complaint</span>' +
                    '<p>' + esc(p.description || 'No complaint recorded at triage.') + '</p>' +
                '</div>' +

                '<div class="np-vitals">' + vitalCells + '</div>' +
            '</div>' +

            '<aside class="np-side">' +
                '<div class="np-assess level-' + assessment.overall + '">' +
                    '<span class="np-assess-top">' + icon('pulse', 13) + '<span>Automatic assessment</span></span>' +
                    '<span class="np-assess-verdict">' + esc(assessment.overallLabel) + ' vitals</span>' +
                    '<span class="np-assess-text">' + esc(assessment.summary) + '</span>' +
                    (assessment.suggestedUrgency !== urgency
                        ? '<span class="np-assess-text"><strong>Triage check:</strong> observations suggest ' +
                          esc(assessment.suggestedUrgency) + ', recorded as ' + esc(urgency) + '.</span>'
                        : '') +
                '</div>' +

                '<div class="np-wait">' +
                    '<span>' + (resuming ? 'In consultation for' : 'Waiting') + '</span>' +
                    '<strong data-elapsed="' + esc(resuming ? (p.calledAt || p.registered) : p.registered) + '">' +
                        esc(store.elapsed(resuming ? (p.calledAt || p.registered) : p.registered)) +
                    '</strong>' +
                '</div>' +

                '<div class="np-actions">' +
                    '<button type="button" class="btn-primary" data-call="' + esc(p.id) + '">' +
                        icon(resuming ? 'play' : 'user-check', 15) +
                        '<span>' + (resuming ? 'Resume consultation' : 'Call patient in') + '</span>' +
                    '</button>' +
                    '<span class="np-hint">' + (resuming
                        ? 'This patient is already in consultation. Complete or park the visit before the next patient can be called.'
                        : 'Calling marks the visit as in consultation under your name. The queue decides the order.') +
                    '</span>' +
                '</div>' +
            '</aside>' +
        '</article>';
    }

    /* Most recent clinician who acted on this record. */
    function lastDoctorOf(p) {
        var latest = null;
        (p.clinicalNotes || []).forEach(function (n) {
            if (n.doctor && (!latest || new Date(n.time) > new Date(latest.time))) latest = n;
        });
        [['labOrders'], ['nurseOrders'], ['prescriptions']].forEach(function (pair) {
            (p[pair[0]] || []).forEach(function (o) {
                if (o.doctor && (!latest || new Date(o.time) > new Date(latest.time))) latest = o;
            });
        });
        return latest ? latest.doctor : null;
    }

    function bindNextCard(host) {
        var btn = host.querySelector('[data-call]');
        if (btn) {
            btn.addEventListener('click', function () {
                openWorkspace(btn.getAttribute('data-call'));
            });
        }
    }

    /* ==================================================================
        WORKBENCH - awaiting results / completed results
        ================================================================== */
    function openOrdersOf(p) {
        var out = [];
        [['labOrders', 'lab'], ['nurseOrders', 'nurse'], ['prescriptions', 'pharmacy']].forEach(function (pair) {
            (p[pair[0]] || []).forEach(function (o) {
                if (store.isOrderOpen(o)) out.push({ kind: pair[1], order: o });
            });
        });
        return out;
    }

    function closedOrdersOf(p) {
        var out = [];
        [['labOrders', 'lab'], ['nurseOrders', 'nurse'], ['prescriptions', 'pharmacy']].forEach(function (pair) {
            (p[pair[0]] || []).forEach(function (o) {
                if (!store.isOrderOpen(o)) out.push({ kind: pair[1], order: o });
            });
        });
        return out;
    }

    var KIND_META = {
        lab:      { icon: 'lab',    label: 'Laboratory' },
        nurse:    { icon: 'nurse',  label: 'Nursing' },
        pharmacy: { icon: 'pill',   label: 'Pharmacy' }
    };

    function orderTitle(entry) {
        var o = entry.order;
        if (entry.kind === 'lab') return o.test || 'Diagnostic test';
        if (entry.kind === 'nurse') return o.task || 'Nursing task';
        return (o.medication || 'Medication') + (o.dosage ? ' ' + o.dosage : '');
    }

    function orderLine(entry) {
        var meta = KIND_META[entry.kind];
        var flag = String(entry.order.flag || '').toLowerCase();
        var flagCls = flag === 'critical' ? ' flag-critical' : (flag === 'abnormal' ? ' flag-abnormal' : '');
        var owner = '';
        if (entry.kind === 'lab' && entry.order.status !== 'Completed') owner = entry.order.doctor;
        else if (entry.kind === 'lab') owner = entry.order.technician || entry.order.doctor;
        else if (entry.kind === 'nurse' && entry.order.status === 'Completed') owner = entry.order.completedBy;
        else owner = entry.order.doctor;

        return '<div class="wb-order-line' + flagCls + '">' +
            icon(meta.icon, 13) +
            '<span class="wb-order-name">' + esc(orderTitle(entry)) + '</span>' +
            (owner ? '<span class="wb-order-owner">' + icon('user', 11) + ' ' + esc(owner) + '</span>' : '') +
            '<span class="tag tag-' + (entry.kind === 'pharmacy' ? 'rx' : entry.kind) + '">' +
                esc(entry.order.status || meta.label) +
            '</span>' +
        '</div>';
    }

    function renderWorkbench() {
        var awaiting = [];
        var completed = [];

        patients.forEach(function (p) {
            if (p.status === STATUS.FINISHED) return;
            var open = openOrdersOf(p);
            var closed = closedOrdersOf(p);
            if (open.length) awaiting.push({ patient: p, orders: open });
            if (closed.length) {
                completed.push({
                    patient: p,
                    orders: closed,
                    unreviewed: closed.filter(function (e) { return e.kind === 'lab' && !e.order.reviewed; }).length
                });
            }
        });

        /* Unreviewed first, then the most recently released. */
        completed.sort(function (a, b) { return b.unreviewed - a.unreviewed; });

        setText('wbCountAwaiting', awaiting.length);
        var completedCount = byId('wbCountCompleted');
        if (completedCount) {
            completedCount.textContent = completed.length;
            var anyUnreviewed = completed.some(function (c) { return c.unreviewed > 0; });
            completedCount.classList.toggle('count-alert', anyUnreviewed);
        }

        renderAwaitingList(awaiting);
        renderCompletedList(completed);
    }

    function renderAwaitingList(rows) {
        var host = byId('awaitingList');
        if (!host) return;

        var filtered = awaitFilter === 'all' ? rows : rows.filter(function (r) {
            return r.orders.some(function (e) { return e.kind === awaitFilter; });
        });

        if (!filtered.length) {
            host.innerHTML = ui.emptyState({
                icon: 'hourglass',
                title: 'Nothing awaiting results',
                text: 'Patients parked for laboratory, nursing or pharmacy work appear here until the department closes the order.'
            });
            return;
        }

        host.innerHTML = filtered.map(function (r) {
            var p = r.patient;
            var shown = awaitFilter === 'all' ? r.orders : r.orders.filter(function (e) { return e.kind === awaitFilter; });
            var doc = lastDoctorOf(p);
            return '<article class="wb-item is-waiting">' +
                '<header class="wb-item-head">' +
                    '<span class="avatar-sq ' + urgencyClass(p.urgency) + '">' + esc(store.initials(p.name)) + '</span>' +
                    '<div class="wb-item-identity">' +
                        '<span class="wb-item-name">' + esc(p.name) + '</span>' +
                        '<span class="wb-item-sub">' +
                            '<span class="mono">' + esc(p.trackingId) + '</span>' +
                            '<span class="badge ' + urgencyClass(p.urgency) + '">' + esc(store.normalizeUrgency(p.urgency)) + '</span>' +
                        '</span>' +
                    '</div>' +
                '</header>' +
                (doc ? '<div class="wb-item-doctor">' + icon('stethoscope', 12) + ' Under ' + esc(doc) + '</div>' : '') +
                '<div class="wb-item-orders">' + shown.map(orderLine).join('') + '</div>' +
                '<footer class="wb-item-foot">' +
                    '<span class="wb-item-elapsed">' + icon('clock', 13) +
                        '<span data-elapsed="' + esc(p.calledAt || p.registered) + '">' +
                            esc(store.elapsed(p.calledAt || p.registered)) +
                        '</span>' +
                    '</span>' +
                    '<button type="button" class="btn-secondary btn-sm" data-open="' + esc(p.id) + '">' +
                        icon('eye', 14) + '<span>Open record</span>' +
                    '</button>' +
                '</footer>' +
            '</article>';
        }).join('');

        bindOpenButtons(host);
    }

    function renderCompletedList(rows) {
        var host = byId('completedList');
        if (!host) return;

        if (!rows.length) {
            host.innerHTML = ui.emptyState({
                icon: 'check-circle',
                title: 'No completed results',
                text: 'Released laboratory results and closed orders are listed here for review and sign-off.'
            });
            return;
        }

        host.innerHTML = rows.map(function (r) {
            var p = r.patient;
            var critical = r.orders.some(function (e) {
                return String(e.order.flag || '').toLowerCase() === 'critical';
            });
            var frame = critical ? ' is-critical' : (r.unreviewed ? ' is-ready' : '');
            var doc = lastDoctorOf(p);

            return '<article class="wb-item' + frame + '">' +
                '<header class="wb-item-head">' +
                    '<span class="avatar-sq ' + urgencyClass(p.urgency) + '">' + esc(store.initials(p.name)) + '</span>' +
                    '<div class="wb-item-identity">' +
                        '<span class="wb-item-name">' + esc(p.name) + '</span>' +
                        '<span class="wb-item-sub">' +
                            '<span class="mono">' + esc(p.trackingId) + '</span>' +
                            (r.unreviewed
                                ? '<span class="badge status-ready">' + r.unreviewed + ' unreviewed</span>'
                                : '<span class="badge status-finished">Reviewed</span>') +
                        '</span>' +
                    '</div>' +
                '</header>' +
                (doc ? '<div class="wb-item-doctor">' + icon('stethoscope', 12) + ' Under ' + esc(doc) + '</div>' : '') +
                '<div class="wb-item-orders">' + r.orders.map(orderLine).join('') + '</div>' +
                '<footer class="wb-item-foot">' +
                    '<span class="wb-item-elapsed">' + icon('clock', 13) +
                        '<span>' + esc(store.relativeTime(latestOrderTime(r.orders))) + '</span>' +
                    '</span>' +
                    '<button type="button" class="' + (r.unreviewed ? 'btn-primary' : 'btn-secondary') + ' btn-sm" data-open="' + esc(p.id) + '">' +
                        icon(r.unreviewed ? 'file-text' : 'eye', 14) +
                        '<span>' + (r.unreviewed ? 'Review results' : 'Open record') + '</span>' +
                    '</button>' +
                '</footer>' +
            '</article>';
        }).join('');

        bindOpenButtons(host);
    }

    function latestOrderTime(entries) {
        var latest = null;
        entries.forEach(function (e) {
            var t = e.order.completedAt || e.order.time;
            if (!t) return;
            var d = new Date(t);
            if (isNaN(d.getTime())) return;
            if (!latest || d > latest) latest = d;
        });
        return latest ? latest.toISOString() : null;
    }

    function bindOpenButtons(host) {
        ui.qsa('[data-open]', host).forEach(function (btn) {
            btn.addEventListener('click', function () {
                openWorkspace(btn.getAttribute('data-open'));
            });
        });
    }

    /* ==================================================================
        WORKSPACE
        ================================================================== */
    function openWorkspace(id, skipCall) {
        var p = store.findPatient(patients, id);
        if (!p) return;

        currentId = p.id;

        /* Calling a waiting patient starts the consultation under the
           signed-in clinician's name. */
        if (!skipCall && p.status === STATUS.PENDING) {
            p.status = STATUS.CONSULTING;
            p.calledAt = new Date().toISOString();
            p.assignedDoctor = currentStaffName();
            persist();

            /* Loud cross-workstation alert for the queue manager / nurse:
               every open tab picks this up via the storage event and plays
               a repeating critical chime with a sticky toast. */
            try {
                store.rawSet('meditrack_call_alert', JSON.stringify({
                    name: p.name,
                    trackingId: p.trackingId,
                    doctor: p.assignedDoctor,
                    at: new Date().toISOString()
                }));
            } catch (e) {}

            window.MediTrackNotify.event('queue.called', {
                key: 'called:' + p.id + ':' + p.calledAt,
                title: 'Patient Called',
                message: p.name + ' (' + p.trackingId + ') is now in consultation with ' + p.assignedDoctor + '.'
            });

            /* Abnormal observations must be raised at the point of call, once. */
            var assessment = clinical.assess(p.vitals);
            var stamp = assessment.overall + ':' + assessment.flagged.length;
            if (assessment.flagged.length && p.vitalsAlerted !== stamp) {
                clinical.notifyVitals(p.name, assessment, p.id + ':' + stamp);
                p.vitalsAlerted = stamp;
                persist();
            }
        }

        showWorkspace();
        renderWorkspace();
    }

    function renderWorkspace() {
        var p = currentPatient();
        if (!p) { showIntake(); return; }

        showWorkspace();

        var urgency = store.normalizeUrgency(p.urgency);
        var inits = store.initials(p.name);

        setText('wsTagAvatar', inits);
        setText('topbarPatientName', p.name);
        setText('topbarPatientTid', p.trackingId);

        var posBadge = byId('queueOrderBadge');
        if (posBadge) {
            var waiting = store.queueOrder(patients).length;
            posBadge.textContent = urgency + ' \u00b7 ' + waiting + ' still waiting';
        }

        setText('patientAvatar', inits);
        setText('patientName', p.name);
        setText('patientTrackingId', p.trackingId);

        var urgBadge = byId('patientUrgencyBadge');
        if (urgBadge) {
            urgBadge.className = 'badge ' + urgencyClass(urgency);
            urgBadge.textContent = urgency;
        }
        var statBadge = byId('patientStatusBadge');
        if (statBadge) {
            statBadge.className = 'badge ' + statusClass(p.status);
            statBadge.textContent = p.status;
        }

        setText('patientAge', p.age === null ? '\u2014' : p.age + ' yrs');
        setText('patientSex', p.sex || '\u2014');
        setText('patientPhone', p.phone || 'Not provided');
        setText('patientRegistered', store.formatDateTime(p.registered));
        setText('patientDoctor', p.assignedDoctor || lastDoctorOf(p) || 'Not assigned yet');

        var b = store.bmi(p.vitals.weight, p.vitals.height);
        setText('patientBMI', b ? b.value + ' (' + b.category + ')' : 'Not recorded');
        setText('patientWaited', store.elapsed(p.registered, p.calledAt));

        setText('patientDescription', p.description || 'No complaint recorded at triage.');

        renderVitals(p);
        renderTimeline(p);
        renderNotesHistory(p);
        renderPreviousVisits(p);
        renderOrderHistory(p, 'labOrders', 'labOrdersHistory');
        renderOrderHistory(p, 'nurseOrders', 'nurseOrdersHistory');
        renderOrderHistory(p, 'prescriptions', 'prescriptionOrdersHistory');
        markResultsReviewed(p);
        updateTabAlerts(p);
        renderStatusBar(p);
        renderBedsHint();

        if (window.MediIcons) window.MediIcons.hydrate(document);
    }

    /* --------------------------------------------- status bar / stepper */
    function openLabCount(p) {
        return (p.labOrders || []).filter(store.isOrderOpen).length;
    }

    function renderStatusBar(p) {
        var step = p.status === STATUS.FINISHED ? 'finished'
            : (p.status === STATUS.AWAITING ? 'awaiting' : 'consulting');

        var stepper = byId('statusStepper');
        if (stepper) {
            ui.qsa('.ss-step', stepper).forEach(function (el) {
                var key = el.getAttribute('data-ss');
                el.classList.remove('is-current', 'is-done', 'is-locked');
                if (key === step) el.classList.add('is-current');
                else if ((step === 'awaiting' && key === 'consulting') ||
                         (step === 'finished')) el.classList.add('is-done');
            });
        }

        var labOutstanding = openLabCount(p);
        var finishBtn = byId('btnSetFinished');

        if (labOutstanding > 0 && p.status !== STATUS.FINISHED) {
            if (finishBtn) {
                finishBtn.disabled = true;
                finishBtn.title = 'Laboratory results are still outstanding.';
            }
            var note = byId('statusLockNote');
            if (note) {
                note.hidden = false;
                setText('statusLockText',
                    labOutstanding + ' laboratory order' + (labOutstanding > 1 ? 's' : '') +
                    ' still outstanding \u2014 Complete unlocks once the results are released.');
            }
        } else {
            if (finishBtn) {
                finishBtn.disabled = false;
                finishBtn.removeAttribute('title');
            }
            var noteOff = byId('statusLockNote');
            if (noteOff) noteOff.hidden = true;
        }
    }

    /* ------------------------------------------------------ vitals card */
    function renderVitals(p) {
        var assessment = clinical.assess(p.vitals);

        var overall = byId('vitalsOverallBadge');
        if (overall) {
            overall.className = 'vitals-overall level-' + assessment.overall;
            overall.textContent = assessment.recordedCount
                ? assessment.overallLabel
                : 'Not recorded';
        }

        var callout = byId('vitalsCallout');
        if (callout) {
            var critical = assessment.flagged.filter(function (f) { return f.level === 'critical'; });
            if (assessment.flagged.length) {
                callout.hidden = false;
                callout.className = 'vitals-callout level-' + (critical.length ? 'critical' : 'abnormal');
                setText('vitalsCalloutTitle', critical.length
                    ? 'Critical observation \u2014 immediate review'
                    : 'Observations outside reference range');
                setText('vitalsCalloutText', assessment.summary);
            } else {
                callout.hidden = true;
            }
        }

        var grid = byId('vitalsGrid');
        if (grid) {
            if (!assessment.results.length) {
                grid.innerHTML = '<div class="vital-box level-normal">' +
                    '<span class="vital-label">Vitals</span>' +
                    '<span class="vital-num">\u2014</span>' +
                    '<span class="vital-range">No observations recorded at triage</span>' +
                '</div>';
            } else {
                grid.innerHTML = assessment.results.map(function (r) {
                    var unit = r.key === 'bloodPressure' ? 'mmHg' : r.unit;
                    return '<div class="vital-box level-' + r.level + '">' +
                        '<span class="vital-label">' + esc(r.label) + '</span>' +
                        '<span class="vital-num">' + esc(r.display) +
                            (unit ? '<small>' + esc(unit) + '</small>' : '') +
                        '</span>' +
                        '<span class="vital-state">' + esc(r.levelLabel) +
                            (r.key === 'bloodPressure' && r.category ? ' \u00b7 ' + esc(r.category) : '') +
                        '</span>' +
                        (r.range ? '<span class="vital-range">Normal ' + esc(r.range) + '</span>' : '') +
                    '</div>';
                }).join('');
            }
        }

        var notes = byId('vitalsNotes');
        if (notes) {
            notes.innerHTML = assessment.flagged.map(function (f) {
                return '<li class="level-' + f.level + '">' +
                    icon(f.level === 'critical' ? 'critical' : 'warning', 13) +
                    '<span><strong>' + esc(f.label) + ':</strong> ' + esc(f.note) + '</span>' +
                '</li>';
            }).join('');
        }
    }

    /* --------------------------------------------------------- timeline */
    function renderTimeline(p) {
        var host = byId('patientTimeline');
        if (!host) return;

        var steps = [{
            state: 'step-done',
            title: 'Registered at reception',
            text: 'Triaged as ' + store.normalizeUrgency(p.urgency),
            time: store.formatDateTime(p.registered)
        }];

        if (p.calledAt) {
            steps.push({
                state: 'step-done',
                title: 'Called into consultation',
                text: (p.assignedDoctor ? p.assignedDoctor + ' \u00b7 ' : '') +
                      'Waited ' + store.elapsed(p.registered, p.calledAt),
                time: store.formatDateTime(p.calledAt)
            });
        }

        (p.clinicalNotes || []).forEach(function (n) {
            steps.push({
                state: 'step-done',
                title: n.diagnosis ? 'Diagnosis: ' + n.diagnosis : 'Clinical note recorded',
                text: (n.doctor ? n.doctor + ': ' : '') + n.note,
                time: store.formatDateTime(n.time)
            });
        });

        [['labOrders', 'Laboratory'], ['nurseOrders', 'Nursing'], ['prescriptions', 'Pharmacy']].forEach(function (pair) {
            (p[pair[0]] || []).forEach(function (o) {
                var open = store.isOrderOpen(o);
                var flag = String(o.flag || '').toLowerCase();
                steps.push({
                    state: flag === 'critical' ? 'step-alert' : (open ? 'step-active' : 'step-done'),
                    title: pair[1] + ': ' + (o.test || o.task || o.medication || 'Order'),
                    text: (o.doctor ? o.doctor + ': ' : '') +
                          (open ? (o.status || 'Outstanding') : (o.results || o.status || 'Completed')),
                    time: store.formatDateTime(o.completedAt || o.time),
                    sortTime: o.completedAt || o.time
                });
            });
        });

        if (p.status === STATUS.FINISHED && p.completedAt) {
            steps.push({
                state: 'step-done',
                title: 'Visit completed and archived',
                text: 'Total time in department ' + store.elapsed(p.registered, p.completedAt),
                time: store.formatDateTime(p.completedAt)
            });
        }

        host.innerHTML = steps.map(function (s) {
            return '<li class="timeline-step ' + s.state + '">' +
                '<span class="step-dot" aria-hidden="true"></span>' +
                '<div class="step-content">' +
                    '<span class="step-title">' + esc(s.title) + '</span>' +
                    (s.text ? '<span class="step-text">' + esc(s.text) + '</span>' : '') +
                    '<span class="step-time">' + esc(s.time) + '</span>' +
                '</div>' +
            '</li>';
        }).join('');
    }

    /* ------------------------------------------------------- histories */
    function renderNotesHistory(p) {
        var host = byId('clinicalNotesHistory');
        if (!host) return;
        var notes = (p.clinicalNotes || []).slice().reverse();
        var medicationHistory = (p.medicationHistory || []).slice().reverse();

        if (!notes.length && !medicationHistory.length) {
            host.innerHTML = '<span class="history-empty">No clinical notes recorded for this visit yet.</span>';
            return;
        }

        host.innerHTML = notes.map(function (n) {
            return '<div class="history-item">' +
                '<div class="history-item-head">' +
                    '<strong class="history-item-title">' + esc(n.diagnosis || 'Clinical note') + '</strong>' +
                    '<span class="history-item-time">' + esc(store.formatDateTime(n.time)) + '</span>' +
                '</div>' +
                '<div class="history-item-body">' + esc(n.note) + '</div>' +
                (n.doctor ? '<div class="history-item-by">' + icon('stethoscope', 12) + ' ' + esc(n.doctor) + '</div>' : '') +
            '</div>';
        }).concat(medicationHistory.map(function (m) {
            return '<div class="history-item is-medication">' +
                '<div class="history-item-head">' +
                    '<strong class="history-item-title">Medication given</strong>' +
                    '<span class="history-item-time">' + esc(store.formatDateTime(m.time)) + '</span>' +
                '</div>' +
                '<div class="history-item-body">' + esc(m.details) + '</div>' +
                (m.doctor ? '<div class="history-item-by">' + icon('pill', 12) + ' ' + esc(m.doctor) + '</div>' : '') +
            '</div>';
        })).join('');
    }

    function renderPreviousVisits(p) {
        var section = byId('storageHistorySection');
        var host = byId('storageHistoryList');
        if (!section || !host) return;

        var phone = String(p.phone || '').replace(/\s+/g, '');
        if (!phone) { section.hidden = true; return; }

        var past = patients.filter(function (other) {
            return String(other.id) !== String(p.id) &&
                String(other.phone || '').replace(/\s+/g, '') === phone &&
                other.status === STATUS.FINISHED;
        });

        if (!past.length) { section.hidden = true; return; }
        section.hidden = false;

        host.innerHTML = past.map(function (v) {
            var body = (v.clinicalNotes || []).length
                ? v.clinicalNotes.map(function (n) {
                    return '<div><strong>' + esc(n.diagnosis || 'Note') + ':</strong> ' + esc(n.note) + '</div>';
                }).join('')
                : '<div>Complaint: ' + esc(v.description || '\u2014') + '</div>';
            var medicationHistory = v.medicationHistory || [];
            if (medicationHistory.length) {
                body += medicationHistory.map(function (m) {
                    return '<div><strong>Medication given:</strong> ' + esc(m.details) + '</div>';
                }).join('');
            }

            return '<div class="history-item is-complete">' +
                '<div class="history-item-head">' +
                    '<strong class="history-item-title">' + esc(store.formatDate(v.registered)) + '</strong>' +
                    '<span class="badge status-finished">' + esc(v.trackingId) + '</span>' +
                '</div>' +
                '<div class="history-item-body">' + body + '</div>' +
            '</div>';
        }).join('');
    }

    function renderOrderHistory(p, key, hostId) {
        var host = byId(hostId);
        if (!host) return;
        var orders = (p[key] || []).slice().reverse();

        if (!orders.length) {
            host.innerHTML = '<span class="history-empty">No orders dispatched for this visit yet.</span>';
            return;
        }

        host.innerHTML = orders.map(function (o) {
            var open = store.isOrderOpen(o);
            var flag = String(o.flag || '').toLowerCase();
            var cls = flag === 'critical' ? 'is-critical' : (open ? 'is-open' : 'is-complete');

            var title, body;
            if (key === 'labOrders') {
                title = (o.test || 'Diagnostic test') + (o.priority ? ' \u00b7 ' + o.priority : '');
                body = '<strong>Instructions:</strong> ' + esc(o.note || '\u2014');
            } else if (key === 'nurseOrders') {
                title = o.task || 'Nursing task';
                body = '<strong>Remarks:</strong> ' + esc(o.note || '\u2014');
            } else {
                title = (o.medication || 'Medication') + (o.dosage ? ' \u00b7 ' + o.dosage : '');
                body = '<strong>Regimen:</strong> ' + esc([o.frequency, o.route, o.duration].filter(Boolean).join(' \u00b7 ') || '\u2014') +
                    (o.instructions ? '<div>' + esc(o.instructions) + '</div>' : '');
            }

            var badgeCls = flag === 'critical' ? 'status-critical' : (open ? 'status-awaiting' : 'status-finished');

            /* Who did what: ordering clinician plus whoever performed it. */
            var actors = [];
            if (o.doctor) actors.push('Ordered by ' + o.doctor);
            if (key === 'labOrders' && o.technician) actors.push('Performed by ' + o.technician);
            if (key === 'nurseOrders' && o.completedBy) actors.push('Performed by ' + o.completedBy);
            if (key === 'prescriptions' && o.dispensedBy) actors.push('Handled by ' + o.dispensedBy);

            return '<div class="history-item ' + cls + '">' +
                '<div class="history-item-head">' +
                    '<strong class="history-item-title">' + esc(title) + '</strong>' +
                    '<span class="badge ' + badgeCls + '">' + esc(o.status || (open ? 'Outstanding' : 'Completed')) + '</span>' +
                '</div>' +
                '<div class="history-item-body">' + body + '</div>' +
                (o.results
                    ? '<div class="history-item-result"><strong>Result:</strong> ' + esc(o.results) +
                      (o.techRemarks ? '<div>' + esc(o.techRemarks) + '</div>' : '') + '</div>'
                    : '') +
                '<div class="history-item-head" style="margin-top:6px">' +
                    '<span class="history-item-time">' + esc(actors.join(' \u00b7 ') || 'Ordered ' + store.formatDateTime(o.time)) + '</span>' +
                    '<span class="history-item-time">' + esc(store.formatDateTime(o.time)) + '</span>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    /* Opening the record counts as acknowledging delivered results. */
    function markResultsReviewed(p) {
        var pending = store.unreviewedResults(p);
        if (!pending.length) return;
        pending.forEach(function (o) { o.reviewed = true; });
        persist();
    }

    function updateTabAlerts(p) {
        var counts = {
            tabLabOrders: (p.labOrders || []).filter(store.isOrderOpen).length,
            tabNurseOrders: (p.nurseOrders || []).filter(store.isOrderOpen).length,
            tabPharmacyOrders: (p.prescriptions || []).filter(store.isOrderOpen).length
        };
        Object.keys(counts).forEach(function (tab) {
            var btn = ui.qs('[data-tab="' + tab + '"]');
            if (!btn) return;
            var badge = ui.qs('.tab-count', btn);
            if (!badge) return;
            if (counts[tab] > 0) {
                badge.textContent = counts[tab];
                badge.hidden = false;
                badge.classList.toggle('tab-count-alert', counts[tab] >= 3);
                btn.classList.add('has-alert');
            } else {
                badge.hidden = true;
                badge.classList.remove('tab-count-alert');
                btn.classList.remove('has-alert');
            }
        });
    }

    /* ==================================================================
        Clinician actions
        ================================================================== */
    function saveNote() {
        var p = currentPatient();
        if (!p) return;

        var noteText = byId('inputClinicalNotes').value.trim();
        var medicationText = byId('inputMedicationGiven').value.trim();
        if (!noteText && !medicationText) {
            ui.requireFields([{ id: 'inputClinicalNotes', message: 'Record clinical findings or medication given before saving.' }]);
            return;
        }

        var now = new Date().toISOString();
        if (noteText) {
            p.clinicalNotes.push({
                id: Date.now(),
                diagnosis: byId('inputDiagnosis').value.trim(),
                note: noteText,
                doctor: currentStaffName(),
                time: now
            });
        }
        if (medicationText) {
            p.medicationHistory = p.medicationHistory || [];
            p.medicationHistory.push({
                id: Date.now() + 1,
                details: medicationText,
                doctor: currentStaffName(),
                time: now
            });
        }

        if (p.status === STATUS.PENDING) {
            p.status = STATUS.CONSULTING;
            p.calledAt = p.calledAt || new Date().toISOString();
        }

        persist();
        byId('inputDiagnosis').value = '';
        byId('inputClinicalNotes').value = '';
        byId('inputMedicationGiven').value = '';

        renderWorkspace();

        window.MediTrackNotify.flash('Consultation saved',
            (medicationText ? 'Medication history updated. ' : '') +
            (noteText ? 'Clinical note attached to this visit. ' : '') +
            'Recorded under ' + currentStaffName() + '.');
    }

    function sendLabOrder() {
        var p = currentPatient();
        if (!p) return;

        if (!ui.requireFields([
            { id: 'inputLabTestName', message: 'Specify the test or panel required.' },
            { id: 'inputLabNote', message: 'Add instructions so the laboratory knows what to prioritise.' }
        ])) return;

        var priority = ui.getSelectValue('labPriorityWrapper') || 'Routine';
        var order = {
            id: Date.now(),
            patientId: p.id,
            trackingId: p.trackingId,
            patientName: p.name,
            age: p.age,
            phone: p.phone,
            test: byId('inputLabTestName').value.trim(),
            priority: priority,
            note: byId('inputLabNote').value.trim(),
            doctor: currentStaffName(),
            time: new Date().toISOString(),
            status: 'Requested',
            results: ''
        };

        p.labOrders.push(order);
        p.status = STATUS.AWAITING;
        persist();
        appendGlobal(store.KEYS.labRequests, order);

        byId('inputLabTestName').value = '';
        byId('inputLabNote').value = '';
        renderWorkspace();

        var urgent = priority === 'Urgent' || priority === 'STAT';
        window.MediTrackNotify.event(urgent ? 'lab.request.urgent' : 'lab.request.created', {
            key: 'laborder:' + order.id,
            title: urgent ? priority + ' Lab Request' : 'Lab Request Sent',
            message: order.test + ' requested for ' + p.name + ' by ' + order.doctor +
                     '. Patient moved to awaiting results.'
        });
    }

    function sendNurseOrder() {
        var p = currentPatient();
        if (!p) return;

        if (!ui.requireFields([
            { id: 'inputNurseTask', message: 'Describe the nursing task.' },
            { id: 'inputNurseNote', message: 'Add the parameters the nurse should act on.' }
        ])) return;

        var order = {
            id: Date.now(),
            patientId: p.id,
            trackingId: p.trackingId,
            patientName: p.name,
            task: byId('inputNurseTask').value.trim(),
            note: byId('inputNurseNote').value.trim(),
            doctor: currentStaffName(),
            time: new Date().toISOString(),
            status: 'Dispatched'
        };

        p.nurseOrders.push(order);
        persist();
        appendGlobal(store.KEYS.nurseTasks, order);

        byId('inputNurseTask').value = '';
        byId('inputNurseNote').value = '';
        renderWorkspace();
        window.MediTrackNotify.event('nurse.task.created', {
            key: 'nurseorder:' + order.id,
            title: 'Nursing task dispatched',
            message: order.task + ' requested for ' + p.name + ' by ' + order.doctor + '.'
        });
    }

    function sendPrescription() {
        var p = currentPatient();
        if (!p) return;

        if (!ui.requireFields([
            { id: 'inputRxMedName', message: 'Enter the medication name and strength.' },
            { id: 'inputRxDosage', message: 'Enter the dose.' }
        ])) return;

        var order = {
            id: Date.now(),
            patientId: p.id,
            trackingId: p.trackingId,
            patientName: p.name,
            medication: byId('inputRxMedName').value.trim(),
            dosage: byId('inputRxDosage').value.trim(),
            frequency: ui.getSelectValue('rxFreqWrapper') || 'BID',
            route: ui.getSelectValue('rxRouteWrapper') || 'Oral',
            duration: byId('inputRxDuration').value.trim(),
            instructions: byId('inputRxInstructions').value.trim(),
            doctor: currentStaffName(),
            time: new Date().toISOString(),
            status: 'Prescribed'
        };

        p.prescriptions.push(order);
        persist();
        appendGlobal(store.KEYS.prescriptions, order);

        ['inputRxMedName', 'inputRxDosage', 'inputRxDuration', 'inputRxInstructions'].forEach(function (id) {
            byId(id).value = '';
        });
        renderWorkspace();
        window.MediTrackNotify.event('pharmacy.order.created', {
            key: 'prescription:' + order.id,
            title: 'Prescription sent to pharmacy',
            message: order.medication + ' for ' + p.name + ' prescribed by ' + order.doctor + '.'
        });
    }

    /* After the doctor signs the visit off, no separate final invoice is
       raised. Billing takes the final payment on the patient's own card bill
       — the nurse enters the consultation amount plus any additional costs
       there. */
    function completeVisit() {
        var p = currentPatient();
        if (!p) return;

        var labsOutstanding = openLabCount(p);
        if (labsOutstanding > 0) {
            window.MediTrackNotify.push(
                'Results still outstanding',
                p.name + ' has ' + labsOutstanding + ' laboratory order' +
                    (labsOutstanding > 1 ? 's' : '') + ' without a result. Complete unlocks once they are released.',
                'warning', 'Doctor', 'high'
            );
            return;
        }

        var otherOpen = (store.openOrderCount(p) - labsOutstanding);
        var message = otherOpen > 0
            ? 'Completing marks the visit complete even though ' + otherOpen + ' nursing/pharmacy order' +
              (otherOpen > 1 ? 's are' : ' is') + ' still open. Billing will take the final payment before the patient leaves.'
            : 'This closes the visit for ' + p.name + '. Billing will take the final payment before the patient leaves.';

        ui.confirmAction({
            title: 'Complete visit',
            subtitle: p.trackingId,
            message: message,
            confirmLabel: 'Complete visit',
            tone: otherOpen ? 'warning' : 'info',
            icon: 'check'
        }, function () {
            p.status = STATUS.FINISHED;
            p.completedAt = new Date().toISOString();
            p.completedBy = currentStaffName();
            persist();

            window.MediTrackNotify.event('consult.completed', {
                key: 'completed:' + p.id,
                title: 'Visit Completed',
                message: p.name + ' (' + p.trackingId + ') archived by ' + p.completedBy +
                         ' after ' + store.elapsed(p.registered, p.completedAt) + ' in the department.'
            });

            showIntake();
            /* The final payment happens in Billing on the patient's own card
               bill — no separate final invoice is raised here. */
            store.navigate('pages/billing.html');
        });
    }

    /* Completes the current visit and immediately calls the queue's next.
       When the visit still has open orders (laboratory, nursing or
       pharmacy) the doctor is asked to confirm, and the patient moves to
       Awaiting Results instead of being blocked or completed. */
    function callNext() {
        var p = currentPatient();

        function proceed() {
            var queue = store.queueOrder(patients);
            if (!queue.length) {
                showIntake();
                window.MediTrackNotify.push(
                    'Queue clear',
                    'No patients are waiting to be called.',
                    'success', 'Queue', 'normal'
                );
                return;
            }
            /* Doctors are served their own queue first; the general queue
               redirects to them when nobody specifically booked them. */
            var pick = doctorNextFromQueue(queue);
            openWorkspace((pick ? pick.patient : queue[0]).id);
        }

        if (!p) { proceed(); return; }

        var outstanding = store.openOrderCount(p);
        if (outstanding > 0) {
            ui.confirmAction({
                title: 'Call the next patient',
                subtitle: 'Current visit: ' + p.name,
                message: p.name + ' still has ' + outstanding +
                         ' open order' + (outstanding > 1 ? 's' : '') +
                         '. They will be moved to Awaiting Results until the department closes them, and the next patient in the queue will be called in.',
                confirmLabel: 'Move to awaiting results & call next',
                tone: 'warning',
                icon: 'hourglass'
            }, function () {
                p.status = STATUS.AWAITING;
                persist();
                window.MediTrackNotify.flash('Patient parked',
                    p.name + ' moved to awaiting results. Next patient called.');
                proceed();
            });
            return;
        }

        ui.confirmAction({
            title: 'Call the next patient',
            subtitle: 'Current visit: ' + p.name,
            message: 'This completes ' + p.name + '\u2019s visit and calls the next patient in the queue.',
            confirmLabel: 'Complete and call next',
            tone: 'info',
            icon: 'arrow-right'
        }, function () {
            p.status = STATUS.FINISHED;
            p.completedAt = new Date().toISOString();
            p.completedBy = currentStaffName();
            persist();
            /* No separate final invoice is raised here — billing takes the
               final payment on the patient's own card bill. */
            proceed();
        });
    }

    /* ==================================================================
        Quick nursing orders + bed setup
        Doctors dispatch bedside work with one tap. "Setup bed" reserves a
        free bed from the nurse station's board and dispatches the order,
        so two doctors can never grab the same bed.
        ================================================================== */
    function freeBeds() {
        return store.read(store.KEYS.beds).filter(function (b) { return b.status === 'Free'; });
    }

    function renderBedsHint() {
        var hint = byId('nurseBedsHint');
        if (!hint) return;
        var free = freeBeds();
        hint.textContent = free.length
            ? free.length + ' bed' + (free.length > 1 ? 's' : '') + ' free — "Setup bed" reserves one and dispatches the nurse.'
            : 'No free beds — "Setup bed" will dispatch a normal bed request.';
    }

    function bindQuickOrders() {
        var wrap = byId('nurseQuickOrders');
        if (!wrap) return;
        ui.qsa('[data-quick-task]', wrap).forEach(function (chip) {
            chip.addEventListener('click', function () {
                if (chip.getAttribute('data-quick-bed')) {
                    openBedSetup();
                    return;
                }
                var input = byId('inputNurseTask');
                if (input) {
                    input.value = chip.getAttribute('data-quick-task');
                    input.focus();
                }
            });
        });
    }

    function openBedSetup() {
        var menu = byId('bedPickMenu');
        if (!menu) return;
        var free = freeBeds();
        if (!free.length) {
            menu.innerHTML = '<li class="cs-option" data-value="" data-label="No free beds">No free beds — dispatch a normal order instead</li>';
            ui.setSelectValue('bedPickWrapper', '', 'No free beds');
        } else {
            menu.innerHTML = free.map(function (b, i) {
                var label = (b.ward || 'General') + ' \u00b7 ' + b.label;
                return '<li class="cs-option' + (i === 0 ? ' selected' : '') + '" data-value="' + esc(b.id) +
                    '" data-label="' + esc(label) + '">' + esc(label) + '</li>';
            }).join('');
            ui.setSelectValue('bedPickWrapper', String(free[0].id),
                (free[0].ward || 'General') + ' \u00b7 ' + free[0].label);
        }
        var note = byId('bedSetupNote');
        if (note) note.value = '';
        ui.openModal('bedSetupModal');
    }

    function confirmBedSetup() {
        var p = currentPatient();
        if (!p) return;
        var bedId = ui.getSelectValue('bedPickWrapper');
        if (!bedId) {
            window.MediTrackNotify.flash('Choose a bed', 'Pick a free bed, or send a normal order instead.', 'warning');
            return;
        }
        var bedList = store.read(store.KEYS.beds);
        var bed = null;
        bedList.forEach(function (b) { if (String(b.id) === String(bedId)) bed = b; });
        if (!bed || bed.status !== 'Free') {
            window.MediTrackNotify.flash('Bed unavailable', 'That bed was just taken — choose another.', 'warning');
            ui.closeModal('bedSetupModal');
            return;
        }

        var label = (bed.ward || 'General') + ' \u00b7 ' + bed.label;
        var order = {
            id: Date.now(),
            patientId: p.id,
            trackingId: p.trackingId,
            patientName: p.name,
            task: 'Setup bed \u2014 ' + label,
            note: byId('bedSetupNote').value.trim() || 'Prepare the bed for the patient\u2019s arrival.',
            doctor: currentStaffName(),
            time: new Date().toISOString(),
            status: 'Dispatched',
            bedId: bed.id,
            bedLabel: label
        };

        p.nurseOrders.push(order);
        persist();
        appendGlobal(store.KEYS.nurseTasks, order);

        /* Reserve the bed for this patient so nobody else takes it. */
        bed.status = 'Reserved';
        bed.patientId = p.id;
        bed.patientName = p.name;
        bed.updatedAt = new Date().toISOString();
        bed.updatedBy = currentStaffName();
        store.write(store.KEYS.beds, bedList);

        ui.closeModal('bedSetupModal');
        renderWorkspace();
        window.MediTrackNotify.flash('Bed reserved and nurse dispatched',
            label + ' held for ' + p.name + '.');
    }

    /* ==================================================================
        Live elapsed counters
        ================================================================== */
    function tickElapsed() {
        ui.qsa('[data-elapsed]').forEach(function (el) {
            el.textContent = store.elapsed(el.getAttribute('data-elapsed'));
        });
    }

    /* ==================================================================
        Init
        ================================================================== */
    function init() {
        load();

        /* Workbench tabs */
        ui.initTabs({
            buttonSelector: '.wb-tab',
            panelSelector: '.wb-panel',
            attribute: 'data-wb'
        });

        /* Awaiting-results source filter */
        ui.initChips(document.querySelector('#wbAwaiting .wb-subhead'), 'data-await-filter', function (value) {
            awaitFilter = value;
            renderWorkbench();
        });

        /* Workspace tabs */
        ui.initTabs({
            buttonSelector: '.tab-nav-btn',
            panelSelector: '.tab-panel-content',
            attribute: 'data-tab'
        });

        ui.initSelect('labPriorityWrapper');
        ui.initSelect('rxFreqWrapper');
        ui.initSelect('rxRouteWrapper');

        ui.bindLiveValidation([
            'inputClinicalNotes', 'inputLabTestName', 'inputLabNote',
            'inputNurseTask', 'inputNurseNote', 'inputRxMedName', 'inputRxDosage'
        ]);

        var bindings = [
            ['btnBackToIntake', showIntake],
            ['saveNoteBtn', saveNote],
            ['sendLabOrderBtn', sendLabOrder],
            ['sendNurseOrderBtn', sendNurseOrder],
            ['sendPrescriptionBtn', sendPrescription],
            ['btnSetFinished', completeVisit],
            ['btnNextPatient', callNext],
            ['confirmBedSetupBtn', confirmBedSetup]
        ];
        bindings.forEach(function (pair) {
            var el = byId(pair[0]);
            if (el) el.addEventListener('click', pair[1]);
        });

        bindQuickOrders();

        store.onPatientsChanged(function () {
            patients = store.readPatients();
            if (currentId !== null && currentPatient()) renderWorkspace();
            else if (currentId !== null) showIntake();
            else renderIntake();
        });

        setInterval(tickElapsed, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
