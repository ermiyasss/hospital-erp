'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

/* ==================================================================
   Configuration
   ================================================================== */
const PORT = Number(process.env.ERP_PORT || 8000);
const HOST = process.env.ERP_HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'erp.db');
const SESSION_HOURS = 12;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/* ==================================================================
   Database
   ================================================================== */
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email      TEXT DEFAULT '',
        name       TEXT NOT NULL,
        phone      TEXT DEFAULT '',
        department TEXT DEFAULT '',
        shift      TEXT DEFAULT '',
        role       TEXT NOT NULL,
        joined     TEXT DEFAULT '',
        active     INTEGER DEFAULT 1,
        pw_hash    TEXT NOT NULL,
        pw_salt    TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
`);

/* ==================================================================
   Migrations: older databases predate these columns, and SQLite will
   refuse to start if a column is added twice, so each is a no-op when
   it already exists.
   ================================================================== */
['age INTEGER DEFAULT 0',
 'created_by TEXT DEFAULT ""',
 'must_reset_password INTEGER DEFAULT 0',
 'suspended_until TEXT DEFAULT ""',
 'locked_hwid TEXT DEFAULT ""',
 'hwid_enforced INTEGER DEFAULT 0',
 /* 1 = the account was created without a password. Sign-in accepts any
    password exactly once and then forces the person to choose their own. */
 'no_password INTEGER DEFAULT 0'].forEach(function (col) {
    try { db.exec('ALTER TABLE users ADD COLUMN ' + col); } catch (e) { /* already present */ }
});

/* ==================================================================
   Inventory file storage

   Inventory uploads are written to disk as ordinary files in their own
   folder, and only their metadata travels in the synchronised JSON. The
   previous approach inlined every file into that JSON as a base64 data URL,
   which is why the practical ceiling was a few megabytes: the whole
   collection is parsed and re-serialised on every save, and the API body
   limit is a few MB. Real files on disk let an account hold gigabytes.
   ================================================================== */
const INVENTORY_DIR = path.join(DATA_DIR, 'inventory');

/* Defaults are 6 GB per account and 1.5 GB per file. Both can be tuned per
   installation with ERP_INVENTORY_QUOTA / ERP_INVENTORY_MAX_FILE (bytes);
   a nonsense value falls back to the default rather than disabling the cap. */
const DEFAULT_INVENTORY_QUOTA = 6 * 1024 * 1024 * 1024;
const DEFAULT_MAX_INVENTORY_FILE = 1.5 * 1024 * 1024 * 1024;

function bytesFromEnv(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const INVENTORY_QUOTA_BYTES = bytesFromEnv('ERP_INVENTORY_QUOTA', DEFAULT_INVENTORY_QUOTA);
const MAX_INVENTORY_FILE_BYTES = bytesFromEnv('ERP_INVENTORY_MAX_FILE', DEFAULT_MAX_INVENTORY_FILE);

if (!fs.existsSync(INVENTORY_DIR)) fs.mkdirSync(INVENTORY_DIR, { recursive: true });

db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_files (
        id          TEXT PRIMARY KEY,
        owner       TEXT NOT NULL,
        name        TEXT NOT NULL,
        description TEXT DEFAULT '',
        mime        TEXT DEFAULT '',
        size        INTEGER NOT NULL DEFAULT 0,
        stored_name TEXT NOT NULL,
        created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_files_owner ON inventory_files(owner);
`);

function formatBytes(n) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = Number(n) || 0;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return (i === 0 ? String(Math.round(value)) : value.toFixed(value >= 100 ? 0 : 1)) + ' ' + units[i];
}

/* Bytes this account has already used, according to the files on disk. */
function inventoryUsedBytes(username) {
    const row = db.prepare(
        `SELECT COALESCE(SUM(size), 0) AS n FROM inventory_files WHERE owner = ?`
    ).get(username);
    return Number(row && row.n) || 0;
}

