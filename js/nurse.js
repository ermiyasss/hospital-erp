/**
 * MediTrack Hospital ERP - Nurse Station Logic
 * Reads nursing orders from clinic_patients_data and admin directives from
 * clinic_nurse_directives. Allows nurses to complete tasks and acknowledge admin messages.
 */

(function() {
    'use strict';

    var PATIENTS_KEY = 'clinic_patients_data';
    var DIRECTIVES_KEY = 'clinic_nurse_directives';

    var activeOrders = [];
    var completedOrders = [];
    var directives = [];
    var currentTab = 'orders';
    var searchTerm = '';

    function loadData() {
        activeOrders = [];
        completedOrders = [];

        try {
            var raw = localStorage.getItem(PATIENTS_KEY);
            var patients = raw ? JSON.parse(raw) : [];

            patients.forEach(function(p) {
                if (!p.nurseOrders) return;
                p.nurseOrders.forEach(function(order) {
                    var entry = {
                        orderId: order.id,
                        patientId: p.id,
                        patientName: p.name,
                        trackingId: p.trackingId,
                        task: order.task,
                        note: order.note,
                        doctor: order.doctor || 'Dr. Sarah Chen',
                        time: order.time,
                        status: order.status || 'Dispatched'
                    };

                    if (entry.status === 'Completed') {
                        completedOrders.push(entry);
                    } else {
                        activeOrders.push(entry);
                    }
                });
            });
        } catch (e) {}

        // Sort by most recent first
        activeOrders.sort(function(a, b) { return new Date(b.time) - new Date(a.time); });
        completedOrders.sort(function(a, b) { return new Date(b.time) - new Date(a.time); });

        // Load admin directives
        try {
            var rawDir = localStorage.getItem(DIRECTIVES_KEY);
            directives = rawDir ? JSON.parse(rawDir) : [];
        } catch (e) { directives = []; }

        if (directives.length === 0) {
            directives = [
                {
                    id: Date.now() - 10000,
                    title: 'Ward Hygiene Protocol Update',
                    body: 'All nursing staff must complete the updated hand hygiene compliance checklist before each shift. New antiseptic dispensers have been installed at all bedside stations.',
                    from: 'Dr. Sarah Chen (Admin)',
                    time: new Date(Date.now() - 2 * 3600000).toISOString(),
                    acknowledged: false
                },
                {
                    id: Date.now() - 20000,
                    title: 'Emergency Equipment Inventory Check',
                    body: 'Please verify crash cart supplies (defibrillator pads, epinephrine, IV kits) on your floor and report any shortages to pharmacy before end of shift.',
                    from: 'Dr. Sarah Chen (Admin)',
                    time: new Date(Date.now() - 5 * 3600000).toISOString(),
                    acknowledged: false
                }
            ];
            saveDirectives();
        }

        updateCounts();
        renderCurrentTab();
    }

    function saveDirectives() {
        localStorage.setItem(DIRECTIVES_KEY, JSON.stringify(directives));
    }

    function updateCounts() {
        var el1 = document.getElementById('nurseActiveCount');
        var el2 = document.getElementById('nurseCompletedCount');
        var el3 = document.getElementById('tabOrdersCount');
        var el4 = document.getElementById('tabCompletedCount');
        var el5 = document.getElementById('tabDirectivesCount');

        if (el1) el1.textContent = activeOrders.length;
        if (el2) el2.textContent = completedOrders.length;
        if (el3) el3.textContent = activeOrders.length;
        if (el4) el4.textContent = completedOrders.length;
        if (el5) el5.textContent = directives.filter(function(d) { return !d.acknowledged; }).length;
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

    function renderCurrentTab() {
        if (currentTab === 'orders') renderOrdersGrid(activeOrders, 'nurseOrdersGrid', 'noOrdersData', false);
        else if (currentTab === 'completed') renderOrdersGrid(completedOrders, 'completedOrdersGrid', 'noCompletedData', true);
        else if (currentTab === 'directives') renderDirectives();
    }

    function renderOrdersGrid(orders, gridId, noDataId, isCompleted) {
        var grid = document.getElementById(gridId);
        var noData = document.getElementById(noDataId);
        if (!grid) return;

        var filtered = orders.filter(function(o) {
            if (!searchTerm) return true;
            var q = searchTerm.toLowerCase();
            return (o.patientName && o.patientName.toLowerCase().includes(q)) ||
                   (o.task && o.task.toLowerCase().includes(q)) ||
                   (o.doctor && o.doctor.toLowerCase().includes(q));
        });

        if (filtered.length === 0) {
            grid.innerHTML = '';
            if (noData) noData.style.display = 'block';
            return;
        }
        if (noData) noData.style.display = 'none';

        grid.innerHTML = filtered.map(function(o) {
            var initials = o.patientName ? o.patientName.split(' ').map(function(n) { return n[0]; }).join('').toUpperCase() : 'PT';
            var statusClass = isCompleted ? 'status-completed' : 'status-dispatched';
            var cardClass = isCompleted ? ' completed-card' : '';

            return '<div class="nurse-order-card' + cardClass + '">' +
                '<div class="ncard-top">' +
                    '<div class="ncard-patient">' +
                        '<div class="ncard-avatar">' + initials + '</div>' +
                        '<div class="ncard-pinfo">' +
                            '<h4 class="ncard-pname">' + o.patientName + '</h4>' +
                            '<span class="ncard-pmeta"><span class="tid">' + o.trackingId + '</span></span>' +
                        '</div>' +
                    '</div>' +
                    '<span class="badge ' + statusClass + '">' + o.status + '</span>' +
                '</div>' +

                '<div class="ncard-task-box">' +
                    '<span class="ncard-task-label">Nursing Task / Order</span>' +
                    '<strong class="ncard-task-name">' + o.task + '</strong>' +
                '</div>' +

                (o.note ? '<div class="ncard-note"><strong>Doctor Instructions:</strong> ' + o.note + '</div>' : '') +

                '<div class="ncard-footer">' +
                    '<div>' +
                        '<span class="ncard-doctor">From: ' + o.doctor + '</span>' +
                        '<span class="ncard-time"> · ' + formatTime(o.time) + '</span>' +
                    '</div>' +
                    (!isCompleted ?
                        '<button type="button" class="btn-nurse-action btn-complete-task" data-patient-id="' + o.patientId + '" data-order-id="' + o.orderId + '">' +
                            '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>' +
                            '<span>Mark Complete</span>' +
                        '</button>'
                        : '<span style="font-size:11px;color:#10B981;font-weight:600;">✓ Done</span>'
                    ) +
                '</div>' +
            '</div>';
        }).join('');

        if (!isCompleted) {
            grid.querySelectorAll('.btn-complete-task').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var patientId = parseInt(this.getAttribute('data-patient-id'), 10);
                    var orderId = parseInt(this.getAttribute('data-order-id'), 10);
                    completeNurseOrder(patientId, orderId);
                });
            });
        }
    }

    function completeNurseOrder(patientId, orderId) {
        try {
            var raw = localStorage.getItem(PATIENTS_KEY);
            var patients = raw ? JSON.parse(raw) : [];
            var patient = patients.find(function(p) { return p.id === patientId; });
            if (patient && patient.nurseOrders) {
                var order = patient.nurseOrders.find(function(o) { return o.id === orderId; });
                if (order) {
                    order.status = 'Completed';
                    order.completedAt = new Date().toISOString();
                    localStorage.setItem(PATIENTS_KEY, JSON.stringify(patients));
                    loadData();

                    if (window.MediTrackNotify) {
                        window.MediTrackNotify.push(
                            'Nursing Task Completed',
                            order.task + ' for ' + patient.name + ' has been fulfilled.',
                            'success',
                            'Doctor'
                        );
                    }
                }
            }
        } catch (e) {}
    }

    function renderDirectives() {
        var container = document.getElementById('directivesList');
        var noData = document.getElementById('noDirectivesData');
        if (!container) return;

        if (directives.length === 0) {
            container.innerHTML = '';
            if (noData) noData.style.display = 'block';
            return;
        }
        if (noData) noData.style.display = 'none';

        container.innerHTML = directives.map(function(d) {
            var ackClass = d.acknowledged ? ' ack-card' : '';
            return '<div class="directive-card' + ackClass + '">' +
                '<div class="dir-header">' +
                    '<h4 class="dir-title">' + d.title + '</h4>' +
                    '<span class="dir-time">' + formatDate(d.time) + ' · ' + formatTime(d.time) + '</span>' +
                '</div>' +
                '<div class="dir-body">' + d.body + '</div>' +
                '<div style="font-size:11.5px;color:var(--gray-muted);">From: ' + d.from + '</div>' +
                '<div class="dir-footer">' +
                    (!d.acknowledged ?
                        '<button type="button" class="btn-ack" data-id="' + d.id + '">Acknowledge & Confirm</button>'
                        : '<span style="font-size:12px;color:#10B981;font-weight:600;">✓ Acknowledged</span>'
                    ) +
                '</div>' +
            '</div>';
        }).join('');

        container.querySelectorAll('.btn-ack').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = parseInt(this.getAttribute('data-id'), 10);
                var d = directives.find(function(x) { return x.id === id; });
                if (d) { d.acknowledged = true; saveDirectives(); updateCounts(); renderDirectives(); }
            });
        });
    }

    function init() {
        loadData();

        // Tab switching
        document.querySelectorAll('.nurse-tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.nurse-tab-btn').forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentTab = this.getAttribute('data-tab');
                document.querySelectorAll('.nurse-tab-panel').forEach(function(p) { p.classList.remove('active'); });
                var panelMap = { orders: 'panelOrders', completed: 'panelCompleted', directives: 'panelDirectives' };
                var panel = document.getElementById(panelMap[currentTab]);
                if (panel) panel.classList.add('active');
                renderCurrentTab();
            });
        });

        var searchInput = document.getElementById('nurseSearch');
        if (searchInput) {
            searchInput.addEventListener('input', function() { searchTerm = this.value; renderCurrentTab(); });
        }

        window.addEventListener('storage', function(e) {
            if (e.key === PATIENTS_KEY || e.key === DIRECTIVES_KEY) loadData();
        });
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
