/**
 * MediTrack Hospital ERP - Global Real-time Notification System
 * Unified notification hub accessible across all frames and pages.
 * Handles toast popups, persistent notification logging, unread badge sync,
 * and automated triggers for labs, patient updates, queue shifts, and doctor orders.
 */

(function(window) {
    'use strict';

    var STORAGE_NOTIFS_KEY = 'clinic_notifications_log';
    var STORAGE_KEY_PATIENTS = 'clinic_patients_data';
    var STORAGE_KEY_LAB = 'clinic_lab_requests';

    var container = null;
    var prevPatientCount = 0;
    var prevPatientsState = {};
    var prevLabCompletedCount = 0;
    var prevLabCount = 0;

    var icons = {
        info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        success: '<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        warning: '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        error: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    };

    function ensureContainer() {
        if (container && document.body.contains(container)) return container;
        container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
        return container;
    }

    function getStoredNotifications() {
        try {
            var raw = localStorage.getItem(STORAGE_NOTIFS_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function saveStoredNotifications(notifs) {
        try {
            var trimmed = notifs.slice(0, 60);
            localStorage.setItem(STORAGE_NOTIFS_KEY, JSON.stringify(trimmed));
        } catch (e) {}
    }

    function showToast(title, message, type, category, id) {
        type = type || 'info';
        category = category || 'System';
        var c = ensureContainer();

        var toast = document.createElement('div');
        toast.className = 'notification-toast type-' + type;
        if (id) toast.dataset.id = id;

        var catBadge = '<span class="notif-cat notif-cat-' + category.toLowerCase() + '">' + category + '</span>';

        toast.innerHTML =
            '<div class="notif-icon">' + (icons[type] || icons.info) + '</div>' +
            '<div class="notif-body">' +
                '<div class="notif-head-row">' +
                    '<span class="notif-title">' + title + '</span>' +
                    catBadge +
                '</div>' +
                '<span class="notif-message">' + message + '</span>' +
            '</div>' +
            '<button class="notif-dismiss" title="Dismiss" aria-label="Close notification">&times;</button>';

        c.appendChild(toast);

        // Slide in
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                toast.classList.add('visible');
            });
        });

        // Auto dismiss after 7 seconds if not interacted with
        var autoTimer = setTimeout(function() {
            dismissToast(toast);
        }, 7000);

        // Dismiss on click
        var dismissBtn = toast.querySelector('.notif-dismiss');
        dismissBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            clearTimeout(autoTimer);
            dismissToast(toast);
        });

        toast.addEventListener('mouseenter', function() {
            clearTimeout(autoTimer);
        });
    }

    function dismissToast(toast) {
        if (!toast) return;
        toast.classList.remove('visible');
        setTimeout(function() {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }

    function MediTrackNotify(title, message, type, category) {
        return MediTrackNotify.push(title, message, type, category);
    }

    MediTrackNotify.push = function(title, message, type, category) {
        type = type || 'info';
        category = category || 'System';

        var item = {
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 6),
            title: title,
            message: message,
            type: type,
            category: category,
            timestamp: new Date().toISOString(),
            read: false
        };

        var notifs = getStoredNotifications();
        notifs.unshift(item);
        saveStoredNotifications(notifs);

        // Display toast in current frame
        showToast(title, message, type, category, item.id);

        // Notify parent window if in iframe
        if (window.parent && window.parent !== window) {
            try {
                window.parent.postMessage({
                    action: 'new_notification',
                    notification: item
                }, '*');
            } catch (e) {}
        }

        // Dispatch a local custom event for topbar UI components
        window.dispatchEvent(new CustomEvent('meditrack:notification', { detail: item }));

        return item;
    };

    MediTrackNotify.getAll = function() {
        return getStoredNotifications();
    };

    MediTrackNotify.getUnreadCount = function() {
        var notifs = getStoredNotifications();
        return notifs.filter(function(n) { return !n.read; }).length;
    };

    MediTrackNotify.markAllAsRead = function() {
        var notifs = getStoredNotifications();
        notifs.forEach(function(n) { n.read = true; });
        saveStoredNotifications(notifs);
        window.dispatchEvent(new CustomEvent('meditrack:notifications-updated'));
        if (window.parent && window.parent !== window) {
            try {
                window.parent.postMessage({ action: 'notifications_read' }, '*');
            } catch (e) {}
        }
    };

    MediTrackNotify.markAsRead = function(id) {
        var notifs = getStoredNotifications();
        var target = notifs.find(function(n) { return n.id === id; });
        if (target) {
            target.read = true;
            saveStoredNotifications(notifs);
            window.dispatchEvent(new CustomEvent('meditrack:notifications-updated'));
        }
    };

    MediTrackNotify.clearAll = function() {
        saveStoredNotifications([]);
        window.dispatchEvent(new CustomEvent('meditrack:notifications-updated'));
        if (window.parent && window.parent !== window) {
            try {
                window.parent.postMessage({ action: 'notifications_cleared' }, '*');
            } catch (e) {}
        }
    };

    MediTrackNotify.toast = function(title, message, type, category) {
        return MediTrackNotify.push(title, message, type, category);
    };

    // Global alias
    window.MediTrackNotify = MediTrackNotify;

    /* --------------------------------------------------------------------------
       Automated Storage Watchers
       -------------------------------------------------------------------------- */
    function snapshotCounts() {
        try {
            var pData = localStorage.getItem(STORAGE_KEY_PATIENTS);
            if (pData) {
                var patients = JSON.parse(pData);
                prevPatientCount = patients.length;
                prevPatientsState = {};
                patients.forEach(function(p) {
                    prevPatientsState[p.id] = { status: p.status, urgency: p.urgency };
                });
            }
        } catch (e) { prevPatientCount = 0; }

        try {
            var lData = localStorage.getItem(STORAGE_KEY_LAB);
            if (lData) {
                var labs = JSON.parse(lData);
                prevLabCount = labs.length;
                prevLabCompletedCount = labs.filter(function(l) { return l.status === 'Completed'; }).length;
            }
        } catch (e) {
            prevLabCount = 0;
            prevLabCompletedCount = 0;
        }
    }

    function init() {
        snapshotCounts();

        // Listen for cross-tab or cross-frame storage events
        window.addEventListener('storage', function(e) {
            if (e.key === STORAGE_NOTIFS_KEY) {
                window.dispatchEvent(new CustomEvent('meditrack:notifications-updated'));
            }

            if (e.key === STORAGE_KEY_PATIENTS) {
                try {
                    var newPatients = JSON.parse(e.newValue || '[]');
                    if (newPatients.length > prevPatientCount) {
                        var latest = newPatients[newPatients.length - 1];
                        MediTrackNotify.push(
                            'New Patient Registered',
                            (latest.name || 'Patient') + ' (' + (latest.trackingId || '') + ') added to clinical registry.',
                            'info',
                            'Patient'
                        );
                    } else {
                        // Check for status transitions
                        newPatients.forEach(function(p) {
                            var old = prevPatientsState[p.id];
                            if (old && old.status !== p.status) {
                                if (p.status === 'In Treatment') {
                                    MediTrackNotify.push(
                                        'Patient In Consultation',
                                        p.name + ' (' + p.trackingId + ') called into treatment room.',
                                        'info',
                                        'Queue'
                                    );
                                } else if (p.status === 'Finished') {
                                    MediTrackNotify.push(
                                        'Consultation Completed',
                                        p.name + ' consultation finished and archived to storage.',
                                        'success',
                                        'Doctor'
                                    );
                                }
                            }
                        });
                    }

                    prevPatientCount = newPatients.length;
                    prevPatientsState = {};
                    newPatients.forEach(function(p) {
                        prevPatientsState[p.id] = { status: p.status, urgency: p.urgency };
                    });
                } catch (ex) {}
            }

            if (e.key === STORAGE_KEY_LAB) {
                try {
                    var newLabs = JSON.parse(e.newValue || '[]');
                    var newCompleted = newLabs.filter(function(l) { return l.status === 'Completed'; }).length;
                    if (newCompleted > prevLabCompletedCount) {
                        var completedOrder = newLabs.filter(function(l) { return l.status === 'Completed'; }).pop();
                        MediTrackNotify.push(
                            'Laboratory Result Ready',
                            (completedOrder.test || 'Diagnostic test') + ' results for ' + (completedOrder.patientName || 'patient') + ' are ready for review.',
                            'success',
                            'Lab'
                        );
                    } else if (newLabs.length > prevLabCount) {
                        var newOrder = newLabs[newLabs.length - 1];
                        MediTrackNotify.push(
                            'New Lab Request Dispatched',
                            newOrder.test + ' ordered for ' + (newOrder.patientName || 'patient') + ' (' + (newOrder.priority || 'Routine') + ').',
                            'info',
                            'Lab'
                        );
                    }
                    prevLabCount = newLabs.length;
                    prevLabCompletedCount = newCompleted;
                } catch (ex) {}
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window);
