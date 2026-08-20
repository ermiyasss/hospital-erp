(function() {
    var STORAGE_KEY = 'clinic_patients_data';
    var patients = [];
    var searchTerm = '';
    var urgencyFilter = '';
    var sortValue = 'default';
    var pendingDeleteId = null;

    function toggleBlur(state) {
        window.parent.postMessage({ action: 'toggleBlur', state: state }, '*');
    }

    function generateTrackingId() {
        return 'TRK-' + Math.floor(10000000 + Math.random() * 90000000);
    }

    function loadFromStorage() {
        var data = localStorage.getItem(STORAGE_KEY);
        if (!data) {
            patients = [
                { id: 1, trackingId: generateTrackingId(), name: 'John Doe', age: 34, phone: '0912 345 678', weight: 70, height: 175, urgency: 'High', status: 'In Treatment', description: 'Severe chest pain, undergoing tests.', registered: '2023-10-24T09:00:00Z' },
                { id: 2, trackingId: generateTrackingId(), name: 'Alice Smith', age: 28, phone: '0987 654 321', weight: 60, height: 160, urgency: 'Medium', status: 'Pending', description: 'Persistent cough and fever.', registered: '2023-10-25T14:30:00Z' },
                { id: 3, trackingId: generateTrackingId(), name: 'Bob Johnson', age: 45, phone: '0911 222 333', weight: 85, height: 180, urgency: 'Low', status: 'Finished', description: 'Routine annual checkup completed.', registered: '2023-10-20T11:15:00Z' }
            ];
            saveToStorage();
        } else {
            patients = JSON.parse(data);
        }
    }

    function saveToStorage() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(patients));
    }

    function formatPhone(value) {
        var digits = value.replace(/\D/g, '');
        if (digits.startsWith('251')) digits = '0' + digits.substring(3);
        if (digits.startsWith('0')) {
            var formatted = digits.substring(0, 3);
            if (digits.length > 3) formatted += ' ' + digits.substring(3, 6);
            if (digits.length > 6) formatted += ' ' + digits.substring(6, 8);
            if (digits.length > 8) formatted += ' ' + digits.substring(8, 10);
            return formatted;
        }
        return value;
    }

    function isValidPhone(phone) {
        if (!phone) return true; // Optional
        var digits = phone.replace(/\D/g, '');
        if (digits.startsWith('251')) digits = '0' + digits.substring(3);
        return /^0(9|7)\d{8}$/.test(digits);
    }

    function getFilteredSortedPatients() {
        var filtered = patients.filter(function(p) {
            var matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.trackingId.toLowerCase().includes(searchTerm.toLowerCase());
            var matchesUrgency = urgencyFilter === '' || p.urgency === urgencyFilter;
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
        var date = new Date(isoString);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function renderTable() {
        var tbody = document.getElementById('patientsTableBody');
        var noPatientsDiv = document.getElementById('noPatients');
        if (!tbody) return; 
        
        var data = getFilteredSortedPatients();

        if (data.length === 0) {
            tbody.innerHTML = '';
            if (noPatientsDiv) noPatientsDiv.style.display = 'block';
            return;
        }

        if (noPatientsDiv) noPatientsDiv.style.display = 'none';
        tbody.innerHTML = data.map(function(p) {
            var statusClass = '';
            if (p.status === 'Finished') statusClass = 'status-finished';
            else if (p.status === 'Pending') statusClass = 'status-pending';
            else if (p.status === 'In Treatment') statusClass = 'status-treatment';
            
            var urgencyClass = 'urgency-' + p.urgency.toLowerCase();
            
            return '<tr>' +
                '<td><span class="tracking-id">' + p.trackingId + '</span></td>' +
                '<td><strong>' + p.name + '</strong></td>' +
                '<td>' + p.age + '</td>' +
                '<td>' + (p.phone || '-') + '</td>' +
                '<td><span class="badge ' + urgencyClass + '">' + p.urgency + '</span></td>' +
                '<td><span class="badge ' + statusClass + '">' + p.status + '</span></td>' +
                '<td class="desc-cell" title="' + p.description + '">' + p.description + '</td>' +
                '<td>' + formatDate(p.registered) + '</td>' +
                '<td><button class="action-btn delete-btn" data-id="' + p.id + '"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button></td>' +
                '</tr>';
        }).join('');

        var deleteButtons = document.querySelectorAll('.delete-btn');
        deleteButtons.forEach(function(btn) {
            btn.addEventListener('click', function() {
                openConfirmModal(parseInt(this.getAttribute('data-id')));
            });
        });
    }

    function initCustomSelect(wrapperId, callback) {
        var wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;
        var toggle = wrapper.querySelector('.cs-toggle');
        var menu = wrapper.querySelector('.cs-menu');
        
        toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            document.querySelectorAll('.custom-select.active').forEach(function(el){
                if (el !== wrapper) el.classList.remove('active');
            });
            wrapper.classList.toggle('active');
        });
        
        menu.querySelectorAll('.cs-option').forEach(function(opt) {
            opt.addEventListener('click', function() {
                var val = this.getAttribute('data-value');
                var text = this.textContent;
                toggle.querySelector('.cs-text').textContent = text;
                toggle.setAttribute('data-value', val);
                wrapper.classList.remove('active');
                if (callback) callback(val);
            });
        });
    }

    document.addEventListener('click', function() {
        document.querySelectorAll('.custom-select.active').forEach(function(el){
            el.classList.remove('active');
        });
    });

    function openModal() {
        document.getElementById('patientModal').classList.add('active');
        toggleBlur(true);
    }

    function closeModal() {
        document.getElementById('patientModal').classList.remove('active');
        toggleBlur(false);
        clearForm();
    }

    function clearForm() {
        document.getElementById('inputName').value = '';
        document.getElementById('inputAge').value = '';
        document.getElementById('inputPhone').value = '';
        document.getElementById('inputWeight').value = '';
        document.getElementById('inputHeight').value = '';
        document.getElementById('inputDesc').value = '';

        var urgWrap = document.getElementById('inputUrgencyWrapper');
        urgWrap.querySelector('.cs-text').textContent = 'Medium';
        urgWrap.querySelector('.cs-toggle').setAttribute('data-value', 'Medium');

        var statWrap = document.getElementById('inputStatusWrapper');
        statWrap.querySelector('.cs-text').textContent = 'Pending';
        statWrap.querySelector('.cs-toggle').setAttribute('data-value', 'Pending');

        hideError('errName', 'inputName');
        hideError('errAge', 'inputAge');
        hideError('errPhone', 'inputPhone');
        hideError('errDesc', 'inputDesc');
    }

    function showError(errId, inputId, msg) {
        var el = document.getElementById(errId);
        var input = document.getElementById(inputId);
        el.textContent = msg;
        el.classList.add('visible');
        input.classList.add('input-error');
    }

    function hideError(errId, inputId) {
        var el = document.getElementById(errId);
        var input = document.getElementById(inputId);
        el.classList.remove('visible');
        input.classList.remove('input-error');
    }

    function validateForm() {
        var isValid = true;
        var name = document.getElementById('inputName').value.trim();
        var age = document.getElementById('inputAge').value.trim();
        var desc = document.getElementById('inputDesc').value.trim();
        var phone = document.getElementById('inputPhone').value.trim();

        if (!name) { showError('errName', 'inputName', 'Name is required'); isValid = false; } else hideError('errName', 'inputName');
        if (!age || isNaN(age) || age <= 0) { showError('errAge', 'inputAge', 'Valid age required'); isValid = false; } else hideError('errAge', 'inputAge');
        if (!desc) { showError('errDesc', 'inputDesc', 'Description is required'); isValid = false; } else hideError('errDesc', 'inputDesc');
        
        if (phone && !isValidPhone(phone)) { 
            showError('errPhone', 'inputPhone', 'Invalid Ethiopian number (09...)'); isValid = false; 
        } else { 
            hideError('errPhone', 'inputPhone'); 
        }

        return isValid;
    }

    function openConfirmModal(id) {
        pendingDeleteId = id;
        var patient = patients.find(function(p) { return p.id === id; });
        if (patient) {
            document.getElementById('confirmText').textContent = 'Are you sure you want to delete ' + patient.name + '?';
        }
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
            renderTable();
            closeConfirmModal();
        }
    }

    function savePatient() {
        if (!validateForm()) return;

        var name = document.getElementById('inputName').value.trim();
        var age = parseInt(document.getElementById('inputAge').value);
        var phone = document.getElementById('inputPhone').value.trim();
        var weight = document.getElementById('inputWeight').value.trim();
        var height = document.getElementById('inputHeight').value.trim();
        var desc = document.getElementById('inputDesc').value.trim();
        var urgency = document.getElementById('inputUrgencyWrapper').querySelector('.cs-toggle').getAttribute('data-value');
        var status = document.getElementById('inputStatusWrapper').querySelector('.cs-toggle').getAttribute('data-value');

        var newId = patients.length > 0 ? Math.max.apply(null, patients.map(function(p) { return p.id; })) + 1 : 1;
        
        patients.push({
            id: newId,
            trackingId: generateTrackingId(),
            name: name,
            age: age,
            phone: phone,
            weight: weight,
            height: height,
            urgency: urgency,
            status: status,
            description: desc,
            registered: new Date().toISOString()
        });
        
        saveToStorage();
        renderTable();
        closeModal();
    }

    function init() {
        loadFromStorage();
        renderTable();

        initCustomSelect('filterUrgencyWrapper', function(val) {
            urgencyFilter = val;
            renderTable();
        });
        initCustomSelect('sortOrderWrapper', function(val) {
            sortValue = val;
            renderTable();
        });
        initCustomSelect('inputUrgencyWrapper');
        initCustomSelect('inputStatusWrapper');

        document.getElementById('patientSearch').addEventListener('input', function(e) {
            searchTerm = e.target.value;
            renderTable();
        });

        document.getElementById('inputPhone').addEventListener('input', function(e) {
            e.target.value = formatPhone(e.target.value);
        });

        document.getElementById('addPatientBtn').addEventListener('click', openModal);
        document.getElementById('savePatientBtn').addEventListener('click', savePatient);
        document.getElementById('closeModalBtn').addEventListener('click', closeModal);
        document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
        document.getElementById('closeConfirmBtn').addEventListener('click', closeConfirmModal);
        document.getElementById('cancelDeleteBtn').addEventListener('click', closeConfirmModal);
        document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);
    }

    init();
})();