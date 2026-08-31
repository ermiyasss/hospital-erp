/* ==========================================================================
   MediTrack Hospital ERP - Attendance

   Serious by design. Every check-in and check-out goes through the hospital
   server, which enforces the rules no matter what a browser tries:

     - one record per account per day, keyed on the sign-in account
     - a checked-in day can never be removed or rewritten by any client
     - the day stays open until the person checks out
     - the administrator sets the check-in and check-out windows; arriving
       or leaving outside the window records a warning on the day
     - the second warning in one day alerts every administrator at once
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var session = window.MediSession;

    var KEY = store.KEYS.attendance;
    var POLICY_KEY = 'clinic_attendance_policy';

    var records = [];
    var policy = null;
    var period = 'today';
    var manualUsername = '';

    function esc(s) { return store.escapeHtml(s); }
    function byId(id) { return document.getElementById(id); }
    function icon(name, size) { return ui.icon(name, size); }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value === null || value === undefined ? '—' : value;
    }

    function api(path, body) {
        return fetch(path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (store.authToken() || '')
            },
            body: JSON.stringify(body || {})
        }).then(function (r) {
            return r.json().then(function (j) { return { status: r.status, j: j }; });
        });
    }

    function me() {
        try { return session.read() || {}; }
        catch (e) { return {}; }
    }

    function myUsername() {
        return String(me().user || '').toLowerCase();
    }

    function isAdmin() {
        return session.role() === 'admin';
    }

    function todayKey(d) {
        var t = d || new Date();
        return t.getFullYear() + '-' +
            String(t.getMonth() + 1).padStart(2, '0') + '-' +
            String(t.getDate()).padStart(2, '0');
    }

    function roleLabel(key) {
        try {
            var def = session.roleDefinition(key);
            if (def && def.label) return def.label;
        } catch (e) {}
        return key || '—';
    }

    /* ==================================================================
        Load
        ================================================================== */
    var DEFAULT_POLICY = {
        checkinStart: '08:00', checkinEnd: '09:00',
        checkoutStart: '17:00', checkoutEnd: '18:00',
        graceMinutes: 15
    };

    function readPolicy() {
        var p = store.SERVER_MODE ? store.read(POLICY_KEY) : null;
        if (!p || typeof p !== 'object' || Array.isArray(p)) {
            try { p = JSON.parse(store.rawGet(POLICY_KEY) || 'null'); } catch (e) { p = null; }
        }
        return Object.assign({}, DEFAULT_POLICY,
            p && typeof p === 'object' && !Array.isArray(p) ? p : {});
    }

    function load() {
        records = store.read(KEY);
        policy = readPolicy();
        render();
    }

    function save() {
        store.write(KEY, records);
    }

    function withinPeriod(r) {
        if (period === 'all') return true;
        var days = period === 'today' ? 0 : Number(period);
        var when = new Date(r.date + 'T00:00:00');
        if (isNaN(when.getTime())) return false;
        if (days === 0) return r.date === todayKey();
        return (Date.now() - when.getTime()) < (days + 1) * 86400000;
    }

    /* ==================================================================
        Render
        ================================================================== */
    function render() {
        renderClock();
        renderStats();
        renderList();
        renderRoleBreakdown();
        renderWeekChart();
        renderAdminAnalytics();

        var isAdminUser = isAdmin();
        var manualBtn = byId('manualEntryBtn');
        if (manualBtn) manualBtn.classList.toggle('is-hidden', !isAdminUser);
        var policyBtn = byId('policyBtn');
        if (policyBtn) policyBtn.classList.toggle('is-hidden', !isAdminUser);

        var clockCard = byId('attClockCard');
        var adminCard = byId('attAdminCard');
        if (clockCard) clockCard.classList.toggle('is-hidden', isAdminUser);
        if (adminCard) adminCard.classList.toggle('is-hidden', !isAdminUser);
    }

    function renderAdminAnalytics() {
        var host = byId('attAdminGrid');
        if (!host || !isAdmin()) return;

        var staff = store.read('clinic_staff_members')
            .filter(function (s) { return s.active !== false; });
        var roster = staff.map(function (s) {
            var rec = records.filter(function (r) {
                return r.date === todayKey() && String(r.username || '').toLowerCase() === String(s.username || '').toLowerCase();
            })[0] || null;
            return {
                name: s.name, role: String(s.role || '').toLowerCase(),
                rec: rec,
                state: !rec ? 'absent' : (rec.out ? 'left' : 'present'),
                late: !!(rec && rec.inLate),
                warnings: rec ? (rec.warnings || []).length : 0
            };
        });

        var present = roster.filter(function (r) { return r.state === 'present'; });
        var left = roster.filter(function (r) { return r.state === 'left'; });
        var late = roster.filter(function (r) { return r.late; });
        var absent = roster.filter(function (r) { return r.state === 'absent'; });
        var warned = roster.filter(function (r) { return r.warnings >= 2; });

        function chip(label, sub, tone, iconName) {
            return '<div class="att-admin-tile tone-' + tone + '">' +
                '<span class="att-admin-tile-ico">' + icon(iconName, 18) + '</span>' +
                '<span class="att-admin-tile-n">' + label + '</span>' +
                '<span class="att-admin-tile-sub">' + sub + '</span></div>';
        }

        host.innerHTML =
            chip(present.length, 'currently on site', 'success', 'users') +
            chip(left.length, 'checked out', 'info', 'log-out') +
            chip(late.length, 'arrived late', 'warning', 'clock') +
            chip(absent.length, 'not yet checked in', absent.length ? 'critical' : 'neutral', 'user-x') +
            chip(warned.length, 'at 2+ warnings', warned.length ? 'critical' : 'neutral', 'warning');

        var detail = [].concat(present, left).map(function (r) {
            return '<div class="list-item">' +
                '<span class="avatar-sq urgency-routine">' + esc(store.initials(r.name)) + '</span>' +
                '<span class="list-content"><span class="list-title">' + esc(r.name) + '</span>' +
                '<span class="list-subtitle">' + esc(roleLabel(r.role)) +
                    (r.late ? ' · late' : '') + '</span></span>' +
                '<span class="list-tail"><span class="badge ' +
                    (r.state === 'present' ? 'status-finished' : 'status-pending') + '">' +
                    (r.state === 'present' ? 'On site' : 'Left') + '</span>' +
                    (r.warnings ? '<span class="badge status-critical">' + r.warnings + ' warn</span>' : '') +
                '</span></div>';
        }).join('');

        if (absent.length) {
            detail += '<div class="att-admin-subhead">Not yet checked in</div>' +
                absent.map(function (r) {
                    return '<div class="list-item">' +
                        '<span class="avatar-sq urgency-routine">' + esc(store.initials(r.name)) + '</span>' +
                        '<span class="list-content"><span class="list-title">' + esc(r.name) + '</span>' +
                        '<span class="list-subtitle">' + esc(roleLabel(r.role)) + '</span></span>' +
                        '<span class="list-tail"><span class="badge status-awaiting">Absent</span></span></div>';
                }).join('');
        }

        var existing = byId('attAdminList');
        if (!existing) {
            host.insertAdjacentHTML('beforeend', '<div class="att-admin-list" id="attAdminList"></div>');
        }
        var listHost = byId('attAdminList');
        if (listHost) listHost.innerHTML = detail;
        if (window.MediIcons) window.MediIcons.hydrate(host);
    }

    function myRecordToday() {
        var uname = myUsername();
        return records.filter(function (r) {
            return r.date === todayKey() &&
                String(r.username || '').toLowerCase() === uname;
        })[0] || null;
    }

    /* Replace any prior record for the same account+day with the authoritative
       server copy so the in-memory list and the server never disagree. */
    function mergeRecord(rec) {
        if (!rec || !rec.username) return;
        records = records.filter(function (r) {
            return !(r.date === rec.date &&
                String(r.username || '').toLowerCase() === String(rec.username || '').toLowerCase());
        });
        records.push(rec);
    }

    function renderClock() {
        var s = me();
        setText('attUserName', s.name || 'Signed-in staff');
        setText('attUserRole', roleLabel(session.role()));

        var initials = store.initials ? store.initials(s.name || '') : '';
        setText('attAvatar', initials);

        var rec = myRecordToday();
        var state = byId('attClockState');
        var inBtn = byId('checkInBtn');
        var outBtn = byId('checkOutBtn');

        if (state) {
            if (!rec) {
                state.textContent = 'Not checked in yet';
                state.className = 'att-clock-state is-out';
            } else if (!rec.out) {
                state.textContent = 'Checked in at ' + store.formatTime(rec.in) +
                    (rec.inLate ? ' · late' : '');
                state.className = 'att-clock-state is-in' + (rec.inLate ? ' is-late' : '');
            } else {
                state.textContent = 'Day locked — ' + store.formatTime(rec.in) +
                    ' → ' + store.formatTime(rec.out);
                state.className = 'att-clock-state is-done-day';
            }
        }
        if (inBtn) inBtn.classList.toggle('is-hidden', !!(rec && !rec.out) || !!rec);
        if (outBtn) outBtn.classList.toggle('is-hidden', !(rec && !rec.out));

        /* The window the administrator set. */
        var line = byId('attPolicyLine');
        if (line) {
            line.textContent = 'Check-in ' + policy.checkinStart + '–' + policy.checkinEnd +
                ' · Check-out ' + policy.checkoutStart + '–' + policy.checkoutEnd +
                ' · Grace ' + policy.graceMinutes + ' min';
        }

        /* My own warnings today, plus a 30-day history for context. */
        var notice = byId('myWarningNotice');
        var text = byId('myWarningText');
        if (notice && text) {
            if (rec && rec.warnings && rec.warnings.length) {
                notice.classList.remove('is-hidden');
                text.innerHTML = '<strong>' + rec.warnings.length + ' attendance warning' +
                    (rec.warnings.length > 1 ? 's' : '') + ' today.</strong> ' +
                    esc(rec.warnings.map(function (w) { return w.detail; }).join(' · ')) +
                    (rec.warnings.length >= 2 ? ' Administrators have been notified.' : '');
            } else {
                /* No warnings today — still show the 30-day picture so staff
                   can see how close they are to a manager notification. */
                var monthCutoff = Date.now() - 30 * 86400000;
                var monthWarns = 0;
                records.forEach(function (r) {
                    if (String(r.username || '').toLowerCase() !== myUsername()) return;
                    var when = new Date(r.date + 'T00:00:00').getTime();
                    if (isNaN(when) || when < monthCutoff) return;
                    monthWarns += (r.warnings || []).length;
                });
                /* Two warnings on a single day triggers the admin alert, so the
                   "left before notify" is how many more distinct days of 2
                   warnings remain in the month — shown softly, not as alarm. */
                notice.classList.remove('is-hidden', 'notice-warning');
                notice.classList.add('notice-info');
                text.innerHTML = '<strong>Last 30 days: ' + monthWarns + ' warning' +
                    (monthWarns === 1 ? '' : 's') + '.</strong> Two warnings in one day notifies administrators.' +
                    (rec ? '' : ' You have not checked in yet today.');
            }
        }
    }

    function renderStats() {
        var today = records.filter(function (r) { return r.date === todayKey(); });
        var openNow = today.filter(function (r) { return !r.out; });

        setText('statPresent', today.length);
        setText('footPresent', openNow.length
            ? openNow.length + ' still on site'
            : (today.length ? 'Everyone has checked out' : 'Nobody has checked in yet'));

        var warningCount = 0;
        today.forEach(function (r) {
            warningCount += (r.warnings || []).length;
        });
        setText('statWarnings', warningCount);

        var weekCutoff = Date.now() - 7 * 86400000;
        var week = records.filter(function (r) {
            var when = new Date(r.date + 'T00:00:00').getTime();
            return !isNaN(when) && when >= weekCutoff;
        });
        setText('statWeekCheckins', week.length);
        setText('statAvgDay', Math.round(week.length / 7));
    }

    function durationText(r) {
        if (!r.out) return '';
        var mins = Math.max(0, Math.round((new Date(r.out) - new Date(r.in)) / 60000));
        if (mins < 60) return mins + 'm';
        var h = Math.floor(mins / 60);
        return h + 'h ' + (mins % 60 ? (mins % 60) + 'm' : '');
    }

    var WARNING_LABELS = {
        late_checkin: 'Late check-in',
        early_checkout: 'Early check-out',
        late_checkout: 'Late check-out'
    };

    function renderList() {
        var host = byId('attendanceList');
        if (!host) return;

        var rows = records.filter(withinPeriod)
            .sort(function (a, b) {
                var ta = a.in || a.date;
                var tb = b.in || b.date;
                return new Date(tb) - new Date(ta);
            });

        setText('whoCameSub',
            rows.length + ' record' + (rows.length === 1 ? '' : 's') +
            (period === 'today' ? ' · today' : ''));

        if (!rows.length) {
            host.innerHTML = ui.emptyState({
                icon: 'calendar',
                title: 'No attendance recorded',
                text: 'Use "Check in" above when you arrive — the server keeps the record until you check out.'
            });
            return;
        }

        host.innerHTML = rows.map(function (r) {
            var onSite = !r.out;
            var warns = r.warnings || [];
            var warnChips = warns.map(function (w) {
                return '<span class="badge status-critical" title="' + esc(w.detail || '') + '">' +
                    icon('warning', 11) + '<span>' + esc(WARNING_LABELS[w.code] || 'Warning') + '</span></span>';
            }).join('');

            return '<div class="list-item att-row">' +
                '<span class="avatar-sq urgency-routine">' + esc(store.initials(r.name)) + '</span>' +
                '<span class="list-content">' +
                    '<span class="list-title">' + esc(r.name || 'Unknown') +
                        (r.manual ? '<span class="list-id mono">manual</span>' : '') +
                    '</span>' +
                    '<span class="list-subtitle">' + esc(roleLabel(r.role)) +
                        ' · ' + esc(store.formatDate(r.date)) + '</span>' +
                    (warnChips ? '<span class="list-subtitle">' + warnChips + '</span>' : '') +
                '</span>' +
                '<span class="list-tail">' +
                    '<span class="badge ' + (onSite ? 'status-finished' : 'status-pending') + '">' +
                        (onSite ? icon('play', 12) + '<span>On site</span>'
                                : icon('check', 12) + '<span>Left</span>') +
                    '</span>' +
                    '<span class="list-wait">' + esc(store.formatTime(r.in)) +
                        (r.out ? ' → ' + esc(store.formatTime(r.out)) : '') +
                        (durationText(r) ? ' (' + esc(durationText(r)) + ')' : '') + '</span>' +
                '</span>' +
            '</div>';
        }).join('');
    }

    function renderRoleBreakdown() {
        var host = byId('roleBreakdown');
        if (!host) return;

        var roles = ['doctor', 'nurse', 'admin', 'billing', 'lab'];
        var counts = {};
        roles.forEach(function (r) { counts[r] = 0; });

        var rows = records.filter(withinPeriod);
        rows.forEach(function (r) {
            if (counts[r.role] !== undefined) counts[r.role]++;
        });

        var max = Math.max(1, Math.max.apply(null, roles.map(function (r) { return counts[r]; })));

        host.innerHTML = roles.map(function (key) {
            var pct = Math.round((counts[key] / max) * 100);
            return '<div class="dept-row dept-static">' +
                '<span class="dept-body">' +
                    '<span class="dept-top">' +
                        '<span class="dept-label">' + esc(roleLabel(key)) + '</span>' +
                        '<span class="dept-value">' + counts[key] + '</span>' +
                    '</span>' +
                    '<span class="dept-bar"><span class="dept-fill tone-info" style="width:' + pct + '%"></span></span>' +
                '</span>' +
            '</div>';
        }).join('');
    }

    function renderWeekChart() {
        var host = byId('weekChart');
        if (!host) return;

        var days = [];
        for (var i = 6; i >= 0; i--) {
            var d = new Date(Date.now() - i * 86400000);
            days.push({ key: todayKey(d), label: d.toLocaleDateString('en-US', { weekday: 'short' }), n: 0 });
        }
        records.forEach(function (r) {
            days.forEach(function (d) {
                if (d.key === r.date) d.n++;
            });
        });

        var max = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.n; })));

        host.innerHTML = days.map(function (d) {
            var pct = Math.round((d.n / max) * 100);
            return '<div class="week-col">' +
                '<span class="week-count">' + d.n + '</span>' +
                '<span class="week-bar"><span class="week-fill" style="height:' + pct + '%"></span></span>' +
                '<span class="week-label">' + esc(d.label) + '</span>' +
            '</div>';
        }).join('');
    }

    /* ==================================================================
        Actions
        ================================================================== */
    function checkIn() {
        var uname = myUsername();
        var existing = records.filter(function (r) {
            return r.date === todayKey() && String(r.username || '').toLowerCase() === uname;
        })[0];
        if (existing) {
            window.MediTrackNotify.flash(existing.out ? 'Day already closed' : 'Already checked in',
                existing.out
                    ? 'Your day is locked until tomorrow — the server kept the record.'
                    : 'You are checked in. Check out when you leave.',
                'info');
            return;
        }

        if (store.SERVER_MODE) {
            api('/api/attendance/checkin', {}).then(function (out) {
                if (out.status === 200) {
                    /* Merge the authoritative server record straight into memory
                       and repaint immediately so the check-out button and state
                       appear at once. The background refresh below re-syncs the
                       full collection from the server (now that attendance is a
                       mapped key) and the storage event it fires reloads again,
                       so the UI stays correct even across navigations/reloads. */
                    if (out.j.record) mergeRecord(out.j.record);
                    store.refresh(true);
                    render();
                    var warned = out.j.record && out.j.record.warnings && out.j.record.warnings.length;
                    window.MediTrackNotify.flash('Checked in',
                        'Have a good shift, ' + (me().name || '') + '.' +
                        (warned ? ' The server recorded a warning for the late check-in.' : ''),
                        warned ? 'warning' : 'success');
                } else {
                    window.MediTrackNotify.flash('Not recorded',
                        (out.j && out.j.error) || 'The server refused the check-in.', 'error');
                    load();
                }
            }).catch(function () {
                window.MediTrackNotify.flash('Server unreachable',
                    'Attendance is kept by the server — check the network connection.', 'error');
            });
            return;
        }

        records.push({
            id: 'att_' + Date.now(),
            username: uname,
            name: me().name || 'Unknown',
            role: session.role(),
            date: todayKey(),
            in: new Date().toISOString(),
            out: null,
            warnings: []
        });
        save();
        load();
        window.MediTrackNotify.flash('Checked in', 'Have a good shift, ' + (me().name || '') + '.');
    }

    function checkOut() {
        var uname = myUsername();
        var rec = records.filter(function (r) {
            return r.date === todayKey() && String(r.username || '').toLowerCase() === uname && !r.out;
        })[0];
        if (!rec) {
            window.MediTrackNotify.flash('No open day', 'Check in first — the day opens with an arrival.', 'info');
            return;
        }

        if (store.SERVER_MODE) {
            api('/api/attendance/checkout', {}).then(function (out) {
                if (out.status === 200) {
                    if (out.j.record) mergeRecord(out.j.record);
                    store.refresh(true);
                    render();
                    var warned = out.j.record && out.j.record.warnings &&
                        out.j.record.warnings.length > 0;
                    window.MediTrackNotify.flash('Checked out',
                        'Shift recorded: ' + store.formatTime(out.j.record.in) + ' → ' +
                        store.formatTime(out.j.record.out) + '.' +
                        (warned ? ' A warning was recorded for leaving outside the window.' : ''),
                        warned ? 'warning' : 'success');
                } else {
                    window.MediTrackNotify.flash('Not recorded',
                        (out.j && out.j.error) || 'The server refused the check-out.', 'error');
                    load();
                }
            }).catch(function () {
                window.MediTrackNotify.flash('Server unreachable',
                    'Attendance is kept by the server — check the network connection.', 'error');
            });
            return;
        }

        rec.out = new Date().toISOString();
        save();
        load();
        window.MediTrackNotify.flash('Checked out', 'Shift recorded.');
    }

    /* ------------------------------------------------------------ admin */
    function openPolicy() {
        byId('policyCheckinStart').value = policy.checkinStart;
        byId('policyCheckinEnd').value = policy.checkinEnd;
        byId('policyCheckoutStart').value = policy.checkoutStart;
        byId('policyCheckoutEnd').value = policy.checkoutEnd;
        byId('policyGrace').value = policy.graceMinutes;
        ui.openModal('policyModal');
    }

    function savePolicy() {
        var body = {
            checkinStart: byId('policyCheckinStart').value,
            checkinEnd: byId('policyCheckinEnd').value,
            checkoutStart: byId('policyCheckoutStart').value,
            checkoutEnd: byId('policyCheckoutEnd').value,
            graceMinutes: Number(byId('policyGrace').value || 0)
        };

        if (store.SERVER_MODE) {
            fetch('/api/data/' + encodeURIComponent(POLICY_KEY), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + (store.authToken() || '')
                },
                body: JSON.stringify(body)
            }).then(function (r) {
                return r.json().then(function (j) { return { status: r.status, j: j }; });
            }).then(function (out) {
                if (out.status === 200) {
                    policy = body;
                    ui.closeModal('policyModal');
                    render();
                    window.MediTrackNotify.push('Attendance window updated',
                        'Check-in ' + body.checkinStart + '–' + body.checkinEnd + ' · Check-out ' +
                        body.checkoutStart + '–' + body.checkoutEnd + '.',
                        'success', 'Attendance', 'normal');
                } else {
                    window.MediTrackNotify.flash('Not saved',
                        (out.j && out.j.error) || 'The window could not be saved.', 'error');
                }
            }).catch(function () {
                window.MediTrackNotify.flash('Server unreachable', 'Try again in a moment.', 'error');
            });
            return;
        }

        policy = body;
        store.rawSet(POLICY_KEY, JSON.stringify(body));
        ui.closeModal('policyModal');
        render();
    }

    function openManual() {
        var menu = byId('manualStaffMenu');
        if (menu) {
            var staff = store.read('clinic_staff_members')
                .filter(function (s) { return s.active !== false; })
                .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
            menu.innerHTML = staff.length
                ? staff.map(function (s) {
                    return '<li class="cs-option" data-value="' + esc(s.username) + '" data-label="' +
                        esc(s.name) + '">' + esc(s.name) + ' · ' + esc(roleLabel(String(s.role || '').toLowerCase())) + '</li>';
                }).join('')
                : '<li class="cs-option" data-value="" data-label="Choose a staff member">No staff found</li>';
        }
        manualUsername = '';
        ui.setSelectValue('manualStaffWrapper', '', 'Choose a staff member');
        ui.openModal('manualModal');
    }

    function addManual() {
        var username = ui.getSelectValue('manualStaffWrapper');
        if (!username) {
            window.MediTrackNotify.flash('Choose someone', 'Pick the staff member to check in.', 'warning');
            return;
        }
        api('/api/attendance/checkin', { username: username }).then(function (out) {
            if (out.status === 200) {
                ui.closeModal('manualModal');
                store.refresh(true);
                setTimeout(load, 400);
                window.MediTrackNotify.flash('Attendance added',
                    (out.j.record && out.j.record.name || 'Staff member') + ' marked as present.');
            } else {
                window.MediTrackNotify.flash('Not recorded',
                    (out.j && out.j.error) || 'The server refused the entry.', 'error');
            }
        }).catch(function () {
            window.MediTrackNotify.flash('Server unreachable', 'Try again in a moment.', 'error');
        });
    }

    function exportExcel() {
        var rows = records.filter(withinPeriod);

        if (!rows.length) {
            window.MediTrackNotify.push(
                'Nothing to export',
                'No attendance records in the selected period.',
                'warning', 'System', 'medium'
            );
            return;
        }

        var name = 'MediTrack_Attendance_' + new Date().toISOString().slice(0, 10) + '.xls';

        ui.downloadExcel({
            filename: name,
            sheetName: 'Attendance',
            title: 'MediTrack — Staff attendance',
            headers: ['Staff name', 'Username', 'Role', 'Date', 'Checked in', 'Checked out', 'Duration', 'Warnings'],
            rows: rows.map(function (r) {
                return [
                    r.name, r.username || '', roleLabel(r.role), r.date,
                    store.formatTime(r.in),
                    r.out ? store.formatTime(r.out) : '',
                    durationText(r),
                    (r.warnings || []).map(function (w) {
                        return WARNING_LABELS[w.code] || 'Warning';
                    }).join('; ')
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

        ui.initSelect('attPeriodWrapper', function (v) { period = v; render(); });
        ui.initSelect('manualStaffWrapper', function (v) { manualUsername = v; });

        var inBtn = byId('checkInBtn');
        if (inBtn) inBtn.addEventListener('click', checkIn);
        var outBtn = byId('checkOutBtn');
        if (outBtn) outBtn.addEventListener('click', checkOut);
        var manualBtn = byId('manualEntryBtn');
        if (manualBtn) manualBtn.addEventListener('click', openManual);
        var confirmManual = byId('confirmManualBtn');
        if (confirmManual) confirmManual.addEventListener('click', addManual);
        var exportBtn = byId('exportAttendanceBtn');
        if (exportBtn) exportBtn.addEventListener('click', exportExcel);
        var policyBtn = byId('policyBtn');
        if (policyBtn) policyBtn.addEventListener('click', openPolicy);
        var savePolicyBtn = byId('savePolicyBtn');
        if (savePolicyBtn) savePolicyBtn.addEventListener('click', savePolicy);

        window.addEventListener('storage', function (e) {
            if (!e.key || e.key === KEY || e.key === POLICY_KEY) load();
        });

        /* Pick up policy changes from other workstations. */
        setInterval(function () {
            var fresh = readPolicy();
            if (JSON.stringify(fresh) !== JSON.stringify(policy)) {
                policy = fresh;
                render();
            }
        }, 10000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
