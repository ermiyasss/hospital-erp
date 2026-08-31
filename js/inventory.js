/* ==========================================================================
   MediTrack Hospital ERP - Inventory

   A personal library of saved messages, images and hospital files. Items are
   stored in the shared collection so they follow the user to any workstation.
   Supports upload, download, print and a note per item.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;

    var items = [];
    var filter = 'all';
    var searchTerm = '';

    function esc(s) { return store.escapeHtml(s); }
    function icon(name, size) { return ui.icon(name, size); }
    function byId(id) { return document.getElementById(id); }
    function debounce(fn, wait) {
        var t = null;
        return function () {
            var args = arguments, self = this;
            if (t) clearTimeout(t);
            t = setTimeout(function () { t = null; fn.apply(self, args); }, wait);
        };
    }

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
            if (q && (it.name || '').toLowerCase().indexOf(q) === -1) return false;
            return true;
        });
    }

    function render() {
        var grid = byId('invGrid');
        var empty = byId('invEmpty');
        var list = visible();
        if (!list.length) {
            grid.innerHTML = '';
            if (empty) empty.classList.remove('is-hidden');
            return;
        }
        if (empty) empty.classList.add('is-hidden');

        grid.innerHTML = list.map(function (it) {
            var preview = it.kind === 'image'
                ? '<img class="inv-thumb" src="' + esc(it.data) + '" alt="' + esc(it.name) + '" />'
                : '<span class="inv-file-ico"><span class="ico" data-icon="file-text" data-icon-size="34"></span></span>';
            return '<div class="inv-card" data-id="' + esc(it.id) + '">' +
                '<div class="inv-card-preview">' + preview + '</div>' +
                '<div class="inv-card-body">' +
                    '<span class="inv-card-name" title="' + esc(it.name) + ' — double-click to rename">' + esc(it.name) + '</span>' +
                    '<span class="inv-card-meta">' + esc(it.kind === 'image' ? 'Image' : 'Document') +
                        (it.size ? ' · ' + Math.round(it.size / 1024) + ' KB' : '') + '</span>' +
                    '<span class="inv-card-meta">' + esc(it.savedBy || 'you') + ' · ' + esc(store.relativeTime(it.time)) + '</span>' +
                    (it.note ? '<span class="inv-card-note">' + esc(it.note) + '</span>' : '') +
                '</div>' +
                '<div class="inv-card-actions">' +
                    (it.kind === 'image' ? '<button type="button" class="btn-icon" data-act="view" title="View"><span class="ico" data-icon="eye" data-icon-size="15"></span></button>' : '') +
                    '<button type="button" class="btn-icon" data-act="download" title="Download"><span class="ico" data-icon="download" data-icon-size="15"></span></button>' +
                    '<button type="button" class="btn-icon" data-act="print" title="Print"><span class="ico" data-icon="printer" data-icon-size="15"></span></button>' +
                    '<button type="button" class="btn-icon" data-act="rename" title="Rename"><span class="ico" data-icon="edit" data-icon-size="15"></span></button>' +
                    '<button type="button" class="btn-icon" data-act="note" title="Add note"><span class="ico" data-icon="edit" data-icon-size="15"></span></button>' +
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
                    var act = btn.getAttribute('data-act');
                    var it = items.filter(function (x) { return x.id === id; })[0];
                    if (it) doAction(act, it);
                });
            });
            var img = card.querySelector('.inv-thumb');
            if (img) img.addEventListener('click', function () { viewImage(img.getAttribute('src')); });
            /* Double-clicking the name is the shortcut; the pencil button is
               the discoverable way to the same place. */
            var name = card.querySelector('.inv-card-name');
            if (name) name.addEventListener('dblclick', function () {
                var it = items.filter(function (x) { return x.id === id; })[0];
                if (it) openRenameModal(it);
            });
        });
    }

    function doAction(act, it) {
        if (act === 'download') download(it);
        else if (act === 'view') viewImage(it.data);
        else if (act === 'print') printItem(it);
        else if (act === 'delete') {
            ui.confirmAction({ title: 'Delete file?', message: it.name + ' will be removed from your inventory.', confirmLabel: 'Delete', tone: 'danger', icon: 'trash' }, function () {
                items = items.filter(function (x) { return x.id !== it.id; });
                store.write(store.KEYS.inventory, items);
                render();
                window.MediTrackNotify.flash('Deleted', it.name + ' removed.', 'success');
            });
        } else if (act === 'note') {
            openNoteModal(it);
        } else if (act === 'rename') {
            openRenameModal(it);
        }
    }

    /* Renaming only changes the label: the stored file keeps whatever it was
       called when it arrived, so downloads still open in the right app. */
    function openRenameModal(it) {
        var input = byId('invRenameInput');
        if (!input) return;
        input.value = it.name || '';
        ui.openModal('invRenameModal');

        var save = function () {
            var next = String(input.value || '').trim();
            if (!next) {
                window.MediTrackNotify.flash('Name needed', 'Give the file a name, or press Cancel.', 'warning');
                input.focus();
                return;
            }
            if (next === it.name) { ui.closeModal('invRenameModal'); return; }
            var before = it.name;
            it.name = next;
            store.write(store.KEYS.inventory, items);
            ui.closeModal('invRenameModal');
            render();
            window.MediTrackNotify.flash('Renamed', before + ' is now ' + next + '.', 'success');
        };

        var btn = byId('invRenameSave');
        if (btn) btn.onclick = save;
        input.onkeydown = function (e) {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            else if (e.key === 'Escape') { e.preventDefault(); ui.closeModal('invRenameModal'); }
        };
        setTimeout(function () { input.focus(); input.select(); }, 60);
    }

    function openNoteModal(it) {
        var ta = byId('invNoteInput');
        if (ta) ta.value = it.note || '';
        ui.openModal('invNoteModal');
        var save = byId('invNoteSave');
        if (save) save.onclick = function () {
            if (ta) it.note = ta.value.trim();
            store.write(store.KEYS.inventory, items);
            ui.closeModal('invNoteModal');
            render();
            window.MediTrackNotify.flash('Saved', 'Note updated for ' + it.name + '.', 'success');
        };
    }

    function download(it) {
        var link = document.createElement('a');
        link.href = it.data; link.download = it.name;
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
            w.document.write('<html><head><title>' + esc(it.name) + '</title></head><body style="margin:0;text-align:center">' +
                '<img src="' + it.data + '" style="max-width:100%" /></body></html>');
            w.document.close(); w.focus();
            setTimeout(function () { w.print(); }, 250);
        } else {
            var link = document.createElement('a');
            link.href = it.data; link.download = it.name; link.click();
            window.MediTrackNotify.flash('Downloaded', 'Documents open from your download folder for printing.', 'info');
        }
    }

    function uploadFiles(fileList) {
        Array.prototype.forEach.call(fileList, function (f) {
            if (f.size > 8 * 1024 * 1024) {
                window.MediTrackNotify.flash('Too large', f.name + ' is over 8 MB.', 'warning');
                return;
            }
            var reader = new FileReader();
            reader.onload = function () {
                var who = store.sessionUser() || {};
                items.unshift({
                    id: 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                    kind: /^image\//.test(f.type) ? 'image' : 'file',
                    name: f.name, mime: f.type, size: f.size, data: String(reader.result),
                    source: 'upload', savedBy: (who.name || 'you'), note: '', time: new Date().toISOString()
                });
                store.write(store.KEYS.inventory, items);
                render();
            };
            reader.readAsDataURL(f);
        });
    }

    function init() {
        load();
        ui.initChips('invFilters', 'data-inv-filter', function (v) { filter = v || 'all'; render(); });

        var search = byId('invSearch');
        var clear = byId('invSearchClear');
        if (search) {
            /* Debounced: every item carries its file inline, so a redraw on
               each keystroke is expensive on a large inventory. */
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
            fileInput.addEventListener('change', function () { uploadFiles(fileInput.files); fileInput.value = ''; });
        }

        var lb = byId('invLightbox');
        if (lb) lb.addEventListener('click', function () { ui.closeModal('invLightbox'); });

        window.addEventListener('storage', function (e) { if (e.key === store.KEYS.inventory) load(); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window, document);
