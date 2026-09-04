/* ==========================================================================
   MediTrack Hospital ERP - Role dashboards

   Every rank lands on a dashboard built around its own work:
     admin   — hospital-wide position, attendance, appointments, activity
     doctor  — my queue, general queue, next patient, my appointments
     nurse   — nursing orders, patient tracking, bed availability
     billing — receivables, today's collection, waiting list
     lab     — worklist pressure, urgent and critical results

   All figures read the same canonical store as the department screens so
   they cannot drift from what those screens show.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var clinical = window.MediClinical;
    var session = window.MediSession;
    var STATUS = store.STATUS;

    var patients = [];
    var labs = [];
    var scripts = [];
    var invoices = [];
    var attendance = [];
    var appointments = [];
    var beds = [];

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

    function todayKey(d) {
        var t = d || new Date();
        return t.getFullYear() + '-' +
            String(t.getMonth() + 1).padStart(2, '0') + '-' +
            String(t.getDate()).padStart(2, '0');
    }

    function myName() {
        var s = session.read() || {};
        return String(s.name || '');
    }

    /* ==================================================================
        HTML builders
        ================================================================== */
    function statCard(opts) {
        return '<button type="button" class="stat-card depth-tile' + (opts.go ? '' : ' stat-static') + '"' +
            (opts.go ? ' data-go="' + opts.go + '"' : '') + '>' +
            '<span class="stat-top">' +
                '<span class="stat-icon depth-icon-badge tone-' + (opts.tone || 'neutral') + '">' +
                    icon(opts.icon || 'chart', 18) + '</span>' +
                (opts.trend ? '<span class="stat-trend" ' +
                    (opts.trendDanger ? 'style="color:var(--danger,#A31B22)"' : '') + '>' +
                    esc(opts.trend) + '</span>' : '') +
            '</span>' +
            '<span class="stat-number">' + esc(opts.value) + '</span>' +
            '<span class="stat-label">' + esc(opts.label) + '</span>' +
            '<span class="stat-foot">' + esc(opts.foot || '') + '</span>' +
        '</button>';
    }

    function card(title, sub, bodyHtml, actionsHtml) {
        return '<section class="card card-dense">' +
            '<div class="card-header">' +
                '<div class="card-header-text">' +
                    '<h3>' + esc(title) + '</h3>' +
                    '<span class="card-sub">' + esc(sub) + '</span>' +
                '</div>' + (actionsHtml || '') +
            '</div>' + bodyHtml +
        '</section>';
    }

    function listItem(opts) {
        return '<div class="list-item">' +
            (opts.position ? '<span class="list-position">' + esc(opts.position) + '</span>' : '') +
            '<span class="avatar-sq ' + (opts.avatarClass || 'urgency-routine') + '">' +
                esc(store.initials(opts.title)) + '</span>' +
            '<span class="list-content">' +
                '<span class="list-title">' + esc(opts.title) +
                    (opts.id ? '<span class="list-id mono">' + esc(opts.id) + '</span>' : '') +
                '</span>' +
                '<span class="list-subtitle">' + esc(opts.subtitle || '') + '</span>' +
            '</span>' +
            '<span class="list-tail">' + (opts.tail || '') + '</span>' +
        '</div>';
    }

    function empty(iconName, title, text) {
        return ui.emptyState({ icon: iconName, title: title, text: text });
    }

    /* ==================================================================
        Patient-flow chart (canvas, no external library)

        A 7-day area chart of new visits, drawn in the hospital clock zone so
        the bars match the dates everyone else sees. The canvas is painted
        after the dashboard HTML is in the DOM (see render()).
        ================================================================== */
    function cssVar(name, fallback) {
        try {
            var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
            return v || fallback;
        } catch (e) { return fallback; }
    }

    function eatKeyOf(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        var eat = new Date(d.getTime() + (3 * 3600000) + (d.getTimezoneOffset() * 60000));
        return eat.getFullYear() + '-' + String(eat.getMonth() + 1).padStart(2, '0') + '-' +
            String(eat.getDate()).padStart(2, '0');
    }

    function last7Counts() {
        var now = new Date();
        var eatNow = new Date(now.getTime() + (3 * 3600000) + (now.getTimezoneOffset() * 60000));
        var keys = [];
        for (var i = 6; i >= 0; i--) {
            var d = new Date(eatNow);
            d.setDate(d.getDate() - i);
            var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
            keys.push({ key: key, label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] });
        }
        var map = {};
        keys.forEach(function (k) { map[k.key] = 0; });
        patients.forEach(function (p) {
            var k = eatKeyOf(p.registered);
            if (k && map[k] !== undefined) map[k]++;
        });
        return keys.map(function (k) { return { label: k.label, value: map[k.key] }; });
    }

    function flowChartCard() {
        return card('Patient flow · last 7 days',
            'New visits registered per day (East Africa Time)',
            '<div class="chart-wrap">' +
                '<canvas id="dashFlowChart" class="dash-chart" height="220"></canvas>' +
                '<div class="chart-legend" id="dashFlowLegend"></div>' +
            '</div>', '');
    }

    function drawFlowChart(canvas) {
        var ctx = canvas.getContext && canvas.getContext('2d');
        if (!ctx) return;
        var data = last7Counts();
        var dpr = window.devicePixelRatio || 1;
        var cssW = canvas.clientWidth || canvas.parentNode.clientWidth || 640;
        var cssH = 220;
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        var padL = 30, padR = 12, padT = 14, padB = 26;
        var w = cssW - padL - padR, h = cssH - padT - padB;
        var max = Math.max(1, data.reduce(function (m, d) { return Math.max(m, d.value); }, 0));

        var grid = cssVar('--gray-border', '#E3E6EB');
        var primary = cssVar('--primary', '#1C5FA8');
        var muted = cssVar('--gray-muted', '#6B7480');

        ctx.strokeStyle = grid; ctx.lineWidth = 1;
        for (var g = 0; g <= 3; g++) {
            var gy = padT + h * (g / 3);
            ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + w, gy); ctx.stroke();
        }

        var pts = data.map(function (d, i) {
            return {
                x: padL + w * (i / (data.length - 1)),
                y: padT + h * (1 - d.value / max),
                label: d.label, value: d.value
            };
        });

        var grad = ctx.createLinearGradient(0, padT, 0, padT + h);
        grad.addColorStop(0, hexToRgba(primary, 0.34));
        grad.addColorStop(1, hexToRgba(primary, 0.02));
        ctx.beginPath();
        ctx.moveTo(pts[0].x, padT + h);
        pts.forEach(function (p) { ctx.lineTo(p.x, p.y); });
        ctx.lineTo(pts[pts.length - 1].x, padT + h);
        ctx.closePath();
        ctx.fillStyle = grad; ctx.fill();

        ctx.beginPath();
        pts.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        ctx.strokeStyle = primary; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();

        ctx.fillStyle = primary;
        pts.forEach(function (p) {
            ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
        });

        ctx.fillStyle = muted; ctx.font = '11px ' + cssVar('--font-sans', 'sans-serif');
        ctx.textAlign = 'center';
        pts.forEach(function (p) {
            if (p.value) {
                ctx.fillText(String(p.value), p.x, p.y - 8);
            }
            ctx.fillText(p.label, p.x, padT + h + 16);
        });

        var legend = document.getElementById('dashFlowLegend');
        if (legend) {
            legend.innerHTML = '<span class="chart-key"><span class="chart-swatch"></span>Visits per day</span>' +
                '<span class="chart-total">Total ' +
                data.reduce(function (s, d) { return s + d.value; }, 0) + ' visits</span>';
        }
    }

    function hexToRgba(hex, a) {
        var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return 'rgba(28,95,168,' + a + ')';
        return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
    }

    function drawDashboardCharts(root) {
        var canvas = root.querySelector('#dashFlowChart');
        if (canvas) drawFlowChart(canvas);
    }

    function bindGo(root) {
        ui.qsa('[data-go]', root).forEach(function (el) {
            if (el.getAttribute('data-go-bound') === '1') return;
            el.setAttribute('data-go-bound', '1');
            el.addEventListener('click', function () {
                store.navigate(el.getAttribute('data-go'));
            });
        });
    }

    function patientTail(p, showUrgency) {
        var urgency = store.normalizeUrgency(p.urgency);
        var assessment = clinical.assess(p.vitals);
        return (assessment.flagged.length
            ? '<span class="badge ' + (assessment.overall === 'critical' ? 'status-critical' : 'status-awaiting') + '">' +
              esc(assessment.overallLabel) + '</span>'
            : '') +
            (showUrgency ? '<span class="badge ' + urgencyClass(urgency) + '">' + esc(urgency) + '</span>' : '') +
            '<span class="list-wait">' + esc(store.elapsed(p.registered)) + '</span>';
    }

    /* ==================================================================
        Load
        ================================================================== */
    function load() {
        patients = store.readPatients();
        labs = store.read(store.KEYS.labRequests);
        scripts = store.read(store.KEYS.prescriptions);
        invoices = store.read(store.KEYS.invoices);
        attendance = store.read(store.KEYS.attendance);
        appointments = store.read(store.KEYS.appointments);
        beds = store.read(store.KEYS.beds);
        render();
    }

    function render() {
        var role = session.role();
        var root = byId('dashRoot');
        if (!root) return;

        var titles = {
            admin:   ['Hospital Overview', 'Live position across triage, consultation, diagnostics, nursing and dispensing.'],
            doctor:  ['My Day', 'Your queue, your appointments and the patients waiting on your results.'],
            nurse:   ['Ward Overview', 'Nursing orders, patient tracking and bed availability right now.'],
            billing: ['Front Office', 'Receivables, today\u2019s collection and the patients waiting to pay.'],
            lab:     ['Laboratory Overview', 'Worklist pressure, urgent requests and released results.']
        };
        var t = titles[role] || titles.admin;
        setText('dashTitle', t[0]);
        setText('dashSubtitle', t[1]);

        var exportBtn = byId('exportAnalyticsBtn');
        if (exportBtn) exportBtn.classList.toggle('is-hidden', role !== 'admin');

        var html = '';
        if (role === 'doctor') html = doctorDashboard();
        else if (role === 'nurse') html = nurseDashboard();
        else if (role === 'billing') html = billingDashboard();
        else if (role === 'lab') html = labDashboard();
        else html = adminDashboard();

        root.innerHTML = html;
        bindGo(root);
        if (window.MediIcons) window.MediIcons.hydrate(root);
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(function () { drawDashboardCharts(root); });
        } else {
            drawDashboardCharts(root);
        }
    }

    /* ==================================================================
        Shared fragments
        ================================================================== */
    function attendanceToday() {
        return attendance.filter(function (r) { return r.date === todayKey(); });
    }

    function pendingAppointments() {
        return appointments.filter(function (a) { return a.status === 'Pending'; });
    }

    function appointmentsTodayList(limit) {
        var who = myName();
        var today = todayKey();
        var rows = appointments.filter(function (a) {
            if (session.role() === 'doctor') return a.doctor === who;
            return true;
        });
        rows = rows.filter(function (a) {
            return a.status === 'Pending' || (a.status === 'Accepted' && a.date === today);
        });
        rows.sort(function (a, b) {
            var pa = a.status === 'Pending' ? 0 : 1;
            var pb = b.status === 'Pending' ? 0 : 1;
            if (pa !== pb) return pa - pb;
            return String(a.date).localeCompare(String(b.date)) ||
                String(a.time || '').localeCompare(String(b.time || ''));
        });
        return rows.slice(0, limit || 5);
    }

    function appointmentListHtml(limit) {
        var rows = appointmentsTodayList(limit);
        if (!rows.length) {
            return empty('calendar-check', 'No appointments waiting',
                'Accepted visits for today and pending requests appear here.');
        }
        var badges = {
            Pending: 'status-pending', Accepted: 'status-finished',
            Declined: 'status-critical', Completed: 'status-awaiting', Cancelled: 'status-awaiting'
        };
        return rows.map(function (a) {
            return '<div class="list-item">' +
                '<span class="avatar-sq urgency-routine">' + esc(store.initials(a.patientName)) + '</span>' +
                '<span class="list-content">' +
                    '<span class="list-title">' + esc(a.patientName) + '</span>' +
                    '<span class="list-subtitle">' + esc(a.doctor || 'First available doctor') +
                        ' · ' + esc(a.date) + (a.time ? ' ' + esc(a.time) : '') + '</span>' +
                '</span>' +
                '<span class="list-tail">' +
                    (a.source === 'online'
                        ? '<span class="badge status-awaiting">' + icon('megaphone', 11) + '<span>Online</span></span>'
                        : '') +
                    '<span class="badge ' + (badges[a.status] || 'status-pending') + '">' + esc(a.status) + '</span>' +
                '</span>' +
            '</div>';
        }).join('');
    }

    function attendanceListHtml(limit) {
        var rows = attendanceToday().sort(function (a, b) {
            return new Date(b.in || 0) - new Date(a.in || 0);
        }).slice(0, limit || 6);
        if (!rows.length) {
            return empty('calendar', 'Nobody has checked in yet',
                'Check-ins appear here as staff arrive, straight from the server.');
        }
        return rows.map(function (r) {
            var warns = (r.warnings || []).length;
            return '<div class="list-item">' +
                '<span class="avatar-sq urgency-routine">' + esc(store.initials(r.name)) + '</span>' +
                '<span class="list-content">' +
                    '<span class="list-title">' + esc(r.name) + '</span>' +
                    '<span class="list-subtitle">In ' + esc(store.formatTime(r.in)) +
                        (r.out ? ' · Out ' + esc(store.formatTime(r.out)) : ' · on site') + '</span>' +
                '</span>' +
                '<span class="list-tail">' +
                    (warns ? '<span class="badge status-critical">' + icon('warning', 11) +
                        '<span>' + warns + ' warning' + (warns > 1 ? 's' : '') + '</span></span>' : '') +
                    '<span class="badge ' + (r.out ? 'status-pending' : 'status-finished') + '">' +
                        (r.out ? 'Left' : 'On site') + '</span>' +
                '</span>' +
            '</div>';
        }).join('');
    }

    function bedSummary() {
        var counts = { Free: 0, Occupied: 0, Cleaning: 0, Reserved: 0 };
        beds.forEach(function (b) {
            if (counts[b.status] !== undefined) counts[b.status]++;
        });
        return counts;
    }

    function bedCards() {
        var host = byId('dashBeds');
        if (!host) return;
        if (!beds.length) {
            host.innerHTML = empty('bed', 'No beds configured',
                'Set the wards up in the nurse station and they appear here.');
            return;
        }
        var wards = {};
        beds.forEach(function (b) {
            var w = b.ward || 'General';
            wards[w] = wards[w] || { total: 0, free: 0 };
            wards[w].total++;
            if (b.status === 'Free') wards[w].free++;
        });
        var counts = bedSummary();
        host.innerHTML =
            '<div class="dept-load">' +
                ['Free', 'Occupied', 'Cleaning', 'Reserved'].map(function (k) {
                    var tone = k === 'Free' ? 'tone-success' : k === 'Occupied' ? 'tone-warning' : 'tone-info';
                    var pct = Math.round((counts[k] / Math.max(1, beds.length)) * 100);
                    return '<div class="dept-row dept-static">' +
                        '<span class="dept-body">' +
                            '<span class="dept-top">' +
                                '<span class="dept-label">' + k + '</span>' +
                                '<span class="dept-value">' + counts[k] + '</span>' +
                            '</span>' +
                            '<span class="dept-bar"><span class="dept-fill ' + tone + '" style="width:' + pct + '%"></span></span>' +
                        '</span>' +
                    '</div>';
                }).join('') +
            '</div>' +
            '<div class="list-group" style="margin-top:10px">' +
                Object.keys(wards).map(function (w) {
                    return '<div class="list-item">' +
                        '<span class="avatar-sq urgency-info">' + icon('bed', 14) + '</span>' +
                        '<span class="list-content">' +
                            '<span class="list-title">' + esc(w) + '</span>' +
                            '<span class="list-subtitle">' + wards[w].total + ' bed' +
                                (wards[w].total > 1 ? 's' : '') + '</span>' +
                        '</span>' +
                        '<span class="list-tail">' +
                            '<span class="badge ' + (wards[w].free ? 'status-finished' : 'status-critical') + '">' +
                                wards[w].free + ' free</span>' +
                        '</span>' +
                    '</div>';
                }).join('') +
            '</div>';
    }

    /* ==================================================================
        Admin dashboard
        ================================================================== */
    function adminDashboard() {
        var queue = store.queueOrder(patients);
        var consulting = store.consultingPatients(patients);
        var awaiting = store.awaitingPatients(patients);
        var openLabs = labs.filter(function (l) { return l.status !== 'Completed'; });

        var emergencies = queue.filter(function (p) {
            return store.normalizeUrgency(p.urgency) === store.URGENCY.EMERGENCY;
        });
        var today = patients.filter(function (p) {
            if (p.status !== STATUS.FINISHED || !p.completedAt) return false;
            var d = new Date(p.completedAt);
            var now = new Date();
            return d.getFullYear() === now.getFullYear() &&
                d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
        });

        var attToday = attendanceToday();
        var onSite = attToday.filter(function (r) { return !r.out; });
        var warningsToday = 0;
        attToday.forEach(function (r) { warningsToday += (r.warnings || []).length; });

        var attention = adminAttention(queue, emergencies, openLabs);

        var openNurse = 0;
        var unreviewed = 0;
        patients.forEach(function (p) {
            openNurse += (p.nurseOrders || []).filter(store.isOrderOpen).length;
            unreviewed += store.unreviewedResults(p).length;
        });

        return attention +
            '<section class="stats-grid" aria-label="Key figures">' +
                statCard({ go: 'pages/queue.html', icon: 'queue', tone: 'warning', value: queue.length,
                    label: 'In triage queue', trend: emergencies.length ? emergencies.length + ' emergency' : 'Waiting',
                    trendDanger: emergencies.length > 0,
                    foot: queue.length ? 'Longest wait ' + store.elapsed(queue[queue.length - 1].registered) : 'Queue is clear' }) +
                statCard({ go: 'pages/track.html', icon: 'stethoscope', tone: 'success', value: consulting.length,
                    label: 'In consultation', foot: consulting.length
                        ? consulting.slice(0, 2).map(function (p) { return p.name; }).join(', ')
                        : 'No active consultation' }) +
                statCard({ go: 'pages/track.html', icon: 'hourglass', tone: 'neutral', value: awaiting.length,
                    label: 'Awaiting results', foot: awaiting.length ? 'Diagnostics in progress' : 'Nothing parked' }) +
                statCard({ go: 'pages/laboratory.html', icon: 'lab', tone: 'info', value: openLabs.length,
                    label: 'Open lab requests', foot: openLabs.length ? 'Oldest ' + store.elapsed(oldestTime(openLabs)) : 'Nothing outstanding' }) +
                statCard({ go: 'pages/attendance.html', icon: 'users', tone: 'success', value: attToday.length,
                    label: 'Staff present today', foot: onSite.length ? onSite.length + ' on site now' : 'Nobody checked in' }) +
                statCard({ go: 'pages/attendance.html', icon: 'warning', tone: warningsToday ? 'warning' : 'neutral',
                    value: warningsToday, label: 'Attendance warnings today',
                    trend: warningsToday ? 'Review' : 'All within window', trendDanger: warningsToday > 0,
                    foot: 'Two in a day alerts admins' }) +
                statCard({ go: 'pages/appointments.html', icon: 'calendar-check', tone: 'info',
                    value: pendingAppointments().length, label: 'Appointments pending',
                    foot: 'Accept or decline today' }) +
                statCard({ icon: 'check-circle', tone: 'neutral', value: today.length,
                    label: 'Visits completed today', foot: today.length ? 'Across all departments' : 'No completions yet today' }) +
            '</section>' +

            flowChartCard() +

            '<div class="dash-grid">' +
                card('Next in queue',
                    store.queuePolicy() === store.POLICIES.FIFO
                        ? 'Arrival order — clinical priority is not applied'
                        : 'Ordered by triage priority, then arrival time',
                    queuePreviewHtml(queue),
                    '<button type="button" class="btn-text" data-go="pages/queue.html"><span>Open queue</span>' +
                    icon('arrow-right', 14) + '</button>') +
                '<div class="dash-side">' +
                    card('Department load', 'Open items per service', deptLoadHtml(openNurse, unreviewed)) +
                    card('Triage mix', 'Active patients by priority', triageMixHtml()) +
                '</div>' +
            '</div>' +

            '<div class="dash-grid">' +
                card('Attendance today', 'Straight from the server — records stay until checkout',
                    '<div class="list-group">' + attendanceListHtml(6) + '</div>',
                    '<button type="button" class="btn-text" data-go="pages/attendance.html"><span>Open attendance</span>' +
                    icon('arrow-right', 14) + '</button>') +
                card('Appointments', 'Pending requests first, then today\u2019s accepted visits',
                    '<div class="list-group">' + appointmentListHtml(6) + '</div>',
                    '<button type="button" class="btn-text" data-go="pages/appointments.html"><span>Open appointments</span>' +
                    icon('arrow-right', 14) + '</button>') +
            '</div>' +

            card('Recent clinical activity', 'Notes, orders and released results across all departments',
                '<div class="activity-list" id="dashActivity"></div>');
    }

    function adminAttention(queue, emergencies, openLabs) {
        var items = [];

        if (emergencies.length) {
            items.push({
                tone: 'critical', icon: 'critical',
                title: emergencies.length + ' emergency patient' + (emergencies.length > 1 ? 's' : '') + ' waiting',
                text: emergencies.map(function (p) { return p.name + ' (' + store.elapsed(p.registered) + ')'; }).slice(0, 3).join(' · '),
                label: 'Open queue', target: 'pages/queue.html'
            });
        }

        var criticalResults = labs.filter(function (l) {
            return l.status === 'Completed' && l.flag === 'Critical';
        });
        var archivedCritical = store.read(store.KEYS.labArchive).filter(function (l) { return l.flag === 'Critical'; });
        var unreviewedCritical = archivedCritical.concat(criticalResults).filter(function (l) {
            var p = store.findPatient(patients, l.patientId);
            if (!p) return false;
            return store.unreviewedResults(p).some(function (o) { return String(o.id) === String(l.id); });
        });
        if (unreviewedCritical.length) {
            items.push({
                tone: 'critical', icon: 'lab',
                title: unreviewedCritical.length + ' critical result' + (unreviewedCritical.length > 1 ? 's' : '') + ' unreviewed',
                text: unreviewedCritical.map(function (l) { return l.test + ' — ' + l.patientName; }).slice(0, 2).join(' · '),
                label: 'Review now', target: 'pages/track.html'
            });
        }

        var warnedStaff = attendanceToday().filter(function (r) { return (r.warnings || []).length >= 2; });
        if (warnedStaff.length) {
            items.push({
                tone: 'critical', icon: 'warning',
                title: warnedStaff.length + ' staff member' + (warnedStaff.length > 1 ? 's' : '') + ' hit 2 attendance warnings',
                text: warnedStaff.map(function (r) { return r.name; }).slice(0, 3).join(' · '),
                label: 'Open attendance', target: 'pages/attendance.html'
            });
        }

        var criticalVitals = store.activePatients(patients).filter(function (p) {
            return clinical.assess(p.vitals).overall === 'critical';
        });
        if (criticalVitals.length) {
            items.push({
                tone: 'critical', icon: 'pulse',
                title: criticalVitals.length + ' patient' + (criticalVitals.length > 1 ? 's' : '') + ' with critical observations',
                text: criticalVitals.map(function (p) { return p.name; }).slice(0, 3).join(' · '),
                label: 'Open consultation', target: 'pages/track.html'
            });
        }

        var urgentAppts = pendingAppointments().length;
        if (urgentAppts) {
            items.push({
                tone: 'info', icon: 'calendar-check',
                title: urgentAppts + ' appointment request' + (urgentAppts > 1 ? 's' : '') + ' awaiting a decision',
                text: 'Doctors decide their own; the rest need an administrator.',
                label: 'Open appointments', target: 'pages/appointments.html'
            });
        }

        if (!items.length) return '';

        return '<section class="attention-stack">' + items.map(function (it) {
            return '<article class="attention attention-' + it.tone + '">' +
                '<span class="att-icon">' + icon(it.icon, 16) + '</span>' +
                '<div class="att-body">' +
                    '<strong>' + esc(it.title) + '</strong>' +
                    '<span>' + esc(it.text) + '</span>' +
                '</div>' +
                '<button type="button" class="att-action" data-go="' + it.target + '">' + esc(it.label) + '</button>' +
            '</article>';
        }).join('') + '</section>';
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

    function queuePreviewHtml(queue) {
        if (!queue.length) {
            return empty('check-circle', 'The queue is clear',
                'Patients appear here as soon as reception completes registration and triage.');
        }
        return '<div class="list-group">' + queue.slice(0, 6).map(function (p, i) {
            return '<div class="list-item">' +
                '<span class="list-position">' + String(i + 1).padStart(2, '0') + '</span>' +
                '<span class="avatar-sq ' + urgencyClass(p.urgency) + '">' + esc(store.initials(p.name)) + '</span>' +
                '<span class="list-content">' +
                    '<span class="list-title">' + esc(p.name) +
                        '<span class="list-id mono">' + esc(p.trackingId) + '</span>' +
                    '</span>' +
                    '<span class="list-subtitle">' + esc(p.description || 'No complaint recorded.') + '</span>' +
                '</span>' +
                '<span class="list-tail">' + patientTail(p, true) + '</span>' +
            '</div>';
        }).join('') + '</div>';
    }

    function deptLoadHtml(openNurse, unreviewed) {
        var rows = [
            { label: 'Triage queue', value: store.queueOrder(patients).length, max: 12, icon: 'queue', target: 'pages/queue.html' },
            { label: 'Consultation', value: store.consultingPatients(patients).length, max: 6, icon: 'stethoscope', target: 'pages/track.html' },
            { label: 'Laboratory', value: labs.filter(function (l) { return l.status !== 'Completed'; }).length, max: 15, icon: 'lab', target: 'pages/laboratory.html' },
            { label: 'Nursing', value: openNurse, max: 12, icon: 'nurse', target: 'pages/nurse.html' },
            { label: 'Pharmacy', value: scripts.filter(function (r) { return r.status !== 'Dispensed'; }).length, max: 12, icon: 'pill', target: 'pages/pharmacy.html' },
            { label: 'Unreviewed results', value: unreviewed, max: 8, icon: 'file-text', target: 'pages/track.html' }
        ];
        return '<div class="dept-load">' + rows.map(function (r) {
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
        }).join('') + '</div>';
    }

    function triageMixHtml() {
        var active = store.activePatients(patients);
        var counts = { Emergency: 0, Urgent: 0, Routine: 0 };
        active.forEach(function (p) { counts[store.normalizeUrgency(p.urgency)]++; });
        var total = active.length;
        if (!total) {
            return empty('patients', 'No active patients', 'The triage mix appears once patients are in the department.');
        }
        return '<div class="triage-mix">' + ['Emergency', 'Urgent', 'Routine'].map(function (key) {
            var n = counts[key];
            var pct = Math.round((n / total) * 100);
            return '<div class="mix-row">' +
                '<span class="mix-label"><span class="mix-dot ' + urgencyClass(key) + '" aria-hidden="true"></span>' +
                '<span>' + esc(key) + '</span></span>' +
                '<span class="mix-bar"><span class="mix-fill ' + urgencyClass(key) + '" style="width:' + pct + '%"></span></span>' +
                '<span class="mix-value">' + n + '<small>' + pct + '%</small></span>' +
            '</div>';
        }).join('') + '</div>';
    }

    /* ==================================================================
        Doctor dashboard
        ================================================================== */
    function doctorDashboard() {
        var mine = myName();
        var queue = store.queueOrder(patients);
        var assigned = queue.filter(function (p) { return p.preferredDoctor === mine; });
        var general = queue.filter(function (p) { return p.preferredDoctor !== mine; });
        var consulting = store.consultingPatients(patients).filter(function (p) {
            return !p.assignedDoctor || p.assignedDoctor === mine;
        });
        var myReview = 0;
        patients.forEach(function (p) { myReview += store.unreviewedResults(p).length; });

        var next = assigned[0] || general[0] || null;
        var nextHtml;
        if (!next) {
            nextHtml = empty('check-circle', 'No patients waiting', 'New arrivals appear here the moment triage releases them.');
        } else {
            var urgency = store.normalizeUrgency(next.urgency);
            var assessment = clinical.assess(next.vitals);
            nextHtml = '<div class="list-group">' +
                '<div class="list-item">' +
                    '<span class="list-position">01</span>' +
                    '<span class="avatar-sq ' + urgencyClass(urgency) + '">' + esc(store.initials(next.name)) + '</span>' +
                    '<span class="list-content">' +
                        '<span class="list-title">' + esc(next.name) +
                            '<span class="list-id mono">' + esc(next.trackingId) + '</span></span>' +
                        '<span class="list-subtitle">' + esc(next.description || 'No complaint recorded.') + '</span>' +
                    '</span>' +
                    '<span class="list-tail">' +
                        (assessment.flagged.length
                            ? '<span class="badge ' + (assessment.overall === 'critical' ? 'status-critical' : 'status-awaiting') + '">' +
                              esc(assessment.overallLabel) + '</span>' : '') +
                        '<span class="badge ' + urgencyClass(urgency) + '">' + esc(urgency) + '</span>' +
                        (next.preferredDoctor === mine
                            ? '<span class="badge status-finished">Booked for you</span>'
                            : '<span class="badge status-awaiting">General queue</span>') +
                    '</span>' +
                '</div>' +
            '</div>';
        }

        return adminAttention(store.queueOrder(patients), store.queueOrder(patients).filter(function (p) {
            return store.normalizeUrgency(p.urgency) === store.URGENCY.EMERGENCY;
        }), labs.filter(function (l) { return l.status !== 'Completed'; })) +

            '<section class="stats-grid" aria-label="Key figures">' +
                statCard({ go: 'pages/track.html', icon: 'stethoscope', tone: 'success', value: assigned.length,
                    label: 'Booked for me', trend: assigned.length ? 'Your queue' : 'None booked',
                    foot: assigned.length ? 'Longest wait ' + store.elapsed(assigned[assigned.length - 1].registered) : 'Patients who chose you' }) +
                statCard({ go: 'pages/queue.html', icon: 'queue', tone: 'info', value: general.length,
                    label: 'General queue', foot: 'Unassigned patients you can pick up' }) +
                statCard({ go: 'pages/track.html', icon: 'user-check', tone: 'neutral', value: consulting.length,
                    label: 'In consultation with you', foot: consulting.length
                        ? consulting.slice(0, 2).map(function (p) { return p.name; }).join(', ')
                        : 'No active consultation' }) +
                statCard({ go: 'pages/track.html', icon: 'file-text', tone: myReview ? 'warning' : 'neutral',
                    value: myReview, label: 'Results to review', trendDanger: myReview > 0,
                    foot: myReview ? 'Released by the laboratory' : 'Nothing waiting' }) +
            '</section>' +

            '<div class="dash-grid">' +
                card('Next patient', assigned.length
                    ? 'Patients who chose you are called first — the general queue follows'
                    : 'Nobody booked you specifically, so the general queue is yours',
                    nextHtml,
                    '<button type="button" class="btn-text" data-go="pages/track.html"><span>Open consultation</span>' +
                    icon('arrow-right', 14) + '</button>') +
                '<div class="dash-side">' +
                    card('My appointments', 'Pending requests first, then today\u2019s accepted visits',
                        '<div class="list-group">' + appointmentListHtml(6) + '</div>',
                        '<button type="button" class="btn-text" data-go="pages/appointments.html"><span>Open appointments</span>' +
                        icon('arrow-right', 14) + '</button>') +
                '</div>' +
            '</div>' +

            card('Recent clinical activity', 'Notes, orders and released results',
                '<div class="activity-list" id="dashActivity"></div>');
    }

    /* ==================================================================
        Nurse dashboard
        ================================================================== */
    function nurseDashboard() {
        var openOrders = [];
        patients.forEach(function (p) {
            (p.nurseOrders || []).forEach(function (o) {
                if (store.isOrderOpen(o) && !o.archivedAt) {
                    openOrders.push({ patient: p, order: o });
                }
            });
        });
        var tracking = store.read(store.KEYS.nurseTracking || 'clinic_nurse_tracking')
            .filter(function (t) { return t.status === 'active'; });
        var counts = bedSummary();
        var queue = store.queueOrder(patients);

        var ordersHtml;
        if (!openOrders.length) {
            ordersHtml = empty('nurse', 'No open nursing orders', 'Orders from consultation appear here the moment a doctor dispatches them.');
        } else {
            ordersHtml = '<div class="list-group">' + openOrders.slice(0, 6).map(function (row) {
                var bedText = /\bbed\b/i.test(row.order.task || '') ? 'bed' : '';
                return '<div class="list-item">' +
                    '<span class="avatar-sq ' + urgencyClass(row.patient.urgency) + '">' + esc(store.initials(row.patient.name)) + '</span>' +
                    '<span class="list-content">' +
                        '<span class="list-title">' + esc(row.order.task || 'Nursing order') +
                            (bedText ? '<span class="list-id mono">bed</span>' : '') + '</span>' +
                        '<span class="list-subtitle">' + esc(row.patient.name) +
                            ' · ' + esc(row.order.note || 'No note') + '</span>' +
                    '</span>' +
                    '<span class="list-tail">' +
                        '<span class="badge ' + urgencyClass(row.patient.urgency) + '">' + esc(store.normalizeUrgency(row.patient.urgency)) + '</span>' +
                        '<span class="list-wait">' + esc(store.elapsed(row.order.time)) + '</span>' +
                    '</span>' +
                '</div>';
            }).join('') + '</div>';
        }

        return '<section class="stats-grid" aria-label="Key figures">' +
                statCard({ go: 'pages/nurse.html', icon: 'nurse', tone: 'warning', value: openOrders.length,
                    label: 'Open nursing orders', foot: openOrders.length ? 'Oldest ' + store.elapsed(oldestTime(openOrders.map(function (r) { return r.order; }))) : 'Nothing pending' }) +
                statCard({ go: 'pages/nurse.html', icon: 'tracking', tone: 'info', value: tracking.length,
                    label: 'Active tracking plans', foot: tracking.length ? 'Patients under observation' : 'Start one from the nurse station' }) +
                statCard({ go: 'pages/nurse.html', icon: 'bed', tone: counts.Free ? 'success' : 'critical', value: counts.Free,
                    label: 'Beds free', trend: beds.length ? counts.Occupied + ' occupied' : 'Not set up',
                    trendDanger: beds.length > 0 && counts.Free === 0,
                    foot: beds.length ? counts.Cleaning + ' cleaning · ' + counts.Reserved + ' reserved' : 'Configure beds in the nurse station' }) +
                statCard({ go: 'pages/queue.html', icon: 'queue', tone: 'neutral', value: queue.length,
                    label: 'Waiting in triage', foot: queue.length ? 'Longest wait ' + store.elapsed(queue[queue.length - 1].registered) : 'Queue is clear' }) +
            '</section>' +

            '<div class="dash-grid">' +
                card('Nursing orders', 'Dispatched from consultation, newest first',
                    ordersHtml,
                    '<button type="button" class="btn-text" data-go="pages/nurse.html"><span>Open nurse station</span>' +
                    icon('arrow-right', 14) + '</button>') +
                '<div class="dash-side">' +
                    card('Bed availability', beds.length ? beds.length + ' beds across the wards' : 'No beds configured yet',
                        '<div id="dashBeds"></div>',
                        '<button type="button" class="btn-text" data-go="pages/nurse.html"><span>Manage beds</span>' +
                        icon('arrow-right', 14) + '</button>') +
                '</div>' +
            '</div>';
    }

    /* ==================================================================
        Billing dashboard
        ================================================================== */
    function billingDashboard() {
        var unpaid = invoices.filter(function (i) { return i.status === 'Unpaid'; });
        var partly = invoices.filter(function (i) { return i.status === 'Partly Paid'; });
        var awaitingPatients = patients.filter(function (p) { return p.status === STATUS.AWAITING_PAYMENT; });

        var collectedToday = 0;
        invoices.forEach(function (inv) {
            (inv.payments || []).forEach(function (p) {
                var d = new Date(p.at);
                var now = new Date();
                if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() &&
                    d.getDate() === now.getDate()) {
                    collectedToday += store.toNumber(p.amount) || 0;
                }
            });
        });

        var balanceOf = function (inv) {
            var total = 0;
            (inv.items || []).forEach(function (it) {
                total += (store.toNumber(it.qty) || 1) * (store.toNumber(it.price) || 0);
            });
            var paid = 0;
            (inv.payments || []).forEach(function (p) { paid += store.toNumber(p.amount) || 0; });
            return Math.max(0, total - paid);
        };

        var outstanding = 0;
        unpaid.concat(partly).forEach(function (inv) { outstanding += balanceOf(inv); });

        var unpaidHtml;
        if (!unpaid.length && !partly.length) {
            unpaidHtml = empty('receipt', 'Nothing outstanding', 'Every invoice on file is settled.');
        } else {
            unpaidHtml = '<div class="list-group">' + unpaid.concat(partly).slice(0, 6).map(function (inv) {
                return '<div class="list-item">' +
                    '<span class="avatar-sq urgency-routine">' + esc(store.initials(inv.patientName || '?')) + '</span>' +
                    '<span class="list-content">' +
                        '<span class="list-title">' + esc(inv.patientName || 'Unknown') +
                            '<span class="list-id mono">' + esc(inv.number || '') + '</span></span>' +
                        '<span class="list-subtitle">' + esc(inv.status) + ' · ' +
                            esc(store.formatDate(inv.createdAt)) + '</span>' +
                    '</span>' +
                    '<span class="list-tail">' +
                        '<span class="badge ' + (inv.status === 'Unpaid' ? 'status-critical' : 'status-awaiting') + '">' +
                            esc(store.formatMoney(balanceOf(inv))) + '</span>' +
                    '</span>' +
                '</div>';
            }).join('') + '</div>';
        }

        var queue = store.queueOrder(patients);
        var queueHtml = queue.length
            ? '<div class="list-group">' + queue.slice(0, 5).map(function (p, i) {
                return '<div class="list-item">' +
                    '<span class="list-position">' + String(i + 1).padStart(2, '0') + '</span>' +
                    '<span class="avatar-sq ' + urgencyClass(p.urgency) + '">' + esc(store.initials(p.name)) + '</span>' +
                    '<span class="list-content">' +
                        '<span class="list-title">' + esc(p.name) + '</span>' +
                        '<span class="list-subtitle">' + esc(p.trackingId) + '</span>' +
                    '</span>' +
                    '<span class="list-tail">' + patientTail(p, true) + '</span>' +
                '</div>';
            }).join('') + '</div>'
            : empty('check-circle', 'The queue is clear', 'Patients join after registration and payment.');

        return '<section class="stats-grid" aria-label="Key figures">' +
                statCard({ go: 'pages/billing.html', icon: 'receipt', tone: 'warning', value: unpaid.length + partly.length,
                    label: 'Open invoices', trend: outstanding ? store.formatMoney(outstanding) + ' due' : 'Settled',
                    trendDanger: outstanding > 0, foot: unpaid.length + ' unpaid · ' + partly.length + ' partly paid' }) +
                statCard({ go: 'pages/billing.html', icon: 'cash', tone: 'success', value: store.formatMoney(collectedToday),
                    label: 'Collected today', foot: 'Across all payment methods' }) +
                statCard({ go: 'pages/billing.html', icon: 'hourglass', tone: 'info', value: awaitingPatients.length,
                    label: 'Waiting to pay', foot: 'They join the queue once settled' }) +
                statCard({ go: 'pages/queue.html', icon: 'queue', tone: 'neutral', value: queue.length,
                    label: 'In triage queue', foot: queue.length ? 'Longest wait ' + store.elapsed(queue[queue.length - 1].registered) : 'Queue is clear' }) +
            '</section>' +

            '<div class="dash-grid">' +
                card('Receivables', 'Oldest unsettled invoices first',
                    unpaidHtml,
                    '<button type="button" class="btn-text" data-go="pages/billing.html"><span>Open billing</span>' +
                    icon('arrow-right', 14) + '</button>') +
                '<div class="dash-side">' +
                    card('Waiting list', 'Ordered by the active calling policy', queueHtml,
                        '<button type="button" class="btn-text" data-go="pages/queue.html"><span>Open queue</span>' +
                        icon('arrow-right', 14) + '</button>') +
                '</div>' +
            '</div>';
    }

    /* ==================================================================
        Lab dashboard
        ================================================================== */
    function labDashboard() {
        var open = labs.filter(function (l) { return l.status !== 'Completed'; });
        var urgent = open.filter(function (l) {
            var p = String(l.priority || '').toLowerCase();
            return p === 'stat' || p === 'urgent';
        });
        var completedToday = labs.filter(function (l) {
            if (l.status !== 'Completed' || !l.completedAt) return false;
            var d = new Date(l.completedAt);
            var now = new Date();
            return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() &&
                d.getDate() === now.getDate();
        });

        var order = { STAT: 0, Urgent: 1, Routine: 2 };
        var workHtml;
        if (!open.length) {
            workHtml = empty('check-circle', 'Worklist is clear', 'New requests appear here the moment a doctor sends them.');
        } else {
            var sorted = open.slice().sort(function (a, b) {
                var d = (order[a.priority] === undefined ? 3 : order[a.priority]) -
                        (order[b.priority] === undefined ? 3 : order[b.priority]);
                if (d !== 0) return d;
                return new Date(a.time || 0) - new Date(b.time || 0);
            });
            workHtml = '<div class="list-group">' + sorted.slice(0, 7).map(function (l) {
                var p = String(l.priority || 'Routine');
                return '<div class="list-item">' +
                    '<span class="avatar-sq urgency-routine">' + esc(store.initials(l.patientName || '?')) + '</span>' +
                    '<span class="list-content">' +
                        '<span class="list-title">' + esc(l.test || 'Laboratory test') + '</span>' +
                        '<span class="list-subtitle">' + esc(l.patientName || 'Unknown') +
                            ' · ' + esc(store.relativeTime(l.time)) + '</span>' +
                    '</span>' +
                    '<span class="list-tail">' +
                        '<span class="badge ' + (p === 'STAT' ? 'status-critical' : p === 'Urgent' ? 'status-awaiting' : 'status-pending') + '">' +
                            esc(p) + '</span>' +
                        '<span class="list-wait">' + esc(store.elapsed(l.time)) + '</span>' +
                    '</span>' +
                '</div>';
            }).join('') + '</div>';
        }

        return '<section class="stats-grid" aria-label="Key figures">' +
                statCard({ go: 'pages/laboratory.html', icon: 'lab', tone: 'info', value: open.length,
                    label: 'Open requests', foot: open.length ? 'Oldest ' + store.elapsed(oldestTime(open)) : 'Nothing outstanding' }) +
                statCard({ go: 'pages/laboratory.html', icon: 'critical', tone: urgent.length ? 'warning' : 'neutral',
                    value: urgent.length, label: 'Urgent / STAT', trendDanger: urgent.length > 0,
                    foot: urgent.length ? 'Run these first' : 'No urgent work' }) +
                statCard({ go: 'pages/laboratory.html', icon: 'check-circle', tone: 'success', value: completedToday.length,
                    label: 'Released today', foot: 'Results sent back to clinicians' }) +
                statCard({ go: 'pages/queue.html', icon: 'queue', tone: 'neutral',
                    value: store.queueOrder(patients).length, label: 'Triage queue', foot: 'Patients in the department' }) +
            '</section>' +

            card('Worklist', 'STAT and urgent requests first',
                workHtml,
                '<button type="button" class="btn-text" data-go="pages/laboratory.html"><span>Open laboratory</span>' +
                icon('arrow-right', 14) + '</button>');
    }

    /* ==================================================================
        Activity feed (admin + doctor)
        ================================================================== */
    function renderActivity() {
        var host = byId('dashActivity');
        if (!host) return;

        var events = [];
        patients.forEach(function (p) {
            (p.clinicalNotes || []).forEach(function (n) {
                events.push({ time: n.time, icon: 'edit', tone: 'neutral',
                    title: n.diagnosis ? 'Diagnosis: ' + n.diagnosis : 'Clinical note recorded',
                    who: p.name, by: n.doctor });
            });
            (p.labOrders || []).forEach(function (o) {
                if (o.status === 'Completed') {
                    var flag = String(o.flag || '').toLowerCase();
                    events.push({ time: o.completedAt || o.time, icon: 'vial',
                        tone: flag === 'critical' ? 'critical' : (flag === 'abnormal' ? 'warning' : 'info'),
                        title: (flag === 'critical' ? 'Critical result: ' : (flag === 'abnormal' ? 'Abnormal result: ' : 'Result released: ')) + o.test,
                        who: p.name, by: o.technician });
                } else {
                    events.push({ time: o.time, icon: 'lab', tone: 'info',
                        title: 'Lab requested: ' + o.test, who: p.name, by: o.doctor });
                }
            });
            (p.nurseOrders || []).forEach(function (o) {
                events.push({ time: o.completedAt || o.time, icon: 'nurse', tone: 'neutral',
                    title: (store.isOrderOpen(o) ? 'Nursing order: ' : 'Nursing completed: ') + o.task,
                    who: p.name, by: o.completedBy || o.doctor });
            });
            (p.prescriptions || []).forEach(function (o) {
                events.push({ time: o.dispensedAt || o.time, icon: 'pill', tone: 'neutral',
                    title: (o.status === 'Dispensed' ? 'Dispensed: ' : 'Prescribed: ') + o.medication,
                    who: p.name, by: o.dispensedBy || o.doctor });
            });
        });

        events = events.filter(function (e) { return e.time; });
        events.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });

        if (!events.length) {
            host.innerHTML = empty('clock', 'No clinical activity yet',
                'Notes, orders and released results appear here as departments work.');
            return;
        }

        host.innerHTML = events.slice(0, 10).map(function (e) {
            return '<div class="activity-item tone-' + e.tone + '">' +
                '<span class="act-icon">' + icon(e.icon, 14) + '</span>' +
                '<span class="act-body">' +
                    '<span class="act-title">' + esc(e.title) + '</span>' +
                    '<span class="act-meta">' + esc(e.who) + (e.by ? ' · ' + esc(e.by) : '') + '</span>' +
                '</span>' +
                '<span class="act-time">' + esc(store.relativeTime(e.time)) + '</span>' +
            '</div>';
        }).join('');
    }

    /* ==================================================================
        Post-render hooks
        ================================================================== */
    function afterRender() {
        if (byId('dashActivity')) renderActivity();
        if (byId('dashBeds')) bedCards();
    }

    /* ==================================================================
        Excel export (admin)
        ================================================================== */
    function exportAnalytics() {
        var queue = store.queueOrder(patients);
        var consulting = store.consultingPatients(patients);
        var awaiting = store.awaitingPatients(patients);
        var finished = patients.filter(function (p) { return p.status === STATUS.FINISHED; });
        var openLabs = labs.filter(function (l) { return l.status !== 'Completed'; });
        var counts = bedSummary();

        var openNurse = 0;
        var unreviewed = 0;
        patients.forEach(function (p) {
            openNurse += (p.nurseOrders || []).filter(store.isOrderOpen).length;
            unreviewed += store.unreviewedResults(p).length;
        });

        var triage = { Emergency: 0, Urgent: 0, Routine: 0 };
        store.activePatients(patients).forEach(function (p) {
            triage[store.normalizeUrgency(p.urgency)]++;
        });

        ui.downloadExcel({
            filename: 'MediTrack_Records_Analytics_' + new Date().toISOString().slice(0, 10) + '.xls',
            sheetName: 'Records analytics',
            title: 'MediTrack — Records analytics',
            headers: ['Metric', 'Value'],
            rows: [
                ['Generated', new Date().toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa' })],
                ['In triage queue', queue.length],
                ['In consultation', consulting.length],
                ['Awaiting results', awaiting.length],
                ['Open lab requests', openLabs.length],
                ['Open prescriptions', scripts.filter(function (r) { return r.status !== 'Dispensed'; }).length],
                ['Open nursing orders', openNurse],
                ['Unreviewed results', unreviewed],
                ['Visits completed (all time)', finished.length],
                ['Active — Emergency', triage.Emergency],
                ['Active — Urgent', triage.Urgent],
                ['Active — Routine', triage.Routine],
                ['Staff present today', attendanceToday().length],
                ['Attendance warnings today', attendanceToday().reduce(function (n, r) { return n + (r.warnings || []).length; }, 0)],
                ['Appointments pending', pendingAppointments().length],
                ['Beds — Free', counts.Free],
                ['Beds — Occupied', counts.Occupied],
                ['Beds — Cleaning', counts.Cleaning],
                ['Beds — Reserved', counts.Reserved]
            ]
        });

        window.MediTrackNotify.flash('Export ready', 'Records analytics written to Excel.');
    }

    /* ==================================================================
        Init
        ================================================================== */
    function init() {
        var now = new Date();
        var dashDateStr;
        try {
            dashDateStr = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Addis_Ababa' }))
                .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        } catch (e) {
            dashDateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        }
        setText('dashDate', dashDateStr);

        load();
        afterRender();

        var exportBtn = byId('exportAnalyticsBtn');
        if (exportBtn) exportBtn.addEventListener('click', exportAnalytics);

        store.onPatientsChanged(load);
        window.addEventListener('storage', function (e) {
            load();
            afterRender();
        });
        /* Waiting times drift, so the figures are refreshed periodically —
           but never while nobody is looking at the tab. */
        setInterval(function () {
            if (document.hidden) return;
            load();
            afterRender();
        }, 45000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
