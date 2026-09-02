/* Throwaway integration check for the inventory file endpoints: uploads are
   streamed to disk, bytes come back intact, the per-account quota and the
   per-file cap are enforced, and deleting frees the space again.

   The limits are shrunk through the environment so a 6 GB quota can actually
   be exercised without writing 6 GB. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const PORT = 8124;
const BASE = 'http://127.0.0.1:' + PORT;
const QUOTA = 100000;      /* 100 KB account allowance (scaled-down 6 GB)  */
const MAX_FILE = 60000;    /* 60 KB per file (scaled-down 1.5 GB)          */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-invtest-'));
fs.copyFileSync(path.join(__dirname, 'server.js'), path.join(tmpRoot, 'server.js'));

let failures = 0;
function check(cond, label) {
    if (cond) console.log('PASS: ' + label);
    else { failures++; console.log('FAIL: ' + label); }
}

function api(p, body, token) {
    return fetch(BASE + p, {
        method: body === undefined ? 'GET' : 'POST',
        headers: Object.assign(
            { 'Content-Type': 'application/json' },
            token ? { Authorization: 'Bearer ' + token } : {}
        ),
        body: body === undefined ? undefined : JSON.stringify(body)
    }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
}

/* Upload raw bytes, optionally lying about the declared length. */
function upload(token, bytes, name, description, declaredOverride, mime) {
    return new Promise((resolve, reject) => {
        const qs = '?name=' + encodeURIComponent(name) +
                   '&description=' + encodeURIComponent(description || '') +
                   '&mime=' + encodeURIComponent(mime || 'application/octet-stream');
        const req = require('node:http').request(BASE + '/api/inventory/upload' + qs, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(declaredOverride == null ? bytes.length : declaredOverride)
            }
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                let j = {};
                try { j = JSON.parse(data); } catch (e) {}
                resolve({ status: res.statusCode, j });
            });
        });
        req.on('error', reject);
        req.end(bytes);
    });
}

