/* ==========================================================================
   MediTrack Hospital ERP - Patient Registry

   Registration is where triage quality is decided, so this screen does two
   things the old version did not:

     - it interprets the observations as they are typed (js/clinical.js) and
     - it challenges the operator when the recorded priority is lower than the
       observations suggest.

   All data access goes through js/store.js, so field names, urgency spellings
   and statuses stay canonical.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var clinical = window.MediClinical;
    var STATUS = store.STATUS;

    var patients = [];
    var searchTerm = '';
    var urgencyFilter = '';
    var statusFilter = 'active';
    var sortOrder = 'reg_desc';

    var editingId = null;       /* null = registering a new patient */
    var detailId = null;
    var suggestedUrgency = null;

    var VITAL_FIELDS = [
        ['inputSystolic', 'systolic'],
        ['inputDiastolic', 'diastolic'],
        ['inputTemp', 'temperature'],
        ['inputWeight', 'weight'],
        ['inputHeight', 'height']
    ];

    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }
    function byId(id) { return document.getElementById(id); }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value;
    }

    function val(id) {
        var el = byId(id);
        return el ? el.value.trim() : '';
    }

    function urgencyClass(u) {
        return 'urgency-' + String(store.normalizeUrgency(u)).toLowerCase();
    }

    function statusClass(s) {
        switch (store.normalizeStatus(s)) {
            case STATUS.CONSULTING:        return 'status-consulting';
            case STATUS.AWAITING:          return 'status-awaiting';
            case STATUS.AWAITING_PAYMENT:  return 'status-awaiting-payment';
            case STATUS.FINISHED:          return 'status-finished';
            default:                       return 'status-pending';
        }
    }

    /* ==================================================================
       List
       ================================================================== */
    function render() {
        setText('statTotal', patients.length);
        setText('statActive', store.activePatients(patients).length);

        var rows = patients.filter(function (p) {
            if (statusFilter === 'active' && p.status === STATUS.FINISHED) return false;
            if (statusFilter !== 'active' && statusFilter !== 'all' && p.status !== statusFilter) return false;
            if (urgencyFilter && store.normalizeUrgency(p.urgency) !== urgencyFilter) return false;
            if (!searchTerm) return true;
            var q = searchTerm.toLowerCase();
            return String(p.name || '').toLowerCase().indexOf(q) !== -1 ||
                String(p.trackingId || '').toLowerCase().indexOf(q) !== -1 ||
                String(p.phone || '').replace(/\s+/g, '').indexOf(q.replace(/\s+/g, '')) !== -1;
        });

        rows.sort(comparator(sortOrder));

        var grid = byId('patientsCardGrid');
        if (!grid) return;

        if (!rows.length) {
            grid.innerHTML = ui.emptyState({
                icon: patients.length ? 'search' : 'patients',
                title: patients.length ? 'No records match these filters' : 'No patients registered',
                text: patients.length
                    ? 'Adjust the search or filters to widen the results.'
                    : 'Use “Register patient” to add the first arrival of the session.'
            });
            return;
        }

        grid.innerHTML = rows.map(cardHtml).join('');
        bindCards(grid);
    }

    function comparator(mode) {
        return function (a, b) {
            switch (mode) {
                case 'reg_asc':  return new Date(a.registered) - new Date(b.registered);
                case 'name_asc': return String(a.name).localeCompare(String(b.name));
                case 'age_asc':  return (a.age === null ? 999 : a.age) - (b.age === null ? 999 : b.age);
                case 'age_desc': return (b.age === null ? -1 : b.age) - (a.age === null ? -1 : a.age);
                default:         return new Date(b.registered) - new Date(a.registered);
            }
        };
    }

    function cardHtml(p) {
        var urgency = store.normalizeUrgency(p.urgency);
        var assessment = clinical.assess(p.vitals);
        var flagged = assessment.flagged.length;

        return '<article class="patient-card ' + urgencyClass(urgency) + '" data-id="' + esc(p.id) + '">' +
            '<header class="pc-head">' +
                '<span class="avatar-sq avatar-lg ' + urgencyClass(urgency) + '">' + esc(store.initials(p.name)) + '</span>' +
                '<div class="pc-identity">' +
                    '<span class="pc-name">' + esc(p.name) + '</span>' +
                    '<span class="pc-sub">' +
                        '<span class="mono">' + esc(p.trackingId) + '</span>' +
                        (p.age !== null ? '<span>' + esc(p.age) + ' yrs</span>' : '') +
                        (p.sex ? '<span>' + esc(p.sex) + '</span>' : '') +
                    '</span>' +
                    '<span class="pc-badges">' +
                        '<span class="badge ' + urgencyClass(urgency) + '">' + esc(urgency) + '</span>' +
                        '<span class="badge ' + statusClass(p.status) + '">' + esc(p.status) + '</span>' +
                        (p.preferredDoctor
                            ? '<span class="badge status-treatment">' + icon('stethoscope', 12) + ' ' +
                                  esc(p.preferredDoctor) + '</span>'
                            : '') +
                    '</span>' +
                '</div>' +
            '</header>' +

            (flagged
                ? '<div class="pc-flag ' + (assessment.overall === 'critical' ? 'is-critical' : '') + '">' +
                    icon(assessment.overall === 'critical' ? 'critical' : 'warning', 13) +
                    '<span>' + esc(assessment.summary) + '</span>' +
                  '</div>'
                : '') +

            '<p class="pc-complaint">' + esc(p.description || 'No complaint recorded.') + '</p>' +

            '<footer class="pc-foot">' +
                '<span class="pc-registered">' + icon('calendar', 13) +
                    '<span>' + esc(store.formatDateTime(p.registered)) + '</span>' +
                '</span>' +
                '<div class="pc-actions">' +
                    '<button type="button" class="btn-icon" data-edit="' + esc(p.id) + '" title="Edit record" aria-label="Edit record">' +
                        icon('edit', 15) +
                    '</button>' +
                    '<button type="button" class="btn-secondary btn-sm" data-view="' + esc(p.id) + '">' +
                        icon('eye', 14) + '<span>Open</span>' +
                    '</button>' +
                '</div>' +
            '</footer>' +
        '</article>';
    }

    function bindCards(grid) {
        ui.qsa('[data-view]', grid).forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                openDetail(btn.getAttribute('data-view'));
            });
        });
        ui.qsa('[data-edit]', grid).forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                openForm(btn.getAttribute('data-edit'));
            });
        });
        ui.qsa('.patient-card', grid).forEach(function (card) {
            card.addEventListener('click', function () {
                openDetail(card.getAttribute('data-id'));
            });
        });
    }

    /* ==================================================================
        Register / edit form
        ================================================================== */

    /* Doctors come from the staff directory; reception cannot type free
       text so a preference always names a real clinician. */
    var STAFF_KEY = 'clinic_staff_members';

    function doctorChoices() {
        return store.read(STAFF_KEY).filter(function (s) {
            return s.role === 'Doctor';
        }).map(function (s) { return s.name; }).sort();
    }

    function renderDoctorOptions(selected) {
        var menu = byId('inputDoctorMenu');
        if (!menu) return;
        var opts = ['<li class="cs-option" data-value="" data-label="No preference — queue order">No preference — any doctor, the queue decides</li>'];
        doctorChoices().forEach(function (name) {
            opts.push('<li class="cs-option' + (selected && name === selected ? ' selected' : '') +
                '" data-value="' + esc(name) + '" data-label="' + esc(name) + '">' + esc(name) + '</li>');
        });
        menu.innerHTML = opts.join('');
    }

    /* The field shows only the 9 national digits; +251 is fixed on screen
       and the number is stored with the trunk 0 so lookups stay canonical. */
    function bindPhoneInput() {
        var el = byId('inputPhone');
        if (!el || el.getAttribute('data-phone-ready') === '1') return;
        el.setAttribute('data-phone-ready', '1');
        el.setAttribute('maxlength', '9');
        el.addEventListener('input', function () {
            var d = el.value.replace(/\D/g, '');
            while (d.charAt(0) === '0') d = d.slice(1);   /* +251 already says it */
            if (d.length > 9) d = d.slice(0, 9);
            if (el.value !== d) el.value = d;
        });
    }

    function openForm(id) {
        editingId = id === undefined || id === null ? null : id;
        var p = editingId === null ? null : store.findPatient(patients, editingId);
        if (editingId !== null && !p) return;

        setText('patientModalTitle', p ? 'Edit patient record' : 'Register patient');
        setText('patientModalSub', p ? p.trackingId : 'Demographics, baseline observations and triage priority');
        setText('savePatientLabel', p ? 'Save changes' : 'Register patient');

        ['inputName', 'inputAge', 'inputPhone', 'inputDesc'].forEach(function (f) {
            byId(f).value = '';
            ui.clearFieldError(f);
        });
        VITAL_FIELDS.forEach(function (pair) { byId(pair[0]).value = ''; });

        renderDoctorOptions(p ? p.preferredDoctor : null);

        if (p) {
            byId('inputName').value = p.name;
            byId('inputAge').value = p.age === null ? '' : p.age;
            byId('inputPhone').value = p.phone ? String(p.phone).replace(/^0+/, '') : '';
            byId('inputDesc').value = p.description;
            VITAL_FIELDS.forEach(function (pair) {
                var v = p.vitals[pair[1]];
                byId(pair[0]).value = v === null || v === undefined ? '' : v;
            });
            ui.setSelectValue('inputSexWrapper', p.sex || '', p.sex || 'Choose sex');
            ui.setSelectValue('inputUrgencyWrapper', store.normalizeUrgency(p.urgency));
            ui.setSelectValue('inputDoctorWrapper', p.preferredDoctor || '',
                p.preferredDoctor || 'No preference — queue order');
        } else {
            ui.setSelectValue('inputSexWrapper', '', 'Choose sex');
            ui.setSelectValue('inputUrgencyWrapper', store.URGENCY.ROUTINE, 'Routine');
            ui.setSelectValue('inputDoctorWrapper', '', 'No preference — queue order');
        }

        refreshReadout();
        ui.openModal('patientModal');
    }

    function readVitalsFromForm() {
        var v = {};
        VITAL_FIELDS.forEach(function (pair) {
            v[pair[1]] = store.toNumber(val(pair[0]));
        });
        return v;
    }

    /* Live interpretation under the observation inputs. */
    function refreshReadout() {
        var host = byId('vitalsReadout');
        if (!host) return;

        var assessment = clinical.assess(readVitalsFromForm());

        if (!assessment.recordedCount) {
            host.innerHTML =
                '<div class="notice">' +
                    '<span class="ico" data-icon="info" data-icon-size="15"></span>' +
                    '<div><strong>Automatic interpretation</strong>' +
                    'Enter observations above and each value is checked against adult reference ranges.</div>' +
                '</div>';
            if (window.MediIcons) window.MediIcons.hydrate(host);
            updateTriageAdvice(null);
            return;
        }

        var chips = assessment.results.map(function (r) {
            var unit = r.key === 'bloodPressure' ? '' : ' ' + r.unit;
            return '<span class="readout-chip level-' + r.level + '">' +
                '<strong>' + esc(r.label) + '</strong>' +
                '<span>' + esc(r.display) + esc(unit) + '</span>' +
                '<em>' + esc(r.levelLabel) + '</em>' +
            '</span>';
        }).join('');

        var noteClass = assessment.overall === 'critical' ? 'notice-danger'
            : (assessment.overall === 'abnormal' ? 'notice-warning'
            : (assessment.overall === 'borderline' ? 'notice-warning' : 'notice-success'));

        host.innerHTML =
            '<div class="readout-chips">' + chips + '</div>' +
            '<div class="notice ' + noteClass + '">' +
                '<span class="ico" data-icon="' +
                    (assessment.overall === 'normal' ? 'check-circle' : 'warning') + '" data-icon-size="15"></span>' +
                '<div><strong>' + esc(assessment.overallLabel) + ' observations</strong>' +
                esc(assessment.summary) + '</div>' +
            '</div>' +
            (assessment.flagged.length
                ? '<ul class="readout-notes">' + assessment.flagged.map(function (f) {
                    return '<li><strong>' + esc(f.label) + ':</strong> ' + esc(f.note) + '</li>';
                  }).join('') + '</ul>'
                : '');

        if (window.MediIcons) window.MediIcons.hydrate(host);
        updateTriageAdvice(assessment);
    }

    /* The operator keeps control; the system only argues its case. */
    function updateTriageAdvice(assessment) {
        var box = byId('triageAdvice');
        if (!box) return;

        if (!assessment) { box.hidden = true; suggestedUrgency = null; return; }

        var chosen = ui.getSelectValue('inputUrgencyWrapper') || store.URGENCY.ROUTINE;
        var suggested = assessment.suggestedUrgency;

        if (store.urgencyRank(suggested) >= store.urgencyRank(chosen)) {
            box.hidden = true;
            suggestedUrgency = null;
            return;
        }

        suggestedUrgency = suggested;
        box.hidden = false;
        setText('triageAdviceTitle', 'Observations suggest ' + suggested);
        setText('triageAdviceText',
            assessment.summary + ' Recorded priority is ' + chosen + '.');
    }

    /* An "active" twin: same phone number AND same age still inside the
       department (waiting, in consultation or awaiting results). Finished
       visits are history, not duplicates. */
    function findActiveDuplicate(phone, age) {
        var digits = store.phoneDigits(phone);
        if (!digits || age === null || age === undefined) return null;
        var match = null;
        patients.some(function (p) {
            if (p.status === STATUS.FINISHED) return false;
            if (store.phoneDigits(p.phone) !== digits) return false;
            if (p.age === null || Number(p.age) !== Number(age)) return false;
            match = p;
            return true;
        });
        return match;
    }

    function savePatient() {
        var ok = ui.requireFields([
            { id: 'inputName', message: 'Enter the patient\u2019s full name.' },
            {
                id: 'inputAge',
                message: 'Enter an age between 0 and 130.',
                test: function (v) {
                    var n = Number(v);
                    return !isNaN(n) && n >= 0 && n <= 130;
                }
            },
            {
                id: 'inputPhone',
                message: 'Enter all 9 digits after +251.',
                test: function (v) { return store.isValidPhone('0' + v.replace(/\D/g, '')); }
            }
        ]);
        if (!ok) return;

        var sex = ui.getSelectValue('inputSexWrapper');
        if (!sex) {
            window.MediTrackNotify.push('Sex is required',
                'Choose Female or Male before saving.',
                'warning', 'Patients', 'normal');
            return;
        }

        var urgency = ui.getSelectValue('inputUrgencyWrapper') || store.URGENCY.ROUTINE;

        /* Urgent and emergency arrivals go straight to the queue; everyone
           else pays their queue-card bill first. */
        var goesStraightToQueue = urgency === store.URGENCY.URGENT ||
                                  urgency === store.URGENCY.EMERGENCY;
        var status = goesStraightToQueue ? STATUS.PENDING : STATUS.AWAITING_PAYMENT;

        var phoneDigitsTyped = val('inputPhone').replace(/\D/g, '');
        var payload = {
            name: val('inputName'),
            age: store.toNumber(val('inputAge')),
            sex: sex,
            phone: '0' + phoneDigitsTyped,
            description: val('inputDesc'),
            preferredDoctor: ui.getSelectValue('inputDoctorWrapper') || null,
            urgency: urgency,
            status: status,
            vitals: readVitalsFromForm()
        };

        /* Duplicate safety net: warn, show who is already here, and let the
           operator insist only deliberately. */
        if (editingId === null) {
            var dup = findActiveDuplicate(payload.phone, payload.age);
            if (dup && dup.id !== editingId) {
                ui.confirmAction({
                    title: 'Possible duplicate',
                    subtitle: dup.name + ' \u00b7 ' + dup.trackingId,
                    message: 'A patient with the same phone number and age is already active: ' +
                             dup.name + ' (' + dup.trackingId + '), currently \u201c' + dup.status +
                             '\u201d' + (dup.preferredDoctor ? ' under ' + dup.preferredDoctor : '') +
                             '. Check their card before creating a second record for the same person.',
                    confirmLabel: 'Register anyway',
                    cancelLabel: 'Open existing record',
                    tone: 'danger',
                    icon: 'warning',
                    onCancel: function () { openDetail(dup.id); }
                }, function () {
                    performSave(payload, goesStraightToQueue);
                });
                return;
            }
        }

        performSave(payload, goesStraightToQueue);
    }

    function performSave(payload, goesStraightToQueue) {
        var existing = editingId === null ? null : store.findPatient(patients, editingId);

        if (existing) {
            Object.keys(payload).forEach(function (k) { existing[k] = payload[k]; });
            /* Re-run the vitals alert if the numbers changed materially. */
            existing.vitalsAlerted = null;
            if (payload.status === STATUS.CONSULTING && !existing.calledAt) {
                existing.calledAt = new Date().toISOString();
            }
        } else {
            payload.id = store.nextPatientId(patients);
            payload.trackingId = store.generateTrackingId();
            payload.registered = new Date().toISOString();
            if (payload.status === STATUS.CONSULTING) payload.calledAt = payload.registered;
            patients.push(store.normalizePatient(payload));
        }

        store.writePatients(patients);
        patients = store.readPatients();

        var saved = existing || patients[patients.length - 1];
        var assessment = clinical.assess(saved.vitals);

        /* Every registration raises a queue-card bill on the billing desk.
           Routine patients are taken there to pay straight away; urgent and
           emergency arrivals join the queue first and settle it later. */
        var regBill = null;
        if (!existing) {
            regBill = store.ensureRegistrationInvoice(saved);
            if (regBill && !goesStraightToQueue) {
                try {
                    window.sessionStorage.setItem('billing_open_invoice_id', regBill.id);
                } catch (e) {}
            }
        }

        ui.closeModal('patientModal');
        render();

        if (existing) {
            window.MediTrackNotify.flash('Record updated', saved.name + ' saved.');
        } else {
            window.MediTrackNotify.event('patient.registered', {
                key: 'registered:' + saved.id,
                title: 'Patient Registered',
                message: saved.name + ' added as ' + store.normalizeUrgency(saved.urgency) +
                         '. Tracking ID ' + saved.trackingId + '.' +
                         (saved.preferredDoctor ? ' Requests ' + saved.preferredDoctor + '.' : '')
            });
        }

        if (regBill && !goesStraightToQueue) {
            store.navigate('pages/billing.html');
        } else if (goesStraightToQueue) {
            window.MediTrackNotify.push(
                regBill ? 'Queued · card bill unpaid' : 'Added to queue',
                saved.name + ' is urgent and joins the queue now.' +
                    (regBill ? ' The unpaid queue-card bill (' +
                        store.formatMoney(store.invoiceTotals(regBill).total) + ') waits at billing.' : ''),
                'info', 'Queue', 'high'
            );
        }

        /* Abnormal baseline observations are a clinical event in their own right. */
        if (assessment.flagged.length) {
            var stamp = assessment.overall + ':' + assessment.flagged.length;
            clinical.notifyVitals(saved.name, assessment, saved.id + ':' + stamp);
            saved.vitalsAlerted = stamp;
            store.writePatients(patients);
        }
    }

    /* ==================================================================
       Detail
       ================================================================== */
    function openDetail(id) {
        var p = store.findPatient(patients, id);
        if (!p) return;
        detailId = p.id;

        setText('detailModalTitle', p.name);
        setText('detailModalSub', p.trackingId + ' · registered ' + store.formatDateTime(p.registered));

        var assessment = clinical.assess(p.vitals);
        var b = store.bmi(p.vitals.weight, p.vitals.height);
        var urgency = store.normalizeUrgency(p.urgency);

        var vitalsBlock = assessment.results.length
            ? '<div class="detail-vitals">' + assessment.results.map(function (r) {
                var unit = r.key === 'bloodPressure' ? 'mmHg' : r.unit;
                return '<div class="detail-vital level-' + r.level + '">' +
                    '<span class="dv-label">' + esc(r.label) + '</span>' +
                    '<span class="dv-value">' + esc(r.display) + '<small>' + esc(unit) + '</small></span>' +
                    '<span class="dv-state">' + esc(r.levelLabel) + '</span>' +
                    (r.range ? '<span class="dv-range">Normal ' + esc(r.range) + '</span>' : '') +
                '</div>';
              }).join('') + '</div>'
            : '<div class="notice"><span class="ico" data-icon="info" data-icon-size="15"></span>' +
              '<div><strong>No observations recorded</strong>Baseline vitals were not captured at registration.</div></div>';

        var orders = [];
        [['labOrders', 'Laboratory'], ['nurseOrders', 'Nursing'], ['prescriptions', 'Pharmacy']].forEach(function (pair) {
            (p[pair[0]] || []).forEach(function (o) {
                orders.push({
                    dept: pair[1],
                    title: o.test || o.task || o.medication || 'Order',
                    status: o.status || (store.isOrderOpen(o) ? 'Outstanding' : 'Completed'),
                    open: store.isOrderOpen(o),
                    time: o.time
                });
            });
        });

        byId('detailModalBody').innerHTML =
            '<div class="detail-badges">' +
                '<span class="badge ' + urgencyClass(urgency) + '">' + esc(urgency) + '</span>' +
                '<span class="badge ' + statusClass(p.status) + '">' + esc(p.status) + '</span>' +
                (assessment.flagged.length
                    ? '<span class="badge ' + (assessment.overall === 'critical' ? 'status-critical' : 'status-awaiting') + '">' +
                      esc(assessment.overallLabel) + ' vitals</span>'
                    : '') +
            '</div>' +

            '<dl class="detail-grid">' +
                detailItem('Age', p.age === null ? '—' : p.age + ' years') +
                detailItem('Sex', p.sex || '—') +
                detailItem('Phone', p.phone ? store.formatPhone(p.phone) : '—') +
                detailItem('Tracking ID', p.trackingId) +
                detailItem('BMI', b ? b.value + ' (' + b.category + ')' : '—') +
                detailItem('Time in department', store.elapsed(p.registered, p.completedAt)) +
            '</dl>' +

            (p.preferredDoctor
                ? section('Doctor preference', 'stethoscope',
                    '<p class="detail-text">Patient requests <strong>' + esc(p.preferredDoctor) +
                    '</strong>. All doctors draw from the same queue; this is shown to the consultation desk when calling.</p>')
                : '') +

            section('Presenting complaint', 'file-text',
                '<p class="detail-text">' + esc(p.description || 'Not recorded.') + '</p>') +

            section('Observations and interpretation', 'pulse', vitalsBlock) +

            (assessment.flagged.length
                ? section('Automatic findings', 'warning',
                    '<ul class="detail-notes">' + assessment.flagged.map(function (f) {
                        return '<li class="level-' + f.level + '"><strong>' + esc(f.label) + ':</strong> ' + esc(f.note) + '</li>';
                    }).join('') + '</ul>')
                : '') +

            ((p.clinicalNotes || []).length
                ? section('Clinical notes', 'edit',
                    '<div class="history-list">' + p.clinicalNotes.slice().reverse().map(function (n) {
                        return '<div class="history-item">' +
                            '<div class="history-item-head">' +
                                '<strong class="history-item-title">' + esc(n.diagnosis || 'Clinical note') + '</strong>' +
                                '<span class="history-item-time">' + esc(store.formatDateTime(n.time)) + '</span>' +
                            '</div>' +
                            '<div class="history-item-body">' + esc(n.note) + '</div>' +
                        '</div>';
                    }).join('') + '</div>')
                : '') +

            (orders.length
                ? section('Orders', 'layers',
                    '<div class="history-list">' + orders.map(function (o) {
                        return '<div class="history-item ' + (o.open ? 'is-open' : 'is-complete') + '">' +
                            '<div class="history-item-head">' +
                                '<strong class="history-item-title">' + esc(o.dept) + ': ' + esc(o.title) + '</strong>' +
                                '<span class="badge ' + (o.open ? 'status-awaiting' : 'status-finished') + '">' + esc(o.status) + '</span>' +
                            '</div>' +
                            '<div class="history-item-head" style="margin-top:5px">' +
                                '<span class="history-item-time">' + esc(store.formatDateTime(o.time)) + '</span>' +
                            '</div>' +
                        '</div>';
                    }).join('') + '</div>')
                : '');

        var openBtn = byId('openConsultationBtn');
        if (openBtn) openBtn.disabled = p.status === STATUS.FINISHED;

        if (window.MediIcons) window.MediIcons.hydrate(byId('detailModalBody'));
        ui.openModal('detailModal');
    }

    function detailItem(label, value) {
        return '<div class="detail-item"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
    }

    function section(title, iconName, body) {
        return '<section class="detail-section">' +
            '<h4 class="detail-section-title">' +
                '<span class="ico" data-icon="' + iconName + '" data-icon-size="14"></span>' +
                '<span>' + esc(title) + '</span>' +
            '</h4>' + body +
        '</section>';
    }

    function deleteRecord() {
        var p = store.findPatient(patients, detailId);
        if (!p) return;

        ui.confirmAction({
            title: 'Delete patient record',
            subtitle: p.name + ' · ' + p.trackingId,
            message: 'This permanently removes the record, including clinical notes and order history. It cannot be undone.',
            confirmLabel: 'Delete permanently',
            tone: 'danger',
            icon: 'trash'
        }, function () {
            patients = patients.filter(function (x) { return String(x.id) !== String(p.id); });
            store.writePatients(patients);
            patients = store.readPatients();
            ui.closeModal('detailModal');
            render();
            window.MediTrackNotify.push(
                'Record Deleted',
                p.name + ' (' + p.trackingId + ') was removed from the registry.',
                'warning', 'Patient', 'normal'
            );
        });
    }

    /* ==================================================================
       Init
       ================================================================== */
    function init() {
        patients = store.seedIfEmpty();
        if (!patients.length) patients = store.readPatients();
        render();

        var addBtn = byId('addPatientBtn');
        if (addBtn) addBtn.addEventListener('click', function () { openForm(null); });

        var saveBtn = byId('savePatientBtn');
        if (saveBtn) saveBtn.addEventListener('click', savePatient);

        ui.initSelect('inputSexWrapper');
        ui.initSelect('inputUrgencyWrapper', function () { refreshReadout(); });
        ui.initSelect('inputDoctorWrapper');

        /* Ethiopian mobile entry: exactly 9 national digits after +251. */
        bindPhoneInput();

        ui.initSelect('filterUrgencyWrapper', function (v) { urgencyFilter = v; render(); });
        ui.initSelect('filterStatusWrapper', function (v) { statusFilter = v; render(); });
        ui.initSelect('sortOrderWrapper', function (v) { sortOrder = v; render(); });

        ui.bindLiveValidation(['inputName', 'inputAge', 'inputPhone', 'inputDesc']);

        VITAL_FIELDS.forEach(function (pair) {
            var el = byId(pair[0]);
            if (el) el.addEventListener('input', refreshReadout);
        });

        var apply = byId('triageAdviceApply');
        if (apply) {
            apply.addEventListener('click', function () {
                if (!suggestedUrgency) return;
                ui.setSelectValue('inputUrgencyWrapper', suggestedUrgency, suggestedUrgency);
                refreshReadout();
            });
        }

        var search = byId('patientSearch');
        var clear = byId('patientSearchClear');
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
                statusFilter = 'active';
                sortOrder = 'reg_desc';
                if (search) search.value = '';
                if (clear) clear.classList.remove('visible');
                ui.setSelectValue('filterUrgencyWrapper', '', 'All priorities');
                ui.setSelectValue('filterStatusWrapper', 'active', 'Active visits');
                ui.setSelectValue('sortOrderWrapper', 'reg_desc', 'Newest first');
                render();
            });
        }

        var del = byId('deleteFromDetailBtn');
        if (del) del.addEventListener('click', deleteRecord);

        var edit = byId('editFromDetailBtn');
        if (edit) {
            edit.addEventListener('click', function () {
                var id = detailId;
                ui.closeModal('detailModal');
                setTimeout(function () { openForm(id); }, 180);
            });
        }

        var consult = byId('openConsultationBtn');
        if (consult) {
            consult.addEventListener('click', function () {
                if (detailId === null) return;
                store.sessionSet('selected_tracking_patient_id', detailId);
                ui.closeModal('detailModal');
                store.navigate('pages/track.html');
            });
        }

        store.onPatientsChanged(function () {
            patients = store.readPatients();
            render();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
