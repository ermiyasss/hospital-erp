/* ==========================================================================
   MediTrack Hospital ERP - Inventory

   A personal library of saved messages, images and hospital files.

   Files uploaded here are stored on the server as real files in their own
   folder; only their metadata travels in the synchronised collection. (The
   old approach inlined every file into that collection as a base64 data URL,
   which capped an inventory at a few megabytes.) Items saved out of a chat
   still carry their bytes inline, so both shapes are handled below — see
   `inlineData`.

   Each account has a 6 GB allowance and no single file may exceed 1.5 GB.
   Both are enforced on the server while the bytes arrive, and mirrored here
   so an impossible upload is refused before it starts.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;

    var items = [];
    var filter = 'all';
    var searchTerm = '';

    /* Allowances, kept in step with the server (js/server.js). */
    var QUOTA_BYTES = 6 * 1024 * 1024 * 1024;      /* 6 GB per account   */
    var MAX_FILE_BYTES = 1.5 * 1024 * 1024 * 1024; /* 1.5 GB per file    */

    var usage = { usedBytes: 0, quotaBytes: QUOTA_BYTES, maxFileBytes: MAX_FILE_BYTES, fileCount: 0 };
    var pending = [];   /* files chosen but not yet confirmed */
    var uploading = false;

    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }
    function byId(id) { return document.getElementById(id); }
    function token() { try { return window.localStorage.getItem('erp_token') || ''; } catch (e) { return ''; } }

    function debounce(fn, wait) {
        var t = null;
        return function () {
            var args = arguments, self = this;
            if (t) clearTimeout(t);
            t = setTimeout(function () { t = null; fn.apply(self, args); }, wait);
        };
    }

    function formatBytes(n) {
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var v = Number(n) || 0, i = 0;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return (i === 0 ? String(Math.round(v)) : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + units[i];
    }

    function newId() { return 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

    /* Older items saved from a chat keep their bytes in `data`; newer uploads
       point at a server file via `url`. */
    function inlineData(it) { return it && it.data ? String(it.data) : ''; }
    function itemUrl(it) { return it && it.url ? it.url : inlineData(it); }
    function itemDesc(it) { return (it && (it.description || it.note)) || ''; }

    /* ==================================================================
       Storage allowance
       ================================================================== */
    function refreshUsage() {
        return fetch('/api/inventory/usage', {
            headers: { Authorization: 'Bearer ' + token() }
        }).then(function (r) { return r.json(); }).then(function (j) {
            if (j && typeof j.usedBytes === 'number') {
                usage = {
                    usedBytes: j.usedBytes,
                    quotaBytes: j.quotaBytes || QUOTA_BYTES,
                    maxFileBytes: j.maxFileBytes || MAX_FILE_BYTES,
                    fileCount: j.fileCount || 0
                };
                QUOTA_BYTES = usage.quotaBytes;
                MAX_FILE_BYTES = usage.maxFileBytes;
            }
            renderUsage();
        }).catch(function () { renderUsage(); });
    }

    function remainingBytes() { return Math.max(0, usage.quotaBytes - usage.usedBytes); }

    function renderUsage() {
        var text = byId('invUsageText');
        var sub = byId('invUsageSub');
        var fill = byId('invUsageFill');
        var pct = usage.quotaBytes ? (usage.usedBytes / usage.quotaBytes) * 100 : 0;
        pct = Math.max(0, Math.min(100, pct));

        if (text) text.textContent = formatBytes(usage.usedBytes) + ' of ' + formatBytes(usage.quotaBytes) + ' used';
        if (sub) {
            sub.textContent = formatBytes(remainingBytes()) + ' free · up to ' +
                formatBytes(usage.maxFileBytes) + ' per file';
        }
        if (fill) {
            fill.style.width = pct.toFixed(1) + '%';
            fill.classList.toggle('is-high', pct >= 75 && pct < 95);
            fill.classList.toggle('is-full', pct >= 95);
        }
    }

    /* ==================================================================
       List
       ================================================================== */
    function load() {
        items = store.read(store.KEYS.inventory);
        render();
    }

    function visible() {
        var q = searchTerm.toLowerCase();
        return items.filter(function (it) {
            if (filter === 'image' && it.kind !== 'image') return false;
            if (filter === 'file' && it.kind !== 'file') return false;
            if (filter === 'message' && it.source !== 'message') return false;
            if (q) {
                var haystack = [it.name, itemDesc(it), it.savedBy].join(' ').toLowerCase();
                if (haystack.indexOf(q) === -1) return false;
            }
            return true;
        });
    }

    function render() {
        var grid = byId('invGrid');
        var empty = byId('invEmpty');
        var list = visible();
        if (!grid) return;
        if (!list.length) {
            grid.innerHTML = '';
            if (empty) empty.classList.remove('is-hidden');
            return;
        }
        if (empty) empty.classList.add('is-hidden');

        grid.innerHTML = list.map(function (it) {
            var src = itemUrl(it);
            var preview = it.kind === 'image'
                ? '<img class="inv-thumb" src="' + esc(src) + '" alt="' + esc(it.name) + '" loading="lazy" />'
                : '<span class="inv-file-ico"><span class="ico" data-icon="notes" data-icon-size="34"></span></span>';
            var desc = itemDesc(it);
            return '<div class="inv-card" data-id="' + esc(it.id) + '">' +
                '<div class="inv-card-preview">' + preview + '</div>' +
                '<div class="inv-card-body">' +
                    '<span class="inv-card-name" title="' + esc(it.name + (desc ? ' — ' + desc : '')) +
                        ' — double-click to edit">' + esc(it.name) + '</span>' +
                    '<span class="inv-card-meta">' + esc(it.kind === 'image' ? 'Image' : 'Document') +
                        (it.size ? ' · ' + formatBytes(it.size) : '') + '</span>' +
                    '<span class="inv-card-meta">' + esc(it.savedBy || 'you') + ' · ' + esc(store.relativeTime(it.time)) + '</span>' +
                    (desc ? '<span class="inv-card-note">' + esc(desc) + '</span>' : '') +
                '</div>' +
                /* One pencil: it opens an editor for the name and the
                   description together. */
                '<div class="inv-card-actions">' +
                    (it.kind === 'image' ? '<button type="button" class="btn-icon" data-act="view" title="View"><span class="ico" data-icon="eye" data-icon-size="15"></span></button>' : '') +
                    '<button type="button" class="btn-icon" data-act="download" title="Download"><span class="ico" data-icon="download" data-icon-size="15"></span></button>' +
                    '<button type="button" class="btn-icon" data-act="print" title="Print"><span class="ico" data-icon="print" data-icon-size="15"></span></button>' +
                    '<button type="button" class="btn-icon" data-act="edit" title="Edit name and description"><span class="ico" data-icon="edit" data-icon-size="15"></span></button>' +
                    '<button type="button" class="btn-icon danger" data-act="delete" title="Delete"><span class="ico" data-icon="trash" data-icon-size="15"></span></button>' +
                '</div>' +
            '</div>';
        }).join('');
        if (window.MediIcons) window.MediIcons.hydrate(grid);

        ui.qsa('.inv-card', grid).forEach(function (card) {
            var id = card.getAttribute('data-id');
            ui.qsa('[data-act]', card).forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var it = items.filter(function (x) { return x.id === id; })[0];
                    if (it) doAction(btn.getAttribute('data-act'), it);
                });
            });
            var img = card.querySelector('.inv-thumb');
            if (img) img.addEventListener('click', function () { viewImage(img.getAttribute('src')); });
            var name = card.querySelector('.inv-card-name');
            if (name) name.addEventListener('dblclick', function () {
                var it = items.filter(function (x) { return x.id === id; })[0];
                if (it) openEditModal(it);
            });
        });
    }

    function doAction(act, it) {
        if (act === 'download') download(it);
        else if (act === 'view') viewImage(itemUrl(it));
        else if (act === 'print') printItem(it);
        else if (act === 'edit') openEditModal(it);
        else if (act === 'delete') confirmDelete(it);
    }

    /* ==================================================================
       Edit name + description (one editor)
       ================================================================== */
    function openEditModal(it) {
        var nameInput = byId('invEditName');
        var descInput = byId('invEditDesc');
        if (!nameInput || !descInput) return;

        nameInput.value = it.name || '';
        descInput.value = itemDesc(it);
        ui.openModal('invEditModal');

        var save = function () {
            var next = String(nameInput.value || '').trim();
            if (!next) {
                window.MediTrackNotify.flash('Name needed', 'Give the file a name, or press Cancel.', 'warning');
                nameInput.focus();
                return;
            }
            var nextDesc = String(descInput.value || '').trim();
            var changed = next !== it.name || nextDesc !== itemDesc(it);

            it.name = next;
            it.description = nextDesc;
            /* Older records used `note`; keep them in step so nothing else in
               the app shows a stale description. */
            if ('note' in it) it.note = nextDesc;

            store.write(store.KEYS.inventory, items);
            ui.closeModal('invEditModal');
            render();
            if (changed) window.MediTrackNotify.flash('Saved', 'Details updated for ' + next + '.', 'success');
        };

        var btn = byId('invEditSave');
        if (btn) btn.onclick = save;
        /* Enter in the name field saves; Enter in the description adds a
           newline, which is what people expect from a text area. */
        nameInput.onkeydown = function (e) {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            else if (e.key === 'Escape') { e.preventDefault(); ui.closeModal('invEditModal'); }
        };
        setTimeout(function () { nameInput.focus(); nameInput.select(); }, 60);
    }

    function confirmDelete(it) {
        ui.confirmAction({
            title: 'Delete file?',
            message: it.name + ' will be removed from your inventory and the space it used will be freed.',
            confirmLabel: 'Delete', tone: 'danger', icon: 'trash'
        }, function () {
            items = items.filter(function (x) { return x.id !== it.id; });
            store.write(store.KEYS.inventory, items);
            render();
            /* Remove the copy on the server so the allowance is released. */
            if (it.fileId) freeServerFile(it.fileId);
            else refreshUsage();
            window.MediTrackNotify.flash('Deleted', it.name + ' removed.', 'success');
        });
    }

    function freeServerFile(fileId) {
        fetch('/api/inventory/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
            body: JSON.stringify({ id: fileId })
        }).then(function (r) { return r.json(); }).then(function (j) {
            if (j && typeof j.usedBytes === 'number') usage.usedBytes = j.usedBytes;
            renderUsage();
        }).catch(function () { refreshUsage(); });
    }

    /* ==================================================================
       Download / view / print
       ================================================================== */
    function download(it) {
        var link = document.createElement('a');
        /* Server-side files need the download flag so they are saved rather
           than opened; inline data can be handed straight to the browser. */
        link.href = it.fileId ? (it.url + '?download=1') : itemUrl(it);
        link.download = it.name;
        document.body.appendChild(link); link.click(); link.remove();
    }

    function viewImage(src) {
        var lb = byId('invLightbox');
        var img = byId('invLightboxSrc');
        if (lb && img) { img.src = src; ui.openModal('invLightbox'); }
    }

    function printItem(it) {
        if (it.kind === 'image') {
            var w = window.open('', '_blank');
            if (!w) { window.print(); return; }
            w.document.write('<html><head><title>' + esc(it.name) + '</title></head>' +
                '<body style="margin:0;text-align:center">' +
                '<img src="' + esc(itemUrl(it)) + '" style="max-width:100%" /></body></html>');
            w.document.close(); w.focus();
            setTimeout(function () { w.print(); }, 250);
        } else {
            download(it);
            window.MediTrackNotify.flash('Downloaded', 'Documents open from your download folder for printing.', 'info');
        }
    }

    /* ==================================================================
       Upload: choose files -> name and describe them -> confirm
       ================================================================== */
    function filesSelected(fileList) {
        var files = Array.prototype.slice.call(fileList || []);
        if (!files.length) return;

        var oversize = files.filter(function (f) { return f.size > MAX_FILE_BYTES; });
        if (oversize.length) {
            window.MediTrackNotify.flash('File too large',
                oversize.map(function (f) { return f.name; }).join(', ') +
                ' ' + (oversize.length > 1 ? 'are' : 'is') + ' over the ' +
                formatBytes(MAX_FILE_BYTES) + ' per-file limit.', 'warning');
            files = files.filter(function (f) { return f.size <= MAX_FILE_BYTES; });
        }
        if (!files.length) return;

        pending = files.map(function (f) {
            return {
                file: f,
                name: f.name,
                description: '',
                removed: false,
                state: 'ready',        /* ready | uploading | done | error */
                error: ''
            };
        });
        renderPending();
        ui.openModal('invUploadModal');
    }

    function pendingTotal() {
        return pending.reduce(function (n, p) {
            return n + (p.removed ? 0 : (p.file ? p.file.size : 0));
        }, 0);
    }

    function renderPending() {
        var host = byId('invUploadList');
        if (!host) return;

        host.innerHTML = pending.map(function (p, i) {
            var isImage = /^image\//.test(p.file.type || '');
            return '<div class="inv-upload-row' + (p.removed ? ' is-removed' : '') + '" data-row="' + i + '">' +
                '<div class="inv-upload-row-head">' +
                    '<span class="ico" data-icon="' + (isImage ? 'eye' : 'notes') + '" data-icon-size="15"></span>' +
                    '<span class="inv-upload-orig" title="' + esc(p.file.name) + '">' + esc(p.file.name) + '</span>' +
                    '<span class="inv-upload-fsize">' + esc(formatBytes(p.file.size)) + '</span>' +
                    '<button type="button" class="btn-icon' + (p.removed ? '' : ' danger') +
                        '" data-rowact="' + (p.removed ? 'restore' : 'remove') + '" ' +
                        'title="' + (p.removed ? 'Add it back' : 'Leave this one out') + '">' +
                        '<span class="ico" data-icon="' + (p.removed ? 'plus' : 'close') + '" data-icon-size="14"></span></button>' +
                '</div>' +
                '<div class="inv-upload-fields">' +
                    '<div class="form-group">' +
                        '<label for="upName' + i + '">Name</label>' +
                        '<input type="text" id="upName' + i + '" class="up-name" value="' + esc(p.name) + '"' +
                            (p.removed ? ' disabled' : '') + ' placeholder="Give it a clearer name" />' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label for="upDesc' + i + '">Description</label>' +
                        '<textarea id="upDesc' + i + '" class="up-desc" rows="2"' + (p.removed ? ' disabled' : '') +
                            ' placeholder="What is this file for?">' + esc(p.description) + '</textarea>' +
                    '</div>' +
                '</div>' +
                '<div class="inv-upload-progress is-hidden" data-prog="' + i + '">' +
                    '<span class="inv-progress-track"><span style="width:0%"></span></span>' +
                    '<span class="inv-progress-text"></span>' +
                '</div>' +
            '</div>';
        }).join('');
        if (window.MediIcons) window.MediIcons.hydrate(host);

        ui.qsa('[data-rowact]', host).forEach(function (btn) {
            btn.addEventListener('click', function () {
                var row = btn.closest('.inv-upload-row');
                var i = Number(row && row.getAttribute('data-row'));
                if (isNaN(i) || !pending[i]) return;
                pending[i].removed = btn.getAttribute('data-rowact') === 'remove';
                renderPending();
            });
        });
        /* Keep `pending` in step with whatever is typed, so confirming
           uploads exactly what is on screen. */
        ui.qsa('.inv-upload-row', host).forEach(function (row) {
            var i = Number(row.getAttribute('data-row'));
            var name = row.querySelector('.up-name');
            var desc = row.querySelector('.up-desc');
            if (name) name.addEventListener('input', function () { pending[i].name = name.value; });
            if (desc) desc.addEventListener('input', function () { pending[i].description = desc.value; });
        });

        updatePendingFooter();
    }

    /* Total size, and whether the selection fits in what is left. */
    function updatePendingFooter() {
        var total = pendingTotal();
        var count = pending.filter(function (p) { return !p.removed; }).length;
        var warn = byId('invUploadWarn');
        var confirmBtn = byId('invUploadConfirm');
        var totalEl = byId('invUploadTotal');

        if (totalEl) {
            totalEl.textContent = count
                ? count + (count === 1 ? ' file' : ' files') + ' · ' + formatBytes(total)
                : 'No files selected';
        }

        var over = total > remainingBytes();
        if (warn) {
            if (over) {
                warn.innerHTML = '<span class="ico" data-icon="warning" data-icon-size="15"></span>' +
                    '<span>These files need <strong>' + esc(formatBytes(total)) + '</strong> but only ' +
                    '<strong>' + esc(formatBytes(remainingBytes())) + '</strong> is left of your ' +
                    esc(formatBytes(usage.quotaBytes)) + '. Remove some, or delete files from your ' +
                    'inventory to make room.</span>';
                warn.classList.remove('is-hidden');
                if (window.MediIcons) window.MediIcons.hydrate(warn);
            } else {
                warn.classList.add('is-hidden');
                warn.innerHTML = '';
            }
        }
        if (confirmBtn) confirmBtn.disabled = over || !count || uploading;
    }

    function setProgress(i, loaded, total, state) {
        var row = document.querySelector('.inv-upload-row[data-row="' + i + '"]');
        if (!row) return;
        var box = row.querySelector('[data-prog]');
        if (!box) return;
        var track = box.querySelector('.inv-progress-track');
        var fillBar = track ? track.querySelector('span') : null;
        var label = box.querySelector('.inv-progress-text');

        box.classList.remove('is-hidden');
        var pct = total ? Math.min(100, (loaded / total) * 100) : 0;
        if (fillBar) fillBar.style.width = pct.toFixed(1) + '%';
        if (track) {
            track.classList.toggle('is-done', state === 'done');
            track.classList.toggle('is-error', state === 'error');
        }
        if (label) {
            label.textContent = state === 'error' ? 'Failed'
                : state === 'done' ? 'Done · ' + formatBytes(total)
                : Math.round(pct) + '% · ' + formatBytes(loaded);
        }
    }

    /* XHR rather than fetch: it reports upload progress, which matters when a
       file is large enough to take a visible amount of time. */
    function uploadOne(entry, i) {
        return new Promise(function (resolve) {
            var qs = '?name=' + encodeURIComponent(entry.name || 'Untitled file') +
                     '&description=' + encodeURIComponent(entry.description || '') +
                     '&mime=' + encodeURIComponent(entry.file.type || 'application/octet-stream');

            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/inventory/upload' + qs, true);
            xhr.setRequestHeader('Authorization', 'Bearer ' + token());

            xhr.upload.onprogress = function (e) {
                if (e.lengthComputable) setProgress(i, e.loaded, e.total, 'uploading');
            };
            xhr.onload = function () {
                var j = {};
                try { j = JSON.parse(xhr.responseText); } catch (e) {}
                if (xhr.status === 200) {
                    setProgress(i, entry.file.size, entry.file.size, 'done');
                    resolve({ ok: true, file: j.file, usage: j.usage });
                } else {
                    var msg = (j && (j.error || j.detail)) || ('Upload failed (' + xhr.status + ')');
                    /* The 413 reasons are prefixed on the server so the client
                       can show the friendlier of the two lines. */
                    if (msg.indexOf('QUOTA_EXCEEDED:') === 0) msg = msg.slice('QUOTA_EXCEEDED:'.length);
                    else if (msg.indexOf('FILE_TOO_LARGE:') === 0) msg = msg.slice('FILE_TOO_LARGE:'.length);
                    resolve({ ok: false, error: msg });
                }
            };
            xhr.onerror = function () {
                resolve({ ok: false, error: 'The connection dropped during the upload.' });
            };
            xhr.onabort = function () {
                resolve({ ok: false, error: 'Upload cancelled.' });
            };
            xhr.send(entry.file);
        });
    }

    function confirmUpload() {
        if (uploading) return;
        var queue = pending.filter(function (p) { return !p.removed; });
        if (!queue.length) return;

        uploading = true;
        var confirmBtn = byId('invUploadConfirm');
        var label = byId('invUploadConfirmLabel');
        var cancelBtn = byId('invUploadCancel');
        if (confirmBtn) confirmBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        if (label) label.textContent = 'Uploading…';

        var who = store.sessionUser() || {};
        var added = 0;
        var failures = [];

        /* One at a time: the progress bar is readable, and a large file cannot
           saturate the link and starve the rest of the app. */
        var run = function (n) {
            if (n >= queue.length) return Promise.resolve();
            var entry = queue[n];
            var i = pending.indexOf(entry);
            return uploadOne(entry, i).then(function (out) {
                if (out.ok) {
                    var f = out.file;
                    items.unshift({
                        id: newId(),
                        kind: /^image\//.test(f.mime || '') ? 'image' : 'file',
                        name: f.name,
                        description: f.description || '',
                        mime: f.mime,
                        size: f.size,
                        fileId: f.id,
                        url: f.url,
                        source: 'upload',
                        savedBy: (who.name || 'you'),
                        time: f.time || new Date().toISOString()
                    });
                    store.write(store.KEYS.inventory, items);
                    render();
                    added++;
                    if (out.usage && typeof out.usage.usedBytes === 'number') {
                        usage.usedBytes = out.usage.usedBytes;
                        renderUsage();
                    }
                } else {
                    pending[i].state = 'error';
                    pending[i].error = out.error;
                    setProgress(i, 0, entry.file.size, 'error');
                    failures.push(entry.name + ': ' + out.error);
                }
                return run(n + 1);
            });
        };

        run(0).then(function () {
            uploading = false;
            if (label) label.textContent = 'Add to inventory';
            if (cancelBtn) cancelBtn.disabled = false;

            if (added && !failures.length) {
                ui.closeModal('invUploadModal');
                window.MediTrackNotify.flash('Added',
                    added + (added === 1 ? ' file' : ' files') + ' added to your inventory.', 'success');
            } else if (added && failures.length) {
                ui.closeModal('invUploadModal');
                window.MediTrackNotify.flash('Partly added',
                    added + ' added, ' + failures.length + ' failed. ' + failures[0], 'warning');
            } else {
                window.MediTrackNotify.flash('Nothing added',
                    failures.length ? failures[0] : 'The files could not be uploaded.', 'error');
                updatePendingFooter();
            }
            refreshUsage();
        });
    }

    /* ==================================================================
       Init
       ================================================================== */
    function init() {
        load();
        refreshUsage();
        ui.initChips('invFilters', 'data-inv-filter', function (v) { filter = v || 'all'; render(); });

        var search = byId('invSearch');
        var clear = byId('invSearchClear');
        if (search) {
            var runSearch = debounce(function () {
                searchTerm = search.value.trim();
                if (clear) clear.classList.toggle('visible', !!searchTerm);
                render();
            }, 160);
            search.addEventListener('input', runSearch);
        }
        if (clear) clear.addEventListener('click', function () { search.value = ''; searchTerm = ''; clear.classList.remove('visible'); render(); });

        var upload = byId('uploadBtn');
        var fileInput = byId('invFileInput');
        if (upload && fileInput) {
            upload.addEventListener('click', function () { fileInput.click(); });
            fileInput.addEventListener('change', function () { filesSelected(fileInput.files); fileInput.value = ''; });
        }

        var confirmBtn = byId('invUploadConfirm');
        if (confirmBtn) confirmBtn.addEventListener('click', confirmUpload);

        var lb = byId('invLightbox');
        if (lb) lb.addEventListener('click', function () { ui.closeModal('invLightbox'); });

        /* Drag and drop onto the grid. */
        var grid = byId('invGrid');
        if (grid) {
            ['dragenter', 'dragover'].forEach(function (evt) {
                grid.addEventListener(evt, function (e) { e.preventDefault(); grid.classList.add('is-dropping'); });
            });
            ['dragleave', 'drop'].forEach(function (evt) {
                grid.addEventListener(evt, function (e) { e.preventDefault(); grid.classList.remove('is-dropping'); });
            });
            grid.addEventListener('drop', function (e) {
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
                    filesSelected(e.dataTransfer.files);
                }
            });
        }

        window.addEventListener('storage', function (e) { if (e.key === store.KEYS.inventory) load(); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window, document);