const child = spawn(process.execPath, [path.join(tmpRoot, 'server.js')], {
    env: Object.assign({}, process.env, {
        ERP_PORT: String(PORT),
        ERP_INVENTORY_QUOTA: String(QUOTA),
        ERP_INVENTORY_MAX_FILE: String(MAX_FILE)
    }),
    stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
child.stdout.on('data', (d) => { log += d.toString(); });
child.stderr.on('data', (d) => { log += d.toString(); });

async function waitForServer() {
    for (let i = 0; i < 60; i++) {
        try { await fetch(BASE + '/api/version'); return true; } catch (e) {}
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
}

(async () => {
    if (!await waitForServer()) { console.log('FAIL: server never ready\n' + log); child.kill(); process.exit(1); }

    const login = await api('/api/auth/login', { username: 'admin', password: 'admin123' });
    if (login.status !== 200) { console.log('FAIL: login ' + login.status); child.kill(); process.exit(1); }
    const token = login.j.token;
    console.log('PASS: signed in');

    /* --- Allowance is reported correctly ------------------------------- */
    const u0 = await api('/api/inventory/usage', undefined, token);
    check(u0.status === 200 && u0.j.usedBytes === 0, 'empty inventory reports 0 used');
    check(u0.j.maxFileBytes === MAX_FILE, 'per-file cap reported as ' + MAX_FILE);
    console.log('   usage ->', JSON.stringify(u0.j));

    /* --- A real upload round-trips byte for byte ----------------------- */
    const payload = crypto.randomBytes(40000);
    const up1 = await upload(token, payload, 'scan-one.bin', 'First scan');
    check(up1.status === 200, '40 KB upload accepted');
    const fileId = up1.j.file && up1.j.file.id;
    check(!!fileId, 'upload returned a file id');
    check(up1.j.file && up1.j.file.name === 'scan-one.bin', 'name preserved');
    check(up1.j.file && up1.j.file.description === 'First scan', 'description preserved');
    check(up1.j.file && up1.j.file.size === 40000, 'size recorded as 40000');

    const back = await fetch(BASE + '/api/inventory/file/' + fileId + '?download=1', {
        headers: { Authorization: 'Bearer ' + token }
    });
    const backBuf = Buffer.from(await back.arrayBuffer());
    check(back.status === 200, 'file downloads');
    check(backBuf.length === 40000 && backBuf.equals(payload), 'downloaded bytes are identical to the upload');
    check(/attachment/.test(back.headers.get('content-disposition') || ''), 'download=1 forces attachment');
    check((back.headers.get('content-disposition') || '').includes('scan-one.bin'),
        'download filename uses the stored name');

    /* A non-image is always an attachment, even without ?download=1. */
    const plainRes = await fetch(BASE + '/api/inventory/file/' + fileId, {
        headers: { Authorization: 'Bearer ' + token }
    });
    await plainRes.arrayBuffer();
    check(/attachment/.test(plainRes.headers.get('content-disposition') || ''),
        'a non-image is served as an attachment');

    /* An image is served inline so the viewer and print dialog can open it. */
    const imageBuf = crypto.randomBytes(5000);
    const upImg = await upload(token, imageBuf, 'xray.png', 'Chest x-ray', null, 'image/png');
    check(upImg.status === 200, 'image upload accepted');
    const inlineRes = await fetch(BASE + '/api/inventory/file/' + upImg.j.file.id, {
        headers: { Authorization: 'Bearer ' + token }
    });
    await inlineRes.arrayBuffer();
    check(/^inline/.test(inlineRes.headers.get('content-disposition') || ''),
        'an image is served inline for the viewer');
    check((inlineRes.headers.get('content-disposition') || '').includes('xray.png'),
        'inline response keeps the stored filename');
    /* Free the space again so the quota maths below stays predictable. */
    await api('/api/inventory/delete', { id: upImg.j.file.id }, token);

    /* --- Usage reflects the stored file -------------------------------- */
    const u1 = await api('/api/inventory/usage', undefined, token);
    check(u1.j.usedBytes === 40000, 'usage now 40000');
    check(u1.j.fileCount === 1, 'fileCount is 1');

    /* --- Per-file cap -------------------------------------------------- */
    const tooBig = await upload(token, crypto.randomBytes(70000), 'huge.bin', 'over the cap');
    check(tooBig.status === 413, 'file above the per-file cap is refused (got ' + tooBig.status + ')');
    check(/FILE_TOO_LARGE/.test(tooBig.j.error || ''), 'refusal is tagged FILE_TOO_LARGE');
    const u2 = await api('/api/inventory/usage', undefined, token);
    check(u2.j.usedBytes === 40000, 'a refused upload does not consume the allowance');

    /* --- Quota ---------------------------------------------------------- */
    /* 40 KB in, 60 KB left; two more 40 KB files would need 80 KB. */
    const fills = await upload(token, crypto.randomBytes(40000), 'scan-two.bin', 'second');
    check(fills.status === 200, 'second file fits (80 KB of 100 KB used)');
    const over = await upload(token, crypto.randomBytes(40000), 'scan-three.bin', 'third');
    check(over.status === 413, 'file that would breach the quota is refused (got ' + over.status + ')');
    check(/QUOTA_EXCEEDED/.test(over.j.error || ''), 'refusal is tagged QUOTA_EXCEEDED');
    console.log('   quota error ->', over.j.error);

    const u3 = await api('/api/inventory/usage', undefined, token);
    check(u3.j.usedBytes === 80000, 'usage is 80000 after two accepted files');

    /* --- Deleting frees the allowance ---------------------------------- */
    const del = await api('/api/inventory/delete', { id: fileId }, token);
    check(del.status === 200, 'delete accepted');
    const u4 = await api('/api/inventory/usage', undefined, token);
    console.log('   usage after delete ->', JSON.stringify(u4.j));
    check(u4.j.usedBytes === 40000,
        'allowance drops back to 40000 after delete (got ' + u4.j.usedBytes + ')');

    const gone = await fetch(BASE + '/api/inventory/file/' + fileId, {
        headers: { Authorization: 'Bearer ' + token }
    });
    await gone.arrayBuffer();
    check(gone.status === 404, 'a deleted file can no longer be downloaded');

    /* --- Ownership and auth -------------------------------------------- */
    const anon = await fetch(BASE + '/api/inventory/file/' + fileId);
    await anon.arrayBuffer();
    check(anon.status === 401, 'anonymous download is refused');

    /* A second user must not reach the first user's file. */
    const made = await api('/api/admin/staff', {
        name: 'Nurse Tesfa', username: 'tesfa', usernameAuto: true,
        role: 'nurse', phone: '0900112233'
    }, token);
    check(made.status === 200, 'second account created');
    const login2 = await api('/api/auth/login', { username: 'tesfa', password: 'anything' });
    const token2 = login2.j.token;
    const cross = await fetch(BASE + '/api/inventory/file/' +
        (await api('/api/inventory/usage', undefined, token), fileId), {
        headers: { Authorization: 'Bearer ' + token2 }
    });
    await cross.arrayBuffer();
    check(cross.status === 404 || cross.status === 403, 'another user cannot read the file');

    /* --- Filenames cannot escape the inventory folder ------------------- */
    const evil = await upload(token2, crypto.randomBytes(10), '../../escape.bin', 'nope');
    check(evil.status === 200, 'traversal-style filename accepted as a plain name');
    const escaped = fs.existsSync(path.join(tmpRoot, 'escape.bin')) ||
                    fs.existsSync(path.join(tmpRoot, '..', 'escape.bin'));
    check(!escaped, 'file did not escape the inventory folder');
    const invDir = path.join(tmpRoot, 'data', 'inventory');
    const onDisk = fs.readdirSync(invDir);
    check(onDisk.every((f) => /^f_[a-z0-9_]+\.bin$/.test(f)),
        'stored names are server-generated (' + onDisk.join(', ') + ')');

    /* --- Understating Content-Length ----------------------------------- */
    /* Runs last because it deliberately leaves a malformed request in flight.
       Claims 10 KB (passes the declared check) while really sending 70 KB.
       A well-behaved HTTP stack only surfaces Content-Length bytes, so the
       server may accept 10 KB or reset the connection. Either is fine; what
       must NOT happen is all 70 KB being stored against the allowance. */
    const beforeSneaky = (await api('/api/inventory/usage', undefined, token)).j.usedBytes;
    let sneaky = null;
    try {
        sneaky = await upload(token, crypto.randomBytes(70000), 'sneaky.bin', 'lies', 10000);
        console.log('   understated length ->', sneaky.status, JSON.stringify(sneaky.j).slice(0, 160));
    } catch (e) {
        console.log('   understated length -> connection reset (' + e.code + ')');
    }
    /* Give the server a moment in case the reset beat its last write. */
    await new Promise((r) => setTimeout(r, 600));
    const uSneaky = await api('/api/inventory/usage', undefined, token);
    console.log('   usage after understated upload ->', JSON.stringify(uSneaky.j));
    check(uSneaky.j.usedBytes - beforeSneaky <= 10000,
        'understating the length stores at most the declared 10 KB (delta=' +
        (uSneaky.j.usedBytes - beforeSneaky) + ')');
    check(uSneaky.j.usedBytes - beforeSneaky !== 70000,
        'the full 70 KB body was never stored');

    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    console.log(failures ? '\n' + failures + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
    process.exit(failures ? 1 : 0);
})().catch((e) => {
    console.log('FAIL: threw ->', e && e.stack);
    console.log(log);
    child.kill(); process.exit(1);
});
