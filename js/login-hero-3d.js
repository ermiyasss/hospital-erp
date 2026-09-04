/**
 * MediTrack Hospital ERP - High-Visibility 3D Login Hero
 * --------------------------------------------------------
 * Vanilla WebGL low-poly faceted 3D medical emblem (< 12KB, 0 libraries).
 * Features:
 * - Two-tone geometry: Radiant medical white cross on vivid sapphire-cyan glass shield
 * - Floating 3D orbital ring for enhanced dimensional parallax
 * - Fresnel rim glow + dual specular lighting for maximum visibility in light & dark modes
 * - Ambient floating & cursor tilt tracking (clamped <= 10 deg)
 * - Automatic high-visibility static SVG fallback if WebGL is unavailable or prefers-reduced-motion is active
 * - Pauses rendering when document is hidden to conserve GPU/battery
 */
(function (window, document) {
    'use strict';

    var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var container = document.getElementById('loginHero3D');
    var canvas = document.getElementById('hero3DCanvas');
    var fallback = document.getElementById('hero3DFallback');

    if (!container || !canvas || prefersReduced) {
        if (fallback) fallback.style.display = 'flex';
        if (canvas) canvas.style.display = 'none';
        return;
    }

    var gl = null;
    try {
        gl = canvas.getContext('webgl', { alpha: true, antialias: true, depth: true, powerPreference: 'low-power' });
    } catch (e) {
        gl = null;
    }

    if (!gl) {
        if (fallback) fallback.style.display = 'flex';
        canvas.style.display = 'none';
        return;
    }

    // --- Shaders ---
    var vsSource = [
        'attribute vec3 aPosition;',
        'attribute vec3 aNormal;',
        'attribute vec3 aColor;',
        'attribute float aIsCross;',
        'uniform mat4 uModelView;',
        'uniform mat4 uProjection;',
        'uniform mat3 uNormalMat;',
        'varying vec3 vNormal;',
        'varying vec3 vPos;',
        'varying vec3 vColor;',
        'varying float vIsCross;',
        'void main(void) {',
        '    vec4 pos = uModelView * vec4(aPosition, 1.0);',
        '    vPos = pos.xyz;',
        '    vNormal = normalize(uNormalMat * aNormal);',
        '    vColor = aColor;',
        '    vIsCross = aIsCross;',
        '    gl_Position = uProjection * pos;',
        '}'
    ].join('\n');

    var fsSource = [
        'precision mediump float;',
        'varying vec3 vNormal;',
        'varying vec3 vPos;',
        'varying vec3 vColor;',
        'varying float vIsCross;',
        'void main(void) {',
        '    vec3 norm = normalize(vNormal);',
        '    vec3 viewDir = normalize(-vPos);',
        '    if (dot(norm, viewDir) < 0.0) {',
        '        norm = -norm;',
        '    }',
        // Key light (top-left front)
        '    vec3 light1 = normalize(vec3(0.55, 0.85, 0.9));',
        '    float diff1 = max(dot(norm, light1), 0.0);',
        // Fill light (bottom-right)
        '    vec3 light2 = normalize(vec3(-0.6, -0.4, 0.5));',
        '    float diff2 = max(dot(norm, light2), 0.0) * 0.5;',
        // Specular highlight
        '    vec3 reflectDir = reflect(-light1, norm);',
        '    float spec = pow(max(dot(viewDir, reflectDir), 0.0), 24.0);',
        // Fresnel rim glow for rich edge definition in both light and dark
        '    float fresnel = pow(1.0 - max(dot(norm, viewDir), 0.0), 2.0);',
        '    vec3 rimGlow = vec3(0.45, 0.85, 1.0) * fresnel * 1.5;',
        '    if (vIsCross > 0.5) {',
        // Radiant high-contrast white cross
        '        vec3 crossBase = vec3(1.0, 1.0, 1.0);',
        '        vec3 crossDiff = diff1 * vec3(0.18, 0.18, 0.18) + diff2 * vec3(0.12, 0.14, 0.18);',
        '        vec3 crossSpec = spec * vec3(1.0, 1.0, 1.0) * 1.1;',
        '        gl_FragColor = vec4(crossBase + crossDiff + crossSpec + rimGlow * 0.5, 1.0);',
        '    } else if (vIsCross > 0.2) {',
        // Floating 3D orbital ring (luminous ice cyan)
        '        vec3 ringAmb = vec3(0.35, 0.85, 1.0) * 1.35;',
        '        vec3 ringDiff = diff1 * vec3(0.35, 0.85, 1.0);',
        '        vec3 ringSpec = spec * vec3(1.0, 1.0, 1.0) * 1.2;',
        '        gl_FragColor = vec4(ringAmb + ringDiff + ringSpec + rimGlow * 1.6, 0.95);',
        '    } else {',
        // Vivid sapphire-cyan frosted glass shield body
        '        vec3 amb = vColor * 0.70 + vec3(0.10, 0.32, 0.65);',
        '        vec3 diff = (diff1 * 0.95 + diff2 * 0.45) * vColor;',
        '        vec3 specular = spec * vec3(0.9, 0.98, 1.0) * 1.4;',
        '        vec3 finalCol = amb + diff + specular + rimGlow;',
        '        gl_FragColor = vec4(finalCol, 0.98);',
        '    }',
        '}'
    ].join('\n');

    function createShader(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            gl.deleteShader(s);
            return null;
        }
        return s;
    }

    var vs = createShader(gl.VERTEX_SHADER, vsSource);
    var fs = createShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) {
        if (fallback) fallback.style.display = 'flex';
        canvas.style.display = 'none';
        return;
    }

    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        if (fallback) fallback.style.display = 'flex';
        canvas.style.display = 'none';
        return;
    }

    var aPos = gl.getAttribLocation(program, 'aPosition');
    var aNorm = gl.getAttribLocation(program, 'aNormal');
    var aCol = gl.getAttribLocation(program, 'aColor');
    var aCross = gl.getAttribLocation(program, 'aIsCross');
    var uMV = gl.getUniformLocation(program, 'uModelView');
    var uProj = gl.getUniformLocation(program, 'uProjection');
    var uNMat = gl.getUniformLocation(program, 'uNormalMat');

    // --- Geometry Data ---
    var vertices = [];
    var normals = [];
    var colors = [];
    var isCrossFlags = [];

    function addTri(p1, p2, p3, col, crossFlag) {
        var ux = p2[0] - p1[0], uy = p2[1] - p1[1], uz = p2[2] - p1[2];
        var vx = p3[0] - p1[0], vy = p3[1] - p1[1], vz = p3[2] - p1[2];
        var nx = uy * vz - uz * vy;
        var ny = uz * vx - ux * vz;
        var nz = ux * vy - uy * vx;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;
        nx /= len; ny /= len; nz /= len;

        vertices.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
        normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
        for (var i = 0; i < 3; i++) {
            colors.push(col[0], col[1], col[2]);
            isCrossFlags.push(crossFlag);
        }
    }

    function addQuad(p1, p2, p3, p4, col, crossFlag) {
        addTri(p1, p2, p3, col, crossFlag);
        addTri(p1, p3, p4, col, crossFlag);
    }

    // Colors
    var shieldBlue = [0.22, 0.62, 1.0];       // Vivid clinical sapphire
    var shieldBevel = [0.16, 0.48, 0.86];     // Bevel shade
    var crossWhite = [1.0, 1.0, 1.0];         // Pure radiant white
    var ringCyan = [0.35, 0.92, 1.0];         // Luminous orbital cyan

    // 1. Faceted Shield Geometry
    var topC = [0, 1.25, 0.35];
    var topR = [1.0, 1.12, 0.12];
    var midR = [1.12, 0.08, 0.12];
    var botC = [0, -1.4, 0.30];
    var midL = [-1.12, 0.08, 0.12];
    var topL = [-1.0, 1.12, 0.12];
    var centerP = [0, 0.05, 0.46];

    // Front facets
    addTri(topC, topR, centerP, shieldBlue, 0.0);
    addTri(centerP, topR, midR, shieldBlue, 0.0);
    addTri(centerP, midR, botC, shieldBlue, 0.0);
    addTri(centerP, botC, midL, shieldBlue, 0.0);
    addTri(centerP, midL, topL, shieldBlue, 0.0);
    addTri(topC, centerP, topL, shieldBlue, 0.0);

    // Beveled rim
    var btopC = [0, 1.30, -0.25];
    var btopR = [1.10, 1.18, -0.25];
    var bmidR = [1.22, 0.08, -0.25];
    var bbotC = [0, -1.50, -0.25];
    var bmidL = [-1.22, 0.08, -0.25];
    var btopL = [-1.10, 1.18, -0.25];

    addQuad(topC, btopC, btopR, topR, shieldBevel, 0.0);
    addQuad(topR, btopR, bmidR, midR, shieldBevel, 0.0);
    addQuad(midR, bmidR, bbotC, botC, shieldBevel, 0.0);
    addQuad(botC, bbotC, bmidL, midL, shieldBevel, 0.0);
    addQuad(midL, bmidL, btopL, topL, shieldBevel, 0.0);
    addQuad(topL, btopL, btopC, topC, shieldBevel, 0.0);

    // 2. High-Luminance Protruding Medical Cross (Front + Bevels)
    var cw = 0.22, cl = 0.65, ch = 0.64;
    var cbz = 0.45;
    // Front faces of the cross
    addQuad([-cw, cl, ch], [cw, cl, ch], [cw, -cl, ch], [-cw, -cl, ch], crossWhite, 1.0);
    addQuad([-cl, cw, ch], [cl, cw, ch], [cl, -cw, ch], [-cl, -cw, ch], crossWhite, 1.0);

    // Cross beveled side walls
    addQuad([-cw, cl, ch], [-cw, cl, cbz], [cw, cl, cbz], [cw, cl, ch], crossWhite, 1.0);
    addQuad([cw, -cl, ch], [cw, -cl, cbz], [-cw, -cl, cbz], [-cw, -cl, ch], crossWhite, 1.0);
    addQuad([-cl, cw, ch], [-cl, cw, cbz], [-cl, -cw, cbz], [-cl, -cw, ch], crossWhite, 1.0);
    addQuad([cl, -cw, ch], [cl, -cw, cbz], [cl, cw, cbz], [cl, cw, ch], crossWhite, 1.0);

    // Cross inner corners
    addQuad([cw, cw, ch], [cw, cw, cbz], [cl, cw, cbz], [cl, cw, ch], crossWhite, 1.0);
    addQuad([-cl, cw, ch], [-cl, cw, cbz], [-cw, cw, cbz], [-cw, cw, ch], crossWhite, 1.0);
    addQuad([-cw, -cw, ch], [-cw, -cw, cbz], [-cl, -cw, cbz], [-cl, -cw, ch], crossWhite, 1.0);
    addQuad([cl, -cw, ch], [cl, -cw, cbz], [cw, -cw, cbz], [cw, -cw, ch], crossWhite, 1.0);

    // 3. Floating 3D Orbital Depth Ring (tilted ellipse around the shield)
    var ringSegments = 32;
    var rX = 1.75, rY = 1.65, ringThickness = 0.055;
    for (var s = 0; s < ringSegments; s++) {
        var th1 = (s / ringSegments) * Math.PI * 2;
        var th2 = ((s + 1) / ringSegments) * Math.PI * 2;

        // Angle ring across 3D space
        var cos1 = Math.cos(th1), sin1 = Math.sin(th1);
        var cos2 = Math.cos(th2), sin2 = Math.sin(th2);

        var pA1 = [cos1 * rX, sin1 * rY * 0.45, sin1 * 0.75];
        var pA2 = [cos2 * rX, sin2 * rY * 0.45, sin2 * 0.75];
        var pB1 = [cos1 * (rX + ringThickness), sin1 * (rY + ringThickness) * 0.45, sin1 * 0.75];
        var pB2 = [cos2 * (rX + ringThickness), sin2 * (rY + ringThickness) * 0.45, sin2 * 0.75];

        addQuad(pA1, pA2, pB2, pB1, ringCyan, 0.35);
    }

    // Buffers
    function createBuf(data, itemSize) {
        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        return buf;
    }

    var vBuf = createBuf(vertices, 3);
    var nBuf = createBuf(normals, 3);
    var cBuf = createBuf(colors, 3);
    var xBuf = createBuf(isCrossFlags, 1);
    var numVerts = vertices.length / 3;

    // --- Matrix Math Helpers ---
    function mat4Perspective(fovy, aspect, near, far) {
        var f = 1.0 / Math.tan(fovy / 2);
        var nf = 1 / (near - far);
        return [
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (far + near) * nf, -1,
            0, 0, 2 * far * near * nf, 0
        ];
    }

    function mat4Identity() {
        return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    }

    function mat4RotateX(m, rad) {
        var c = Math.cos(rad), s = Math.sin(rad);
        return [
            m[0], m[1], m[2], m[3],
            m[4]*c + m[8]*s, m[5]*c + m[9]*s, m[6]*c + m[10]*s, m[7]*c + m[11]*s,
            m[4]*-s + m[8]*c, m[5]*-s + m[9]*c, m[6]*-s + m[10]*c, m[7]*-s + m[11]*c,
            m[12], m[13], m[14], m[15]
        ];
    }

    function mat4RotateY(m, rad) {
        var c = Math.cos(rad), s = Math.sin(rad);
        return [
            m[0]*c - m[8]*s, m[1]*c - m[9]*s, m[2]*c - m[10]*s, m[3]*c - m[11]*s,
            m[4], m[5], m[6], m[7],
            m[0]*s + m[8]*c, m[1]*s + m[9]*c, m[2]*s + m[10]*c, m[3]*s + m[11]*c,
            m[12], m[13], m[14], m[15]
        ];
    }

    function mat3FromMat4(m) {
        return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
    }

    // --- Interaction & Tracking ---
    var targetRotX = 0, targetRotY = 0;
    var curRotX = 0, curRotY = 0;

    function onPointerMove(e) {
        var rect = container.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var x = (e.clientX - cx) / (window.innerWidth / 2);
        var y = (e.clientY - cy) / (window.innerHeight / 2);
        targetRotY = Math.max(-0.28, Math.min(0.28, x * 0.55));
        targetRotX = Math.max(-0.22, Math.min(0.22, -y * 0.40));
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });

    // --- Render Loop ---
    var running = true;
    var startTime = performance.now();

    function render(now) {
        if (!running) return;

        var elapsed = (now - startTime) * 0.001;

        // Smooth subtle oscillation & floating breath
        var breathY = Math.sin(elapsed * 1.1) * 0.09;
        var breathX = Math.cos(elapsed * 0.8) * 0.04;
        var floatY = Math.sin(elapsed * 1.4) * 0.09;

        curRotX += (targetRotX + breathX - curRotX) * 0.085;
        curRotY += (targetRotY + breathY - curRotY) * 0.085;

        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = container.clientWidth || 320;
        var h = container.clientHeight || 220;
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            gl.viewport(0, 0, canvas.width, canvas.height);
        }

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);

        gl.useProgram(program);

        var aspect = canvas.width / canvas.height;
        var proj = mat4Perspective(0.82, aspect, 0.1, 100.0);

        var mv = mat4Identity();
        // Frame closer for prominent size and crisp details
        mv[14] = -3.10;
        mv[13] = floatY;

        mv = mat4RotateX(mv, curRotX);
        mv = mat4RotateY(mv, curRotY);

        var nmat = mat3FromMat4(mv);

        gl.uniformMatrix4fv(uProj, false, new Float32Array(proj));
        gl.uniformMatrix4fv(uMV, false, new Float32Array(mv));
        gl.uniformMatrix3fv(uNMat, false, new Float32Array(nmat));

        // Position buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

        // Normal buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, nBuf);
        gl.enableVertexAttribArray(aNorm);
        gl.vertexAttribPointer(aNorm, 3, gl.FLOAT, false, 0, 0);

        // Color buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, cBuf);
        gl.enableVertexAttribArray(aCol);
        gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 0, 0);

        // Cross flag buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, xBuf);
        gl.enableVertexAttribArray(aCross);
        gl.vertexAttribPointer(aCross, 1, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, numVerts);

        requestAnimationFrame(render);
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            running = false;
        } else {
            running = true;
            requestAnimationFrame(render);
        }
    });

    requestAnimationFrame(render);
})(window, document);
