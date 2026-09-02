/* Throwaway harness: mints a session for each account directly in SQLite and
   reports which collections /api/state hands to that role. */
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const http = require('http');

const db = new DatabaseSync('C:/Users/Ermiyas/Desktop/ERP System/data/erp.db');
const BASE = 'http://127.0.0.1:8000';

function mint(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const exp = new Date(now.getTime() + 3600000);
    db.prepare(`INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)`)
        .run(token, userId, now.toISOString(), exp.toISOString());
    return token;
}

function get(path, token) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: 8000, path, headers: { Authorization: 'Bearer ' + token } }, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, json: JSON.parse(body) }); }
                catch (e) { resolve({ status: res.statusCode, raw: body.slice(0, 200) }); }
            });
        }).on('error', reject);
    });
}

const users = db.prepare(`SELECT id, username, name, role, active FROM users ORDER BY id`).all();
console.log('Accounts in the database:');
users.forEach(u => console.log(`  #${u.id} ${u.username.padEnd(14)} role=${u.role.padEnd(8)} active=${u.active}`));
console.log('');

(async () => {
    const seen = {};
    for (const u of users) {
        if (seen[u.role]) continue;          // one representative per role
        seen[u.role] = true;

        const token = mint(u.id);
        const me = await get('/api/auth/me', token);
        const state = await get('/api/state', token);

        if (state.status !== 200) {
            console.log(`[${u.role}] /api/state -> ${state.status}`, state.raw || '');
            continue;
        }
        const cols = state.json.collections || {};
        const keys = Object.keys(cols).sort();
        const missing = (state.json.managed || []).filter(k => !keys.includes(k)).sort();

        console.log(`=== ${u.role.toUpperCase()}  (${u.username}) ===`);
        console.log(`  /api/auth/me role : ${me.json && me.json.user && me.json.user.role}`);
        console.log(`  collections sent  : ${keys.length}`);
        console.log(`  WITHHELD          : ${missing.length ? missing.join(', ') : '(none)'}`);

        const att = cols['clinic_attendance'];
        if (Array.isArray(att)) {
            console.log(`  attendance rows   : ${att.length}` +
                (att.length ? ' -> ' + att.map(r => `${r.username}@${r.date}`).join(', ') : ''));
        }
        const staff = cols['clinic_staff_members'];
        if (Array.isArray(staff) && staff.length) {
            console.log(`  staff fields      : ${Object.keys(staff[0]).sort().join(', ')}`);
        }
        console.log('');
    }

    // Cross-check: can a doctor see a nurse's attendance?
    console.log('--- attendance cross-visibility check ---');
    const all = db.prepare(`SELECT value FROM kv WHERE key='clinic_attendance'`).get();
    const rows = all ? JSON.parse(all.value) : [];
    console.log(`  total attendance rows on server: ${rows.length}`);
    rows.forEach(r => console.log(`    ${r.username} (${r.role}) ${r.date} out=${r.out ? 'yes' : 'no'}`));
})();
