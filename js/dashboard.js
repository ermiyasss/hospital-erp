/* ==========================================================================
   MediTrack Hospital ERP - Clinical Overview

   The dashboard answers one question: what needs attention right now. It reads
   the same canonical data as every department screen (js/store.js) so the
   figures cannot drift from the queue or the workbench.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var clinical = window.MediClinical;
    var STATUS = store.STATUS;

    var patients = [];
    var labs = [];
    var scripts = [];

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
       Load
       ================================================================== */
    function load() {
        patients = store.seedIfEmpty();
        if (!patients.length) patients = store.readPatients();
        labs = store.read(store.KEYS.labRequests);
        scripts = store.read(store.KEYS.prescriptions);
        render();
    }

    function render() {
        renderStats();
        renderAttention();
        renderQueuePreview();
        renderDeptLoad();
        renderTriageMix();
        renderActivity();
        if (window.MediIcons) window.MediIcons.hydrate(document);
    }

    /* ==================================================================
       Key figures
       ================================================================== */
    function renderStats() {
        var queue = store.queueOrder(patients);
        var consulting = store.consultingPatients(patients);
        var awaiting = store.awaitingPatients(patients);
        var openLabs = labs.filter(function (l) { return l.status !== 'Completed'; });

        setText('statQueue', queue.length);
        setText('statConsulting', consulting.length);
        setText('statAwaiting', awaiting.length);
        setText('statLab', openLabs.length);

        var emergencies = queue.filter(function (p) {
            return store.normalizeUrgency(p.urgency) === store.URGENCY.EMERGENCY;
        }).length;

        var trendQueue = byId('trendQueue');
        if (trendQueue) {
            trendQueue.textContent = emergencies ? emergencies + ' emergency' : 'Waiting';
            trendQueue.classList.toggle('trend-danger', emergencies > 0);
        }

        setText('footQueue', queue.length
            ? 'Longest wait ' + store.elapsed(queue[queue.length - 1].registered)
            : 'Queue is clear');

        setText('footConsult', consulting.length
            ? consulting.map(function (p) { return p.name; }).slice(0, 2).join(', ')
            : 'No active consultation');

        setText('footAwaiting', awaiting.length
            ? awaiting.length + ' parked while diagnostics run'
            : 'Nothing parked');

        var stat = openLabs.filter(function (l) {
            var p = String(l.priority || '').toLowerCase();
            return p === 'stat' || p === 'urgent';
        }).length;
        var trendLab = byId('trendLab');
        if (trendLab) {
            trendLab.textContent = stat ? stat + ' urgent' : 'Laboratory';
            trendLab.classList.toggle('trend-danger', stat > 0);
        }
        setText('footLab', openLabs.length ? 'Oldest ' + store.elapsed(oldestTime(openLabs)) : 'Nothing outstanding');

        /* Completions today, with the median stay for context. */
        var today = patients.filter(function (p) {
            if (p.status !== STATUS.FINISHED || !p.completedAt) return false;
            var d = new Date(p.completedAt);
            var now = new Date();
            return d.getFullYear() === now.getFullYear() &&
                d.getMonth() === now.getMonth() &&
                d.getDate() === now.getDate();
        });
        setText('statCompleted', today.length);

        var stays = today.map(function (p) {
            return Math.max(0, Math.round((new Date(p.completedAt) - new Date(p.registered)) / 60000));
        }).sort(function (a, b) { return a - b; });

        if (stays.length) {
            var mid = Math.floor(stays.length / 2);
            var median = stays.length % 2 ? stays[mid] : Math.round((stays[mid - 1] + stays[mid]) / 2);
            setText('footCompleted', 'Median stay ' + formatMinutes(median));
        } else {
            setText('footCompleted', 'No completions yet today');
        }

        var policyNote = byId('queuePolicyNote');
        if (policyNote) {
            policyNote.textContent = store.queuePolicy() === store.POLICIES.FIFO
                ? 'Arrival order — clinical priority is not applied'
                : 'Ordered by triage priority, then arrival time';
        }
    }

    function oldestTime(list) {
        var oldest = null;
        list.forEach(function (o) {
            var d = new Date(o.time);
            if (isNaN(d.getTime())) return;
            if (!oldest || d < oldest) oldest = d;
        });
        return oldest ? oldest.toISOString() : null;
    }

    function formatMinutes(mins) {
        if (mins < 60) return mins + 'm';
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        return m ? h + 'h ' + m + 'm' : h + 'h';
    }

    /* ==================================================================
       Attention strip
       Only rendered when there is something to act on, so an empty department
       does not show a row of reassuring green panels.
       ================================================================== */
    function renderAttention() {
        var host = byId('attentionStack');
        if (!host) return;

        var items = [];

        var emergencies = store.queueOrder(patients).filter(function (p) {
            return store.normalizeUrgency(p.urgency) === store.URGENCY.EMERGENCY;
        });
        if (emergencies.length) {
            items.push({
                tone: 'critical',
                icon: 'critical',
                title: emergencies.length + ' emergency patient' + (emergencies.length > 1 ? 's' : '') + ' waiting',
                text: emergencies.map(function (p) {
                    return p.name + ' (' + store.elapsed(p.registered) + ')';
                }).slice(0, 3).join(' · '),
                label: 'Open queue',
                target: 'pages/queue.html'
            });
        }

        var criticalResults = labs.filter(function (l) {
            return l.status === 'Completed' && l.flag === 'Critical';
        });
        var archivedCritical = store.read(store.KEYS.labArchive).filter(function (l) {
            return l.flag === 'Critical';
        });
        var unreviewedCritical = archivedCritical.concat(criticalResults).filter(function (l) {
            var p = store.findPatient(patients, l.patientId);
            if (!p) return false;
            return store.unreviewedResults(p).some(function (o) { return String(o.id) === String(l.id); });
        });
        if (unreviewedCritical.length) {
            items.push({
                tone: 'critical',
                icon: 'lab',
                title: unreviewedCritical.length + ' critical result' + (unreviewedCritical.length > 1 ? 's' : '') + ' unreviewed',
                text: unreviewedCritical.map(function (l) {
                    return l.test + ' — ' + l.patientName;
                }).slice(0, 2).join(' · '),
                label: 'Review now',
                target: 'pages/track.html'
            });
        }

        var criticalVitals = store.activePatients(patients).filter(function (p) {
            return clinical.assess(p.vitals).overall === 'critical';
        });
        if (criticalVitals.length) {
            items.push({
                tone: 'critical',
                icon: 'pulse',
                title: criticalVitals.length + ' patient' + (criticalVitals.length > 1 ? 's' : '') + ' with critical observations',
                text: criticalVitals.map(function (p) { return p.name; }).slice(0, 3).join(' · '),
                label: 'Open consultation',
                target: 'pages/track.html'
            });
        }

        var readyToReview = patients.filter(function (p) {
            return p.status !== STATUS.FINISHED && store.unreviewedResults(p).length;
        });
        if (readyToReview.length && !unreviewedCritical.length) {
            items.push({
                tone: 'info',
                icon: 'file-text',
                title: readyToReview.length + ' patient' + (readyToReview.length > 1 ? 's' : '') + ' with results ready',
                text: readyToReview.map(function (p) { return p.name; }).slice(0, 3).join(' · '),
                label: 'Review results',
                target: 'pages/track.html'
            });
        }

        if (!items.length) { host.innerHTML = ''; return; }

        host.innerHTML = items.map(function (it) {
            return '<article class="attention attention-' + it.tone + '">' +
                '<span class="att-icon">' + icon(it.icon, 16) + '</span>' +
                '<div class="att-body">' +
                    '<strong>' + esc(it.title) + '</strong>' +
                    '<span>' + esc(it.text) + '</span>' +
                '</div>' +
                '<button type="button" class="att-action" data-go="' + it.target + '">' + esc(it.label) + '</button>' +
            '</article>';
        }).join('');

        bindGo(host);
    }

    /* ==================================================================
       Queue preview
       ================================================================== */
    function renderQueuePreview() {
        var host = byId('queuePreview');
        if (!host) return;

        var queue = store.queueOrder(patients);

        if (!queue.length) {
            host.innerHTML = ui.emptyState({
                icon: 'check-circle',
                title: 'The queue is clear',
                text: 'Patients appear here as soon as reception completes registration and triage.'
            });
            return;
        }

        host.innerHTML = queue.slice(0, 6).map(function (p, i) {
            var urgency = store.normalizeUrgency(p.urgency);
            var assessment = clinical.assess(p.vitals);

            return '<div class="list-item">' +
                '<span class="list-position">' + String(i + 1).padStart(2, '0') + '</span>' +
                '<span class="avatar-sq ' + urgencyClass(urgency) + '">' + esc(store.initials(p.name)) + '</span>' +
                '<span class="list-content">' +
                    '<span class="list-title">' + esc(p.name) +
                        '<span class="list-id mono">' + esc(p.trackingId) + '</span>' +
                    '</span>' +
                    '<span class="list-subtitle">' + esc(p.description || 'No complaint recorded.') + '</span>' +
                '</span>' +
                '<span class="list-tail">' +
                    (assessment.flagged.length
                        ? '<span class="badge ' + (assessment.overall === 'critical' ? 'status-critical' : 'status-awaiting') + '">' +
                          esc(assessment.overallLabel) + '</span>'
                        : '') +
                    '<span class="badge ' + urgencyClass(urgency) + '">' + esc(urgency) + '</span>' +
                    '<span class="list-wait">' + esc(store.elapsed(p.registered)) + '</span>' +
                '</span>' +
            '</div>';
        }).join('');
    }

    /* ==================================================================
       Department load
       ================================================================== */
    function renderDeptLoad() {
        var host = byId('deptLoad');
        if (!host) return;

        var openNurse = 0;
        var unreviewed = 0;
        patients.forEach(function (p) {
            openNurse += (p.nurseOrders || []).filter(store.isOrderOpen).length;
            unreviewed += store.unreviewedResults(p).length;
        });

        var rows = [
            { label: 'Triage queue', value: store.queueOrder(patients).length, max: 12, icon: 'queue', target: 'pages/queue.html' },
            { label: 'Consultation', value: store.consultingPatients(patients).length, max: 6, icon: 'stethoscope', target: 'pages/track.html' },
            { label: 'Laboratory', value: labs.filter(function (l) { return l.status !== 'Completed'; }).length, max: 15, icon: 'lab', target: 'pages/laboratory.html' },
            { label: 'Nursing', value: openNurse, max: 12, icon: 'nurse', target: 'pages/nurse.html' },
            { label: 'Pharmacy', value: scripts.filter(function (r) { return r.status !== 'Dispensed'; }).length, max: 12, icon: 'pill', target: 'pages/pharmacy.html' },
            { label: 'Unreviewed results', value: unreviewed, max: 8, icon: 'file-text', target: 'pages/track.html' }
        ];

        host.innerHTML = rows.map(function (r) {
            var pct = r.max ? Math.min(100, Math.round((r.value / r.max) * 100)) : 0;
            var tone = pct >= 80 ? 'high' : (pct >= 45 ? 'mid' : 'low');
            return '<button type="button" class="dept-row" data-go="' + r.target + '">' +
                '<span class="dept-icon">' + icon(r.icon, 15) + '</span>' +
                '<span class="dept-body">' +
                    '<span class="dept-top">' +
                        '<span class="dept-label">' + esc(r.label) + '</span>' +
                        '<span class="dept-value">' + r.value + '</span>' +
                    '</span>' +
                    '<span class="dept-bar"><span class="dept-fill tone-' + tone + '" style="width:' + pct + '%"></span></span>' +
                '</span>' +
            '</button>';
        }).join('');

        bindGo(host);
    }

    /* ==================================================================
       Triage mix
       ================================================================== */
    function renderTriageMix() {
        var host = byId('triageMix');
        if (!host) return;

        var active = store.activePatients(patients);
        var counts = { Emergency: 0, Urgent: 0, Routine: 0 };
        active.forEach(function (p) { counts[store.normalizeUrgency(p.urgency)]++; });
        var total = active.length;

        if (!total) {
            host.innerHTML = ui.emptyState({
                icon: 'patients',
                title: 'No active patients',
                text: 'The triage mix appears once patients are in the department.'
            });
            return;
        }

        host.innerHTML = ['Emergency', 'Urgent', 'Routine'].map(function (key) {
            var n = counts[key];
            var pct = Math.round((n / total) * 100);
            return '<div class="mix-row">' +
                '<span class="mix-label">' +
                    '<span class="mix-dot ' + urgencyClass(key) + '" aria-hidden="true"></span>' +
                    '<span>' + esc(key) + '</span>' +
                '</span>' +
                '<span class="mix-bar"><span class="mix-fill ' + urgencyClass(key) + '" style="width:' + pct + '%"></span></span>' +
                '<span class="mix-value">' + n + '<small>' + pct + '%</small></span>' +
            '</div>';
        }).join('');
    }

    /* ==================================================================
       Recent activity
       ================================================================== */
    function renderActivity() {
        var host = byId('activityList');
        if (!host) return;

        var events = [];

        patients.forEach(function (p) {
            (p.clinicalNotes || []).forEach(function (n) {
                events.push({
                    time: n.time,
                    icon: 'edit',
                    tone: 'neutral',
                    title: n.diagnosis ? 'Diagnosis: ' + n.diagnosis : 'Clinical note recorded',
                    who: p.name,
                    by: n.doctor
                });
            });

            (p.labOrders || []).forEach(function (o) {
                if (o.status === 'Completed') {
                    var flag = String(o.flag || '').toLowerCase();
                    events.push({
                        time: o.completedAt || o.time,
                        icon: 'vial',
                        tone: flag === 'critical' ? 'critical' : (flag === 'abnormal' ? 'warning' : 'info'),
                        title: (flag === 'critical' ? 'Critical result: ' : (flag === 'abnormal' ? 'Abnormal result: ' : 'Result released: ')) + o.test,
                        who: p.name,
                        by: o.technician
                    });
                } else {
                    events.push({
                        time: o.time,
                        icon: 'lab',
                        tone: 'info',
                        title: 'Lab requested: ' + o.test,
                        who: p.name,
                        by: o.doctor
                    });
                }
            });

            (p.nurseOrders || []).forEach(function (o) {
                events.push({
                    time: o.completedAt || o.time,
                    icon: 'nurse',
                    tone: 'neutral',
                    title: (store.isOrderOpen(o) ? 'Nursing order: ' : 'Nursing completed: ') + o.task,
                    who: p.name,
                    by: o.completedBy || o.doctor
                });
            });

            (p.prescriptions || []).forEach(function (o) {
                events.push({
                    time: o.dispensedAt || o.time,
                    icon: 'pill',
                    tone: 'neutral',
                    title: (o.status === 'Dispensed' ? 'Dispensed: ' : 'Prescribed: ') + o.medication,
                    who: p.name,
                    by: o.dispensedBy || o.doctor
                });
            });
        });

        events = events.filter(function (e) { return e.time; });
        events.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });

        if (!events.length) {
            host.innerHTML = ui.emptyState({
                icon: 'clock',
                title: 'No clinical activity yet',
                text: 'Notes, orders and released results appear here as departments work.'
            });
            return;
        }

        host.innerHTML = events.slice(0, 10).map(function (e) {
            return '<div class="activity-item tone-' + e.tone + '">' +
                '<span class="act-icon">' + icon(e.icon, 14) + '</span>' +
                '<span class="act-body">' +
                    '<span class="act-title">' + esc(e.title) + '</span>' +
                    '<span class="act-meta">' + esc(e.who) +
                        (e.by ? ' · ' + esc(e.by) : '') + '</span>' +
                '</span>' +
                '<span class="act-time">' + esc(store.relativeTime(e.time)) + '</span>' +
            '</div>';
        }).join('');
    }

    /* ==================================================================
       Navigation
       ================================================================== */
    function bindGo(root) {
        ui.qsa('[data-go]', root).forEach(function (el) {
            if (el.getAttribute('data-go-bound') === '1') return;
            el.setAttribute('data-go-bound', '1');
            el.addEventListener('click', function () {
                store.navigate(el.getAttribute('data-go'));
            });
        });
    }

    /* ==================================================================
       Init
       ================================================================== */
    function init() {
        setText('dashDate', new Date().toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric'
        }));

        load();
        bindGo(document);

        store.onPatientsChanged(load);
        window.addEventListener('storage', load);
        /* Waiting times drift, so the figures are refreshed periodically. */
        setInterval(load, 45000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
