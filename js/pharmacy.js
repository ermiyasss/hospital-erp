/**
 * MediTrack Hospital ERP - Pharmacy & Dispensary Logic
 * Reads clinic_prescriptions_data from localStorage, renders prescription cards,
 * handles dispensing workflow, and generates printable Rx voucher slips.
 */

(function() {
    'use strict';

    var STORAGE_KEY = 'clinic_prescriptions_data';
    var allPrescriptions = [];
    var currentTab = 'pending'; // 'pending' or 'dispensed'
    var searchTerm = '';
    var routeFilter = '';

    function loadPrescriptions() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            allPrescriptions = raw ? JSON.parse(raw) : [];
        } catch (e) {
            allPrescriptions = [];
        }
        updateCounts();
        renderCards();
    }

    function savePrescriptions() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(allPrescriptions));
    }

    function updateCounts() {
        var pending = allPrescriptions.filter(function(rx) { return rx.status !== 'Dispensed'; });
        var dispensed = allPrescriptions.filter(function(rx) { return rx.status === 'Dispensed'; });

        var el1 = document.getElementById('pharmPendingCount');
        var el2 = document.getElementById('pharmFulfilledCount');
        var el3 = document.getElementById('tabPendingCount');
        var el4 = document.getElementById('tabDispensedCount');

        if (el1) el1.textContent = pending.length;
        if (el2) el2.textContent = dispensed.length;
        if (el3) el3.textContent = pending.length;
        if (el4) el4.textContent = dispensed.length;
    }

    function formatDate(iso) {
        if (!iso) return '-';
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatTime(iso) {
        if (!iso) return '-';
        var d = new Date(iso);
        var h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
        var ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return h + ':' + m + ' ' + ampm;
    }

    function renderCards() {
        var grid = document.getElementById('prescriptionsCardGrid');
        var noData = document.getElementById('noPharmData');
        if (!grid) return;

        var sourceList = allPrescriptions.filter(function(rx) {
            if (currentTab === 'pending') return rx.status !== 'Dispensed';
            return rx.status === 'Dispensed';
        });

        var filtered = sourceList.filter(function(rx) {
            var matchesRoute = !routeFilter || rx.route === routeFilter;
            var matchesSearch = true;
            if (searchTerm) {
                var q = searchTerm.toLowerCase();
                matchesSearch = (rx.patientName && rx.patientName.toLowerCase().includes(q)) ||
                                (rx.trackingId && rx.trackingId.toLowerCase().includes(q)) ||
                                (rx.medication && rx.medication.toLowerCase().includes(q)) ||
                                (rx.doctor && rx.doctor.toLowerCase().includes(q));
            }
            return matchesRoute && matchesSearch;
        });

        if (filtered.length === 0) {
            grid.innerHTML = '';
            if (noData) noData.style.display = 'block';
            return;
        }
        if (noData) noData.style.display = 'none';

        grid.innerHTML = filtered.map(function(rx) {
            var isDispensed = rx.status === 'Dispensed';
            var statusClass = isDispensed ? 'status-dispensed' : 'status-prescribed';
            var cardClass = isDispensed ? ' dispensed-card' : '';

            var actionsHtml = '';
            if (!isDispensed) {
                actionsHtml =
                    '<button type="button" class="btn-pharm-action btn-dispense" data-id="' + rx.id + '">' +
                        '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>' +
                        '<span>Dispense</span>' +
                    '</button>' +
                    '<button type="button" class="btn-pharm-action btn-print-slip" data-id="' + rx.id + '">' +
                        '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>' +
                        '<span>Print Slip</span>' +
                    '</button>';
            } else {
                actionsHtml =
                    '<button type="button" class="btn-pharm-action btn-print-slip" data-id="' + rx.id + '">' +
                        '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>' +
                        '<span>Print Slip</span>' +
                    '</button>';
            }

            return '<div class="rx-card' + cardClass + '">' +
                '<div class="rcard-top">' +
                    '<div class="rcard-patient-info">' +
                        '<h4 class="rcard-pname">' + rx.patientName + '</h4>' +
                        '<span class="rcard-pmeta"><span class="tid">' + rx.trackingId + '</span> · Prescribed by ' + (rx.doctor || 'Dr. Sarah Chen') + '</span>' +
                    '</div>' +
                    '<span class="badge ' + statusClass + '">' + rx.status + '</span>' +
                '</div>' +

                '<div class="rcard-med-box">' +
                    '<div class="rcard-med-name-row">' +
                        '<h4 class="rcard-med-name">℞ ' + rx.medication + '</h4>' +
                        '<span class="rcard-dosage">' + rx.dosage + '</span>' +
                    '</div>' +
                    '<div class="rcard-regimen-pills">' +
                        '<span class="reg-pill">' + rx.frequency + '</span>' +
                        '<span class="reg-pill">Route: ' + rx.route + '</span>' +
                        (rx.duration ? '<span class="reg-pill">Duration: ' + rx.duration + '</span>' : '') +
                    '</div>' +
                '</div>' +

                (rx.instructions ? '<div class="rcard-instructions"><strong>Instructions:</strong> ' + rx.instructions + '</div>' : '') +

                '<div class="rcard-footer">' +
                    '<span class="rcard-time">' + formatTime(rx.time) + ' · ' + formatDate(rx.time) + '</span>' +
                    '<div class="rcard-actions">' + actionsHtml + '</div>' +
                '</div>' +
            '</div>';
        }).join('');

        // Attach handlers
        grid.querySelectorAll('.btn-dispense').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                dispenseMedication(parseInt(this.getAttribute('data-id'), 10));
            });
        });

        grid.querySelectorAll('.btn-print-slip').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                openPrescriptionSlip(parseInt(this.getAttribute('data-id'), 10));
            });
        });
    }

    function dispenseMedication(rxId) {
        var rx = allPrescriptions.find(function(r) { return r.id === rxId; });
        if (!rx) return;
        rx.status = 'Dispensed';
        rx.dispensedAt = new Date().toISOString();
        savePrescriptions();
        updateCounts();
        renderCards();

        if (window.MediTrackNotify) {
            window.MediTrackNotify.push(
                'Medication Dispensed',
                rx.medication + ' (' + rx.dosage + ') dispensed to ' + rx.patientName + '.',
                'success',
                'Prescription'
            );
        }
    }

    function openPrescriptionSlip(rxId) {
        var rx = allPrescriptions.find(function(r) { return r.id === rxId; });
        if (!rx) return;

        document.getElementById('rxPatientName').textContent = rx.patientName;
        document.getElementById('rxTrackingId').textContent = rx.trackingId;
        document.getElementById('rxDoctorName').textContent = (rx.doctor || 'Dr. Sarah Chen') + ' (Attending Physician)';
        document.getElementById('rxDateTime').textContent = formatDate(rx.time) + ' · ' + formatTime(rx.time);
        document.getElementById('rxMedName').textContent = rx.medication;
        document.getElementById('rxDosage').textContent = rx.dosage;
        document.getElementById('rxFrequency').textContent = rx.frequency;
        document.getElementById('rxRoute').textContent = rx.route;
        document.getElementById('rxDuration').textContent = rx.duration || 'As directed';
        document.getElementById('rxInstructions').textContent = rx.instructions || 'Follow prescribed regimen. Consult doctor if adverse reactions occur.';
        document.getElementById('rxBarcodeNumber').textContent = rx.trackingId + '-RX-' + rx.id;

        var modal = document.getElementById('prescriptionModal');
        if (modal) modal.classList.add('active');
    }

    function closeRxModal() {
        var modal = document.getElementById('prescriptionModal');
        if (modal) modal.classList.remove('active');
    }

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
                toggle.querySelector('.cs-text').textContent = this.textContent;
                toggle.setAttribute('data-value', val);
                menu.querySelectorAll('.cs-option').forEach(function(o) { o.classList.remove('selected'); });
                this.classList.add('selected');
                wrapper.classList.remove('active');
                if (callback) callback(val);
            });
        });
    }

    function init() {
        loadPrescriptions();

        // Tab switching
        document.querySelectorAll('.pharm-tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.pharm-tab-btn').forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentTab = this.getAttribute('data-tab');
                renderCards();
            });
        });

        initCustomSelect('filterRouteWrapper', function(val) {
            routeFilter = val;
            renderCards();
        });

        document.addEventListener('click', function() {
            document.querySelectorAll('.custom-select.active').forEach(function(el) { el.classList.remove('active'); });
        });

        var searchInput = document.getElementById('pharmSearch');
        var clearBtn = document.getElementById('clearSearchBtn');
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                searchTerm = this.value;
                if (clearBtn) clearBtn.style.display = searchTerm ? 'block' : 'none';
                renderCards();
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                if (searchInput) { searchInput.value = ''; searchTerm = ''; clearBtn.style.display = 'none'; renderCards(); }
            });
        }

        var resetBtn = document.getElementById('resetPharmFiltersBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function() {
                searchTerm = '';
                routeFilter = '';
                if (searchInput) searchInput.value = '';
                renderCards();
            });
        }

        // Modal listeners
        var closeBtn1 = document.getElementById('closeRxModalBtn');
        var closeBtn2 = document.getElementById('closeRxModalFooterBtn');
        var printBtn = document.getElementById('printRxSlipBtn');

        if (closeBtn1) closeBtn1.addEventListener('click', closeRxModal);
        if (closeBtn2) closeBtn2.addEventListener('click', closeRxModal);
        if (printBtn) printBtn.addEventListener('click', function() { window.print(); });

        document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
            overlay.addEventListener('click', function(e) { if (e.target === overlay) closeRxModal(); });
        });

        window.addEventListener('storage', function(e) {
            if (e.key === STORAGE_KEY) loadPrescriptions();
        });
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
