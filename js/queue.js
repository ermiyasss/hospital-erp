/**
 * MediTrack Hospital ERP - Streamlined Patient Queue Tracking (Card Layout)
 * Directly synchronized with clinic_patients_data in localStorage.
 * Only displays active patients (Pending and In Treatment). Finished patients are stored in Storage.
 * Powered by Tracking ID, 2-way ordering (Urgent First default vs Registry Order),
 * safety warning confirmation before queue reordering, and thermal ticket printing.
 */

(function() {
    'use strict';

    var STORAGE_KEY = 'clinic_patients_data';
    var patients = [];
    var searchTerm = '';
    var urgencyFilter = '';
    var currentOrderMode = 'urgent_first'; // Default: Urgent First
    var pendingOrderMode = null;
    var activeTicketPatient = null;

    /* --------------------------------------------------------------------------
       Modal Helpers & Parent Iframe Blur
       -------------------------------------------------------------------------- */
    function toggleBlur(state) {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ action: 'toggleBlur', state: state }, '*');
        }
    }

    function generateTrackingId() {
        return 'TRK-' + Math.floor(10000000 + Math.random() * 90000000);
    }

    /* --------------------------------------------------------------------------
       LocalStorage Synchronization
       -------------------------------------------------------------------------- */
    function loadPatientsFromStorage() {
        var data = localStorage.getItem(STORAGE_KEY);
        if (!data) {
            patients = [
                { id: 1, trackingId: generateTrackingId(), name: 'John Doe', age: 34, phone: '0912 345 678', weight: 70, height: 175, bp: '135/88', hr: 82, urgency: 'Urgent', status: 'In Treatment', description: 'Severe chest pain, undergoing tests.', registered: new Date().toISOString(), clinicalNotes: [], labOrders: [], nurseOrders: [] },
                { id: 2, trackingId: generateTrackingId(), name: 'Alice Smith', age: 28, phone: '0987 654 321', weight: 60, height: 160, bp: '118/76', hr: 74, urgency: 'Non-Urgent', status: 'Pending', description: 'Persistent cough and fever.', registered: new Date().toISOString(), clinicalNotes: [], labOrders: [], nurseOrders: [] },
                { id: 3, trackingId: generateTrackingId(), name: 'Bob Johnson', age: 45, phone: '0911 222 333', weight: 85, height: 180, bp: '122/80', hr: 68, urgency: 'Non-Urgent', status: 'Finished', description: 'Routine annual checkup completed.', registered: '2023-10-20T11:15:00Z', clinicalNotes: [], labOrders: [], nurseOrders: [] }
            ];
            savePatientsToStorage();
        } else {
            try {
                patients = JSON.parse(data);
                patients.forEach(function(p) {
                    if (p.urgency === 'High') p.urgency = 'Urgent';
                    else if (p.urgency === 'Medium' || p.urgency === 'Low') p.urgency = 'Non-Urgent';
                    if (!p.bp) p.bp = '120/80';
                    if (!p.hr) p.hr = 72;
                });
            } catch (e) {
                patients = [];
            }
        }
    }

    function savePatientsToStorage() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(patients));
    }

    /* --------------------------------------------------------------------------
       Filtering & 2-Way Queue Ordering (Only Non-Finished)
       -------------------------------------------------------------------------- */
    function getFilteredAndOrderedQueue() {
        // Exclude Finished patients (they live in Storage)
        var activePatients = patients.filter(function(p) {
            return p.status === 'Pending' || p.status === 'In Treatment';
        });

        var filtered = activePatients.filter(function(p) {
            var matchesSearch = true;
            if (searchTerm.trim() !== '') {
                var term = searchTerm.toLowerCase().trim();
                matchesSearch = (p.name && p.name.toLowerCase().includes(term)) ||
                                (p.trackingId && p.trackingId.toLowerCase().includes(term)) ||
                                (p.phone && p.phone.includes(term));
            }

            var matchesUrgency = (urgencyFilter === '') || (p.urgency === urgencyFilter);

            return matchesSearch && matchesUrgency;
        });

        // 2-Way Ordering
        if (currentOrderMode === 'urgent_first') {
            filtered.sort(function(a, b) {
                var weightA = (a.urgency === 'Urgent') ? 2 : 1;
                var weightB = (b.urgency === 'Urgent') ? 2 : 1;
                var diff = weightB - weightA;
                if (diff !== 0) return diff;
                return new Date(a.registered) - new Date(b.registered);
            });
        } else {
            filtered.sort(function(a, b) {
                return new Date(a.registered) - new Date(b.registered);
            });
        }

        return filtered;
    }

    function formatDate(isoString) {
        if (!isoString) return '-';
        var date = new Date(isoString);
        var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        var h = date.getHours();
        var m = String(date.getMinutes()).padStart(2, '0');
        var ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return dateStr + ' · ' + h + ':' + m + ' ' + ampm;
    }

    /* --------------------------------------------------------------------------
       Render Queue Cards
       -------------------------------------------------------------------------- */
    function renderQueueCards() {
        var grid = document.getElementById('queueCardGrid');
        var noDataDiv = document.getElementById('noQueueData');
        var totalCountEl = document.getElementById('queueTotalCount');
        if (!grid) return;

        var list = getFilteredAndOrderedQueue();

        var pendingCount = list.length;
        if (totalCountEl) totalCountEl.textContent = pendingCount + ' patient' + (pendingCount === 1 ? '' : 's');

        if (list.length === 0) {
            grid.innerHTML = '';
            if (noDataDiv) noDataDiv.style.display = 'block';
            return;
        }

        if (noDataDiv) noDataDiv.style.display = 'none';

        grid.innerHTML = list.map(function(p, index) {
            var statusClass = (p.status === 'In Treatment') ? 'status-treatment' : 'status-pending';
            var urgencyClass = (p.urgency === 'Urgent') ? 'urgency-urgent' : 'urgency-nonurgent';
            var queuePos = '#' + String(index + 1).padStart(2, '0');

            return '<div class="queue-card" data-id="' + p.id + '">' +
                '<div class="qcard-top">' +
                    '<div class="qcard-left-head">' +
                        '<span class="queue-pos-badge">' + queuePos + '</span>' +
                        '<span class="tracking-id">' + p.trackingId + '</span>' +
                    '</div>' +
                    '<span class="badge ' + urgencyClass + '">' + p.urgency + '</span>' +
                '</div>' +
                '<div class="qcard-body">' +
                    '<h4 class="qcard-name">' + p.name + '</h4>' +
                    '<div class="qcard-meta-row">' +
                        '<span>Age: ' + p.age + '</span>' +
                        '<span>•</span>' +
                        '<span>Phone: ' + (p.phone || '-') + '</span>' +
                        '<span>•</span>' +
                        '<span>BP: ' + (p.bp || '-') + '</span>' +
                    '</div>' +
                    '<p class="qcard-desc" title="' + (p.description || '') + '">' + (p.description || 'No complaint specified.') + '</p>' +
                '</div>' +
                '<div class="qcard-bottom">' +
                    '<div style="display:flex; align-items:center; gap:6px;">' +
                        '<span class="badge ' + statusClass + '">' + p.status + '</span>' +
                        '<span style="font-size:11px; color:var(--gray-muted);">' + formatDate(p.registered) + '</span>' +
                    '</div>' +
                    '<div class="qcard-actions">' +
                        (p.status === 'Pending' ? 
                            '<button class="action-btn btn-action-treat" data-id="' + p.id + '" title="Start Treatment">' +
                                '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
                            '</button>' : '') +
                        (p.status === 'In Treatment' ? 
                            '<button class="action-btn btn-action-finish" data-id="' + p.id + '" title="Mark Finished (Move to Storage)">' +
                                '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' +
                            '</button>' : '') +
                        '<button class="action-btn btn-action-ticket" data-id="' + p.id + '" data-pos="' + queuePos + '" title="Print Queue Ticket">' +
                            '<svg viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>' +
                        '</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }).join('');

        // Attach action handlers
        grid.querySelectorAll('.btn-action-treat').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var pId = parseInt(this.getAttribute('data-id'), 10);
                updatePatientStatus(pId, 'In Treatment');
                sessionStorage.setItem('selected_tracking_patient_id', pId);
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ action: 'navigate', target: 'pages/track.html', title: 'Tracking' }, '*');
                } else {
                    window.location.href = 'track.html';
                }
            });
        });

        grid.querySelectorAll('.btn-action-finish').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var pId = parseInt(this.getAttribute('data-id'), 10);
                updatePatientStatus(pId, 'Finished');
                if (window.MediTrackNotify) {
                    var p = patients.find(function(x) { return x.id === pId; });
                    window.MediTrackNotify('Treatment Finished', (p ? p.name : 'Patient') + ' moved to Storage archive.', 'success');
                }
            });
        });

        grid.querySelectorAll('.btn-action-ticket').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var pId = parseInt(this.getAttribute('data-id'), 10);
                var pos = this.getAttribute('data-pos');
                openTicketModal(pId, pos);
            });
        });
    }

    function updatePatientStatus(patientId, newStatus) {
        var patient = patients.find(function(p) { return p.id === patientId; });
        if (patient) {
            patient.status = newStatus;
            savePatientsToStorage();
            renderQueueCards();
        }
    }

    /* --------------------------------------------------------------------------
       Queue Order Change Warning Confirmation
       -------------------------------------------------------------------------- */
    function promptOrderChange(newMode) {
        if (newMode === currentOrderMode) return;

        pendingOrderMode = newMode;
        var modeName = (newMode === 'urgent_first') ? 'Urgent First (Default)' : 'Registry Order (FIFO)';
        document.getElementById('newOrderModeText').textContent = modeName;

        document.getElementById('orderWarningModal').classList.add('active');
        toggleBlur(true);
    }

    function confirmOrderChange() {
        if (pendingOrderMode) {
            currentOrderMode = pendingOrderMode;
            pendingOrderMode = null;

            var wrap = document.getElementById('queueOrderWrapper');
            if (wrap) {
                var toggle = wrap.querySelector('.cs-toggle');
                var text = (currentOrderMode === 'urgent_first') ? 'Order: Urgent First' : 'Order: Registry Order';
                toggle.querySelector('.cs-text').textContent = text;
                toggle.setAttribute('data-value', currentOrderMode);

                wrap.querySelectorAll('.cs-option').forEach(function(opt) {
                    opt.classList.toggle('selected', opt.getAttribute('data-value') === currentOrderMode);
                });
            }

            var noticeText = document.getElementById('orderNoticeText');
            if (noticeText) {
                if (currentOrderMode === 'urgent_first') {
                    noticeText.innerHTML = 'Current Order: <strong>Urgent First</strong> (Urgent patients prioritized first, then registration time).';
                } else {
                    noticeText.innerHTML = 'Current Order: <strong>Registry Order (FIFO)</strong> (Strict registration timestamp order; new arrivals wait).';
                }
            }

            renderQueueCards();
        }
        closeOrderWarningModal();
    }

    function cancelOrderChange() {
        pendingOrderMode = null;

        var wrap = document.getElementById('queueOrderWrapper');
        if (wrap) {
            var toggle = wrap.querySelector('.cs-toggle');
            var text = (currentOrderMode === 'urgent_first') ? 'Order: Urgent First' : 'Order: Registry Order';
            toggle.querySelector('.cs-text').textContent = text;
            toggle.setAttribute('data-value', currentOrderMode);

            wrap.querySelectorAll('.cs-option').forEach(function(opt) {
                opt.classList.toggle('selected', opt.getAttribute('data-value') === currentOrderMode);
            });
        }

        closeOrderWarningModal();
    }

    function closeOrderWarningModal() {
        document.getElementById('orderWarningModal').classList.remove('active');
        toggleBlur(false);
    }

    /* --------------------------------------------------------------------------
       Thermal Ticket Modal
       -------------------------------------------------------------------------- */
    function openTicketModal(patientId, queuePos) {
        var patient = patients.find(function(p) { return p.id === patientId; });
        if (!patient) return;

        activeTicketPatient = patient;

        document.getElementById('ticketQueueNumber').textContent = queuePos || '#01';
        document.getElementById('ticketTrackingId').textContent = patient.trackingId;
        document.getElementById('ticketPatientName').textContent = patient.name;
        document.getElementById('ticketAge').textContent = patient.age;
        document.getElementById('ticketPhone').textContent = patient.phone || '-';
        document.getElementById('ticketStatus').textContent = patient.status;
        document.getElementById('ticketRegistered').textContent = formatDate(patient.registered);
        document.getElementById('ticketDesc').textContent = patient.description || 'Medical checkup';
        document.getElementById('ticketBarcodeText').textContent = patient.trackingId;

        var urgTag = document.getElementById('ticketUrgencyTag');
        if (urgTag) {
            urgTag.textContent = 'URGENCY: ' + patient.urgency.toUpperCase();
            urgTag.style.color = (patient.urgency === 'Urgent') ? 'var(--primary-red)' : 'var(--text-dark)';
        }

        document.getElementById('ticketModal').classList.add('active');
        toggleBlur(true);
    }

    function closeTicketModal() {
        document.getElementById('ticketModal').classList.remove('active');
        toggleBlur(false);
        activeTicketPatient = null;
    }

    /* --------------------------------------------------------------------------
       Custom Select Dropdowns
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
        loadPatientsFromStorage();
        renderQueueCards();

        initCustomSelect('filterUrgencyWrapper', function(val) {
            urgencyFilter = val;
            renderQueueCards();
        });

        initCustomSelect('queueOrderWrapper', function(val) {
            promptOrderChange(val);
        });

        document.addEventListener('click', function() {
            document.querySelectorAll('.custom-select.active').forEach(function(el) {
                el.classList.remove('active');
            });
        });

        var searchInput = document.getElementById('queueSearch');
        var clearSearchBtn = document.getElementById('clearSearchBtn');
        if (searchInput) {
            searchInput.addEventListener('input', function(e) {
                searchTerm = e.target.value;
                if (clearSearchBtn) {
                    clearSearchBtn.style.display = searchTerm ? 'block' : 'none';
                }
                renderQueueCards();
            });
        }
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', function() {
                if (searchInput) {
                    searchInput.value = '';
                    searchTerm = '';
                    clearSearchBtn.style.display = 'none';
                    renderQueueCards();
                }
            });
        }

        var resetBtn = document.getElementById('resetFiltersBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function() {
                searchTerm = '';
                urgencyFilter = '';
                if (searchInput) searchInput.value = '';
                if (clearSearchBtn) clearSearchBtn.style.display = 'none';

                var uWrap = document.getElementById('filterUrgencyWrapper');
                if (uWrap) {
                    uWrap.querySelector('.cs-text').textContent = 'All Urgencies';
                    uWrap.querySelector('.cs-toggle').setAttribute('data-value', '');
                }

                renderQueueCards();
            });
        }

        var confirmOrderBtn = document.getElementById('confirmOrderChangeBtn');
        var cancelOrderBtn = document.getElementById('cancelOrderChangeBtn');
        var closeOrderWarningBtn = document.getElementById('closeOrderWarningBtn');

        if (confirmOrderBtn) confirmOrderBtn.addEventListener('click', confirmOrderChange);
        if (cancelOrderBtn) cancelOrderBtn.addEventListener('click', cancelOrderChange);
        if (closeOrderWarningBtn) closeOrderWarningBtn.addEventListener('click', cancelOrderChange);

        var closeTicketBtn = document.getElementById('closeTicketBtn');
        var closeTicketModalBtn = document.getElementById('closeTicketModalBtn');
        var printTicketActionBtn = document.getElementById('printTicketActionBtn');

        if (closeTicketBtn) closeTicketBtn.addEventListener('click', closeTicketModal);
        if (closeTicketModalBtn) closeTicketModalBtn.addEventListener('click', closeTicketModal);
        if (printTicketActionBtn) {
            printTicketActionBtn.addEventListener('click', function() {
                window.print();
            });
        }

        window.addEventListener('storage', function(e) {
            if (e.key === STORAGE_KEY) {
                loadPatientsFromStorage();
                renderQueueCards();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
