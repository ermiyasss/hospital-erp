/* Throwaway integration check: boot the real server against a scratch
   database, sign in as the first-run administrator, create a staff member,
   and confirm the row landed with every column populated. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 8123;
const BASE = 'http://127.0.0.1:' + PORT;

/* server.js derives DATA_DIR from __dirname, so run it from a scratch copy
   to keep the real ./data database untouched. */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-testroot-'));
fs.copyFileSync(path.join(__dirname, 'server.js'), path.join(tmpRoot, 'server.js'));
const tmpData = path.join(tmpRoot, 'data');

let failures = 0;
function check(cond, label) {
    if (cond) { console.log('PASS: ' + label); }
    else { failures++; console.log('FAIL: ' + label); }
}

function post(p, body, token) {
    return fetch(BASE + p, {
        method: 'POST',
        headers: Object.assign(
            { 'Content-Type': 'application/json' },
            token ? { Authorization: 'Bearer ' + token } : {}
        ),
        body: JSON.stringify(body || {})
    }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
}

const child = spawn(process.execPath, [path.join(tmpRoot, 'server.js')], {
    env: Object.assign({}, process.env, { ERP_PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d.toString(); });
child.stderr.on('data', (d) => { serverLog += d.toString(); });

async function waitForServer() {
    for (let i = 0; i < 60; i++) {
        try { await fetch(BASE + '/api/version'); return true; } catch (e) {}
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
}

(async () => {
    const up = await waitForServer();
    if (!up) {
        console.log('FAIL: server never became ready.\n' + serverLog);
        child.kill(); process.exit(1);
    }

    const login = await post('/api/auth/login', { username: 'admin', password: 'admin123' });
    if (login.status !== 200 || !login.j.token) {
        console.log('FAIL: login ->', login.status, JSON.stringify(login.j));
        child.kill(); process.exit(1);
    }
    const token = login.j.token;
    console.log('PASS: admin signed in');

    /* The exact scenario from the bug report: fill the whole form, submit. */
    const create = await post('/api/admin/staff', {
        name: 'Aster Bekele',
        username: 'asterbekele',
        usernameAuto: true,
        role: 'nurse',
        phone: '0911223344',
        email: 'aster@clinic.org',
        age: '31',
        shift: 'Day'
    }, token);

    console.log('create staff ->', create.status, JSON.stringify(create.j));
    if (create.status !== 200) {
        console.log('FAIL: staff creation returned ' + create.status +
            ' — detail: ' + (create.j.detail || create.j.error));
        child.kill(); process.exit(1);
    }
    console.log('PASS: account created, username=' + create.j.username +
        ' needsPassword=' + create.j.needsPassword);

    /* Verify the row is complete, especially created_by. */
    const state = await fetch(BASE + '/api/state', {
        headers: { Authorization: 'Bearer ' + token }
    }).then((r) => r.json());

    const rows = (state && (state.staff || state.directory ||
        (state.data && state.data.clinic_staff_members))) || [];
    const made = rows.filter((r) => r.username === 'asterbekele')[0];
    if (!made) {
        console.log('WARN: row not in state snapshot; checking DB directly.');
    } else {
        console.log('row ->', JSON.stringify(made));
        if (made.createdBy !== 'admin') console.log('WARN: createdBy = ' + made.createdBy);
        else console.log('PASS: created_by recorded as "admin"');
    }

    /* Duplicate phone must still be a clean 409, not a 500. */
    const dup = await post('/api/admin/staff', {
        name: 'Aster Bekele Again', username: 'aster2', usernameAuto: true,
        role: 'nurse', phone: '0911223344'
    }, token);
    console.log('duplicate phone ->', dup.status, JSON.stringify(dup.j));
    check(dup.status === 409, 'duplicate phone rejected with 409 (server-side guard works)');

    /* Confirm allowDuplicatePhone still lets a deliberate duplicate through. */
    const forced = await post('/api/admin/staff', {
        name: 'Aster Bekele Again', username: 'aster2b', usernameAuto: true,
        role: 'nurse', phone: '0911223344', allowDuplicatePhone: true
    }, token);
    check(forced.status === 200, 'deliberate duplicate allowed with allowDuplicatePhone');

    /* Duplicate typed username must be 409 with a helpful message. */
    const dupUser = await post('/api/admin/staff', {
        name: 'Aster Bekele', username: 'asterbekele', usernameAuto: false,
        role: 'nurse', phone: '0999887766'
    }, token);
    console.log('duplicate username ->', dupUser.status, JSON.stringify(dupUser.j));
    check(dupUser.status === 409, 'duplicate username rejected with 409');

    /* Verify created_by landed in the row by reading the DB directly. */
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(tmpData, 'erp.db'));
    const row = db.prepare('SELECT username, name, phone, role, age, shift, created_by, ' +
        'must_reset_password, no_password, active FROM users WHERE username = ?').get('asterbekele');
    console.log('DB row ->', JSON.stringify(row));
    check(!!row, 'row exists in the users table');
    if (row) {
        check(row.created_by === 'admin', 'created_by recorded as "admin" (got ' + row.created_by + ')');
        check(row.phone === '0911223344', 'phone stored correctly');
        check(row.name === 'Aster Bekele', 'name stored correctly');
        check(row.age === 31, 'age stored as number 31 (got ' + row.age + ')');
        check(row.shift === 'Day', 'shift stored correctly');
        check(row.no_password === 1 && row.must_reset_password === 1, 'flagged as needing a password');
        check(row.active === 1, 'account active');
    }
    db.close();

    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    console.log(failures ? '\n' + failures + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
    process.exit(failures ? 1 : 0);
})().catch((e) => {
    console.log('FAIL: threw ->', e && e.message);
    console.log(serverLog);
    child.kill(); process.exit(1);
});