/* Delete one account's uploaded files, freeing their share of the quota. */
function purgeInventoryFiles(username) {
    const owner = String(username).toLowerCase();
    const rows = db.prepare(`SELECT stored_name FROM inventory_files WHERE owner = ?`).all(owner);
    db.prepare(`DELETE FROM inventory_files WHERE owner = ?`).run(owner);
    rows.forEach(function (r) {
        try {
            const p = path.join(INVENTORY_DIR, r.stored_name);
            if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (e) { /* orphaned file; unreachable without its row */ }
    });
}

/* Wipe every uploaded inventory file (administrator data reset). */
function purgeAllInventoryFiles() {
    db.prepare(`DELETE FROM inventory_files`).run();
    try {
        fs.readdirSync(INVENTORY_DIR).forEach(function (f) {
            try { fs.unlinkSync(path.join(INVENTORY_DIR, f)); } catch (e) {}
        });
    } catch (e) { /* nothing to clear */ }
}

function getVersion() {
    const row = db.prepare(`SELECT value FROM meta WHERE key='version'`).get();
    return row ? Number(row.value) : 0;
}
function bumpVersion() {
    const v = getVersion() + 1;
    db.prepare(`INSERT INTO meta(key,value) VALUES('version',?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(v));
    return v;
}

/* ==================================================================
   Password hashing (scrypt — never plaintext, never reversible)
   ================================================================== */
function hashPassword(password, salt) {
    salt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return { hash, salt };
}
function verifyPassword(password, salt, expectedHash) {
    const candidate = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    return candidate.length === expected.length &&
        crypto.timingSafeEqual(candidate, expected);
}

/* ==================================================================
   Roles and permissions
   Mirrors the frontend role keys in js/session.js. The frontend menu is
   convenience only — THIS table is what actually enforces access.
   ================================================================== */
const VALID_ROLES = ['admin', 'doctor', 'nurse', 'billing', 'lab'];

/* Staff-directory role labels (js/staff.js vocabulary) -> session role keys */
const DIRECTORY_ROLE_MAP = {
    Admin: 'admin',
    Doctor: 'doctor',
    Nurse: 'nurse',
    Lab: 'lab',
    Billing: 'billing'
};

/* Resolve a directory role label (or already-normalised key) to a session
   role key, case-insensitively, so a stray capitalisation can never reject a
   valid staff role with a 400. */
function resolveDirectoryRole(value) {
    if (!value) return null;
    const v = String(value).trim();
    if (DIRECTORY_ROLE_MAP[v]) return DIRECTORY_ROLE_MAP[v];
    const lower = v.toLowerCase();
    const hit = Object.keys(DIRECTORY_ROLE_MAP).filter(function (k) {
        return k.toLowerCase() === lower;
    })[0];
    return hit ? DIRECTORY_ROLE_MAP[hit] : null;
}

/* Every collection the frontend persists, mapped to who may REPLACE it.
   Key strings are the exact localStorage keys the frontend already uses,
   so the data layer maps 1:1 onto the existing code. */
const ALL_ROLES = VALID_ROLES;
const CLINICAL_WRITE = ['admin', 'doctor', 'nurse'];
const COLLECTIONS = {
    'clinic_patients_data':    { roles: ALL_ROLES },
    'clinic_lab_requests':     { roles: ['admin', 'doctor', 'nurse', 'lab'] },
    'clinic_lab_archive':      { roles: ['admin', 'doctor', 'nurse', 'lab'] },
    'clinic_prescriptions_data': { roles: CLINICAL_WRITE },
    'clinic_nurse_tasks':      { roles: CLINICAL_WRITE },
    'clinic_nurse_tracking':   { roles: CLINICAL_WRITE },
    'clinic_beds':             { roles: ['admin', 'doctor', 'nurse'] },
    'clinic_messages':         { roles: ALL_ROLES, appendOnly: true },
    'clinic_appointments':     { roles: ['admin', 'doctor'] },
    'clinic_profiles':         { roles: ALL_ROLES, appendOnly: true },
    'clinic_storage_items':    { roles: ['admin', 'nurse'] },
    'clinic_invoices':         { roles: ['admin', 'doctor', 'billing'] },
    'clinic_price_list':       { roles: ['admin', 'billing'] },
        'clinic_notifications_log':{ roles: ALL_ROLES },
        'clinic_admin_requests':   { roles: ALL_ROLES },
        'clinic_announcements':    { roles: ['admin', 'doctor'] },
        'clinic_attendance':       { roles: ALL_ROLES, appendOnly: true },
        'clinic_inventory':        { roles: ALL_ROLES },
        'clinic_groups':           { roles: ALL_ROLES },
        /* Per-person "I deleted this chat" records, so a deleted conversation
           stays hidden on the workstation that removed it while everyone else
           keeps seeing it. */
        'clinic_chat_hidden':      { roles: ALL_ROLES }
    };
/* Scalar values kept server-side (business rules), read through /api/state.
   The attendance policy is handled separately because it is a JSON object
   with its own validation, not a fixed set of strings. */
const SCALARS = {
    'clinic_queue_policy': { roles: ['admin', 'doctor', 'nurse', 'billing'],
                             values: ['priority_first', 'arrival_order'] }
};

/* ==================================================================
   Read access for /api/state

   COLLECTIONS above answers "who may replace this data". This map answers
   the other half: "who may even receive it". Until now /api/state handed
   every signed-in workstation the entire database, so a doctor's browser
   held the full staff attendance history, every invoice, every salary-band
   field in the staff directory and all laboratory traffic — the client just
   chose not to draw some of it. That is not access control.

   Hard rule: read must include write. A role allowed to replace a
   collection but not to read it back would load an empty list, edit it,
   and persist that empty list over everybody's data. The assertion at the
   bottom of this block fails loudly at start-up if that is ever broken.
   ================================================================== */
const READ_ROLES = {
    'clinic_patients_data':       ALL_ROLES,
    'clinic_lab_requests':        ['admin', 'doctor', 'nurse', 'lab'],
    'clinic_lab_archive':         ['admin', 'doctor', 'nurse', 'lab'],
    'clinic_prescriptions_data':  CLINICAL_WRITE,
    'clinic_nurse_tasks':         CLINICAL_WRITE,
    'clinic_nurse_tracking':      CLINICAL_WRITE,
    'clinic_beds':                ['admin', 'doctor', 'nurse'],
    'clinic_messages':            ALL_ROLES,
    'clinic_appointments':        ['admin', 'doctor'],
    'clinic_profiles':            ALL_ROLES,
    'clinic_storage_items':       ['admin', 'nurse'],
    'clinic_invoices':            ['admin', 'doctor', 'billing'],
    'clinic_price_list':          ['admin', 'billing'],
    'clinic_notifications_log':   ALL_ROLES,
    'clinic_admin_requests':      ALL_ROLES,
    /* Anyone may post an announcement they can read back; the authorship
       rules live in handlePutData. */
    'clinic_announcements':       ALL_ROLES,
    'clinic_attendance':          ALL_ROLES,
    'clinic_inventory':           ALL_ROLES,
    'clinic_groups':              ALL_ROLES,
    'clinic_chat_hidden':         ALL_ROLES
};

/* Guard the invariant above rather than trusting future edits. */
Object.keys(COLLECTIONS).forEach(function (key) {
    const read = READ_ROLES[key];
    if (!read) {
        throw new Error('READ_ROLES is missing an entry for "' + key + '".');
    }
    COLLECTIONS[key].roles.forEach(function (role) {
        if (read.indexOf(role) === -1) {
            throw new Error('Collection "' + key + '" lets "' + role +
                '" write but not read — that would let it overwrite the data with an empty list.');
        }
    });
});

/* Build the slice of the database this account is allowed to receive. */
function visibleCollections(data, user) {
    const out = {};
    Object.keys(data).forEach(function (key) {
        const allowed = READ_ROLES[key];
        if (allowed && allowed.indexOf(user.role) === -1) return;

        let value = data[key];

        /* Attendance is per-person data. The administrator needs the roster to
           run the floor; everybody else gets their own card and nothing else,
           so no one can read a colleague's arrival times or warnings. */
        if (key === 'clinic_attendance' && user.role !== 'admin' && Array.isArray(value)) {
            const me = String(user.username || '').toLowerCase();
            value = value.filter(function (r) {
                return String((r && r.username) || '').toLowerCase() === me;
            });
        }

        out[key] = value;
    });
    return out;
}
const ATTENDANCE_POLICY_KEY = 'clinic_attendance_policy';
const DEFAULT_ATTENDANCE_POLICY = {
    checkinStart: '08:00',
    checkinEnd: '09:00',
    checkoutStart: '17:00',
    checkoutEnd: '18:00',
    graceMinutes: 15
};

/* ==================================================================
   Validation — never trust the client
   ================================================================== */
class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

function requireArray(value, label) {
    if (!Array.isArray(value)) throw new ApiError(400, label + ' must be a list.');
    return value;
}
function cleanText(v, max) {
    return String(v == null ? '' : v).slice(0, max || 500);
}
function requireText(obj, field, label, max) {
    const v = cleanText(obj[field], max).trim();
    if (!v) throw new ApiError(400, label + ' is required.');
    return v;
}

const PATIENT_STATUSES = ['Pending', 'In Consultation', 'Awaiting Results',
    'Awaiting Payment', 'Finished'];

function validatePatients(list) {
    const seenTracking = new Set();
    list.forEach(function (p, i) {
        if (!p || typeof p !== 'object') throw new ApiError(400, 'Patient #' + (i + 1) + ' is invalid.');
        requireText(p, 'name', 'Patient name (' + (i + 1) + ')');
        if (p.trackingId !== undefined && p.trackingId !== null && p.trackingId !== '') {
            const t = String(p.trackingId);
            if (seenTracking.has(t)) {
                throw new ApiError(409, 'Duplicate patient tracking ID "' + t + '".');
            }
            seenTracking.add(t);
        }
        if (p.status && PATIENT_STATUSES.indexOf(p.status) === -1) {
            throw new ApiError(400, 'Unknown patient status "' + p.status + '".');
        }
        if (p.vitals !== undefined && p.vitals !== null && typeof p.vitals !== 'object') {
            throw new ApiError(400, 'Vitals must be recorded as fields, not free text.');
        }
    });
}

function validateAnnouncements(list) {
    list.forEach(function (a, i) {
        if (!a || typeof a !== 'object') throw new ApiError(400, 'Announcement #' + (i + 1) + ' is invalid.');
        requireText(a, 'title', 'Announcement title (' + (i + 1) + ')', 200);
        requireText(a, 'body', 'Announcement message (' + (i + 1) + ')', 8000);
        const target = String(a.target || 'all');
        if (target !== 'all' && VALID_ROLES.indexOf(target) === -1) {
            throw new ApiError(400, 'Unknown announcement audience "' + target + '".');
        }
    });
}

function validateAttendance(list) {
    list.forEach(function (r, i) {
        if (!r || typeof r !== 'object') throw new ApiError(400, 'Attendance record #' + (i + 1) + ' is invalid.');
        requireText(r, 'name', 'Staff name (' + (i + 1) + ')', 120);
        if (VALID_ROLES.indexOf(r.role) === -1) {
            throw new ApiError(400, 'Unknown role "' + r.role + '" in attendance record ' + (i + 1) + '.');
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || ''))) {
            throw new ApiError(400, 'Attendance record ' + (i + 1) + ' has an invalid date.');
        }
    });
}

function validateInvoices(list) {
    const seen = new Set();
    list.forEach(function (inv, i) {
        if (!inv || typeof inv !== 'object') throw new ApiError(400, 'Invoice #' + (i + 1) + ' is invalid.');
        const id = inv.number || inv.id;
        if (id !== undefined && id !== null) {
            const k = String(inv.number || '') + '|' + String(inv.id || '');
            if (id && seen.has(k)) throw new ApiError(409, 'Duplicate invoice reference.');
            seen.add(k);
        }
        requireText(inv, 'patientName', 'Invoice patient name (' + (i + 1) + ')', 120);
    });
}

const APPOINTMENT_STATUSES = ['Pending', 'Accepted', 'Declined', 'Completed', 'Cancelled'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateBeds(list) {
    const seen = new Set();
    list.forEach(function (b, i) {
        if (!b || typeof b !== 'object') throw new ApiError(400, 'Bed #' + (i + 1) + ' is invalid.');
        const label = requireText(b, 'label', 'Bed label (' + (i + 1) + ')', 40);
        requireText(b, 'ward', 'Bed ward (' + (i + 1) + ')', 60);
        const key = label.toLowerCase() + '|' + String(b.ward || '').toLowerCase();
        if (seen.has(key)) throw new ApiError(409, 'Duplicate bed "' + label + '" in ' + b.ward + '.');
        seen.add(key);
        const status = String(b.status || 'Free');
        if (['Free', 'Occupied', 'Cleaning', 'Reserved'].indexOf(status) === -1) {
            throw new ApiError(400, 'Unknown bed status "' + status + '".');
        }
    });
}

function validateAppointments(list) {
    list.forEach(function (a, i) {
        if (!a || typeof a !== 'object') throw new ApiError(400, 'Appointment #' + (i + 1) + ' is invalid.');
        requireText(a, 'patientName', 'Appointment patient name (' + (i + 1) + ')', 120);
        if (!DATE_RE.test(String(a.date || ''))) {
            throw new ApiError(400, 'Appointment ' + (i + 1) + ' has an invalid date.');
        }
        if (a.time && !TIME_RE.test(String(a.time))) {
            throw new ApiError(400, 'Appointment ' + (i + 1) + ' has an invalid time.');
        }
        if (a.status && APPOINTMENT_STATUSES.indexOf(a.status) === -1) {
            throw new ApiError(400, 'Unknown appointment status "' + a.status + '".');
        }
    });
}

function validateGeneric(list, label) {
    requireArray(list, label).forEach(function (item, i) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
            throw new ApiError(400, label + ' entry #' + (i + 1) + ' is invalid.');
        }
    });
}

function validateCollection(key, value) {
    const list = requireArray(value, 'Data');
    switch (key) {
        case 'clinic_patients_data':     validatePatients(list); break;
        case 'clinic_announcements':     validateAnnouncements(list); break;
        case 'clinic_attendance':        validateAttendance(list); break;
        case 'clinic_invoices':          validateInvoices(list); break;
        case 'clinic_beds':              validateBeds(list); break;
        case 'clinic_appointments':      validateAppointments(list); break;
        default:                         validateGeneric(list, 'Records'); break;
    }
    return list;
}

/* ==================================================================
   Staff directory <-> user accounts
   The frontend edits one "clinic_staff_members" array. The server keeps
   that snapshot in kv AND maintains real login accounts (users table)
   from it. Plaintext passwords are accepted transiently on write, hashed
   immediately, and never stored or sent back.
   ================================================================== */
function activeAdminCount() {
    return db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1`).get().n;
}

function syncUsersFromStaff(list) {
    /* Validate first — nothing is written unless the whole list is sound. */
    const seenUsernames = new Set();
    list.forEach(function (m, i) {
        if (!m || typeof m !== 'object') throw new ApiError(400, 'Staff member #' + (i + 1) + ' is invalid.');
        const username = requireText(m, 'username', 'Username (' + (i + 1) + ')', 60);
        requireText(m, 'name', 'Full name (' + (i + 1) + ')', 120);
        if (seenUsernames.has(username.toLowerCase())) {
            throw new ApiError(409, 'Duplicate username "' + username + '".');
        }
        seenUsernames.add(username.toLowerCase());
        const dirRole = String(m.role || '');
        if (!resolveDirectoryRole(dirRole)) {
            throw new ApiError(400, 'Unknown staff role "' + dirRole + '" (' + (i + 1) + ').');
        }
        if (m.password !== undefined && m.password !== null && m.password !== '' &&
            String(m.password).length < 6) {
            throw new ApiError(400, 'Password for "' + username + '" must be at least 6 characters.');
        }
    });

    /* Guardrail: the last active administrator cannot be removed or demoted. */
    const adminsInList = list.filter(function (m) { return m.role === 'Admin'; }).length;
    if (adminsInList === 0 && activeAdminCount() <= 1) {
        throw new ApiError(400, 'At least one administrator account must remain.');
    }

    const now = new Date().toISOString();
    const getByUsername = db.prepare(`SELECT * FROM users WHERE username = ?`);
    const insertUser = db.prepare(`INSERT INTO users
        (username, email, name, phone, department, shift, role, joined, active, age, created_by,
         hwid_enforced, pw_hash, pw_salt, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const updateUser = db.prepare(`UPDATE users SET email=?, name=?, phone=?, department=?,
        shift=?, role=?, joined=?, active=?, age=?, hwid_enforced=? WHERE id=?`);
    const setPassword = db.prepare(`UPDATE users SET pw_hash=?, pw_salt=? WHERE id=?`);

    list.forEach(function (m) {
        const dirRole = String(m.role);
        const role = DIRECTORY_ROLE_MAP[dirRole];
        const username = String(m.username).trim();
        const email = cleanText(m.email, 120);
        const existing = getByUsername.get(username);
        const age = Number(m.age) || 0;
        const hwidEnforced = m.hwidEnforced === true || m.hwid_enforced === true ? 1 : 0;

        if (!existing) {
            if (!m.password) {
                throw new ApiError(400, 'New staff member "' + username + '" needs a sign-in password.');
            }
            const hp = hashPassword(m.password);
            insertUser.run(username, email, cleanText(m.name, 120), cleanText(m.phone, 40),
                cleanText(m.department, 120), cleanText(m.shift, 40), role,
                cleanText(m.joined, 30), m.active === false ? 0 : 1, age,
                cleanText(m.createdBy || m.created_by || '', 60), hwidEnforced, hp.hash, hp.salt, now);
        } else {
            if (existing.role === 'admin' && role !== 'admin' && existing.active === 1 &&
                activeAdminCount() <= 1) {
                throw new ApiError(400, 'Cannot remove the last administrator.');
            }
            updateUser.run(email, cleanText(m.name, 120), cleanText(m.phone, 40),
                cleanText(m.department, 120), cleanText(m.shift, 40), role,
                cleanText(m.joined, 30), m.active === false ? 0 : 1, age, hwidEnforced, existing.id);
            if (m.password) {
                const hp = hashPassword(m.password);
                setPassword.run(hp.hash, hp.salt, existing.id);
                /* Password change invalidates existing sessions. */
                db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(existing.id);
            }
        }

        /* Strip the plaintext password before the snapshot is stored. */
        delete m.password;
    });

    /* Deactivate accounts removed from the directory. */
    const listed = new Set(list.map(function (m) { return String(m.username).toLowerCase(); }));
    db.prepare(`SELECT id, username, role, active FROM users`).all().forEach(function (u) {
        if (!listed.has(String(u.username).toLowerCase())) {
            if (u.role === 'admin' && u.active === 1 && activeAdminCount() <= 1) return;
            db.prepare(`UPDATE users SET active=0 WHERE id=?`).run(u.id);
            db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(u.id);
        }
    });
}

/* Fields every colleague genuinely needs in order to work together: pick a
   doctor for a patient, address a message, see who is on which shift.
   Everything else — contact details, HR dates, suspension state, device
   locks — is personnel data and stays with the administrator. */
const STAFF_PUBLIC_FIELDS = ['id', 'name', 'username', 'role', 'department', 'shift', 'active'];

function staffSnapshot(user) {
    /* Directory view for the frontend — never includes password material. */
    const rows = db.prepare(`SELECT username, email, name, phone, department, shift,
        role, joined, active, age, created_by, must_reset_password, no_password,
        suspended_until, hwid_enforced, locked_hwid FROM users ORDER BY id`).all();
    const reverse = { admin: 'Admin', doctor: 'Doctor', nurse: 'Nurse', lab: 'Lab', billing: 'Billing' };

    const full = rows.map(function (u, i) {
        return {
            id: i + 1,
            name: u.name,
            username: u.username,
            email: u.email || '',
            phone: u.phone || '',
            role: reverse[u.role] || 'Doctor',
            department: u.department || '',
            shift: u.shift || '',
            joined: u.joined || '',
            age: u.age || 0,
            createdBy: u.created_by || '',
            active: !!u.active,
            mustResetPassword: !!u.must_reset_password,
            needsPassword: !!u.no_password,
            suspendedUntil: u.suspended_until || '',
            hwidEnforced: !!u.hwid_enforced,
            lockedHwid: u.locked_hwid || ''
        };
    });

    /* Only the administrator gets the full personnel record. */
    if (user && user.role === 'admin') return full;

    return full.map(function (row) {
        const safe = {};
        STAFF_PUBLIC_FIELDS.forEach(function (f) { safe[f] = row[f]; });
        return safe;
    });
}

/* ==================================================================
   Sessions
   ================================================================== */
function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    db.prepare(`INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)`)
        .run(token, userId, new Date(now).toISOString(), new Date(now + SESSION_HOURS * 3600000).toISOString());
    return token;
}

function purgeSessions() {
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(new Date().toISOString());
}

function userForToken(token) {
    if (!token) return null;
    purgeSessions();
    const row = db.prepare(`SELECT s.user_id, s.expires_at FROM sessions s WHERE s.token=?`).get(token);
    if (!row) return null;
    const user = db.prepare(`SELECT id, username, name, role, active FROM users WHERE id=?`).get(row.user_id);
    if (!user || !user.active) return null;
    return user;
}

function bearerToken(req) {
    const h = req.headers['authorization'] || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return m ? m[1].trim() : null;
}

/* ==================================================================
   kv storage (collections + scalars)
   ================================================================== */
function kvGetAll() {
    const out = {};
    db.prepare(`SELECT key, value FROM kv`).all().forEach(function (row) {
        try { out[row.key] = JSON.parse(row.value); } catch (e) { out[row.key] = []; }
    });
    return out;
}

function kvReadJson(key, fallback) {
    try {
        const row = db.prepare(`SELECT value FROM kv WHERE key=?`).get(key);
        if (!row) return fallback;
        const parsed = JSON.parse(row.value);
        return parsed === undefined || parsed === null ? fallback : parsed;
    } catch (e) {
        return fallback;
    }
}

function kvWriteJson(key, value) {
    db.prepare(`INSERT INTO kv(key,value,updated_at) VALUES(?,?,?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
        .run(key, JSON.stringify(value), new Date().toISOString());
}

/* ==================================================================
   Server-side notifications
   Written directly into the shared alert log so every workstation
   sees them through the normal state sync.
   ================================================================== */
function pushServerNotification(title, message, type, category, priority) {
    const list = kvReadJson('clinic_notifications_log', []);
    if (!Array.isArray(list)) return;
    list.unshift({
        id: 'srv_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        title: String(title).slice(0, 120),
        message: String(message).slice(0, 500),
        type: type || 'info',
        priority: priority || 'normal',
        category: category || 'System',
        timestamp: new Date().toISOString(),
        read: false
    });
    kvWriteJson('clinic_notifications_log', list.slice(0, 60));
}

/* ==================================================================
   Attendance — server-side enforcement

   Rules enforced HERE, not in any browser:
     1. One attendance record per account per day. A second check-in
        on the same day is refused.
     2. A day that has been checked in can never be removed or edited
        by a client. The collection is append-only and every change
        goes through the dedicated endpoints below.
     3. A checked-in day is not finished until the person checks out;
        while it is open nothing may delete it.
     4. The administrator sets a check-in window and a check-out
        window. Checking in or out outside the window records a
        warning on the record.
     5. When a staff member reaches 2 warnings in one day, an urgent
        notification is written for administrators (once per day).
   ================================================================== */
function attendancePolicy() {
    const stored = kvReadJson(ATTENDANCE_POLICY_KEY, {});
    const merged = Object.assign({}, DEFAULT_ATTENDANCE_POLICY,
        stored && typeof stored === 'object' ? stored : {});
    return merged;
}

function minutesOf(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
}

function todayKey() {
    const t = new Date();
    return t.getFullYear() + '-' +
        String(t.getMonth() + 1).padStart(2, '0') + '-' +
        String(t.getDate()).padStart(2, '0');
}

function readAttendance() {
    const list = kvReadJson('clinic_attendance', []);
    return Array.isArray(list) ? list : [];
}

function validatePolicyObject(p) {
    if (!p || typeof p !== 'object') throw new ApiError(400, 'Send the attendance policy as an object.');
    ['checkinStart', 'checkinEnd', 'checkoutStart', 'checkoutEnd'].forEach(function (f) {
        if (!TIME_RE.test(String(p[f] || ''))) {
            throw new ApiError(400, 'Attendance time "' + (p[f] || '') + '" must be HH:MM (24-hour).');
        }
    });
    const grace = Number(p.graceMinutes);
    if (!isFinite(grace) || grace < 0 || grace > 180) {
        throw new ApiError(400, 'Grace minutes must be between 0 and 180.');
    }
    if (minutesOf(p.checkinStart) >= minutesOf(p.checkinEnd)) {
        throw new ApiError(400, 'The check-in window must start before it ends.');
    }
    if (minutesOf(p.checkoutStart) >= minutesOf(p.checkoutEnd)) {
        throw new ApiError(400, 'The check-out window must start before it ends.');
    }
    return {
        checkinStart: p.checkinStart,
        checkinEnd: p.checkinEnd,
        checkoutStart: p.checkoutStart,
        checkoutEnd: p.checkoutEnd,
        graceMinutes: Math.round(grace)
    };
}

function checkWarningThreshold(rec) {
    if (!rec || !Array.isArray(rec.warnings)) return;
    if (rec.warnings.length < 2 || rec.adminNotified) return;
    rec.adminNotified = true;
    const detail = rec.warnings.map(function (w) { return w.detail; }).join('; ');
    pushServerNotification(
        'Attendance warnings: ' + rec.name,
        rec.name + ' (' + rec.role + ') reached ' + rec.warnings.length +
            ' attendance warnings today — ' + detail + '.',
        'error', 'Attendance', 'critical'
    );
}

function handleAttendanceCheckin(res, user, body) {
    const list = readAttendance();
    const today = todayKey();
    let target = { id: user.id, username: user.username, name: user.name, role: user.role };
    let manual = false;

    /* An administrator may log a colleague who shares the workstation. */
    if (body && body.username && String(body.username).toLowerCase() !== user.username.toLowerCase()) {
        if (user.role !== 'admin') {
            throw new ApiError(403, 'Only administrators can check in another staff member.');
        }
        const found = db.prepare(`SELECT id, username, name, role FROM users
                                  WHERE username = ? AND active = 1`).get(String(body.username).trim());
        if (!found) throw new ApiError(404, 'No active account with that username.');
        target = found;
        manual = true;
    }

    const existing = list.find(function (r) {
        return r.date === today && String(r.username).toLowerCase() === String(target.username).toLowerCase();
    });
    if (existing) {
        if (existing.out) {
            throw new ApiError(409, target.name + ' already completed today (' +
                existing.date + '). The day is locked until tomorrow.');
        }
        throw new ApiError(409, target.name + ' is already checked in today and has not checked out yet.');
    }

    const now = new Date();
    const policy = attendancePolicy();
    const rec = {
        id: 'att_' + now.getTime(),
        userId: target.id,
        username: target.username,
        name: target.name,
        role: target.role,
        date: today,
        in: now.toISOString(),
        out: null,
        warnings: [],
        manual: manual,
        loggedBy: manual ? user.name : undefined
    };

    const mins = now.getHours() * 60 + now.getMinutes();
    const lateAfter = minutesOf(policy.checkinEnd) + Number(policy.graceMinutes || 0);
    if (mins > lateAfter) {
        rec.inLate = true;
        rec.warnings.push({
            code: 'late_checkin',
            at: now.toISOString(),
            detail: 'Checked in after ' + policy.checkinEnd
        });
    }

    list.unshift(rec);
    kvWriteJson('clinic_attendance', list.slice(0, 5000));
    checkWarningThreshold(rec);
    bumpVersion();
    sendJson(res, 200, { ok: true, record: rec, version: getVersion() });
}

function handleAttendanceCheckout(res, user) {
    const list = readAttendance();
    const today = todayKey();
    const rec = list.find(function (r) {
        return r.date === today && String(r.username).toLowerCase() === String(user.username).toLowerCase() && !r.out;
    });
    if (!rec) {
        throw new ApiError(404, 'No open attendance record for today. Check in first.');
    }

    const now = new Date();
    rec.out = now.toISOString();

    const policy = attendancePolicy();
    const mins = now.getHours() * 60 + now.getMinutes();
    const grace = Number(policy.graceMinutes || 0);
    let warned = false;
    if (mins < minutesOf(policy.checkoutStart) - grace) {
        rec.warnings.push({
            code: 'early_checkout',
            at: now.toISOString(),
            detail: 'Checked out before ' + policy.checkoutStart
        });
        warned = true;
    } else if (mins > minutesOf(policy.checkoutEnd) + grace) {
        rec.warnings.push({
            code: 'late_checkout',
            at: now.toISOString(),
            detail: 'Checked out after ' + policy.checkoutEnd
        });
        warned = true;
    }

    kvWriteJson('clinic_attendance', list.slice(0, 5000));
    if (warned) checkWarningThreshold(rec);
    bumpVersion();
    sendJson(res, 200, { ok: true, record: rec, version: getVersion() });
}

function handleAttendancePolicy(res, user, body) {
    if (user.role !== 'admin') {
        throw new ApiError(403, 'Only administrators can change the attendance policy.');
    }
    const policy = validatePolicyObject(body);
    kvWriteJson(ATTENDANCE_POLICY_KEY, policy);
    bumpVersion();
    sendJson(res, 200, { ok: true, policy: policy, version: getVersion() });
}

/* ==================================================================
   Messages — staff-to-staff messaging
   The author is stamped from the session, never from the request.
   ================================================================== */
function handleSendMessage(res, user, body) {
    if (!body || typeof body !== 'object') throw new ApiError(400, 'Send a message.');
    const text = cleanText(body.body, 4000).trim();
    if (!text && (!body.attachments || !body.attachments.length)) {
        throw new ApiError(400, 'A message needs some text or a file.');
    }

    const toType = String(body.toType || 'all');
    if (['all', 'role', 'user', 'group'].indexOf(toType) === -1) {
        throw new ApiError(400, 'Unknown recipient type.');
    }

    const msg = {
        id: 'msg_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        fromUsername: user.username,
        fromName: user.name,
        fromRole: user.role,
        toType: toType,
        /* 'system' notices (someone deleted a chat) render as a centred
           line in the thread instead of a chat bubble. */
        kind: body.kind === 'system' ? 'system' : 'chat',
        body: text,
        attachments: sanitizeAttachments(body.attachments),
        time: new Date().toISOString()
    };

    if (toType === 'group') {
        const gid = cleanText(body.groupId, 80).trim();
        if (!gid) throw new ApiError(400, 'Choose a group to post in.');
        msg.groupId = gid;
        msg.groupName = cleanText(body.groupName, 120);
    } else if (toType === 'role') {
        const role = String(body.toRole || '');
        if (VALID_ROLES.indexOf(role) === -1) throw new ApiError(400, 'Unknown recipient role.');
        msg.toRole = role;
    } else if (toType === 'user') {
        const found = db.prepare(`SELECT username, name, role FROM users
                                  WHERE username = ? AND active = 1`).get(String(body.toUsername || '').trim());
        if (!found) throw new ApiError(404, 'No active account with that username.');
        msg.toUsername = found.username;
        msg.toName = found.name;
        msg.toRole = found.role;
    }

    const list = kvReadJson('clinic_messages', []);
    if (!Array.isArray(list)) throw new ApiError(500, 'Message store is corrupt.');
    list.unshift(msg);
    kvWriteJson('clinic_messages', list.slice(0, 500));
    bumpVersion();
    sendJson(res, 200, { ok: true, message: msg, version: getVersion() });
}

/* Deleting a single message. Messages are append-only for writes, so removal
   goes through here where authorship can be checked: you may delete what you
   wrote, and an administrator may delete anything. Removal is for everyone —
   the thread simply reads as if the message was never sent. */
function handleDeleteMessage(res, user, body) {
    if (!body || typeof body !== 'object') throw new ApiError(400, 'Choose a message.');
    const id = cleanText(body.id, 80).trim();
    if (!id) throw new ApiError(400, 'Choose a message to delete.');

    const list = kvReadJson('clinic_messages', []);
    if (!Array.isArray(list)) throw new ApiError(500, 'Message store is corrupt.');
    const msg = list.filter(function (m) { return m && m.id === id; })[0];
    if (!msg) throw new ApiError(404, 'That message has already been deleted.');
    if (user.role !== 'admin' && String(msg.fromUsername) !== String(user.username)) {
        throw new ApiError(403, 'You can only delete messages you sent.');
    }

    kvWriteJson('clinic_messages', list.filter(function (m) { return !m || m.id !== id; }));
    bumpVersion();
    sendJson(res, 200, { ok: true, version: getVersion() });
}

/* Keep only safe fields from a message attachment; reject anything that is
   not a file or image descriptor so a client cannot smuggle arbitrary keys
   into the shared store. */
function sanitizeAttachments(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 10).map(function (a) {
        if (!a || typeof a !== 'object') return null;
        const kind = String(a.kind || '');
        const name = cleanText(a.name, 160);
        const mime = cleanText(a.mime, 80);
        const data = cleanText(a.data, 5 * 1024 * 1024);
        const size = Number(a.size) || 0;
        if (!name || (kind !== 'image' && kind !== 'file')) return null;
        return { kind: kind, name: name, mime: mime, data: data, size: size };
    }).filter(Boolean);
}

/* ==================================================================
   Appointments
   Patients book through the public website endpoint; administrators
   and doctors manage the list from the dashboard. A doctor may only
   decide appointments addressed to them.
   ================================================================== */
function handlePublicAppointment(req, res, body) {
    if (!body || typeof body !== 'object') throw new ApiError(400, 'Send the appointment details.');
    const name = requireText(body, 'patientName', 'Patient name', 120);
    const phone = requireText(body, 'patientPhone', 'Phone number', 30);
    if (!/^[0-9+\-\s()]{7,}$/.test(phone)) throw new ApiError(400, 'That phone number does not look valid.');
    const date = String(body.date || '');
    if (!DATE_RE.test(date)) throw new ApiError(400, 'Choose a valid date.');
    const time = String(body.time || '');
    if (!TIME_RE.test(time)) throw new ApiError(400, 'Choose a valid time.');
    if (date < todayKey()) throw new ApiError(400, 'The date cannot be in the past.');

    const doctor = cleanText(body.doctor, 120).trim() || 'First available doctor';
    const reason = cleanText(body.reason, 500);

    /* The same endpoint serves the public website (unauthenticated) and
       staff booking from the dashboard (an optional session is honoured). */
    const staffUser = userForToken(bearerToken(req));

    const list = kvReadJson('clinic_appointments', []);
    if (!Array.isArray(list)) throw new ApiError(500, 'Appointment store is corrupt.');
    const appt = {
        id: 'apt_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        patientName: name,
        patientPhone: phone,
        doctor: doctor,
        date: date,
        time: time,
        reason: reason,
        status: 'Pending',
        source: staffUser ? 'staff' : 'online',
        createdBy: staffUser ? staffUser.name : 'Website booking',
        createdAt: new Date().toISOString()
    };
    list.unshift(appt);
    kvWriteJson('clinic_appointments', list.slice(0, 1000));
    bumpVersion();
    pushServerNotification(
        staffUser ? 'Appointment booked' : 'New appointment request',
        name + ' requested ' + doctor + ' on ' + date + ' at ' + time + '.',
        'info', 'Appointment', 'normal'
    );
    sendJson(res, 200, { ok: true, appointment: appt });
}

function handleAppointmentDecision(res, user, body) {
    if (!body || typeof body !== 'object') throw new ApiError(400, 'Send the decision.');
    const decision = String(body.decision || '');
    if (['Accepted', 'Declined'].indexOf(decision) === -1) {
        throw new ApiError(400, 'Decision must be Accepted or Declined.');
    }
    const list = kvReadJson('clinic_appointments', []);
    if (!Array.isArray(list)) throw new ApiError(500, 'Appointment store is corrupt.');
    const appt = list.find(function (a) { return String(a.id) === String(body.id); });
    if (!appt) throw new ApiError(404, 'Appointment not found.');
    if (user.role === 'doctor' && appt.doctor !== user.name) {
        throw new ApiError(403, 'This appointment is not addressed to you.');
    }
    if (appt.status !== 'Pending') {
        throw new ApiError(409, 'This appointment was already ' + appt.status.toLowerCase() + '.');
    }

    appt.status = decision;
    appt.decidedBy = user.name;
    appt.decidedAt = new Date().toISOString();
    appt.decisionNote = cleanText(body.note, 500);
    /* The patient-facing message channel is a later integration; record
       what has to be delivered so nothing is lost in the meantime. */
    appt.patientNotification = {
        due: true,
        text: 'Your appointment with ' + appt.doctor + ' on ' + appt.date +
              ' at ' + appt.time + ' was ' + decision.toLowerCase() + '.'
    };

    kvWriteJson('clinic_appointments', list.slice(0, 1000));
    bumpVersion();
    pushServerNotification(
        'Appointment ' + decision.toLowerCase(),
        user.name + ' ' + decision.toLowerCase() + ' ' + appt.patientName +
            '\u2019s appointment (' + appt.date + ' ' + appt.time + ').',
        decision === 'Accepted' ? 'success' : 'warning', 'Appointment', 'normal'
    );
    sendJson(res, 200, { ok: true, appointment: appt, version: getVersion() });
}

/* ==================================================================
   Profiles — each signed-in user maintains their own record only
   ================================================================== */
const PROFILE_PHOTO_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;

function handleProfileUpdate(res, user, body) {
    if (!body || typeof body !== 'object') throw new ApiError(400, 'Send profile details.');

    const list = kvReadJson('clinic_profiles', []);
    if (!Array.isArray(list)) throw new ApiError(500, 'Profile store is corrupt.');
    let profile = list.find(function (p) {
        return String(p.username).toLowerCase() === String(user.username).toLowerCase();
    });
    if (!profile) {
        profile = { username: user.username };
        list.push(profile);
    }

    if (body.name !== undefined) {
        const name = cleanText(body.name, 120).trim();
        if (!name) throw new ApiError(400, 'Name cannot be empty.');
        profile.name = name;
        /* Keep the login account and the staff directory in step. */
        db.prepare(`UPDATE users SET name=? WHERE id=?`).run(name, user.id);
    }
    if (body.age !== undefined) {
        const age = Number(body.age);
        if (!isFinite(age) || age < 0 || age > 120) throw new ApiError(400, 'Age must be between 0 and 120.');
        profile.age = age === 0 ? null : Math.round(age);
    }
    if (body.sex !== undefined) {
        const sex = cleanText(body.sex, 20);
        if (sex && ['Female', 'Male', 'Other'].indexOf(sex) === -1) {
            throw new ApiError(400, 'Sex must be Female, Male or Other.');
        }
        profile.sex = sex;
    }
    if (body.phone !== undefined) profile.phone = cleanText(body.phone, 30);
    if (body.address !== undefined) profile.address = cleanText(body.address, 300);
    if (body.photo !== undefined) {
        if (body.photo === null || body.photo === '') {
            profile.photo = null;
        } else {
            const photo = String(body.photo);
            if (!PROFILE_PHOTO_RE.test(photo)) throw new ApiError(400, 'Photo must be a PNG, JPEG or WebP image.');
            if (photo.length > 400000) throw new ApiError(413, 'Photo is too large after encoding.');
            profile.photo = photo;
        }
    }
    profile.updatedAt = new Date().toISOString();

    kvWriteJson('clinic_profiles', list);
    bumpVersion();
    sendJson(res, 200, { ok: true, profile: profile, version: getVersion() });
}

function handleChangePassword(res, user, body, currentToken) {
    if (!body || typeof body !== 'object') throw new ApiError(400, 'Send the password fields.');
    const current = String(body.current == null ? '' : body.current);
    const next = String(body.next == null ? '' : body.next);
    if (!current || !next) throw new ApiError(400, 'Current and new passwords are required.');
    if (next.length < 6) throw new ApiError(400, 'The new password must be at least 6 characters.');

    const row = db.prepare(`SELECT pw_hash, pw_salt FROM users WHERE id=?`).get(user.id);
    if (!row || !verifyPassword(current, row.pw_salt, row.pw_hash)) {
        throw new ApiError(401, 'The current password is not correct.');
    }
    const hp = hashPassword(next);
    db.prepare(`UPDATE users SET pw_hash=?, pw_salt=? WHERE id=?`).run(hp.hash, hp.salt, user.id);
    /* Other workstations must sign in again; this one stays signed in. */
    db.prepare(`DELETE FROM sessions WHERE user_id=? AND token != ?`).run(user.id, currentToken || '');
    sendJson(res, 200, { ok: true });
}

/* ==================================================================
   HTTP plumbing
   ================================================================== */
function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store'
    });
    res.end(body);
}

