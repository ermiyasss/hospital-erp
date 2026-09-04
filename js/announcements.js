/* ==========================================================================
   MediTrack Hospital ERP - Announcements

   Replaces the old nurse-only "standing directives". Doctors and
   administrators publish announcements and choose the audience (everyone or
   a single role). Every other role reads what is addressed to them and marks
   it as read — the read state is kept per role, so each workstation only
   tracks its own signed-in role.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;

    var KEY = 'clinic_announcements';

    var announcements = [];
    var filter = 'inbox';          /* inbox | unread | all */
    var targetRole = 'all';
    var canCompose = false;

    function esc(s) { return store.escapeHtml(s); }
    function byId(id) { return document.getElementById(id); }

    function session() {
        try { return window.MediSession.read() || {}; }
        catch (e) { return {}; }
    }

    function myRole() {
        return window.MediSession.role();
    }

    function roleLabel(key) {
        try {
            var def = window.MediSession.roleDefinition(key);
            if (def && def.label) return def.label;
        } catch (e) {}
        return key || '—';
    }

    /* Doctor and admin publish; everyone reads. */
    function computePermissions() {
        canCompose = ['admin', 'doctor'].indexOf(myRole()) !== -1;
    }

    function isForMe(a) {
        return a.target === 'all' || a.target === myRole();
    }

    function isUnread(a) {
        var reads = a.reads || {};
        return !reads[myRole()];
    }

    function load() {
        announcements = store.read(KEY);
        render();
    }

    /* ==================================================================
        Render
        ================================================================== */
    function render() {
        computePermissions();

        var composeBtn = byId('newAnnouncementBtn');
        if (composeBtn) composeBtn.classList.toggle('is-hidden', !canCompose);

        var inbox = announcements.filter(isForMe);
        setText('annUnreadCount', inbox.filter(isUnread).length);

        updateNavBadge(inbox.filter(isUnread).length);

        var rows = announcements.slice();
        if (filter === 'inbox') rows = rows.filter(isForMe);
        if (filter === 'unread') rows = rows.filter(function (a) {
            return isForMe(a) && isUnread(a);
        });
        rows.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });

        var host = byId('announcementsList');
        if (!host) return;

        if (!rows.length) {
            host.innerHTML = ui.emptyState({
                icon: 'bell-off',
                title: filter === 'unread' ? 'Nothing unread' : 'No announcements yet',
                text: canCompose
                    ? 'Use "New announcement" to inform staff across roles.'
                    : 'Announcements from doctors and administration will appear here.'
            });
            return;
        }

        host.innerHTML = rows.map(function (a) {
            var forMe = isForMe(a);
            var read = !isUnread(a);
            var mine = canCompose;

            return '<article class="ann-card' + (read || !forMe ? ' is-read' : '') + '">' +
                '<header class="ann-head">' +
                    '<span class="ann-icon">' + icon('bell', 15) + '</span>' +
                    '<div class="ann-heading">' +
                        '<h3>' + esc(a.title) + '</h3>' +
                        '<span class="ann-meta">' + esc(store.formatDateTime(a.time)) +
                            ' · by <strong>' + esc(a.authorName || 'Administration') + '</strong>' +
                            (a.authorRole ? ' (' + esc(roleLabel(a.authorRole)) + ')' : '') + '</span>' +
                    '</div>' +
                    '<span class="badge ' + (a.target === 'all' ? 'status-awaiting' : 'status-consulting') + '">' +
                        icon('users', 12) + '<span>' +
                        esc(a.target === 'all' ? 'Everyone' : roleLabel(a.target)) + '</span>' +
                    '</span>' +
                '</header>' +

                '<p class="ann-body">' + esc(a.body) + '</p>' +

                '<footer class="ann-foot">' +
                    (forMe
                        ? (read
                            ? '<span class="badge status-finished">' + icon('check', 12) +
                              '<span>Read</span></span>'
                            : '<button type="button" class="btn-secondary btn-sm" data-read="' + esc(a.id) + '">' +
                                icon('check', 14) + '<span>Mark as read</span></button>')
                        : '<span class="ann-not-target">Not addressed to your role</span>') +
                    (mine
                        ? '<button type="button" class="btn-text ann-delete" data-delete="' + esc(a.id) + '">' +
                            icon('trash', 13) + '<span>Delete</span></button>'
                        : '') +
                '</footer>' +
            '</article>';
        }).join('');

        ui.qsa('[data-read]', host).forEach(function (btn) {
            btn.addEventListener('click', function () { markRead(btn.getAttribute('data-read')); });
        });
        ui.qsa('[data-delete]', host).forEach(function (btn) {
            btn.addEventListener('click', function () { remove(btn.getAttribute('data-delete')); });
        });

        if (window.MediIcons) window.MediIcons.hydrate(host);
    }

    function icon(name, size) { return ui.icon(name, size); }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value;
    }

    /* Unread count on the sidebar item in the shell. */
    function updateNavBadge(count) {
        try {
            if (window.parent && window.parent !== window) {
                var doc = window.parent.document;
                var badge = doc.querySelector('[data-badge="announcements"]');
                if (badge) {
                    badge.textContent = count;
                    badge.classList.toggle('hidden', !count);
                }
            }
        } catch (e) {}
    }

    /* ==================================================================
        Actions
        ================================================================== */
    function markRead(id) {
        announcements.forEach(function (a) {
            if (String(a.id) === String(id)) {
                a.reads = a.reads || {};
                a.reads[myRole()] = new Date().toISOString();
            }
        });
        store.write(KEY, announcements);
        load();
    }

    function remove(id) {
        ui.confirmAction({
            title: 'Delete announcement?',
            message: 'It disappears for every role it was sent to.',
            confirmLabel: 'Delete'
        }, function () {
            announcements = announcements.filter(function (a) {
                return String(a.id) !== String(id);
            });
            store.write(KEY, announcements);
            load();
        });
    }

    function openCompose() {
        byId('annTitle').value = '';
        byId('annBody').value = '';
        targetRole = 'all';
        ui.qsa('#annTargetChips .chip').forEach(function (c) {
            c.classList.toggle('active', c.getAttribute('data-target') === 'all');
        });
        ui.clearFieldError('annTitle');
        ui.clearFieldError('annBody');
        ui.openModal('composeModal');
    }

    function publish() {
        if (!ui.requireFields([
            { id: 'annTitle', message: 'Give the announcement a title.' },
            { id: 'annBody', message: 'Write the message staff should read.' }
        ])) return;

        var s = session();
        announcements.push({
            id: 'ann_' + Date.now(),
            title: byId('annTitle').value.trim(),
            body: byId('annBody').value.trim(),
            target: targetRole,
            authorName: s.name || 'Administration',
            authorRole: s.role || 'admin',
            time: new Date().toISOString(),
            reads: {}
        });

        store.write(KEY, announcements);
        ui.closeModal('composeModal');
        load();

        window.MediTrackNotify.flash('Published',
            '"' + byId('annTitle').value.trim() + '" is now visible to its audience.');
    }

    /* ==================================================================
        Init
        ================================================================== */
    function init() {
        load();

        ui.initSelect('annFilterWrapper', function (v) { filter = v; render(); });
        ui.initChips(byId('annTargetChips'), 'data-target', function (v) { targetRole = v; });

        var newBtn = byId('newAnnouncementBtn');
        if (newBtn) newBtn.addEventListener('click', openCompose);

        var publishBtn = byId('publishAnnouncementBtn');
        if (publishBtn) publishBtn.addEventListener('click', publish);

        ui.bindLiveValidation(['annTitle', 'annBody']);

        /* Other workstations may publish while this one is open. */
        window.addEventListener('storage', function (e) {
            if (!e.key || e.key === KEY) load();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
