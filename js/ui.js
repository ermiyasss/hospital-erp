/* ==========================================================================
   MediTrack Hospital ERP - Shared UI primitives

   Every page had its own private copy of initCustomSelect, its own modal
   open/close code and its own field-validation helpers. They had drifted
   apart, which is why some dropdowns closed on outside click and others did
   not, and why some modals left the shell permanently blurred.

   One implementation, used everywhere.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;

    function esc(s) {
        return store ? store.escapeHtml(s) : String(s == null ? '' : s);
    }

    function icon(name, size) {
        return window.MediIcons ? window.MediIcons.svg(name, size || 16) : '';
    }

    function loading(show, message) {
        var loader = document.getElementById('appLoader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'appLoader';
            loader.className = 'app-loader';
            loader.setAttribute('role', 'status');
            loader.setAttribute('aria-live', 'polite');
            loader.innerHTML = '<span class="app-loader-spinner" aria-hidden="true"></span><span class="app-loader-message"></span>';
            document.body.appendChild(loader);
        }
        var text = qs('.app-loader-message', loader);
        if (text) text.textContent = message || 'Loading…';
        loader.hidden = !show;
        return loader;
    }

    function qs(sel, root) { return (root || document).querySelector(sel); }
    function qsa(sel, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    }

    function selectMenu(wrapper) {
        return qs('.cs-menu', wrapper) || wrapper.__csMenu || null;
    }

    /* ==================================================================
       Custom select
       Markup contract (unchanged from the existing pages):
         <div class="custom-select" id="x">
           <button class="cs-toggle" data-value="v"><span class="cs-text">Label</span>…</button>
           <ul class="cs-menu"><li class="cs-option" data-value="v">Label</li></ul>
         </div>
       ================================================================== */
    var selectsBound = false;

    function clearSelectEscape(wrapper) {
        var m = selectMenu(wrapper);
        if (m) {
            m.classList.remove('cs-portaled');
            m.style.position = ''; m.style.top = ''; m.style.bottom = '';
            m.style.left = ''; m.style.width = ''; m.style.right = '';
            m.style.maxHeight = '';
            returnMenuFromPortal(m);
        }
        /* Release any modal ancestors an older build may have marked. */
        var node = wrapper.parentElement;
        while (node) {
            node.classList.remove('cs-escape');
            if (node.classList.contains('modal-overlay')) break;
            node = node.parentElement;
        }
    }

    /* ------------------------------------------------------------------
       Menu portal

       A dropdown inside a dialog has to escape two things at once: the
       scrolling .modal-body and the rounded, overflow-hidden .modal-box.
       `position: fixed` cannot help, because .modal-box carries a transform
       (the open animation) and a transform makes the box a containing block
       for fixed descendants — the menu would still be clipped.

       So an open menu is physically moved to <body> and given fixed
       coordinates, then moved back to its original slot when it closes.
       Moving the node (rather than cloning it) keeps every listener that
       pages bound to it intact.
       ------------------------------------------------------------------ */
    function sendMenuToPortal(menu) {
        if (!menu || menu.parentNode === document.body) return;
        menu.__csHome = menu.parentNode;
        menu.__csNext = menu.nextSibling;
        menu.__csWrapper = menu.closest ? menu.closest('.custom-select') : null;
        if (menu.__csWrapper) menu.__csWrapper.__csMenu = menu;
        document.body.appendChild(menu);
        menu.classList.add('cs-portaled');
    }

    function returnMenuFromPortal(menu) {
        if (!menu || !menu.__csHome) return;
        var home = menu.__csHome;
        var next = menu.__csNext;
        menu.__csHome = null;
        menu.__csNext = null;
        menu.classList.remove('cs-portaled');
        try {
            if (next && next.parentNode === home) home.insertBefore(menu, next);
            else home.appendChild(menu);
        } catch (e) {
            home.appendChild(menu);
        }
        if (menu.__csWrapper) menu.__csWrapper.__csMenu = menu;
    }

    function closeAllSelects(except) {
        qsa('.custom-select.active').forEach(function (el) {
            if (el === except) return;
            el.classList.remove('active', 'open-up');
            el.setAttribute('aria-expanded', 'false');
            var menu = selectMenu(el);
            if (menu) menu.classList.remove('cs-portaled-open');
            clearSelectEscape(el);
        });
    }

    /* Measure an open menu and pin it under (or over) its toggle in viewport
       coordinates. Called on open and again whenever the page scrolls, so the
       menu stays glued to the control instead of floating away from it. */
    function positionSelectMenu(wrapper) {
        var toggle = qs('.cs-toggle', wrapper);
        var menu = selectMenu(wrapper);
        if (!toggle || !menu) return;

        sendMenuToPortal(menu);

        /* Let the menu lay itself out at full width before measuring, so a
           menu that has never been opened still reports a sane height. */
        var rect = toggle.getBoundingClientRect();
        var width = Math.max(rect.width, menu.offsetWidth || 0, 158);

        menu.style.width = width + 'px';

        var gap = 3;
        var margin = 8;
        var full = menu.scrollHeight + 6;
        var below = window.innerHeight - rect.bottom - gap - margin;
        var above = rect.top - gap - margin;

        /* Prefer whichever side has room for the whole list; if neither does,
           take the roomier side and cap the height to what is available. */
        var openUp = false;
        var available;
        if (full <= below) { openUp = false; available = below; }
        else if (full <= above) { openUp = true; available = above; }
        else { openUp = above > below; available = Math.max(120, openUp ? above : below); }

        var height = Math.min(full, Math.min(252, available));

        wrapper.classList.toggle('open-up', openUp);
        menu.style.maxHeight = height + 'px';
        menu.style.bottom = '';
        /* Always pin by top: an explicit bottom would fight the height and
           stretch the menu across the gap. */
        menu.style.top = Math.round(openUp ? (rect.top - gap - height) : (rect.bottom + gap)) + 'px';

        var left = rect.left;
        var overflowRight = (left + width) - (window.innerWidth - margin);
        if (overflowRight > 0) left = Math.max(margin, left - overflowRight);
        menu.style.left = Math.round(left) + 'px';

        return menu;
    }

    /* Re-pin every open menu — used on scroll and resize. */
    function repositionOpenSelects() {
        qsa('.custom-select.active').forEach(function (el) {
            var menu = selectMenu(el);
            if (menu && menu.classList.contains('cs-portaled')) positionSelectMenu(el);
        });
    }

    function bindGlobalSelectDismiss() {
        if (selectsBound) return;
        selectsBound = true;
        document.addEventListener('click', function () { closeAllSelects(); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeAllSelects();
        });
        /* The menu lives in a portal now, so it no longer travels with its
           toggle. Re-pin it while the page or a modal body scrolls, and drop
           it entirely once the toggle has scrolled out of sight. */
        window.addEventListener('scroll', function () {
            qsa('.custom-select.active').forEach(function (el) {
                var toggle = qs('.cs-toggle', el);
                if (!toggle) return;
                var r = toggle.getBoundingClientRect();
                if (r.bottom < 0 || r.top > window.innerHeight) closeAllSelects(el);
                else repositionOpenSelects();
            });
        }, true);
        window.addEventListener('resize', repositionOpenSelects);
    }

    function initSelect(target, onChange) {
        var wrapper = typeof target === 'string' ? document.getElementById(target) : target;
        if (!wrapper || wrapper.getAttribute('data-cs-ready') === '1') {
            return wrapper ? selectApi(wrapper) : null;
        }

        var toggle = qs('.cs-toggle', wrapper);
        var menu = qs('.cs-menu', wrapper);
        if (!toggle || !menu) return null;

        wrapper.setAttribute('data-cs-ready', '1');
        toggle.setAttribute('aria-haspopup', 'listbox');
        toggle.setAttribute('aria-expanded', 'false');

        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            var willOpen = !wrapper.classList.contains('active');
            closeAllSelects(wrapper);
            if (willOpen) positionSelectMenu(wrapper);
            else clearSelectEscape(wrapper);
            wrapper.classList.toggle('active', willOpen);
            toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            var activeMenu = selectMenu(wrapper);
            if (activeMenu) activeMenu.classList.toggle('cs-portaled-open', willOpen);
        });

        menu.addEventListener('click', function (e) {
            var opt = e.target.closest ? e.target.closest('.cs-option') : null;
            if (!opt || !menu.contains(opt)) return;
            e.stopPropagation();

            var value = opt.getAttribute('data-value');
            /* Label text only: option markup may contain helper spans. */
            var label = (opt.getAttribute('data-label') || opt.textContent || '').trim();

            setSelectValue(wrapper, value, label);
            wrapper.classList.remove('active');
            toggle.setAttribute('aria-expanded', 'false');
            menu.classList.remove('cs-portaled-open');
            clearSelectEscape(wrapper);
            if (onChange) onChange(value, label);
        });

        bindGlobalSelectDismiss();
        return selectApi(wrapper);
    }

    function setSelectValue(target, value, label) {
        var wrapper = typeof target === 'string' ? document.getElementById(target) : target;
        if (!wrapper) return;
        var toggle = qs('.cs-toggle', wrapper);
        if (!toggle) return;

        var match = null;
        qsa('.cs-option', selectMenu(wrapper) || wrapper).forEach(function (o) {
            var hit = o.getAttribute('data-value') === value;
            o.classList.toggle('selected', hit);
            if (hit) match = o;
        });

        var text = label || (match ? (match.getAttribute('data-label') || match.textContent).trim() : value);
        var textEl = qs('.cs-text', toggle);
        if (textEl) textEl.textContent = text;
        toggle.setAttribute('data-value', value == null ? '' : value);
    }

    function getSelectValue(target) {
        var wrapper = typeof target === 'string' ? document.getElementById(target) : target;
        if (!wrapper) return '';
        var toggle = qs('.cs-toggle', wrapper);
        return toggle ? (toggle.getAttribute('data-value') || '') : '';
    }

    function selectApi(wrapper) {
        return {
            el: wrapper,
            get: function () { return getSelectValue(wrapper); },
            set: function (v, label) { setSelectValue(wrapper, v, label); }
        };
    }

    /* ==================================================================
       Modals
       Contract: <div class="modal-overlay" id="x"> … </div>
       Adds/removes .active, blurs the shell behind the iframe, restores
       focus, closes on Escape and on backdrop click.
       ================================================================== */
    var openModals = [];
    var modalKeyBound = false;
    var lastFocused = null;

    function bindModalKey() {
        if (modalKeyBound) return;
        modalKeyBound = true;
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape' || !openModals.length) return;
            closeModal(openModals[openModals.length - 1]);
        });
    }

    function openModal(target) {
        var el = typeof target === 'string' ? document.getElementById(target) : target;
        if (!el || el.classList.contains('active')) return;

        lastFocused = document.activeElement;
        el.classList.add('active');
        el.removeAttribute('aria-hidden');
        openModals.push(el);
        if (store) store.setOverlayBlur(true);

        if (el.getAttribute('data-modal-ready') !== '1') {
            el.setAttribute('data-modal-ready', '1');
            el.addEventListener('click', function (e) {
                if (e.target === el) closeModal(el);
            });
            qsa('[data-modal-close]', el).forEach(function (btn) {
                btn.addEventListener('click', function () { closeModal(el); });
            });
        }

        var focusTarget = qs('[data-autofocus]', el) ||
            qs('input:not([type=hidden]), textarea, select, button', el);
        if (focusTarget) {
            try { focusTarget.focus(); } catch (e) {}
        }
        bindModalKey();
    }

    function closeModal(target) {
        var el = typeof target === 'string' ? document.getElementById(target) : target;
        if (!el) return;
        el.classList.remove('active');
        el.setAttribute('aria-hidden', 'true');
        openModals = openModals.filter(function (m) { return m !== el; });
        if (!openModals.length && store) store.setOverlayBlur(false);
        if (lastFocused && !openModals.length) {
            try { lastFocused.focus(); } catch (e) {}
            lastFocused = null;
        }
    }

    function closeAllModals() {
        openModals.slice().forEach(closeModal);
    }

    /* ==================================================================
       Tabs
       Contract: buttons carry data-<attr> pointing at a panel id; the
       active panel gets .active. Works for both workspace and page tabs.
       ================================================================== */
    function initTabs(options) {
        var buttons = qsa(options.buttonSelector);
        if (!buttons.length) return;
        var panels = qsa(options.panelSelector);
        var attr = options.attribute || 'data-tab';

        buttons.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute(attr);
                buttons.forEach(function (b) {
                    var on = b === btn;
                    b.classList.toggle('active', on);
                    if (b.getAttribute('role') === 'tab') b.setAttribute('aria-selected', on ? 'true' : 'false');
                });
                panels.forEach(function (p) { p.classList.toggle('active', p.id === id); });
                if (options.onChange) options.onChange(id, btn);
            });
        });
    }

    /* ==================================================================
       Chip groups (single-select filter pills)
       ================================================================== */
    function initChips(container, attribute, onChange) {
        var host = typeof container === 'string' ? document.getElementById(container) : container;
        if (!host) return;
        var chips = qsa('[' + attribute + ']', host);
        if (!chips.length) return;

        if (!chips.some(function (c) { return c.classList.contains('active'); })) {
            chips[0].classList.add('active');
        }

        host.addEventListener('click', function (e) {
            var chip = e.target.closest ? e.target.closest('[' + attribute + ']') : null;
            if (!chip || !host.contains(chip)) return;
            chips.forEach(function (c) { c.classList.toggle('active', c === chip); });
            if (onChange) onChange(chip.getAttribute(attribute), chip);
        });
    }

    /* ==================================================================
       Inline field validation
       Replaces the alert() calls that blocked the whole window.
       ================================================================== */
    function fieldError(inputId, message) {
        var input = document.getElementById(inputId);
        if (!input) return false;
        input.classList.add('input-error');
        input.setAttribute('aria-invalid', 'true');

        var msgId = inputId + '__err';
        var msg = document.getElementById(msgId);
        if (!msg) {
            msg = document.createElement('span');
            msg.id = msgId;
            msg.className = 'field-error';
            var host = input.parentNode;
            if (host) host.appendChild(msg);
        }
        msg.innerHTML = icon('warning', 13) + '<span>' + esc(message) + '</span>';
        msg.classList.add('visible');
        return false;
    }

    function clearFieldError(inputId) {
        var input = document.getElementById(inputId);
        if (input) {
            input.classList.remove('input-error');
            input.removeAttribute('aria-invalid');
        }
        var msg = document.getElementById(inputId + '__err');
        if (msg) msg.classList.remove('visible');
    }

    function requireFields(specs) {
        var firstBad = null;
        specs.forEach(function (spec) {
            var input = document.getElementById(spec.id);
            if (!input) return;
            var value = String(input.value || '').trim();
            var bad = !value;
            if (!bad && spec.test && !spec.test(value)) bad = true;
            if (bad) {
                fieldError(spec.id, spec.message || 'This field is required.');
                if (!firstBad) firstBad = input;
            } else {
                clearFieldError(spec.id);
            }
        });
        if (firstBad) {
            try { firstBad.focus(); } catch (e) {}
            return false;
        }
        return true;
    }

    /* Clears validation state as soon as the clinician starts typing. */
    function bindLiveValidation(ids) {
        ids.forEach(function (id) {
            var el = document.getElementById(id);
            if (!el || el.getAttribute('data-live-valid') === '1') return;
            el.setAttribute('data-live-valid', '1');
            el.addEventListener('input', function () { clearFieldError(id); });
        });
    }

    /* ==================================================================
       Empty state + confirm dialog
       ================================================================== */
    function emptyState(opts) {
        return '<div class="empty-state">' +
            '<span class="empty-state-icon">' + icon(opts.icon || 'info', 24) + '</span>' +
            '<p>' + esc(opts.title || 'Nothing to show') + '</p>' +
            (opts.text ? '<span>' + esc(opts.text) + '</span>' : '') +
        '</div>';
    }

    /* Promise-free confirm so callers stay ES5-simple. */
    function confirmAction(opts, onConfirm) {
        var id = 'uiConfirmOverlay';
        var existing = document.getElementById(id);
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay confirm-overlay';
        overlay.id = id;
        overlay.innerHTML =
            '<div class="modal-box modal-sm" role="dialog" aria-modal="true">' +
                '<div class="modal-head">' +
                    '<span class="modal-head-icon tone-' + esc(opts.tone || 'danger') + '">' +
                        icon(opts.icon || 'warning', 17) +
                    '</span>' +
                    '<div class="modal-head-text">' +
                        '<h3>' + esc(opts.title || 'Confirm') + '</h3>' +
                        (opts.subtitle ? '<span>' + esc(opts.subtitle) + '</span>' : '') +
                    '</div>' +
                '</div>' +
                '<div class="modal-body"><p class="confirm-text">' + esc(opts.message || '') + '</p></div>' +
                '<div class="modal-foot">' +
                    '<button type="button" class="btn-secondary" data-confirm-cancel>' +
                        esc(opts.cancelLabel || 'Cancel') + '</button>' +
                    '<button type="button" class="btn-' + (opts.tone === 'danger' ? 'danger' : 'primary') +
                        '" data-confirm-ok>' + esc(opts.confirmLabel || 'Confirm') + '</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);
        if (window.MediIcons) window.MediIcons.hydrate(overlay);

        function done(run) {
            closeModal(overlay);
            setTimeout(function () {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                if (run && onConfirm) onConfirm();
                if (!run && opts.onCancel) opts.onCancel();
            }, 180);
        }

        qs('[data-confirm-cancel]', overlay).addEventListener('click', function () { done(false); });
        qs('[data-confirm-ok]', overlay).addEventListener('click', function () { done(true); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) done(false); });

        openModal(overlay);
    }

    /* ==================================================================
       Print a single node without dragging the whole shell into the sheet

       window.print() inside the dashboard iframe prints whatever the print
       CSS leaves visible, which silently produced blank sheets whenever the
       target sat inside a modal. Instead we clone the node into a hidden
       iframe together with every stylesheet of the page, force the light
       "paper" palette and print that document directly.
       ================================================================== */
    function printNode(node, title) {
        var el = typeof node === 'string' ? document.getElementById(node) : node;
        if (!el) { window.print(); return; }

        var frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.style.position = 'fixed';
        frame.style.right = '0';
        frame.style.bottom = '0';
        frame.style.width = '0';
        frame.style.height = '0';
        frame.style.border = '0';
        frame.style.visibility = 'hidden';
        document.body.appendChild(frame);

        var doc = frame.contentWindow.document;
        var stylesHtml = qsa('link[rel="stylesheet"], style', document).map(function (s) {
            return s.outerHTML;
        }).join('\n');

        doc.open();
        doc.write('<!DOCTYPE html><html lang="en" data-theme="light"><head><meta charset="UTF-8">' +
            '<title>' + esc(title || 'Print') + '</title>' +
            stylesHtml +
            '<style>' +
            'html,body{margin:0!important;padding:0!important;background:#fff!important;}' +
            '[data-theme]{--white:#FFFFFF;}' +
            /* Paper is always white, so every token that can end up as text
               or line colour is pinned to its light value here. Without this
               a dark UI theme printed light-on-white and looked broken. */
            ':root{--text-dark:#16202C!important;--text-strong:#16202C!important;' +
            '--text-body:#38414D!important;--gray-muted:#6B7480!important;' +
            '--text-faint:#8A929C!important;--text-invert:#FFFFFF!important;' +
            '--surface:#FFFFFF!important;--surface-alt:#F7F8FA!important;' +
            '--surface-sunken:#F1F3F6!important;--gray-border:#E3E6EB!important;' +
            '--border-strong:#CFD4DC!important;color-scheme:light!important;}' +
            'body{color:#16202C!important;}' +
            /* Belt-and-braces readability pass: dark ink on everything, no
               fills that could swallow text, light rules between rows. Any
               component whose stylesheet forgot a print rule still prints
               legible, whatever theme the workstation was in. */
            'body *{color:#16202C!important;background-color:transparent!important;' +
            'box-shadow:none!important;text-shadow:none!important;border-color:#DDE2E9!important;}' +
            '.data-table th,thead th,.list-head{background-color:#F1F3F6!important;}' +
            '.modal-overlay,.modal-box{position:static!important;background:none!important;padding:0!important;margin:0!important;border:none!important;box-shadow:none!important;max-width:none!important;max-height:none!important;overflow:visible!important;opacity:1!important;visibility:visible!important;transform:none!important;}' +
            '.modal-head,.modal-foot,.toolbar,.no-print{display:none!important;}' +
            '</style></head><body>' + el.outerHTML + '</body></html>');
        doc.close();

        function doPrint() {
            try {
                frame.contentWindow.focus();
                frame.contentWindow.print();
            } catch (e) {}
            setTimeout(function () {
                if (frame.parentNode) frame.parentNode.removeChild(frame);
            }, 500);
        }

        if (doc.readyState === 'complete') setTimeout(doPrint, 120);
        else frame.onload = function () { setTimeout(doPrint, 120); };
    }

    /* ==================================================================
        Excel download
        Writes an Excel 2003 XML workbook (.xls) — opens natively in Excel
        with real headers and column types, no library or network needed.
        opts: { filename, sheetName, title, headers: [..], rows: [[..], ..] }
        ================================================================== */
    function xmlCell(v) {
        var t = v === null || v === undefined ? '' : String(v);
        var isNum = t !== '' && !isNaN(Number(t)) && isFinite(Number(t));
        return '<Cell' + (isNum ? '' : ' ss:StyleID="sText"') + '><Data ss:Type="' +
            (isNum ? 'Number' : 'String') + '">' +
            t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
            '</Data></Cell>';
    }

    function downloadExcel(opts) {
        if (!opts || !opts.headers) return;
        var rows = opts.rows || [];
        var sheet = String(opts.sheetName || 'Sheet1')
            .replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 31) || 'Sheet1';

        var body = '';
        if (opts.title) {
            body += '<Row><Cell ss:StyleID="sTitle"><Data ss:Type="String">' +
                esc(opts.title) + '</Data></Cell></Row>' +
                '<Row><Cell><Data ss:Type="String">' +
                esc(new Date().toLocaleString()) + '</Data></Cell></Row><Row/>';
        }
        body += '<Row>' + opts.headers.map(function (h) {
            return '<Cell ss:StyleID="sHead"><Data ss:Type="String">' +
                esc(h == null ? '' : h) + '</Data></Cell>';
        }).join('') + '</Row>';
        rows.forEach(function (r) {
            body += '<Row>' + opts.headers.map(function (h, i) {
                return xmlCell(r[i]);
            }).join('') + '</Row>';
        });

        var xml =
            '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>' +
            '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
            'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
            '<Styles>' +
            '<Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Segoe UI" ss:Size="10"/></Style>' +
            '<Style ss:ID="sTitle"><Font ss:FontName="Segoe UI" ss:Size="13" ss:Bold="1"/></Style>' +
            '<Style ss:ID="sHead"><Font ss:Bold="1"/><Interior ss:Color="#EAF2FB" ss:Pattern="Solid"/></Style>' +
            '<Style ss:ID="sText"><NumberFormat ss:Format="@"/></Style>' +
            '</Styles>' +
            '<Worksheet ss:Name="' + esc(sheet) + '"><Table>' + body + '</Table>' +
            '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">' +
            '<FreezePanes/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane>' +
            '<ActivePane>2</ActivePane></WorksheetOptions>' +
            '</Worksheet></Workbook>';

        var blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = opts.filename || ('MediTrack_' + new Date().toISOString().slice(0, 10) + '.xls');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    window.MediUI = {
        qs: qs,
        qsa: qsa,
        icon: icon,
        initSelect: initSelect,
        setSelectValue: setSelectValue,
        getSelectValue: getSelectValue,
        closeAllSelects: closeAllSelects,
        openModal: openModal,
        closeModal: closeModal,
        closeAllModals: closeAllModals,
        initTabs: initTabs,
        initChips: initChips,
        fieldError: fieldError,
        clearFieldError: clearFieldError,
        requireFields: requireFields,
        bindLiveValidation: bindLiveValidation,
        emptyState: emptyState,
        confirmAction: confirmAction,
        printNode: printNode,
        downloadExcel: downloadExcel,
        loading: loading
    };
})(window, document);