function readBody(req) {
    return new Promise(function (resolve, reject) {
        let size = 0;
        const chunks = [];
        req.on('data', function (chunk) {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new ApiError(413, 'Request too large.'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', function () {
            if (!chunks.length) return resolve(null);
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch (e) { reject(new ApiError(400, 'Invalid JSON in request body.')); }
        });
        req.on('error', function () { reject(new ApiError(400, 'Could not read request.')); });
    });
}

/* ------------------------------------------------------------------
   Route handlers
   ------------------------------------------------------------------ */
function findUserByIdentifier(identifier) {
    const id = cleanText(identifier, 120).trim();
    if (!id) return null;
    const lowered = id.toLowerCase();
    /* Phone numbers arrive in many spacings; normalise to bare digits for the
       lookup. Only treat the input as a possible phone number when it actually
       contains enough digits — otherwise the `phone = ''` comparison would
       match every account that has no phone stored and verification would then
       fail with "incorrect password". */
    const digits = String(id).replace(/\D/g, '');
    const conditions = [`username = ?`, `LOWER(email) = ?`];
    const params = [id, lowered];
    if (digits.length >= 7) {
        conditions.push('phone = ?');
        params.push(digits);
    }
    const user = db.prepare(
        `SELECT * FROM users WHERE (${conditions.join(' OR ')}) AND active = 1`
    ).get(...params);
    return user || null;
}

function handleLogin(req, res, body) {
    if (!body || typeof body !== 'object') throw new ApiError(400, 'Send your username and password.');
    const identifier = cleanText(body.username, 120).trim();
    const password = String(body.password == null ? '' : body.password);
    if (!identifier || !password) throw new ApiError(400, 'Username and password are required.');

    const user = findUserByIdentifier(identifier);
    if (!user) throw new ApiError(401, 'Wrong username, email, phone or password.');

    /* An account created without a password (the normal way now): whatever
       they type in the password box is accepted on this first pass, and the
       client immediately forces them to choose a real one. The credential
       check is skipped rather than weakened — see noPasswordSignIn below. */
    const firstPass = !!user.no_password;
    if (!firstPass && !verifyPassword(password, user.pw_salt, user.pw_hash)) {
        throw new ApiError(401, 'Wrong username, email, phone or password.');
    }

    /* A suspended account is declined outright, with how long it is locked. */
    if (user.suspended_until) {
        const until = new Date(user.suspended_until).getTime();
        if (!isNaN(until) && until > Date.now()) {
            throw new ApiError(403, 'This account is suspended until ' +
                new Date(user.suspended_until).toLocaleString() + '. Contact an administrator.');
        }
        db.prepare(`UPDATE users SET suspended_until = '' WHERE id = ?`).run(user.id);
    }

    /* Device lock: when enforced, the first device used becomes the only one
       allowed. A different machine is refused. */
    const hwid = cleanText(body.hwid, 120).trim();
    if (user.hwid_enforced) {
        if (user.locked_hwid && hwid && user.locked_hwid !== hwid) {
            throw new ApiError(403, 'This account is locked to its first registered device. ' +
                'Sign in from the device you first used, or ask an administrator to unlock it.');
        }
        if (!user.locked_hwid && hwid) {
            db.prepare(`UPDATE users SET locked_hwid = ? WHERE id = ?`).run(hwid, user.id);
        }
    }

    /* Two ways a sign-in is only half finished:
         needsPassword — the account has no password at all yet (new staff).
         mustReset     — an administrator flagged a change.
       In both cases a token is issued so the client can show the
       set-your-password screen, but the session is inert until it is done. */
    const token = createSession(user.id);
    sendJson(res, 200, {
        token: token,
        needsPassword: firstPass,
        mustReset: firstPass ? false : !!user.must_reset_password,
        user: { username: user.username, name: user.name, role: user.role }
    });
}

function handleState(res, user) {
    const data = kvGetAll();
    /* The staff directory is rebuilt live from the users table so deleted or
       renamed accounts can never drift from what can actually log in. */
    data['clinic_staff_members'] = staffSnapshot(user);
    /* `managed` lists every key this server stores. The client uses it to tell
       "withheld from me" apart from "not mine to store": a withheld key must
       never be written back, or the role would overwrite real data with the
       empty list it received. */
    sendJson(res, 200, {
        version: getVersion(),
        collections: visibleCollections(data, user),
        managed: Object.keys(COLLECTIONS)
            .concat(['clinic_staff_members', ATTENDANCE_POLICY_KEY, 'clinic_queue_policy'])
    });
}

function handlePutData(req, res, user, key, body) {
    /* Scalar business values (currently only the queue policy). */
    if (SCALARS[key]) {
        if (SCALARS[key].roles.indexOf(user.role) === -1) {
            throw new ApiError(403, 'Your role is not allowed to change this setting.');
        }
        const value = String(body);
        if (SCALARS[key].values.indexOf(value) === -1) {
            throw new ApiError(400, 'Invalid value "' + value + '" for ' + key + '.');
        }
        db.prepare(`INSERT INTO kv(key,value,updated_at) VALUES(?,?,?)
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
            .run(key, JSON.stringify(value), new Date().toISOString());
        return sendJson(res, 200, { ok: true, version: bumpVersion() });
    }

    const spec = COLLECTIONS[key];
    if (!spec) {
        if (key === ATTENDANCE_POLICY_KEY) {
            return handleAttendancePolicy(res, user, body);
        }
        throw new ApiError(404, 'Unknown data collection "' + key + '".');
    }
    if (spec.roles.indexOf(user.role) === -1) {
        throw new ApiError(403, 'Your role is not allowed to change "' + key + '".');
    }
    /* Attendance, messages and profiles are maintained through their own
       endpoints so a client can never rewrite or erase history. */
    if (spec.appendOnly) {
        throw new ApiError(403, '"' + key + '" is managed by the server. ' +
            'Attendance and messages go through their dedicated endpoints.');
    }

    let list = body;
    /* A staff-directory write goes through account synchronisation instead of
       being stored verbatim. */
    if (spec.staff) {
        requireArray(body, 'Staff directory');
        syncUsersFromStaff(JSON.parse(JSON.stringify(body)));
        bumpVersion();
        return sendJson(res, 200, { ok: true, version: getVersion() });
    }

    list = validateCollection(key, body);

    /* Announcement authorship is enforced server-side too. */
    if (key === 'clinic_announcements') {
        list = list.map(function (a) {
            if (a.authorRole && VALID_ROLES.indexOf(a.authorRole) === -1) a.authorRole = 'admin';
            return a;
        });
    }

    db.prepare(`INSERT INTO kv(key,value,updated_at) VALUES(?,?,?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
        .run(key, JSON.stringify(list), new Date().toISOString());
    const version = bumpVersion();
    sendJson(res, 200, { ok: true, version: version });
}

function handleAccessRequest(res, body) {
    if (!body || typeof body !== 'object') throw new ApiError(400, 'Send a request.');
    const name = cleanText(body.name, 120).trim();
    if (!name) throw new ApiError(400, 'A name is required.');
    const message = cleanText(body.message, 1000) || 'Asked for help signing in.';

    const key = 'clinic_admin_requests';
    let list = [];
    try {
        const row = db.prepare(`SELECT value FROM kv WHERE key=?`).get(key);
        list = row ? JSON.parse(row.value) : [];
        if (!Array.isArray(list)) list = [];
    } catch (e) { list = []; }

    list.unshift({
        id: Date.now(),
        name: name,
        message: message,
        time: new Date().toISOString(),
        status: 'Pending'
    });

    db.prepare(`INSERT INTO kv(key,value,updated_at) VALUES(?,?,?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
        .run(key, JSON.stringify(list.slice(0, 200)), new Date().toISOString());
    bumpVersion();
    sendJson(res, 200, { ok: true });
}

function handleReset(res, user) {
    Object.keys(COLLECTIONS).forEach(function (key) {
        if (key === 'clinic_staff_members') return;   /* accounts survive a data reset */
        db.prepare(`DELETE FROM kv WHERE key=?`).run(key);
    });
    db.prepare(`DELETE FROM sessions`).run();         /* force everyone to sign in again */
    purgeAllInventoryFiles();                         /* uploaded inventory files go too */
    const version = bumpVersion();
    sendJson(res, 200, { ok: true, version: version });
}

function handleExport(res, user) {
    const data = kvGetAll();
    data['clinic_staff_members'] = staffSnapshot().map(function (m) {
        return Object.assign({}, m, { role: m.role });
    });
    sendJson(res, 200, { exported: new Date().toISOString(), version: getVersion(), data: data });
}

/* ==================================================================
   Forced password set (after an administrator reset)

   When must_reset_password is set, sign-in still returns a token but flags
   mustReset. The client shows a "choose a new password" screen and calls
   this endpoint — no old password is needed because the administrator
   already vetted the person.
   ================================================================== */
function handleForcePassword(res, user, body) {
    if (!body || typeof body !== 'object') throw new ApiError(400, 'Send the new password.');
    const next = String(body.next == null ? '' : body.next);
    if (next.length < 6) throw new ApiError(400, 'The new password must be at least 6 characters.');

    /* Hash exactly once: the hash and salt below MUST come from the same call,
       otherwise the stored hash is computed with a salt that is never saved and
       every later sign-in fails with "wrong password". */
    const hp = hashPassword(next);
    db.prepare(`UPDATE users SET pw_hash=?, pw_salt=?, must_reset_password=0, no_password=0 WHERE id=?`)
        .run(hp.hash, hp.salt, user.id);
    /* Other workstations sign out; this one stays. */
    db.prepare(`DELETE FROM sessions WHERE user_id=? AND token != ?`).run(user.id, bearerTokenFromRes(res));
    sendJson(res, 200, { ok: true });
}

/* Pull the bearer token without re-reading headers (set during routing). */
function bearerTokenFromRes(res) {
    return res._token || '';
}

/* ==================================================================
   Staff administration (administrators only)

   These endpoints edit the real login accounts directly, so they are the
   single place staff are created, suspended, locked to a device or removed.
   ================================================================== */
function requireAdmin(user) {
    if (user.role !== 'admin') throw new ApiError(403, 'Only administrators can manage staff.');
}

function slugifyName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'staff';
}

/* Phone numbers are compared on their last 9 digits so "0911…" and
   "+251 911…" are understood to be the same person. */
function phoneKey(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length <= 9 ? digits : digits.slice(-9);
}

function usernameTaken(username) {
    return !!db.prepare(`SELECT id FROM users WHERE username = ?`).get(username);
}

/* First free username in the family: abhemmekonen, then abhemmekonen2, … */
function nextFreeUsername(base) {
    if (!usernameTaken(base)) return base;
    for (let n = 2; n < 1000; n++) {
        const candidate = base + n;
        if (!usernameTaken(candidate)) return candidate;
    }
    return base + '_' + crypto.randomBytes(2).toString('hex');
}

function handleCreateStaff(res, user, body) {
    requireAdmin(user);
    if (!body || typeof body !== 'object') throw new ApiError(400, 'Send the staff details.');

    const name = requireText(body, 'name', 'Full name', 120);
    const roleKey = resolveDirectoryRole(body.role);
    if (!roleKey) throw new ApiError(400, 'Choose a valid role.');
    const phone = cleanText(body.phone, 40).trim();
    if (!phone) throw new ApiError(400, 'A phone number is required.');

    /* Username defaults to the full name, squashed to lowercase with the
       spaces removed: "Abhem Mekonen" -> "abhemmekonen". A typed username is
       honoured exactly, and refused if taken; an auto-derived one quietly
       moves to the next free number instead of failing. */
    const base = slugifyName(name);
    const typed = cleanText(body.username, 60).trim().toLowerCase();
    let username;
    if (typed && body.usernameAuto !== true) {
        if (usernameTaken(typed)) {
            throw new ApiError(409, 'The username "' + typed + '" is already taken. ' +
                'Try "' + nextFreeUsername(base) + '" instead.');
        }
        username = typed;
    } else {
        /* Auto-derived from the name: never fail, just take the next number. */
        username = nextFreeUsername(typed || base);
    }

    /* A duplicate phone is a warning, not an error: the administrator may be
       re-hiring someone or typing a shared desk number on purpose. They
       confirm by sending allowDuplicatePhone. */
    const dupKey = phoneKey(phone);
    /* `phone` must be in the column list: without it every row's phone reads
       as undefined and the clash below can never match. */
    const clash = dupKey
        ? db.prepare(`SELECT name, role, username, phone FROM users WHERE active = 1`).all()
            .filter(function (u) { return phoneKey(u.phone) === dupKey; })[0]
        : null;
    if (clash && !body.allowDuplicatePhone) {
        throw new ApiError(409, 'DUPLICATE_PHONE:' +
            (clash.name || clash.username) + ' already uses this phone number.');
    }

    const email = cleanText(body.email, 120).trim();
    const age = Number(body.age) || 0;
    const shift = cleanText(body.shift, 40);
    const joined = cleanText(body.joined, 30) || new Date().toISOString().slice(0, 10);

    /* Staff are created WITHOUT a password. On their first sign-in the server
       accepts whatever they type and the client immediately walks them into
       choosing their own. The hash below is a real one for a value nobody
       knows, so the row is never in a half-initialised state. */
    const noPassword = !body.password;
    let hp;
    if (noPassword) {
        hp = hashPassword(crypto.randomBytes(24).toString('hex'));
    } else {
        if (String(body.password).length < 6) {
            throw new ApiError(400, 'Password must be at least 6 characters.');
        }
        hp = hashPassword(String(body.password));
    }

    /* One bound value per '?' placeholder, in column order. `created_by`
       records which administrator opened the account; leaving it out made
       SQLite reject the whole insert ("too few parameter values"), which
       surfaced to the administrator as an unexplained 500. */
    db.prepare(`INSERT INTO users
        (username, email, name, phone, department, shift, role, joined, active, age,
         created_by, must_reset_password, no_password, hwid_enforced, pw_hash, pw_salt, created_at)
        VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,0,?,?,?)`)
        .run(username, email, name, phone, cleanText(body.department, 120),
             shift, roleKey, joined, age, user.username,
             noPassword ? 1 : 0, noPassword ? 1 : 0,
             hp.hash, hp.salt, new Date().toISOString());

    bumpVersion();
    sendJson(res, 200, {
        ok: true,
        username: username,
        needsPassword: noPassword,
        version: getVersion()
    });
}

/* An administrator either types a password for the person (they simply sign
   in with it) or leaves it blank, which empties the account and sends them
   through the same forced "choose your password" walk as a new starter. */
function handleResetPassword(res, user, body) {
    requireAdmin(user);
    const username = cleanText(body.username, 60).trim().toLowerCase();
    if (!username) throw new ApiError(400, 'Choose a staff member.');
    const target = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
    if (!target) throw new ApiError(404, 'No account with that username.');

    const next = String(body.password == null ? '' : body.password);
    if (next) {
        if (next.length < 6) throw new ApiError(400, 'The password must be at least 6 characters.');
        const hp = hashPassword(next);
        db.prepare(`UPDATE users SET pw_hash=?, pw_salt=?, must_reset_password=0, no_password=0 WHERE id=?`)
            .run(hp.hash, hp.salt, target.id);
    } else {
        /* Nothing usable to compare against until they set one. */
        const hp = hashPassword(crypto.randomBytes(24).toString('hex'));
        db.prepare(`UPDATE users SET pw_hash=?, pw_salt=?, must_reset_password=1, no_password=1 WHERE id=?`)
            .run(hp.hash, hp.salt, target.id);
    }
    /* Anywhere they are already signed in stops working. */
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(target.id);
    bumpVersion();
    sendJson(res, 200, { ok: true, needsPassword: !next, version: getVersion() });
}

function handleSuspend(res, user, body) {
    requireAdmin(user);
    const username = cleanText(body.username, 60).trim().toLowerCase();
    if (!username) throw new ApiError(400, 'Choose a staff member.');
    const target = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
    if (!target) throw new ApiError(404, 'No account with that username.');
    if (target.role === 'admin' && target.active === 1 && activeAdminCount() <= 1) {
        throw new ApiError(400, 'You cannot suspend the last administrator.');
    }

    const duration = String(body.duration || 'none');
    let until = '';
    if (duration === 'hour') until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    else if (duration === 'day') until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    else if (duration === 'indefinite') until = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();

    const active = duration === 'none' ? 1 : 0;
    db.prepare(`UPDATE users SET suspended_until = ?, active = ? WHERE id = ?`).run(until, active, target.id);
    if (active === 0) db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(target.id);
    bumpVersion();
    sendJson(res, 200, { ok: true, version: getVersion() });
}

function handleSetHwid(res, user, body) {
    requireAdmin(user);
    const username = cleanText(body.username, 60).trim().toLowerCase();
    if (!username) throw new ApiError(400, 'Choose a staff member.');
    const target = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
    if (!target) throw new ApiError(404, 'No account with that username.');

    if (body.unlock) {
        db.prepare(`UPDATE users SET locked_hwid = '', hwid_enforced = 0 WHERE id = ?`).run(target.id);
    } else {
        const enabled = body.enabled === true;
        db.prepare(`UPDATE users SET hwid_enforced = ?, locked_hwid = '' WHERE id = ?`)
            .run(enabled ? 1 : 0, target.id);
    }
    bumpVersion();
    sendJson(res, 200, { ok: true, version: getVersion() });
}

function handleRestoreStaff(res, user, body) {
    requireAdmin(user);
    const username = cleanText(body.username, 60).trim().toLowerCase();
    if (!username) throw new ApiError(400, 'Choose a staff member.');
    const target = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
    if (!target) throw new ApiError(404, 'No account with that username.');
    db.prepare(`UPDATE users SET active = 1, suspended_until = '' WHERE id = ?`).run(target.id);
    bumpVersion();
    sendJson(res, 200, { ok: true, version: getVersion() });
}

/* Soft-disable an account so its owner can no longer sign in, but keep the
   record (it can be reactivated later). The directory snapshot is regenerated
   from the users table, so the person is shown as deactivated. The last
   active administrator is protected. */
function handleDeactivateStaff(res, user, body) {
    requireAdmin(user);
    const username = cleanText(body.username, 60).trim().toLowerCase();
    if (!username) throw new ApiError(400, 'Choose a staff member.');
    const target = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
    if (!target) throw new ApiError(404, 'No account with that username.');
    if (target.role === 'admin' && target.active === 1 && activeAdminCount() <= 1) {
        throw new ApiError(400, 'You cannot deactivate the last administrator.');
    }
    db.prepare(`UPDATE users SET active = 0, suspended_until = '' WHERE id = ?`).run(target.id);
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(target.id);
    bumpVersion();
    sendJson(res, 200, { ok: true, version: getVersion() });
}

/* Permanently remove a staff member and every trace of their account: the
   login row, their sessions, attendance history, messages and group
   memberships. Clinical records that only carry their name (lab orders,
   notes, prescriptions) are retained so patient history stays complete. */
function handleRemoveStaff(res, user, body) {
    requireAdmin(user);
    const username = cleanText(body.username, 60).trim().toLowerCase();
    if (!username) throw new ApiError(400, 'Choose a staff member.');
    const target = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
    if (!target) throw new ApiError(404, 'No account with that username.');
    if (target.role === 'admin' && activeAdminCount() <= 1) {
        throw new ApiError(400, 'You cannot remove the last administrator.');
    }

    /* Attendance history for this account. */
    const att = kvReadJson('clinic_attendance', []);
    if (Array.isArray(att)) {
        const kept = att.filter(function (r) {
            return String(r.username || '').toLowerCase() !== username;
        });
        if (kept.length !== att.length) kvWriteJson('clinic_attendance', kept.slice(0, 5000));
    }

    /* Direct messages involving this person, and their group memberships. */
    const msgs = kvReadJson('clinic_messages', []);
    if (Array.isArray(msgs)) {
        const kept = msgs.filter(function (m) {
            return String(m.fromUsername || '').toLowerCase() !== username &&
                   String(m.toUsername || '').toLowerCase() !== username;
        });
        if (kept.length !== msgs.length) kvWriteJson('clinic_messages', kept.slice(0, 5000));
    }

    /* The person's own profile record. */
    const profiles = kvReadJson('clinic_profiles', []);
    if (Array.isArray(profiles)) {
        const kept = profiles.filter(function (p) {
            return String(p.username || '').toLowerCase() !== username;
        });
        if (kept.length !== profiles.length) kvWriteJson('clinic_profiles', kept);
    }

    /* Nurse tasks / tracking assigned specifically to this person. */
    ['clinic_nurse_tasks', 'clinic_nurse_tracking'].forEach(function (key) {
        const list = kvReadJson(key, []);
        if (!Array.isArray(list)) return;
        const kept = list.filter(function (t) {
            return String(t.assignedTo || t.username || '').toLowerCase() !== username &&
                   String(t.by || '').toLowerCase() !== username;
        });
        if (kept.length !== list.length) kvWriteJson(key, kept.slice(0, 5000));
    });

    /* Beds reserved to this person (their assignment, not the patient history). */
    const beds = kvReadJson('clinic_beds', []);
    if (Array.isArray(beds)) {
        const kept = beds.map(function (b) {
            if (String(b.assignedNurse || '').toLowerCase() === username) {
                const copy = Object.assign({}, b);
                delete copy.assignedNurse;
                return copy;
            }
            return b;
        });
        if (JSON.stringify(kept) !== JSON.stringify(beds)) kvWriteJson('clinic_beds', kept);
    }
    const groups = kvReadJson('clinic_groups', []);
    if (Array.isArray(groups)) {
        const cleaned = groups.map(function (g) {
            g.members = (g.members || []).filter(function (m) {
                return String(m.username || '').toLowerCase() !== username;
            });
            return g;
        }).filter(function (g) { return g.members.length > 0; });
        kvWriteJson('clinic_groups', cleaned);
    }

    /* Their private "chats I deleted" list goes with them. */
    const chatHidden = kvReadJson('clinic_chat_hidden', []);
    if (Array.isArray(chatHidden)) {
        const kept = chatHidden.filter(function (h) {
            return String(h.username || '').toLowerCase() !== username;
        });
        if (kept.length !== chatHidden.length) kvWriteJson('clinic_chat_hidden', kept);
    }

    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(target.id);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(target.id);
    /* Free the files they had uploaded so the space returns to the pool. */
    purgeInventoryFiles(username);
    bumpVersion();
    sendJson(res, 200, { ok: true, version: getVersion() });
}

/* ==================================================================
   Inventory endpoints

   Uploads are streamed straight to disk rather than buffered: a 1.5 GB file
   must never sit in memory, and readBody()'s 5 MB JSON cap does not apply
   here. The per-file cap and the account quota are both enforced while the
   bytes arrive, so a client that lies about Content-Length cannot write
   more than it is allowed.
   ================================================================== */

/* After a client has already blown the limit we keep reading (and throwing
   away) its bytes so the HTTP exchange can finish cleanly, but only up to a
   point — an endless stream should not be able to pin the connection open. */
const UPLOAD_DRAIN_CEILING = 64 * 1024 * 1024;

function streamUploadToFile(req, destPath, maxBytes) {
    return new Promise(function (resolve, reject) {
        let size = 0;
        let over = false;
        let drained = 0;
        let settled = false;

        const out = fs.createWriteStream(destPath);
        let outEnded = false;

        /* Always close the write stream before the partial file is removed:
           Windows refuses to delete a file that still has an open handle, so
           an unclosed stream would leave orphans behind on every failure. */
        const closeOut = function (then) {
            if (outEnded) { then(); return; }
            outEnded = true;
            try { out.end(function () { then(); }); }
            catch (e) { then(); }
        };
        const removeFile = function () {
            try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (e) {}
        };

        const finish = function (fn, arg) {
            if (settled) return;
            settled = true;
            req.removeAllListeners('data');
            req.removeAllListeners('end');
            req.removeAllListeners('aborted');
            if (fn === reject) closeOut(function () { removeFile(); reject(arg); });
            else closeOut(function () { resolve(arg); });
        };

        req.on('data', function (chunk) {
            if (settled) return;
            if (over) {
                /* Discard: we have already decided to refuse this upload. */
                drained += chunk.length;
                if (drained > UPLOAD_DRAIN_CEILING) {
                    finish(reject, new ApiError(413, 'FILE_TOO_LARGE:' +
                        'This file is larger than the ' + formatBytes(maxBytes) + ' per-file limit.'));
                }
                return;
            }
            size += chunk.length;
            if (size > maxBytes) {
                over = true;
                closeOut(function () {});
                return;
            }
            if (!out.write(chunk)) {
                req.pause();
                out.once('drain', function () { if (!settled) req.resume(); });
            }
        });

        req.on('end', function () {
            if (settled) return;
            if (over) {
                finish(reject, new ApiError(413, 'FILE_TOO_LARGE:' +
                    'This file is larger than the ' + formatBytes(maxBytes) + ' per-file limit.'));
                return;
            }
            finish(resolve, size);
        });

        req.on('aborted', function () {
            finish(reject, new ApiError(400, 'Upload cancelled.'));
        });
        req.on('error', function () {
            finish(reject, new ApiError(400, 'Upload interrupted.'));
        });
        out.on('error', function () {
            finish(reject, new ApiError(500, 'Could not write the file to disk.'));
        });
    });
}

async function handleInventoryUpload(req, res, user, url) {
    const name = cleanText(url.searchParams.get('name'), 200).trim() || 'Untitled file';
    const description = cleanText(url.searchParams.get('description'), 2000).trim();
    const mime = cleanText(url.searchParams.get('mime'), 150).trim();

    /* Content-Length lets us refuse an impossible upload before a single byte
       is written. It is a claim, not a guarantee — the stream enforces the
       same limits while the data arrives. */
    const declared = Number(req.headers['content-length']);
    if (!Number.isFinite(declared) || declared <= 0) {
        throw new ApiError(411, 'The upload did not report its size.');
    }
    if (declared > MAX_INVENTORY_FILE_BYTES) {
        throw new ApiError(413, 'FILE_TOO_LARGE:' + name + ' is ' + formatBytes(declared) +
            '. The largest single file is ' + formatBytes(MAX_INVENTORY_FILE_BYTES) + '.');
    }

    const used = inventoryUsedBytes(user.username);
    const remaining = INVENTORY_QUOTA_BYTES - used;
    if (declared > remaining) {
        throw new ApiError(413, 'QUOTA_EXCEEDED:' + name + ' needs ' + formatBytes(declared) +
            ' but only ' + formatBytes(Math.max(0, remaining)) + ' is left of your ' +
            formatBytes(INVENTORY_QUOTA_BYTES) + '. Delete something to make room.');
    }

    /* The stored name is server-generated so a crafted filename can never
       escape the inventory folder. */
    const id = 'f_' + Date.now() + '_' + crypto.randomBytes(6).toString('hex');
    const storedName = id + '.bin';
    const destPath = path.join(INVENTORY_DIR, storedName);

    let size;
    try {
        size = await streamUploadToFile(req, destPath, MAX_INVENTORY_FILE_BYTES);
    } catch (err) {
        /* streamUploadToFile already closes the handle and removes the
           partial file; this is a belt-and-braces sweep in case it could not. */
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (e) {}
        throw err;
    }

    /* Re-check the quota against the bytes that actually landed, in case the
       declared length was understated. */
    if (size > remaining) {
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (e) {}
        throw new ApiError(413, 'QUOTA_EXCEEDED:' + name + ' is ' + formatBytes(size) +
            ' but only ' + formatBytes(Math.max(0, remaining)) + ' was left.');
    }

    db.prepare(`INSERT INTO inventory_files
        (id, owner, name, description, mime, size, stored_name, created_at)
        VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, user.username, name, description, mime, size, storedName,
             new Date().toISOString());

    sendJson(res, 200, {
        ok: true,
        file: {
            id: id,
            name: name,
            description: description,
            mime: mime,
            size: size,
            url: '/api/inventory/file/' + id,
            time: new Date().toISOString()
        },
        usage: {
            usedBytes: inventoryUsedBytes(user.username),
            quotaBytes: INVENTORY_QUOTA_BYTES,
            maxFileBytes: MAX_INVENTORY_FILE_BYTES
        }
    });
}

function handleInventoryUsage(res, user) {
    sendJson(res, 200, {
        usedBytes: inventoryUsedBytes(user.username),
        quotaBytes: INVENTORY_QUOTA_BYTES,
        maxFileBytes: MAX_INVENTORY_FILE_BYTES,
        fileCount: db.prepare(
            `SELECT COUNT(*) AS n FROM inventory_files WHERE owner = ?`
        ).get(user.username).n
    });
}

/* Files are private to their owner; administrators can reach any of them. */
function inventoryFileFor(user, id) {
    const row = db.prepare(`SELECT * FROM inventory_files WHERE id = ?`).get(id);
    if (!row) throw new ApiError(404, 'That file is no longer in inventory.');
    const mine = String(row.owner).toLowerCase() === String(user.username).toLowerCase();
    if (!mine && user.role !== 'admin') {
        throw new ApiError(403, 'That file belongs to someone else.');
    }
    return row;
}

function handleInventoryDownload(req, res, user, id) {
    const row = inventoryFileFor(user, id);
    const filePath = path.join(INVENTORY_DIR, row.stored_name);
    if (!fs.existsSync(filePath)) throw new ApiError(404, 'The file is missing from disk.');

    const stat = fs.statSync(filePath);
    /* `attachment` forces a download; `inline` lets images open in the page's
       own viewer and print dialog. */
    const inline = /^image\//.test(row.mime || '') && !/download=1/.test(req.url);
    const safeName = String(row.name || 'file').replace(/[\r\n"\\]/g, '_');

    res.writeHead(200, {
        'Content-Type': row.mime || 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': (inline ? 'inline' : 'attachment') +
            '; filename="' + safeName + '"',
        'Cache-Control': 'private, no-store'
    });

    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', function () { try { res.end(); } catch (e) {} });
}

function handleInventoryDelete(res, user, id) {
    if (!id) throw new ApiError(400, 'Choose a file to delete.');
    const row = inventoryFileFor(user, id);
    db.prepare(`DELETE FROM inventory_files WHERE id = ?`).run(id);
    try {
        const p = path.join(INVENTORY_DIR, row.stored_name);
        if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) { /* The record is gone either way; the disk will be cleaned up. */ }

    sendJson(res, 200, {
        ok: true,
        usage: {
            usedBytes: inventoryUsedBytes(user.username),
            quotaBytes: INVENTORY_QUOTA_BYTES,
            maxFileBytes: MAX_INVENTORY_FILE_BYTES
        }
    });
}

/* ------------------------------------------------------------------
   Router
   ------------------------------------------------------------------ */
async function handleApi(req, res, pathname, url) {
    try {
        const method = req.method;

        /* --- Public endpoints ------------------------------------------ */
        if (method === 'POST' && pathname === '/api/auth/login') {
            return handleLogin(req, res, await readBody(req));
        }
        if (method === 'POST' && pathname === '/api/access-requests') {
            return handleAccessRequest(res, await readBody(req));
        }
        /* Website booking endpoint — no session needed; the public site will
           call this when the online appointment integration lands. A signed-in
           staff member booking from the dashboard is stamped as staff. */
        if (method === 'POST' && pathname === '/api/appointments') {
            return handlePublicAppointment(req, res, await readBody(req));
        }

        /* --- Everything below requires a valid session ------------------ */
        const token = bearerToken(req);
        res._token = token;
        const user = userForToken(token);
        if (!user) throw new ApiError(401, 'Please sign in again.');

        if (method === 'POST' && pathname === '/api/auth/logout') {
            db.prepare(`DELETE FROM sessions WHERE token=?`).run(token);
            return sendJson(res, 200, { ok: true });
        }
        if (method === 'GET' && pathname === '/api/auth/me') {
            return sendJson(res, 200, { user: { username: user.username, name: user.name, role: user.role } });
        }
        if (method === 'POST' && pathname === '/api/auth/password') {
            return handleChangePassword(res, user, await readBody(req), token);
        }
        if (method === 'GET' && pathname === '/api/state') {
            return handleState(res, user);
        }
        if (method === 'GET' && pathname === '/api/version') {
            return sendJson(res, 200, { version: getVersion() });
        }
        if (method === 'GET' && pathname === '/api/export') {
            if (user.role !== 'admin') throw new ApiError(403, 'Only administrators can export data.');
            return handleExport(res, user);
        }
        if (method === 'POST' && pathname === '/api/admin/reset') {
            if (user.role !== 'admin') throw new ApiError(403, 'Only administrators can reset data.');
            return handleReset(res, user);
        }
        if (method === 'POST' && pathname === '/api/attendance/checkin') {
            return handleAttendanceCheckin(res, user, await readBody(req));
        }
        if (method === 'POST' && pathname === '/api/attendance/checkout') {
            return handleAttendanceCheckout(res, user);
        }
        if (method === 'POST' && pathname === '/api/messages') {
            return handleSendMessage(res, user, await readBody(req));
        }
        if (method === 'POST' && pathname === '/api/messages/delete') {
            return handleDeleteMessage(res, user, await readBody(req));
        }
        if (method === 'POST' && pathname === '/api/auth/force-password') {
            return handleForcePassword(res, user, await readBody(req));
        }
        if (method === 'POST' && pathname === '/api/admin/staff') {
            return handleCreateStaff(res, user, await readBody(req));
        }
        if (method === 'POST' && pathname === '/api/admin/staff/reset') {
            return handleResetPassword(res, user, await readBody(req));
        }
        if (method === 'POST' && pathname === '/api/admin/staff/suspend') {
            return handleSuspend(res, user, await readBody(req));
        }
        if (method === 'POST' && pathname === '/api/admin/staff/deactivate') {
            return handleDeactivateStaff(res, user, await readBody(req));
        }
        if (method === 'POST' && pathname === '/api/admin/staff/hwid') {
            return handleSetHwid(res, user, await readBody(req));
        }
        if (method === 'POST' && pathname === '/api/admin/staff/remove') {
            return handleRemoveStaff(res, user, await readBody(req));
        }
        if (method === 'POST' && pathname === '/api/admin/staff/restore') {
            return handleRestoreStaff(res, user, await readBody(req));
        }
        if (method === 'POST' && pathname === '/api/appointments/decision') {
            return handleAppointmentDecision(res, user, await readBody(req));
        }
        if (method === 'POST' && pathname === '/api/profile') {
            return handleProfileUpdate(res, user, await readBody(req));
        }

        /* --- Inventory files (streamed, outside the JSON body limit) ----- */
        if (method === 'POST' && pathname === '/api/inventory/upload') {
            return await handleInventoryUpload(req, res, user, url);
        }
        if (method === 'GET' && pathname === '/api/inventory/usage') {
            return handleInventoryUsage(res, user);
        }
        if (method === 'POST' && pathname === '/api/inventory/delete') {
            const delBody = (await readBody(req)) || {};
            return handleInventoryDelete(res, user,
                cleanText(delBody.id, 80).trim());
        }
        const inventoryFileMatch = /^\/api\/inventory\/file\/(.+)$/.exec(pathname);
        if ((method === 'GET' || method === 'HEAD') && inventoryFileMatch) {
            return handleInventoryDownload(req, res, user,
                decodeURIComponent(inventoryFileMatch[1]));
        }

        const dataMatch = /^\/api\/data\/(.+)$/.exec(pathname);
        if (method === 'PUT' && dataMatch) {
            const key = decodeURIComponent(dataMatch[1]);
            return handlePutData(req, res, user, key, await readBody(req));
        }

        throw new ApiError(404, 'Unknown API endpoint.');
    } catch (err) {
        if (err instanceof ApiError) return sendJson(res, err.status, { error: err.message });
        console.error('[api] unexpected error:', err);
        /* Surface the real reason. A bare "Internal server error" hides
           coding mistakes such as a SQL bind-count mismatch behind a message
           the user cannot act on or report. */
        return sendJson(res, 500, {
            error: 'Internal server error.',
            detail: String((err && err.message) || err)
        });
    }
}

/* ==================================================================
   Static files — the laptop gets the whole frontend from here
   ================================================================== */
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.db': 'application/octet-stream'
};

/* Never serve the database or the server source to browsers. */
const BLOCKED = [/^\/data\//i, /^\/server\.js$/i];

function serveStatic(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';

    for (const rule of BLOCKED) {
        if (rule.test(pathname)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Not found');
        }
    }

    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(ROOT, safePath);
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Forbidden');
    }

    fs.stat(filePath, function (err, stat) {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Not found');
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Content-Length': stat.size,
            'Cache-Control': 'no-cache'
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

/* ==================================================================
   Server
   ================================================================== */
const server = http.createServer(function (req, res) {
    let url;
    let pathname;
    try {
        url = new URL(req.url, 'http://localhost');
        pathname = decodeURIComponent(url.pathname);
    } catch (e) {
        res.writeHead(400); return res.end('Bad request');
    }

    if (pathname.startsWith('/api/')) {
        handleApi(req, res, pathname, url);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(req, res, pathname);
    } else {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method not allowed');
    }
});

server.listen(PORT, HOST, function () {
    /* First boot: create the default administrator (admin / admin123). */
    const userCount = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
    if (userCount === 0) {
        const hp = hashPassword('admin123');
        db.prepare(`INSERT INTO users(username,name,role,pw_hash,pw_salt,active,created_at)
                    VALUES (?,?,?,?,?,1,?)`)
            .run('admin', 'Site Administrator', 'admin', hp.hash, hp.salt,
                 new Date().toISOString());
        console.log('  First run: created administrator account ->  username: admin   password: admin123');
        console.log('  Change this password from the Staff screen after signing in!');
    }

    console.log('');
    console.log('  MediTrack Hospital ERP server is running.');
    console.log('  ------------------------------------------------');
    console.log('  On this PC:            http://localhost:' + PORT);
    const nets = os.networkInterfaces();
    Object.keys(nets).forEach(function (name) {
        nets[name].forEach(function (net) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log('  From other computers:  http://' + net.address + ':' + PORT +
                    '   (' + name + ')');
            }
        });
    });
    console.log('  Database:              ' + DB_PATH);
    console.log('  Stop the server:       Ctrl+C');
    console.log('  ------------------------------------------------');
    console.log('');
});
