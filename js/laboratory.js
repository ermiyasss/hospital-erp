/* ==========================================================================
   MediTrack Hospital ERP - Laboratory

   Two responsibilities:
     - work the analysis queue (requested -> in progress -> released)
     - classify each released result, because that classification is what
       decides whether the clinician is interrupted.

   Results are written back to both the global lab list and the patient record
   so the consultation desk workbench stays accurate.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;

    var active = [];      /* not yet released */
    var archive = [];     /* released */
    var currentTab = 'active';

    var searchTerm = '';
    var statusFilter = '';
    var priorityFilter = '';

    var editingId = null;
    var resultFlag = 'Normal';

    /* The signed-in staff member is the default technologist; the name is
       confirmed (or corrected) on every result. */
    function currentStaffName() {
        try {
            var s = window.MediSession && window.MediSession.read();
            if (s && s.name) return s.name;
        } catch (e) {}
        return '';
    }

    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }
    function byId(id) { return document.getElementById(id); }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value === null || value === undefined || value === '' ? '—' : value;
    }

    function isStat(order) {
        var p = String(order.priority || '').toLowerCase();
        return p === 'stat' || p === 'urgent';
    }

    /* ==================================================================
       Load / save
       ================================================================== */
    function load() {
        var all = store.read(store.KEYS.labRequests);
        var archived = store.read(store.KEYS.labArchive);

        /* Released orders belong in the archive, wherever they were written. */
        var open = [];
        all.forEach(function (o) {
            if (String(o.status) === 'Completed') {
                if (!archived.some(function (a) { return String(a.id) === String(o.id); })) archived.unshift(o);
            } else {
                open.push(o);
            }
        });

        active = open;
        archive = archived;
        save();
        render();
    }

    function save() {
        store.write(store.KEYS.labRequests, active);
        store.write(store.KEYS.labArchive, archive);
    }

    function findOrder(id) {
        var hit = null;
        active.concat(archive).forEach(function (o) {
            if (String(o.id) === String(id)) hit = o;
        });
        return hit;
    }

    /* The patient record is the clinical source of truth for the workbench. */
    function syncToPatient(order) {
        var patients = store.readPatients();
        var p = store.findPatient(patients, order.patientId);
        if (!p && order.trackingId) {
            patients.forEach(function (x) { if (x.trackingId === order.trackingId) p = x; });
        }
        if (!p) return;

        var existing = null;
        (p.labOrders || []).forEach(function (o) {
            if (String(o.id) === String(order.id)) existing = o;
        });

        if (existing) {
            existing.status = order.status;
            existing.results = order.results;
            existing.techRemarks = order.techRemarks;
            existing.flag = order.flag;
            existing.completedAt = order.completedAt;
            if (order.status === 'Completed') existing.reviewed = false;
        } else {
            p.labOrders.push(order);
        }

        /* Once nothing is outstanding the patient is ready to be seen again. */
        if (order.status === 'Completed' &&
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
        var statCount = active.filter(isStat).length;

        setText('labActiveCount', active.length);
        setText('labCompletedCount', archive.length);
        setText('tabActiveCount', active.length);
        setText('tabArchiveCount', archive.length);

        var statPill = byId('labStatPill');
        if (statPill) {
            statPill.hidden = statCount === 0;
            setText('labStatCount', statCount);
        }

        var source = currentTab === 'active' ? active : archive;

        var rows = source.filter(function (o) {
            if (statusFilter && o.status !== statusFilter) return false;
            if (priorityFilter && String(o.priority) !== priorityFilter) return false;
            if (!searchTerm) return true;
            var q = searchTerm.toLowerCase();
            return [o.patientName, o.trackingId, o.test, o.doctor].some(function (f) {
                return String(f || '').toLowerCase().indexOf(q) !== -1;
            });
        });

        /* STAT first, then oldest, so the queue reads as a worklist. */
        rows.sort(function (a, b) {
            if (currentTab === 'active') {
                var d = (isStat(b) ? 1 : 0) - (isStat(a) ? 1 : 0);
                if (d !== 0) return d;
                return new Date(a.time) - new Date(b.time);
            }
            return new Date(b.completedAt || b.time) - new Date(a.completedAt || a.time);
        });

        var grid = byId('labCardGrid');
        if (!grid) return;

        if (!rows.length) {
            grid.innerHTML = ui.emptyState({
                icon: currentTab === 'active' ? 'check-circle' : 'layers',
                title: currentTab === 'active' ? 'No open requests' : 'No released results',
                text: currentTab === 'active'
                    ? 'Requests appear here the moment a clinician sends them from the consultation desk.'
                    : 'Released results are archived here with their full report.'
            });
            return;
        }

        grid.innerHTML = rows.map(cardHtml).join('');
        bindCards(grid);
    }

    function cardHtml(o) {
        var flag = String(o.flag || '').toLowerCase();
        var stat = isStat(o);
        var frame = flag === 'critical' ? ' is-critical' : (stat && o.status !== 'Completed' ? ' is-stat' : '');

        var statusBadge = o.status === 'Completed'
            ? '<span class="badge status-finished">Released</span>'
            : (o.status === 'In Progress'
                ? '<span class="badge status-consulting">In progress</span>'
                : '<span class="badge status-pending">Requested</span>');

        var priorityBadge = stat
            ? '<span class="badge ' + (String(o.priority).toLowerCase() === 'stat' ? 'status-critical' : 'urgency-urgent') + '">' +
              esc(o.priority) + '</span>'
            : '<span class="badge urgency-routine">Routine</span>';

        var actions;
        if (o.status === 'Requested') {
            actions =
                '<button type="button" class="btn-secondary btn-sm" data-start="' + esc(o.id) + '">' +
                    icon('play', 14) + '<span>Start analysis</span>' +
                '</button>' +
                '<button type="button" class="btn-primary btn-sm" data-enter="' + esc(o.id) + '">' +
                    icon('edit', 14) + '<span>Enter results</span>' +
                '</button>';
        } else if (o.status === 'In Progress') {
            actions =
                '<button type="button" class="btn-primary btn-sm" data-enter="' + esc(o.id) + '">' +
                    icon('edit', 14) + '<span>Enter results</span>' +
                '</button>';
        } else {
            actions =
                '<button type="button" class="btn-secondary btn-sm" data-amend="' + esc(o.id) + '">' +
                    icon('edit', 14) + '<span>Amend</span>' +
                '</button>' +
                '<button type="button" class="btn-primary btn-sm" data-report="' + esc(o.id) + '">' +
                    icon('file-text', 14) + '<span>Report</span>' +
                '</button>';
        }

        return '<article class="lab-card' + frame + '">' +
            '<header class="lc-head">' +
                '<div class="lc-identity">' +
                    '<span class="lc-name">' + esc(o.patientName) + '</span>' +
                    '<span class="lc-sub">' +
                        '<span class="mono">' + esc(o.trackingId) + '</span>' +
                        (o.age ? '<span>' + esc(o.age) + ' yrs</span>' : '') +
                        (o.doctor ? '<span>' + icon('stethoscope', 11) + ' ' + esc(o.doctor) + '</span>' : '') +
                        (o.status === 'Completed' && o.technician
                            ? '<span>' + icon('user', 11) + ' ' + esc(o.technician) + '</span>' : '') +
                    '</span>' +
                '</div>' +
                '<div class="lc-badges">' + statusBadge + priorityBadge + '</div>' +
            '</header>' +

            '<div class="lc-test">' +
                '<span class="lc-test-label">Investigation</span>' +
                '<strong>' + esc(o.test) + '</strong>' +
            '</div>' +

            (o.note
                ? '<div class="lc-note">' + icon('file-text', 13) +
                  '<span><strong>Clinician:</strong> ' + esc(o.note) + '</span></div>'
                : '') +

            (o.results
                ? '<div class="lc-result' + (flag === 'critical' ? ' is-critical' : (flag === 'abnormal' ? ' is-abnormal' : '')) + '">' +
                    '<span class="lc-result-label">' +
                        (flag === 'critical' ? 'Critical result' : (flag === 'abnormal' ? 'Abnormal result' : 'Findings')) +
                    '</span>' +
                    '<span>' + esc(o.results) + '</span>' +
                  '</div>'
                : '') +

            '<footer class="lc-foot">' +
                '<span class="lc-time">' + icon('clock', 13) +
                    '<span>' + esc(o.status === 'Completed'
                        ? 'Released ' + store.relativeTime(o.completedAt || o.time)
                        : 'Waiting ' + store.elapsed(o.time)) + '</span>' +
                '</span>' +
                '<div class="lc-actions">' + actions + '</div>' +
            '</footer>' +
        '</article>';
    }

    function bindCards(grid) {
        ui.qsa('[data-start]', grid).forEach(function (b) {
            b.addEventListener('click', function () { startAnalysis(b.getAttribute('data-start')); });
        });
        ui.qsa('[data-enter]', grid).forEach(function (b) {
            b.addEventListener('click', function () { openResultModal(b.getAttribute('data-enter')); });
        });
        ui.qsa('[data-amend]', grid).forEach(function (b) {
            b.addEventListener('click', function () { openResultModal(b.getAttribute('data-amend')); });
        });
        ui.qsa('[data-report]', grid).forEach(function (b) {
            b.addEventListener('click', function () { openReport(b.getAttribute('data-report')); });
        });
    }

    /* ==================================================================
       Actions
       ================================================================== */
    function startAnalysis(id) {
        var o = findOrder(id);
        if (!o) return;
        o.status = 'In Progress';
        o.startedAt = new Date().toISOString();
        save();
        syncToPatient(o);
        render();
        window.MediTrackNotify.flash('Analysis started', o.test + ' for ' + o.patientName + '.');
    }

    function openResultModal(id) {
        var o = findOrder(id);
        if (!o) return;
        editingId = o.id;

        setText('resPatientName', o.patientName);
        setText('resTrackingId', o.trackingId);
        setText('resPriority', o.priority);
        setText('resDoctor', o.doctor);
        setText('resTestName', o.test);
        setText('resDoctorNote', o.note || 'No specific instructions given.');

        byId('inputTestResults').value = o.results || '';
        byId('inputTechRemarks').value = o.techRemarks || '';
        byId('inputTechName').value = o.technician || currentStaffName();
        ui.clearFieldError('inputTestResults');
        ui.clearFieldError('inputTechName');

        setFlag(o.flag || 'Normal');
        ui.openModal('resultModal');
    }

    function setFlag(flag) {
        resultFlag = flag;
        ui.qsa('#resultFlagChips [data-flag]').forEach(function (chip) {
            chip.classList.toggle('active', chip.getAttribute('data-flag') === flag);
        });

        var hint = byId('flagHint');
        if (!hint) return;
        if (flag === 'Critical') {
            hint.textContent = 'Critical results raise a sticky alert that stays until the clinician acknowledges it.';
        } else if (flag === 'Abnormal') {
            hint.textContent = 'Abnormal results alert the requesting clinician and are listed first in their review queue.';
        } else {
            hint.textContent = 'Within range results are logged without interrupting the clinician.';
        }
    }

    function releaseResult() {
        var o = findOrder(editingId);
        if (!o) return;

        if (!ui.requireFields([
            { id: 'inputTechName', message: 'Enter the name of the technologist who performed the test.' },
            { id: 'inputTestResults', message: 'Record the test values before releasing the result.' }
        ])) return;

        var reReleasing = o.status === 'Completed';

        o.results = byId('inputTestResults').value.trim();
        o.techRemarks = byId('inputTechRemarks').value.trim();
        o.flag = resultFlag;
        o.status = 'Completed';
        o.completedAt = new Date().toISOString();
        o.technician = byId('inputTechName').value.trim() || currentStaffName();

        active = active.filter(function (x) { return String(x.id) !== String(o.id); });
        if (!archive.some(function (a) { return String(a.id) === String(o.id); })) archive.unshift(o);

        save();
        syncToPatient(o);
        ui.closeModal('resultModal');
        render();

        if (resultFlag === 'Critical') {
            window.MediTrackNotify.event('lab.result.critical', {
                key: 'labresult:' + o.id,
                title: 'Critical Lab Result',
                message: o.test + ' for ' + o.patientName + ' (' + o.trackingId +
                         ') returned a panic value. Immediate clinician review required.'
            });
        } else if (resultFlag === 'Abnormal') {
            window.MediTrackNotify.event('lab.result.ready', {
                key: 'labresult:' + o.id,
                title: 'Abnormal Lab Result',
                message: o.test + ' for ' + o.patientName + ' is outside the reference range and ready for review.',
                type: 'warning'
            });
        } else {
            window.MediTrackNotify.event('lab.result.ready', {
                key: 'labresult:' + o.id,
                title: reReleasing ? 'Result Amended' : 'Lab Result Released',
                message: o.test + ' for ' + o.patientName + ' is ready for review.'
            });
        }
    }

    function openReport(id) {
        var o = findOrder(id);
        if (!o) return;

        var flag = String(o.flag || 'Normal');
        setText('repPatientName', o.patientName);
        setText('repTrackingId', o.trackingId);
        setText('repAgePhone', (o.age ? o.age + ' yrs' : '—') + ' · ' + (o.phone || '—'));
        setText('repDoctor', o.doctor);
        setText('repRequested', store.formatDateTime(o.time));
        setText('repReleased', store.formatDateTime(o.completedAt));
        setText('repTestName', o.test);
        setText('repResultsContent', o.results || 'No values recorded.');

        var flagEl = byId('repFlag');
        if (flagEl) {
            flagEl.textContent = flag === 'Normal' ? 'Within range' : flag;
            flagEl.className = 'report-flag flag-' + flag.toLowerCase();
        }

        var wrap = byId('repRemarksWrap');
        if (wrap) {
            wrap.hidden = !o.techRemarks;
            setText('repRemarksContent', o.techRemarks || '');
        }

        setText('repTechName', o.technician
            ? 'Performed & authorised by ' + o.technician
            : 'Authorised medical technologist');

        ui.openModal('reportModal');
    }

    /* ==================================================================
       Init
       ================================================================== */
    function init() {
        load();

        ui.initTabs({
            buttonSelector: '[data-labtab]',
            panelSelector: '.tab-panel',
            attribute: 'data-labtab',
            onChange: function (value) {
                currentTab = value;
                render();
            }
        });

        ui.initSelect('filterStatusWrapper', function (v) { statusFilter = v; render(); });
        ui.initSelect('filterPriorityWrapper', function (v) { priorityFilter = v; render(); });
        ui.bindLiveValidation(['inputTestResults', 'inputTechName']);

        var chips = byId('resultFlagChips');
        if (chips) {
            chips.addEventListener('click', function (e) {
                var chip = e.target.closest ? e.target.closest('[data-flag]') : null;
                if (chip) setFlag(chip.getAttribute('data-flag'));
            });
        }

        var saveBtn = byId('saveResultBtn');
        if (saveBtn) saveBtn.addEventListener('click', releaseResult);

        var printBtn = byId('printReportBtn');
        if (printBtn) printBtn.addEventListener('click', function () { ui.printNode('reportPrintArea'); });

        var search = byId('labSearch');
        var clear = byId('labSearchClear');
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
                statusFilter = '';
                priorityFilter = '';
                if (search) search.value = '';
                if (clear) clear.classList.remove('visible');
                ui.setSelectValue('filterStatusWrapper', '', 'All statuses');
                ui.setSelectValue('filterPriorityWrapper', '', 'All priorities');
                render();
            });
        }

        window.addEventListener('storage', function (e) {
            if (!e.key || e.key === store.KEYS.labRequests || e.key === store.KEYS.labArchive) load();
        });
        window.addEventListener('meditrack:patients-updated', load);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
