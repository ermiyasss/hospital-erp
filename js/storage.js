/* ==========================================================================
   MediTrack Hospital ERP - Records Archive

   Completed visits only. A dense table rather than cards: this screen is used
   to find one record among many, not to browse.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var clinical = window.MediClinical;

    var archived = [];
    var searchTerm = '';
    var urgencyFilter = '';
    var periodFilter = 'all';
    var sortOrder = 'date_desc';
    var detailId = null;

    function esc(s) { return store.escapeHtml(s); }
    function byId(id) { return document.getElementById(id); }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value === null || value === undefined || value === '' ? '—' : value;
    }

    function urgencyClass(u) {
        return 'urgency-' + String(store.normalizeUrgency(u)).toLowerCase();
    }

    /* Discharge time falls back to registration on legacy records. */
    function dischargedAt(p) { return p.completedAt || p.registered; }

    function stayMinutes(p) {
        var start = new Date(p.registered);
        var end = new Date(dischargedAt(p));
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
        return Math.max(0, Math.round((end - start) / 60000));
    }

    function latestDiagnosis(p) {
        var notes = p.clinicalNotes || [];
        for (var i = notes.length - 1; i >= 0; i--) {
            if (notes[i].diagnosis) return notes[i].diagnosis;
        }
        return null;
    }

    /* ==================================================================
       Load
       ================================================================== */
    function load() {
        archived = store.readPatients().filter(function (p) {
            return p.status === store.STATUS.FINISHED;
        });
        render();
    }

    /* ==================================================================
       Render
       ================================================================== */
    function render() {
        renderStats();

        var rows = archived.filter(function (p) {
            if (urgencyFilter && store.normalizeUrgency(p.urgency) !== urgencyFilter) return false;
            if (!withinPeriod(p)) return false;
            if (!searchTerm) return true;
            var q = searchTerm.toLowerCase();
            return [p.name, p.trackingId, p.phone, latestDiagnosis(p), p.description].some(function (f) {
                return String(f || '').toLowerCase().indexOf(q) !== -1;
            });
        });

        rows.sort(comparator(sortOrder));

        setText('archiveResultCount', rows.length + (rows.length === 1 ? ' record' : ' records'));

        var body = byId('archiveTableBody');
        var emptyHost = byId('archiveEmptyHost');
        var table = byId('archiveTable');
        if (!body) return;

        if (!rows.length) {
            body.innerHTML = '';
            if (table) table.hidden = true;
            if (emptyHost) {
                emptyHost.innerHTML = ui.emptyState({
                    icon: archived.length ? 'search' : 'layers',
                    title: archived.length ? 'No records match these filters' : 'The archive is empty',
                    text: archived.length
                        ? 'Widen the date range or clear the search to see more records.'
                        : 'Visits are archived here once a clinician completes the consultation.'
                });
            }
            return;
        }

        if (table) table.hidden = false;
        if (emptyHost) emptyHost.innerHTML = '';

        body.innerHTML = rows.map(function (p) {
            var urgency = store.normalizeUrgency(p.urgency);
            var mins = stayMinutes(p);
            var dx = latestDiagnosis(p);

            return '<tr data-id="' + esc(p.id) + '">' +
                '<td>' +
                    '<div class="cell-patient">' +
                        '<span class="avatar-sq ' + urgencyClass(urgency) + '">' + esc(store.initials(p.name)) + '</span>' +
                        '<div class="cell-patient-text">' +
                            '<span class="cell-name">' + esc(p.name) + '</span>' +
                            '<span class="cell-meta">' +
                                (p.age !== null ? esc(p.age) + ' yrs' : '—') +
                                (p.sex ? ' · ' + esc(p.sex) : '') +
                                (p.phone ? ' · ' + esc(p.phone) : '') +
                            '</span>' +
                        '</div>' +
                    '</div>' +
                '</td>' +
                '<td><span class="mono">' + esc(p.trackingId) + '</span></td>' +
                '<td><span class="badge ' + urgencyClass(urgency) + '">' + esc(urgency) + '</span></td>' +
                '<td><span class="cell-dx">' + esc(dx || p.description || '—') + '</span></td>' +
                '<td>' + esc(store.formatDateTime(dischargedAt(p))) + '</td>' +
                '<td class="num">' + esc(mins === null ? '—' : formatStay(mins)) + '</td>' +
                '<td class="num">' +
                    '<button type="button" class="btn-secondary btn-sm" data-view="' + esc(p.id) + '">' +
                        ui.icon('eye', 14) + '<span>Open</span>' +
                    '</button>' +
                '</td>' +
            '</tr>';
        }).join('');

        ui.qsa('[data-view]', body).forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                openDetail(btn.getAttribute('data-view'));
            });
        });
        ui.qsa('tr[data-id]', body).forEach(function (tr) {
            tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-id')); });
        });
    }

    function withinPeriod(p) {
        if (periodFilter === 'all') return true;
        var when = new Date(dischargedAt(p));
        if (isNaN(when.getTime())) return false;

        if (periodFilter === 'today') {
            var now = new Date();
            return when.getFullYear() === now.getFullYear() &&
                when.getMonth() === now.getMonth() &&
                when.getDate() === now.getDate();
        }
        var days = Number(periodFilter);
        return (Date.now() - when.getTime()) <= days * 86400000;
    }

    function comparator(mode) {
        return function (a, b) {
            switch (mode) {
                case 'date_asc': return new Date(dischargedAt(a)) - new Date(dischargedAt(b));
                case 'name_asc': return String(a.name).localeCompare(String(b.name));
                case 'stay_desc': return (stayMinutes(b) || 0) - (stayMinutes(a) || 0);
                default: return new Date(dischargedAt(b)) - new Date(dischargedAt(a));
            }
        };
    }

    function formatStay(mins) {
        if (mins < 60) return mins + 'm';
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        return m ? h + 'h ' + m + 'm' : h + 'h';
    }

    function renderStats() {
        var counts = { Emergency: 0, Urgent: 0, Routine: 0 };
        var stays = [];

        archived.forEach(function (p) {
            counts[store.normalizeUrgency(p.urgency)]++;
            var m = stayMinutes(p);
            if (m !== null) stays.push(m);
        });

        setText('totalArchivedCount', archived.length);
        setText('emergencyArchivedCount', counts.Emergency);
        setText('urgentArchivedCount', counts.Urgent);
        setText('routineArchivedCount', counts.Routine);

        /* Median, not mean: one very long stay should not distort the figure. */
        if (!stays.length) {
            setText('medianStayValue', '—');
            return;
        }
        stays.sort(function (a, b) { return a - b; });
        var mid = Math.floor(stays.length / 2);
        var median = stays.length % 2 ? stays[mid] : Math.round((stays[mid - 1] + stays[mid]) / 2);
        setText('medianStayValue', formatStay(median));
    }

    /* ==================================================================
       Detail
       ================================================================== */
    function openDetail(id) {
        var p = store.findPatient(archived, id);
        if (!p) return;
        detailId = p.id;

        var urgency = store.normalizeUrgency(p.urgency);
        var assessment = clinical.assess(p.vitals);
        var b = store.bmi(p.vitals.weight, p.vitals.height);
        var mins = stayMinutes(p);

        setText('archiveModalTitle', p.name);
        setText('archiveModalSub', p.trackingId + ' · discharged ' + store.formatDateTime(dischargedAt(p)));

        var vitals = assessment.results.length
            ? '<div class="rec-vitals">' + assessment.results.map(function (r) {
                var unit = r.key === 'bloodPressure' ? 'mmHg' : r.unit;
                return '<div class="rec-vital level-' + r.level + '">' +
                    '<span class="rv-label">' + esc(r.label) + '</span>' +
                    '<span class="rv-value">' + esc(r.display) + '<small>' + esc(unit) + '</small></span>' +
                    '<span class="rv-state">' + esc(r.levelLabel) + '</span>' +
                '</div>';
              }).join('') + '</div>'
            : '<p class="rec-empty">No observations were recorded for this visit.</p>';

        /* The printed sheet only contains #archiveModalBody, so the patient
           name travels inside it as a record header. */
        byId('archiveModalBody').innerHTML =
            '<div class="record-print-head">' +
                '<h2>' + esc(p.name) + '</h2>' +
                '<span>' + esc(p.trackingId) +
                    ' · discharged ' + esc(store.formatDateTime(dischargedAt(p))) +
                    (p.phone ? ' · ' + esc(p.phone) : '') + '</span>' +
            '</div>' +
            '<div class="detail-badges">' +
                '<span class="badge ' + urgencyClass(urgency) + '">' + esc(urgency) + '</span>' +
                '<span class="badge status-finished">Completed</span>' +
                (assessment.flagged.length
                    ? '<span class="badge ' + (assessment.overall === 'critical' ? 'status-critical' : 'status-awaiting') + '">' +
                      esc(assessment.overallLabel) + ' vitals at triage</span>'
                    : '') +
            '</div>' +

            '<dl class="detail-grid">' +
                item('Age', p.age === null ? '—' : p.age + ' years') +
                item('Sex', p.sex || '—') +
                item('Phone', p.phone || '—') +
                item('Registered', store.formatDateTime(p.registered)) +
                item('Discharged', store.formatDateTime(dischargedAt(p))) +
                item('Time in department', mins === null ? '—' : formatStay(mins)) +
                item('BMI at triage', b ? b.value + ' (' + b.category + ')' : '—') +
                item('Diagnosis', latestDiagnosis(p) || 'Not recorded') +
            '</dl>' +

            block('Presenting complaint', '<p class="rec-text">' + esc(p.description || 'Not recorded.') + '</p>') +
            block('Observations at triage', vitals) +
            block('Clinical notes', notesHtml(p)) +
            block('Diagnostics', ordersHtml(p.labOrders, 'lab')) +
            block('Nursing', ordersHtml(p.nurseOrders, 'nurse')) +
            block('Medication', ordersHtml(p.prescriptions, 'rx'));

        if (window.MediIcons) window.MediIcons.hydrate(byId('archiveModalBody'));
        ui.openModal('archiveDetailModal');
    }

    function item(label, value) {
        return '<div class="detail-item"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
    }

    function block(title, body) {
        return '<section class="rec-section">' +
            '<h4 class="rec-section-title">' + esc(title) + '</h4>' + body +
        '</section>';
    }

    function notesHtml(p) {
        var notes = p.clinicalNotes || [];
        if (!notes.length) return '<p class="rec-empty">No clinical notes were recorded.</p>';
        return '<div class="history-list">' + notes.map(function (n) {
            return '<div class="history-item">' +
                '<div class="history-item-head">' +
                    '<strong class="history-item-title">' + esc(n.diagnosis || 'Clinical note') + '</strong>' +
                    '<span class="history-item-time">' + esc(store.formatDateTime(n.time)) + '</span>' +
                '</div>' +
                '<div class="history-item-body">' + esc(n.note) + '</div>' +
                (n.doctor ? '<div class="history-item-time">' + esc(n.doctor) + '</div>' : '') +
            '</div>';
        }).join('') + '</div>';
    }

    function ordersHtml(list, kind) {
        var orders = list || [];
        if (!orders.length) {
            return '<p class="rec-empty">None ordered during this visit.</p>';
        }
        return '<div class="history-list">' + orders.map(function (o) {
            var title = kind === 'lab' ? o.test
                : (kind === 'nurse' ? o.task
                : (o.medication || 'Medication') + (o.dosage ? ' ' + o.dosage : ''));

            var body = kind === 'lab' ? ('Instructions: ' + (o.note || '—'))
                : (kind === 'nurse' ? ('Instructions: ' + (o.note || '—'))
                : [o.frequency, o.route, o.duration].filter(Boolean).join(' · '));

            var flag = String(o.flag || '').toLowerCase();

            return '<div class="history-item ' + (store.isOrderOpen(o) ? 'is-open' : 'is-complete') +
                    (flag === 'critical' ? ' is-critical' : '') + '">' +
                '<div class="history-item-head">' +
                    '<strong class="history-item-title">' + esc(title || 'Order') + '</strong>' +
                    '<span class="badge ' + (store.isOrderOpen(o) ? 'status-awaiting' : 'status-finished') + '">' +
                        esc(o.status || 'Completed') +
                    '</span>' +
                '</div>' +
                '<div class="history-item-body">' + esc(body || '—') + '</div>' +
                (o.results ? '<div class="history-item-result">' + esc(o.results) + '</div>' : '') +
                (o.outcome ? '<div class="history-item-result">' + esc(o.outcome) + '</div>' : '') +
            '</div>';
        }).join('') + '</div>';
    }

    /* ==================================================================
        Export
        ================================================================== */
    function exportRecords() {
        var rows = archived.filter(function (p) {
            if (urgencyFilter && store.normalizeUrgency(p.urgency) !== urgencyFilter) return false;
            return withinPeriod(p);
        });

        if (!rows.length) {
            window.MediTrackNotify.flash(
                'Nothing to export',
                'No archived records match the current filters.',
                'warning'
            );
            return;
        }

        var name = 'MediTrack_Archive_' + new Date().toISOString().slice(0, 10) + '.xls';

        ui.downloadExcel({
            filename: name,
            sheetName: 'Past visits',
            title: 'MediTrack — Past visit records',
            headers: ['Tracking ID', 'Name', 'Age', 'Sex', 'Phone', 'Priority', 'Diagnosis',
                'Complaint', 'BP', 'Pulse', 'Temperature', 'SpO2', 'Registered', 'Discharged', 'Stay (minutes)'],
            rows: rows.map(function (p) {
                return [
                    p.trackingId, p.name, p.age, p.sex, p.phone,
                    store.normalizeUrgency(p.urgency),
                    latestDiagnosis(p) || '',
                    p.description || '',
                    store.bloodPressureText(p.vitals),
                    p.vitals.pulse, p.vitals.temperature, p.vitals.spo2,
                    store.formatDateTime(p.registered),
                    store.formatDateTime(dischargedAt(p)),
                    stayMinutes(p)
                ];
            })
        });

        window.MediTrackNotify.flash('Export ready', rows.length + ' records written to ' + name + '.');
    }

    /* ==================================================================
       Init
       ================================================================== */
    function init() {
        load();

        ui.initSelect('filterUrgencyWrapper', function (v) { urgencyFilter = v; render(); });
        ui.initSelect('filterPeriodWrapper', function (v) { periodFilter = v; render(); });
        ui.initSelect('sortWrapper', function (v) { sortOrder = v; render(); });

        var search = byId('storageSearch');
        var clear = byId('storageSearchClear');
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
                periodFilter = 'all';
                sortOrder = 'date_desc';
                if (search) search.value = '';
                if (clear) clear.classList.remove('visible');
                ui.setSelectValue('filterUrgencyWrapper', '', 'All priorities');
                ui.setSelectValue('filterPeriodWrapper', 'all', 'All time');
                ui.setSelectValue('sortWrapper', 'date_desc', 'Newest first');
                render();
            });
        }

        var exportBtn = byId('exportCsvBtn');
        if (exportBtn) exportBtn.addEventListener('click', exportRecords);

        var printSummary = byId('printSummaryBtn');
        if (printSummary) printSummary.addEventListener('click', function () { ui.printNode('archiveTableCard'); });

        var printRecord = byId('printRecordBtn');
        if (printRecord) printRecord.addEventListener('click', function () { ui.printNode('archiveModalBody'); });

        store.onPatientsChanged(load);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
