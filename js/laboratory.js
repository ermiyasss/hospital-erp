/**
 * MediTrack Hospital ERP - Diagnostic Laboratory & Pathology Logic
 * Synchronized with clinic_lab_requests, clinic_lab_archive & clinic_patients_data in localStorage.
 * Handles specimen testing progression, auto-clearing completed results into archive & storage,
 * modal dialogs, and official pathology report printing.
 */

(function() {
    'use strict';

    var STORAGE_KEY_LAB = 'clinic_lab_requests';
    var STORAGE_KEY_ARCHIVE = 'clinic_lab_archive';
    var STORAGE_KEY_PATIENTS = 'clinic_patients_data';

    var activeLabOrders = [];
    var archivedLabOrders = [];
    var currentTab = 'active'; // 'active' or 'archive'

    var searchTerm = '';
    var statusFilter = '';
    var priorityFilter = '';
    var activeOrder = null;

    /* --------------------------------------------------------------------------
       LocalStorage Synchronization
       -------------------------------------------------------------------------- */
    function loadLabData() {
        // Load active
        try {
            var raw = localStorage.getItem(STORAGE_KEY_LAB);
            activeLabOrders = raw ? JSON.parse(raw) : [];
        } catch (e) {
            activeLabOrders = [];
        }

        // Load archive
        try {
            var rawArchive = localStorage.getItem(STORAGE_KEY_ARCHIVE);
            archivedLabOrders = rawArchive ? JSON.parse(rawArchive) : [];
        } catch (e) {
            archivedLabOrders = [];
        }

        // If active has completed items from legacy, move them to archive
        var stillActive = [];
        activeLabOrders.forEach(function(order) {
            if (order.status === 'Completed') {
                if (!archivedLabOrders.some(function(a) { return a.id === order.id; })) {
                    archivedLabOrders.unshift(order);
                }
            } else {
                stillActive.push(order);
            }
        });
        activeLabOrders = stillActive;

        // If completely empty initially, seed sample
        if (activeLabOrders.length === 0 && archivedLabOrders.length === 0) {
            activeLabOrders = [
                {
                    id: 1001,
                    patientId: 1,
                    trackingId: 'TRK-10293847',
                    patientName: 'John Doe',
                    age: 34,
                    phone: '0912 345 678',
                    test: 'Cardiac Enzymes (Troponin I) & 12-Lead ECG',
                    priority: 'Urgent',
                    note: 'Severe chest pain radiating to shoulder. Please expedite STAT.',
                    doctor: 'Dr. Sarah Chen',
                    time: new Date(Date.now() - 25 * 60000).toISOString(),
                    status: 'In Progress',
                    results: ''
                },
                {
                    id: 1002,
                    patientId: 2,
                    trackingId: 'TRK-77123901',
                    patientName: 'Alice Smith',
                    age: 28,
                    phone: '0987 654 321',
                    test: 'Complete Blood Count (CBC) & Sputum Analysis',
                    priority: 'Routine',
                    note: 'Persistent cough for 3 days. Check WBC count.',
                    doctor: 'Dr. Sarah Chen',
                    time: new Date(Date.now() - 15 * 60000).toISOString(),
                    status: 'Requested',
                    results: ''
                }
            ];
            archivedLabOrders = [
                {
                    id: 1003,
                    patientId: 3,
                    trackingId: 'TRK-33418721',
                    patientName: 'Bob Johnson',
                    age: 45,
                    phone: '0911 222 333',
                    test: 'Fasting Lipid Profile & Blood Glucose',
                    priority: 'Routine',
                    note: 'Annual checkup routine diagnostic screen.',
                    doctor: 'Dr. Sarah Chen',
                    time: new Date(Date.now() - 120 * 60000).toISOString(),
                    status: 'Completed',
                    results: 'Total Cholesterol: 185 mg/dL, Triglycerides: 140 mg/dL, HDL: 52 mg/dL, LDL: 105 mg/dL. Fasting Blood Glucose: 92 mg/dL.'
                }
            ];
            saveLabData();
        }

        updateHeaderCounts();
        renderCards();
    }

    function saveLabData() {
        localStorage.setItem(STORAGE_KEY_LAB, JSON.stringify(activeLabOrders));
        localStorage.setItem(STORAGE_KEY_ARCHIVE, JSON.stringify(archivedLabOrders));
    }

    function updateHeaderCounts() {
        var activeCountEl = document.getElementById('labActiveCount');
        var compCountEl = document.getElementById('labCompletedCount');
        var tabActiveEl = document.getElementById('tabActiveCount');
        var tabArchEl = document.getElementById('tabArchiveCount');

        if (activeCountEl) activeCountEl.textContent = activeLabOrders.length;
        if (compCountEl) compCountEl.textContent = archivedLabOrders.length;
        if (tabActiveEl) tabActiveEl.textContent = activeLabOrders.length;
        if (tabArchEl) tabArchEl.textContent = archivedLabOrders.length;
    }

    function syncResultToPatientFile(labOrder) {
        var raw = localStorage.getItem(STORAGE_KEY_PATIENTS);
        if (!raw) return;
        try {
            var patients = JSON.parse(raw);
            var patient = patients.find(function(p) { return p.id === labOrder.patientId || p.trackingId === labOrder.trackingId; });
            if (patient) {
                if (!patient.labOrders) patient.labOrders = [];
                var existingOrder = patient.labOrders.find(function(o) { return o.id === labOrder.id; });
                if (existingOrder) {
                    existingOrder.status = 'Completed';
                    existingOrder.results = labOrder.results;
                    existingOrder.techRemarks = labOrder.techRemarks;
                } else {
                    patient.labOrders.push(labOrder);
                }
                localStorage.setItem(STORAGE_KEY_PATIENTS, JSON.stringify(patients));
            }
        } catch (e) {}
    }

    /* --------------------------------------------------------------------------
       Render Lab Cards
       -------------------------------------------------------------------------- */
    function formatDate(isoString) {
        if (!isoString) return '-';
        return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

    function renderCards() {
        var grid = document.getElementById('labCardGrid');
        var noData = document.getElementById('noLabData');
        if (!grid) return;

        var sourceList = currentTab === 'active' ? activeLabOrders : archivedLabOrders;

        var filtered = sourceList.filter(function(order) {
            var matchesStatus = !statusFilter || order.status === statusFilter;
            var matchesPriority = !priorityFilter || order.priority === priorityFilter;
            var matchesSearch = true;
            if (searchTerm) {
                var q = searchTerm.toLowerCase();
                matchesSearch = (order.patientName && order.patientName.toLowerCase().includes(q)) ||
                                (order.trackingId && order.trackingId.toLowerCase().includes(q)) ||
                                (order.test && order.test.toLowerCase().includes(q)) ||
                                (order.doctor && order.doctor.toLowerCase().includes(q));
            }
            return matchesStatus && matchesPriority && matchesSearch;
        });

        if (filtered.length === 0) {
            grid.innerHTML = '';
            if (noData) noData.style.display = 'block';
            return;
        }

        if (noData) noData.style.display = 'none';

        grid.innerHTML = filtered.map(function(order) {
            var statusClass = order.status === 'Completed' ? 'status-completed' : (order.status === 'In Progress' ? 'status-inprogress' : 'status-requested');
            var urgencyClass = order.priority === 'Urgent' ? 'urgency-urgent' : 'urgency-routine';
            var isUrgentCard = order.priority === 'Urgent' ? ' urgent-card' : '';

            var actionsHtml = '';
            if (order.status === 'Requested') {
                actionsHtml =
                    '<button type="button" class="btn-lab-action btn-start-test" data-id="' + order.id + '">' +
                        '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>' +
                        '<span>Start Analysis</span>' +
                    '</button>' +
                    '<button type="button" class="btn-lab-action btn-enter-results" data-id="' + order.id + '">' +
                        '<span>Enter Results</span>' +
                    '</button>';
            } else if (order.status === 'In Progress') {
                actionsHtml =
                    '<button type="button" class="btn-lab-action btn-enter-results" data-id="' + order.id + '">' +
                        '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                        '<span>Enter Results</span>' +
                    '</button>';
            } else {
                actionsHtml =
                    '<button type="button" class="btn-lab-action btn-view-report" data-id="' + order.id + '">' +
                        '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' +
                        '<span>View Pathology Report</span>' +
                    '</button>';
            }

            return '<div class="lab-card' + isUrgentCard + '">' +
                '<div class="lcard-top">' +
                    '<div class="lcard-patient-info">' +
                        '<h4 class="lcard-pname">' + order.patientName + '</h4>' +
                        '<span class="lcard-pmeta">' + order.age + ' yrs · <span class="tid">' + order.trackingId + '</span> · ' + (order.phone || '') + '</span>' +
                    '</div>' +
                    '<div class="lcard-badges">' +
                        '<span class="badge ' + statusClass + '">' + order.status + '</span>' +
                        '<span class="badge ' + urgencyClass + '">' + order.priority + '</span>' +
                    '</div>' +
                '</div>' +

                '<div class="lcard-test-box">' +
                    '<span class="lcard-test-label">Investigation</span>' +
                    '<strong class="lcard-test-name">' + order.test + '</strong>' +
                '</div>' +

                (order.note ? '<div class="lcard-note"><strong>Dr. Instruction:</strong> ' + order.note + '</div>' : '') +
                (order.results ? '<div class="lcard-result-preview"><strong>Findings:</strong> ' + order.results + '</div>' : '') +

                '<div class="lcard-footer">' +
                    '<span class="lcard-time">' + formatTime12h(order.time) + ' · ' + formatDate(order.time) + '</span>' +
                    '<div class="lcard-actions">' + actionsHtml + '</div>' +
                '</div>' +
            '</div>';
        }).join('');

        // Attach action handlers
        grid.querySelectorAll('.btn-start-test').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = parseInt(this.getAttribute('data-id'), 10);
                updateOrderStatus(id, 'In Progress');
            });
        });

        grid.querySelectorAll('.btn-enter-results').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = parseInt(this.getAttribute('data-id'), 10);
                openResultModal(id);
            });
        });

        grid.querySelectorAll('.btn-view-report').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = parseInt(this.getAttribute('data-id'), 10);
                openReportModal(id);
            });
        });
    }

    function updateOrderStatus(orderId, newStatus) {
        var order = activeLabOrders.find(function(o) { return o.id === orderId; });
        if (order) {
            order.status = newStatus;
            saveLabData();
            syncResultToPatientFile(order);
            renderCards();

            if (window.MediTrackNotify) {
                window.MediTrackNotify.push(
                    'Test Status: ' + newStatus,
                    order.test + ' for ' + order.patientName + ' is now ' + newStatus.toLowerCase() + '.',
                    'info',
                    'Lab'
                );
            }
        }
    }

    /* --------------------------------------------------------------------------
       Modal 1: Enter / Submit Lab Results
       -------------------------------------------------------------------------- */
    function openResultModal(orderId) {
        var order = activeLabOrders.find(function(o) { return o.id === orderId; }) ||
                    archivedLabOrders.find(function(o) { return o.id === orderId; });
        if (!order) return;

        activeOrder = order;

        document.getElementById('resPatientName').textContent = order.patientName;
        document.getElementById('resTrackingId').textContent = order.trackingId;
        document.getElementById('resTestName').textContent = order.test;
        document.getElementById('resDoctorNote').textContent = order.note || 'Routine test request.';
        document.getElementById('inputTestResults').value = order.results || '';
        document.getElementById('inputTechRemarks').value = order.techRemarks || '';

        var modal = document.getElementById('resultModal');
        if (modal) modal.classList.add('active');
    }

    function closeResultModal() {
        var modal = document.getElementById('resultModal');
        if (modal) modal.classList.remove('active');
        activeOrder = null;
    }

    function saveResults() {
        if (!activeOrder) return;

        var resultsVal = document.getElementById('inputTestResults').value.trim();
        var remarksVal = document.getElementById('inputTechRemarks').value.trim();

        if (!resultsVal) {
            alert('Please document laboratory test values / clinical findings.');
            return;
        }

        activeOrder.results = resultsVal;
        activeOrder.techRemarks = remarksVal;
        activeOrder.status = 'Completed';

        // Remove from active list and place in archive
        activeLabOrders = activeLabOrders.filter(function(o) { return o.id !== activeOrder.id; });
        if (!archivedLabOrders.some(function(a) { return a.id === activeOrder.id; })) {
            archivedLabOrders.unshift(activeOrder);
        }

        saveLabData();
        syncResultToPatientFile(activeOrder);
        updateHeaderCounts();
        renderCards();
        closeResultModal();

        if (window.MediTrackNotify) {
            window.MediTrackNotify.push(
                'Lab Results Ready',
                activeOrder.test + ' results for ' + activeOrder.patientName + ' (' + activeOrder.trackingId + ') completed & dispatched to doctor.',
                'success',
                'Lab'
            );
        }
    }

    /* --------------------------------------------------------------------------
       Modal 2: View & Print Pathology Report
       -------------------------------------------------------------------------- */
    function openReportModal(orderId) {
        var order = archivedLabOrders.find(function(o) { return o.id === orderId; }) ||
                    activeLabOrders.find(function(o) { return o.id === orderId; });
        if (!order) return;

        document.getElementById('repPatientName').textContent = order.patientName;
        document.getElementById('repTrackingId').textContent = order.trackingId;
        document.getElementById('repAgePhone').textContent = order.age + ' yrs · ' + (order.phone || '-');
        document.getElementById('repDoctor').textContent = order.doctor || 'Dr. Sarah Chen';
        document.getElementById('repDateTime').textContent = formatDate(order.time) + ' · ' + formatTime12h(order.time);
        document.getElementById('repTestName').textContent = order.test;
        document.getElementById('repResultsContent').textContent = order.results || 'No test values documented.';

        var remarksWrap = document.getElementById('repRemarksWrap');
        var remarksContent = document.getElementById('repRemarksContent');
        if (order.techRemarks) {
            if (remarksWrap) remarksWrap.style.display = 'flex';
            if (remarksContent) remarksContent.textContent = order.techRemarks;
        } else {
            if (remarksWrap) remarksWrap.style.display = 'none';
        }

        var modal = document.getElementById('reportModal');
        if (modal) modal.classList.add('active');
    }

    function closeReportModal() {
        var modal = document.getElementById('reportModal');
        if (modal) modal.classList.remove('active');
    }

    function printReport() {
        window.print();
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
                toggle.querySelector('.cs-text').textContent = text;
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
        loadLabData();

        // Tab Switching
        var tabBtns = document.querySelectorAll('.lab-tab-btn');
        tabBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                tabBtns.forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentTab = this.getAttribute('data-tab');
                renderCards();
            });
        });

        // Filters
        initCustomSelect('filterStatusWrapper', function(val) {
            statusFilter = val;
            renderCards();
        });

        initCustomSelect('filterPriorityWrapper', function(val) {
            priorityFilter = val;
            renderCards();
        });

        document.addEventListener('click', function() {
            document.querySelectorAll('.custom-select.active').forEach(function(el) {
                el.classList.remove('active');
            });
        });

        var searchInput = document.getElementById('labSearch');
        var clearSearchBtn = document.getElementById('clearSearchBtn');
        if (searchInput) {
            searchInput.addEventListener('input', function(e) {
                searchTerm = e.target.value;
                if (clearSearchBtn) clearSearchBtn.style.display = searchTerm ? 'block' : 'none';
                renderCards();
            });
        }
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', function() {
                if (searchInput) {
                    searchInput.value = '';
                    searchTerm = '';
                    clearSearchBtn.style.display = 'none';
                    renderCards();
                }
            });
        }

        var resetBtn = document.getElementById('resetFiltersBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function() {
                searchTerm = '';
                statusFilter = '';
                priorityFilter = '';
                if (searchInput) searchInput.value = '';
                renderCards();
            });
        }

        // Modal Listeners
        var closeResBtn = document.getElementById('closeResultBtn');
        var cancelResBtn = document.getElementById('cancelResultBtn');
        var saveResBtn = document.getElementById('saveResultBtn');
        var closeRepBtn = document.getElementById('closeReportBtn');
        var closeRepModalBtn = document.getElementById('closeReportModalBtn');
        var printRepBtn = document.getElementById('printReportBtn');

        if (closeResBtn) closeResBtn.addEventListener('click', closeResultModal);
        if (cancelResBtn) cancelResBtn.addEventListener('click', closeResultModal);
        if (saveResBtn) saveResBtn.addEventListener('click', saveResults);
        if (closeRepBtn) closeRepBtn.addEventListener('click', closeReportModal);
        if (closeRepModalBtn) closeRepModalBtn.addEventListener('click', closeReportModal);
        if (printRepBtn) printRepBtn.addEventListener('click', printReport);

        // Background click to close modals
        document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) {
                    overlay.classList.remove('active');
                }
            });
        });

        window.addEventListener('storage', function(e) {
            if (e.key === STORAGE_KEY_LAB) {
                loadLabData();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
