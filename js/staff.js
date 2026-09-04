/* ==========================================================================
   MediTrack Hospital ERP - Staff Directory

   Personnel records AND their sign-in accounts. When the app runs against
   the LAN server, saving this directory creates/updates real accounts on
   the server; passwords are hashed there (scrypt) and never stored in any
   browser. Access requests are recorded for an administrator to action.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;

    var STAFF_KEY = 'clinic_staff_members';
    var REQUESTS_KEY = 'clinic_admin_requests';

    var staff = [];
    var requests = [];
    var searchTerm = '';
    var roleFilter = '';
    var editingId = null;

    var ROLES = {
        Admin:   { label: 'Administrator', icon: 'shield-check', duties: 'System configuration, staff records, oversight of all departments.' },
        Doctor:  { label: 'Clinician',     icon: 'stethoscope',  duties: 'Consultation desk: examination, diagnosis, ordering diagnostics and prescribing.' },
        Nurse:   { label: 'Nurse',         icon: 'nurse',        duties: 'Nurse station: bedside tasks, patient tracking and observations.' },
        Lab:     { label: 'Lab Assistant', icon: 'lab',          duties: 'Specimen collection, analysis and release of results with classification.' },
        Billing: { label: 'Billing',       icon: 'receipt',      duties: 'Registration support, invoices, payments and the calling queue.' }
    };

    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }
    function byId(id) { return document.getElementById(id); }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value;
    }

    function roleMeta(role) {
        return ROLES[role] || { label: role || 'Unassigned', icon: 'user', duties: '' };
    }

    /* ==================================================================
       Load
       ================================================================== */
    function load() {
        staff = store.read(STAFF_KEY);
        if (!staff.length) {
            staff = seedStaff();
            store.write(STAFF_KEY, staff);
        }
        requests = store.read(REQUESTS_KEY);
        render();
    }

    function save() {
        store.write(STAFF_KEY, staff);
    }

    function seedStaff() {
        var daysAgo = function (d) { return new Date(Date.now() - d * 86400000).toISOString(); };
        return [
            { id: 1, name: 'Dr. Sarah Chen',        username: 'schen',    email: 'schen@hospital.example',   phone: '0911 000 001', role: 'Admin',      department: 'Hospital Administration', shift: 'Day',      joined: daysAgo(420) },
            { id: 2, name: 'Dr. Abebe Kebede',      username: 'akebede',  email: 'akebede@hospital.example', phone: '0912 345 678', role: 'Doctor',     department: 'Internal Medicine',       shift: 'Day',      joined: daysAgo(180) },
            { id: 3, name: 'Dr. Lelise Fikru',      username: 'lfikru',   email: 'lfikru@hospital.example',  phone: '0912 987 654', role: 'Doctor',     department: 'Emergency',               shift: 'Night',    joined: daysAgo(96) },
            { id: 4, name: 'Sr. Fatima Ali',        username: 'fali',     email: 'fali@hospital.example',    phone: '0913 456 789', role: 'Nurse',      department: 'Emergency Ward',          shift: 'Rotating', joined: daysAgo(120) },
            { id: 5, name: 'Solomon Tadesse',       username: 'stadesse', email: 'stadesse@hospital.example',phone: '0914 567 890', role: 'Lab',        department: 'Diagnostic Pathology',    shift: 'Day',      joined: daysAgo(90) },
            { id: 6, name: 'Hana Getachew',         username: 'hgetachew',email: 'hgetachew@hospital.example',phone: '0915 678 901',role: 'Billing',    department: 'Cash Office',             shift: 'Day',      joined: daysAgo(60) },
            { id: 7, name: 'Meron Yilma',           username: 'myilma',   email: 'myilma@hospital.example',  phone: '0916 789 012', role: 'Billing',    department: 'Patient Registration',    shift: 'Evening',  joined: daysAgo(30) }
        ];
    }

    /* ==================================================================
       Render
       ================================================================== */
    function render() {
        setText('statStaffTotal', staff.length);
        setText('tabDirectoryCount', staff.length);

        var open = requests.filter(function (r) { return r.status !== 'Resolved'; }).length;
        var reqCount = byId('tabRequestsCount');
        if (reqCount) {
            reqCount.textContent = open;
            reqCount.classList.toggle('count-alert', open > 0);
        }

        renderDirectory();
        renderRoleCoverage();
        renderRequests();
    }

    function renderDirectory() {
        var host = byId('staffCardGrid');
        if (!host) return;

        var rows = staff.filter(function (s) {
            if (roleFilter && s.role !== roleFilter) return false;
            if (!searchTerm) return true;
            var q = searchTerm.toLowerCase();
            return [s.name, s.username, s.email, s.department, roleMeta(s.role).label].some(function (f) {
                return String(f || '').toLowerCase().indexOf(q) !== -1;
            });
        });

        rows.sort(function (a, b) {
            /* Administrators first, then alphabetical within a role. */
            var d = (a.role === 'Admin' ? 0 : 1) - (b.role === 'Admin' ? 0 : 1);
            if (d !== 0) return d;
            return String(a.name).localeCompare(String(b.name));
        });

        if (!rows.length) {
            host.innerHTML = ui.emptyState({
                icon: 'search',
                title: 'No staff match these filters',
                text: 'Clear the search or role filter to see the full directory.'
            });
            return;
        }

        host.innerHTML = rows.map(function (s) {
            var meta = roleMeta(s.role);
            return '<article class="staff-card role-' + esc(String(s.role).toLowerCase()) + '">' +
                '<header class="stc-head">' +
                    '<span class="stc-avatar">' + esc(store.initials(s.name)) + '</span>' +
                    '<div class="stc-identity">' +
                        '<span class="stc-name">' + esc(s.name) + '</span>' +
                        '<span class="stc-username mono">@' + esc(s.username) + '</span>' +
                    '</div>' +
                    '<span class="stc-role">' + icon(meta.icon, 13) + '<span>' + esc(meta.label) + '</span></span>' +
                '</header>' +

                '<dl class="stc-details">' +
                    row('Department', s.department || '—') +
                    row('Shift', s.shift || '—') +
                    row('Email', s.email || '—') +
                    row('Phone', s.phone || '—') +
                '</dl>' +

                '<footer class="stc-foot">' +
                    '<span class="stc-joined">Joined ' + esc(store.formatDate(s.joined)) + '</span>' +
                    '<div class="stc-actions">' +
                        '<button type="button" class="btn-icon" data-edit="' + esc(s.id) + '" title="Edit member" aria-label="Edit member">' +
                            icon('edit', 15) +
                        '</button>' +
                        (s.role === 'Admin'
                            ? '<span class="stc-locked">' + icon('lock', 13) + '<span>Protected</span></span>'
                            : '<button type="button" class="btn-icon" data-remove="' + esc(s.id) + '" title="Remove member" aria-label="Remove member">' +
                                icon('trash', 15) +
                              '</button>') +
                    '</div>' +
                '</footer>' +
            '</article>';
        }).join('');

        ui.qsa('[data-edit]', host).forEach(function (b) {
            b.addEventListener('click', function () { openForm(b.getAttribute('data-edit')); });
        });
        ui.qsa('[data-remove]', host).forEach(function (b) {
            b.addEventListener('click', function () { removeMember(b.getAttribute('data-remove')); });
        });
    }

    function row(label, value) {
        return '<div class="stc-row"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
    }

    /* Coverage highlights departments that have nobody assigned. */
    function renderRoleCoverage() {
        var host = byId('roleCoverageGrid');
        if (!host) return;

        host.innerHTML = Object.keys(ROLES).map(function (key) {
            var meta = ROLES[key];
            var members = staff.filter(function (s) { return s.role === key; });
            var shifts = {};
            members.forEach(function (m) { shifts[m.shift || 'Unspecified'] = (shifts[m.shift || 'Unspecified'] || 0) + 1; });

            return '<article class="role-card' + (members.length ? '' : ' is-uncovered') + '">' +
                '<header class="rlc-head">' +
                    '<span class="rlc-icon">' + icon(meta.icon, 16) + '</span>' +
                    '<div>' +
                        '<span class="rlc-name">' + esc(meta.label) + '</span>' +
                        '<span class="rlc-count">' + members.length +
                            (members.length === 1 ? ' member' : ' members') + '</span>' +
                    '</div>' +
                '</header>' +
                '<p class="rlc-duties">' + esc(meta.duties) + '</p>' +
                (members.length
                    ? '<div class="rlc-shifts">' + Object.keys(shifts).map(function (s) {
                        return '<span class="tag">' + esc(s) + ' · ' + shifts[s] + '</span>';
                      }).join('') + '</div>'
                    : '<div class="rlc-warn">' + icon('warning', 13) +
                      '<span>No one is assigned to this role.</span></div>') +
            '</article>';
        }).join('');
    }

    function renderRequests() {
        var host = byId('requestsList');
        if (!host) return;

        if (!requests.length) {
            host.innerHTML = ui.emptyState({
                icon: 'lock',
                title: 'No access requests',
                text: 'Requests raised from the sign-in screen appear here for an administrator to action.'
            });
            return;
        }

        var sorted = requests.slice().sort(function (a, b) {
            var d = (a.status === 'Resolved' ? 1 : 0) - (b.status === 'Resolved' ? 1 : 0);
            if (d !== 0) return d;
            return new Date(b.time) - new Date(a.time);
        });

        host.innerHTML = sorted.map(function (r) {
            var resolved = r.status === 'Resolved';
            return '<article class="request' + (resolved ? ' is-resolved' : '') + '">' +
                '<div class="req-body">' +
                    '<span class="req-name">' + esc(r.name || 'Unknown user') + '</span>' +
                    '<span class="req-text">' + esc(r.message || 'Access assistance requested.') + '</span>' +
                    '<span class="req-time">' + esc(store.formatDateTime(r.time)) + '</span>' +
                '</div>' +
                '<div class="req-actions">' +
                    (resolved
                        ? '<span class="badge status-finished">' + icon('check', 12) + '<span>Resolved</span></span>'
                        : '<button type="button" class="btn-secondary btn-sm" data-resolve="' + esc(r.id) + '">' +
                            icon('check', 14) + '<span>Mark resolved</span>' +
                          '</button>') +
                    '<button type="button" class="btn-icon" data-dismiss="' + esc(r.id) + '" title="Dismiss request" aria-label="Dismiss request">' +
                        icon('trash', 15) +
                    '</button>' +
                '</div>' +
            '</article>';
        }).join('');

        ui.qsa('[data-resolve]', host).forEach(function (b) {
            b.addEventListener('click', function () {
                var id = b.getAttribute('data-resolve');
                requests.forEach(function (r) {
                    if (String(r.id) === String(id)) {
                        r.status = 'Resolved';
                        r.resolvedAt = new Date().toISOString();
                    }
                });
                store.write(REQUESTS_KEY, requests);
                render();
            });
        });

        ui.qsa('[data-dismiss]', host).forEach(function (b) {
            b.addEventListener('click', function () {
                var id = b.getAttribute('data-dismiss');
                requests = requests.filter(function (r) { return String(r.id) !== String(id); });
                store.write(REQUESTS_KEY, requests);
                render();
            });
        });
    }

    /* ==================================================================
       Add / edit
       ================================================================== */
    function openForm(id) {
        editingId = id === undefined || id === null ? null : id;
        var member = null;
        if (editingId !== null) {
            staff.forEach(function (s) { if (String(s.id) === String(editingId)) member = s; });
            if (!member) return;
        }

        setText('memberModalTitle', member ? 'Edit staff member' : 'Add staff member');
        setText('memberModalSub', member ? '@' + member.username : 'Personnel record');
        setText('saveMemberLabel', member ? 'Save changes' : 'Add member');

        ['inputStaffName', 'inputStaffUsername', 'inputStaffEmail', 'inputStaffPhone',
         'inputStaffDept', 'inputStaffPassword'].forEach(function (f) {
            var el = byId(f);
            if (el) el.value = '';
            ui.clearFieldError(f);
        });

        /* On the server the password IS the sign-in credential: required for
           a new account, optional (reset) when editing. */
        var pwLabel = byId('labelStaffPassword');
        var pwInput = byId('inputStaffPassword');
        if (pwLabel && pwInput) {
            if (member) {
                pwLabel.innerHTML = 'Reset password';
                pwInput.placeholder = 'Leave blank to keep the current password';
            } else {
                pwLabel.innerHTML = 'Sign-in password <span class="req">*</span>';
                pwInput.placeholder = 'At least 6 characters';
            }
        }

        if (member) {
            byId('inputStaffName').value = member.name || '';
            byId('inputStaffUsername').value = member.username || '';
            byId('inputStaffEmail').value = member.email || '';
            byId('inputStaffPhone').value = member.phone || '';
            byId('inputStaffDept').value = member.department || '';
            ui.setSelectValue('inputRoleWrapper', member.role, roleMeta(member.role).label);
            ui.setSelectValue('inputShiftWrapper', member.shift || 'Day', member.shift || 'Day');
        } else {
            ui.setSelectValue('inputRoleWrapper', 'Doctor', 'Clinician');
            ui.setSelectValue('inputShiftWrapper', 'Day', 'Day');
        }

        ui.openModal('memberModal');
    }

    function saveMember() {
        var creating = editingId === null;

        var specs = [
            { id: 'inputStaffName', message: 'Enter the member\u2019s full name.' },
            {
                id: 'inputStaffUsername',
                message: 'Usernames must be at least 3 characters, letters, numbers, dot or hyphen only.',
                test: function (v) { return /^[a-zA-Z0-9.\-_]{3,}$/.test(v); }
            },
            {
                id: 'inputStaffEmail',
                message: 'Enter a valid email address.',
                test: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
            }
        ];
        /* A brand-new account cannot sign in without a password. */
        if (creating || !store.SERVER_MODE) {
            specs.push({
                id: 'inputStaffPassword',
                message: 'Password must be at least 6 characters.',
                test: function (v) { return v.length >= 6; }
            });
        }
        if (!ui.requireFields(specs)) return;

        var username = byId('inputStaffUsername').value.trim();
        var clash = staff.some(function (s) {
            return s.username === username && String(s.id) !== String(editingId);
        });
        if (clash) {
            ui.fieldError('inputStaffUsername', 'That username is already in the directory.');
            return;
        }

        var payload = {
            name: byId('inputStaffName').value.trim(),
            username: username,
            email: byId('inputStaffEmail').value.trim(),
            phone: byId('inputStaffPhone').value.trim(),
            role: ui.getSelectValue('inputRoleWrapper') || 'Doctor',
            department: byId('inputStaffDept').value.trim(),
            shift: ui.getSelectValue('inputShiftWrapper') || 'Day'
        };

        /* The plaintext password travels once to the server, which hashes it
           immediately; the stored directory never contains it. */
        var pwField = byId('inputStaffPassword');
        var password = pwField ? pwField.value : '';
        if (password) payload.password = password;

        var existing = null;
        staff.forEach(function (s) { if (String(s.id) === String(editingId)) existing = s; });

        if (existing) {
            Object.keys(payload).forEach(function (k) {
                if (k !== 'password') existing[k] = payload[k];
            });
        } else {
            var maxId = 0;
            staff.forEach(function (s) {
                var n = store.toNumber(s.id);
                if (n !== null && n > maxId) maxId = n;
            });
            payload.id = maxId + 1;
            payload.joined = new Date().toISOString();
            staff.push(payload);
        }

        /* One transient trip to the server, then gone from browser memory:
           the password must travel on this save (a brand-new account cannot
           be created without one) but never remain in the local snapshot. */
        save();
        staff.forEach(function (s) { delete s.password; });
        ui.closeModal('memberModal');
        load();   /* re-read from the store so account sync results show */

        window.MediTrackNotify.flash(
            existing ? 'Member updated' : 'Member added',
            payload.name + ' · ' + roleMeta(payload.role).label
        );
    }

    function removeMember(id) {
        var member = null;
        staff.forEach(function (s) { if (String(s.id) === String(id)) member = s; });
        if (!member) return;

        ui.confirmAction({
            title: 'Remove staff member',
            subtitle: member.name + ' · ' + roleMeta(member.role).label,
            message: 'This removes the personnel record from the directory. Work already recorded against this member is retained on the patient records.',
            confirmLabel: 'Remove member',
            tone: 'danger',
            icon: 'trash'
        }, function () {
            staff = staff.filter(function (s) { return String(s.id) !== String(id); });
            save();
            render();
            window.MediTrackNotify.push(
                'Staff Member Removed',
                member.name + ' was removed from the directory.',
                'warning', 'Staff', 'normal'
            );
        });
    }

    /* ==================================================================
       Init
       ================================================================== */
    function init() {
        load();

        ui.initTabs({
            buttonSelector: '[data-stafftab]',
            panelSelector: '.tab-panel',
            attribute: 'data-stafftab'
        });

        ui.initSelect('filterRoleWrapper', function (v) { roleFilter = v; renderDirectory(); });
        ui.initSelect('inputRoleWrapper');
        ui.initSelect('inputShiftWrapper');
        ui.bindLiveValidation(['inputStaffName', 'inputStaffUsername', 'inputStaffEmail']);

        var add = byId('btnAddMember');
        if (add) add.addEventListener('click', function () { openForm(null); });

        var saveBtn = byId('saveMemberBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveMember);

        var search = byId('staffSearch');
        var clear = byId('staffSearchClear');
        if (search) {
            search.addEventListener('input', function () {
                searchTerm = search.value.trim();
                if (clear) clear.classList.toggle('visible', !!searchTerm);
                renderDirectory();
            });
        }
        if (clear) {
            clear.addEventListener('click', function () {
                if (search) search.value = '';
                searchTerm = '';
                clear.classList.remove('visible');
                renderDirectory();
            });
        }

        var reset = byId('resetStaffFiltersBtn');
        if (reset) {
            reset.addEventListener('click', function () {
                searchTerm = '';
                roleFilter = '';
                if (search) search.value = '';
                if (clear) clear.classList.remove('visible');
                ui.setSelectValue('filterRoleWrapper', '', 'All roles');
                renderDirectory();
            });
        }

        window.addEventListener('storage', function (e) {
            if (!e.key || e.key === STAFF_KEY || e.key === REQUESTS_KEY) load();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
