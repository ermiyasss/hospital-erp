(function() {
    'use strict';

    // Live clock
    function updateClock() {
        var now = new Date();
        var h = now.getHours();
        var m = String(now.getMinutes()).padStart(2, '0');
        var ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        var el = document.getElementById('liveTime');
        if (el) el.textContent = h + ':' + m + ' ' + ampm;
    }
    updateClock();
    setInterval(updateClock, 1000);

    var navItems = document.querySelectorAll('.nav-item');
    var menuToggle = document.getElementById('menuToggle');
    var sidebar = document.getElementById('sidebar');
    var contentFrame = document.getElementById('content-frame');
    var pageTitle = document.getElementById('pageTitle');

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', function() {
            sidebar.classList.toggle('open');
        });
    }

    function navigateTo(targetFile, linkText) {
        if (!contentFrame || !targetFile) return;
        contentFrame.src = targetFile;
        if (pageTitle && linkText) pageTitle.textContent = linkText;

        navItems.forEach(function(nav) {
            if (nav.dataset.target === targetFile) {
                nav.classList.add('active');
            } else {
                nav.classList.remove('active');
            }
        });

        if (sidebar && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
        }
    }

    navItems.forEach(function(item) {
        var link = item.querySelector('a');
        if (link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                var targetFile = item.dataset.target;
                var textSpan = item.querySelector('span');
                var linkText = textSpan ? textSpan.textContent : 'Dashboard';
                navigateTo(targetFile, linkText);
            });
        }
    });

    // Profile menu dropdown handling
    var topbarProfileWrap = document.getElementById('topbarProfileWrap');
    var topbarProfileBtn = document.getElementById('topbarProfileBtn');
    var menuSettingsLink = document.getElementById('menuSettingsLink');
    var menuQueueLink = document.getElementById('menuQueueLink');

    if (topbarProfileBtn && topbarProfileWrap) {
        topbarProfileBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            // Close notification panel if open
            if (notifCenterWrap) notifCenterWrap.classList.remove('active');
            topbarProfileWrap.classList.toggle('active');
        });
    }

    if (menuSettingsLink) {
        menuSettingsLink.addEventListener('click', function(e) {
            e.preventDefault();
            topbarProfileWrap.classList.remove('active');
            navigateTo('pages/settings.html', 'Settings');
        });
    }

    if (menuQueueLink) {
        menuQueueLink.addEventListener('click', function(e) {
            e.preventDefault();
            topbarProfileWrap.classList.remove('active');
            navigateTo('pages/queue.html', 'Queue');
        });
    }

    // Logout handling
    function performLogout() {
        if (confirm('Are you sure you want to sign out of MediTrack ERP?')) {
            sessionStorage.removeItem('selected_tracking_patient_id');
            sessionStorage.removeItem('meditrack_logged_in');
            window.location.href = 'index.html';
        }
    }

    var sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
    var topbarLogoutBtn = document.getElementById('topbarLogoutBtn');
    if (sidebarLogoutBtn) sidebarLogoutBtn.addEventListener('click', performLogout);
    if (topbarLogoutBtn) topbarLogoutBtn.addEventListener('click', performLogout);

    // ==========================================================================
    // Topbar Notification Center Logic
    // ==========================================================================
    var notifCenterWrap = document.getElementById('notifCenterWrap');
    var topbarNotifBtn = document.getElementById('topbarNotifBtn');
    var topbarNotifBadge = document.getElementById('topbarNotifBadge');
    var notifPanelList = document.getElementById('notifPanelList');
    var notifPanelUnreadCount = document.getElementById('notifPanelUnreadCount');
    var markAllReadBtn = document.getElementById('markAllReadBtn');
    var clearAllNotifsBtn = document.getElementById('clearAllNotifsBtn');

    function formatRelativeTime(isoString) {
        if (!isoString) return 'Just now';
        var d = new Date(isoString);
        var diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
        if (diffSec < 45) return 'Just now';
        if (diffSec < 3600) return Math.floor(diffSec / 60) + 'm ago';
        if (diffSec < 86400) return Math.floor(diffSec / 3600) + 'h ago';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function renderNotificationsPanel() {
        if (!window.MediTrackNotify) return;
        var notifs = window.MediTrackNotify.getAll();
        var unreadCount = window.MediTrackNotify.getUnreadCount();

        // Update Badge
        if (topbarNotifBadge) {
            if (unreadCount > 0) {
                topbarNotifBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                topbarNotifBadge.classList.remove('hidden');
            } else {
                topbarNotifBadge.classList.add('hidden');
            }
        }

        if (notifPanelUnreadCount) {
            notifPanelUnreadCount.textContent = unreadCount + ' new';
        }

        if (!notifPanelList) return;

        if (notifs.length === 0) {
            notifPanelList.innerHTML =
                '<div class="notif-empty-state">' +
                    '<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
                    '<p>No notifications yet</p>' +
                '</div>';
            return;
        }

        var icons = {
            info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
            success: '<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            warning: '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            error: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        };

        notifPanelList.innerHTML = notifs.slice(0, 20).map(function(n) {
            var unreadClass = !n.read ? ' unread' : '';
            var typeClass = ' type-' + (n.type || 'info');
            var catClass = ' notif-cat-' + (n.category ? n.category.toLowerCase() : 'system');
            return '<div class="notif-panel-item' + unreadClass + typeClass + '" data-id="' + n.id + '">' +
                '<div class="notif-panel-item-icon">' + (icons[n.type] || icons.info) + '</div>' +
                '<div class="notif-panel-item-content">' +
                    '<div class="notif-item-top">' +
                        '<span class="notif-item-title">' + n.title + '</span>' +
                        '<span class="notif-item-time">' + formatRelativeTime(n.timestamp) + '</span>' +
                    '</div>' +
                    '<span class="notif-item-text">' + n.message + '</span>' +
                '</div>' +
            '</div>';
        }).join('');

        // Item click marks read
        notifPanelList.querySelectorAll('.notif-panel-item').forEach(function(itemEl) {
            itemEl.addEventListener('click', function() {
                var id = this.getAttribute('data-id');
                if (window.MediTrackNotify) {
                    window.MediTrackNotify.markAsRead(id);
                    renderNotificationsPanel();
                }
            });
        });
    }

    if (topbarNotifBtn && notifCenterWrap) {
        topbarNotifBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (topbarProfileWrap) topbarProfileWrap.classList.remove('active');
            notifCenterWrap.classList.toggle('active');
            renderNotificationsPanel();
        });
    }

    if (markAllReadBtn) {
        markAllReadBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (window.MediTrackNotify) {
                window.MediTrackNotify.markAllAsRead();
                renderNotificationsPanel();
            }
        });
    }

    if (clearAllNotifsBtn) {
        clearAllNotifsBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (window.MediTrackNotify) {
                window.MediTrackNotify.clearAll();
                renderNotificationsPanel();
            }
        });
    }

    // Close dropdowns on outside click
    document.addEventListener('click', function() {
        if (notifCenterWrap) notifCenterWrap.classList.remove('active');
        if (topbarProfileWrap) topbarProfileWrap.classList.remove('active');
    });

    // Listen for notification updates
    window.addEventListener('meditrack:notification', function() {
        renderNotificationsPanel();
    });
    window.addEventListener('meditrack:notifications-updated', function() {
        renderNotificationsPanel();
    });

    // Initial render of badge & notifications
    setTimeout(renderNotificationsPanel, 100);

    // ==========================================================================
    // Cross-Frame Message Handler
    // ==========================================================================
    window.addEventListener('message', function(event) {
        if (!event.data) return;

        if (event.data.action === 'toggleBlur') {
            if (event.data.state) {
                document.body.classList.add('blurred-ui');
            } else {
                document.body.classList.remove('blurred-ui');
            }
        }

        if (event.data.action === 'navigate') {
            navigateTo(event.data.target, event.data.title);
        }

        if (event.data.action === 'new_notification' || event.data.action === 'notifications_read' || event.data.action === 'notifications_cleared') {
            renderNotificationsPanel();
        }
    }, false);
})();