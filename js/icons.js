/**
 * MediTrack Hospital ERP - Local Icon System (offline, no CDN, no emoji)
 * ---------------------------------------------------------------------
 * All icons are stroke-based 24x24 line icons stored locally in this file so the
 * application renders identically when hosted offline (file:// or LAN server).
 *
 * Usage:
 *   HTML : <span class="ico" data-icon="patients"></span>
 *          <span class="ico ico-sm" data-icon="lab"></span>
 *   JS   : el.innerHTML = MediIcons.svg('lab', 16);
 *
 * Hydration runs automatically on DOMContentLoaded and can be re-run after any
 * dynamic render via MediIcons.hydrate(container).
 */
(function (window, document) {
    'use strict';

    /* Raw inner markup for each icon (viewBox 0 0 24 24, stroke = currentColor). */
    var P = {
        /* --- Navigation / shell ------------------------------------------ */
        dashboard: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
        patients: '<path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19"/><circle cx="10" cy="8" r="3.5"/><path d="M17 11h4M19 9v4"/>',
        queue: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        tracking: '<path d="M3 12h3.5l2-5 3.5 10 2.5-6 1.5 3H21"/>',
        storage: '<path d="M3 8.5h18M4.5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V8.5"/><path d="M4 5h16l-1 3.5H5L4 5Z"/><path d="M10 13h4"/>',
        lab: '<path d="M9 3h6"/><path d="M10 3v5.2L5.7 15.6A2 2 0 0 0 7.4 18.6h9.2a2 2 0 0 0 1.7-3L14 8.2V3"/><path d="M7.5 13.5h9"/>',
        pharmacy: '<rect x="3" y="8.5" width="18" height="12" rx="3"/><path d="M12 11.5v6M9 14.5h6"/><path d="M8 8.5V6a4 4 0 0 1 8 0v2.5"/>',
        nurse: '<path d="M12 20.5s-7-4.3-7-9.4A4.1 4.1 0 0 1 12 8.4a4.1 4.1 0 0 1 7 2.7c0 5.1-7 9.4-7 9.4Z"/><path d="M12 11.5v3M10.5 13h3"/>',
        staff: '<circle cx="9" cy="8" r="3.2"/><path d="M15 19v-1.4a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 17.6V19"/><circle cx="17.5" cy="9.5" r="2.4"/><path d="M21 18.5v-.9a2.9 2.9 0 0 0-2.9-2.9h-.8"/>',
        settings: '<circle cx="12" cy="12" r="2.8"/><path d="M12 4v2.2M12 17.8V20M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M4 12h2.2M17.8 12H20M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
        logout: '<path d="M9.5 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.5"/><path d="M15.5 8l4 4-4 4"/><path d="M19 12H9"/>',
        menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
        /* Vertical "more actions" dots — filled so they read at 14-16px. */
        more: '<circle cx="12" cy="5.2" r="1.45" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.45" fill="currentColor" stroke="none"/><circle cx="12" cy="18.8" r="1.45" fill="currentColor" stroke="none"/>',
        minus: '<path d="M6 12h12"/>',
        hospital: '<path d="M4 20.5V8.2a1.5 1.5 0 0 1 .8-1.3l6.4-3.6a1.5 1.5 0 0 1 1.6 0l6.4 3.6a1.5 1.5 0 0 1 .8 1.3V20.5"/><path d="M2.5 20.5h19"/><path d="M12 8.5v5M9.5 11h5"/><path d="M9.5 20.5v-3.2h5v3.2"/>',

        /* --- Actions ----------------------------------------------------- */
        search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
        filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
        reset: '<path d="M4 12a8 8 0 0 1 13.6-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.6 5.7L4 15.5"/><path d="M4 20v-4.5h4.5"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        edit: '<path d="M12 20h8"/><path d="M16.4 4.6a2 2 0 0 1 2.8 2.8L8.4 18.2 4 19.5l1.3-4.4L16.4 4.6Z"/>',
        save: '<path d="M19 20.5H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h10L20.5 9v10a1.5 1.5 0 0 1-1.5 1.5Z"/><path d="M7.5 3.5v5h7"/><path d="M7.5 20.5v-6h9v6"/>',
        send: '<path d="M20.5 3.5 10 14"/><path d="M20.5 3.5 14.5 20.5 10 14 3.5 9.5 20.5 3.5Z"/>',
        paperclip: '<path d="M21 11.5 12.5 20a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a2 2 0 0 1-2.83-2.83l7.78-7.78"/>',
        upload: '<path d="M12 19V8"/><path d="M8 12l4-4 4 4"/><path d="M5 20h14"/>',
        image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="8.5" cy="9" r="1.6"/><path d="M4 17l4.5-4.5 4 4 3-3 4.5 4.5"/>',
        key: '<circle cx="8" cy="8" r="4.5"/><path d="M11.2 11.2 20 20"/><path d="M16.5 16.5 19 14M18 18.5 20.5 16"/>',
        print: '<path d="M7 8.5V3.5h10v5"/><path d="M7 17.5H5.5A1.5 1.5 0 0 1 4 16v-4.5A1.5 1.5 0 0 1 5.5 10h13a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 1-1.5 1.5H17"/><rect x="7" y="14.5" width="10" height="6" rx="1"/>',
        trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.8 12.1a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/><path d="M10.5 11v6M13.5 11v6"/>',
        eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
        'eye-off': '<path d="M9.9 5.8A8.7 8.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.4 3.3"/><path d="M6.4 7.5A17.6 17.6 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 3.7-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3.5 3.5 20.5 20.5"/>',
        download: '<path d="M12 4v10.5"/><path d="M8 11l4 4 4-4"/><path d="M4.5 19.5h15"/>',
        close: '<path d="M6 6l12 12M18 6 6 18"/>',
        check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
        play: '<path d="M7.5 4.8 18.5 12 7.5 19.2V4.8Z"/>',

        /* --- Chevrons / arrows ------------------------------------------- */
        'chevron-down': '<path d="M6.5 9.5 12 15l5.5-5.5"/>',
        'chevron-up': '<path d="M6.5 14.5 12 9l5.5 5.5"/>',
        'chevron-right': '<path d="M9.5 6.5 15 12l-5.5 5.5"/>',
        'chevron-left': '<path d="M14.5 6.5 9 12l5.5 5.5"/>',
        'arrow-right': '<path d="M4.5 12h15"/><path d="M14 6.5 19.5 12 14 17.5"/>',
        'arrow-left': '<path d="M19.5 12h-15"/><path d="M10 6.5 4.5 12 10 17.5"/>',

        /* --- Status / feedback ------------------------------------------- */
        info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.8h.01"/>',
        'check-circle': '<path d="M20.5 11.2V12a8.5 8.5 0 1 1-5-7.8"/><path d="M8.8 11.5l3 3 8-8"/>',
        warning: '<path d="M11 4.4 2.9 18a1.2 1.2 0 0 0 1 1.8h16.2a1.2 1.2 0 0 0 1-1.8L13 4.4a1.2 1.2 0 0 0-2 0Z"/><path d="M12 9.5v4M12 16.6h.01"/>',
        critical: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5M12 16.2h.01"/>',
        bell: '<path d="M18 9.2a6 6 0 0 0-12 0c0 5.3-2.2 6.9-2.2 6.9h16.4S18 14.5 18 9.2"/><path d="M13.7 19.6a2 2 0 0 1-3.4 0"/>',
        'bell-off': '<path d="M18 9.2a6 6 0 0 0-9.3-5"/><path d="M6.1 6.6A6 6 0 0 0 6 9.2c0 5.3-2.2 6.9-2.2 6.9h12.6"/><path d="M13.7 19.6a2 2 0 0 1-3.4 0"/><path d="M3.5 3.5 20.5 20.5"/>',
        hourglass: '<path d="M7 3.5h10"/><path d="M7 20.5h10"/><path d="M8 3.5v3.2c0 1 .4 2 1.2 2.6L12 11.6l-2.8 2.3c-.8.7-1.2 1.6-1.2 2.6v2"/><path d="M16 3.5v3.2c0 1-.4 2-1.2 2.6L12 11.6l2.8 2.3c.8.7 1.2 1.6 1.2 2.6v2"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>',
        calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17"/><path d="M8 3.5V6.5M16 3.5V6.5"/>',
        'shield-check': '<path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.5 7 9 4.1-1.5 7-4.7 7-9V6l-7-2.5Z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
        lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',

        /* --- Clinical ---------------------------------------------------- */
        stethoscope: '<path d="M5.5 3.5v5a3.5 3.5 0 0 0 7 0v-5"/><path d="M9 12v2.5a4.5 4.5 0 0 0 9 0v-2"/><circle cx="18" cy="8" r="2.2"/><path d="M4 3.5h3M11 3.5h3"/>',
        heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.4 4.4 0 0 1 12 7.3 4.4 4.4 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z"/>',
        pulse: '<path d="M3 12.5h3.5L8.5 8l3 9 2.5-5 1.5 2.5H21"/>',
        'blood-pressure': '<circle cx="12" cy="12" r="8.5"/><path d="M12 12 15.5 8.5"/><path d="M12 3.5V5M20.5 12H19M12 20.5V19M3.5 12H5"/>',
        thermometer: '<path d="M13.5 14.6V5.2a2 2 0 1 0-4 0v9.4a4 4 0 1 0 4 0Z"/><path d="M11.5 16.8h.01"/>',
        droplet: '<path d="M12 3.5 7.4 9a6 6 0 1 0 9.2 0L12 3.5Z"/>',
        lungs: '<path d="M12 3.5v9"/><path d="M12 12.5c-1.6 0-2.6-1.1-2.6-2.6V7.5C7 8.2 5 10.6 5 14.2v3.3a2 2 0 0 0 2.6 1.9l1.6-.5A2.6 2.6 0 0 0 11 16.4"/><path d="M12 12.5c1.6 0 2.6-1.1 2.6-2.6V7.5C17 8.2 19 10.6 19 14.2v3.3a2 2 0 0 1-2.6 1.9l-1.6-.5A2.6 2.6 0 0 1 13 16.4"/>',
        weight: '<rect x="4" y="6.5" width="16" height="14" rx="2.5"/><path d="M9.5 11.5 12 9.5l2.5 2"/><path d="M8 16.5h8"/>',
        ruler: '<rect x="2.8" y="8.5" width="18.4" height="7" rx="1.5" transform="rotate(-45 12 12)"/><path d="M9 9.5l1.3 1.3M11.5 12l1.3 1.3M14 14.5l1.3 1.3"/>',
        clipboard: '<rect x="5.5" y="4.5" width="13" height="16" rx="2"/><path d="M9 4.5V3.2h6v1.3"/><path d="M9 10h6M9 13.5h6M9 17h3.5"/>',
        'file-text': '<path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5l-5-5Z"/><path d="M13.5 3.5v5h5"/><path d="M8.5 13h7M8.5 16.5h7"/>',
        pill: '<rect x="2.8" y="8.5" width="18.4" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M8.7 8.7 15.3 15.3"/>',
        syringe: '<path d="M14 4.5 19.5 10"/><path d="M17 2.5 21.5 7"/><path d="M12.5 6 18 11.5l-7.5 7.5H5.5v-5L12.5 6Z"/><path d="M9.5 12l2.5 2.5"/>',
        ai: '<rect x="4.5" y="6.5" width="15" height="12" rx="3"/><path d="M9.5 11h.01M14.5 11h.01"/><path d="M9.5 14.8c1.6 1 3.4 1 5 0"/><path d="M12 3.5v3M4.5 12h-2M21.5 12h-2"/>',
        insight: '<path d="M9.5 20h5"/><path d="M10 17h4"/><path d="M12 3.5a5.5 5.5 0 0 0-3.2 10c.5.4.7.9.7 1.5h5c0-.6.2-1.1.7-1.5A5.5 5.5 0 0 0 12 3.5Z"/>',
        chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16.5v-4M12 16.5v-8M16 16.5v-5.5"/>',
        users: '<circle cx="9" cy="8" r="3.2"/><path d="M15 19v-1.4a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 17.6V19"/><path d="M16.5 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M18 14.4a3.6 3.6 0 0 1 3 3.2V19"/>',
        user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20v-1.2A4.8 4.8 0 0 1 9.8 14h4.4A4.8 4.8 0 0 1 19 18.8V20"/>',
        'user-plus': '<circle cx="10" cy="8" r="3.6"/><path d="M3.5 20v-1.2A4.8 4.8 0 0 1 8.3 14h3.4"/><path d="M18 9v6M15 12h6"/>',
        'user-minus': '<circle cx="10" cy="8" r="3.6"/><path d="M3.5 20v-1.2A4.8 4.8 0 0 1 8.3 14h3.4"/><path d="M17.5 12h5"/>',
        'user-x': '<circle cx="10" cy="8" r="3.6"/><path d="M3.5 20v-1.2A4.8 4.8 0 0 1 8.3 14h3.4"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
        'user-check': '<circle cx="10" cy="8" r="3.6"/><path d="M3.5 20v-1.2A4.8 4.8 0 0 1 8.3 14h3.4a4.8 4.8 0 0 1 3.3 1.3"/><path d="M15.5 17.5 17.8 20l3.7-4.5"/>',
        phone: '<path d="M20.5 16.9v2.4a1.5 1.5 0 0 1-1.7 1.5 16.5 16.5 0 0 1-14.6-14.6A1.5 1.5 0 0 1 5.7 4.5H8a1.5 1.5 0 0 1 1.5 1.3c.1 1 .4 1.9.7 2.8a1.5 1.5 0 0 1-.4 1.6L8.6 11.4a12 12 0 0 0 4 4l1.2-1.2a1.5 1.5 0 0 1 1.6-.4c.9.3 1.8.6 2.8.7a1.5 1.5 0 0 1 1.3 1.5Z"/>',
        'bed': '<path d="M3.5 20v-9"/><path d="M3.5 15.5h17V20"/><path d="M20.5 15.5V13a2 2 0 0 0-2-2H9"/><circle cx="7" cy="9" r="2"/>',
        vial: '<path d="M15.5 3.5 20 8"/><path d="M18 5.8 9.4 14.4a4 4 0 1 0 5.6 5.6"/><path d="M12.2 11.6 15 8.8"/><path d="M8 18h4"/>',
        list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
        layers: '<path d="M12 3.5 3.5 8l8.5 4.5L20.5 8 12 3.5Z"/><path d="M3.5 12.5 12 17l8.5-4.5"/><path d="M3.5 16.8 12 21.3l8.5-4.5"/>',
        'more-vertical': '<path d="M12 6h.01M12 12h.01M12 18h.01"/>',

        /* --- Billing ----------------------------------------------------- */
        receipt: '<path d="M6 3.5h12a1 1 0 0 1 1 1v16l-2.3-1.6-2.4 1.6-2.3-1.6-2.4 1.6L7 19l-2 1.5v-16a1 1 0 0 1 1-1Z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
        cash: '<rect x="2.5" y="6.5" width="19" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v4M18 10v4"/>',
        card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/><path d="M6 14.5h4"/>',
        percent: '<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',

        /* --- Communication / scheduling ---------------------------------- */
        message: '<path d="M20.5 11.5a7.5 7.5 0 0 1-7.9 7.5 8.6 8.6 0 0 1-3.2-.6L4.5 20l1.3-3.9a7.2 7.2 0 0 1-1.3-4.1A7.5 7.5 0 0 1 12.6 4.5a7.5 7.5 0 0 1 7.9 7Z"/>',
        'message-read': '<path d="M20.5 11.5a7.5 7.5 0 0 1-7.9 7.5 8.6 8.6 0 0 1-3.2-.6L4.5 20l1.3-3.9a7.2 7.2 0 0 1-1.3-4.1A7.5 7.5 0 0 1 12.6 4.5a7.5 7.5 0 0 1 7.9 7Z"/><path d="M9.3 11.7l2.2 2.2 4.2-4.4"/>',
        'calendar-check': '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17"/><path d="M8 3.5V6.5M16 3.5V6.5"/><path d="M8.5 15l2.4 2.4 4.6-4.8"/>',
        megaphone: '<path d="M4.5 10v4a1.5 1.5 0 0 0 1.5 1.5h1.5L12 19.5V4.5L7.5 8.5H6A1.5 1.5 0 0 0 4.5 10Z"/><path d="M15.5 9a4.4 4.4 0 0 1 0 6"/><path d="M18 6.8a8 8 0 0 1 0 10.4"/>',
        'user-circle': '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="10" r="3"/><path d="M5.9 18.2a6.5 6.5 0 0 1 12.2 0"/>',

        /* --- Appearance -------------------------------------------------- */
        moon: '<path d="M20.5 14.8A8.5 8.5 0 0 1 9.2 3.5a8.5 8.5 0 1 0 11.3 11.3Z"/>',
        sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/>',
        contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor" stroke="none"/>',
        palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-.9 2-1.8 0-.9-.6-1.7-.6-2.4 0-.8.6-1.3 1.5-1.3h1.7a3.9 3.9 0 0 0 3.9-3.9c0-4.2-3.8-7.6-8.5-7.6Z"/><path d="M7.5 12h.01M9.8 8.6h.01M13.5 7.6h.01"/>',
        volume: '<path d="M4.5 9.5h3L12 5.5v13L7.5 14.5h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18 7a7 7 0 0 1 0 10"/>',
        'volume-off': '<path d="M4.5 9.5h3L12 5.5v13L7.5 14.5h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z"/><path d="M16 9.5l4.5 5M20.5 9.5 16 14.5"/>'
    };

    var ALIASES = {
        laboratory: 'lab',
        prescription: 'pill',
        results: 'vial',
        awaiting: 'hourglass',
        completed: 'check-circle',
        success: 'check-circle',
        error: 'critical',
        alert: 'warning',
        doctor: 'stethoscope',
        vitals: 'pulse',
        note: 'file-text',
        notes: 'file-text',
        time: 'clock',
        billing: 'receipt',
        invoice: 'receipt',
        payment: 'cash',
        money: 'cash',
        theme: 'contrast',
        sound: 'volume',
        reception: 'patients',
        admin: 'shield-check',
        chat: 'message',
        appointment: 'calendar-check',
        appointments: 'calendar-check',
        profile: 'user-circle',
        account: 'user-circle',
        archive: 'storage'
    };

    function resolve(name) {
        if (!name) return null;
        var key = String(name).trim();
        if (P[key]) return key;
        if (ALIASES[key] && P[ALIASES[key]]) return ALIASES[key];
        return null;
    }

    var MediIcons = {
        /** Returns SVG markup string for an icon name. */
        svg: function (name, size, extraClass) {
            var key = resolve(name);
            if (!key) key = 'info';
            var s = size ? Number(size) : 18;
            return '<svg class="mt-icon' + (extraClass ? ' ' + extraClass : '') + '" viewBox="0 0 24 24" width="' + s +
                '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
                'stroke-linejoin="round" aria-hidden="true" focusable="false">' + P[key] + '</svg>';
        },

        /** Returns true if the icon exists locally. */
        has: function (name) { return !!resolve(name); },

        /** Replaces the contents of every [data-icon] element inside root. */
        hydrate: function (root) {
            var scope = root || document;
            var nodes = scope.querySelectorAll('[data-icon]');
            for (var i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                if (el.getAttribute('data-icon-done') === '1') continue;
                var size = el.getAttribute('data-icon-size');
                el.innerHTML = MediIcons.svg(el.getAttribute('data-icon'), size || null);
                el.setAttribute('data-icon-done', '1');
                el.setAttribute('aria-hidden', 'true');
            }
        },

        /** Forces a re-render (used after innerHTML replacement). */
        refresh: function (root) {
            var scope = root || document;
            var nodes = scope.querySelectorAll('[data-icon]');
            for (var i = 0; i < nodes.length; i++) nodes[i].removeAttribute('data-icon-done');
            MediIcons.hydrate(scope);
        },

        names: function () { return Object.keys(P); }
    };

    window.MediIcons = MediIcons;
    window.icon = MediIcons.svg;

    function boot() { MediIcons.hydrate(document); }

    /* Hydrate as early as possible, then again on load. Stylesheets and other
       scripts can still be resolving when DOMContentLoaded fires, and a missed
       pass would leave visibly empty icon slots. */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
    window.addEventListener('load', boot);

    /* Auto-hydrate icons injected by dynamic renders. */
    function observe() {
        if (!window.MutationObserver || !document.body) return;
        var obs = new MutationObserver(function (mutations) {
            var needs = false;
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var n = added[j];
                    if (n.nodeType !== 1) continue;
                    if (n.hasAttribute && n.hasAttribute('data-icon')) { needs = true; break; }
                    if (n.querySelector && n.querySelector('[data-icon]:not([data-icon-done])')) { needs = true; break; }
                }
                if (needs) break;
            }
            if (needs) MediIcons.hydrate(document);
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observe);
    } else {
        observe();
    }
})(window, document);
