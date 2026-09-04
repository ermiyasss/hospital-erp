/* ==========================================================================
   MediTrack Hospital ERP - Clinical Decision Support (frontend only)

   Two responsibilities:

   1. Vitals interpretation - every recorded observation is compared against
      adult reference ranges and classified as normal / borderline / abnormal /
      critical, with a plain-language explanation for the clinician.

   2. Symptom analysis - a rule-based, fully offline "assistant" that reads the
      presenting complaint plus vitals and surfaces candidate differentials,
      red flags and suggested workup.

   IMPORTANT: this is decision *support* only. It is deterministic pattern
   matching, contains no diagnosis logic of clinical record, and every output is
   labelled as requiring clinician confirmation. Ranges follow common adult
   defaults and are not adjusted for paediatrics, pregnancy or comorbidity.
   ========================================================================== */
(function (window) {
    'use strict';

    /* ----------------------------------------------------------------------
       Reference ranges
       band order: critical-low < abnormal-low < borderline-low < normal <
                   borderline-high < abnormal-high < critical-high
       ---------------------------------------------------------------------- */
    var VITALS = {
        systolic: {
            label: 'Systolic BP', unit: 'mmHg', decimals: 0,
            normal: [90, 120],
            bands: [
                { max: 70,  level: 'critical', note: 'Severe hypotension — risk of shock and organ hypoperfusion.' },
                { max: 89,  level: 'abnormal', note: 'Hypotensive. Check perfusion, fluid status and recent medication.' },
                { max: 120, level: 'normal',   note: 'Within normal range.' },
                { max: 139, level: 'borderline', note: 'Elevated (pre-hypertensive range). Repeat after 5 minutes rest.' },
                { max: 159, level: 'abnormal', note: 'Stage 1 hypertension. Confirm with a second reading.' },
                { max: 179, level: 'abnormal', note: 'Stage 2 hypertension. Requires review this visit.' },
                { max: Infinity, level: 'critical', note: 'Hypertensive crisis — assess for end-organ damage immediately.' }
            ]
        },
        diastolic: {
            label: 'Diastolic BP', unit: 'mmHg', decimals: 0,
            normal: [60, 80],
            bands: [
                { max: 40,  level: 'critical', note: 'Critically low diastolic pressure.' },
                { max: 59,  level: 'abnormal', note: 'Below normal diastolic range.' },
                { max: 80,  level: 'normal',   note: 'Within normal range.' },
                { max: 89,  level: 'borderline', note: 'Mildly elevated diastolic pressure.' },
                { max: 109, level: 'abnormal', note: 'Diastolic hypertension. Clinical review required.' },
                { max: Infinity, level: 'critical', note: 'Severe diastolic hypertension — urgent review.' }
            ]
        },
        pulse: {
            label: 'Heart Rate', unit: 'bpm', decimals: 0,
            normal: [60, 100],
            bands: [
                { max: 39,  level: 'critical', note: 'Severe bradycardia — obtain ECG now.' },
                { max: 49,  level: 'abnormal', note: 'Bradycardia. Correlate with symptoms and medication.' },
                { max: 59,  level: 'borderline', note: 'Mild bradycardia. Normal in trained athletes.' },
                { max: 100, level: 'normal',   note: 'Within normal range.' },
                { max: 110, level: 'borderline', note: 'Mild tachycardia. May reflect pain, anxiety or fever.' },
                { max: 130, level: 'abnormal', note: 'Tachycardia. Look for sepsis, dehydration or arrhythmia.' },
                { max: Infinity, level: 'critical', note: 'Severe tachycardia — obtain ECG and reassess immediately.' }
            ]
        },
        temperature: {
            label: 'Temperature', unit: '°C', decimals: 1,
            normal: [36.1, 37.5],
            bands: [
                { max: 34.9, level: 'critical', note: 'Hypothermia — begin active warming.' },
                { max: 36.0, level: 'abnormal', note: 'Below normal body temperature.' },
                { max: 37.5, level: 'normal',   note: 'Within normal range.' },
                { max: 38.0, level: 'borderline', note: 'Low-grade pyrexia.' },
                { max: 39.4, level: 'abnormal', note: 'Febrile. Consider infection screen and cultures.' },
                { max: Infinity, level: 'critical', note: 'Hyperpyrexia — urgent cooling and sepsis workup.' }
            ]
        },
        spo2: {
            label: 'SpO₂', unit: '%', decimals: 0,
            normal: [95, 100],
            bands: [
                { max: 84,  level: 'critical', note: 'Severe hypoxaemia — start oxygen and escalate now.' },
                { max: 89,  level: 'abnormal', note: 'Significant hypoxaemia. Supplemental oxygen indicated.' },
                { max: 94,  level: 'borderline', note: 'Mild desaturation. Recheck with a good trace.' },
                { max: 100, level: 'normal',   note: 'Adequate oxygen saturation.' },
                { max: Infinity, level: 'abnormal', note: 'Implausible reading — verify probe placement.' }
            ]
        },
        respRate: {
            label: 'Respiratory Rate', unit: '/min', decimals: 0,
            normal: [12, 20],
            bands: [
                { max: 7,   level: 'critical', note: 'Severe bradypnoea — assess airway and consciousness.' },
                { max: 11,  level: 'abnormal', note: 'Below normal respiratory rate.' },
                { max: 20,  level: 'normal',   note: 'Within normal range.' },
                { max: 24,  level: 'borderline', note: 'Mild tachypnoea. Monitor closely.' },
                { max: 29,  level: 'abnormal', note: 'Tachypnoea — a sensitive early marker of deterioration.' },
                { max: Infinity, level: 'critical', note: 'Severe tachypnoea — urgent assessment required.' }
            ]
        },
        glucose: {
            label: 'Blood Glucose', unit: 'mg/dL', decimals: 0,
            normal: [70, 140],
            bands: [
                { max: 49,  level: 'critical', note: 'Severe hypoglycaemia — treat immediately.' },
                { max: 69,  level: 'abnormal', note: 'Hypoglycaemia. Give oral glucose if alert.' },
                { max: 140, level: 'normal',   note: 'Within normal range.' },
                { max: 199, level: 'borderline', note: 'Impaired glucose tolerance range.' },
                { max: 349, level: 'abnormal', note: 'Hyperglycaemia. Check ketones if diabetic.' },
                { max: Infinity, level: 'critical', note: 'Severe hyperglycaemia — exclude DKA/HHS urgently.' }
            ]
        },
        weight: { label: 'Weight', unit: 'kg', decimals: 1, normal: null, bands: [] },
        height: { label: 'Height', unit: 'cm', decimals: 1, normal: null, bands: [] }
    };

    /* Field aliases so pages can pass whatever key they already use. */
    var ALIASES = {
        bp_systolic: 'systolic', sys: 'systolic', bpSys: 'systolic',
        bp_diastolic: 'diastolic', dia: 'diastolic', bpDia: 'diastolic',
        heartRate: 'pulse', hr: 'pulse', bpm: 'pulse',
        temp: 'temperature', temperatureC: 'temperature',
        oxygen: 'spo2', o2: 'spo2', saturation: 'spo2', spO2: 'spo2',
        rr: 'respRate', respiratoryRate: 'respRate', resp: 'respRate',
        sugar: 'glucose', bloodGlucose: 'glucose', rbs: 'glucose'
    };

    var LEVEL_RANK = { normal: 0, borderline: 1, abnormal: 2, critical: 3 };
    var LEVEL_LABEL = {
        normal: 'Normal',
        borderline: 'Borderline',
        abnormal: 'Abnormal',
        critical: 'Critical'
    };

    function canonicalKey(key) {
        if (VITALS[key]) return key;
        return ALIASES[key] || null;
    }

    function toNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        var n = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? null : n;
    }

    /* ------------------------------------------------------------------
       evaluate('pulse', 128) -> classification for a single observation
       ------------------------------------------------------------------ */
    function evaluate(key, rawValue) {
        var canonical = canonicalKey(key);
        if (!canonical) return null;

        var def = VITALS[canonical];
        var value = toNumber(rawValue);
        if (value === null) return null;

        var band = null;
        for (var i = 0; i < def.bands.length; i++) {
            if (value <= def.bands[i].max) { band = def.bands[i]; break; }
        }
        if (!band) band = { level: 'normal', note: 'Recorded.' };

        var direction = 'in-range';
        if (def.normal) {
            if (value < def.normal[0]) direction = 'low';
            else if (value > def.normal[1]) direction = 'high';
        }

        return {
            key: canonical,
            label: def.label,
            unit: def.unit,
            value: value,
            display: def.decimals ? value.toFixed(def.decimals) : String(Math.round(value)),
            level: band.level,
            levelLabel: LEVEL_LABEL[band.level],
            direction: direction,
            note: band.note,
            range: def.normal ? def.normal[0] + '–' + def.normal[1] + ' ' + def.unit : null,
            isFlagged: band.level === 'abnormal' || band.level === 'critical'
        };
    }

    /* ------------------------------------------------------------------
       Blood pressure needs both components read together.
       ------------------------------------------------------------------ */
    function evaluateBloodPressure(systolic, diastolic) {
        var s = evaluate('systolic', systolic);
        var d = evaluate('diastolic', diastolic);
        if (!s && !d) return null;

        var worst = [s, d].filter(Boolean).sort(function (a, b) {
            return LEVEL_RANK[b.level] - LEVEL_RANK[a.level];
        })[0];

        var category = 'Not assessable';
        if (s && d) {
            if (s.value >= 180 || d.value >= 110) category = 'Hypertensive crisis';
            else if (s.value >= 160 || d.value >= 100) category = 'Stage 2 hypertension';
            else if (s.value >= 140 || d.value >= 90) category = 'Stage 1 hypertension';
            else if (s.value >= 121 || d.value >= 81) category = 'Elevated';
            else if (s.value < 90 || d.value < 60) category = 'Hypotension';
            else category = 'Normal';
        }

        return {
            key: 'bloodPressure',
            label: 'Blood Pressure',
            unit: 'mmHg',
            display: (s ? s.display : '—') + '/' + (d ? d.display : '—'),
            systolic: s,
            diastolic: d,
            category: category,
            level: worst.level,
            levelLabel: LEVEL_LABEL[worst.level],
            note: worst.note,
            range: '90–120 / 60–80 mmHg',
            isFlagged: worst.isFlagged
        };
    }

    /* ------------------------------------------------------------------
       Full vitals set -> per-field results + an overall triage suggestion.
       ------------------------------------------------------------------ */
    function assess(vitals) {
        vitals = vitals || {};
        var results = [];
        var bp = evaluateBloodPressure(
            vitals.systolic !== undefined ? vitals.systolic : vitals.bp_systolic,
            vitals.diastolic !== undefined ? vitals.diastolic : vitals.bp_diastolic
        );
        if (bp) results.push(bp);

        ['pulse', 'temperature', 'spo2', 'respRate', 'glucose'].forEach(function (k) {
            var raw = vitals[k];
            if (raw === undefined) {
                Object.keys(ALIASES).forEach(function (alias) {
                    if (ALIASES[alias] === k && vitals[alias] !== undefined) raw = vitals[alias];
                });
            }
            var r = evaluate(k, raw);
            if (r) results.push(r);
        });

        var counts = { normal: 0, borderline: 0, abnormal: 0, critical: 0 };
        results.forEach(function (r) { counts[r.level]++; });

        /* A patient can be critically unwell without any single value crossing
           a critical threshold — hypotension with tachycardia and hypoxia is
           the classic example. Three or more abnormal observations at once is
           therefore treated as critical overall. */
        var overall = 'normal';
        if (counts.critical || counts.abnormal >= 3) overall = 'critical';
        else if (counts.abnormal) overall = 'abnormal';
        else if (counts.borderline) overall = 'borderline';

        /* Triage suggestion mirrors how the queue labels urgency. */
        var suggestedUrgency = 'Routine';
        if (counts.critical) suggestedUrgency = 'Emergency';
        else if (counts.abnormal >= 2) suggestedUrgency = 'Emergency';
        else if (counts.abnormal === 1) suggestedUrgency = 'Urgent';
        else if (counts.borderline >= 2) suggestedUrgency = 'Urgent';

        var flagged = results.filter(function (r) { return r.isFlagged; });

        return {
            results: results,
            flagged: flagged,
            counts: counts,
            overall: overall,
            overallLabel: LEVEL_LABEL[overall],
            suggestedUrgency: suggestedUrgency,
            summary: buildSummary(flagged, overall),
            recordedCount: results.length
        };
    }

    function buildSummary(flagged, overall) {
        if (!flagged.length) {
            return overall === 'borderline'
                ? 'All observations recorded; some sit at the edge of the normal range.'
                : 'All recorded observations are within normal limits.';
        }
        var names = flagged.map(function (f) {
            return f.label + ' ' + f.display + (f.unit && f.key !== 'bloodPressure' ? ' ' + f.unit : '');
        });

        var lead;
        if (flagged.some(function (f) { return f.level === 'critical'; })) {
            lead = 'Critical observation detected: ';
        } else if (overall === 'critical') {
            /* Escalated by combination rather than by a single reading. */
            lead = 'Multiple observations outside reference range — treat as critical: ';
        } else {
            lead = 'Observations outside reference range: ';
        }
        return lead + names.join(', ') + '.';
    }

    /* ==================================================================
       Symptom analysis (offline rule engine)
       Each pattern lists trigger keywords, supporting vitals, candidate
       differentials, red flags and a suggested workup.
       ================================================================== */
    var PATTERNS = [
        {
            id: 'acs',
            name: 'Acute coronary syndrome',
            system: 'Cardiovascular',
            keywords: ['chest pain', 'chest tightness', 'crushing', 'chest pressure', 'left arm pain', 'jaw pain', 'diaphoresis', 'sweating'],
            weightedKeywords: { 'chest pain': 3, 'crushing': 3, 'left arm pain': 2, 'diaphoresis': 2 },
            vitalHints: [
                { key: 'systolic', when: 'low', points: 2 },
                { key: 'pulse', when: 'abnormal', points: 2 },
                { key: 'spo2', when: 'low', points: 2 }
            ],
            redFlags: ['Chest pain with hypotension or desaturation', 'Radiation to jaw or left arm', 'Pain at rest lasting over 20 minutes'],
            workup: ['12-lead ECG within 10 minutes', 'Troponin (serial)', 'Chest X-ray', 'Continuous cardiac monitoring'],
            urgency: 'Emergency'
        },
        {
            id: 'sepsis',
            name: 'Sepsis / systemic infection',
            system: 'Infection',
            keywords: ['fever', 'chills', 'rigors', 'confusion', 'weakness', 'body ache', 'infection', 'wound'],
            weightedKeywords: { fever: 2, rigors: 3, confusion: 3 },
            vitalHints: [
                { key: 'temperature', when: 'abnormal', points: 3 },
                { key: 'pulse', when: 'high', points: 2 },
                { key: 'respRate', when: 'high', points: 2 },
                { key: 'systolic', when: 'low', points: 3 }
            ],
            redFlags: ['Fever with hypotension', 'Respiratory rate above 24/min', 'New confusion'],
            workup: ['Blood cultures before antibiotics', 'CBC with differential', 'Lactate', 'Urinalysis', 'CRP'],
            urgency: 'Emergency'
        },
        {
            id: 'respiratory',
            name: 'Lower respiratory tract illness',
            system: 'Respiratory',
            keywords: ['cough', 'shortness of breath', 'breathless', 'wheeze', 'sputum', 'difficulty breathing', 'chest congestion'],
            weightedKeywords: { 'shortness of breath': 3, wheeze: 2, 'difficulty breathing': 3 },
            vitalHints: [
                { key: 'spo2', when: 'low', points: 3 },
                { key: 'respRate', when: 'high', points: 3 },
                { key: 'temperature', when: 'high', points: 1 }
            ],
            redFlags: ['SpO₂ below 92% on room air', 'Unable to complete a sentence', 'Silent chest'],
            workup: ['Chest X-ray', 'CBC', 'Sputum culture if productive', 'Peak flow if asthmatic'],
            urgency: 'Urgent'
        },
        {
            id: 'gastro',
            name: 'Gastroenteritis / dehydration',
            system: 'Gastrointestinal',
            keywords: ['vomiting', 'diarrhoea', 'diarrhea', 'nausea', 'abdominal cramp', 'stomach pain', 'dehydration', 'loose stool'],
            weightedKeywords: { vomiting: 2, diarrhoea: 2, diarrhea: 2 },
            vitalHints: [
                { key: 'pulse', when: 'high', points: 2 },
                { key: 'systolic', when: 'low', points: 2 }
            ],
            redFlags: ['Blood in stool or vomit', 'Signs of severe dehydration', 'Persistent vomiting over 24 hours'],
            workup: ['Stool examination', 'Serum electrolytes', 'Renal function', 'Consider oral rehydration'],
            urgency: 'Urgent'
        },
        {
            id: 'stroke',
            name: 'Cerebrovascular event',
            system: 'Neurological',
            keywords: ['weakness one side', 'slurred speech', 'facial droop', 'numbness', 'vision loss', 'sudden headache', 'worst headache'],
            weightedKeywords: { 'facial droop': 4, 'slurred speech': 4, 'weakness one side': 4, 'worst headache': 3 },
            vitalHints: [
                { key: 'systolic', when: 'high', points: 2 },
                { key: 'glucose', when: 'abnormal', points: 2 }
            ],
            redFlags: ['Sudden focal neurological deficit', 'Time of onset under 4.5 hours', 'Thunderclap headache'],
            workup: ['Non-contrast head CT immediately', 'Capillary glucose', 'ECG', 'Coagulation profile'],
            urgency: 'Emergency'
        },
        {
            id: 'hypertensive',
            name: 'Hypertensive urgency',
            system: 'Cardiovascular',
            keywords: ['headache', 'blurred vision', 'dizziness', 'nosebleed', 'high blood pressure'],
            weightedKeywords: { 'blurred vision': 2, headache: 1 },
            vitalHints: [
                { key: 'systolic', when: 'high', points: 4 },
                { key: 'diastolic', when: 'high', points: 3 }
            ],
            redFlags: ['BP over 180/110 with symptoms', 'Visual disturbance', 'Chest pain or breathlessness'],
            workup: ['Repeat BP in both arms', 'Renal function and electrolytes', 'Urinalysis for protein', 'Fundoscopy'],
            urgency: 'Urgent'
        },
        {
            id: 'diabetes',
            name: 'Glycaemic disturbance',
            system: 'Endocrine',
            keywords: ['excessive thirst', 'frequent urination', 'polyuria', 'blurred vision', 'weight loss', 'diabetic', 'shaky', 'sweaty'],
            weightedKeywords: { polyuria: 2, 'excessive thirst': 2, diabetic: 2 },
            vitalHints: [
                { key: 'glucose', when: 'abnormal', points: 4 },
                { key: 'respRate', when: 'high', points: 1 }
            ],
            redFlags: ['Glucose above 350 mg/dL with ketones', 'Glucose below 50 mg/dL', 'Kussmaul breathing'],
            workup: ['Capillary and venous glucose', 'HbA1c', 'Urine or serum ketones', 'Venous blood gas'],
            urgency: 'Urgent'
        },
        {
            id: 'musculoskeletal',
            name: 'Musculoskeletal injury or strain',
            system: 'Musculoskeletal',
            keywords: ['back pain', 'joint pain', 'sprain', 'swelling', 'fall', 'injury', 'fracture', 'trauma', 'knee pain'],
            weightedKeywords: { fracture: 3, trauma: 2, fall: 2 },
            vitalHints: [],
            redFlags: ['Loss of distal pulse or sensation', 'Deformity or open wound', 'Saddle anaesthesia with back pain'],
            workup: ['Targeted X-ray', 'Neurovascular examination', 'Analgesia and immobilisation'],
            urgency: 'Routine'
        },
        {
            id: 'uti',
            name: 'Urinary tract infection',
            system: 'Genitourinary',
            keywords: ['burning urination', 'dysuria', 'frequent urination', 'flank pain', 'cloudy urine', 'urine smell'],
            weightedKeywords: { dysuria: 3, 'burning urination': 3, 'flank pain': 2 },
            vitalHints: [{ key: 'temperature', when: 'high', points: 2 }],
            redFlags: ['Flank pain with fever (possible pyelonephritis)', 'Vomiting with inability to tolerate oral intake'],
            workup: ['Urinalysis and culture', 'CBC if febrile', 'Renal ultrasound if recurrent'],
            urgency: 'Routine'
        },
        {
            id: 'anaemia',
            name: 'Anaemia / fatigue syndrome',
            system: 'Haematology',
            keywords: ['tired', 'fatigue', 'pale', 'dizzy', 'palpitations', 'shortness of breath on exertion', 'heavy periods'],
            weightedKeywords: { pale: 2, fatigue: 1, palpitations: 2 },
            vitalHints: [{ key: 'pulse', when: 'high', points: 2 }],
            redFlags: ['Resting tachycardia with pallor', 'Melaena or heavy bleeding', 'Chest pain on exertion'],
            workup: ['CBC with peripheral smear', 'Ferritin and iron studies', 'Faecal occult blood'],
            urgency: 'Routine'
        }
    ];

    /* Negation guard: "no chest pain" must not score the ACS pattern. */
    var NEGATIONS = ['no ', 'not ', 'without ', 'denies ', 'denied ', 'never '];

    function isNegated(text, index) {
        var window40 = text.slice(Math.max(0, index - 22), index);
        for (var i = 0; i < NEGATIONS.length; i++) {
            if (window40.indexOf(NEGATIONS[i]) !== -1) return true;
        }
        return false;
    }

    function matchesHint(assessment, hint) {
        for (var i = 0; i < assessment.results.length; i++) {
            var r = assessment.results[i];
            var pool = r.key === 'bloodPressure' ? [r.systolic, r.diastolic].filter(Boolean) : [r];
            for (var j = 0; j < pool.length; j++) {
                var v = pool[j];
                if (v.key !== hint.key) continue;
                if (hint.when === 'abnormal') return v.isFlagged;
                if (hint.when === 'low') return v.direction === 'low' && v.level !== 'normal';
                if (hint.when === 'high') return v.direction === 'high' && v.level !== 'normal';
            }
        }
        return false;
    }

    /* ------------------------------------------------------------------
       analyzeSymptoms('crushing chest pain radiating to left arm', vitals)
       ------------------------------------------------------------------ */
    function analyzeSymptoms(narrative, vitals) {
        var text = String(narrative || '').toLowerCase();
        var assessment = assess(vitals || {});

        var matches = [];

        PATTERNS.forEach(function (pat) {
            var score = 0;
            var hits = [];

            pat.keywords.forEach(function (kw) {
                var idx = text.indexOf(kw);
                if (idx === -1 || isNegated(text, idx)) return;
                score += (pat.weightedKeywords && pat.weightedKeywords[kw]) || 1;
                hits.push(kw);
            });

            var vitalSupport = [];
            (pat.vitalHints || []).forEach(function (hint) {
                if (!matchesHint(assessment, hint)) return;
                score += hint.points;
                var def = VITALS[hint.key];
                vitalSupport.push((def ? def.label : hint.key) + ' ' + hint.when);
            });

            /* Require narrative evidence: vitals alone are too non-specific. */
            if (!hits.length || score < 2) return;

            matches.push({
                id: pat.id,
                name: pat.name,
                system: pat.system,
                score: score,
                matchedTerms: hits,
                vitalSupport: vitalSupport,
                redFlags: pat.redFlags,
                workup: pat.workup,
                urgency: pat.urgency
            });
        });

        matches.sort(function (a, b) { return b.score - a.score; });

        var top = matches.slice(0, 4);
        var maxScore = top.length ? top[0].score : 0;

        top.forEach(function (m) {
            /* Confidence is a relative display value, never a probability. */
            var ratio = maxScore ? m.score / maxScore : 0;
            m.confidence = ratio >= 0.85 ? 'High' : (ratio >= 0.5 ? 'Moderate' : 'Low');
            m.confidencePct = Math.min(95, Math.round(38 + ratio * 52));
        });

        var urgencyRank = { Routine: 0, Urgent: 1, Emergency: 2 };
        var suggested = assessment.suggestedUrgency;
        top.forEach(function (m) {
            if (urgencyRank[m.urgency] > urgencyRank[suggested]) suggested = m.urgency;
        });

        var redFlags = [];
        top.forEach(function (m) {
            m.redFlags.forEach(function (f) { if (redFlags.indexOf(f) === -1) redFlags.push(f); });
        });

        var workup = [];
        top.slice(0, 2).forEach(function (m) {
            m.workup.forEach(function (w) { if (workup.indexOf(w) === -1) workup.push(w); });
        });

        return {
            hasInput: text.trim().length > 0,
            narrative: narrative || '',
            vitals: assessment,
            differentials: top,
            redFlags: redFlags.slice(0, 5),
            suggestedWorkup: workup.slice(0, 6),
            suggestedUrgency: suggested,
            disclaimer: 'Rule-based decision support generated locally. Not a diagnosis — clinician judgement required.'
        };
    }

    /* ------------------------------------------------------------------
       Public surface
       ------------------------------------------------------------------ */
    window.MediClinical = {
        VITALS: VITALS,
        LEVEL_LABEL: LEVEL_LABEL,
        evaluate: evaluate,
        evaluateBloodPressure: evaluateBloodPressure,
        assess: assess,
        analyzeSymptoms: analyzeSymptoms,

        /* Raises the appropriate notification for an assessed vitals set.
           Deliberately routed through the event catalogue so gating applies. */
        notifyVitals: function (patientName, assessment, dedupeKey) {
            if (!window.MediTrackNotify || !assessment || !assessment.flagged.length) return;
            var critical = assessment.flagged.filter(function (f) { return f.level === 'critical'; });
            var name = patientName || 'Patient';

            if (critical.length) {
                window.MediTrackNotify.event('vitals.critical', {
                    key: dedupeKey ? 'vitals.critical:' + dedupeKey : null,
                    title: 'Critical Vitals — ' + name,
                    message: critical.map(function (f) {
                        return f.label + ' ' + f.display + (f.key === 'bloodPressure' ? '' : ' ' + f.unit);
                    }).join(', ') + '. Immediate review required.'
                });
            } else {
                window.MediTrackNotify.event('vitals.abnormal', {
                    key: dedupeKey ? 'vitals.abnormal:' + dedupeKey : null,
                    title: 'Abnormal Vitals — ' + name,
                    message: assessment.summary
                });
            }
        }
    };
})(window);
