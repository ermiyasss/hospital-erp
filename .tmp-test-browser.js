/* Throwaway browser smoke test for the Inventory page.

   Drives headless Edge over the DevTools Protocol: loads the page with a real
   session token, fails on any console error or uncaught exception, then
   exercises the new upload dialog by dropping a file onto the grid and
   confirming it uploads and appears as a card. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 8126;
const CDP_PORT = 9333;
const BASE = 'http://127.0.0.1:' + PORT;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-browsertest-'));
fs.copyFileSync(path.join(__dirname, 'server.js'), path.join(tmpRoot, 'server.js'));
const profileDir = path.join(tmpRoot, 'profile');

let failures = 0;
function check(cond, label) {
    if (cond) console.log('PASS: ' + label);
    else { failures++; console.log('FAIL: ' + label); }
}

/* ---------- start the app server ---------- */
const server = spawn(process.execPath, [path.join(tmpRoot, 'server.js')], {
    env: Object.assign({}, process.env, { ERP_PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d.toString(); });
server.stderr.on('data', (d) => { serverLog += d.toString(); });

async function waitFor(url) {
    for (let i = 0; i < 60; i++) {
        try { const r = await fetch(url); if (r.status < 500) return true; } catch (e) {}
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
}

/* ---------- start headless Edge ---------- */
const browser = spawn(EDGE, [
    '--headless=new',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + profileDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=1400,1000',
    'about:blank'
], { stdio: 'ignore' });

/* ---------- minimal CDP client ---------- */
let ws;
let sessionId = null;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];

function send(method, params, useSession) {
    return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        const msg = { id, method, params: params || {} };
        /* Runtime/Page/Log commands belong to the tab, not the browser. */
        if (useSession !== false && sessionId) msg.sessionId = sessionId;
        ws.send(JSON.stringify(msg));
        setTimeout(() => {
            if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
        }, 20000);
    });
}

async function connectCdp() {
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version');
            const j = await r.json();
            ws = new WebSocket(j.webSocketDebuggerUrl);
            await new Promise((res, rej) => {
                ws.onopen = res;
                ws.onerror = () => rej(new Error('ws error'));
                setTimeout(() => rej(new Error('ws timeout')), 8000);
            });

            /* Open a tab and attach to it with a flattened session. */
            const created = await send('Target.createTarget', { url: 'about:blank' }, false);
            sessionId = (await send('Target.attachToTarget',
                { targetId: created.targetId, flatten: true }, false)).sessionId;
            if (!sessionId) throw new Error('no session id');
            ws.onmessage = (ev) => {
                const msg = JSON.parse(ev.data);
                if (msg.id && pending.has(msg.id)) {
                    const p = pending.get(msg.id);
                    pending.delete(msg.id);
                    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
                    return;
                }
                if (msg.method === 'Runtime.exceptionThrown') {
                    const d = msg.params.exceptionDetails || {};
                    pageErrors.push(d.text + ' ' + (d.exception && d.exception.description || ''));
                }
                if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
                    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
                }
            };
            return true;
        } catch (e) { await new Promise((r) => setTimeout(r, 400)); }
    }
    return false;
}

