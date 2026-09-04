/* ==========================================================================
   MediTrack Hospital ERP - My Profile

   Each signed-in account maintains its own profile: photo, name, age, sex,
   phone and address, plus the sign-in password. The server refuses writes
   to anybody else's record, and the display name is pushed into the login
   account so messages and the staff directory stay in step.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var session = window.MediSession;

    var pendingPhoto = undefined;   /* undefined = untouched, null = removed */

    function esc(s) { return store.escapeHtml(s); }
    function byId(id) { return document.getElementById(id); }

    function me() {
        try { return session.read() || {}; }
        catch (e) { return {}; }
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

    function myProfile() {
        var username = String(me().user || '').toLowerCase();
        var found = null;
        store.read(store.KEYS.profiles).forEach(function (p) {
            if (String(p.username).toLowerCase() === username) found = p;
        });
        return found || {};
    }

    function myStaffRecord() {
        var username = String(me().user || '').toLowerCase();
        var found = null;
        store.read('clinic_staff_members').forEach(function (s) {
            if (String(s.username).toLowerCase() === username) found = s;
        });
        return found || {};
    }

    /* ==================================================================
        Render
        ================================================================== */
    function renderPhoto() {
        var host = byId('profilePhoto');
        if (!host) return;
        var photo = pendingPhoto === undefined ? (myProfile().photo || null) : pendingPhoto;
        if (photo) {
            host.innerHTML = '<img src="' + esc(photo) + '" alt="Profile photo" />';
        } else {
            host.textContent = store.initials(byId('profileName').value || me().name || '—');
        }
    }

    function render() {
        var profile = myProfile();
        var staff = myStaffRecord();
        var s = me();

        byId('heroName').textContent = profile.name || s.name || '—';
        byId('heroUsername').textContent = '@' + (s.user || '—');

        var roleBadge = byId('heroRoleBadge');
        if (roleBadge) {
            var def = session.roleDefinition();
            roleBadge.textContent = def.label || s.role || '—';
        }

        var joined = byId('heroJoined');
        if (joined) {
            joined.textContent = staff.joined ? 'Joined ' + store.formatDate(staff.joined) : 'Joined —';
        }

        var nameEl = byId('profileName');
        if (nameEl && document.activeElement !== nameEl) nameEl.value = profile.name || s.name || '';
        byId('profileAge').value = profile.age || '';
        ui.setSelectValue('profileSexWrapper', profile.sex || '', profile.sex || 'Not specified');
        byId('profilePhone').value = profile.phone || '';
        byId('profileAddress').value = profile.address || '';

        renderPhoto();

        var facts = byId('accountFacts');
        if (facts) {
            var rows = [
                ['Username', s.user || '—'],
                ['Role', (session.roleDefinition().label) || '—'],
                ['Department', staff.department || '—'],
                ['Shift', staff.shift || '—'],
                ['Email', staff.email || '—']
            ];
            facts.innerHTML = rows.map(function (r) {
                return '<div class="list-item">' +
                    '<span class="list-content">' +
                        '<span class="list-title">' + esc(r[0]) + '</span>' +
                        '<span class="list-subtitle">' + esc(r[1]) + '</span>' +
                    '</span>' +
                '</div>';
            }).join('');
        }
    }

    /* ==================================================================
        Photo
        ================================================================== */
    function resizeToDataUrl(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                var img = new Image();
                img.onload = function () {
                    var size = 256;
                    var canvas = document.createElement('canvas');
                    canvas.width = size;
                    canvas.height = size;
                    var ctx = canvas.getContext('2d');
                    /* Centre-crop to a square, then scale down. */
                    var side = Math.min(img.width, img.height);
                    ctx.drawImage(img,
                        (img.width - side) / 2, (img.height - side) / 2, side, side,
                        0, 0, size, size);
                    resolve(canvas.toDataURL('image/jpeg', 0.85));
                };
                img.onerror = function () { reject(new Error('not-an-image')); };
                img.src = reader.result;
            };
            reader.onerror = function () { reject(new Error('read-failed')); };
            reader.readAsDataURL(file);
        });
    }

    function bindPhoto() {
        var editBtn = byId('photoEditBtn');
        var input = byId('photoInput');
        if (!editBtn || !input) return;

        editBtn.addEventListener('click', function () {
            if (pendingPhoto) {
                /* The photo is already staged; clicking again clears it. */
                pendingPhoto = null;
                renderPhoto();
                window.MediTrackNotify.flash('Photo removed', 'Save the details to apply.', 'info');
                return;
            }
            input.value = '';
            input.click();
        });

        input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file) return;
            resizeToDataUrl(file).then(function (dataUrl) {
                pendingPhoto = dataUrl;
                renderPhoto();
                window.MediTrackNotify.flash('Photo ready', 'Save the details to apply the new photo.', 'info');
            }).catch(function () {
                window.MediTrackNotify.flash('Not an image', 'Choose a PNG, JPEG or WebP picture.', 'error');
            });
        });
    }

    /* ==================================================================
        Save
        ================================================================== */
    function saveDetails() {
        var name = byId('profileName').value.trim();
        if (!name) {
            ui.fieldError('profileName', 'Your name cannot be empty.');
            return;
        }

        var payload = {
            name: name,
            age: byId('profileAge').value === '' ? undefined : Number(byId('profileAge').value),
            sex: ui.getSelectValue('profileSexWrapper') || '',
            phone: byId('profilePhone').value.trim(),
            address: byId('profileAddress').value.trim()
        };
        if (pendingPhoto !== undefined) payload.photo = pendingPhoto;
        if (payload.age === undefined) delete payload.age;

        api('/api/profile', payload).then(function (out) {
            if (out.status === 200) {
                pendingPhoto = undefined;
                /* Keep the local session mirror in step so the topbar shows
                   the new name immediately. */
                try {
                    var raw = store.rawGet('meditrack_session');
                    var parsed = raw ? JSON.parse(raw) : null;
                    if (parsed) {
                        parsed.name = name;
                        store.rawSet('meditrack_session', JSON.stringify(parsed));
                    }
                } catch (e) {}
                /* Re-read the server snapshot so the saved values are shown
                   without a manual reload. */
                store.refresh(true);
                render();
                try {
                    window.parent.postMessage({ action: 'profile_updated' }, '*');
                } catch (e) {}
                window.MediTrackNotify.push('Profile saved',
                    'Your details were updated on the hospital server.',
                    'success', 'System', 'low');
            } else {
                window.MediTrackNotify.flash('Not saved',
                    (out.j && out.j.error) || 'The profile could not be saved.', 'error');
            }
        }).catch(function () {
            window.MediTrackNotify.flash('Server unreachable',
                'Check the network connection and try again.', 'error');
        });
    }

    function savePassword() {
        var current = byId('profileCurrentPw').value;
        var next = byId('profileNewPw').value;
        var confirm = byId('profileConfirmPw').value;

        if (!ui.requireFields([
            { id: 'profileCurrentPw', message: 'Enter your current password.' },
            {
                id: 'profileNewPw',
                message: 'The new password must be at least 6 characters.',
                test: function (v) { return v.length >= 6; }
            },
            { id: 'profileConfirmPw', message: 'Repeat the new password.' }
        ])) return;

        if (next !== confirm) {
            ui.fieldError('profileConfirmPw', 'The two passwords do not match.');
            return;
        }

        api('/api/auth/password', { current: current, next: next }).then(function (out) {
            if (out.status === 200) {
                byId('profileCurrentPw').value = '';
                byId('profileNewPw').value = '';
                byId('profileConfirmPw').value = '';
                window.MediTrackNotify.push('Password changed',
                    'Your sign-in password was updated. Other computers were signed out.',
                    'success', 'System', 'normal');
            } else {
                var el = byId('profileCurrentPw');
                ui.fieldError('profileCurrentPw',
                    (out.j && out.j.error) || 'The password could not be changed.');
                if (el) el.value = '';
            }
        }).catch(function () {
            window.MediTrackNotify.flash('Server unreachable',
                'Check the network connection and try again.', 'error');
        });
    }

    /* ==================================================================
        Init
        ================================================================== */
    function init() {
        render();
        bindPhoto();

        ui.initSelect('profileSexWrapper');
        ui.bindLiveValidation(['profileName', 'profileAge', 'profilePhone']);

        byId('profileName').addEventListener('input', renderPhoto);
        byId('profileName').addEventListener('input', function () {
            byId('heroName').textContent = byId('profileName').value || me().name || '—';
        });

        var saveBtn = byId('saveProfileBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveDetails);
        var pwBtn = byId('savePasswordBtn');
        if (pwBtn) pwBtn.addEventListener('click', savePassword);

        window.addEventListener('storage', function (e) {
            if (!e.key || e.key === store.KEYS.profiles || e.key === 'clinic_staff_members') render();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
