/* ==========================================================================
   MediTrack Hospital ERP - Sign in

   There is no login server in this build, so this screen is honest about that
   rather than pretending to verify anything. It checks the shape of what was
   typed, records the chosen role in the session, and hands off to the shell.

   The role picker is deliberately temporary. When a real login server exists,
   the role comes back from the server and this control is deleted — nothing
   else needs to change, because everything downstream asks js/session.js.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var REQUESTS_KEY = 'clinic_admin_requests';
    var LAST_ROLE_KEY = 'meditrack_last_role';

    var session = window.MediSession;
    var selectedRole = null;

    function byId(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function icon(name, size) {
        return window.MediIcons ? window.MediIcons.svg(name, size || 16) : '';
    }

    function showError(inputId, message) {
        var input = byId(inputId);
        var err = byId('err' + inputId.charAt(0).toUpperCase() + inputId.slice(1));
        if (input) {
            input.classList.add('has-error');
            input.setAttribute('aria-invalid', 'true');
        }
        if (err) {
            err.textContent = message;
            err.classList.add('visible');
        }
        return false;
    }

    function clearError(inputId) {
        var input = byId(inputId);
        var err = byId('err' + inputId.charAt(0).toUpperCase() + inputId.slice(1));
        if (input) {
            input.classList.remove('has-error');
            input.removeAttribute('aria-invalid');
        }
        if (err) err.classList.remove('visible');
    }

    function notice(text) {
        var box = byId('loginNotice');
        var el = byId('loginNoticeText');
        if (!box || !el) return;
        el.textContent = text;
        box.hidden = false;
    }

    /* ==================================================================
       Role picker
       ================================================================== */
    function renderRoles() {
        var host = byId('roleChoice');
        if (!host || !session) return;

        host.innerHTML = session.ROLE_ORDER.map(function (key) {
            var def = session.ROLES[key];
            return '<button type="button" class="role-option" role="radio" aria-checked="false" ' +
                        'data-role="' + esc(key) + '">' +
                    '<span class="ro-icon">' + icon(def.icon, 16) + '</span>' +
                    '<span class="ro-text">' +
                        '<strong>' + esc(def.label) + '</strong>' +
                        '<span>' + esc(def.summary) + '</span>' +
                    '</span>' +
                    '<span class="ro-mark" aria-hidden="true"></span>' +
                '</button>';
        }).join('');

        host.addEventListener('click', function (e) {
            var btn = e.target.closest ? e.target.closest('[data-role]') : null;
            if (!btn || !host.contains(btn)) return;
            chooseRole(btn.getAttribute('data-role'));
        });

        /* Arrow keys should move between options like a real radio group. */
        host.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' &&
                e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

            var options = Array.prototype.slice.call(host.querySelectorAll('[data-role]'));
            var index = options.indexOf(document.activeElement);
            if (index === -1) return;

            e.preventDefault();
            var step = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : -1;
            var next = options[(index + step + options.length) % options.length];
            next.focus();
            chooseRole(next.getAttribute('data-role'));
        });
    }

    function chooseRole(key) {
        if (!session) return;
        var role = session.normalizeRole(key);
        if (!role) return;

        selectedRole = role;
        clearError('roleChoice');

        var host = byId('roleChoice');
        if (host) {
            Array.prototype.slice.call(host.querySelectorAll('[data-role]')).forEach(function (btn) {
                var on = btn.getAttribute('data-role') === role;
                btn.classList.toggle('selected', on);
                btn.setAttribute('aria-checked', on ? 'true' : 'false');
            });
        }

        var hint = byId('roleChoiceHint');
        if (hint) {
            var def = session.ROLES[role];
            var pages = def.pages.map(function (p) {
                return session.PAGES[p] ? session.PAGES[p].title : p;
            });
            hint.textContent = 'You will see: ' + pages.join(', ') + '.';
        }
    }

    /* ==================================================================
       Sign in
       ================================================================== */
    function submit(e) {
        e.preventDefault();

        var idField = byId('employeeId');
        var pwField = byId('password');
        var id = idField ? idField.value.trim() : '';
        var pw = pwField ? pwField.value : '';

        var ok = true;
        if (!id) ok = showError('employeeId', 'Enter your staff ID or email.');
        else clearError('employeeId');

        if (pw.length < 6) {
            ok = showError('password', 'Your password must be at least 6 characters.');
        } else {
            clearError('password');
        }

        if (!selectedRole) {
            showError('roleChoice', 'Choose the role you are signing in as.');
            ok = false;
        }

        if (!ok) {
            if (!id && idField) idField.focus();
            else if (pw.length < 6 && pwField) pwField.focus();
            return;
        }

        var btn = byId('loginSubmitBtn');
        var label = byId('loginSubmitLabel');
        if (btn) btn.disabled = true;
        if (label) label.textContent = 'Signing in…';

        /* The session is the only thing that decides what this user can see. */
        session.signIn({ role: selectedRole, user: id, name: displayName(id) });

        var remember = byId('rememberMe');
        if (remember && remember.checked) {
            try {
                localStorage.setItem('meditrack_last_user', id);
                localStorage.setItem(LAST_ROLE_KEY, selectedRole);
            } catch (err) {}
        }

        setTimeout(function () { window.location.href = 'dashboard.html'; }, 260);
    }

    /* Prefer the real name from the staff directory when the typed ID matches
       a username or email; it makes the topbar and record attribution useful
       even without a login server. Returning null lets js/session.js fall back
       to the role's default name. */
    function displayName(id) {
        var needle = String(id).trim().toLowerCase();
        if (!needle) return null;
        try {
            var staff = JSON.parse(localStorage.getItem('clinic_staff_members') || '[]');
            if (Array.isArray(staff)) {
                for (var i = 0; i < staff.length; i++) {
                    var s = staff[i];
                    if (String(s.username || '').toLowerCase() === needle) return s.name;
                    if (String(s.email || '').toLowerCase() === needle) return s.name;
                }
            }
        } catch (e) {}
        return null;
    }

    /* ==================================================================
       Access request
       ================================================================== */
    function openAccessModal() {
        var modal = byId('accessModal');
        if (!modal) return;

        var nameField = byId('reqName');
        var idField = byId('employeeId');
        if (nameField) {
            nameField.value = idField ? idField.value.trim() : '';
            clearError('reqName');
        }

        modal.hidden = false;
        document.body.classList.add('modal-open');
        if (nameField) nameField.focus();
    }

    function closeAccessModal() {
        var modal = byId('accessModal');
        if (!modal) return;
        modal.hidden = true;
        document.body.classList.remove('modal-open');
    }

    function submitAccessRequest() {
        var nameField = byId('reqName');
        var detailField = byId('reqDetail');
        var name = nameField ? nameField.value.trim() : '';

        if (!name) {
            showError('reqName', 'Enter your name so the administrator knows who is asking.');
            if (nameField) nameField.focus();
            return;
        }
        clearError('reqName');

        var detail = detailField ? detailField.value.trim() : '';

        var list = [];
        try {
            var raw = localStorage.getItem(REQUESTS_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            if (Array.isArray(parsed)) list = parsed;
        } catch (e) {}

        list.unshift({
            id: Date.now(),
            name: name,
            message: detail || 'Asked for help signing in.',
            time: new Date().toISOString(),
            status: 'Pending'
        });

        try { localStorage.setItem(REQUESTS_KEY, JSON.stringify(list)); } catch (e) {}

        closeAccessModal();
        notice('Request saved for ' + name + '. An administrator will see it under Staff.');
        if (detailField) detailField.value = '';
    }

    /* ==================================================================
       Init
       ================================================================== */
    function init() {
        renderRoles();

        var form = byId('loginForm');
        if (form) form.addEventListener('submit', submit);

        ['employeeId', 'password'].forEach(function (id) {
            var el = byId(id);
            if (el) el.addEventListener('input', function () { clearError(id); });
        });

        /* Pre-fill the last user and role when they asked to be remembered. */
        try {
            var last = localStorage.getItem('meditrack_last_user');
            var idField = byId('employeeId');
            var remember = byId('rememberMe');
            if (last && idField) {
                idField.value = last;
                if (remember) remember.checked = true;
            }
            var lastRole = localStorage.getItem(LAST_ROLE_KEY);
            if (lastRole) chooseRole(lastRole);
        } catch (e) {}

        var toggle = byId('togglePassword');
        if (toggle) {
            toggle.addEventListener('click', function () {
                var pw = byId('password');
                if (!pw) return;
                var show = pw.type === 'password';
                pw.type = show ? 'text' : 'password';
                toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
                toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
                if (window.MediIcons) {
                    toggle.innerHTML = window.MediIcons.svg(show ? 'eye-off' : 'eye', 15);
                }
            });
        }

        var request = byId('requestAccessBtn');
        if (request) request.addEventListener('click', openAccessModal);

        ['closeAccessModal', 'cancelAccessModal'].forEach(function (id) {
            var el = byId(id);
            if (el) el.addEventListener('click', closeAccessModal);
        });

        var submitReq = byId('submitAccessRequest');
        if (submitReq) submitReq.addEventListener('click', submitAccessRequest);

        var modal = byId('accessModal');
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) closeAccessModal();
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeAccessModal();
        });

        var reqName = byId('reqName');
        if (reqName) reqName.addEventListener('input', function () { clearError('reqName'); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
