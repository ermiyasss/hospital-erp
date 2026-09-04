/* ==========================================================================
   MediTrack Hospital ERP - Manage Staff (administrators)

   The single place staff accounts are created, suspended, locked to a device
   or removed. Every action goes to the server, which owns the real login
   accounts; the list shown here is rebuilt live from those accounts.

   Accounts are created WITHOUT a password. Staff sign in with anything the
   first time and the server immediately walks them into choosing their own
   (see js/login.js). Administrators can still type a password for someone
   who cannot manage it themselves.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var session = window.MediSession;

    if (session.role() !== 'admin') {
        document.body.innerHTML = '<div class="page"><div class="access-denied">' +
            '<h1>Administrators only</h1><p>This screen manages login accounts.</p></div></div>';
        return;
    }

    var staff = [];
    var selected = null;
    var searchTerm = '';

    /* Add-form state: whether the administrator typed the username
       themselves, and whether they have already dismissed the duplicate
       phone warning for the number currently in the box. */
    var usernameTouched = false;
    var phoneDupAck = false;
    var phoneDupKey = '';

    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }
    function byId(id) { return document.getElementById(id); }
    function token() { try { return window.localStorage.getItem('erp_token') || ''; } catch (e) { return ''; } }
    function roleLabel(key) {
        try { var d = session.roleDefinition(key); if (d) return d.label; } catch (e) {}
        return key || '';
    }

    /* "Abhem Mekonen" -> "abhemmekonen" — matches the server's slugifyName. */
    function slugify(name) {
        return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
    }

    /* Phone numbers are matched on their last 9 digits so 0911… and
       +251 911… count as the same line. */
    function phoneKey(value) {
        var d = String(value || '').replace(/\D/g, '');
        if (d.length < 7) return '';
        return d.length <= 9 ? d : d.slice(-9);
    }

    function debounce(fn, wait) {
        var t = null;
        return function () {
            var args = arguments, self = this;
            if (t) clearTimeout(t);
            t = setTimeout(function () { t = null; fn.apply(self, args); }, wait);
        };
    }

    function api(path, body) {
        return fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
            body: JSON.stringify(body || {})
        }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); });
    }

    function afterAction(msg) {
        store.refresh(true);
        setTimeout(load, 400);
        if (msg) window.MediTrackNotify.flash('Done', msg, 'success');
    }

    /* ==================================================================
       List
       ================================================================== */
    function load() {
        staff = store.read('clinic_staff_members');
        renderList();
        if (selected) {
            var found = staff.filter(function (s) { return s.username === selected.username; })[0];
            if (found) { selected = found; renderDetail(found); } else renderEmpty();
        }
    }

    function statusBadge(s) {
        var suspended = s.suspendedUntil && new Date(s.suspendedUntil).getTime() > Date.now();
        if (!s.active) return '<span class="badge status-critical">Deactivated</span>';
        if (suspended) return '<span class="badge status-critical">Suspended</span>';
        if (s.needsPassword) return '<span class="badge status-awaiting">No password yet</span>';
        if (s.mustResetPassword) return '<span class="badge status-awaiting">Reset needed</span>';
        return '<span class="badge status-finished">Active</span>';
    }

    function renderList() {
        var host = byId('staffList');
        if (!host) return;
        var q = searchTerm.toLowerCase();
        var list = staff.filter(function (s) {
            return !q || s.name.toLowerCase().indexOf(q) !== -1 || (s.username || '').toLowerCase().indexOf(q) !== -1;
        });
        if (!list.length) { host.innerHTML = '<div class="empty-state"><p>No staff found</p></div>'; return; }

        host.innerHTML = list.map(function (s) {
            return '<div class="staff-row' + (selected && selected.username === s.username ? ' active' : '') + '" data-u="' + esc(s.username) + '">' +
                '<span class="avatar">' + esc(store.initials(s.name)) + '</span>' +
                '<span class="staff-row-body">' +
                    '<span class="staff-row-top"><span class="staff-row-name">' + esc(s.name) + '</span>' + statusBadge(s) + '</span>' +
                    '<span class="staff-row-sub">' + esc(roleLabel(String(s.role || '').toLowerCase())) +
                        (s.hwidEnforced ? ' · ' + icon('lock', 11) + ' device-locked' : '') + '</span>' +
                '</span>' +
            '</div>';
        }).join('');
        ui.qsa('.staff-row', host).forEach(function (el) {
            el.addEventListener('click', function () {
                var s = staff.filter(function (x) { return x.username === el.getAttribute('data-u'); })[0];
                if (s) { selected = s; renderList(); renderDetail(s); }
            });
        });
        if (window.MediIcons) window.MediIcons.hydrate(host);
    }

    function renderEmpty() {
        var host = byId('staffDetail');
        if (host) host.innerHTML = '<div class="empty-state"><span class="empty-state-icon"><span class="ico" data-icon="users" data-icon-size="24"></span></span><p>Select a staff member</p><span>Pick someone on the left to see their details and manage their account.</span></div>';
    }

    /* ==================================================================
       Detail
       ================================================================== */
    function renderDetail(s) {
        var host = byId('staffDetail');
        if (!host) return;
        var suspended = s.suspendedUntil && new Date(s.suspendedUntil).getTime() > Date.now();
        var until = suspended ? (function () {
            try { return new Date(s.suspendedUntil).toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa' }) + ' EAT'; }
            catch (e) { return new Date(s.suspendedUntil).toLocaleString(); }
        })() : '';

        var rows = [
            ['Username', s.username || '—'],
            ['Role', roleLabel(String(s.role || '').toLowerCase())],
            ['Phone', store.formatPhone(s.phone) || '—'],
            ['Email', s.email || '—'],
            ['Age', s.age ? String(s.age) : '—'],
            ['Usual shift', s.shift || '—'],
            ['Joined', s.joined ? store.formatDate(s.joined) : '—'],
            ['Added by', s.createdBy || '—'],
            ['Password', s.needsPassword ? 'Not set yet' : (s.mustResetPassword ? 'Change requested' : 'Set')],
            ['Status', s.active ? (suspended ? 'Suspended' : 'Active') : 'Removed']
        ];

        var hwidBlock = '<div class="staff-field">' +
            '<label>Device lock (HWID)</label>' +
            '<div class="staff-toggle-row">' +
                '<span class="staff-toggle-note">' + (s.hwidEnforced ? 'Locked to first device used.' : 'Off — can sign in from any device.') + '</span>' +
                '<button type="button" class="btn-secondary btn-sm" id="hwidToggle">' +
                    icon('lock', 14) + '<span>' + (s.hwidEnforced ? 'Turn off' : 'Enforce device') + '</span></button>' +
                (s.hwidEnforced ? '<button type="button" class="btn-ghost btn-sm" id="hwidUnlock">Unlock device</button>' : '') +
            '</div>' +
        '</div>';

        host.innerHTML =
            '<div class="staff-detail-head">' +
                '<span class="avatar avatar-lg">' + esc(store.initials(s.name)) + '</span>' +
                '<div><h2>' + esc(s.name) + '</h2>' +
                '<span class="staff-detail-role">' + esc(roleLabel(String(s.role || '').toLowerCase())) +
                    (suspended ? ' · <span style="color:var(--danger)">suspended until ' + esc(until) + '</span>' : (s.needsPassword ? ' · no password yet' : (s.mustResetPassword ? ' · reset needed' : ''))) + '</span></div>' +
                (s.active ? '' : '<span class="badge status-critical" style="margin-top:8px">This account is deactivated (sign-in blocked)</span>') +
            '</div>' +
            '<div class="staff-info-grid">' +
                rows.map(function (r) { return '<div class="staff-info"><span class="staff-info-k">' + esc(r[0]) + '</span><span class="staff-info-v">' + esc(r[1]) + '</span></div>'; }).join('') +
            '</div>' +
            hwidBlock +
            '<div class="staff-actions">' +
                '<button type="button" class="btn-secondary" id="resetPwBtn">' + icon('key', 14) + '<span>Set password</span></button>' +
                (s.active ? '<button type="button" class="btn-secondary" id="suspendBtn">' + icon('clock', 14) + '<span>Suspend</span></button>' : '') +
                (s.active ? '<button type="button" class="btn-secondary" id="deactivateBtn">' + icon('user-minus', 14) + '<span>Deactivate</span></button>' : '') +
                (s.active ? '<button type="button" class="btn-danger" id="removeBtn">' + icon('user-x', 14) + '<span>Delete account</span></button>'
                          : '<button type="button" class="btn-secondary" id="restoreBtn">' + icon('user-plus', 14) + '<span>Reactivate</span></button>') +
            '</div>';

        if (window.MediIcons) window.MediIcons.hydrate(host);

        bindDetailActions(s);
    }

    function bindDetailActions(s) {
        var reset = byId('resetPwBtn');
        if (reset) reset.addEventListener('click', function () { openPasswordModal(s); });

        var suspend = byId('suspendBtn');
        if (suspend) suspend.addEventListener('click', function () {
            openSuspendModal(s);
        });

        var hwid = byId('hwidToggle');
        if (hwid) hwid.addEventListener('click', function () {
            var enable = !s.hwidEnforced;
            api('/api/admin/staff/hwid', { username: s.username, enabled: enable }).then(function (out) {
                if (out.status === 200) afterAction(enable ? 'Device lock enforced — next sign-in registers their device.' : 'Device lock turned off.');
                else window.MediTrackNotify.flash('Could not change lock', (out.j && out.j.error) || '', 'error');
            });
        });
        var unlock = byId('hwidUnlock');
        if (unlock) unlock.addEventListener('click', function () {
            api('/api/admin/staff/hwid', { username: s.username, unlock: true }).then(function (out) {
                if (out.status === 200) afterAction('Device unlocked — they can sign in from a new device.');
                else window.MediTrackNotify.flash('Could not unlock', (out.j && out.j.error) || '', 'error');
            });
        });

        var deactivate = byId('deactivateBtn');
        if (deactivate) deactivate.addEventListener('click', function () {
            ui.confirmAction({
                title: 'Deactivate ' + s.name + '?',
                message: 'They can no longer sign in, but the account and its history are kept. You can reactivate it any time from here.',
                confirmLabel: 'Deactivate', tone: 'warning', icon: 'user-minus'
            }, function () {
                api('/api/admin/staff/deactivate', { username: s.username }).then(function (out) {
                    if (out.status === 200) afterAction(s.name + ' deactivated.');
                    else window.MediTrackNotify.flash('Could not deactivate', (out.j && out.j.error) || '', 'error');
                });
            });
        });

        var remove = byId('removeBtn');
        if (remove) remove.addEventListener('click', function () {
            ui.confirmAction({
                title: 'Permanently delete ' + s.name + '?',
                message: 'This erases their login account, attendance history, messages and group memberships for good. Their name stays on past clinical records, but nothing else about the account remains. This cannot be undone.',
                confirmLabel: 'Delete account', tone: 'danger', icon: 'user-x'
            }, function () {
                api('/api/admin/staff/remove', { username: s.username }).then(function (out) {
                    if (out.status === 200) {
                        selected = null;
                        staff = staff.filter(function (x) { return x.username !== s.username; });
                        renderList();
                        renderEmpty();
                        window.MediTrackNotify.flash('Account deleted', s.name + ' and all of their account data were removed.', 'success');
                        store.refresh(true);
                    } else {
                        window.MediTrackNotify.flash('Could not delete', (out.j && out.j.error) || '', 'error');
                    }
                });
            });
        });
        var restore = byId('restoreBtn');
        if (restore) restore.addEventListener('click', function () {
            api('/api/admin/staff/restore', { username: s.username }).then(function (out) {
                if (out.status === 200) afterAction(s.name + ' reactivated.');
                else window.MediTrackNotify.flash('Could not reactivate', (out.j && out.j.error) || '', 'error');
            });
        });
    }

    /* ==================================================================
       Administrator types a password on someone's behalf
       ================================================================== */
    function openPasswordModal(s) {
        var input = byId('pwInput');
        var sub = byId('pwModalSub');
        if (sub) sub.textContent = 'Choose what ' + s.name + ' signs in with.';
        if (input) input.value = '';
        ui.openModal('pwModal');
        setTimeout(function () { if (input) input.focus(); }, 60);

        var apply = byId('pwApplyBtn');
        if (apply) apply.onclick = function () {
            var next = input ? String(input.value || '') : '';
            if (next && next.length < 6) {
                window.MediTrackNotify.flash('Too short', 'Use at least 6 characters, or leave it blank.', 'warning');
                if (input) input.focus();
                return;
            }
            ui.closeModal('pwModal');
            api('/api/admin/staff/reset', { username: s.username, password: next }).then(function (out) {
                if (out.status === 200) {
                    afterAction(next
                        ? 'Password set for ' + s.name + '. They can sign in with it now.'
                        : s.name + ' has no password now — they will choose one the next time they sign in.');
                } else {
                    window.MediTrackNotify.flash('Could not set password', (out.j && out.j.error) || '', 'error');
                }
            });
        };
    }

    function openSuspendModal(s) {
        var choice = byId('suspendChoice');
        if (choice) ui.setSelectValue('suspendChoice', 'day', '1 day');
        var modal = byId('suspendModal');
        if (!modal) {
            /* Fallback if the modal markup is missing. */
            doSuspend(s, 'day');
            return;
        }
        ui.openModal('suspendModal');
        var apply = byId('suspendApplyBtn');
        if (apply) apply.onclick = function () {
            var dur = ui.getSelectValue('suspendChoice') || 'day';
            ui.closeModal('suspendModal');
            doSuspend(s, dur);
        };
    }

    function doSuspend(s, dur) {
        api('/api/admin/staff/suspend', { username: s.username, duration: dur }).then(function (out) {
            if (out.status === 200) afterAction(dur === 'none' ? 'Suspension cleared.' : s.name + ' suspended (' + dur + ').');
            else window.MediTrackNotify.flash('Could not suspend', (out.j && out.j.error) || '', 'error');
        });
    }

    /* ==================================================================
       Add staff
       ================================================================== */

    /* A warning strip under a field that does not block until the
       administrator says they have read it. */
    function showWarn(id, html, allowLabel, onAllow) {
        var box = byId(id);
        if (!box) return;
        box.innerHTML = '<span class="fw-icon"><span class="ico" data-icon="warning" data-icon-size="14"></span></span>' +
            '<span class="fw-text">' + html + '</span>' +
            '<button type="button" class="fw-action">' + esc(allowLabel) + '</button>';
        box.hidden = false;
        if (window.MediIcons) window.MediIcons.hydrate(box);
        var btn = box.querySelector('.fw-action');
        if (btn) btn.addEventListener('click', onAllow);
    }

    function hideWarn(id) {
        var box = byId(id);
        if (box) { box.hidden = true; box.innerHTML = ''; }
    }

    /* Who else in the hospital already uses this number? */
    function phoneClash(phone) {
        var key = phoneKey(phone);
        if (!key) return null;
        return staff.filter(function (s) {
            return s.active !== false && phoneKey(s.phone) === key;
        })[0] || null;
    }

    function checkPhone() {
        var phone = byId('sfPhone') ? byId('sfPhone').value.trim() : '';
        var key = phoneKey(phone);
        if (key !== phoneDupKey) { phoneDupKey = key; phoneDupAck = false; }
        var clash = phoneClash(phone);
        if (!clash) { hideWarn('sfPhoneWarn'); return null; }
        if (phoneDupAck) {
            showWarn('sfPhoneWarn',
                '<strong>' + esc(clash.name) + '</strong> already uses this number. Creating anyway.',
                'Undo', function () { phoneDupAck = false; checkPhone(); });
        } else {
            showWarn('sfPhoneWarn',
                '<strong>' + esc(clash.name) + '</strong> (' + esc(roleLabel(String(clash.role || '').toLowerCase())) + ') already uses ' + esc(store.formatPhone(clash.phone) || phone) + '. ' +
                'This may be the same person twice.',
                'Create anyway', function () { phoneDupAck = true; checkPhone(); });
        }
        return clash;
    }

    /* Warn when the derived username collides; the server will quietly pick
       the next free number if they go ahead. */
    function checkUsername() {
        var value = byId('sfUsername') ? byId('sfUsername').value.trim().toLowerCase() : '';
        if (!value) { hideWarn('sfUserWarn'); return; }
        var clash = staff.filter(function (s) {
            return String(s.username || '').toLowerCase() === value;
        })[0];
        if (!clash) { hideWarn('sfUserWarn'); return; }
        var base = value.replace(/\d+$/, '') || value;
        var n = 2;
        var taken = {};
        staff.forEach(function (s) { taken[String(s.username || '').toLowerCase()] = true; });
        while (taken[base + n]) n++;
        showWarn('sfUserWarn',
            '<strong>' + esc(value) + '</strong> is taken by ' + esc(clash.name) + '. ' +
            'Creating anyway will use <strong>' + esc(base + n) + '</strong>.',
            'Use ' + (base + n), function () {
                var f = byId('sfUsername');
                if (f) { f.value = base + n; usernameTouched = true; checkUsername(); f.focus(); }
            });
    }

    function syncUsernameFromName() {
        if (usernameTouched) return;
        var nameField = byId('sfName');
        var userField = byId('sfUsername');
        if (!nameField || !userField) return;
        userField.value = slugify(nameField.value);
        checkUsername();
    }

    function openAdd() {
        usernameTouched = false;
        phoneDupAck = false;
        phoneDupKey = '';
        ['sfName', 'sfUsername', 'sfPhone', 'sfEmail', 'sfAge', 'sfShift'].forEach(function (id) {
            var el = byId(id);
            if (el) el.value = '';
        });
        ui.clearFieldError('sfName'); ui.clearFieldError('sfPhone');
        hideWarn('sfPhoneWarn'); hideWarn('sfUserWarn');
        ui.setSelectValue('sfRole', 'nurse', 'Nurse');
        ui.openModal('addStaffModal');
        setTimeout(function () { var n = byId('sfName'); if (n) n.focus(); }, 50);
    }

    function saveStaff() {
        var name = byId('sfName').value.trim();
        var phone = byId('sfPhone').value.trim();
        var role = ui.getSelectValue('sfRole');
        if (!name) { ui.fieldError('sfName', 'Name is required.'); return; }
        else ui.clearFieldError('sfName');
        if (!phone) { ui.fieldError('sfPhone', 'Phone is required.'); return; }
        else ui.clearFieldError('sfPhone');

        /* A duplicate phone blocks the first attempt only — once they have
           said "create anyway" the acknowledgement rides along with the rest
           of the payload so a re-check on the server cannot bounce it. */
        var clash = phoneClash(phone);
        if (clash && !phoneDupAck) {
            checkPhone();
            var pf = byId('sfPhone');
            if (pf) pf.focus();
            window.MediTrackNotify.flash('Check the phone number',
                clash.name + ' already uses it. Choose "Create anyway" if this is intentional.', 'warning');
            return;
        }

        var btn = byId('saveStaffBtn');
        if (btn) btn.disabled = true;

        var payload = {
            name: name,
            username: byId('sfUsername').value.trim(),
            usernameAuto: !usernameTouched,
            role: role,
            phone: phone,
            email: byId('sfEmail').value.trim(),
            age: byId('sfAge').value.trim(),
            shift: byId('sfShift').value.trim(),
            allowDuplicatePhone: !!(clash && phoneDupAck)
        };

        api('/api/admin/staff', payload).then(function (out) {
            if (btn) btn.disabled = false;
            if (out.status === 200) {
                ui.closeModal('addStaffModal');
                afterAction('Account created for ' + name + '. Username: ' + out.j.username +
                    (out.j.needsPassword ? ' — they choose a password the first time they sign in.' : '.'));
            } else if (out.status === 409) {
                var err = (out.j && out.j.error) || '';
                if (err.indexOf('DUPLICATE_PHONE:') === 0) {
                    checkPhone();
                    window.MediTrackNotify.flash('Duplicate phone number', err.slice('DUPLICATE_PHONE:'.length), 'warning');
                } else {
                    ui.fieldError('sfUsername', err);
                }
            } else {
                window.MediTrackNotify.flash('Could not create', (out.j && out.j.error) || '', 'error');
            }
        }).catch(function () {
            if (btn) btn.disabled = false;
            window.MediTrackNotify.flash('Could not create', 'The server did not answer. Try again.', 'error');
        });
    }

    /* ==================================================================
       Init
       ================================================================== */
    function init() {
        load();
        ui.initSelect('sfRole');

        var search = byId('staffSearch');
        var searchClear = byId('staffSearchClear');
        if (search) {
            var syncClear = function () { if (searchClear) searchClear.classList.toggle('visible', !!search.value); };
            /* Debounced so a fast typist does not rebuild the list on
               every keystroke. */
            var runSearch = debounce(function () {
                searchTerm = search.value.trim();
                renderList();
                syncClear();
            }, 160);
            search.addEventListener('input', runSearch);
            syncClear();
        }
        if (searchClear) searchClear.addEventListener('click', function () {
            if (search) { search.value = ''; searchTerm = ''; renderList(); search.focus(); }
            searchClear.classList.remove('visible');
        });

        var add = byId('addStaffBtn');
        if (add) add.addEventListener('click', openAdd);
        var save = byId('saveStaffBtn');
        if (save) save.addEventListener('click', saveStaff);

        var name = byId('sfName');
        if (name) name.addEventListener('input', syncUsernameFromName);

        var user = byId('sfUsername');
        if (user) user.addEventListener('input', function () {
            /* Any typing at all counts as taking over from the auto-fill. */
            usernameTouched = true;
            checkUsername();
        });

        var phone = byId('sfPhone');
        if (phone) phone.addEventListener('input', debounce(checkPhone, 220));

        window.addEventListener('storage', function (e) {
            if (!e.key || e.key === 'clinic_staff_members') load();
        });
        /* Only poll while the tab is actually being looked at. */
        setInterval(function () { if (!document.hidden) load(); }, 8000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window, document);
