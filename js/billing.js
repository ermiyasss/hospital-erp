/* ==========================================================================
   MediTrack Hospital ERP - Billing

   The front-office money screen:

     - bills can be created free-hand or pulled from a patient's record
     - payments are taken as Cash, Telebirr (simulated wallet checkout with
       phone-number confirmation), card, transfer, insurance or waiver
     - a newly registered patient only joins the waiting list once their
       bill is settled, so the queue is never ahead of the money
     - a visit finished by the doctor raises one final bill; this page opens
       it automatically so reception can settle it straight away

   All persistence goes through js/store.js (clinic_invoices).
   ========================================================================== */

(function (window, document) {
    'use strict';

    var store = window.MediStore;
    var ui = window.MediUI;

    var invoices = [];
    var patients = [];

    /* Filters ---------------------------------------------------------- */
    var searchTerm = '';
    var statusFilter = 'active';
    var periodFilter = 'all';

    /* Working state ---------------------------------------------------- */
    var draft = null;           /* invoice being created/edited */
    var editingId = null;
    var detailId = null;        /* invoice shown in the detail modal */
    var payingInvoiceId = null; /* invoice in the payment modal */
    var payMethod = 'Telebirr';
    var tbStep = 'number';      /* Telebirr checkout: number -> code */
    var tbExpectedCode = null;  /* simulated code "sent" by Telebirr */
    var tbPhoneValue = '';

    function byId(id) { return document.getElementById(id); }
    function esc(s) { return store.escapeHtml(s); }
    function money(n) { return store.formatMoney(n); }
    function icon(name, size) { return ui.icon(name, size); }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value;
    }

    /* ==================================================================
       Status visuals
       ================================================================== */
    /* Paid reads yellow until discharge turns it green, matching the cards:
       red = owes money, yellow = money taken / may queue, green = gone home. */
    function statusChip(status) {
        var cls, label = status;
        switch (status) {
            case 'Paid':        cls = 'chip chip-warning'; label = 'Paid'; break;
            case 'Partly Paid': cls = 'chip chip-warning'; break;
            case 'Cancelled':   cls = 'chip chip-muted';   break;
            default:            cls = 'chip chip-danger';  label = 'Unpaid'; break;
        }
        return '<span class="' + cls + '">' + esc(label) + '</span>';
    }

    function kindLabel(kind) {
        if (kind === 'final') return 'Final bill';
        if (kind === 'registration') return 'Registration';
        return 'Services';
    }

    /* Charge types offered on a hand-made bill. The description is derived
       from the type so staff never have to type one. */
    var CHARGE_TYPES = {
        'Consultation': { label: 'Consultation cost', description: 'Consultation cost' },
        'Pharmacy':     { label: 'Pharmacy',          description: 'Pharmacy charge' },
        'Queue card':   { label: 'Queue card',        description: 'Queue card' }
    };

    /* ==================================================================
       Stats strip
       ================================================================== */
    function renderStats() {
        var outstanding = 0;
        var outstandingCount = 0;
        var collectedToday = 0;
        var collectedCount = 0;
        var todayKey = new Date().toDateString();
        var billsToday = 0;
        var grandTotal = 0;
        var counted = 0;

        invoices.forEach(function (inv) {
            if (inv.status === 'Cancelled') return;
            var t = store.invoiceTotals(inv);

            if (t.balance > 0) {
                outstanding += t.balance;
                outstandingCount++;
            }

            (inv.payments || []).forEach(function (p) {
                if (new Date(p.at).toDateString() === todayKey) {
                    collectedToday += store.toNumber(p.amount) || 0;
                    collectedCount++;
                }
            });

            if (new Date(inv.createdAt).toDateString() === todayKey) billsToday++;

            grandTotal += t.total;
            counted++;
        });

        setText('statOutstandingAmount', money(outstanding));
        setText('statOutstandingCount',
            outstandingCount ? outstandingCount + ' unpaid bill' + (outstandingCount > 1 ? 's' : '') : 'No unpaid bills');
        setText('statCollectedToday', money(collectedToday));
        setText('statCollectedCount',
            collectedCount ? collectedCount + ' payment' + (collectedCount > 1 ? 's' : '') + ' today' : 'No payments yet today');
        setText('statInvoicesToday', String(billsToday));
        setText('statAverageInvoice', counted ? money(grandTotal / counted) : '—');

        var pill = byId('pillOutstandingWrap');
        if (pill) {
            pill.hidden = outstandingCount === 0;
            setText('pillOutstanding', String(outstandingCount));
        }
    }

    /* ==================================================================
       Filters
       ================================================================== */
    function inPeriod(inv) {
        if (periodFilter === 'all') return true;
        var created = new Date(inv.createdAt).getTime();
        if (isNaN(created)) return false;
        if (periodFilter === 'today') {
            return new Date(inv.createdAt).toDateString() === new Date().toDateString();
        }
        var days = Number(periodFilter) || 0;
        return created >= Date.now() - days * 86400000;
    }

    function matchesFilters(inv) {
        var discharged = !!inv.discharged;

        if (statusFilter === 'Discharged') {
            if (!discharged) return false;
        } else if (statusFilter === 'active') {
            /* Everything still on the billing desk: unpaid, partly paid and
               settled bills that have not been discharged yet. */
            if (inv.status === 'Cancelled' || discharged) return false;
        } else if (statusFilter === 'open') {
            if (inv.status === 'Paid' || inv.status === 'Cancelled' || discharged) return false;
        } else if (statusFilter === 'Paid') {
            /* Settled bills stay visible with the patient name until the
               final payment has been recorded at discharge. */
            if (inv.status !== 'Paid' || discharged) return false;
        } else if (statusFilter !== 'all') {
            if (inv.status !== statusFilter || discharged) return false;
        }
        if (!inPeriod(inv)) return false;

        if (!searchTerm) return true;
        var q = searchTerm.toLowerCase();
        return String(inv.number || '').toLowerCase().indexOf(q) !== -1 ||
            String(inv.patientName || '').toLowerCase().indexOf(q) !== -1 ||
            String(inv.trackingId || '').toLowerCase().indexOf(q) !== -1;
    }

    /* The journey of a bill drives its colour:
       Unpaid   -> red    (card fee or final bill waiting)
       Paid     -> yellow (card paid · awaiting final payment)
       Settled  -> green  (final payment taken, patient discharged)
       Overdue  -> yellow part-paid; Cancelled -> grey */
    function stageOf(inv) {
        if (inv.status === 'Cancelled') return 'cancelled';
        if (inv.discharged) return 'done';
        switch (inv.status) {
            case 'Paid':        return 'paid';
            case 'Partly Paid': return 'part';
            default:            return 'unpaid';
        }
    }

    function stageChip(inv) {
        var map = {
            unpaid:    ['stage-unpaid', 'Unpaid'],
            part:      ['stage-part',   'Part paid'],
            paid:      ['stage-paid',
                           inv.kind === 'registration' ? 'Awaiting final payment' : 'Paid'],
            done:      ['stage-done',   'Settled · discharged'],
            cancelled: ['stage-cancelled', 'Cancelled']
        };
        var s = map[stageOf(inv)] || map.unpaid;
        return '<span class="bl-stage ' + s[0] + '">' + esc(s[1]) + '</span>';
    }

    function renderCards() {
        var host = byId('billCards');
        var emptyHost = byId('invoiceEmptyHost');
        if (!host) return;

        var list = invoices.filter(matchesFilters);
        setText('invoiceResultCount', list.length + (list.length === 1 ? ' bill' : ' bills'));

        if (!list.length) {
            host.hidden = true;
            byId('billListHead').hidden = true;
            emptyHost.innerHTML = ui.emptyState({
                icon: invoices.length ? 'search' : 'receipt',
                title: invoices.length ? 'No bills match' : 'No bills yet',
                text: invoices.length
                    ? 'Clear the search or the filters to see more bills.'
                    : 'Register a patient to raise their queue-card bill, or create one with the “New bill” button.'
            });
            return;
        }

        host.hidden = false;
        byId('billListHead').hidden = false;
        emptyHost.innerHTML = '';

        host.innerHTML = list.map(function (inv) {
            var t = store.invoiceTotals(inv);
            var stage = stageOf(inv);
            var canPay = t.balance > 0 && inv.status !== 'Cancelled' && !inv.discharged;
            var canFinalize = (stage === 'paid' || stage === 'part') && inv.kind !== 'service';

            return '<div class="bl-row stage-' + stage + '" data-inv="' + esc(inv.id) + '" title="Open bill">' +
                '<span class="bl-num mono">' + esc(inv.number) + '</span>' +
                '<span class="bl-patient">' +
                    '<span class="mini-avatar">' + esc(store.initials(inv.patientName)) + '</span>' +
                    '<span class="bl-patient-text">' +
                        '<span class="bl-name">' + esc(inv.patientName || '—') + '</span>' +
                        '<span class="bl-sub mono">' + esc(inv.trackingId || '') + '</span>' +
                    '</span>' +
                '</span>' +
                '<span class="bl-kind">' +
                    esc(kindLabel(inv.kind)) +
                    '<em>' + esc(store.formatDateTime(inv.createdAt)) + '</em>' +
                '</span>' +
                '<span class="bl-amt"><strong class="mono">' + money(t.total) + '</strong><em>total</em></span>' +
                stageChip(inv) +
                '<span class="bl-actions">' +
                    (canPay
                        ? '<button type="button" class="btn-mini btn-mini-primary" data-quickpay="' + esc(inv.id) + '">' +
                              icon('cash', 13) + ' Card payment</button>'
                        : '') +
                    (canFinalize
                        ? '<button type="button" class="btn-mini btn-mini-primary" data-finalize="' + esc(inv.id) + '">' +
                              icon('check-circle', 13) + ' Final payment</button>'
                        : '') +
                    '<button type="button" class="btn-mini" data-slip="' + esc(inv.id) + '" title="Print slip">' +
                        icon('print', 13) + '</button>' +
                '</span>' +
            '</div>';
        }).join('');

        bindCards();
    }

    function bindCards() {
        var host = byId('billCards');
        if (!host) return;

        ui.qsa('[data-open]', host).forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                openDetail(btn.getAttribute('data-open'));
            });
        });
        ui.qsa('[data-quickpay]', host).forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                openPayment(btn.getAttribute('data-quickpay'));
            });
        });
        ui.qsa('[data-slip]', host).forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                printSlip(btn.getAttribute('data-slip'));
            });
        });
        ui.qsa('[data-finalize]', host).forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                openDischarge(btn.getAttribute('data-finalize'));
            });
        });
        ui.qsa('.bl-row[data-inv]', host).forEach(function (row) {
            row.addEventListener('click', function () {
                openDetail(row.getAttribute('data-inv'));
            });
        });
    }

    function refresh() {
        invoices = store.readInvoices();
        patients = store.readPatients();
        renderStats();
        renderCards();
    }

    /* ==================================================================
       New / edit bill
       ================================================================== */
    function blankDraft() {
        return {
            patientId: null,
            patientName: '',
            trackingId: '',
            kind: 'service',
            items: [],
            discount: 0,
            discountType: 'percent',
            note: ''
        };
    }

    function fillPatientMenu(selectedId) {
        var menu = byId('invPatientMenu');
        if (!menu) return;

        var opts = patients.map(function (p) {
            var label = p.name + ' · ' + p.trackingId +
                (p.status === store.STATUS.AWAITING_PAYMENT ? ' (awaiting payment)' : '');
            return '<li class="cs-option' + (String(p.id) === String(selectedId) ? ' selected' : '') +
                '" data-value="' + esc(p.id) + '" data-label="' + esc(p.name) + '">' +
                '<span class="cs-main">' + esc(p.name) + '</span>' +
                '<span class="cs-sub mono">' + esc(p.trackingId) + '</span>' +
            '</li>';
        });

        menu.innerHTML = opts.join('') ||
            '<li class="cs-empty">No patients on file yet. Register the patient first.</li>';
    }

    function renderDraft() {
        if (!draft) return;

        /* Patient summary */
        var summary = byId('invPatientSummary');
        if (summary) {
            if (draft.patientId !== null) {
                summary.hidden = false;
                setText('invPatientName', draft.patientName);
                setText('invPatientMeta',
                    (draft.trackingId ? draft.trackingId + ' · ' : '') +
                    (draft.awaitingPayment ? 'Waiting for their bill to be settled' : 'Already queued or seen'));
            } else {
                summary.hidden = true;
            }
        }

        /* Line items */
        var host = byId('lineItems');
        if (host) {
            if (!draft.items.length) {
                host.innerHTML = '<div class="line-items-empty">' +
                    icon('list', 20) +
                    '<p>No charges yet</p>' +
                    '<span>Add items below, or use “Add from record” to pull every outstanding charge for this patient.</span>' +
                '</div>';
            } else {
                host.innerHTML = draft.items.map(function (it, i) {
                    var line = (store.toNumber(it.qty) || 1) * (store.toNumber(it.price) || 0);
                    return '<div class="line-item" data-line="' + i + '">' +
                        '<span class="li-cat">' + esc(it.category) + '</span>' +
                        '<span class="li-desc">' + esc(it.description) + '</span>' +
                        '<span class="li-qty">' + esc(String(it.qty)) + '</span>' +
                        '<span class="li-price">' + money(it.price) + '</span>' +
                        '<span class="li-total">' + money(line) + '</span>' +
                        '<button type="button" class="li-remove" data-remove-line="' + i + '" aria-label="Remove line">' +
                            icon('close', 13) + '</button>' +
                    '</div>';
                }).join('');

                ui.qsa('[data-remove-line]', host).forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        draft.items.splice(Number(btn.getAttribute('data-remove-line')), 1);
                        renderDraft();
                    });
                });
            }
        }

        renderDraftTotals();
    }

    function renderDraftTotals() {
        var box = byId('invoiceTotals');
        if (!box || !draft) return;

        var t = draftTotals(draft);
        box.innerHTML =
            row('Subtotal', money(t.subtotal)) +
            (t.discountAmount > 0 ? row('Discount', '− ' + money(t.discountAmount)) : '') +
            row('Total due', '<strong>' + money(t.total) + '</strong>', true);

        function row(label, value, strong) {
            return '<div class="totals-row' + (strong ? ' totals-strong' : '') + '">' +
                '<span>' + label + '</span><span>' + value + '</span></div>';
        }
    }

    function draftTotals(d) {
        var subtotal = 0;
        (d.items || []).forEach(function (it) {
            subtotal += (store.toNumber(it.qty) || 1) * (store.toNumber(it.price) || 0);
        });
        var discount = store.toNumber(d.discount) || 0;
        var discountAmount = d.discountType === 'amount'
            ? Math.min(discount, subtotal)
            : subtotal * Math.min(discount, 100) / 100;
        return {
            subtotal: subtotal,
            discountAmount: discountAmount,
            total: Math.max(0, subtotal - discountAmount)
        };
    }

    function openNewInvoice() {
        editingId = null;
        draft = blankDraft();

        fillPatientMenu('');
        ui.setSelectValue('invPatientWrapper', '', 'Choose a patient');
        ui.setSelectValue('newItemCategoryWrapper', 'Consultation', 'Consultation cost');
        ui.setSelectValue('invDiscountTypeWrapper', 'percent', 'Percentage');
        byId('newItemQty').value = '1';
        byId('newItemPrice').value = '';
        byId('invDiscount').value = '0';
        byId('invNote').value = '';

        setText('invoiceModalTitle', 'New bill');
        setText('invoiceModalSub', 'Choose the patient, then add what they are being charged for');
        setText('saveInvoiceLabel', 'Save bill');

        renderDraft();
        ui.openModal('invoiceModal');
    }

    function openEditInvoice(id) {
        var inv = store.findInvoice(id);
        if (!inv) return;
        if (inv.status === 'Paid') {
            window.MediTrackNotify.flash('Bill already settled', 'A paid bill can no longer be edited.');
            return;
        }

        editingId = id;
        draft = {
            patientId: inv.patientId,
            patientName: inv.patientName,
            trackingId: inv.trackingId,
            kind: inv.kind,
            items: JSON.parse(JSON.stringify(inv.items || [])),
            discount: inv.discount || 0,
            discountType: inv.discountType || 'percent',
            note: inv.note || '',
            awaitingPayment: false
        };

        fillPatientMenu(inv.patientId);
        ui.setSelectValue('invPatientWrapper', String(inv.patientId), inv.patientName);
        ui.setSelectValue('invDiscountTypeWrapper', draft.discountType,
            draft.discountType === 'amount' ? 'A fixed amount off' : 'Percentage');
        byId('invDiscount').value = draft.discount;
        byId('invNote').value = draft.note;

        setText('invoiceModalTitle', 'Edit ' + inv.number);
        setText('invoiceModalSub', 'Adjust the charges on this bill');
        setText('saveInvoiceLabel', 'Save changes');

        renderDraft();
        ui.openModal('invoiceModal');
    }

    function pullChargesFromRecord() {
        if (draft.patientId === null) {
            /* Desk-side validation: shown here, never written to the shared
               alert log that every other rank reads. */
            window.MediTrackNotify.flash('Choose a patient first',
                'Pick who this bill is for, then their outstanding charges can be pulled in.',
                'warning');
            return;
        }

        var patient = store.findPatient(patients, draft.patientId);
        if (!patient) return;

        var items = store.buildChargesFromRecord(patient);
        if (!items.length) {
            window.MediTrackNotify.flash('Nothing to add',
                patient.name + "'s record has no open orders to charge for.",
                'info');
            return;
        }

        items.forEach(function (it) { draft.items.push(it); });
        renderDraft();
        window.MediTrackNotify.flash('Charges added',
            items.length + ' charge' + (items.length > 1 ? 's' : '') + ' pulled from ' + patient.name + "'s record.");
    }

    function addDraftItem() {
        var qty = store.toNumber(byId('newItemQty').value) || 1;
        var price = store.toNumber(byId('newItemPrice').value);
        var category = ui.getSelectValue('newItemCategoryWrapper') || 'Consultation';
        var typeMeta = CHARGE_TYPES[category] || { label: category, description: category };

        if (price === null || price <= 0) {
            ui.fieldError('newItemPrice', 'Enter a price above zero.');
            return;
        }

        draft.items.push({
            category: typeMeta.label,
            description: typeMeta.description,
            qty: qty,
            price: price
        });

        byId('newItemPrice').value = '';
        byId('newItemQty').value = '1';
        ui.clearFieldError('newItemPrice');

        renderDraft();
        byId('newItemPrice').focus();
    }

    function saveInvoiceDraft() {
        if (!draft) return;
        if (draft.patientId === null) {
            window.MediTrackNotify.flash('Patient required',
                'Choose who this bill is for before saving.',
                'warning');
            return;
        }
        if (!draft.items.length) {
            window.MediTrackNotify.flash('Nothing to bill',
                'Add at least one charge to the bill.',
                'warning');
            return;
        }

        draft.discount = store.toNumber(byId('invDiscount').value) || 0;
        draft.discountType = ui.getSelectValue('invDiscountTypeWrapper') || 'percent';
        draft.note = byId('invNote').value.trim();

        if (editingId) {
            var inv = store.findInvoice(editingId);
            if (inv) {
                inv.items = draft.items;
                inv.discount = draft.discount;
                inv.discountType = draft.discountType;
                inv.note = draft.note;
                store.saveInvoice(inv);
                window.MediTrackNotify.flash('Bill updated', inv.number + ' saved.');
            }
        } else {
            var created = store.createInvoice(draft);
            window.MediTrackNotify.push(
                'Bill created',
                created.number + ' for ' + draft.patientName + ' · ' +
                    money(store.invoiceTotals(created).total) + '. The patient joins the waiting list once it is paid.',
                'success', 'Billing', 'normal'
            );
        }

        ui.closeModal('invoiceModal');
        refresh();
    }

    /* ==================================================================
       Bill detail
       ================================================================== */
    function paymentsHtml(inv) {
        if (!(inv.payments || []).length) return '';
        var rows = inv.payments.map(function (p) {
            return '<div class="pay-row">' +
                '<span class="pay-method">' + esc(p.method) + '</span>' +
                '<span class="pay-ref">' + esc(p.reference || p.phone || '—') + '</span>' +
                '<span class="pay-time">' + esc(store.formatDateTime(p.at)) + '</span>' +
                '<span class="pay-amount">' + money(p.amount) + '</span>' +
            '</div>';
        }).join('');
        return '<section class="form-section"><h4 class="form-section-title">' +
            icon('cash', 14) + '<span>Payments received</span></h4>' + rows + '</section>';
    }

    function openDetail(id) {
        var inv = store.findInvoice(id);
        if (!inv) return;
        detailId = id;

        var t = store.invoiceTotals(inv);

        setText('detailModalTitle', 'Bill ' + inv.number);
        setText('detailModalSub',
            (inv.patientName || '—') + ' · ' + (inv.trackingId || '') + ' · ' +
            kindLabel(inv.kind) + ' · ' + store.formatDateTime(inv.createdAt));

        var rows = inv.items.map(function (it) {
            var line = (store.toNumber(it.qty) || 1) * (store.toNumber(it.price) || 0);
            return '<tr>' +
                '<td>' + esc(it.category) + '</td>' +
                '<td>' + esc(it.description) + '</td>' +
                '<td class="num">' + esc(String(it.qty)) + '</td>' +
                '<td class="num">' + money(it.price) + '</td>' +
                '<td class="num">' + money(line) + '</td>' +
            '</tr>';
        }).join('');

        byId('detailModalBody').innerHTML =
            '<div class="detail-status-row">' + statusChip(inv.status) +
                (t.balance > 0 && inv.status !== 'Cancelled'
                    ? '<span class="due-pill">' + money(t.balance) + ' due</span>' : '') +
            '</div>' +
            '<div class="table-scroll"><table class="data-table detail-table">' +
                '<thead><tr><th>Type</th><th>Description</th><th class="num">Qty</th>' +
                '<th class="num">Unit</th><th class="num">Line</th></tr></thead>' +
                '<tbody>' + rows + '</tbody>' +
            '</table></div>' +
            '<div class="totals-box detail-totals">' +
                '<div class="totals-row"><span>Subtotal</span><span>' + money(t.subtotal) + '</span></div>' +
                (t.discountAmount > 0 ? '<div class="totals-row"><span>Discount</span><span>− ' + money(t.discountAmount) + '</span></div>' : '') +
                '<div class="totals-row totals-strong"><span>Total</span><span>' + money(t.total) + '</span></div>' +
                '<div class="totals-row"><span>Paid so far</span><span>' + money(t.paid) + '</span></div>' +
                '<div class="totals-row"><span>Balance</span><span>' + money(t.balance) + '</span></div>' +
            '</div>' +
            (inv.note ? '<div class="notice"><span class="ico">' + icon('info', 15) + '</span><div><strong>Note</strong><span>' + esc(inv.note) + '</span></div></div>' : '') +
            paymentsHtml(inv) +
            (inv.discharged
                ? '<div class="notice notice-success"><span class="ico">' + icon('check-circle', 15) + '</span>' +
                  '<div><strong>Discharged</strong><span>Final payment of ' + money(inv.finalPayment || 0) +
                  ' recorded' + (inv.finalPaymentAt ? ' on ' + esc(store.formatDateTime(inv.finalPaymentAt)) : '') +
                  '. The patient has left the hospital.</span></div></div>'
                : '');

        var cancelBtn = byId('cancelInvoiceBtn');
        var editBtn = byId('editInvoiceBtn');
        var payBtn = byId('takePaymentBtn');
        var dischargeBtn = byId('dischargeBtn');
        var settled = inv.status === 'Paid' || inv.status === 'Cancelled';

        if (cancelBtn) cancelBtn.hidden = settled;
        if (editBtn) editBtn.hidden = settled;
        if (payBtn) {
            payBtn.hidden = settled;
            payBtn.disabled = inv.status === 'Cancelled';
        }
        if (dischargeBtn) dischargeBtn.hidden = !(inv.status === 'Paid' && !inv.discharged);

        ui.openModal('detailModal');
    }

    /* ==================================================================
       Final payment & discharge
       The nurse opens the patient's card bill (the yellow "Awaiting final
       payment" row), enters the consultation amount, optionally adds costs
       like laboratory or nursing below it, and takes one payment. The system
       sums everything automatically.
       ================================================================== */
    var dischargingId = null;
    var dischargeExtras = [];
    var dischargeMethod = 'Cash';

    function openDischarge(id) {
        var inv = store.findInvoice(id);
        if (!inv || inv.discharged) return;

        dischargingId = id;
        dischargeExtras = [];
        dischargeMethod = 'Cash';

        setText('dischargeModalSub', inv.number + ' · ' + (inv.patientName || '') + ' · ' + kindLabel(inv.kind));

        /* Start the consultation amount at the standard price. */
        byId('dgConsultation').value = store.lookupPrice('Consultation', 'Standard consultation');
        ui.setSelectValue('extraCategoryWrapper', 'Laboratory', 'Laboratory');
        byId('extraPrice').value = '';
        ui.setSelectValue('dischargeMethodWrapper', 'Cash', 'Cash');

        renderDischargeUI(true);
        ui.clearFieldError('dgConsultation');
        ui.clearFieldError('extraPrice');
        ui.openModal('dischargeModal');
    }

    function finalTotal(inv) {
        var consult = store.toNumber(byId('dgConsultation').value) || 0;
        var extras = 0;
        dischargeExtras.forEach(function (it) { extras += it.price; });
        /* Anything still owed on the bill (e.g. a partly paid card) counts too. */
        var base = store.invoiceTotals(inv).balance;
        return Math.max(0, base) + Math.max(0, consult) + extras;
    }

    function renderDischargeUI() {
        var inv = store.findInvoice(dischargingId);
        if (!inv) return;

        /* Added cost lines */
        var host = byId('extrasList');
        host.innerHTML = dischargeExtras.map(function (it, i) {
            return '<div class="extra-row" data-extra-row="' + i + '">' +
                '<span class="ex-cat">' + esc(it.category) + '</span>' +
                '<span class="ex-desc">' + esc(it.description) + '</span>' +
                '<span class="ex-total">' + money(it.price) + '</span>' +
                '<button type="button" class="li-remove" data-remove-extra="' + i + '" aria-label="Remove">' +
                    icon('close', 13) + '</button>' +
            '</div>';
        }).join('');

        ui.qsa('[data-remove-extra]', host).forEach(function (btn) {
            btn.addEventListener('click', function () {
                dischargeExtras.splice(Number(btn.getAttribute('data-remove-extra')), 1);
                renderDischargeUI();
            });
        });

        var total = finalTotal(inv);
        setText('dischargePatientLabel', inv.patientName || '—');
        setText('dgTotal', money(total));
        setText('dgBalance', money(total));
    }

    function addExtraCharge() {
        if (!dischargingId) return;
        var category = ui.getSelectValue('extraCategoryWrapper') || 'Other';
        var price = store.toNumber(byId('extraPrice').value);

        if (price === null || price <= 0) {
            ui.fieldError('extraPrice', 'Enter an amount above zero.');
            return;
        }

        dischargeExtras.push({
            category: category,
            description: category,
            qty: 1,
            price: price
        });

        byId('extraPrice').value = '';
        ui.clearFieldError('extraPrice');

        renderDischargeUI();
        byId('extraPrice').focus();
    }

    function confirmDischarge() {
        var inv = store.findInvoice(dischargingId);
        if (!inv) return;

        var consult = store.toNumber(byId('dgConsultation').value);
        if (consult === null || consult < 0) {
            ui.fieldError('dgConsultation', 'Enter the consultation amount.');
            return;
        }

        /* Put the consultation charge on the bill (replacing the old one). */
        var items = inv.items || [];
        var consultIdx = -1;
        for (var i = 0; i < items.length; i++) {
            if (items[i].category === 'Consultation') { consultIdx = i; break; }
        }
        if (consultIdx >= 0) {
            items[consultIdx].price = consult;
            items[consultIdx].qty = 1;
        } else {
            items.push({
                category: 'Consultation',
                description: 'Consultation fee',
                qty: 1,
                price: consult
            });
        }

        /* Add the optional extra costs. */
        dischargeExtras.forEach(function (it) { items.push(it); });
        inv.items = items;
        store.saveInvoice(inv);

        /* Collect everything owed in one payment. */
        var total = store.invoiceTotals(inv).balance;
        var updated = inv;
        if (total > 0) {
            var result = store.recordPayment(inv.id, {
                amount: total,
                method: dischargeMethod,
                reference: '',
                phone: ''
            });
            if (!result) {
                window.MediTrackNotify.push('Payment failed', 'The payment could not be recorded.', 'error', 'Billing', 'high');
                return;
            }
            updated = result.invoice;
        }

        updated.finalPayment = total;
        updated.finalPaymentAt = new Date().toISOString();
        updated.discharged = true;
        store.saveInvoice(updated);

        ui.closeModal('dischargeModal');
        ui.closeModal('detailModal');
        refresh();

        window.MediTrackNotify.flash(
            'Final payment taken',
            (updated.patientName || 'The patient') + ' paid ' + money(total) +
            ' and is discharged. The receipt can be printed from the bill.');

        openReceipt(updated.id);
        dischargingId = null;
        dischargeExtras = [];
    }

    function cancelInvoice() {
        var inv = store.findInvoice(detailId);
        if (!inv) return;

        ui.confirmAction({
            title: 'Cancel ' + inv.number,
            message: 'The bill is marked cancelled and no more payments can be taken against it. This cannot be undone.',
            confirmLabel: 'Cancel bill',
            tone: 'danger',
            icon: 'close'
        }, function () {
            inv.status = 'Cancelled';
            store.saveInvoice(inv);
            ui.closeModal('detailModal');
            refresh();
            window.MediTrackNotify.flash('Bill cancelled', inv.number + ' will no longer take payments.');
        });
    }

    /* ==================================================================
       Take payment
       ================================================================== */
    function openPayment(id) {
        var inv = store.findInvoice(id);
        if (!inv) return;
        if (inv.status === 'Paid') {
            window.MediTrackNotify.flash('Already settled', inv.number + ' has no balance left.');
            return;
        }
        if (inv.status === 'Cancelled') {
            window.MediTrackNotify.push('Bill cancelled', inv.number + ' cannot take payments.', 'warning', 'Billing', 'normal');
            return;
        }

        payingInvoiceId = id;
        payMethod = 'Telebirr';

        var t = store.invoiceTotals(inv);
        setText('paymentModalSub', inv.number + ' · ' + (inv.patientName || '') + ' · ' + kindLabel(inv.kind));
        setText('payBalanceValue', money(t.balance));
        byId('payAmount').value = t.balance.toFixed(2);
        byId('payReference').value = '';
        byId('payPhone').value = '';
        byId('payTbCode').value = '';
        tbStep = 'number';
        tbExpectedCode = null;
        tbPhoneValue = '';

        ui.setSelectValue('payMethodWrapper', 'Telebirr', 'Telebirr');
        syncTelebirrSteps();
        syncMethodUI();

        byId('paySuccessNotice').hidden = true;
        hidePayAnim();
        ui.clearFieldError('payAmount');
        ui.clearFieldError('payPhone');
        ui.clearFieldError('payTbCode');

        var confirmBtn = byId('confirmPaymentBtn');
        confirmBtn.disabled = false;

        ui.openModal('paymentModal');
    }

    /* Show/hide the fields each payment method needs. */
    function syncMethodUI() {
        var isTelebirr = payMethod === 'Telebirr';
        var needsRef = ['CBE', 'BOA', 'Awash'].indexOf(payMethod) !== -1;

        byId('payTelebirrBox').hidden = !isTelebirr;
        byId('payReferenceGroup').hidden = !needsRef;
        if (needsRef) {
            byId('payReference').placeholder = payMethod + ' transaction reference (optional)';
        }

        var label = {
            Telebirr: tbStep === 'number' ? 'Send Telebirr confirmation' : 'Verify payment',
            CBE: 'Record CBE payment',
            BOA: 'Record BOA payment',
            Awash: 'Record Awash payment',
            Cash: 'Record cash payment'
        }[payMethod] || 'Record payment';
        setText('confirmPaymentBtnLabel', label);
    }

    function syncTelebirrSteps() {
        var numStep = byId('tbStepNumber');
        var codeStep = byId('tbStepCode');
        if (numStep) numStep.hidden = tbStep !== 'number';
        if (codeStep) codeStep.hidden = tbStep !== 'code';
    }

    /* Front-end-only Telebirr checkout.
       Step 1: staff enters the payer's Telebirr number, a confirmation code
               is "sent" to it (simulated SMS shown for demo purposes).
       Step 2: staff asks the payer for the code and enters it. A correct
               code plays the verified animation and records the payment; a
               wrong one plays the declined animation with the reason.
       No network call is made anywhere — the backend plugs in later. */
    function sendTelebirrCode() {
        var phone = byId('payPhone').value.trim();
        if (!store.isValidPhone(phone)) {
            ui.fieldError('payPhone', 'Enter a valid Telebirr number, e.g. 0912 345 678.');
            return false;
        }
        ui.clearFieldError('payPhone');
        tbPhoneValue = store.formatPhone(phone);
        tbExpectedCode = String(Math.floor(100000 + Math.random() * 900000));
        tbStep = 'code';
        byId('payTbCode').value = '';
        ui.clearFieldError('payTbCode');

        setText('tbSmsText',
            'Telebirr: Your confirmation code for ' +
            money(store.toNumber(byId('payAmount').value) || 0) +
            ' to ' + settingsFacilityName() + ' is ' + tbExpectedCode +
            '. Do not share this code.');
        syncTelebirrSteps();
        syncMethodUI();

        window.MediTrackNotify.flash('Confirmation code sent',
            'Telebirr sent a 6-digit code to ' + tbPhoneValue + '. Ask them for it.');
        try { byId('payTbCode').focus(); } catch (e) {}
        return true;
    }

    function confirmPayment() {
        var inv = store.findInvoice(payingInvoiceId);
        if (!inv) return;

        var t = store.invoiceTotals(inv);
        var amount = store.toNumber(byId('payAmount').value);

        if (amount === null || amount <= 0) {
            ui.fieldError('payAmount', 'Enter the amount being received.');
            return;
        }
        if (amount > t.balance + 0.009) {
            ui.fieldError('payAmount', 'Only ' + money(t.balance) + ' is left on this bill.');
            return;
        }

        if (payMethod === 'Telebirr') {
            if (tbStep === 'number') {
                sendTelebirrCode();
                return;
            }

            var entered = byId('payTbCode').value.trim();
            if (!/^\d{6}$/.test(entered)) {
                ui.fieldError('payTbCode', 'Enter the 6-digit code from Telebirr.');
                return;
            }

            var btn = byId('confirmPaymentBtn');
            btn.disabled = true;
            btn.classList.add('is-processing');

            setTimeout(function () {
                btn.classList.remove('is-processing');
                btn.disabled = false;

                if (entered !== tbExpectedCode) {
                    showPayAnim('declined',
                        'Payment declined',
                        'Telebirr rejected the code. The confirmation code is incorrect or has expired — ask the payer for the latest SMS and try again.');
                    return;
                }

                var txn = 'TB' + Date.now().toString().slice(-8);
                showPayAnim('verified',
                    'Payment verified',
                    money(amount) + ' received on ' + tbPhoneValue + ' · Transaction ' + txn);

                finishPayment(inv, {
                    amount: amount,
                    method: 'Telebirr',
                    reference: txn,
                    phone: tbPhoneValue
                });
            }, 900);
            return;
        }

        finishPayment(inv, {
            amount: amount,
            method: payMethod,
            reference: byId('payReference').value.trim(),
            phone: ''
        });
    }

    /* Verified / declined animation overlay ----------------------------- */
    function showPayAnim(kind, title, text) {
        var overlay = byId('payAnimOverlay');
        if (!overlay) return;
        overlay.className = 'pay-anim-overlay active kind-' + kind;
        overlay.hidden = false;

        var card = byId('payAnimCard');
        card.className = 'pay-anim-card kind-' + kind;
        /* restart the pop-in animation */
        card.style.animation = 'none';
        void card.offsetWidth;
        card.style.animation = '';

        setText('payAnimTitle', title);
        setText('payAnimText', text || '');

        var iconWrap = byId('payAnimIconWrap');
        iconWrap.innerHTML = icon(kind === 'verified' ? 'check-circle' : 'close', 34);

        var fill = byId('payAnimBarFill');
        fill.style.animation = 'none';
        void fill.offsetWidth;
        fill.style.animation = '';

        if (window.MediIcons) window.MediIcons.hydrate(overlay);

        if (kind === 'declined') {
            /* Declined stays until the next attempt so the reason can be read. */
            setTimeout(function () {
                overlay.hidden = true;
                overlay.classList.remove('active');
                try { byId('payTbCode').focus(); } catch (e) {}
            }, 3400);
        }
    }

    function hidePayAnim() {
        var overlay = byId('payAnimOverlay');
        if (!overlay) return;
        overlay.hidden = true;
        overlay.classList.remove('active');
    }

    function finishPayment(inv, payment) {
        var result = store.recordPayment(inv.id, payment);
        if (!result) {
            window.MediTrackNotify.push('Payment failed', 'The payment could not be recorded.', 'error', 'Billing', 'high');
            return;
        }

        var updated = result.invoice;
        var t = store.invoiceTotals(updated);

        refresh();
        renderNotifications();

        if (result.promoted) {
            window.MediTrackNotify.push(
                'Added to waiting list',
                result.promoted.name + ' (' + result.promoted.trackingId + ') has paid and now joins the queue.',
                'success', 'Queue', 'high'
            );
        }

        if (t.balance <= 0) {
            /* Settled: close payment, show the receipt. */
            setTimeout(function () {
                ui.closeModal('paymentModal');
                openReceipt(updated.id);
            }, payment.method === 'Telebirr' ? 1600 : 400);
        }
    }

    /* ==================================================================
        Receipt & slips
        Every stage of the bill can hand the patient a printed slip:
          - Unpaid card / final bill -> "payment due" slip
          - Card paid                -> queue-card receipt
          - Settled                  -> official receipt
        ================================================================== */
    function buildReceiptHtml(inv) {
        var t = store.invoiceTotals(inv);
        var rows = inv.items.map(function (it) {
            var line = (store.toNumber(it.qty) || 1) * (store.toNumber(it.price) || 0);
            return '<tr><td>' + esc(it.description) +
                (it.staff ? '<span class="rcp-staff">ordered by ' + esc(it.staff) + '</span>' : '') +
                '</td>' +
                '<td class="num">' + esc(String(it.qty)) + '</td>' +
                '<td class="num">' + money(line) + '</td></tr>';
        }).join('');

        var pays = (inv.payments || []).map(function (p) {
            return '<div class="rcp-pay"><span>' + esc(p.method) +
                (p.phone ? ' · ' + esc(p.phone) : '') + '</span><span>' + money(p.amount) + '</span></div>';
        }).join('');

        var txnCodes = (inv.payments || []).filter(function (p) { return p.reference; })
            .map(function (p) {
                return '<div class="rcp-txn"><span>' + esc(p.method) + ' transaction code</span>' +
                    '<strong class="mono">' + esc(p.reference) + '</strong></div>';
            }).join('');

        var settled = inv.status === 'Paid' || inv.discharged;
        var headLabel = !settled
            ? (inv.kind === 'final' ? 'Final bill · payment due' : 'Payment due slip')
            : (inv.kind === 'registration' ? 'Queue card receipt' : 'Official receipt');

        var footText;
        if (!settled) {
            footText = 'Present this slip at the cashier and pay ' + money(t.balance) +
                ' to continue. Keep it as your proof of registration.';
        } else if (inv.kind === 'registration') {
            footText = 'Your queue card is paid. Please wait to be called for your consultation.';
        } else {
            footText = 'Keep this receipt. It is your proof of payment for the services above.';
        }

        return '<div class="rcp-head">' +
                '<h2>' + esc(settingsFacilityName()) + '</h2>' +
                '<span>' + esc(headLabel) + ' · ' + esc(inv.number) + '</span>' +
                '<span>' + esc(store.formatDateTime(inv.createdAt)) + '</span>' +
            '</div>' +
            '<div class="rcp-meta">' +
                '<div><span>Patient</span><strong>' + esc(inv.patientName || '—') + '</strong></div>' +
                '<div><span>Tracking ID</span><strong class="mono">' + esc(inv.trackingId || '—') + '</strong></div>' +
                '<div><span>Bill type</span><strong>' + esc(kindLabel(inv.kind)) + '</strong></div>' +
                '<div><span>Status</span><strong>' + esc(settled ? 'Paid' : inv.status) + '</strong></div>' +
            '</div>' +
            '<table class="rcp-table"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>' +
            '<div class="rcp-totals">' +
                '<div><span>Subtotal</span><span>' + money(t.subtotal) + '</span></div>' +
                (t.discountAmount > 0 ? '<div><span>Discount</span><span>− ' + money(t.discountAmount) + '</span></div>' : '') +
                '<div class="rcp-grand"><span>Total</span><span>' + money(t.total) + '</span></div>' +
                '<div><span>Paid</span><span>' + money(t.paid) + '</span></div>' +
                '<div><span>Balance</span><span>' + money(t.balance) + '</span></div>' +
            '</div>' +
            (pays ? '<div class="rcp-payments">' + pays + '</div>' : '') +
            (txnCodes ? '<div class="rcp-txns">' + txnCodes + '</div>' : '') +
            (inv.discharged
                ? '<div class="rcp-payments"><div class="rcp-pay"><span>Discharged</span><span>' +
                      esc(store.formatDateTime(inv.finalPaymentAt || inv.createdAt)) + '</span></div></div>'
                : '') +
            '<div class="rcp-foot">' + esc(footText) + '</div>';
    }

    function openReceipt(id) {
        var inv = store.findInvoice(id);
        if (!inv) return;

        byId('receiptPrintArea').innerHTML = buildReceiptHtml(inv);
        setText('receiptModalTitle',
            inv.status === 'Paid' || inv.discharged ? 'Receipt' : 'Payment slip');
        ui.openModal('receiptModal');
    }

    /* One-click slip straight to the printer, no preview modal. */
    function printSlip(id) {
        var inv = store.findInvoice(id);
        if (!inv) return;

        var host = byId('slipPrintArea');
        if (!host) { openReceipt(id); return; }
        host.innerHTML = '<article class="receipt-paper">' + buildReceiptHtml(inv) + '</article>';
        ui.printNode('slipPrintArea', 'Slip ' + inv.number);

        window.MediTrackNotify.flash('Slip ready', 'The print dialog opened for ' + inv.number + '.');
    }

    function settingsFacilityName() {
        try {
            var raw = store.rawGet('clinic_settings');
            var parsed = raw ? JSON.parse(raw) : {};
            return parsed.facilityName || 'MediTrack Central Hospital';
        } catch (e) {
            return 'MediTrack Central Hospital';
        }
    }

    /* ==================================================================
       Price list
       ================================================================== */
    function renderPriceRows() {
        var host = byId('priceRows');
        if (!host) return;

        var list = store.readPriceList();
        host.innerHTML = list.map(function (p, i) {
            return '<div class="price-row" data-price-row="' + i + '">' +
                '<span class="pr-cat">' + esc(p.category) + '</span>' +
                '<span class="pr-name">' + esc(p.name) + '</span>' +
                '<input type="number" class="pr-amount mono" data-edit-price="' + i + '"' +
                    ' value="' + esc(p.amount) + '" min="0" step="0.01"' +
                    ' aria-label="Default price for ' + esc(p.name) + '">' +
                '<button type="button" class="li-remove" data-remove-price="' + i + '" aria-label="Remove price">' +
                    icon('close', 13) + '</button>' +
            '</div>';
        }).join('');

        /* Editing an amount rewrites the default immediately. */
        ui.qsa('[data-edit-price]', host).forEach(function (input) {
            function commit() {
                var idx = Number(input.getAttribute('data-edit-price'));
                var list2 = store.readPriceList();
                var next = store.toNumber(input.value);
                if (!list2[idx]) return;
                if (next === null || next < 0) { renderPriceRows(); return; }
                list2[idx].amount = next;
                store.writePriceList(list2);
                renderPriceSuggestions();
            }
            input.addEventListener('change', commit);
        });

        ui.qsa('[data-remove-price]', host).forEach(function (btn) {
            btn.addEventListener('click', function () {
                var list2 = store.readPriceList();
                list2.splice(Number(btn.getAttribute('data-remove-price')), 1);
                store.writePriceList(list2);
                renderPriceRows();
            });
        });
    }

    function addPrice() {
        var name = byId('newPriceName').value.trim();
        var amount = store.toNumber(byId('newPriceAmount').value);
        var category = ui.getSelectValue('newPriceCategoryWrapper') || 'Other';

        if (!name) { ui.fieldError('newPriceName', 'Give the price a name.'); return; }
        if (amount === null || amount <= 0) { ui.fieldError('newPriceAmount', 'Enter a price above zero.'); return; }

        var list = store.readPriceList();
        list.push({ category: category, name: name, amount: amount });
        store.writePriceList(list);

        byId('newPriceName').value = '';
        byId('newPriceAmount').value = '';
        ui.clearFieldError('newPriceName');
        ui.clearFieldError('newPriceAmount');
        renderPriceRows();
        renderPriceSuggestions();
        window.MediTrackNotify.flash('Price saved', name + ' added to the price list.');
    }

    function renderPriceSuggestions() {
        var dl = byId('priceSuggestions');
        if (!dl) return;
        dl.innerHTML = store.readPriceList().map(function (p) {
            return '<option value="' + esc(p.name) + '"></option>';
        }).join('');
    }

    /* ==================================================================
       Notifications passthrough (keeps the bell badge in step)
       ================================================================== */
    function renderNotifications() {
        if (window.parent && window.parent !== window) {
            try { window.parent.postMessage({ action: 'new_notification' }, '*'); } catch (e) {}
        }
    }

    /* ==================================================================
       Bind everything
       ================================================================== */
    function bind() {
        /* Header actions */
        byId('btnNewInvoice').addEventListener('click', openNewInvoice);
        byId('btnPriceList').addEventListener('click', function () {
            renderPriceRows();
            ui.openModal('priceModal');
        });

        /* Filters */
        byId('billSearch').addEventListener('input', function () {
            searchTerm = this.value.trim();
            renderCards();
        });
        byId('billSearchClear').addEventListener('click', function () {
            byId('billSearch').value = '';
            searchTerm = '';
            renderCards();
        });
        ui.initSelect('filterStatusWrapper', function (v) { statusFilter = v; renderCards(); });
        ui.initSelect('filterPeriodWrapper', function (v) { periodFilter = v; renderCards(); });
        byId('resetFiltersBtn').addEventListener('click', function () {
            searchTerm = '';
            statusFilter = 'active';
            periodFilter = 'all';
            byId('billSearch').value = '';
            ui.setSelectValue('filterStatusWrapper', 'active', 'Active');
            ui.setSelectValue('filterPeriodWrapper', 'all', 'Any date');
            renderCards();
        });

        /* New-bill modal */
        ui.initSelect('invPatientWrapper', function (value, label) {
            draft.patientId = value === '' ? null : value;
            var p = value === '' ? null : store.findPatient(patients, value);
            draft.patientName = p ? p.name : label;
            draft.trackingId = p ? p.trackingId : '';
            draft.awaitingPayment = p ? p.status === store.STATUS.AWAITING_PAYMENT : false;
            renderDraft();
        });
        byId('btnPullCharges').addEventListener('click', pullChargesFromRecord);
        byId('btnAddItem').addEventListener('click', addDraftItem);
        byId('newItemPrice').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); addDraftItem(); }
        });
        byId('newItemPrice').addEventListener('input', function () { ui.clearFieldError('newItemPrice'); });
        ui.initSelect('newItemCategoryWrapper');
        ui.initSelect('invDiscountTypeWrapper');
        byId('saveInvoiceBtn').addEventListener('click', saveInvoiceDraft);

        /* Detail modal */
        byId('cancelInvoiceBtn').addEventListener('click', cancelInvoice);
        byId('editInvoiceBtn').addEventListener('click', function () {
            ui.closeModal('detailModal');
            setTimeout(function () { openEditInvoice(detailId); }, 150);
        });
        byId('takePaymentBtn').addEventListener('click', function () {
            ui.closeModal('detailModal');
            setTimeout(function () { openPayment(detailId); }, 150);
        });
        var dischargeBtn = byId('dischargeBtn');
        if (dischargeBtn) {
            dischargeBtn.addEventListener('click', function () {
                openDischarge(detailId);
            });
        }
        byId('confirmDischargeBtn').addEventListener('click', confirmDischarge);
        byId('dgConsultation').addEventListener('input', function () {
            ui.clearFieldError('dgConsultation');
            renderDischargeUI();
        });
        ui.initSelect('extraCategoryWrapper');
        ui.initSelect('dischargeMethodWrapper', function (v) { dischargeMethod = v; });
        byId('btnAddExtra').addEventListener('click', addExtraCharge);
        byId('extraPrice').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); addExtraCharge(); }
        });
        byId('extraPrice').addEventListener('input', function () { ui.clearFieldError('extraPrice'); });
        byId('printReceiptBtn').addEventListener('click', function () {
            ui.closeModal('detailModal');
            setTimeout(function () { openReceipt(detailId); }, 150);
        });

        /* Payment modal */
        ui.initSelect('payMethodWrapper', function (v) {
            payMethod = v;
            tbStep = 'number';
            syncTelebirrSteps();
            hidePayAnim();
            ui.clearFieldError('payTbCode');
            ui.clearFieldError('payPhone');
            syncMethodUI();
        });
        byId('payAmount').addEventListener('input', function () { ui.clearFieldError('payAmount'); });
        byId('payPhone').addEventListener('input', function () {
            ui.clearFieldError('payPhone');
            var digits = store.phoneDigits(this.value);
            this.value = digits.length ? store.formatPhone(digits) : '';
        });
        byId('payTbCode').addEventListener('input', function () {
            ui.clearFieldError('payTbCode');
            this.value = this.value.replace(/\D/g, '').slice(0, 6);
        });
        byId('tbResendBtn').addEventListener('click', sendTelebirrCode);
        byId('confirmPaymentBtn').addEventListener('click', confirmPayment);

        /* Receipt */
        byId('doPrintReceiptBtn').addEventListener('click', function () {
            ui.printNode('receiptPrintArea');
        });

        /* Price list */
        ui.initSelect('newPriceCategoryWrapper');
        byId('btnAddPrice').addEventListener('click', addPrice);
        byId('btnResetPrices').addEventListener('click', function () {
            ui.confirmAction({
                title: 'Reset the price list',
                message: 'Every custom price is removed and the standard list is restored. Bills already created are not affected.',
                confirmLabel: 'Reset prices',
                tone: 'warning',
                icon: 'reset'
            }, function () {
                store.writePriceList(null);
                renderPriceRows();
                renderPriceSuggestions();
                window.MediTrackNotify.flash('Prices reset', 'The standard price list is back.');
            });
        });

        /* Keep in step with other tabs */
        store.onPatientsChanged(refresh);
        window.addEventListener('meditrack:invoices-updated', refresh);
        window.addEventListener('storage', function (e) {
            if (!e.key || e.key === store.KEYS.invoices || e.key === store.KEYS.patients) refresh();
        });
    }

    /* ==================================================================
       Init
       ================================================================== */
    function init() {
        if (window.MediSession && !window.MediSession.can('billing')) return;

        refresh();
        renderPriceSuggestions();
        bind();

        /* A finished consultation hands over a final bill: open it and go
           straight to the payment step. */
        var openId = null;
        try { openId = window.sessionStorage.getItem('billing_open_invoice_id'); } catch (e) {}
        if (openId) {
            try { window.sessionStorage.removeItem('billing_open_invoice_id'); } catch (e) {}
            var inv = store.findInvoice(openId);
            if (inv && inv.status !== 'Paid' && inv.status !== 'Cancelled') {
                /* Only the payment modal — no detail modal stacked behind it. */
                openPayment(openId);
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
