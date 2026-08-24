/* ==========================================================================
   MediTrack Hospital ERP - Settings

   Scope is deliberately narrow: this build has no backend, so the page only
   offers settings it can actually honour. Three things it honours properly:

     - appearance (theme, accent, density, motion, sound), which js/theme.js
       applies to <html> and relays into every page inside the dashboard
       frame. Everything is persisted in localStorage under clinic_settings.
     - the calling policy, which js/store.js reads when ordering the queue
     - alert routing, which js/notifications.js reads before raising anything

   Critical alerts are excluded from routing on purpose. A panic laboratory
   value must not be silenceable from a preferences screen.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;
    var theme = window.MediTheme;

    var SETTINGS_KEY = 'clinic_settings';

    /* Only what this page owns. Facility details written elsewhere in the
       same storage key are preserved on save (see writeSettings). */
    var DEFAULTS = {
        alertLabResults: true,
        alertAbnormalVitals: true,
        alertStatRequests: true,
        alertLowStock: true,
        alertRoutineLog: true,
        alertConfirmations: true,
        toastDuration: '6000'
    };

    var TOGGLES = [
        ['alertLabResults', 'alertLabResults'],
        ['alertAbnormalVitals', 'alertAbnormalVitals'],
        ['alertStatRequests', 'alertStatRequests'],
        ['alertLowStock', 'alertLowStock'],
        ['alertRoutineLog', 'alertRoutineLog'],
        ['alertConfirmations', 'alertConfirmations']
    ];

    var settings = {};

    function byId(id) { return document.getElementById(id); }
    function esc(s) { return store.escapeHtml(s); }

    /* Settings are an object, not an array, so read() cannot be used. */
    function readSettings() {
        try {
            var raw = store.rawGet(SETTINGS_KEY);
            var parsed = raw ? JSON.parse(raw) : {};
            var out = {};
            Object.keys(DEFAULTS).forEach(function (k) {
                out[k] = (parsed && parsed[k] !== undefined) ? parsed[k] : DEFAULTS[k];
            });
            return out;
        } catch (e) {
            var fallback = {};
            Object.keys(DEFAULTS).forEach(function (k) { fallback[k] = DEFAULTS[k]; });
            return fallback;
        }
    }

    /* Merge rather than replace, so values owned by other screens (facility
       name used in the sidebar brand, appearance keys) are never clobbered
       by a save from this page. */
    function writeSettings(partial) {
        var existing = {};
        try {
            var raw = store.rawGet(SETTINGS_KEY);
            var parsed = raw ? JSON.parse(raw) : null;
            if (parsed && typeof parsed === 'object') existing = parsed;
        } catch (e) {}

        Object.keys(settings).forEach(function (k) { existing[k] = settings[k]; });
        if (partial) Object.keys(partial).forEach(function (k) { existing[k] = partial[k]; });

        store.rawSet(SETTINGS_KEY, JSON.stringify(existing));
        try { window.dispatchEvent(new CustomEvent('meditrack:settings-updated')); } catch (e) {}
    }

    /* ==================================================================
        Appearance (delegates to js/theme.js)
        ================================================================== */
    function currentAppearance() {
        return theme ? theme.read() : { theme: 'light', accent: 'blue', density: 'comfortable', reduceMotion: false, soundEnabled: true, soundVolume: 'medium' };
    }

    function renderAppearance() {
        var a = currentAppearance();

        ui.qsa('#themeModeOptions [data-theme-choice]').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-theme-choice') === a.theme);
        });

        var host = byId('accentSwatches');
        if (host && theme) {
            if (!host.childElementCount) {
                host.innerHTML = theme.ACCENTS.map(function (acc) {
                    return '<button type="button" class="accent-swatch" data-accent-choice="' +
                        esc(acc.value) + '" title="' + esc(acc.label) + '" aria-label="' + esc(acc.label) + '">' +
                        '<span class="swatch-dot" style="background:' + esc(acc.swatch) + '"></span>' +
                        '<span class="swatch-label">' + esc(acc.label) + '</span>' +
                    '</button>';
                }).join('');
            }
            ui.qsa('[data-accent-choice]', host).forEach(function (btn) {
                btn.classList.toggle('active', btn.getAttribute('data-accent-choice') === a.accent);
            });
        }

        var compact = byId('setCompactDensity');
        if (compact) compact.checked = a.density === 'compact';
        var motion = byId('setReduceMotion');
        if (motion) motion.checked = !!a.reduceMotion;

        var sound = byId('setSoundEnabled');
        if (sound) sound.checked = a.soundEnabled !== false;

        ui.setSelectValue('setSoundVolumeWrapper', a.soundVolume || 'medium',
            (a.soundVolume || 'medium').charAt(0).toUpperCase() + (a.soundVolume || 'medium').slice(1));
    }

    function bindAppearance() {
        var modeHost = byId('themeModeOptions');
        if (modeHost) {
            modeHost.addEventListener('click', function (e) {
                var btn = e.target.closest ? e.target.closest('[data-theme-choice]') : null;
                if (!btn) return;
                /* Dark / light chosen explicitly; "system" follows the OS. */
                if (theme) theme.set({ theme: btn.getAttribute('data-theme-choice') });
                renderAppearance();
                window.MediTrackNotify.flash('Appearance saved',
                    btn.getAttribute('data-theme-choice') === 'dark'
                        ? 'Dark mode is on across the whole application.'
                        : 'Appearance updated on this workstation.');
            });
        }

        var swatchHost = byId('accentSwatches');
        if (swatchHost) {
            swatchHost.addEventListener('click', function (e) {
                var btn = e.target.closest ? e.target.closest('[data-accent-choice]') : null;
                if (!btn) return;
                if (theme) theme.set({ accent: btn.getAttribute('data-accent-choice') });
                renderAppearance();
            });
        }

        [['setCompactDensity', 'density', 'compact'], ['setReduceMotion', 'reduceMotion', true]]
            .forEach(function (pair) {
                var el = byId(pair[0]);
                if (!el) return;
                el.addEventListener('change', function () {
                    var patch = {};
                    if (pair[1] === 'density') patch.density = el.checked ? 'compact' : 'comfortable';
                    else patch.reduceMotion = el.checked;
                    if (theme) theme.set(patch);
                });
            });

        var sound = byId('setSoundEnabled');
        if (sound) {
            sound.addEventListener('change', function () {
                if (theme) theme.set({ soundEnabled: sound.checked });
            });
        }

        ui.initSelect('setSoundVolumeWrapper');
        var volHost = byId('setSoundVolumeWrapper');
        if (volHost) {
            volHost.addEventListener('click', function () {
                if (theme) theme.set({ soundVolume: ui.getSelectValue('setSoundVolumeWrapper') || 'medium' });
            });
        }

        var test = byId('btnTestSound');
        if (test) {
            test.addEventListener('click', function () {
                if (theme) {
                    theme.unlockAudio();
                    theme.playAlert('high');
                }
            });
        }
    }

    /* ==================================================================
        Form <-> state (alerts only now)
        ================================================================== */
    function toForm() {
        TOGGLES.forEach(function (pair) {
            var el = byId(pair[0]);
            if (el) el.checked = !!settings[pair[1]];
        });

        ui.setSelectValue('setToastDurationWrapper', settings.toastDuration,
            (Number(settings.toastDuration) / 1000) + ' seconds');

        renderPolicy();
        renderAppearance();
    }

    function fromForm() {
        TOGGLES.forEach(function (pair) {
            var el = byId(pair[0]);
            if (el) settings[pair[1]] = !!el.checked;
        });
        settings.toastDuration = ui.getSelectValue('setToastDurationWrapper') || '6000';
    }

    /* ==================================================================
        Calling policy
        ================================================================== */
    function renderPolicy() {
        var policy = store.queuePolicy();
        ui.qsa('#policyOptions [data-policy]').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-policy') === policy);
        });
        var warn = byId('policyWarning');
        if (warn) warn.hidden = policy !== store.POLICIES.FIFO;
    }

    function choosePolicy(value) {
        var current = store.queuePolicy();
        if (value === current) return;

        var toFifo = value === store.POLICIES.FIFO;

        ui.confirmAction({
            title: 'Change the calling policy',
            subtitle: store.policyLabel(current) + ' \u2192 ' + store.policyLabel(value),
            message: toFifo
                ? 'Arrival order ignores clinical priority across the whole department. Emergency and Urgent patients will wait behind earlier routine arrivals.'
                : 'Triage priority calls Emergency and Urgent patients ahead of Routine arrivals. This is the clinical default.',
            confirmLabel: 'Apply ' + store.policyLabel(value).toLowerCase(),
            tone: toFifo ? 'danger' : 'info',
            icon: toFifo ? 'warning' : 'shield-check'
        }, function () {
            store.setQueuePolicy(value);
            renderPolicy();
            if (toFifo) {
                window.MediTrackNotify.push(
                    'Calling Policy Changed',
                    'The queue now runs in strict arrival order. Clinical priority is not applied.',
                    'warning', 'Queue', 'high'
                );
            } else {
                window.MediTrackNotify.flash('Policy restored', 'Queue is calling by triage priority again.');
            }
        });
    }

    /* ==================================================================
        Storage usage
        ================================================================== */
    var TRACKED = [
        ['Patient records', store.KEYS.patients],
        ['Laboratory requests', store.KEYS.labRequests],
        ['Laboratory archive', store.KEYS.labArchive],
        ['Prescriptions', store.KEYS.prescriptions],
        ['Nursing tasks', store.KEYS.nurseTasks],
        ['Inventory', store.KEYS.inventory],
        ['Bills', store.KEYS.invoices],
        ['Staff directory', 'clinic_staff_members'],
        ['Notifications', store.KEYS.notifications]
    ];

    function renderUsage() {
        var host = byId('storageUsage');
        if (!host) return;

        var totalBytes = 0;

        var rows = TRACKED.map(function (pair) {
            var raw = store.rawGet(pair[1]) || '';
            var bytes = raw.length * 2;   /* UTF-16 code units in localStorage */
            totalBytes += bytes;

            var count = 0;
            try {
                var parsed = JSON.parse(raw || '[]');
                count = Array.isArray(parsed) ? parsed.length : 0;
            } catch (e) {}

            return '<div class="su-row">' +
                '<dt>' + esc(pair[0]) + '</dt>' +
                '<dd>' + count + (count === 1 ? ' record' : ' records') +
                    '<span class="su-size">' + formatBytes(bytes) + '</span>' +
                '</dd>' +
            '</div>';
        }).join('');

        host.innerHTML = rows +
            '<div class="su-row su-total">' +
                '<dt>Total</dt>' +
                '<dd><span class="su-size">' + formatBytes(totalBytes) + '</span></dd>' +
            '</div>';
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(2) + ' MB';
    }

    /* ==================================================================
        Backup / restore
        ================================================================== */
    function exportBackup() {
        var payload = {
            application: 'MediTrack Hospital ERP',
            exportedAt: new Date().toISOString(),
            schema: 1,
            settings: settings,
            appearance: currentAppearance(),
            queuePolicy: store.queuePolicy(),
            data: {}
        };

        TRACKED.forEach(function (pair) {
            try { payload.data[pair[1]] = JSON.parse(store.rawGet(pair[1]) || '[]'); }
            catch (e) { payload.data[pair[1]] = []; }
        });

        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var name = 'meditrack_backup_' + new Date().toISOString().slice(0, 10) + '.json';

        var link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

        window.MediTrackNotify.flash('Backup created', name + ' saved to your downloads.');
    }

    function importBackup(file) {
        var reader = new FileReader();

        reader.onload = function () {
            var payload;
            try {
                payload = JSON.parse(String(reader.result));
            } catch (e) {
                window.MediTrackNotify.push(
                    'Restore failed',
                    'That file is not valid JSON and was not applied.',
                    'error', 'System', 'high'
                );
                return;
            }

            if (!payload || !payload.data || typeof payload.data !== 'object') {
                window.MediTrackNotify.push(
                    'Restore failed',
                    'That file is not a MediTrack backup. Nothing was changed.',
                    'error', 'System', 'high'
                );
                return;
            }

            var recordCount = Object.keys(payload.data).reduce(function (n, k) {
                return n + (Array.isArray(payload.data[k]) ? payload.data[k].length : 0);
            }, 0);

            ui.confirmAction({
                title: 'Restore from backup',
                subtitle: payload.exportedAt ? 'Exported ' + store.formatDateTime(payload.exportedAt) : '',
                message: 'This replaces all current data on this workstation with ' + recordCount +
                         ' records from the backup. Current records are not recoverable afterwards.',
                confirmLabel: 'Replace all data',
                tone: 'danger',
                icon: 'warning'
            }, function () {
                Object.keys(payload.data).forEach(function (key) {
                    if (Array.isArray(payload.data[key])) store.write(key, payload.data[key]);
                });

                if (payload.settings) {
                    Object.keys(DEFAULTS).forEach(function (k) {
                        if (payload.settings[k] !== undefined) settings[k] = payload.settings[k];
                    });
                    writeSettings();
                }
                if (payload.appearance && theme) {
                    theme.set(payload.appearance);
                }
                if (payload.queuePolicy) store.setQueuePolicy(payload.queuePolicy);

                toForm();
                renderUsage();
                window.MediTrackNotify.push(
                    'Backup Restored',
                    recordCount + ' records were restored from the backup file.',
                    'success', 'System', 'normal'
                );
            });
        };

        reader.readAsText(file);
    }

    /* ==================================================================
        Demo data / erase
        ================================================================== */
    function loadDemoData() {
        ui.confirmAction({
            title: 'Load demonstration data',
            message: 'This replaces every patient record, order and result on this workstation with a sample data set. Export a backup first if the current records matter.',
            confirmLabel: 'Replace with demo data',
            tone: 'danger',
            icon: 'warning'
        }, function () {
            [store.KEYS.patients, store.KEYS.labRequests, store.KEYS.labArchive,
             store.KEYS.prescriptions, store.KEYS.nurseTasks].forEach(function (k) {
                store.remove(k);
            });

            store.seedIfEmpty();
            renderUsage();
            window.MediTrackNotify.push(
                'Demonstration Data Loaded',
                'Sample patients and orders are in place. Reload any open department screen.',
                'success', 'System', 'normal'
            );
        });
    }

    function eraseEverything() {
        ui.confirmAction({
            title: 'Erase all clinical data',
            message: 'This permanently removes every patient record, order, result and notification from this workstation. There is no server copy and no undo.',
            confirmLabel: 'Erase everything',
            cancelLabel: 'Keep my data',
            tone: 'danger',
            icon: 'trash'
        }, function () {
            TRACKED.forEach(function (pair) {
                store.remove(pair[1]);
            });
            renderUsage();
            window.MediTrackNotify.push(
                'All Data Erased',
                'This workstation now holds no clinical records.',
                'warning', 'System', 'high'
            );
        });
    }

    /* ==================================================================
        Init
        ================================================================== */
    function init() {
        /* Low-privilege roles never see the Data section: backups, restores,
           demo data and the erase-everything switch stay with admins and
           doctors so hospital records cannot be wiped from a ward terminal. */
        var fullScope = window.MediSession && window.MediSession.hasFullSettings();

        settings = readSettings();
        toForm();
        renderUsage();

        ui.initTabs({
            buttonSelector: '[data-settab]',
            panelSelector: '.settings-panel',
            attribute: 'data-settab'
        });

        var dataNav = document.querySelector('[data-settab="panelData"]');
        var dataPanel = byId('panelData');
        if (!fullScope) {
            /* Default landing tab is Appearance, so simply removing the Data
               entry from the nav and the DOM leaves a clean page behind. */
            if (dataNav) dataNav.parentNode.removeChild(dataNav);
            if (dataPanel) dataPanel.parentNode.removeChild(dataPanel);
        }

        ui.initSelect('setToastDurationWrapper');

        bindAppearance();

        var policyHost = byId('policyOptions');
        if (policyHost) {
            policyHost.addEventListener('click', function (e) {
                var btn = e.target.closest ? e.target.closest('[data-policy]') : null;
                if (btn) choosePolicy(btn.getAttribute('data-policy'));
            });
        }

        var saveBtn = byId('btnSaveAllSettings');
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                fromForm();
                writeSettings();
                window.MediTrackNotify.flash('Settings saved', 'Configuration updated on this workstation.');
            });
        }

        var resetBtn = byId('btnResetSettings');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                ui.confirmAction({
                    title: 'Restore default settings',
                    message: 'Alert routing, interface preferences and appearance return to their defaults. Clinical data is not affected.',
                    confirmLabel: 'Restore defaults',
                    tone: 'warning',
                    icon: 'reset'
                }, function () {
                    Object.keys(DEFAULTS).forEach(function (k) { settings[k] = DEFAULTS[k]; });
                    writeSettings();
                    if (theme) theme.set(theme.DEFAULTS);
                    toForm();
                    window.MediTrackNotify.flash('Defaults restored', 'Settings returned to their original values.');
                });
            });
        }

        var alertTest = byId('btnTestAlert');
        if (alertTest) {
            alertTest.addEventListener('click', function () {
                fromForm();
                writeSettings();
                window.MediTrackNotify.event('lab.result.ready', {
                    title: 'Test Alert',
                    message: 'This is what a released laboratory result looks like with the current routing.'
                });
            });
        }

        var exportBtn = byId('btnExportData');
        if (exportBtn) exportBtn.addEventListener('click', exportBackup);

        var importBtn = byId('btnImportData');
        var fileInput = byId('importFileInput');
        if (importBtn && fileInput) {
            importBtn.addEventListener('click', function () { fileInput.click(); });
            fileInput.addEventListener('change', function () {
                if (fileInput.files && fileInput.files[0]) importBackup(fileInput.files[0]);
                fileInput.value = '';
            });
        }

        var demoBtn = byId('btnResetDemoData');
        if (demoBtn) demoBtn.addEventListener('click', loadDemoData);

        var eraseBtn = byId('btnEraseData');
        if (eraseBtn) eraseBtn.addEventListener('click', eraseEverything);

        store.onPatientsChanged(renderUsage);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
