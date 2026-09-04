/* Static smoke check for the Inventory page: every element id the script
   reaches for must exist in the markup, every custom icon name must be in the
   icon set, and every CSS class the script toggles should be defined. */
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'pages', 'inventory.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'js', 'inventory.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'css', 'inventory.css'), 'utf8');
const iconsSrc = fs.readFileSync(path.join(__dirname, 'js', 'icons.js'), 'utf8');

let failures = 0;
function check(cond, label) {
    if (cond) console.log('PASS: ' + label);
    else { failures++; console.log('FAIL: ' + label); }
}

const htmlIds = new Set();
const idRe = /\bid="([^"]+)"/g;
let m;
while ((m = idRe.exec(html))) htmlIds.add(m[1]);

/* byId('x') and byId("x") calls in the script. */
const wanted = new Set();
const byIdRe = /byId\(\s*['"]([^'"]+)['"]\s*\)/g;
while ((m = byIdRe.exec(js))) wanted.add(m[1]);
/* Ids built by concatenation (upName0, upDesc0 …) — check the prefix form. */
const templateIds = ['upName', 'upDesc'];

const missing = [...wanted].filter((id) => !htmlIds.has(id));
check(missing.length === 0, 'every byId() target exists in inventory.html' +
    (missing.length ? ' — missing: ' + missing.join(', ') : ''));

/* The generated row ids are referenced by label for= as well. */
check(/id="upName' \+ i/.test(js) && /for="upName' \+ i/.test(js),
    'generated name fields have matching <label for>');
check(/id="upDesc' \+ i/.test(js) && /for="upDesc' \+ i/.test(js),
    'generated description fields have matching <label for>');
check(templateIds.every((t) => js.includes(t)), 'row field id prefixes present');

/* Icons referenced from the script must exist in the icon registry. */
const iconNames = new Set();
const iconRe = /data-icon="([a-z-]+)"/g;
while ((m = iconRe.exec(js))) iconNames.add(m[1]);
while ((m = iconRe.exec(html))) iconNames.add(m[1]);
/* Icon definitions live in the `P` map: `name: '<svg…',` at any indent. */
const availableIcons = new Set();
const defRe = /(?:^|[{,])\s*([a-zA-Z][a-zA-Z0-9-]*)\s*:\s*'/gm;
while ((m = defRe.exec(iconsSrc))) availableIcons.add(m[1]);
check(availableIcons.size > 50, 'icon registry parsed (' + availableIcons.size + ' icons)');
const missingIcons = [...iconNames].filter((n) => !availableIcons.has(n));
check(missingIcons.length === 0,
    'all icons exist in js/icons.js' + (missingIcons.length ? ' — missing: ' + missingIcons.join(', ') : ''));

/* Classes the script toggles should have a rule in the stylesheet. */
const toggled = ['is-hidden', 'is-high', 'is-full', 'is-done', 'is-error', 'is-removed', 'visible', 'is-dropping'];
const missingCss = toggled.filter((c) => {
    if (css.includes('.' + c)) return false;
    /* Some live in components.css rather than inventory.css. */
    const components = fs.readFileSync(path.join(__dirname, 'css', 'components.css'), 'utf8');
    return !components.includes('.' + c);
});
check(missingCss.length === 0, 'toggled classes are styled' +
    (missingCss.length ? ' — undefined: ' + missingCss.join(', ') : ''));

/* The old two-pencil markup must be gone. */
check(!/data-act="rename"/.test(js), 'the rename action is gone');
check(!/data-act="note"/.test(js), 'the separate note action is gone');
check(/data-act="edit"/.test(js), 'a single edit action remains');
check(!/invRenameModal/.test(html) && !/invNoteModal/.test(html),
    'the two old modals were removed from the markup');
check(/id="invEditModal"/.test(html), 'the combined edit modal is present');
check(/id="invUploadModal"/.test(html), 'the upload dialog is present');

/* One pencil per card: count the edit buttons in the card template. */
const editButtons = (js.match(/data-act="edit"/g) || []).length;
check(editButtons === 1, 'exactly one edit button per card (found ' + editButtons + ')');

/* Quota constants on both sides should agree. */
const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
check(/6 \* 1024 \* 1024 \* 1024/.test(js) && /6 \* 1024 \* 1024 \* 1024/.test(serverSrc),
    'client and server both default to a 6 GB allowance');
check(/1\.5 \* 1024 \* 1024 \* 1024/.test(js) && /1\.5 \* 1024 \* 1024 \* 1024/.test(serverSrc),
    'client and server both default to a 1.5 GB per-file cap');

/* Endpoints the client calls must be routed on the server. */
['/api/inventory/upload', '/api/inventory/usage', '/api/inventory/delete', '/api/inventory/file/']
    .forEach(function (p) {
        check(serverSrc.includes("'" + p) || serverSrc.includes('^\\/api\\/inventory\\/file\\/'),
            'server routes ' + p);
    });

console.log(failures ? '\n' + failures + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
