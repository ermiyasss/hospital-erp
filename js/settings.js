/**
 * MediTrack Hospital ERP - Site Settings Logic
 * Manages facility branding, theme choices, clinical queue defaults,
 * notification preferences, database backup exports, and demo resets.
 * (Staff member management omitted).
 */

(function() {
    'use strict';

    var STORAGE_SETTINGS_KEY = 'clinic_system_settings';
    var STORAGE_KEY_PATIENTS = 'clinic_patients_data';
    var STORAGE_KEY_LAB = 'clinic_lab_requests';
    var STORAGE_KEY_PRESCRIPTIONS = 'clinic_prescriptions_data';
    var STORAGE_NOTIFS_KEY = 'clinic_notifications_log';

    var defaultSettings = {
        hospName: 'MediTrack Central Hospital',
        facilityCode: 'MTRK-HOSP-001',
        emergencyPhone: '0911-00-EMERGENCY',
        supportEmail: 'admin@meditrack.health',
        address: '450 Medical Heights Parkway, Suite 100, West Wing',
        timezone: 'UTC+3',
        dateFormat: 'MMM D, YYYY',
        deptInternalMed: true,
        deptLab: true,
        deptPharmacy: true,
        deptEmergency: true,
        accentTheme: '#B91C1C',
        animations: true,
        compactDensity: false,
        showBadges: true,
        defaultQueueOrder: 'urgent_first',
        autoAdvanceQueue: true,
        statAlertSound: true,
        bpSystolicHigh: 140,
        bpDiastolicHigh: 90,
        hrHigh: 100,
        toastDuration: '7000',
        notifLabReady: true,
        notifNewPatient: true,
        notifDoctorOrders: true,
        notifConsultFinish: true,
        autoLogoutTime: '1800',
        auditLogging: true,
        requirePassDischarge: false
    };

    var currentSettings = Object.assign({}, defaultSettings);

    function loadSettings() {
        try {
            var raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
            if (raw) {
                currentSettings = Object.assign({}, defaultSettings, JSON.parse(raw));
            }
        } catch (e) {
            currentSettings = Object.assign({}, defaultSettings);
        }
        applySettingsToUI();
        applyThemeAccent(currentSettings.accentTheme);
    }

    function saveSettings() {
        gatherSettingsFromUI();
        localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(currentSettings));
        applyThemeAccent(currentSettings.accentTheme);

        if (window.MediTrackNotify) {
            window.MediTrackNotify.push(
                'Settings Saved',
                'Hospital site configuration has been updated successfully.',
                'success',
                'Settings'
            );
        }
    }

    function applyThemeAccent(color) {
        if (!color) color = '#B91C1C';
        var darkColor = color === '#B91C1C' ? '#991B1B' : (color === '#0284C7' ? '#0369A1' : (color === '#059669' ? '#047857' : '#6D28D9'));
        var lightColor = color === '#B91C1C' ? '#FEE2E2' : (color === '#0284C7' ? '#E0F2FE' : (color === '#059669' ? '#DCFCE7' : '#EDE9FE'));

        document.documentElement.style.setProperty('--primary-red', color);
        document.documentElement.style.setProperty('--primary-dark', darkColor);
        document.documentElement.style.setProperty('--primary-light', lightColor);

        // Also pass theme change to parent window if inside iframe
        if (window.parent && window.parent !== window) {
            try {
                window.parent.document.documentElement.style.setProperty('--primary-red', color);
                window.parent.document.documentElement.style.setProperty('--primary-dark', darkColor);
                window.parent.document.documentElement.style.setProperty('--primary-light', lightColor);
            } catch (e) {}
        }
    }

    function applySettingsToUI() {
        setInputValue('setHospName', currentSettings.hospName);
        setInputValue('setFacilityCode', currentSettings.facilityCode);
        setInputValue('setEmergencyPhone', currentSettings.emergencyPhone);
        setInputValue('setSupportEmail', currentSettings.supportEmail);
        setInputValue('setAddress', currentSettings.address);
        setInputValue('setBpSystolicHigh', currentSettings.bpSystolicHigh);
        setInputValue('setBpDiastolicHigh', currentSettings.bpDiastolicHigh);
        setInputValue('setHrHigh', currentSettings.hrHigh);

        setCheckbox('deptInternalMed', currentSettings.deptInternalMed);
        setCheckbox('deptLab', currentSettings.deptLab);
        setCheckbox('deptPharmacy', currentSettings.deptPharmacy);
        setCheckbox('deptEmergency', currentSettings.deptEmergency);
        setCheckbox('setAnimations', currentSettings.animations);
        setCheckbox('setCompactDensity', currentSettings.compactDensity);
        setCheckbox('setShowBadges', currentSettings.showBadges);
        setCheckbox('setAutoAdvanceQueue', currentSettings.autoAdvanceQueue);
        setCheckbox('setStatAlertSound', currentSettings.statAlertSound);
        setCheckbox('notifLabReady', currentSettings.notifLabReady);
        setCheckbox('notifNewPatient', currentSettings.notifNewPatient);
        setCheckbox('notifDoctorOrders', currentSettings.notifDoctorOrders);
        setCheckbox('notifConsultFinish', currentSettings.notifConsultFinish);
        setCheckbox('setAuditLogging', currentSettings.auditLogging);
        setCheckbox('setRequirePassDischarge', currentSettings.requirePassDischarge);

        // Custom selects
        setCustomSelectValue('setTimezoneWrapper', currentSettings.timezone);
        setCustomSelectValue('setDateFormatWrapper', currentSettings.dateFormat);
        setCustomSelectValue('setDefaultQueueOrderWrapper', currentSettings.defaultQueueOrder);
        setCustomSelectValue('setToastDurationWrapper', currentSettings.toastDuration);
        setCustomSelectValue('setAutoLogoutWrapper', currentSettings.autoLogoutTime);

        // Radio theme choice
        document.querySelectorAll('.theme-choice').forEach(function(el) {
            var val = el.getAttribute('data-color');
            var radio = el.querySelector('input[type="radio"]');
            if (val === currentSettings.accentTheme) {
                el.classList.add('active');
                if (radio) radio.checked = true;
            } else {
                el.classList.remove('active');
                if (radio) radio.checked = false;
            }
        });
    }

    function gatherSettingsFromUI() {
        currentSettings.hospName = getInputValue('setHospName');
        currentSettings.facilityCode = getInputValue('setFacilityCode');
        currentSettings.emergencyPhone = getInputValue('setEmergencyPhone');
        currentSettings.supportEmail = getInputValue('setSupportEmail');
        currentSettings.address = getInputValue('setAddress');
        currentSettings.bpSystolicHigh = parseInt(getInputValue('setBpSystolicHigh'), 10) || 140;
        currentSettings.bpDiastolicHigh = parseInt(getInputValue('setBpDiastolicHigh'), 10) || 90;
        currentSettings.hrHigh = parseInt(getInputValue('setHrHigh'), 10) || 100;

        currentSettings.deptInternalMed = getCheckbox('deptInternalMed');
        currentSettings.deptLab = getCheckbox('deptLab');
        currentSettings.deptPharmacy = getCheckbox('deptPharmacy');
        currentSettings.deptEmergency = getCheckbox('deptEmergency');
        currentSettings.animations = getCheckbox('setAnimations');
        currentSettings.compactDensity = getCheckbox('setCompactDensity');
        currentSettings.showBadges = getCheckbox('setShowBadges');
        currentSettings.setAutoAdvanceQueue = getCheckbox('setAutoAdvanceQueue');
        currentSettings.setStatAlertSound = getCheckbox('setStatAlertSound');
        currentSettings.notifLabReady = getCheckbox('notifLabReady');
        currentSettings.notifNewPatient = getCheckbox('notifNewPatient');
        currentSettings.notifDoctorOrders = getCheckbox('notifDoctorOrders');
        currentSettings.notifConsultFinish = getCheckbox('notifConsultFinish');
        currentSettings.auditLogging = getCheckbox('setAuditLogging');
        currentSettings.requirePassDischarge = getCheckbox('setRequirePassDischarge');

        currentSettings.timezone = getCustomSelectValue('setTimezoneWrapper') || 'UTC+3';
        currentSettings.dateFormat = getCustomSelectValue('setDateFormatWrapper') || 'MMM D, YYYY';
        currentSettings.defaultQueueOrder = getCustomSelectValue('setDefaultQueueOrderWrapper') || 'urgent_first';
        currentSettings.toastDuration = getCustomSelectValue('setToastDurationWrapper') || '7000';
        currentSettings.autoLogoutTime = getCustomSelectValue('setAutoLogoutWrapper') || '1800';

        var activeThemeEl = document.querySelector('.theme-choice.active');
        if (activeThemeEl) {
            currentSettings.accentTheme = activeThemeEl.getAttribute('data-color') || '#B91C1C';
        }
    }

    function setInputValue(id, val) {
        var el = document.getElementById(id);
        if (el && val !== undefined) el.value = val;
    }
    function getInputValue(id) {
        var el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }
    function setCheckbox(id, checked) {
        var el = document.getElementById(id);
        if (el) el.checked = !!checked;
    }
    function getCheckbox(id) {
        var el = document.getElementById(id);
        return el ? el.checked : false;
    }

    function setCustomSelectValue(wrapperId, val) {
        var wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;
        var toggle = wrapper.querySelector('.cs-toggle');
        var opt = wrapper.querySelector('.cs-option[data-value="' + val + '"]');
        if (opt && toggle) {
            wrapper.querySelectorAll('.cs-option').forEach(function(o) { o.classList.remove('selected'); });
            opt.classList.add('selected');
            toggle.setAttribute('data-value', val);
            var textSpan = toggle.querySelector('.cs-text');
            if (textSpan) textSpan.textContent = opt.textContent;
        }
    }

    function getCustomSelectValue(wrapperId) {
        var wrapper = document.getElementById(wrapperId);
        if (!wrapper) return '';
        var toggle = wrapper.querySelector('.cs-toggle');
        return toggle ? toggle.getAttribute('data-value') : '';
    }

    /* --------------------------------------------------------------------------
       Custom Select Initializer
       -------------------------------------------------------------------------- */
    function initCustomSelect(wrapperId, callback) {
        var wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;
        var toggle = wrapper.querySelector('.cs-toggle');
        var menu = wrapper.querySelector('.cs-menu');
        if (!toggle || !menu) return;

        toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            document.querySelectorAll('.custom-select.active').forEach(function(el) {
                if (el !== wrapper) el.classList.remove('active');
            });
            wrapper.classList.toggle('active');
        });

        menu.querySelectorAll('.cs-option').forEach(function(opt) {
            opt.addEventListener('click', function() {
                var val = this.getAttribute('data-value');
                var text = this.textContent;
                var textSpan = toggle.querySelector('.cs-text');
                if (textSpan) textSpan.textContent = text;
                toggle.setAttribute('data-value', val);

                menu.querySelectorAll('.cs-option').forEach(function(o) { o.classList.remove('selected'); });
                this.classList.add('selected');

                wrapper.classList.remove('active');
                if (callback) callback(val);
            });
        });
    }

    /* --------------------------------------------------------------------------
       Database Export & Reset Demo
       -------------------------------------------------------------------------- */
    function exportClinicDatabase() {
        var exportObj = {
            exportDate: new Date().toISOString(),
            systemVersion: 'MediTrack ERP v2.4',
            settings: currentSettings,
            patients: JSON.parse(localStorage.getItem(STORAGE_KEY_PATIENTS) || '[]'),
            labRequests: JSON.parse(localStorage.getItem(STORAGE_KEY_LAB) || '[]'),
            prescriptions: JSON.parse(localStorage.getItem(STORAGE_KEY_PRESCRIPTIONS) || '[]'),
            notifications: JSON.parse(localStorage.getItem(STORAGE_NOTIFS_KEY) || '[]')
        };

        var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
        var downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", "meditrack_clinic_backup_" + new Date().toISOString().slice(0,10) + ".json");
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();

        if (window.MediTrackNotify) {
            window.MediTrackNotify.push(
                'Database Exported',
                'Full clinical database backup JSON generated successfully.',
                'success',
                'Settings'
            );
        }
    }

    function resetDemoData() {
        if (!confirm('Are you sure you want to reset all demo patient records, lab orders, and test data? This will restore factory demonstration data.')) {
            return;
        }

        var samplePatients = [
            {
                id: 1,
                trackingId: 'TRK-10293847',
                name: 'John Doe',
                age: 34,
                phone: '0912 345 678',
                urgency: 'Urgent',
                status: 'In Treatment',
                description: 'Severe acute chest pain radiating to left shoulder and arm. Undergoing cardiac evaluation.',
                registered: new Date(Date.now() - 45 * 60000).toISOString(),
                bp: '138/88',
                hr: 86,
                height: 175,
                weight: 74,
                clinicalNotes: [
                    { id: 101, diagnosis: 'Acute Coronary Syndrome Rule-Out', note: 'Patient presented with 2-hour onset retrosternal chest pain. S1/S2 heard, no murmurs. ECG ordered.', doctor: 'Dr. Sarah Chen', time: new Date(Date.now() - 30 * 60000).toISOString() }
                ],
                labOrders: [
                    { id: 1001, test: 'Cardiac Enzymes (Troponin I) & 12-Lead ECG', priority: 'Urgent', note: 'Expedite STAT.', doctor: 'Dr. Sarah Chen', status: 'In Progress', results: 'Troponin I: 0.04 ng/mL. Normal sinus rhythm.', time: new Date(Date.now() - 25 * 60000).toISOString() }
                ],
                nurseOrders: [
                    { id: 201, task: 'Continuous ECG Monitoring & Supplemental O2', note: 'Maintain SpO2 > 95%.', doctor: 'Dr. Sarah Chen', time: new Date(Date.now() - 20 * 60000).toISOString() }
                ],
                prescriptions: [
                    { id: 301, medication: 'Aspirin Dispersible', dosage: '300mg', frequency: 'Stat', route: 'Oral', duration: 'Single Dose', instructions: 'Chew immediately.', doctor: 'Dr. Sarah Chen', time: new Date(Date.now() - 15 * 60000).toISOString() }
                ]
            },
            {
                id: 2,
                trackingId: 'TRK-77123901',
                name: 'Alice Smith',
                age: 28,
                phone: '0987 654 321',
                urgency: 'Non-Urgent',
                status: 'Pending',
                description: 'Persistent dry cough, mild intermittent fever (38.1°C), and sore throat for 3 days.',
                registered: new Date(Date.now() - 30 * 60000).toISOString(),
                bp: '118/76',
                hr: 74,
                height: 164,
                weight: 58,
                clinicalNotes: [],
                labOrders: [
                    { id: 1002, test: 'Complete Blood Count (CBC) & Sputum Analysis', priority: 'Routine', note: 'Check differential WBC.', doctor: 'Dr. Sarah Chen', status: 'Requested', results: '', time: new Date(Date.now() - 10 * 60000).toISOString() }
                ],
                nurseOrders: [],
                prescriptions: []
            },
            {
                id: 3,
                trackingId: 'TRK-33418721',
                name: 'Bob Johnson',
                age: 45,
                phone: '0911 222 333',
                urgency: 'Non-Urgent',
                status: 'Finished',
                description: 'Annual wellness checkup and routine biochemical blood screening.',
                registered: new Date(Date.now() - 120 * 60000).toISOString(),
                bp: '122/80',
                hr: 70,
                height: 180,
                weight: 82,
                clinicalNotes: [
                    { id: 102, diagnosis: 'Normal Annual Physical Exam', note: 'Cardiovascular and respiratory systems unremarkable. Lifestyle recommendations given.', doctor: 'Dr. Sarah Chen', time: new Date(Date.now() - 90 * 60000).toISOString() }
                ],
                labOrders: [
                    { id: 1003, test: 'Fasting Lipid Profile & Blood Glucose', priority: 'Routine', note: 'Check baseline.', doctor: 'Dr. Sarah Chen', status: 'Completed', results: 'Total Cholesterol: 185 mg/dL, Fasting Glucose: 92 mg/dL.', time: new Date(Date.now() - 100 * 60000).toISOString() }
                ],
                nurseOrders: [],
                prescriptions: []
            },
            {
                id: 4,
                trackingId: 'TRK-99014523',
                name: 'Charlie Brown',
                age: 52,
                phone: '0922 444 888',
                urgency: 'Urgent',
                status: 'Pending',
                description: 'Suspected right forearm fracture after fall from ladder; visible swelling and tenderness.',
                registered: new Date(Date.now() - 15 * 60000).toISOString(),
                bp: '130/84',
                hr: 88,
                height: 172,
                weight: 78,
                clinicalNotes: [],
                labOrders: [],
                nurseOrders: [],
                prescriptions: []
            }
        ];

        var sampleLabs = [
            {
                id: 1001,
                patientId: 1,
                trackingId: 'TRK-10293847',
                patientName: 'John Doe',
                age: 34,
                phone: '0912 345 678',
                test: 'Cardiac Enzymes (Troponin I) & 12-Lead ECG',
                priority: 'Urgent',
                note: 'Severe chest pain radiating to shoulder. Please expedite STAT.',
                doctor: 'Dr. Sarah Chen',
                time: new Date(Date.now() - 25 * 60000).toISOString(),
                status: 'In Progress',
                results: 'Troponin I: 0.04 ng/mL. Normal sinus rhythm.'
            },
            {
                id: 1002,
                patientId: 2,
                trackingId: 'TRK-77123901',
                patientName: 'Alice Smith',
                age: 28,
                phone: '0987 654 321',
                test: 'Complete Blood Count (CBC) & Sputum Analysis',
                priority: 'Routine',
                note: 'Check differential WBC.',
                doctor: 'Dr. Sarah Chen',
                time: new Date(Date.now() - 10 * 60000).toISOString(),
                status: 'Requested',
                results: ''
            },
            {
                id: 1003,
                patientId: 3,
                trackingId: 'TRK-33418721',
                patientName: 'Bob Johnson',
                age: 45,
                phone: '0911 222 333',
                test: 'Fasting Lipid Profile & Blood Glucose',
                priority: 'Routine',
                note: 'Annual wellness checkup screen.',
                doctor: 'Dr. Sarah Chen',
                time: new Date(Date.now() - 100 * 60000).toISOString(),
                status: 'Completed',
                results: 'Total Cholesterol: 185 mg/dL, Fasting Glucose: 92 mg/dL.'
            }
        ];

        localStorage.setItem(STORAGE_KEY_PATIENTS, JSON.stringify(samplePatients));
        localStorage.setItem(STORAGE_KEY_LAB, JSON.stringify(sampleLabs));
        localStorage.setItem(STORAGE_KEY_PRESCRIPTIONS, JSON.stringify([]));

        if (window.MediTrackNotify) {
            window.MediTrackNotify.push(
                'Demo Data Restored',
                'Sample patient queue and laboratory test records have been reset.',
                'success',
                'Settings'
            );
        }
    }

    /* --------------------------------------------------------------------------
       Initialization
       -------------------------------------------------------------------------- */
    function init() {
        loadSettings();

        // Tab Navigation
        var tabItems = document.querySelectorAll('.settings-tab-item');
        var panels = document.querySelectorAll('.settings-panel');

        tabItems.forEach(function(item) {
            item.addEventListener('click', function() {
                var targetTab = this.getAttribute('data-tab');
                tabItems.forEach(function(t) { t.classList.remove('active'); });
                panels.forEach(function(p) { p.classList.remove('active'); });

                this.classList.add('active');
                var panel = document.getElementById(targetTab);
                if (panel) panel.classList.add('active');
            });
        });

        // Theme Pickers
        var themeChoices = document.querySelectorAll('.theme-choice');
        themeChoices.forEach(function(choice) {
            choice.addEventListener('click', function() {
                themeChoices.forEach(function(c) { c.classList.remove('active'); });
                this.classList.add('active');
                var color = this.getAttribute('data-color');
                applyThemeAccent(color);
            });
        });

        // Initialize Custom Selects
        initCustomSelect('setTimezoneWrapper');
        initCustomSelect('setDateFormatWrapper');
        initCustomSelect('setDefaultQueueOrderWrapper');
        initCustomSelect('setToastDurationWrapper');
        initCustomSelect('setAutoLogoutWrapper');

        document.addEventListener('click', function() {
            document.querySelectorAll('.custom-select.active').forEach(function(el) {
                el.classList.remove('active');
            });
        });

        // Actions
        var btnSave = document.getElementById('btnSaveAllSettings');
        var btnReset = document.getElementById('btnResetSettings');
        var btnExport = document.getElementById('btnExportData');
        var btnResetDemo = document.getElementById('btnResetDemoData');

        if (btnSave) btnSave.addEventListener('click', saveSettings);
        if (btnReset) {
            btnReset.addEventListener('click', function() {
                if (confirm('Reset settings to factory defaults?')) {
                    currentSettings = Object.assign({}, defaultSettings);
                    applySettingsToUI();
                    saveSettings();
                }
            });
        }
        if (btnExport) btnExport.addEventListener('click', exportClinicDatabase);
        if (btnResetDemo) btnResetDemo.addEventListener('click', resetDemoData);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
