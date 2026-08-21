/**
 * MediTrack Hospital ERP - Clinical Tracking & Consultation Logic (Dual-Mode)
 * 1. Patient Cards Grid Directory View (shows live lab statuses e.g. "Awaiting Lab Report", "Lab Results Ready!")
 * 2. Individual Consultation Workspace View (Diagnosis, Vitals, Lab Orders, Nurse Orders, Prescriptions)
 * Allows doctors to treat other patients while awaiting lab reports and switch effortlessly.
 */

(function() {
    'use strict';

    var STORAGE_KEY_PATIENTS = 'clinic_patients_data';
    var STORAGE_KEY_LAB = 'clinic_lab_requests';
    var STORAGE_KEY_PRESCRIPTIONS = 'clinic_prescriptions_data';

    var allPatients = [];
    var activeQueueList = [];
    var currentPatient = null;
    var currentViewMode = 'grid'; // 'grid' or 'workspace'

    var searchTerm = '';
    var clinicalStatusFilter = '';
    var urgencyFilter = '';
    var sortOrder = 'urgent_first';

    /* --------------------------------------------------------------------------
       Data Synchronization & Status Resolution
       -------------------------------------------------------------------------- */
    function loadAndOrderPatients() {
        var data = localStorage.getItem(STORAGE_KEY_PATIENTS);
        if (data) {
            try {
                allPatients = JSON.parse(data);
                allPatients.forEach(function(p) {
                    if (p.urgency === 'High') p.urgency = 'Urgent';
                    else if (p.urgency === 'Medium' || p.urgency === 'Low') p.urgency = 'Non-Urgent';
                    if (!p.bp) p.bp = '120/80';
                    if (!p.hr) p.hr = 72;
                    if (!p.clinicalNotes) p.clinicalNotes = [];
                    if (!p.labOrders) p.labOrders = [];
                    if (!p.nurseOrders) p.nurseOrders = [];
                    if (!p.prescriptions) p.prescriptions = [];
                });
            } catch (e) {
                allPatients = [];
            }
        } else {
            allPatients = [];
        }

        // Active Queue: Non-Finished patients only
        activeQueueList = allPatients.filter(function(p) {
            return p.status === 'Pending' || p.status === 'In Treatment';
        });

        // Check if there's a requested patient via sessionStorage
        var selectedId = sessionStorage.getItem('selected_tracking_patient_id');
        if (selectedId) {
            var target = activeQueueList.find(function(p) { return p.id === parseInt(selectedId, 10); });
            if (target) {
                currentPatient = target;
                currentViewMode = 'workspace';
            }
            sessionStorage.removeItem('selected_tracking_patient_id');
        }

        applySorting();
        renderView();
    }

    function getPatientLabStatus(patient) {
        if (!patient.labOrders || patient.labOrders.length === 0) {
            return patient.status === 'In Treatment' ? 'In Treatment' : 'Pending';
        }
        var hasRequested = patient.labOrders.some(function(o) { return o.status === 'Requested' || o.status === 'In Progress'; });
        var hasCompleted = patient.labOrders.some(function(o) { return o.status === 'Completed'; });

        if (hasCompleted && !hasRequested) return 'Lab Ready';
        if (hasRequested) return 'Awaiting Labs';
        return patient.status === 'In Treatment' ? 'In Treatment' : 'Pending';
    }

    function applySorting() {
        if (sortOrder === 'urgent_first') {
            activeQueueList.sort(function(a, b) {
                var weightA = (a.urgency === 'Urgent') ? 2 : 1;
                var weightB = (b.urgency === 'Urgent') ? 2 : 1;
                var diff = weightB - weightA;
                if (diff !== 0) return diff;
                return new Date(a.registered) - new Date(b.registered);
            });
        } else if (sortOrder === 'fifo') {
            activeQueueList.sort(function(a, b) {
                return new Date(a.registered) - new Date(b.registered);
            });
        } else if (sortOrder === 'name_asc') {
            activeQueueList.sort(function(a, b) {
                return (a.name || '').localeCompare(b.name || '');
            });
        } else if (sortOrder === 'longest_wait') {
            activeQueueList.sort(function(a, b) {
                return new Date(a.registered) - new Date(b.registered);
            });
        }
    }

    function savePatients() {
        localStorage.setItem(STORAGE_KEY_PATIENTS, JSON.stringify(allPatients));
    }

    function saveLabRequestGlobally(labOrder) {
        var existing = [];
        try {
            var raw = localStorage.getItem(STORAGE_KEY_LAB);
            if (raw) existing = JSON.parse(raw);
        } catch (e) { existing = []; }
        existing.push(labOrder);
        localStorage.setItem(STORAGE_KEY_LAB, JSON.stringify(existing));
    }

    function savePrescriptionGlobally(rxOrder) {
        var existing = [];
        try {
            var raw = localStorage.getItem(STORAGE_KEY_PRESCRIPTIONS);
            if (raw) existing = JSON.parse(raw);
        } catch (e) { existing = []; }
        existing.push(rxOrder);
        localStorage.setItem(STORAGE_KEY_PRESCRIPTIONS, JSON.stringify(existing));
    }

    /* --------------------------------------------------------------------------
       View Rendering (Grid vs Workspace)
       -------------------------------------------------------------------------- */
    function renderView() {
        var gridView = document.getElementById('trackGridView');
        var wsView = document.getElementById('trackWorkspaceView');

        if (currentViewMode === 'grid' || !currentPatient) {
            if (gridView) gridView.style.display = 'flex';
            if (wsView) wsView.style.display = 'none';
            renderGridDirectory();
        } else {
            if (gridView) gridView.style.display = 'none';
            if (wsView) wsView.style.display = 'flex';
            renderWorkspace();
        }
    }

    function renderGridDirectory() {
        var grid = document.getElementById('trackPatientCardGrid');
        var emptyState = document.getElementById('noTrackPatientsState');
        var activeCountEl = document.getElementById('gridActiveCount');
        var awaitingLabsEl = document.getElementById('gridAwaitingLabsCount');

        var awaitingCount = activeQueueList.filter(function(p) { return getPatientLabStatus(p) === 'Awaiting Labs'; }).length;
        if (activeCountEl) activeCountEl.textContent = activeQueueList.length;
        if (awaitingLabsEl) awaitingLabsEl.textContent = awaitingCount;

        var filtered = activeQueueList.filter(function(p) {
            var labStat = getPatientLabStatus(p);
            var matchesStatus = !clinicalStatusFilter || labStat === clinicalStatusFilter;
            var matchesUrg = !urgencyFilter || p.urgency === urgencyFilter;
            var matchesSearch = true;
            if (searchTerm) {
                var q = searchTerm.toLowerCase();
                matchesSearch = (p.name && p.name.toLowerCase().includes(q)) ||
                                (p.trackingId && p.trackingId.toLowerCase().includes(q)) ||
                                (p.description && p.description.toLowerCase().includes(q));
            }
            return matchesStatus && matchesUrg && matchesSearch;
        });

        if (!grid) return;

        if (filtered.length === 0) {
            grid.innerHTML = '';
            if (emptyState) emptyState.style.display = 'flex';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        grid.innerHTML = filtered.map(function(p, idx) {
            var initials = p.name ? p.name.split(' ').map(function(n) { return n[0]; }).join('').toUpperCase() : 'PT';
            var labStat = getPatientLabStatus(p);
            var cardModifier = '';
            var pillHtml = '';

            if (labStat === 'Awaiting Labs') {
                cardModifier = ' pcard-awaiting-lab';
                pillHtml = '<span class="status-pill status-pill-awaiting-lab">⏳ Awaiting Lab Report</span>';
            } else if (labStat === 'Lab Ready') {
                cardModifier = ' pcard-lab-ready';
                pillHtml = '<span class="status-pill status-pill-lab-ready">✓ Lab Results Ready!</span>';
            } else if (p.status === 'In Treatment') {
                pillHtml = '<span class="status-pill status-pill-consulting">● In Consultation</span>';
            } else {
                pillHtml = '<span class="status-pill status-pill-pending">Waiting in Queue</span>';
            }

            var urgClass = p.urgency === 'Urgent' ? 'urgency-urgent' : 'urgency-nonurgent';
            var labCount = (p.labOrders || []).length;
            var nurseCount = (p.nurseOrders || []).length;
            var rxCount = (p.prescriptions || []).length;

            return '<div class="track-pcard' + cardModifier + '" data-id="' + p.id + '">' +
                '<div class="pcard-head">' +
                    '<div class="pcard-user-meta">' +
                        '<div class="pcard-avatar">' + initials + '</div>' +
                        '<div class="pcard-title-block">' +
                            '<h4 class="pcard-name">' + p.name + '</h4>' +
                            '<span class="pcard-sub">' + p.age + ' yrs · <span class="tid">' + p.trackingId + '</span></span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="pcard-badges">' +
                        pillHtml +
                        '<span class="urgency-badge ' + urgClass + '">' + p.urgency + '</span>' +
                    '</div>' +
                '</div>' +

                '<div class="pcard-vitals-row">' +
                    '<div class="pcard-vital"><span class="pcard-vital-lbl">BP</span><span class="pcard-vital-val">' + (p.bp || '120/80') + '</span></div>' +
                    '<div class="pcard-vital"><span class="pcard-vital-lbl">HR</span><span class="pcard-vital-val">' + (p.hr || '72') + ' bpm</span></div>' +
                    '<div class="pcard-vital"><span class="pcard-vital-lbl">Height</span><span class="pcard-vital-val">' + (p.height || '170') + ' cm</span></div>' +
                    '<div class="pcard-vital"><span class="pcard-vital-lbl">Weight</span><span class="pcard-vital-val">' + (p.weight || '70') + ' kg</span></div>' +
                '</div>' +

                '<div class="pcard-complaint">' +
                    '<strong>Complaint:</strong> ' + (p.description || 'Routine medical checkup.') +
                '</div>' +

                '<div class="pcard-footer">' +
                    '<div class="pcard-order-indicators">' +
                        (labCount > 0 ? '<span class="order-dot-tag tag-lab">' + labCount + ' Labs</span>' : '') +
                        (nurseCount > 0 ? '<span class="order-dot-tag tag-nurse">' + nurseCount + ' Nurse</span>' : '') +
                        (rxCount > 0 ? '<span class="order-dot-tag tag-rx">' + rxCount + ' Rx</span>' : '') +
                    '</div>' +
                    '<button type="button" class="btn-open-consultation" data-id="' + p.id + '">' +
                        '<span>' + (labStat === 'Lab Ready' ? 'Review Lab Results' : (p.status === 'In Treatment' ? 'Resume Consultation' : 'Open Consultation')) + '</span>' +
                        '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>' +
                    '</button>' +
                '</div>' +
            '</div>';
        }).join('');

        // Card Click Handler
        grid.querySelectorAll('.track-pcard').forEach(function(card) {
            card.addEventListener('click', function() {
                var id = parseInt(this.getAttribute('data-id'), 10);
                openPatientConsultation(id);
            });
        });
    }

    function openPatientConsultation(patientId) {
        var found = activeQueueList.find(function(p) { return p.id === patientId; });
        if (found) {
            currentPatient = found;
            if (currentPatient.status === 'Pending') {
                currentPatient.status = 'In Treatment';
                savePatients();
            }
            currentViewMode = 'workspace';
            renderView();

            if (window.MediTrackNotify) {
                window.MediTrackNotify.push(
                    'Consultation Workspace Opened',
                    currentPatient.name + ' (' + currentPatient.trackingId + ') loaded into physician workspace.',
                    'info',
                    'Queue'
                );
            }
        }
    }

    /* --------------------------------------------------------------------------
       Workspace Individual Patient Rendering
       -------------------------------------------------------------------------- */
    function renderWorkspace() {
        if (!currentPatient) return;

        var p = currentPatient;
        var pIdx = activeQueueList.findIndex(function(x) { return x.id === p.id; });
        var initials = p.name ? p.name.split(' ').map(function(n) { return n[0]; }).join('').toUpperCase() : 'PT';

        // Topbar
        var topName = document.getElementById('topbarPatientName');
        var topTid = document.getElementById('topbarPatientTid');
        var qBadge = document.getElementById('queueOrderBadge');

        if (topName) topName.textContent = p.name;
        if (topTid) topTid.textContent = p.trackingId;
        if (qBadge) qBadge.textContent = '#' + String(pIdx + 1).padStart(2, '0') + ' in Queue (' + p.urgency + ')';

        // Quick switcher menu in workspace
        renderWorkspacePatientSwitcher();

        // Left Panel Profile
        document.getElementById('patientAvatar').textContent = initials;
        document.getElementById('patientName').textContent = p.name;
        document.getElementById('patientTrackingId').textContent = p.trackingId;

        var urgBadge = document.getElementById('patientUrgencyBadge');
        if (urgBadge) {
            urgBadge.className = (p.urgency === 'Urgent') ? 'badge urgency-urgent' : 'badge urgency-nonurgent';
            urgBadge.textContent = p.urgency;
        }

        var statBadge = document.getElementById('patientStatusBadge');
        if (statBadge) {
            var labStat = getPatientLabStatus(p);
            statBadge.textContent = labStat === 'Lab Ready' ? 'Lab Results Ready' : (labStat === 'Awaiting Labs' ? 'Awaiting Lab Report' : p.status);
            statBadge.className = 'badge ' + (p.status === 'In Treatment' ? 'status-treatment' : 'status-pending');
        }

        document.getElementById('patientAge').textContent = p.age + ' yrs';
        document.getElementById('patientPhone').textContent = p.phone || 'Not provided';
        document.getElementById('patientRegistered').textContent = formatDate(p.registered);
        document.getElementById('patientBMI').textContent = calculateBMI(p.weight, p.height);

        document.getElementById('patientBP').innerHTML = (p.bp || '120/80') + ' <small>mmHg</small>';
        document.getElementById('patientHR').innerHTML = (p.hr || '72') + ' <small>bpm</small>';
        document.getElementById('patientHeight').innerHTML = (p.height || '170') + ' <small>cm</small>';
        document.getElementById('patientWeight').innerHTML = (p.weight || '70') + ' <small>kg</small>';

        document.getElementById('patientDescription').textContent = p.description || 'Routine medical consultation.';
        document.getElementById('tlRegisteredTime').textContent = formatTime12h(p.registered);

        var barStatus = document.getElementById('barStatusText');
        if (barStatus) barStatus.textContent = p.status;

        // Render Logs
        renderNotesHistory();
        renderStoragePhoneHistory();
        renderLabOrdersHistory();
        renderNurseOrdersHistory();
        renderPrescriptionsHistory();
    }

    function renderWorkspacePatientSwitcher() {
        var menu = document.getElementById('wsPatientSwitcherMenu');
        var toggle = document.querySelector('#wsPatientSwitcher .cs-toggle');
        if (!menu || !toggle) return;

        if (currentPatient) {
            var pIdx = activeQueueList.findIndex(function(x) { return x.id === currentPatient.id; });
            var posStr = '#' + String(pIdx + 1).padStart(2, '0');
            toggle.querySelector('.cs-text').textContent = posStr + ' · ' + currentPatient.name;
        }

        menu.innerHTML = activeQueueList.map(function(p, idx) {
            var posStr = '#' + String(idx + 1).padStart(2, '0');
            var isSelected = (currentPatient && p.id === currentPatient.id) ? ' selected' : '';
            var labStat = getPatientLabStatus(p);
            var tag = labStat === 'Lab Ready' ? ' [Lab Ready!]' : (labStat === 'Awaiting Labs' ? ' [Awaiting Labs]' : '');
            return '<li class="cs-option' + isSelected + '" data-value="' + p.id + '">' +
                posStr + ' ' + p.name + ' (' + p.urgency + ')' + tag +
            '</li>';
        }).join('');

        menu.querySelectorAll('.cs-option').forEach(function(opt) {
            opt.addEventListener('click', function() {
                var pId = parseInt(this.getAttribute('data-value'), 10);
                openPatientConsultation(pId);
                var wrap = document.getElementById('wsPatientSwitcher');
                if (wrap) wrap.classList.remove('active');
            });
        });
    }

    function calculateBMI(weightKg, heightCm) {
        if (!weightKg || !heightCm || heightCm <= 0) return 'Not recorded';
        var hM = heightCm / 100;
        var bmi = (weightKg / (hM * hM)).toFixed(1);
        var cat = 'Normal';
        if (bmi < 18.5) cat = 'Underweight';
        else if (bmi >= 25 && bmi < 30) cat = 'Overweight';
        else if (bmi >= 30) cat = 'Obese';
        return bmi + ' (' + cat + ')';
    }

    function formatDate(isoString) {
        if (!isoString) return '-';
        var date = new Date(isoString);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatTime12h(isoString) {
        if (!isoString) return '-';
        var d = new Date(isoString);
        var h = d.getHours();
        var m = String(d.getMinutes()).padStart(2, '0');
        var ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return h + ':' + m + ' ' + ampm;
    }

    function renderStoragePhoneHistory() {
        var section = document.getElementById('storageHistorySection');
        var listContainer = document.getElementById('storageHistoryList');
        if (!section || !listContainer || !currentPatient) return;

        var phone = currentPatient.phone ? currentPatient.phone.replace(/\s+/g, '') : '';
        if (!phone) { section.style.display = 'none'; return; }

        var pastVisits = allPatients.filter(function(p) {
            var pPhone = p.phone ? p.phone.replace(/\s+/g, '') : '';
            return p.id !== currentPatient.id && pPhone === phone && p.status === 'Finished';
        });

        if (pastVisits.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'flex';
        listContainer.innerHTML = pastVisits.map(function(pv) {
            var pastNotesHtml = (pv.clinicalNotes && pv.clinicalNotes.length > 0) ?
                pv.clinicalNotes.map(function(cn) {
                    return '<div style="margin-top:4px; padding-left:8px; border-left:2px solid #BAE6FD;"><strong>' + (cn.diagnosis || 'Diagnosis') + ':</strong> ' + cn.note + '</div>';
                }).join('') : '<div style="font-size:11.5px; color:var(--gray-muted);">Complaint: ' + (pv.description || '-') + '</div>';

            return '<div class="history-item storage-match-item">' +
                '<div class="history-item-head">' +
                    '<strong class="history-item-title" style="color:#0369A1;">Past Visit: ' + formatDate(pv.registered) + ' (' + pv.trackingId + ')</strong>' +
                    '<span class="badge status-finished">Archived Visit</span>' +
                '</div>' +
                '<div class="history-item-body">' + pastNotesHtml + '</div>' +
            '</div>';
        }).join('');
    }

    function renderNotesHistory() {
        var container = document.getElementById('clinicalNotesHistory');
        if (!container || !currentPatient) return;
        var notes = currentPatient.clinicalNotes || [];
        if (notes.length === 0) {
            container.innerHTML = '<span class="history-empty">No clinical notes recorded for current visit yet.</span>';
            return;
        }
        container.innerHTML = notes.slice().reverse().map(function(n) {
            return '<div class="history-item">' +
                '<div class="history-item-head">' +
                    '<strong class="history-item-title">' + (n.diagnosis ? n.diagnosis : 'Clinical Note') + '</strong>' +
                    '<span class="history-item-time">' + formatTime12h(n.time) + ' · ' + formatDate(n.time) + '</span>' +
                '</div>' +
                '<div class="history-item-body">' + n.note + '</div>' +
            '</div>';
        }).join('');
    }

    function renderLabOrdersHistory() {
        var container = document.getElementById('labOrdersHistory');
        if (!container || !currentPatient) return;
        var orders = currentPatient.labOrders || [];
        if (orders.length === 0) {
            container.innerHTML = '<span class="history-empty">No diagnostic tests dispatched yet.</span>';
            return;
        }
        container.innerHTML = orders.slice().reverse().map(function(o) {
            var statusBadge = (o.status === 'Completed') ? '<span class="badge status-finished">✓ Completed</span>' : '<span class="badge status-pending">⏳ ' + o.status + '</span>';
            return '<div class="history-item' + (o.status === 'Completed' ? ' lab-completed-highlight' : '') + '">' +
                '<div class="history-item-head">' +
                    '<strong class="history-item-title">' + o.test + ' (' + o.priority + ')</strong>' +
                    '<div style="display:flex; align-items:center; gap:6px;">' +
                        statusBadge +
                        '<span class="history-item-time">' + formatTime12h(o.time) + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="history-item-body"><strong>Instructions to Lab:</strong> ' + o.note + '</div>' +
                (o.results ? '<div class="history-item-result"><strong>Official Lab Findings:</strong> ' + o.results + '</div>' : '') +
            '</div>';
        }).join('');
    }

    function renderNurseOrdersHistory() {
        var container = document.getElementById('nurseOrdersHistory');
        if (!container || !currentPatient) return;
        var orders = currentPatient.nurseOrders || [];
        if (orders.length === 0) {
            container.innerHTML = '<span class="history-empty">No nursing orders dispatched yet.</span>';
            return;
        }
        container.innerHTML = orders.slice().reverse().map(function(o) {
            return '<div class="history-item">' +
                '<div class="history-item-head">' +
                    '<strong class="history-item-title">' + o.task + '</strong>' +
                    '<span class="history-item-time">' + formatTime12h(o.time) + '</span>' +
                '</div>' +
                '<div class="history-item-body"><strong>Instructions:</strong> ' + o.note + '</div>' +
            '</div>';
        }).join('');
    }

    function renderPrescriptionsHistory() {
        var container = document.getElementById('prescriptionOrdersHistory');
        if (!container || !currentPatient) return;
        var rxs = currentPatient.prescriptions || [];
        if (rxs.length === 0) {
            container.innerHTML = '<span class="history-empty">No pharmacy prescriptions dispatched yet.</span>';
            return;
        }
        container.innerHTML = rxs.slice().reverse().map(function(rx) {
            return '<div class="history-item">' +
                '<div class="history-item-head">' +
                    '<strong class="history-item-title">' + rx.medication + ' (' + rx.dosage + ')</strong>' +
                    '<div style="display:flex; align-items:center; gap:6px;">' +
                        '<span class="badge status-pending">' + (rx.status || 'Prescribed') + '</span>' +
                        '<span class="history-item-time">' + formatTime12h(rx.time) + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="history-item-body">' +
                    '<div><strong>Regimen:</strong> ' + rx.frequency + ' · Route: ' + rx.route + (rx.duration ? ' · Duration: ' + rx.duration : '') + '</div>' +
                    (rx.instructions ? '<div style="margin-top:3px; color:var(--gray-muted);"><strong>Remarks:</strong> ' + rx.instructions + '</div>' : '') +
                '</div>' +
            '</div>';
        }).join('');
    }

    /* --------------------------------------------------------------------------
       Doctor Actions (Save Notes & Dispatch Orders)
       -------------------------------------------------------------------------- */
    function saveClinicalNote() {
        if (!currentPatient) return;
        var diagnosisInput = document.getElementById('inputDiagnosis');
        var notesInput = document.getElementById('inputClinicalNotes');

        var diagnosis = diagnosisInput.value.trim();
        var note = notesInput.value.trim();

        if (!note) {
            alert('Please enter clinical notes before saving.');
            return;
        }

        if (!currentPatient.clinicalNotes) currentPatient.clinicalNotes = [];

        currentPatient.clinicalNotes.push({
            id: Date.now(),
            diagnosis: diagnosis,
            note: note,
            doctor: 'Dr. Sarah Chen',
            time: new Date().toISOString()
        });

        if (currentPatient.status === 'Pending') currentPatient.status = 'In Treatment';

        savePatients();
        renderWorkspace();

        diagnosisInput.value = '';
        notesInput.value = '';

        if (window.MediTrackNotify) {
            window.MediTrackNotify.push(
                'Clinical Note Saved',
                'Diagnosis documented for ' + currentPatient.name + '.',
                'success',
                'Doctor'
            );
        }
    }

    function sendLabOrder() {
        if (!currentPatient) return;
        var testInput = document.getElementById('inputLabTestName');
        var prioritySelect = document.querySelector('#labPriorityWrapper .cs-toggle');
        var noteInput = document.getElementById('inputLabNote');

        var test = testInput.value.trim();
        var priority = (prioritySelect && prioritySelect.getAttribute('data-value')) || 'Urgent';
        var note = noteInput.value.trim();

        if (!test) {
            alert('Please specify the diagnostic test(s).');
            return;
        }
        if (!note) {
            alert('Please provide instructions for the lab assistant.');
            return;
        }

        var labOrder = {
            id: Date.now(),
            patientId: currentPatient.id,
            trackingId: currentPatient.trackingId,
            patientName: currentPatient.name,
            age: currentPatient.age,
            phone: currentPatient.phone,
            test: test,
            priority: priority,
            note: note,
            doctor: 'Dr. Sarah Chen',
            time: new Date().toISOString(),
            status: 'Requested',
            results: ''
        };

        if (!currentPatient.labOrders) currentPatient.labOrders = [];
        currentPatient.labOrders.push(labOrder);

        savePatients();
        saveLabRequestGlobally(labOrder);
        renderLabOrdersHistory();

        testInput.value = '';
        noteInput.value = '';

        if (window.MediTrackNotify) {
            window.MediTrackNotify.push(
                'Lab Order Dispatched',
                test + ' dispatched for ' + currentPatient.name + '. You may return to patients directory to treat others while results are prepared.',
                'info',
                'Lab'
            );
        }
    }

    function sendNurseOrder() {
        if (!currentPatient) return;
        var taskInput = document.getElementById('inputNurseTask');
        var noteInput = document.getElementById('inputNurseNote');

        var task = taskInput.value.trim();
        var note = noteInput.value.trim();

        if (!task) {
            alert('Please specify the nursing task or order.');
            return;
        }

        if (!currentPatient.nurseOrders) currentPatient.nurseOrders = [];

        currentPatient.nurseOrders.push({
            id: Date.now(),
            task: task,
            note: note,
            doctor: 'Dr. Sarah Chen',
            time: new Date().toISOString(),
            status: 'Dispatched'
        });

        savePatients();
        renderNurseOrdersHistory();

        taskInput.value = '';
        noteInput.value = '';

        if (window.MediTrackNotify) {
            window.MediTrackNotify.push(
                'Nurse Order Dispatched',
                task + ' assigned to Nurse Station.',
                'info',
                'Doctor'
            );
        }
    }

    function sendPrescriptionOrder() {
        if (!currentPatient) return;
        var medInput = document.getElementById('inputRxMedName');
        var dosageInput = document.getElementById('inputRxDosage');
        var freqToggle = document.querySelector('#rxFreqWrapper .cs-toggle');
        var routeToggle = document.querySelector('#rxRouteWrapper .cs-toggle');
        var durationInput = document.getElementById('inputRxDuration');
        var instInput = document.getElementById('inputRxInstructions');

        var med = medInput.value.trim();
        var dosage = dosageInput.value.trim();
        var freq = (freqToggle && freqToggle.getAttribute('data-value')) || 'BID';
        var route = (routeToggle && routeToggle.getAttribute('data-value')) || 'Oral';
        var duration = durationInput.value.trim();
        var inst = instInput.value.trim();

        if (!med || !dosage) {
            alert('Please specify medication name and dosage.');
            return;
        }

        var rxOrder = {
            id: Date.now(),
            patientId: currentPatient.id,
            trackingId: currentPatient.trackingId,
            patientName: currentPatient.name,
            medication: med,
            dosage: dosage,
            frequency: freq,
            route: route,
            duration: duration,
            instructions: inst,
            doctor: 'Dr. Sarah Chen',
            time: new Date().toISOString(),
            status: 'Prescribed'
        };

        if (!currentPatient.prescriptions) currentPatient.prescriptions = [];
        currentPatient.prescriptions.push(rxOrder);

        savePatients();
        savePrescriptionGlobally(rxOrder);
        renderPrescriptionsHistory();

        medInput.value = '';
        dosageInput.value = '';
        durationInput.value = '';
        instInput.value = '';

        if (window.MediTrackNotify) {
            window.MediTrackNotify.push(
                'Prescription Sent to Pharmacy',
                med + ' (' + dosage + ') dispatched to Pharmacy Dispensary.',
                'success',
                'Prescription'
            );
        }
    }

    function finishConsultation() {
        if (!currentPatient) return;
        var finishedName = currentPatient.name;
        currentPatient.status = 'Finished';
        savePatients();

        if (window.MediTrackNotify) {
            window.MediTrackNotify.push(
                'Consultation Finished',
                finishedName + ' consultation closed and archived to storage.',
                'success',
                'Doctor'
            );
        }

        currentPatient = null;
        currentViewMode = 'grid';
        loadAndOrderPatients();
    }

    function nextPatient() {
        if (!currentPatient) return;
        currentPatient.status = 'Finished';
        savePatients();

        loadAndOrderPatients();

        if (activeQueueList.length === 0) {
            currentPatient = null;
            currentViewMode = 'grid';
            renderView();
            if (window.MediTrackNotify) {
                window.MediTrackNotify.push('Queue Completed', 'All patient consultations concluded.', 'success', 'Queue');
            }
            return;
        }

        currentPatient = activeQueueList[0];
        currentPatient.status = 'In Treatment';
        savePatients();
        renderView();

        if (window.MediTrackNotify) {
            window.MediTrackNotify.push('Next Patient Called', currentPatient.name + ' in consultation.', 'info', 'Queue');
        }
    }

    /* --------------------------------------------------------------------------
       Custom Select Initializer
       -------------------------------------------------------------------------- */
    function initCustomSelect(wrapperId, callback) {
        var wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;
        var toggle = wrapper.querySelector('.cs-toggle');
        var menu = wrapper.querySelector('.cs-menu');
        if (!toggle || !menu) return;

        toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            document.querySelectorAll('.custom-select.active').forEach(function(el) {
                if (el !== wrapper) el.classList.remove('active');
            });
            wrapper.classList.toggle('active');
        });

        menu.querySelectorAll('.cs-option').forEach(function(opt) {
            opt.addEventListener('click', function() {
                var val = this.getAttribute('data-value');
                var text = this.textContent;
                var textSpan = toggle.querySelector('.cs-text');
                if (textSpan) textSpan.textContent = text;
                toggle.setAttribute('data-value', val);

                menu.querySelectorAll('.cs-option').forEach(function(o) { o.classList.remove('selected'); });
                this.classList.add('selected');

                wrapper.classList.remove('active');
                if (callback) callback(val);
            });
        });
    }

    /* --------------------------------------------------------------------------
       Initialization
       -------------------------------------------------------------------------- */
    function init() {
        loadAndOrderPatients();

        // Workspace tab switcher
        var tabBtns = document.querySelectorAll('.tab-nav-btn');
        var tabPanels = document.querySelectorAll('.tab-panel-content');

        tabBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var targetTab = this.getAttribute('data-tab');
                tabBtns.forEach(function(b) { b.classList.remove('active'); });
                tabPanels.forEach(function(p) { p.classList.remove('active'); });

                this.classList.add('active');
                var panel = document.getElementById(targetTab);
                if (panel) panel.classList.add('active');
            });
        });

        // Search & Filters in Grid View
        var searchInput = document.getElementById('trackSearch');
        if (searchInput) {
            searchInput.addEventListener('input', function(e) {
                searchTerm = e.target.value.trim();
                renderGridDirectory();
            });
        }

        initCustomSelect('filterClinicalStatusWrapper', function(val) {
            clinicalStatusFilter = val;
            renderGridDirectory();
        });

        initCustomSelect('filterTrackUrgencyWrapper', function(val) {
            urgencyFilter = val;
            renderGridDirectory();
        });

        initCustomSelect('trackSortOrderWrapper', function(val) {
            sortOrder = val;
            applySorting();
            renderGridDirectory();
        });

        var resetBtn = document.getElementById('resetTrackFiltersBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function() {
                searchTerm = '';
                clinicalStatusFilter = '';
                urgencyFilter = '';
                sortOrder = 'urgent_first';
                if (searchInput) searchInput.value = '';
                renderGridDirectory();
            });
        }

        // Custom Selects in Workspace
        initCustomSelect('labPriorityWrapper');
        initCustomSelect('rxFreqWrapper');
        initCustomSelect('rxRouteWrapper');
        initCustomSelect('wsPatientSwitcher');

        document.addEventListener('click', function() {
            document.querySelectorAll('.custom-select.active').forEach(function(el) {
                el.classList.remove('active');
            });
        });

        // Back to Grid Button
        var btnBackGrid = document.getElementById('btnBackToGrid');
        if (btnBackGrid) {
            btnBackGrid.addEventListener('click', function() {
                currentViewMode = 'grid';
                renderView();
            });
        }

        // Action Buttons
        var saveNoteBtn = document.getElementById('saveNoteBtn');
        var sendLabBtn = document.getElementById('sendLabOrderBtn');
        var sendNurseBtn = document.getElementById('sendNurseOrderBtn');
        var sendRxBtn = document.getElementById('sendPrescriptionBtn');

        if (saveNoteBtn) saveNoteBtn.addEventListener('click', saveClinicalNote);
        if (sendLabBtn) sendLabBtn.addEventListener('click', sendLabOrder);
        if (sendNurseBtn) sendNurseBtn.addEventListener('click', sendNurseOrder);
        if (sendRxBtn) sendRxBtn.addEventListener('click', sendPrescriptionOrder);

        var btnFinish = document.getElementById('btnSetFinished');
        var btnNext = document.getElementById('btnNextPatient');
        var btnGoQ = document.getElementById('btnGoToQueueFromGrid');

        if (btnFinish) btnFinish.addEventListener('click', finishConsultation);
        if (btnNext) btnNext.addEventListener('click', nextPatient);
        if (btnGoQ) btnGoQ.addEventListener('click', function() { window.location.href = 'queue.html'; });

        // Storage sync listener
        window.addEventListener('storage', function(e) {
            if (e.key === STORAGE_KEY_PATIENTS || e.key === STORAGE_KEY_LAB) {
                loadAndOrderPatients();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
