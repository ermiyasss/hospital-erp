/* ==========================================================================
   MediTrack Hospital ERP - Sign in

   Authentication happens on the hospital server (server.js): usernames,
   emails and phone numbers plus scrypt-hashed passwords live in the server
   database. A successful sign-in returns an API token AND the account's real
   role — the role is decided by the server, never by this form, so there is
   no role picker to get wrong.

   Accounts are created WITHOUT a password. On the first sign-in the server
   accepts whatever was typed and flags needsPassword; the member is then
   walked into choosing their own password and cannot reach the dashboard
   until one exists. An administrator asking for a change (mustReset) lands
   in the same place, with different wording.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var ON_SERVER = window.location.protocol === 'http:' || window.location.protocol === 'https:';

    var session = window.MediSession;
    var signingIn = false;
    var pendingToken = null;
    var pendingUser = null;

    function byId(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function icon(name, size) {
        return window.MediIcons ? window.MediIcons.svg(name, size || 16) : '';
    }

    /* A stable per-browser device id, used for the optional HWID lock that
       restricts a staff account to the machine it first signed in from. */
    function getDeviceId() {
        try {
            var id = window.localStorage.getItem('meditrack_device_id');
            if (id) return id;
            id = 'dev_' + crypto.randomUUID
                ? 'dev_' + crypto.randomUUID()
                : 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            window.localStorage.setItem('meditrack_device_id', id);
            return id;
        } catch (e) {
            return 'dev_' + Date.now();
        }
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

    function hideNotice() {
        var box = byId('loginNotice');
        if (box) box.hidden = true;
    }

    /* ==================================================================
       Sign in
       ================================================================== */
    function submit(e) {
        e.preventDefault();
        if (signingIn) return;

        var idField = byId('employeeId');
        var pwField = byId('password');
        var id = idField ? idField.value.trim() : '';
        var pw = pwField ? pwField.value : '';

        var ok = true;
        if (!id) { ok = showError('employeeId', 'Enter your username, email or phone.'); }
        else clearError('employeeId');

        if (!pw) ok = showError('password', 'Enter your password.');
        else clearError('password');

        if (!ok) { if (idField) idField.focus(); return; }

        var btn = byId('loginSubmitBtn');
        var label = byId('loginSubmitLabel');
        if (btn) btn.disabled = true;
        if (label) label.textContent = 'Signing in…';
        signingIn = true;
        hideNotice();

        fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: id,
                password: pw,
                hwid: ON_SERVER ? getDeviceId() : ''
            })
        })
            .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
            .then(function (out) {
                if (out.status !== 200) {
                    failSignIn((out.j && out.j.error) || 'Sign-in failed.');
                    return;
                }
                pendingToken = out.j.token;
                pendingUser = out.j.user || {};
                try { window.localStorage.setItem('erp_token', pendingToken); } catch (err) {}

                /* No password has ever been set on this account: stop here and
                   make them choose one. The password they typed to get this
                   far is discarded — it was never real. */
                if (out.j.needsPassword) {
                    showReset('This account has no password yet. Pick one you will remember — at least 6 characters — and it will be the only one that opens your account.',
                        'Choose your password');
                    return;
                }
                /* An administrator asked for a change; their old password
                   still works until it is replaced here. */
                if (out.j.mustReset) {
                    showReset('Your administrator asked you to change your password. Choose a new one — at least 6 characters.',
                        'Set a new password');
                    return;
                }
                finishSignIn();
            })
            .catch(function () {
                failSignIn('Unable to reach the server. Check the connection and try again.');
            });
    }

    function finishSignIn() {
        session.signIn({
            role: pendingUser.role,
            user: pendingUser.username,
            name: pendingUser.name
        });
        setTimeout(function () { window.location.href = 'dashboard.html'; }, 200);
    }

    function failSignIn(message) {
        signingIn = false;
        var btn = byId('loginSubmitBtn');
        var label = byId('loginSubmitLabel');
        if (btn) btn.disabled = false;
        if (label) label.textContent = 'Sign in';

        if (/suspend|locked/i.test(message)) notice(message);
        else if (/network|reach/i.test(message)) notice(message);
        else showError('password', message);
    }

    /* ==================================================================
       Forced password set

       Deliberately inescapable: no close button, no backdrop dismiss, and
       Escape is ignored. Once it is open the only way forward is a real
       password, because an account with no usable password is a hole in
       the hospital's audit trail.
       ================================================================== */
    function showReset(message, title) {
        var modal = byId('resetModal');
        if (!modal) { finishSignIn(); return; }
        clearError('resetPassword');
        clearError('resetPassword2');
        var text = byId('resetModalText');
        var heading = byId('resetModalTitle');
        if (text && message) text.textContent = message;
        if (heading && title) heading.textContent = title;
        var p1 = byId('resetPassword');
        var p2 = byId('resetPassword2');
        if (p1) p1.value = '';
        if (p2) p2.value = '';
        modal.hidden = false;
        document.body.classList.add('modal-open');
        /* Stop the sign-in form underneath from being submitted again. */
        var submitBtn = byId('loginSubmitBtn');
        if (submitBtn) submitBtn.disabled = true;
        if (p1) { try { p1.focus(); } catch (e) {} }
    }

    function closeReset() {
        var modal = byId('resetModal');
        if (modal) modal.hidden = true;
        document.body.classList.remove('modal-open');
    }

    function submitReset() {
        var p1 = byId('resetPassword');
        var p2 = byId('resetPassword2');
        var v1 = p1 ? p1.value : '';
        var v2 = p2 ? p2.value : '';
        var ok = true;
        if (v1.length < 6) { ok = showError('resetPassword', 'Use at least 6 characters.'); }
        else clearError('resetPassword');
        if (v1 !== v2) { ok = showError('resetPassword2', 'The passwords do not match.'); }
        else clearError('resetPassword2');
        if (!ok) return;

        var btn = byId('submitResetBtn');
        var label = byId('submitResetLabel');
        if (btn) btn.disabled = true;
        if (label) label.textContent = 'Saving…';

        fetch('/api/auth/force-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (pendingToken || '') },
            body: JSON.stringify({ next: v1 })
        })
            .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
            .then(function (out) {
                if (out.status !== 200) {
                    if (btn) btn.disabled = false;
                    if (label) label.textContent = 'Set password & continue';
                    showError('resetPassword', (out.j && out.j.error) || 'Could not set the password. Try again.');
                    return;
                }
                closeReset();
                finishSignIn();
            })
            .catch(function () {
                if (btn) btn.disabled = false;
                if (label) label.textContent = 'Set password & continue';
                showError('resetPassword', 'Could not reach the server. Try again.');
            });
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

        if (ON_SERVER) {
            fetch('/api/access-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, message: detail || 'Asked for help signing in.' })
            })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    if (j && j.ok) {
                        closeAccessModal();
                        notice('Request saved for ' + name + '. An administrator will see it under Staff.');
                        if (detailField) detailField.value = '';
                    } else {
                        showError('reqName', (j && j.error) || 'The server could not save the request.');
                    }
                })
                .catch(function () {
                    notice('Unable to reach the server. Please try again in a moment.');
                });
            return;
        }
        closeAccessModal();
        notice('Request saved for ' + name + '. An administrator will see it under Staff.');
        if (detailField) detailField.value = '';
    }

    /* ==================================================================
       Init
       ================================================================== */
    function init() {
        var form = byId('loginForm');
        if (form) form.addEventListener('submit', submit);

        ['employeeId', 'password'].forEach(function (id) {
            var el = byId(id);
            if (el) el.addEventListener('input', function () { clearError(id); });
        });

        /* Pre-fill the last user when they asked to be remembered. */
        try {
            var last = window.localStorage.getItem('meditrack_last_user');
            var idField = byId('employeeId');
            var remember = byId('rememberMe');
            if (last && idField) {
                idField.value = last;
                if (remember) remember.checked = true;
            }
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
                if (window.MediIcons) toggle.innerHTML = window.MediIcons.svg(show ? 'eye-off' : 'eye', 15);
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

        var accessModal = byId('accessModal');
        if (accessModal) {
            accessModal.addEventListener('click', function (e) { if (e.target === accessModal) closeAccessModal(); });
        }

        var submitResetBtn = byId('submitResetBtn');
        if (submitResetBtn) submitResetBtn.addEventListener('click', submitReset);

        /* Enter submits the forced password form, which is the only thing on
           screen while it is open. */
        ['resetPassword', 'resetPassword2'].forEach(function (id) {
            var el = byId(id);
            if (!el) return;
            el.addEventListener('input', function () { clearError(id); });
            el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); submitReset(); }
            });
        });

        document.addEventListener('keydown', function (e) {
            /* Escape closes the help request only. The password window is
               not dismissible. */
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
