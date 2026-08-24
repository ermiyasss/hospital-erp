/* ==========================================================================
   MediTrack Hospital ERP - Appearance & Sound

   Three jobs:

     1. Apply the saved appearance to <html> as data- attributes, which is
        what css/variables.css keys its dark theme and accent ramps off.
     2. Keep the shell and every page inside #content-frame in step, since
        each frame is a separate document with its own <html>.
     3. Produce the alert sound. It is synthesised with the Web Audio API
        rather than loaded from a file, so there is nothing to fetch and it
        works from file:// with no assets folder.

   Applied before first paint (this script is loaded in <head>) so dark mode
   never flashes white first.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var SETTINGS_KEY = 'clinic_settings';

    var DEFAULTS = {
        theme: 'light',          /* light | dark | system */
        accent: 'blue',          /* blue | crimson | teal | indigo | slate */
        density: 'comfortable',  /* comfortable | compact */
        reduceMotion: false,
        soundEnabled: true,
        soundVolume: 'medium'    /* low | medium | high */
    };

    var THEMES = [
        { value: 'light',  label: 'Light',            hint: 'Best in bright rooms and for printing.' },
        { value: 'dark',   label: 'Dark',             hint: 'Easier at night and on ward monitors.' },
        { value: 'system', label: 'Match my computer', hint: 'Follows the operating system setting.' }
    ];

    var ACCENTS = [
        { value: 'blue',    label: 'Blue',    swatch: '#1C5FA8' },
        { value: 'crimson', label: 'Crimson', swatch: '#A31B22' },
        { value: 'teal',    label: 'Teal',    swatch: '#0F6E6E' },
        { value: 'indigo',  label: 'Indigo',  swatch: '#4B3F9E' },
        { value: 'slate',   label: 'Slate',   swatch: '#3B4A5C' }
    ];

    var VOLUMES = { low: 0.06, medium: 0.14, high: 0.26 };

    /* ------------------------------------------------------------ storage */
    var memory = null;

    function rawGet(key) {
        try {
            var v = window.localStorage.getItem(key);
            if (v !== null) return v;
        } catch (e) {}
        return memory;
    }

    function rawSet(key, value) {
        memory = value;
        try { window.localStorage.setItem(key, value); } catch (e) {}
    }

    function readAll() {
        var out = {};
        Object.keys(DEFAULTS).forEach(function (k) { out[k] = DEFAULTS[k]; });
        try {
            var parsed = JSON.parse(rawGet(SETTINGS_KEY) || '{}');
            if (parsed && typeof parsed === 'object') {
                Object.keys(DEFAULTS).forEach(function (k) {
                    if (parsed[k] !== undefined && parsed[k] !== null) out[k] = parsed[k];
                });
            }
        } catch (e) {}
        return out;
    }

    /* Merges into whatever else is in clinic_settings; this module must not
       clobber facility details or alert routing. */
    function writeAppearance(partial) {
        var existing = {};
        try {
            var parsed = JSON.parse(rawGet(SETTINGS_KEY) || '{}');
            if (parsed && typeof parsed === 'object') existing = parsed;
        } catch (e) {}

        Object.keys(partial).forEach(function (k) { existing[k] = partial[k]; });
        rawSet(SETTINGS_KEY, JSON.stringify(existing));
        apply();
        broadcast();
    }

    /* --------------------------------------------------------------- apply */
    function systemPrefersDark() {
        try {
            return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        } catch (e) {
            return false;
        }
    }

    function resolvedTheme(pref) {
        var value = pref || readAll().theme;
        if (value === 'dark') return 'dark';
        if (value === 'system') return systemPrefersDark() ? 'dark' : 'light';
        return 'light';
    }

    function apply(settings) {
        var s = settings || readAll();
        var root = document.documentElement;

        root.setAttribute('data-theme', resolvedTheme(s.theme));
        root.setAttribute('data-accent', s.accent || 'blue');
        root.setAttribute('data-density', s.density === 'compact' ? 'compact' : 'comfortable');
        root.setAttribute('data-motion', s.reduceMotion ? 'reduced' : 'full');

        /* Legacy class hooks: some page stylesheets still key off these. */
        root.classList.toggle('density-compact', s.density === 'compact');
        root.classList.toggle('motion-reduced', !!s.reduceMotion);
    }

    /* Tell the other frames. The shell relays to its iframe; a page relays
       up to the shell, which then fans out. */
    function broadcast() {
        var payload = { action: 'appearance_changed', appearance: readAll() };

        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage(payload, '*');
            }
        } catch (e) {}

        var frame = document.getElementById('content-frame');
        if (frame && frame.contentWindow) {
            try { frame.contentWindow.postMessage(payload, '*'); } catch (e) {}
        }

        try {
            window.dispatchEvent(new CustomEvent('meditrack:appearance-updated', { detail: readAll() }));
        } catch (e) {}
    }

    /* ==================================================================
       Alert sound

       Synthesised, so there is no audio file to ship or fail to load.
       Browsers block audio until the user has interacted with the page, so
       the context is created lazily and the first gesture resumes it.
       ================================================================== */
    var ctx = null;
    var unlocked = false;

    function audioContext() {
        var Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        if (!ctx) {
            try { ctx = new Ctor(); } catch (e) { return null; }
        }
        if (ctx.state === 'suspended') {
            try { ctx.resume(); } catch (e) {}
        }
        return ctx;
    }

    function unlock() {
        if (unlocked) return;
        unlocked = true;
        audioContext();
    }

    ['pointerdown', 'keydown'].forEach(function (evt) {
        window.addEventListener(evt, unlock, { once: true, passive: true });
    });

    /* One short sine blip. Chained by the patterns below rather than using
       a sample, which keeps the whole thing offline and tiny. */
    function blip(ac, gain, freq, startAt, duration) {
        var osc = ac.createOscillator();
        var env = ac.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startAt);

        /* Short fade in and out: a hard start clicks. */
        env.gain.setValueAtTime(0, startAt);
        env.gain.linearRampToValueAtTime(gain, startAt + 0.012);
        env.gain.setValueAtTime(gain, startAt + duration - 0.05);
        env.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

        osc.connect(env);
        env.connect(ac.destination);
        osc.start(startAt);
        osc.stop(startAt + duration + 0.02);
    }

    /* Each tone is [frequency Hz, delay from start, length]. Rising and
       repeated for urgency; a single soft note for routine information. */
    var PATTERNS = {
        critical: [[880, 0, 0.16], [1174, 0.18, 0.16], [880, 0.36, 0.16], [1174, 0.54, 0.22]],
        high:     [[740, 0, 0.14], [988, 0.16, 0.20]],
        normal:   [[659, 0, 0.16]],
        low:      [[523, 0, 0.10]]
    };

    function play(kind) {
        var s = readAll();
        if (!s.soundEnabled) return;

        var ac = audioContext();
        if (!ac) return;

        var pattern = PATTERNS[kind] || PATTERNS.normal;
        var gain = VOLUMES[s.soundVolume] || VOLUMES.medium;
        var now = ac.currentTime + 0.02;

        pattern.forEach(function (tone) {
            blip(ac, gain, tone[0], now + tone[1], tone[2]);
        });
    }

    /* ==================================================================
       Cross-frame listener
       ================================================================== */
    window.addEventListener('message', function (event) {
        var data = event.data;
        if (!data) return;

        if (data.action === 'appearance_changed') {
            apply(data.appearance);

            /* The shell also passes it down to the page it is hosting. */
            var frame = document.getElementById('content-frame');
            if (frame && frame.contentWindow && event.source !== frame.contentWindow) {
                try { frame.contentWindow.postMessage(data, '*'); } catch (e) {}
            }
        } else if (data.action === 'play_alert_sound') {
            play(data.kind);
        }
    }, false);

    /* Another tab changed the settings. */
    window.addEventListener('storage', function (e) {
        if (!e.key || e.key === SETTINGS_KEY) apply();
    });

    /* Following the operating system means reacting when it changes. */
    try {
        if (window.matchMedia) {
            var mq = window.matchMedia('(prefers-color-scheme: dark)');
            var onChange = function () { if (readAll().theme === 'system') apply(); };
            if (mq.addEventListener) mq.addEventListener('change', onChange);
            else if (mq.addListener) mq.addListener(onChange);
        }
    } catch (e) {}

    /* ==================================================================
       Public
       ================================================================== */
    window.MediTheme = {
        DEFAULTS: DEFAULTS,
        THEMES: THEMES,
        ACCENTS: ACCENTS,

        read: readAll,
        apply: apply,
        set: writeAppearance,
        resolvedTheme: resolvedTheme,

        /* Convenience for the topbar toggle. */
        toggleTheme: function () {
            var next = resolvedTheme() === 'dark' ? 'light' : 'dark';
            writeAppearance({ theme: next });
            return next;
        },

        playAlert: play,
        unlockAudio: unlock
    };

    /* Run immediately: this script sits in <head> precisely so the theme is
       correct on the very first paint. */
    apply();
})(window, document);
