(function() {
    'use strict';

    var STORAGE_KEY = 'clinic_patients_data';
    var patients = [];
    var searchTerm = '';
    var urgencyFilter = '';
    var sortValue = 'default';
    var pendingDeleteId = null;
    var viewingPatient = null;

    function toggleBlur(state) {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ action: 'toggleBlur', state: state }, '*');
        }
    }

    function generateTrackingId() {
        return 'TRK-' + Math.floor(10000000 + Math.random() * 90000000);
    }

    function loadFromStorage() {
        var data = localStorage.getItem(STORAGE_KEY);
        if (!data) {
            patients = [
                { id: 1, trackingId: generateTrackingId(), name: 'John Doe', age: 34, phone: '0912 345 678', weight: 70, height: 175, bp: '135/88', hr: 82, urgency: 'Urgent', status: 'In Treatment', description: 'Severe chest pain, undergoing diagnostic tests.', registered: new Date().toISOString(), clinicalNotes: [], labOrders: [], nurseOrders: [] },
                { id: 2, trackingId: generateTrackingId(), name: 'Alice Smith', age: 28, phone: '0987 654 321', weight: 60, height: 160, bp: '118/76', hr: 74, urgency: 'Non-Urgent', status: 'Pending', description: 'Persistent cough and low grade fever for 3 days.', registered: new Date().toISOString(), clinicalNotes: [], labOrders: [], nurseOrders: [] },
                { id: 3, trackingId: generateTrackingId(), name: 'Bob Johnson', age: 45, phone: '0911 222 333', weight: 85, height: 180, bp: '122/80', hr: 68, urgency: 'Non-Urgent', status: 'Finished', description: 'Routine annual checkup completed.', registered: '2023-10-20T11:15:00Z', clinicalNotes: [], labOrders: [], nurseOrders: [] }
            ];
            saveToStorage();
        } else {
            try {
                patients = JSON.parse(data);
                patients.forEach(function(p) {
                    if (p.urgency === 'High') p.urgency = 'Urgent';
                    else if (p.urgency === 'Medium' || p.urgency === 'Low') p.urgency = 'Non-Urgent';
                    if (!p.bp) p.bp = '120/80';
                    if (!p.hr) p.hr = 72;
                    if (!p.clinicalNotes) p.clinicalNotes = [];
                    if (!p.labOrders) p.labOrders = [];
                    if (!p.nurseOrders) p.nurseOrders = [];
                });
            } catch (e) { patients = []; }
        }
    }

    function saveToStorage() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(patients));
    }

    function formatPhone(value) {
        var digits = value.replace(/\D/g, '');
        if (digits.startsWith('251')) digits = '0' + digits.substring(3);
        if (digits.startsWith('0')) {
            var formatted = digits.substring(0, 4);
            if (digits.length > 4) formatted += ' ' + digits.substring(4, 7);
            if (digits.length > 7) formatted += ' ' + digits.substring(7, 10);
            return formatted;
        }
        return digits;
    }

    function isValidPhone(phone) {
        if (!phone) return false;
        var digits = phone.replace(/\D/g, '');
        if (digits.startsWith('251')) digits = '0' + digits.substring(3);
        return /^0(9|7)\d{8}$/.test(digits);
    }

    // Filter out Finished patients (they go to Storage)
    function getActivePatients() {
        return patients.filter(function(p) { return p.status !== 'Finished'; });
    }

    function getFilteredSortedPatients() {
        var active = getActivePatients();
        var filtered = active.filter(function(p) {
            var matchesSearch = true;
            if (searchTerm.trim()) {
                var term = searchTerm.toLowerCase().trim();
                matchesSearch = p.name.toLowerCase().includes(term) ||
                                p.trackingId.toLowerCase().includes(term) ||
                                (p.phone && p.phone.includes(term));
            }
            var matchesUrgency = (urgencyFilter === '') || (p.urgency === urgencyFilter);
            return matchesSearch && matchesUrgency;
        });

        if (sortValue === 'age_asc') filtered.sort(function(a, b) { return a.age - b.age; });
        else if (sortValue === 'age_desc') filtered.sort(function(a, b) { return b.age - a.age; });
        else if (sortValue === 'alpha_asc') filtered.sort(function(a, b) { return a.name.localeCompare(b.name); });
        else if (sortValue === 'alpha_desc') filtered.sort(function(a, b) { return b.name.localeCompare(a.name); });
        else if (sortValue === 'reg_desc') filtered.sort(function(a, b) { return new Date(b.registered) - new Date(a.registered); });
        else if (sortValue === 'reg_asc') filtered.sort(function(a, b) { return new Date(a.registered) - new Date(b.registered); });

        return filtered;
    }

    function formatDate(isoString) {
        if (!isoString) return '-';
        var date = new Date(isoString);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatDateTime(isoString) {
        if (!isoString) return '-';
        var date = new Date(isoString);
        var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        var h = date.getHours(); var m = String(date.getMinutes()).padStart(2, '0');
        var ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
        return dateStr + ' at ' + h + ':' + m + ' ' + ampm;
    }

    function renderCards() {
        var grid = document.getElementById('patientsCardGrid');
        var noPatientsDiv = document.getElementById('noPatients');
        if (!grid) return;

        var data = getFilteredSortedPatients();

        if (data.length === 0) {
            grid.innerHTML = '';
            if (noPatientsDiv) noPatientsDiv.style.display = 'block';
            return;
        }

        if (noPatientsDiv) noPatientsDiv.style.display = 'none';

        grid.innerHTML = data.map(function(p) {
            var urgencyClass = (p.urgency === 'Urgent') ? 'urgency-urgent' : 'urgency-nonurgent';
            var statusClass = (p.status === 'In Treatment') ? 'status-treatment' : 'status-pending';
            var initials = p.name.split(' ').map(function(n) { return n[0]; }).join('').toUpperCase().substring(0, 2);

            return '<div class="patient-card" data-id="' + p.id + '">' +
                '<div class="pcard-top">' +
                    '<div class="pcard-avatar">' + initials + '</div>' +
                    '<div class="pcard-main">' +
                        '<h4 class="pcard-name">' + p.name + '</h4>' +
                        '<span class="pcard-tid">' + p.trackingId + '</span>' +
                    '</div>' +
                    '<span class="badge ' + urgencyClass + '">' + p.urgency + '</span>' +
                '</div>' +
                '<div class="pcard-meta">' +
                    '<div class="pcard-meta-item"><span class="meta-label">Age</span><strong>' + p.age + '</strong></div>' +
                    '<div class="pcard-meta-item"><span class="meta-label">Phone</span><strong>' + (p.phone || '-') + '</strong></div>' +
                    '<div class="pcard-meta-item"><span class="meta-label">BP</span><strong>' + (p.bp || '-') + '</strong></div>' +
                    '<div class="pcard-meta-item"><span class="meta-label">HR</span><strong>' + (p.hr || '-') + ' bpm</strong></div>' +
                '</div>' +
                '<div class="pcard-bottom">' +
                    '<span class="badge ' + statusClass + '">' + p.status + '</span>' +
                    '<span class="pcard-date">' + formatDate(p.registered) + '</span>' +
                '</div>' +
            '</div>';
        }).join('');

        // Click handler on cards
        grid.querySelectorAll('.patient-card').forEach(function(card) {
            card.addEventListener('click', function() {
                var pId = parseInt(this.getAttribute('data-id'), 10);
                openDetailModal(pId);
            });
        });
    }

    /* ---------- Detail Modal ---------- */
    function openDetailModal(patientId) {
        var p = patients.find(function(x) { return x.id === patientId; });
        if (!p) return;
        viewingPatient = p;

        document.getElementById('detailModalTitle').textContent = p.name + ' — Patient Details';

        var bmi = '-';
        if (p.weight && p.height && p.height > 0) {
            var hm = p.height / 100;
            var bmiVal = (p.weight / (hm * hm)).toFixed(1);
            var cat = 'Normal';
            if (bmiVal < 18.5) cat = 'Underweight';
            else if (bmiVal >= 25 && bmiVal < 30) cat = 'Overweight';
            else if (bmiVal >= 30) cat = 'Obese';
            bmi = bmiVal + ' (' + cat + ')';
        }

        var urgencyClass = (p.urgency === 'Urgent') ? 'urgency-urgent' : 'urgency-nonurgent';
        var statusClass = (p.status === 'Finished') ? 'status-finished' : ((p.status === 'In Treatment') ? 'status-treatment' : 'status-pending');

        document.getElementById('detailModalBody').innerHTML =
            '<div class="detail-grid">' +
                '<div class="detail-row"><span class="dlabel">Tracking ID</span><span class="dval"><span class="tracking-id">' + p.trackingId + '</span></span></div>' +
                '<div class="detail-row"><span class="dlabel">Full Name</span><span class="dval"><strong>' + p.name + '</strong></span></div>' +
                '<div class="detail-row"><span class="dlabel">Age</span><span class="dval">' + p.age + ' years</span></div>' +
                '<div class="detail-row"><span class="dlabel">Phone</span><span class="dval">' + (p.phone || '-') + '</span></div>' +
                '<div class="detail-row"><span class="dlabel">Urgency</span><span class="dval"><span class="badge ' + urgencyClass + '">' + p.urgency + '</span></span></div>' +
                '<div class="detail-row"><span class="dlabel">Status</span><span class="dval"><span class="badge ' + statusClass + '">' + p.status + '</span></span></div>' +
                '<div class="detail-row"><span class="dlabel">Blood Pressure</span><span class="dval">' + (p.bp || '-') + ' mmHg</span></div>' +
                '<div class="detail-row"><span class="dlabel">Heart Rate</span><span class="dval">' + (p.hr || '-') + ' bpm</span></div>' +
                '<div class="detail-row"><span class="dlabel">Weight</span><span class="dval">' + (p.weight || '-') + ' kg</span></div>' +
                '<div class="detail-row"><span class="dlabel">Height</span><span class="dval">' + (p.height || '-') + ' cm</span></div>' +
                '<div class="detail-row"><span class="dlabel">BMI</span><span class="dval">' + bmi + '</span></div>' +
                '<div class="detail-row"><span class="dlabel">Registered</span><span class="dval">' + formatDateTime(p.registered) + '</span></div>' +
            '</div>' +
            '<div class="detail-desc-section">' +
                '<span class="dlabel">Chief Complaint / Description</span>' +
                '<p class="detail-desc">' + (p.description || 'No description provided.') + '</p>' +
            '</div>';

        document.getElementById('detailModal').classList.add('active');
        toggleBlur(true);
    }

    function closeDetailModal() {
        document.getElementById('detailModal').classList.remove('active');
        toggleBlur(false);
        viewingPatient = null;
    }

    /* ---------- Custom Select ---------- */
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
                toggle.querySelector('.cs-text').textContent = this.textContent;
                toggle.setAttribute('data-value', val);
                menu.querySelectorAll('.cs-option').forEach(function(o) { o.classList.remove('selected'); });
                this.classList.add('selected');
                wrapper.classList.remove('active');
                if (callback) callback(val);
            });
        });
    }

    document.addEventListener('click', function() {
        document.querySelectorAll('.custom-select.active').forEach(function(el) { el.classList.remove('active'); });
    });

    /* ---------- Add Patient Modal ---------- */
    function openModal() { document.getElementById('patientModal').classList.add('active'); toggleBlur(true); }
    function closeModal() { document.getElementById('patientModal').classList.remove('active'); toggleBlur(false); clearForm(); }

    function clearForm() {
        ['inputName','inputAge','inputPhone','inputWeight','inputHeight','inputBP','inputHR','inputDesc'].forEach(function(id) {
            var el = document.getElementById(id); if (el) el.value = '';
        });
        var urgWrap = document.getElementById('inputUrgencyWrapper');
        if (urgWrap) { urgWrap.querySelector('.cs-text').textContent = 'Non-Urgent'; urgWrap.querySelector('.cs-toggle').setAttribute('data-value', 'Non-Urgent'); }
        var statWrap = document.getElementById('inputStatusWrapper');
        if (statWrap) { statWrap.querySelector('.cs-text').textContent = 'Pending'; statWrap.querySelector('.cs-toggle').setAttribute('data-value', 'Pending'); }
        ['errName','errAge','errPhone','errDesc'].forEach(function(id) {
            var el = document.getElementById(id); if (el) el.classList.remove('visible');
        });
        ['inputName','inputAge','inputPhone','inputDesc'].forEach(function(id) {
            var el = document.getElementById(id); if (el) el.classList.remove('input-error');
        });
    }

    function showError(errId, inputId, msg) {
        var el = document.getElementById(errId); var input = document.getElementById(inputId);
        if (el) { el.textContent = msg; el.classList.add('visible'); }
        if (input) input.classList.add('input-error');
    }

    function hideError(errId, inputId) {
        var el = document.getElementById(errId); var input = document.getElementById(inputId);
        if (el) el.classList.remove('visible');
        if (input) input.classList.remove('input-error');
    }

    function validateForm() {
        var isValid = true;
        var name = document.getElementById('inputName').value.trim();
        var age = document.getElementById('inputAge').value.trim();
        var desc = document.getElementById('inputDesc').value.trim();
        var phone = document.getElementById('inputPhone').value.trim();

        if (!name) { showError('errName', 'inputName', 'Patient full name is required'); isValid = false; } else hideError('errName', 'inputName');
        if (!age || isNaN(age) || parseInt(age) <= 0) { showError('errAge', 'inputAge', 'Valid age is required'); isValid = false; } else hideError('errAge', 'inputAge');
        if (!desc) { showError('errDesc', 'inputDesc', 'Chief complaint / description is required'); isValid = false; } else hideError('errDesc', 'inputDesc');
        if (!phone || !isValidPhone(phone)) { showError('errPhone', 'inputPhone', 'Valid Ethiopian phone number is required (09... or 07...)'); isValid = false; } else hideError('errPhone', 'inputPhone');

        return isValid;
    }

    /* ---------- Delete ---------- */
    function openConfirmModal(id) {
        pendingDeleteId = id;
        var patient = patients.find(function(p) { return p.id === id; });
        if (patient) document.getElementById('confirmText').textContent = 'Are you sure you want to delete patient record ' + patient.name + ' (' + patient.trackingId + ')?';
        document.getElementById('confirmModal').classList.add('active');
        toggleBlur(true);
    }

    function closeConfirmModal() {
        pendingDeleteId = null;
        document.getElementById('confirmModal').classList.remove('active');
        toggleBlur(false);
    }

    function confirmDelete() {
        if (pendingDeleteId !== null) {
            patients = patients.filter(function(p) { return p.id !== pendingDeleteId; });
            saveToStorage();
            renderCards();
            closeConfirmModal();
            closeDetailModal();
        }
    }

    function savePatient() {
        if (!validateForm()) return;

        var phone = document.getElementById('inputPhone').value.trim();
        var bp = document.getElementById('inputBP').value.trim() || '120/80';
        var hr = document.getElementById('inputHR').value.trim() || '72';
        var urgency = document.getElementById('inputUrgencyWrapper').querySelector('.cs-toggle').getAttribute('data-value') || 'Non-Urgent';
        var status = document.getElementById('inputStatusWrapper').querySelector('.cs-toggle').getAttribute('data-value') || 'Pending';
        var newId = patients.length > 0 ? Math.max.apply(null, patients.map(function(p) { return p.id; })) + 1 : 1;

        patients.push({
            id: newId,
            trackingId: generateTrackingId(),
            name: document.getElementById('inputName').value.trim(),
            age: parseInt(document.getElementById('inputAge').value, 10),
            phone: phone,
            weight: document.getElementById('inputWeight').value.trim() ? parseFloat(document.getElementById('inputWeight').value) : null,
            height: document.getElementById('inputHeight').value.trim() ? parseFloat(document.getElementById('inputHeight').value) : null,
            bp: bp,
            hr: parseInt(hr, 10),
            urgency: urgency,
            status: status,
            description: document.getElementById('inputDesc').value.trim(),
            registered: new Date().toISOString(),
            clinicalNotes: [],
            labOrders: [],
            nurseOrders: []
        });

        saveToStorage();
        renderCards();
        closeModal();

        if (window.MediTrackNotify) {
            window.MediTrackNotify('Patient Registered', document.getElementById('inputName').value.trim() + ' has been added to the registry.', 'success');
        }
    }

    function init() {
        loadFromStorage();
        renderCards();

        initCustomSelect('filterUrgencyWrapper', function(val) { urgencyFilter = val; renderCards(); });
        initCustomSelect('sortOrderWrapper', function(val) { sortValue = val; renderCards(); });
        initCustomSelect('inputUrgencyWrapper');
        initCustomSelect('inputStatusWrapper');

        document.getElementById('patientSearch').addEventListener('input', function(e) { searchTerm = e.target.value; renderCards(); });

        // Phone: numbers only
        document.getElementById('inputPhone').addEventListener('keydown', function(e) {
            if (e.key.length === 1 && !/\d/.test(e.key) && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
            }
        });
        document.getElementById('inputPhone').addEventListener('input', function(e) {
            e.target.value = formatPhone(e.target.value);
        });

        // BP: only digits and slash
        var bpInput = document.getElementById('inputBP');
        if (bpInput) {
            bpInput.addEventListener('keydown', function(e) {
                if (e.key.length === 1 && !/[\d\/]/.test(e.key) && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                }
            });
        }

        document.getElementById('addPatientBtn').addEventListener('click', openModal);
        document.getElementById('savePatientBtn').addEventListener('click', savePatient);
        document.getElementById('closeModalBtn').addEventListener('click', closeModal);
        document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

        document.getElementById('closeDetailBtn').addEventListener('click', closeDetailModal);
        document.getElementById('closeDetailBtn2').addEventListener('click', closeDetailModal);
        document.getElementById('deleteFromDetailBtn').addEventListener('click', function() {
            if (viewingPatient) openConfirmModal(viewingPatient.id);
        });

        document.getElementById('closeConfirmBtn').addEventListener('click', closeConfirmModal);
        document.getElementById('cancelDeleteBtn').addEventListener('click', closeConfirmModal);
        document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);

        window.addEventListener('storage', function(e) {
            if (e.key === STORAGE_KEY) { loadFromStorage(); renderCards(); }
        });
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();