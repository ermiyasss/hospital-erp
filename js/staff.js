/**
 * MediTrack Hospital ERP - Staff & User Management Logic
 * Manages role-based staff directory, admin password changes,
 * new member registration, and password reset request inbox.
 */

(function() {
    'use strict';

    var STAFF_KEY = 'clinic_staff_members';
    var ADMIN_PW_KEY = 'clinic_admin_password';
    var RESET_REQUESTS_KEY = 'clinic_admin_requests';

    var staffMembers = [];
    var resetRequests = [];
    var searchTerm = '';
    var roleFilter = '';

    function loadStaff() {
        try {
            var raw = localStorage.getItem(STAFF_KEY);
            staffMembers = raw ? JSON.parse(raw) : [];
        } catch (e) { staffMembers = []; }

        if (staffMembers.length === 0) {
            staffMembers = [
                { id: 1, name: 'Dr. Sarah Chen', username: 'admin', email: 'admin@meditrack.hospital', phone: '0911 000 001', role: 'Admin', department: 'Hospital Administration', password: 'admin123', joined: new Date(Date.now() - 365*24*60*60*1000).toISOString() },
                { id: 2, name: 'Dr. Abebe Kebede', username: 'abebe.k', email: 'abebe@meditrack.hospital', phone: '0912 345 678', role: 'Doctor', department: 'Internal Medicine', password: 'doctor123', joined: new Date(Date.now() - 180*24*60*60*1000).toISOString() },
                { id: 3, name: 'Sr. Fatima Ali', username: 'fatima.a', email: 'fatima@meditrack.hospital', phone: '0913 456 789', role: 'Nurse', department: 'Emergency Ward', password: 'nurse123', joined: new Date(Date.now() - 120*24*60*60*1000).toISOString() },
                { id: 4, name: 'Tech. Solomon Tadesse', username: 'solomon.t', email: 'solomon@meditrack.hospital', phone: '0914 567 890', role: 'Laboratory', department: 'Diagnostic Pathology', password: 'lab123', joined: new Date(Date.now() - 90*24*60*60*1000).toISOString() },
                { id: 5, name: 'Pharm. Hana Getachew', username: 'hana.g', email: 'hana@meditrack.hospital', phone: '0915 678 901', role: 'Pharmacy', department: 'Hospital Pharmacy', password: 'pharm123', joined: new Date(Date.now() - 60*24*60*60*1000).toISOString() },
                { id: 6, name: 'Meron Yilma', username: 'meron.y', email: 'meron@meditrack.hospital', phone: '0916 789 012', role: 'Registry', department: 'Patient Registration', password: 'registry123', joined: new Date(Date.now() - 30*24*60*60*1000).toISOString() }
            ];
            saveStaff();
        }

        loadResetRequests();
        updateCounts();
        renderDirectory();
        renderResetRequests();
    }

    function saveStaff() {
        localStorage.setItem(STAFF_KEY, JSON.stringify(staffMembers));
    }

    function loadResetRequests() {
        try {
            var raw = localStorage.getItem(RESET_REQUESTS_KEY);
            resetRequests = raw ? JSON.parse(raw) : [];
        } catch (e) { resetRequests = []; }
    }

    function saveResetRequests() {
        localStorage.setItem(RESET_REQUESTS_KEY, JSON.stringify(resetRequests));
    }

    function updateCounts() {
        var dirEl = document.getElementById('tabDirectoryCount');
        var reqEl = document.getElementById('tabRequestsCount');
        if (dirEl) dirEl.textContent = staffMembers.length;
        if (reqEl) reqEl.textContent = resetRequests.filter(function(r) { return r.status !== 'Resolved'; }).length;
    }

    function formatDate(iso) {
        if (!iso) return '-';
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function getRoleBadgeClass(role) {
        var map = { Admin: 'role-admin', Doctor: 'role-doctor-badge', Nurse: 'role-nurse-badge', Laboratory: 'role-lab-badge', Pharmacy: 'role-pharmacy-badge', Registry: 'role-registry-badge' };
        return map[role] || 'role-registry-badge';
    }

    function getAvatarClass(role) {
        var map = { Admin: '', Doctor: 'role-doctor', Nurse: 'role-nurse', Laboratory: 'role-lab', Pharmacy: 'role-pharmacy', Registry: 'role-registry' };
        return map[role] || '';
    }

    function renderDirectory() {
        var grid = document.getElementById('staffCardGrid');
        var noData = document.getElementById('noStaffData');
        if (!grid) return;

        var filtered = staffMembers.filter(function(s) {
            var matchesRole = !roleFilter || s.role === roleFilter;
            var matchesSearch = true;
            if (searchTerm) {
                var q = searchTerm.toLowerCase();
                matchesSearch = (s.name && s.name.toLowerCase().includes(q)) ||
                                (s.username && s.username.toLowerCase().includes(q)) ||
                                (s.email && s.email.toLowerCase().includes(q)) ||
                                (s.role && s.role.toLowerCase().includes(q));
            }
            return matchesRole && matchesSearch;
        });

        if (filtered.length === 0) {
            grid.innerHTML = '';
            if (noData) noData.style.display = 'block';
            return;
        }
        if (noData) noData.style.display = 'none';

        grid.innerHTML = filtered.map(function(s) {
            var initials = s.name ? s.name.split(' ').map(function(n) { return n[0]; }).join('').substring(0, 2).toUpperCase() : 'ST';

            return '<div class="staff-card">' +
                '<div class="scard-top">' +
                    '<div class="scard-avatar ' + getAvatarClass(s.role) + '">' + initials + '</div>' +
                    '<div class="scard-info">' +
                        '<h4 class="scard-name">' + s.name + '</h4>' +
                        '<span class="scard-username">@' + s.username + '</span>' +
                    '</div>' +
                    '<span class="role-badge ' + getRoleBadgeClass(s.role) + '">' + s.role + '</span>' +
                '</div>' +

                '<div class="scard-details">' +
                    '<div class="scard-detail">' +
                        '<span class="scard-dlabel">Email</span>' +
                        '<span class="scard-dval">' + s.email + '</span>' +
                    '</div>' +
                    '<div class="scard-detail">' +
                        '<span class="scard-dlabel">Phone</span>' +
                        '<span class="scard-dval">' + (s.phone || '-') + '</span>' +
                    '</div>' +
                    '<div class="scard-detail">' +
                        '<span class="scard-dlabel">Department</span>' +
                        '<span class="scard-dval">' + (s.department || '-') + '</span>' +
                    '</div>' +
                    '<div class="scard-detail">' +
                        '<span class="scard-dlabel">Status</span>' +
                        '<span class="scard-dval" style="color:#10B981;">Active</span>' +
                    '</div>' +
                '</div>' +

                '<div class="scard-footer">' +
                    '<span class="scard-joined">Joined: ' + formatDate(s.joined) + '</span>' +
                    (s.role !== 'Admin' ?
                        '<button type="button" class="btn-staff-action btn-staff-remove" data-id="' + s.id + '">Remove</button>'
                        : '<span style="font-size:11px;color:var(--gray-muted);">Primary Admin</span>'
                    ) +
                '</div>' +
            '</div>';
        }).join('');

        grid.querySelectorAll('.btn-staff-remove').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = parseInt(this.getAttribute('data-id'), 10);
                if (confirm('Remove this staff member from the system?')) {
                    staffMembers = staffMembers.filter(function(s) { return s.id !== id; });
                    saveStaff();
                    updateCounts();
                    renderDirectory();
                    if (window.MediTrackNotify) {
                        window.MediTrackNotify.push('Staff Removed', 'Staff member has been removed from the hospital directory.', 'warning', 'Settings');
                    }
                }
            });
        });
    }

    function renderResetRequests() {
        var container = document.getElementById('requestsList');
        var noData = document.getElementById('noRequestsData');
        if (!container) return;

        if (resetRequests.length === 0) {
            container.innerHTML = '';
            if (noData) noData.style.display = 'block';
            return;
        }
        if (noData) noData.style.display = 'none';

        container.innerHTML = resetRequests.map(function(req) {
            var isResolved = req.status === 'Resolved';
            return '<div class="request-card' + (isResolved ? ' resolved' : '') + '">' +
                '<div class="req-info">' +
                    '<strong class="req-name">' + (req.name || 'Unknown User') + '</strong>' +
                    '<span class="req-detail">' + (req.message || 'Password reset requested via login page') + '</span>' +
                    '<span class="req-time">' + formatDate(req.time) + '</span>' +
                '</div>' +
                '<div class="req-actions">' +
                    (!isResolved ?
                        '<button type="button" class="btn-resolve" data-id="' + req.id + '">Mark Resolved</button>' +
                        '<button type="button" class="btn-dismiss-req" data-id="' + req.id + '">Dismiss</button>'
                        : '<span style="font-size:12px;color:#10B981;font-weight:600;">✓ Resolved</span>'
                    ) +
                '</div>' +
            '</div>';
        }).join('');

        container.querySelectorAll('.btn-resolve').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = parseInt(this.getAttribute('data-id'), 10);
                var req = resetRequests.find(function(r) { return r.id === id; });
                if (req) { req.status = 'Resolved'; saveResetRequests(); updateCounts(); renderResetRequests(); }
            });
        });

        container.querySelectorAll('.btn-dismiss-req').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = parseInt(this.getAttribute('data-id'), 10);
                resetRequests = resetRequests.filter(function(r) { return r.id !== id; });
                saveResetRequests();
                updateCounts();
                renderResetRequests();
            });
        });
    }

    function changePassword() {
        var currentPw = document.getElementById('inputCurrentPw').value.trim();
        var newPw = document.getElementById('inputNewPw').value.trim();
        var confirmPw = document.getElementById('inputConfirmPw').value.trim();

        var storedPw = localStorage.getItem(ADMIN_PW_KEY) || 'admin123';
        var admin = staffMembers.find(function(s) { return s.role === 'Admin'; });

        if (currentPw !== storedPw && (!admin || currentPw !== admin.password)) {
            alert('Current password is incorrect.');
            return;
        }
        if (newPw.length < 6) {
            alert('New password must be at least 6 characters.');
            return;
        }
        if (newPw !== confirmPw) {
            alert('New password and confirmation do not match.');
            return;
        }

        localStorage.setItem(ADMIN_PW_KEY, newPw);
        if (admin) { admin.password = newPw; saveStaff(); }

        document.getElementById('inputCurrentPw').value = '';
        document.getElementById('inputNewPw').value = '';
        document.getElementById('inputConfirmPw').value = '';

        if (window.MediTrackNotify) {
            window.MediTrackNotify.push('Password Updated', 'Administrator password has been changed successfully.', 'success', 'Settings');
        }
        alert('Password updated successfully.');
    }

    function addNewMember() {
        var name = document.getElementById('inputStaffName').value.trim();
        var username = document.getElementById('inputStaffUsername').value.trim();
        var email = document.getElementById('inputStaffEmail').value.trim();
        var phone = document.getElementById('inputStaffPhone').value.trim();
        var roleToggle = document.querySelector('#inputRoleWrapper .cs-toggle');
        var role = roleToggle ? roleToggle.getAttribute('data-value') : 'Doctor';
        var dept = document.getElementById('inputStaffDept').value.trim();
        var password = document.getElementById('inputStaffPassword').value.trim();

        if (!name || !username || !email || !password) {
            alert('Please fill in all required fields (Name, Username, Email, Password).');
            return;
        }

        if (staffMembers.some(function(s) { return s.username === username; })) {
            alert('Username "' + username + '" is already taken. Choose a different one.');
            return;
        }

        var newId = staffMembers.length > 0 ? Math.max.apply(null, staffMembers.map(function(s) { return s.id; })) + 1 : 1;

        staffMembers.push({
            id: newId,
            name: name,
            username: username,
            email: email,
            phone: phone,
            role: role,
            department: dept,
            password: password,
            joined: new Date().toISOString()
        });

        saveStaff();
        updateCounts();
        renderDirectory();
        closeAddModal();

        if (window.MediTrackNotify) {
            window.MediTrackNotify.push('Staff Member Added', name + ' (' + role + ') registered in MediTrack ERP.', 'success', 'Settings');
        }
    }

    function openAddModal() {
        document.getElementById('addMemberModal').classList.add('active');
    }

    function closeAddModal() {
        document.getElementById('addMemberModal').classList.remove('active');
        ['inputStaffName', 'inputStaffUsername', 'inputStaffEmail', 'inputStaffPhone', 'inputStaffDept', 'inputStaffPassword'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
    }

    function initCustomSelect(wrapperId, callback) {
        var wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;
        var toggle = wrapper.querySelector('.cs-toggle');
        var menu = wrapper.querySelector('.cs-menu');
        if (!toggle || !menu) return;

        toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            document.querySelectorAll('.custom-select.active').forEach(function(el) { if (el !== wrapper) el.classList.remove('active'); });
            wrapper.classList.toggle('active');
        });

        menu.querySelectorAll('.cs-option').forEach(function(opt) {
            opt.addEventListener('click', function() {
                toggle.querySelector('.cs-text').textContent = this.textContent;
                toggle.setAttribute('data-value', this.getAttribute('data-value'));
                menu.querySelectorAll('.cs-option').forEach(function(o) { o.classList.remove('selected'); });
                this.classList.add('selected');
                wrapper.classList.remove('active');
                if (callback) callback(this.getAttribute('data-value'));
            });
        });
    }

    function init() {
        loadStaff();

        // Tabs
        document.querySelectorAll('.staff-tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.staff-tab-btn').forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                var tab = this.getAttribute('data-tab');
                document.querySelectorAll('.staff-tab-panel').forEach(function(p) { p.classList.remove('active'); });
                var panelMap = { directory: 'panelDirectory', security: 'panelSecurity', requests: 'panelRequests' };
                var panel = document.getElementById(panelMap[tab]);
                if (panel) panel.classList.add('active');
            });
        });

        // Filters
        initCustomSelect('filterRoleWrapper', function(val) { roleFilter = val; renderDirectory(); });
        initCustomSelect('inputRoleWrapper');

        document.addEventListener('click', function() {
            document.querySelectorAll('.custom-select.active').forEach(function(el) { el.classList.remove('active'); });
        });

        var searchInput = document.getElementById('staffSearch');
        if (searchInput) {
            searchInput.addEventListener('input', function() { searchTerm = this.value; renderDirectory(); });
        }

        // Add Member
        document.getElementById('btnAddMember').addEventListener('click', openAddModal);
        document.getElementById('closeAddModalBtn').addEventListener('click', closeAddModal);
        document.getElementById('cancelAddMemberBtn').addEventListener('click', closeAddModal);
        document.getElementById('saveNewMemberBtn').addEventListener('click', addNewMember);

        // Change Password
        document.getElementById('btnChangePw').addEventListener('click', changePassword);

        // Modal backdrop click
        document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
            overlay.addEventListener('click', function(e) { if (e.target === overlay) closeAddModal(); });
        });

        window.addEventListener('storage', function(e) {
            if (e.key === STAFF_KEY || e.key === RESET_REQUESTS_KEY) { loadStaff(); }
        });
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
