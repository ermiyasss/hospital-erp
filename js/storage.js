/**
 * MediTrack Hospital ERP - Medical Storage & Patient Archive Logic
 * Permanent record of all patients treated and discharged since hospital opening.
 * Synchronized with clinic_patients_data in localStorage.
 * Provides search, clinical history detail modals, and CSV / Excel export.
 */

(function() {
    'use strict';

    var STORAGE_KEY = 'clinic_patients_data';
    var archivedPatients = [];
    var searchTerm = '';
    var urgencyFilter = '';
    var sortOrder = 'date_desc';

    function toggleBlur(state) {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ action: 'toggleBlur', state: state }, '*');
        }
    }

    /* --------------------------------------------------------------------------
       LocalStorage Load (Finished Patients Only)
       -------------------------------------------------------------------------- */
    function loadArchivedPatients() {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                var all = JSON.parse(raw);
                archivedPatients = all.filter(function(p) { return p.status === 'Finished'; });
            } catch (e) {
                archivedPatients = [];
            }
        } else {
            archivedPatients = [];
        }
    }

    /* --------------------------------------------------------------------------
       Filtering & Sorting
       -------------------------------------------------------------------------- */
    function getFilteredPatients() {
        var filtered = archivedPatients.filter(function(p) {
            var matchesSearch = true;
            if (searchTerm.trim() !== '') {
                var term = searchTerm.toLowerCase().trim();
                matchesSearch = (p.name && p.name.toLowerCase().includes(term)) ||
                                (p.trackingId && p.trackingId.toLowerCase().includes(term)) ||
                                (p.phone && p.phone.includes(term));
            }

            var matchesUrgency = (urgencyFilter === '') || (p.urgency === urgencyFilter);

            return matchesSearch && matchesUrgency;
        });

        if (sortOrder === 'date_desc') {
            filtered.sort(function(a, b) { return new Date(b.registered) - new Date(a.registered); });
        } else if (sortOrder === 'date_asc') {
            filtered.sort(function(a, b) { return new Date(a.registered) - new Date(b.registered); });
        } else if (sortOrder === 'name_asc') {
            filtered.sort(function(a, b) { return a.name.localeCompare(b.name); });
        } else if (sortOrder === 'name_desc') {
            filtered.sort(function(a, b) { return b.name.localeCompare(a.name); });
        }

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

    /* --------------------------------------------------------------------------
       Render Counters & Cards
       -------------------------------------------------------------------------- */
    function renderCounters() {
        var total = archivedPatients.length;
        var urgent = archivedPatients.filter(function(p) { return p.urgency === 'Urgent'; }).length;
        var nonUrgent = total - urgent;

        var elTotal = document.getElementById('totalArchivedCount');
        var elUrgent = document.getElementById('urgentArchivedCount');
        var elNonUrgent = document.getElementById('nonUrgentArchivedCount');

        if (elTotal) elTotal.textContent = total;
        if (elUrgent) elUrgent.textContent = urgent;
        if (elNonUrgent) elNonUrgent.textContent = nonUrgent;
    }

    function renderCards() {
        var grid = document.getElementById('storageCardGrid');
        var noDataDiv = document.getElementById('noStorageData');
        if (!grid) return;

        renderCounters();

        var list = getFilteredPatients();

        if (list.length === 0) {
            grid.innerHTML = '';
            if (noDataDiv) noDataDiv.style.display = 'block';
            return;
        }

        if (noDataDiv) noDataDiv.style.display = 'none';

        grid.innerHTML = list.map(function(p) {
            var initials = p.name.split(' ').map(function(n) { return n[0]; }).join('').toUpperCase().substring(0, 2);
            var urgencyClass = (p.urgency === 'Urgent') ? 'urgency-urgent' : 'urgency-nonurgent';

            return '<div class="storage-card" data-id="' + p.id + '">' +
                '<div class="scard-top">' +
                    '<div style="display:flex; align-items:center; gap:10px; min-width:0;">' +
                        '<div class="scard-avatar">' + initials + '</div>' +
                        '<div class="scard-head-info">' +
                            '<h4 class="scard-name">' + p.name + '</h4>' +
                            '<span class="tracking-id">' + p.trackingId + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<span class="badge ' + urgencyClass + '">' + p.urgency + '</span>' +
                '</div>' +
                '<div class="scard-meta">' +
                    '<div class="scard-meta-item"><span class="label">Age</span><strong>' + p.age + '</strong></div>' +
                    '<div class="scard-meta-item"><span class="label">Phone</span><strong>' + (p.phone || '-') + '</strong></div>' +
                    '<div class="scard-meta-item"><span class="label">BP</span><strong>' + (p.bp || '-') + '</strong></div>' +
                '</div>' +
                '<div class="scard-bottom">' +
                    '<span class="badge status-finished">Discharged / Finished</span>' +
                    '<span>Treated: ' + formatDate(p.registered) + '</span>' +
                '</div>' +
            '</div>';
        }).join('');

        // Attach card clicks for detail modal
        grid.querySelectorAll('.storage-card').forEach(function(card) {
            card.addEventListener('click', function() {
                var pId = parseInt(this.getAttribute('data-id'), 10);
                openArchiveDetailModal(pId);
            });
        });
    }

    /* --------------------------------------------------------------------------
       Archive Detail Modal
       -------------------------------------------------------------------------- */
    function openArchiveDetailModal(patientId) {
        var p = archivedPatients.find(function(x) { return x.id === patientId; });
        if (!p) return;

        document.getElementById('archiveModalTitle').textContent = p.name + ' (' + p.trackingId + ')';

        var urgencyClass = (p.urgency === 'Urgent') ? 'urgency-urgent' : 'urgency-nonurgent';

        var notesHtml = '';
        if (p.clinicalNotes && p.clinicalNotes.length > 0) {
            notesHtml = p.clinicalNotes.map(function(n) {
                return '<div class="anote-card">' +
                    '<div style="display:flex; justify-content:space-between; margin-bottom:4px;">' +
                        '<strong>' + (n.diagnosis || 'Clinical Note') + '</strong>' +
                        '<span style="font-size:11px; color:var(--gray-muted);">' + formatDate(n.time) + '</span>' +
                    '</div>' +
                    '<div style="color:var(--text-body);">' + n.note + '</div>' +
                '</div>';
            }).join('');
        } else {
            notesHtml = '<span style="font-size:12px; color:var(--gray-muted); font-style:italic;">No detailed doctor clinical notes recorded during visit.</span>';
        }

        var labHtml = '';
        if (p.labOrders && p.labOrders.length > 0) {
            labHtml = p.labOrders.map(function(l) {
                return '<div class="anote-card">' +
                    '<div style="display:flex; justify-content:space-between; margin-bottom:4px;">' +
                        '<strong>' + l.test + ' (' + l.priority + ')</strong>' +
                        '<span class="badge status-finished">' + l.status + '</span>' +
                    '</div>' +
                    (l.results ? '<div style="font-size:12px; color:#0369A1; background:#E0F2FE; padding:4px 8px; border-radius:4px; margin-top:4px;"><strong>Results:</strong> ' + l.results + '</div>' : '') +
                '</div>';
            }).join('');
        }

        document.getElementById('archiveModalBody').innerHTML =
            '<div class="archive-detail-grid">' +
                '<div class="ad-row"><span class="ad-label">Tracking ID</span><span class="ad-val"><span class="tracking-id">' + p.trackingId + '</span></span></div>' +
                '<div class="ad-row"><span class="ad-label">Patient Name</span><span class="ad-val"><strong>' + p.name + '</strong></span></div>' +
                '<div class="ad-row"><span class="ad-label">Age</span><span class="ad-val">' + p.age + ' yrs</span></div>' +
                '<div class="ad-row"><span class="ad-label">Phone</span><span class="ad-val">' + (p.phone || '-') + '</span></div>' +
                '<div class="ad-row"><span class="ad-label">Urgency</span><span class="ad-val"><span class="badge ' + urgencyClass + '">' + p.urgency + '</span></span></div>' +
                '<div class="ad-row"><span class="ad-label">Status</span><span class="ad-val"><span class="badge status-finished">Finished</span></span></div>' +
                '<div class="ad-row"><span class="ad-label">Blood Pressure</span><span class="ad-val">' + (p.bp || '-') + ' mmHg</span></div>' +
                '<div class="ad-row"><span class="ad-label">Heart Rate</span><span class="ad-val">' + (p.hr || '-') + ' bpm</span></div>' +
                '<div class="ad-row"><span class="ad-label">Weight / Height</span><span class="ad-val">' + (p.weight || '-') + ' kg / ' + (p.height || '-') + ' cm</span></div>' +
                '<div class="ad-row"><span class="ad-label">Admission / Visit Date</span><span class="ad-val">' + formatDateTime(p.registered) + '</span></div>' +
            '</div>' +
            '<div class="archive-section-block">' +
                '<span class="archive-section-title">Initial Chief Complaint / Condition</span>' +
                '<p style="font-size:13px; color:var(--text-dark); margin:0; line-height:1.45;">' + (p.description || 'Routine consultation') + '</p>' +
            '</div>' +
            '<div class="archive-section-block">' +
                '<span class="archive-section-title">Doctor Examination & Clinical Notes</span>' +
                '<div class="archive-notes-list">' + notesHtml + '</div>' +
            '</div>' +
            (labHtml ? 
                '<div class="archive-section-block">' +
                    '<span class="archive-section-title">Laboratory Diagnostic Findings</span>' +
                    '<div class="archive-notes-list">' + labHtml + '</div>' +
                '</div>' : '');

        document.getElementById('archiveDetailModal').classList.add('active');
        toggleBlur(true);
    }

    function closeArchiveDetailModal() {
        document.getElementById('archiveDetailModal').classList.remove('active');
        toggleBlur(false);
    }

    /* --------------------------------------------------------------------------
       Export to CSV & Excel (.xlsx formatted CSV)
       -------------------------------------------------------------------------- */
    function exportToCSV(filename, isExcel) {
        var list = getFilteredPatients();
        if (list.length === 0) {
            alert('No archived patient records to export.');
            return;
        }

        var headers = [
            'Tracking ID',
            'Full Name',
            'Age',
            'Phone',
            'Urgency',
            'Status',
            'Blood Pressure (mmHg)',
            'Heart Rate (bpm)',
            'Weight (kg)',
            'Height (cm)',
            'Chief Complaint',
            'Visit Date'
        ];

        var rows = list.map(function(p) {
            return [
                '"' + (p.trackingId || '') + '"',
                '"' + (p.name || '').replace(/"/g, '""') + '"',
                p.age || '',
                '"' + (p.phone || '') + '"',
                '"' + (p.urgency || '') + '"',
                '"' + (p.status || '') + '"',
                '"' + (p.bp || '') + '"',
                p.hr || '',
                p.weight || '',
                p.height || '',
                '"' + (p.description || '').replace(/"/g, '""') + '"',
                '"' + (p.registered ? new Date(p.registered).toLocaleString() : '') + '"'
            ];
        });

        var csvContent = '\uFEFF' + headers.join(',') + '\n' + rows.map(function(r) { return r.join(','); }).join('\n');
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        if (window.MediTrackNotify) {
            window.MediTrackNotify('Export Successful', 'Archived patients exported to ' + filename, 'success');
        }
    }

    /* --------------------------------------------------------------------------
       Custom Select
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
                toggle.querySelector('.cs-text').textContent = text;
                toggle.setAttribute('data-value', val);

                menu.querySelectorAll('.cs-option').forEach(function(o) { o.classList.remove('selected'); });
                this.classList.add('selected');

                wrapper.classList.remove('active');
                if (callback) callback(val);
            });
        });
    }

    /* --------------------------------------------------------------------------
       Initialization
       -------------------------------------------------------------------------- */
    function init() {
        loadArchivedPatients();
        renderCards();

        initCustomSelect('filterUrgencyWrapper', function(val) {
            urgencyFilter = val;
            renderCards();
        });

        initCustomSelect('sortWrapper', function(val) {
            sortOrder = val;
            renderCards();
        });

        document.addEventListener('click', function() {
            document.querySelectorAll('.custom-select.active').forEach(function(el) {
                el.classList.remove('active');
            });
        });

        var searchInput = document.getElementById('storageSearch');
        var clearSearchBtn = document.getElementById('clearSearchBtn');
        if (searchInput) {
            searchInput.addEventListener('input', function(e) {
                searchTerm = e.target.value;
                if (clearSearchBtn) {
                    clearSearchBtn.style.display = searchTerm ? 'block' : 'none';
                }
                renderCards();
            });
        }
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', function() {
                if (searchInput) {
                    searchInput.value = '';
                    searchTerm = '';
                    clearSearchBtn.style.display = 'none';
                    renderCards();
                }
            });
        }

        // Export Buttons
        var expCsv = document.getElementById('exportCsvBtn');
        var expExcel = document.getElementById('exportExcelBtn');

        if (expCsv) {
            expCsv.addEventListener('click', function() {
                exportToCSV('MediTrack_Discharged_Patients_' + new Date().toISOString().slice(0, 10) + '.csv', false);
            });
        }

        if (expExcel) {
            expExcel.addEventListener('click', function() {
                exportToCSV('MediTrack_Discharged_Patients_' + new Date().toISOString().slice(0, 10) + '.xlsx.csv', true);
            });
        }

        // Modal Close Buttons
        var closeM1 = document.getElementById('closeArchiveModalBtn');
        var closeM2 = document.getElementById('closeArchiveModalBtn2');
        if (closeM1) closeM1.addEventListener('click', closeArchiveDetailModal);
        if (closeM2) closeM2.addEventListener('click', closeArchiveDetailModal);

        window.addEventListener('storage', function(e) {
            if (e.key === STORAGE_KEY) {
                loadArchivedPatients();
                renderCards();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