async function evaluate(expression) {
    const r = await send('Runtime.evaluate', {
        expression: '(function(){' + expression + '})()',
        returnByValue: true,
        awaitPromise: true
    });
    if (r.exceptionDetails) {
        throw new Error('eval threw: ' + (r.exceptionDetails.exception &&
            r.exceptionDetails.exception.description || r.exceptionDetails.text));
    }
    return r.result.value;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
    if (!await waitFor(BASE + '/api/version')) {
        console.log('FAIL: app server never ready\n' + serverLog); cleanup(); process.exit(1);
    }
    console.log('PASS: app server ready');

    const login = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' })
    }).then((r) => r.json());
    const token = login.token;
    check(!!token, 'got an admin session token');

    if (!await connectCdp()) { console.log('FAIL: could not attach to headless Edge'); cleanup(); process.exit(1); }
    console.log('PASS: attached to headless Edge');

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Log.enable');

    /* Put a real token in localStorage before any app script runs. */
    await send('Page.addScriptToEvaluateOnNewDocument', {
        source: 'try { localStorage.setItem("erp_token", ' + JSON.stringify(token) + '); } catch(e) {}'
    });

    await send('Page.navigate', { url: BASE + '/pages/inventory.html' });
    await sleep(3500);

    /* --- the page must load without blowing up -------------------------- */
    const url = await evaluate('return location.href;');
    check(!/login/.test(url), 'page did not bounce to the login screen (at ' + url + ')');
    check(pageErrors.length === 0, 'no uncaught exceptions' +
        (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
    check(consoleErrors.length === 0, 'no console errors' +
        (consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''));

    /* --- the pieces that were asked for --------------------------------- */
    const state = await evaluate(`
        return {
            hasGrid: !!document.getElementById('invGrid'),
            hasUsage: !!document.getElementById('invUsage'),
            usageText: (document.getElementById('invUsageText')||{}).textContent,
            usageSub: (document.getElementById('invUsageSub')||{}).textContent,
            hasUploadModal: !!document.getElementById('invUploadModal'),
            hasEditModal: !!document.getElementById('invEditModal'),
            hasOldRename: !!document.getElementById('invRenameModal'),
            hasOldNote: !!document.getElementById('invNoteModal'),
            editHasName: !!document.getElementById('invEditName'),
            editHasDesc: !!document.getElementById('invEditDesc'),
            iconsHydrated: document.querySelectorAll('.ico svg').length
        };
    `);
    console.log('   page state ->', JSON.stringify(state));
    check(state.hasGrid, 'inventory grid present');
    check(state.hasUsage, 'storage meter present');
    check(/of 6(\.0)? GB used/.test(state.usageText || ''), 'meter shows a 6 GB allowance (' + state.usageText + ')');
    check(/1\.5 GB per file/.test(state.usageSub || ''), 'meter shows the 1.5 GB per-file cap (' + state.usageSub + ')');
    check(state.hasUploadModal, 'upload dialog present');
    check(state.hasEditModal && state.editHasName && state.editHasDesc,
        'combined edit dialog has both a name and a description field');
    check(!state.hasOldRename && !state.hasOldNote, 'the two old modals are gone');
    check(state.iconsHydrated > 0, 'icons rendered (' + state.iconsHydrated + ' svg)');

    /* --- drop a file onto the grid and check the dialog ----------------- */
    const opened = await evaluate(`
        var grid = document.getElementById('invGrid');
        var dt = new DataTransfer();
        dt.items.add(new File(['hello meditrack'], 'discharge-summary.txt', { type: 'text/plain' }));
        grid.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        return new Promise(function (res) {
            setTimeout(function () {
                var modal = document.getElementById('invUploadModal');
                res({
                    open: modal && !modal.hasAttribute('aria-hidden') === false ? true : (modal && modal.getAttribute('aria-hidden') === 'false'),
                    rows: document.querySelectorAll('.inv-upload-row').length,
                    nameValue: (document.querySelector('.up-name') || {}).value,
                    hasDesc: !!document.querySelector('.up-desc'),
                    total: (document.getElementById('invUploadTotal') || {}).textContent
                });
            }, 500);
        });
    `);
    console.log('   upload dialog ->', JSON.stringify(opened));
    check(opened.open, 'drop opens the upload dialog');
    check(opened.rows === 1, 'one row per dropped file');
    check(opened.nameValue === 'discharge-summary.txt', 'name box is prefilled with the filename');
    check(opened.hasDesc, 'a description box is shown for the file');

    /* --- confirm the upload and check the card appears ------------------ */
    const uploaded = await evaluate(`
        var btn = document.getElementById('invUploadConfirm');
        btn.click();
        return new Promise(function (res) {
            var waited = 0;
            var tick = function () {
                waited += 250;
                var card = document.querySelector('.inv-card');
                var closed = document.getElementById('invUploadModal').getAttribute('aria-hidden') === 'true';
                if (card && closed) {
                    res({
                        ok: true,
                        cardName: (card.querySelector('.inv-card-name') || {}).textContent,
                        editButtons: card.querySelectorAll('[data-act="edit"]').length,
                        actionLabels: Array.prototype.map.call(card.querySelectorAll('[data-act]'), function (b) {
                            return b.getAttribute('data-act');
                        }),
                        usageText: (document.getElementById('invUsageText') || {}).textContent
                    });
                    return;
                }
                if (waited > 12000) { res({ ok: false }); return; }
                setTimeout(tick, 250);
            };
            setTimeout(tick, 250);
        });
    `);
    console.log('   after upload ->', JSON.stringify(uploaded));
    check(uploaded.ok, 'upload completes and the dialog closes');
    check(uploaded.cardName === 'discharge-summary.txt', 'the file appears as a card');
    check(uploaded.editButtons === 1, 'exactly one edit (pencil) button on the card');
    check((uploaded.actionLabels || []).indexOf('rename') === -1 &&
          (uploaded.actionLabels || []).indexOf('note') === -1,
        'no separate rename/note buttons (' + (uploaded.actionLabels || []).join(',') + ')');

    /* --- the single pencil edits name AND description together ---------- */
    const edited = await evaluate(`
        document.querySelector('.inv-card [data-act="edit"]').click();
        return new Promise(function (res) {
            setTimeout(function () {
                var modal = document.getElementById('invEditModal');
                res({
                    open: modal.getAttribute('aria-hidden') === 'false',
                    name: document.getElementById('invEditName').value,
                    desc: document.getElementById('invEditDesc').value
                });
            }, 400);
        });
    `);
    console.log('   edit dialog ->', JSON.stringify(edited));
    check(edited.open, 'the pencil opens the edit dialog');
    check(edited.name === 'discharge-summary.txt', 'edit dialog opens with the current name');
    check(typeof edited.desc === 'string', 'edit dialog includes the description field');

    const saved = await evaluate(`
        document.getElementById('invEditName').value = 'Discharge summary (final)';
        document.getElementById('invEditDesc').value = 'Signed off by Dr Aster';
        document.getElementById('invEditSave').click();
        return new Promise(function (res) {
            setTimeout(function () {
                var card = document.querySelector('.inv-card');
                res({
                    name: (card.querySelector('.inv-card-name') || {}).textContent,
                    note: (card.querySelector('.inv-card-note') || {}).textContent
                });
            }, 700);
        });
    `);
    console.log('   after save ->', JSON.stringify(saved));
    check(saved.name === 'Discharge summary (final)', 'renamed through the single editor');
    check(/Signed off by Dr Aster/.test(saved.note || ''), 'description saved and shown on the card');

    check(pageErrors.length === 0, 'still no uncaught exceptions' +
        (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));

    cleanup();
    console.log(failures ? '\n' + failures + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
    process.exit(failures ? 1 : 0);
})().catch((e) => {
    console.log('FAIL: threw ->', e && e.stack);
    console.log('   console errors: ' + consoleErrors.join(' | '));
    console.log('   page errors: ' + pageErrors.join(' | '));
    console.log(serverLog);
    cleanup(); process.exit(1);
});

function cleanup() {
    try { browser.kill(); } catch (e) {}
    try { server.kill(); } catch (e) {}
    try { if (ws) ws.close(); } catch (e) {}
    setTimeout(() => {
        try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
    }, 500);
}
