
(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var session = window.MediSession;
    var theme = window.MediTheme;

    var SETTINGS_KEY = 'clinic_settings';

    var navItems = ui.qsa('.nav-item');
    var sidebar = document.getElementById('sidebar');
    var scrim = document.getElementById('sidebarScrim');
    var menuToggle = document.getElementById('menuToggle');
    var contentFrame = document.getElementById('content-frame');
    var pageTitle = document.getElementById('pageTitle');
    var pageBreadcrumb = document.getElementById('pageBreadcrumb');

    var notifCenterWrap = document.getElementById('notifCenterWrap');
    var topbarProfileWrap = document.getElementById('topbarProfileWrap');
    var topbarProfileBtn = document.getElementById('topbarProfileBtn');

    function byId(id) { return document.getElementById(id); }
    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }

    function metaForTarget(target) {
        var keys = Object.keys(session.PAGES);
        for (var i = 0; i < keys.length; i++) {
            if (session.PAGES[keys[i]].file === target) {
                return { key: keys[i], title: session.PAGES[keys[i]].title, section: session.PAGES[keys[i]].section };
            }
        }
        return null;
    }

    /* ==================================================================
       Clock
       ================================================================== */
    function updateClock() {
        var now = new Date();
        var h = now.getHours();
        var m = String(now.getMinutes()).padStart(2, '0');
        var ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;

        var time = byId('liveTime');
        if (time) time.textContent = h + ':' + m + ' ' + ampm;

        var date = byId('liveDate');
        if (date) {
            date.textContent = now.toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric'
            });
        }
    }

    function applyRoleToMenu() {
        var allowed = session.allowedPages();

        navItems.forEach(function (item) {
            var key = item.getAttribute('data-page');
            if (key && allowed.indexOf(key) === -1 && item.parentNode) {
                item.parentNode.removeChild(item);
            }
        });

     
        navItems = ui.qsa('.nav-item');

        ui.qsa('.nav-section').forEach(function (heading) {
            var next = heading.nextElementSibling;
            var hasItems = false;
            while (next && !next.classList.contains('nav-section')) {
                if (next.classList.contains('nav-item')) { hasItems = true; break; }
                next = next.nextElementSibling;
            }
            if (!hasItems && heading.parentNode) heading.parentNode.removeChild(heading);
        });

        /* Same for the profile menu shortcuts. */
        ['menuSettingsLink', 'menuStaffLink'].forEach(function (id) {
            var el = byId(id);
            if (!el) return;
            var key = el.getAttribute('data-page');
            if (key && allowed.indexOf(key) === -1 && el.parentNode) {
                el.parentNode.removeChild(el);
            }
        });
    }

    /* ==================================================================
       Identity + facility name
       ================================================================== */
    function readSettings() {
        try {
            var raw = store.rawGet(SETTINGS_KEY);
            var parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function applyIdentity() {
        var s = readSettings();
        var current = session.read();
        var def = session.roleDefinition();

        var facility = byId('brandFacility');
        if (facility && s.facilityName) facility.textContent = s.facilityName;

        var dept = byId('brandDepartment');
        if (dept) dept.textContent = s.departmentName || 'Hospital ERP';

        var name = (current && current.name) || s.clinicianName || def.label;
        [byId('topbarUserName'), byId('menuUserName')].forEach(function (el) {
            if (el) el.textContent = name;
        });

        var avatar = byId('topbarAvatar');
        if (avatar) avatar.textContent = store.initials(name);

        var roleLabel = byId('topbarUserRole');
        if (roleLabel) roleLabel.textContent = def.label;

        var menuDept = byId('menuUserDept');
        if (menuDept) {
            menuDept.textContent = def.label +
                (s.departmentName ? ' · ' + s.departmentName : '');
        }
    }

    /* ==================================================================
       Light / dark switch
       ================================================================== */
    function refreshThemeButton() {
        var iconEl = byId('themeToggleIcon');
        var btn = byId('themeToggleBtn');
        if (!iconEl || !theme) return;

        var dark = theme.resolvedTheme() === 'dark';
        iconEl.setAttribute('data-icon', dark ? 'sun' : 'moon');
        iconEl.removeAttribute('data-icon-done');
        if (window.MediIcons) window.MediIcons.hydrate(iconEl.parentNode || document);

        if (btn) {
            var label = dark ? 'Switch to light mode' : 'Switch to dark mode';
            btn.setAttribute('title', label);
            btn.setAttribute('aria-label', label);
        }
    }

    /* ==================================================================
       Navigation
       ================================================================== */
    function closeSidebar() {
        if (sidebar) sidebar.classList.remove('open');
        if (scrim) scrim.classList.remove('visible');
    }

    function navigateTo(target, fallbackTitle) {
        if (!contentFrame || !target) return;

        /* Refuse a target this role does not cover. The page guards itself too,
           but stopping here means the frame never loads it at all. */
        if (!session.canOpenFile(target)) return;

        contentFrame.src = target;

        var meta = metaForTarget(target) || { title: fallbackTitle || 'Dashboard', section: '' };
        if (pageTitle) pageTitle.textContent = meta.title;
        if (pageBreadcrumb) pageBreadcrumb.textContent = meta.section || meta.title;

        navItems.forEach(function (item) {
            item.classList.toggle('active', item.getAttribute('data-target') === target);
        });
        closeSidebar();
    }

    function bindNav() {
        navItems.forEach(function (item) {
            var link = item.querySelector('a');
            if (!link) return;
            link.addEventListener('click', function (e) {
                e.preventDefault();
                navigateTo(item.getAttribute('data-target'));
            });
        });
    }

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', function (e) {
            e.stopPropagation();
            var open = sidebar.classList.toggle('open');
            if (scrim) scrim.classList.toggle('visible', open);
        });
    }
    if (scrim) scrim.addEventListener('click', closeSidebar);

    /* ==================================================================
       Workload badges
       The menu is the only place that shows where work is piling up, so it
       reads exactly the same data the department screens do.
       ================================================================== */
    function refreshBadges() {
        var patients = store.readPatients();
        var labs = store.read(store.KEYS.labRequests);
        var scripts = store.read(store.KEYS.prescriptions);
        var invoices = store.read('clinic_invoices');

        var counts = {
            queue: store.queueOrder(patients).length,
            review: 0,
            lab: labs.filter(function (l) { return l.status !== 'Completed'; }).length,
            nurse: 0,
            pharmacy: scripts.filter(function (r) { return r.status !== 'Dispensed'; }).length,
            billing: invoices.filter(function (i) { return i.status !== 'Paid' && i.status !== 'Cancelled'; }).length
        };

        patients.forEach(function (p) {
            counts.review += store.unreviewedResults(p).length ? 1 : 0;
            counts.nurse += (p.nurseOrders || []).filter(store.isOrderOpen).length;
        });

        Object.keys(counts).forEach(function (key) {
            var badge = document.querySelector('[data-badge="' + key + '"]');
            if (!badge) return;
            var n = counts[key];
            badge.textContent = n > 99 ? '99+' : n;
            badge.classList.toggle('hidden', n === 0);
            /* Results nobody has looked at is the one badge that should nag. */
            badge.classList.toggle('badge-alert', key === 'review' && n > 0);
        });
    }

    /* ==================================================================
       Alert panel
       ================================================================== */
    var notifPanelList = byId('notifPanelList');
    var notifPanelUnreadCount = byId('notifPanelUnreadCount');
    var topbarNotifBtn = byId('topbarNotifBtn');
    var topbarNotifBadge = byId('topbarNotifBadge');
    var notifFilterBar = byId('notifFilterBar');
    var activeFilter = 'all';

    var RESULT_CATEGORIES = ['lab', 'laboratory', 'radiology', 'results', 'pharmacy', 'vitals'];
    var TYPE_ICON = { info: 'info', success: 'check-circle', warning: 'warning', error: 'critical' };

    function matchesFilter(n) {
        if (activeFilter === 'all') return true;
        if (activeFilter === 'unread') return !n.read;
        if (activeFilter === 'critical') return n.priority === 'critical';
        if (activeFilter === 'results') {
            return RESULT_CATEGORIES.indexOf(String(n.category || '').toLowerCase()) !== -1;
        }
        return true;
    }

    /* The log is shared storage, so an alert written while another role was
       signed in can still be sitting there. Filter on read as well as write. */
    function visibleNotifications() {
        return window.MediTrackNotify.getAll().filter(function (n) {
            return session.wantsAlert(n.category);
        });
    }

    function renderNotifications() {
        if (!window.MediTrackNotify) return;

        var all = visibleNotifications();
        var unread = all.filter(function (n) { return !n.read; }).length;
        var critical = all.filter(function (n) { return !n.read && n.priority === 'critical'; }).length;

        if (topbarNotifBadge) {
            topbarNotifBadge.textContent = unread > 99 ? '99+' : unread;
            topbarNotifBadge.classList.toggle('hidden', unread === 0);
            topbarNotifBadge.classList.toggle('is-critical', critical > 0);
        }
        if (topbarNotifBtn) topbarNotifBtn.classList.toggle('has-critical', critical > 0);
        if (notifPanelUnreadCount) {
            notifPanelUnreadCount.textContent = unread === 0
                ? 'Nothing new'
                : unread + ' unread' + (critical ? ' · ' + critical + ' urgent' : '');
        }
        if (!notifPanelList) return;

        var list = all.filter(matchesFilter);

        if (!list.length) {
            notifPanelList.innerHTML =
                '<div class="notif-empty-state">' +
                    icon(activeFilter === 'all' ? 'bell-off' : 'check-circle', 24) +
                    '<p>' + (activeFilter === 'all' ? 'No alerts' : 'Nothing here') + '</p>' +
                    '<span>Alerts show up when results come back, a reading is outside the normal range, or a patient needs to be seen straight away.</span>' +
                '</div>';
            return;
        }

        notifPanelList.innerHTML = list.slice(0, 40).map(function (n) {
            var type = n.type || 'info';
            var cls = 'notif-panel-item type-' + type +
                (n.read ? '' : ' unread') +
                (n.priority === 'critical' ? ' is-critical' : '');

            return '<button type="button" class="' + cls + '" data-id="' + esc(n.id) + '">' +
                '<span class="notif-panel-item-icon">' + icon(TYPE_ICON[type] || 'info', 16) + '</span>' +
                '<span class="notif-panel-item-content">' +
                    '<span class="notif-item-top">' +
                        '<span class="notif-item-title">' + esc(n.title) + '</span>' +
                        '<span class="notif-item-time">' + esc(store.relativeTime(n.timestamp)) + '</span>' +
                    '</span>' +
                    '<span class="notif-item-text">' + esc(n.message) + '</span>' +
                    '<span class="notif-item-meta">' +
                        '<span class="notif-item-cat">' + esc(n.category || 'System') + '</span>' +
                        (n.priority === 'critical' ? '<span class="notif-item-flag">Urgent</span>' : '') +
                    '</span>' +
                '</span>' +
            '</button>';
        }).join('');

        ui.qsa('.notif-panel-item', notifPanelList).forEach(function (el) {
            el.addEventListener('click', function () {
                window.MediTrackNotify.markAsRead(el.getAttribute('data-id'));
                renderNotifications();
            });
        });
    }

    if (notifFilterBar) {
        notifFilterBar.addEventListener('click', function (e) {
            var chip = e.target.closest ? e.target.closest('[data-notif-filter]') : null;
            if (!chip) return;
            e.stopPropagation();
            activeFilter = chip.getAttribute('data-notif-filter');
            ui.qsa('[data-notif-filter]', notifFilterBar).forEach(function (c) {
                c.classList.toggle('active', c === chip);
            });
            renderNotifications();
        });
    }

    if (topbarNotifBtn && notifCenterWrap) {
        topbarNotifBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (topbarProfileWrap) topbarProfileWrap.classList.remove('active');
            notifCenterWrap.classList.toggle('active');
            renderNotifications();
        });
        notifCenterWrap.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    var markAllReadBtn = byId('markAllReadBtn');
    if (markAllReadBtn) {
        markAllReadBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            window.MediTrackNotify.markAllAsRead();
            renderNotifications();
        });
    }

    var clearAllNotifsBtn = byId('clearAllNotifsBtn');
    if (clearAllNotifsBtn) {
        clearAllNotifsBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            ui.confirmAction({
                title: 'Clear all alerts',
                message: 'This empties the alert list, including urgent alerts you have not read yet. Patient records are not affected.',
                confirmLabel: 'Clear alerts',
                tone: 'danger',
                icon: 'trash'
            }, function () {
                window.MediTrackNotify.clearAll();
                renderNotifications();
            });
        });
    }

    /* ==================================================================
       Profile menu
       ================================================================== */
    function toggleProfile(e) {
        e.stopPropagation();
        if (notifCenterWrap) notifCenterWrap.classList.remove('active');
        var open = topbarProfileWrap.classList.toggle('active');
        if (topbarProfileBtn) topbarProfileBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    if (topbarProfileBtn && topbarProfileWrap) {
        topbarProfileBtn.addEventListener('click', toggleProfile);
    }

    function bindProfileLinks() {
        ['menuSettingsLink', 'menuStaffLink'].forEach(function (id) {
            var el = byId(id);
            if (!el) return;
            el.addEventListener('click', function () {
                topbarProfileWrap.classList.remove('active');
                navigateTo(el.getAttribute('data-target'));
            });
        });
    }

    var logoutBtn = byId('topbarLogoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            topbarProfileWrap.classList.remove('active');
            ui.confirmAction({
                title: 'Sign out',
                message: 'Patient records stay on this computer. Whoever signs in next will see the same records.',
                confirmLabel: 'Sign out',
                tone: 'warning',
                icon: 'logout'
            }, function () {
                store.sessionRemove('selected_tracking_patient_id');
                session.signOut();
                window.location.href = 'index.html';
            });
        });
    }

    /* ==================================================================
       Close anything open
       ================================================================== */
    document.addEventListener('click', function () {
        if (notifCenterWrap) notifCenterWrap.classList.remove('active');
        if (topbarProfileWrap) {
            topbarProfileWrap.classList.remove('active');
            if (topbarProfileBtn) topbarProfileBtn.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (notifCenterWrap) notifCenterWrap.classList.remove('active');
        if (topbarProfileWrap) topbarProfileWrap.classList.remove('active');
        closeSidebar();
    });

    /* ==================================================================
       Messages from the page inside the frame
       ================================================================== */
    window.addEventListener('message', function (event) {
        var data = event.data;
        if (!data || !data.action) return;

        switch (data.action) {
            case 'toggleBlur':
                document.body.classList.toggle('blurred-ui', !!data.state);
                break;
            case 'navigate':
                navigateTo(data.target, data.title);
                break;
            case 'appearance_changed':
                refreshThemeButton();
                break;
            case 'new_notification':
            case 'notifications_read':
            case 'notifications_cleared':
                renderNotifications();
                refreshBadges();
                break;
        }
    }, false);

    /* ==================================================================
       Start
       ================================================================== */
    function init() {
        /* No session at all means someone opened the shell directly. Send them
           to the sign-in screen so a role is always chosen deliberately. */
        if (!session.isSignedIn()) {
            window.location.replace('index.html');
            return;
        }

        applyRoleToMenu();
        bindNav();
        bindProfileLinks();

        updateClock();
        setInterval(updateClock, 20000);

        applyIdentity();
        refreshThemeButton();
        refreshBadges();

        /* Open the landing page for this role, not whatever is hard-coded in
           the iframe's src attribute. */
        navigateTo(session.landingFile());

        var themeBtn = byId('themeToggleBtn');
        if (themeBtn && theme) {
            themeBtn.addEventListener('click', function () {
                theme.toggleTheme();
                refreshThemeButton();
            });
        }

        window.addEventListener('meditrack:notification', function () {
            renderNotifications();
            refreshBadges();
        });
        window.addEventListener('meditrack:notifications-updated', renderNotifications);
        window.addEventListener('meditrack:settings-updated', applyIdentity);
        window.addEventListener('meditrack:appearance-updated', refreshThemeButton);
        window.addEventListener('storage', function (e) {
            if (e.key === SETTINGS_KEY) applyIdentity();
            refreshBadges();
            renderNotifications();
        });

        store.onPatientsChanged(refreshBadges);
        setInterval(refreshBadges, 30000);
        setTimeout(renderNotifications, 80);
    }

    init();
})(window, document);
