/* Bendy Bus 3D: the fleet.
   Three generic Singapore-style buses the child can pick in the garage (no operator branding, logos or liveries;
   any paint colour): 'bendy' (articulated, two carriages), 'double' (a tri-axle double-decker) and 'single' (a
   low-floor single-decker). No faces: real bus details instead (split windscreen, LED route displays with the route
   number front, kerb side and rear, headlight and indicator clusters, mirrors on arms, grille, framed windows, glass
   doors on the LEFT (kerb, +x) side, the driver on the right (-x), tail lights).
   Few draw calls: each carriage is ONE opaque mesh (paint, details, lamps and the LED displays together) plus, on the
   carriage with the seats, ONE "upper" mesh (everything above the window sill: glass, pillars, roof, and on the
   double-decker the upper deck). That upper mesh is roofParts: hide it and the ten seats show from above. A small
   shader patch on MeshLambertMaterial does the rest: vertices flagged as paint take the material colour (so a paint
   change is one colour set, shared by all of a bus's materials), lamps and displays glow (setLights), and the door
   leaves slide in the vertex shader (each door is an invisible Object3D that bus.js moves exactly like before).
   Exposes BB.fleet = { TYPES, NAMES, build(type, paint, opts), preview(type, paint) }. Conventions as bus.js:
   forward +z, y up, ground y = 0 under the wheels, width 2.5. */
(function () {
  'use strict';
  const BB = window.BB = window.BB || {};

  // ---------- sizes and colours ----------
  const HW = 1.25, WIDTH = 2.5, TYRE_R = 0.52, WHEEL_X = 1.08;
  const SKIRT0 = 0.38, FLOOR_Y = 0.86, WAIST = 1.32;
  const FRAME = '#33303a', RUBBER = '#26232b', GLASS = '#d6f1fb', GLASS_A = 0.34, GLASS_OPAQUE = '#86a3b6';
  const FLOOR = '#8f8699', LINING = '#efe6d6', ARCH = '#3f3744', HOUSING = '#7a7284', CEIL = '#f4eee2';
  const SEAT_A = '#4f8fe0', SEAT_B = '#f29a3a', SEAT_UP = '#6f86c9';
  const LAMP_HEAD = '*#fff6c8', LAMP_IND = '*#ffae3a', LAMP_TAIL = '*#ff4a3a', LAMP_REV = '*#fbf3e0';
  const DOOR_SLIDE = 1.1;          // how far bus.js moves a door proxy along +z when the door is fully open
  // LED sign texture (256 x 64): route number on the left, destination dots on the right, and a white block in the
  // top-right corner that every other vertex samples (so the map leaves ordinary surfaces untouched).
  const TEX_W = 256, TEX_H = 64;
  const UV_WHITE = [252 / TEX_W, 1 - 4 / TEX_H];
  const UV_NUM = [2 / TEX_W, 2 / TEX_H, 94 / TEX_W, 62 / TEX_H], UV_DEST = [100 / TEX_W, 6 / TEX_H, 244 / TEX_W, 58 / TEX_H];

  // ---------- part collector: merges parts into one flat-shaded geometry with paint/glow/door/uv attributes ----------
  // Colour strings: '#rrggbb' plain, '~#rrggbb' paint (the paint colour times this shade: '~#ffffff' = the paint,
  // '~#b0b0b0' a deeper tone of it), '*#rrggbb' a lamp (glows while the lights are on).
  // Options o: { a: alpha (glass), door: 1 | 2 (door number), dk: the leaf's slide along z when fully open (signed),
  //   outer: true for a leaf that slides over the other one (it pops out further), uv: [u0,v0,u1,v1] }.
  const NO = {};
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const colCache = {};
  function parseCol(c) {
    if (colCache[c]) return colCache[c];
    const paint = c[0] === '~' ? 1 : 0, glow = c[0] === '*' ? 1 : 0;
    return (colCache[c] = { c: new THREE.Color(paint || glow ? c.slice(1) : c), paint, glow });
  }
  class Kit {
    constructor(opaqueGlass) { this.parts = []; this.opaqueGlass = !!opaqueGlass; }
    add(geo, col, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, o = NO, sx = 1, sy = 1, sz = 1) {
      _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
      const m = new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
      this.parts.push({ geo, col, m, o });
      return this;
    }
    // y is the bottom of the box (before any rotation)
    box(w, h, d, col, x, y, z, o, rx, ry, rz) { return this.add(new THREE.BoxGeometry(w, h, d), col, x, y + h / 2, z, rx || 0, ry || 0, rz || 0, o); }
    cyl(rt, rb, h, seg, col, x, y, z, o, rx, ry, rz) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), col, x, y, z, rx || 0, ry || 0, rz || 0, o); }
    ball(r, col, x, y, z, sx, sy, sz) { return this.add(new THREE.IcosahedronGeometry(r, 0), col, x, y, z, 0, 0, 0, NO, sx || 1, sy || 1, sz || 1); }
    // a glass pane: see-through on the upper mesh, an opaque tinted pane on an opaque-only carriage
    glass(w, h, d, x, y, z, o) {
      if (this.opaqueGlass) return this.box(w, h, d, GLASS_OPAQUE, x, y, z, o || NO);
      return this.box(w, h, d, GLASS, x, y, z, Object.assign({ a: GLASS_A }, o || NO));
    }
    // an LED display face: a plane (faces +z before ry) showing part of the sign texture
    sign(w, h, rect, x, y, z, ry) { return this.add(new THREE.PlaneGeometry(w, h), '*#ffffff', x, y, z, 0, ry || 0, 0, { uv: rect }); }
    geometry() {
      // opaque parts first, glass last: the upper mesh writes depth, so glass must not hide what is behind it
      const list = this.parts.filter((p) => !(p.o.a < 1)).concat(this.parts.filter((p) => p.o.a < 1));
      const gs = []; let total = 0;
      for (const p of list) {
        const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
        if (g !== p.geo) p.geo.dispose();
        g.applyMatrix4(p.m);
        total += g.attributes.position.count;
        gs.push({ g, p });
      }
      const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 4);
      const uv = new Float32Array(total * 2), paint = new Float32Array(total), glow = new Float32Array(total), door = new Float32Array(total), doorK = new Float32Array(total);
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      let o = 0;
      for (const { g, p } of gs) {
        const src = g.attributes.position.array, cnt = g.attributes.position.count, pc = parseCol(p.col), al = p.o.a == null ? 1 : p.o.a;
        pos.set(src.subarray(0, cnt * 3), o * 3);
        for (let i = 0; i + 2 < cnt; i += 3) {
          a.fromArray(src, i * 3); b.fromArray(src, i * 3 + 3); c.fromArray(src, i * 3 + 6);
          b.sub(a); c.sub(a); b.cross(c).normalize();
          for (let k = 0; k < 3; k++) nor.set([b.x, b.y, b.z], (o + i + k) * 3);
        }
        const suv = p.o.uv && g.attributes.uv ? g.attributes.uv.array : null, r = p.o.uv;
        for (let i = 0; i < cnt; i++) {
          const j = o + i;
          col[j * 4] = pc.c.r; col[j * 4 + 1] = pc.c.g; col[j * 4 + 2] = pc.c.b; col[j * 4 + 3] = al;
          if (suv) { uv[j * 2] = r[0] + suv[i * 2] * (r[2] - r[0]); uv[j * 2 + 1] = r[1] + suv[i * 2 + 1] * (r[3] - r[1]); }
          else { uv[j * 2] = UV_WHITE[0]; uv[j * 2 + 1] = UV_WHITE[1]; }
          paint[j] = pc.paint; glow[j] = pc.glow;
          if (p.o.door) { door[j] = p.o.door + (p.o.outer ? 0.5 : 0); doorK[j] = p.o.dk || 0; }
        }
        o += cnt;
        g.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      out.setAttribute('color', new THREE.BufferAttribute(col, 4));
      out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      out.setAttribute('aPaint', new THREE.BufferAttribute(paint, 1));
      out.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
      out.setAttribute('aDoor', new THREE.BufferAttribute(door, 1));
      out.setAttribute('aDoorK', new THREE.BufferAttribute(doorK, 1));
      out.computeBoundingSphere();
      return out;
    }
  }

  // ---------- the bus material: Lambert + paint mask + glowing lamps + sliding doors ----------
  function busMaterial(shared, transparent) {
    const doorU = { value: new THREE.Vector4() };
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, map: shared.tex, transparent: !!transparent, depthWrite: true });
    m.color = shared.paint;            // the same Color object on every material of this bus: one set repaints it all
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uLamp = shared.lamp; sh.uniforms.uDoor = doorU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPaint;\nattribute float aGlow;\nattribute float aDoor;\nattribute float aDoorK;\nuniform vec4 uDoor;\nvarying float vPaint;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaint = aPaint; vGlow = aGlow;\nif (aDoor > 0.5) { float id = floor(aDoor + 0.01); vec2 dd = id < 1.5 ? uDoor.xy : uDoor.zw; transformed.x += dd.x + dd.y * (0.06 + (aDoor - id) * 0.16); transformed.z += aDoorK * dd.y; }');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLamp;\nvarying float vPaint;\nvarying float vGlow;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( mix( vec3( 1.0 ), diffuse, vPaint ), opacity );')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * uLamp;\ndiffuseColor.rgb *= 1.0 - 0.55 * vGlow * uLamp;');
    };
    m.userData.doorU = doorU;
    return m;
  }

  // ---------- LED sign texture (one small canvas per bus) ----------
  function makeSign() {
    const cv = document.createElement('canvas'); cv.width = TEX_W; cv.height = TEX_H;
    const x = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    // draw text as LED dots: render it small, then put a round dot for every lit pixel
    const dots = (str, X, Y, W, H, pitch, font) => {
      const cols = Math.floor(W / pitch), rows = Math.floor(H / pitch);
      const s = document.createElement('canvas'); s.width = cols; s.height = rows;
      const sx = s.getContext('2d');
      sx.fillStyle = '#fff'; sx.textAlign = 'center'; sx.textBaseline = 'middle'; sx.font = font;
      const tw = sx.measureText(str).width, k = Math.min(1, (cols - 1) / Math.max(1, tw));
      sx.save(); sx.translate(cols / 2, rows / 2 + 0.5); sx.scale(k, 1); sx.fillText(str, 0, 0); sx.restore();
      const d = sx.getImageData(0, 0, cols, rows).data;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const v = d[(j * cols + i) * 4 + 3];
        const cx = X + (i + 0.5) * pitch, cy = Y + (j + 0.5) * pitch;
        x.fillStyle = v > 90 ? '#ffb43a' : '#2c2622';
        x.beginPath(); x.arc(cx, cy, pitch * (v > 90 ? 0.46 : 0.3), 0, Math.PI * 2); x.fill();
      }
    };
    let num = '', dest = 'Interchange';
    const draw = () => {
      x.fillStyle = '#17151b'; x.fillRect(0, 0, TEX_W, TEX_H);
      dots(num, 2, 2, 92, 60, 4, 'bold 15px sans-serif');
      dots(dest, 100, 8, 144, 48, 3, 'bold 12px sans-serif');
      x.fillStyle = '#ffffff'; x.fillRect(TEX_W - 10, 0, 10, 10);       // the white block (UV_WHITE)
      tex.needsUpdate = true;
    };
    return {
      tex,
      setNumber(str) { num = String(str == null ? '' : str).replace(/[^0-9A-Za-z]/g, '').slice(0, 3); draw(); },
      setDest(str) { dest = String(str || '').slice(0, 14); draw(); },
      get number() { return num; },
    };
  }

  // ---------- shapes ----------
  function profile(w, y0, y1, rt, rb) {
    const s = new THREE.Shape(), x0 = -w / 2, x1 = w / 2;
    s.moveTo(x0 + rb, y0); s.lineTo(x1 - rb, y0); s.quadraticCurveTo(x1, y0, x1, y0 + rb);
    s.lineTo(x1, y1 - rt); s.quadraticCurveTo(x1, y1, x1 - rt, y1); s.lineTo(x0 + rt, y1);
    s.quadraticCurveTo(x0, y1, x0, y1 - rt); s.lineTo(x0, y0 + rb); s.quadraticCurveTo(x0, y0, x0 + rb, y0);
    return s;
  }
  // A rounded profile (x-y) extruded along z, centred on z = 0.
  function slab(w, y0, y1, rt, rb, len, bevel = 0.12) {
    const g = new THREE.ExtrudeGeometry(profile(w - 2 * bevel, y0 + bevel, y1 - bevel, rt, rb),
      { depth: len - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 2 });
    g.translate(0, 0, -(len - 2 * bevel) / 2);
    return g;
  }
  // [z0,z1] minus the given gaps [[a,b],...] -> list of [z0,z1] pieces (z0 < z1)
  function cut(z0, z1, gaps) {
    let segs = [[z0, z1]];
    for (const [a, b] of gaps) {
      const next = [];
      for (const [s, e] of segs) {
        if (b <= s || a >= e) { next.push([s, e]); continue; }
        if (a > s) next.push([s, a]);
        if (b < e) next.push([b, e]);
      }
      segs = next;
    }
    return segs.filter(([s, e]) => e - s > 0.05);
  }

  // The standard wheel pair (one axle; spins about x) and bumper, as in bus.js, for standalone use; bus.js swaps
  // the wheel geometry for its own part geometry.
  function wheelGeometry() {
    const b = BB.mk.builder(), R = TYRE_R, Wd = 0.36;
    for (const s of [-1, 1]) {
      const x = s * WHEEL_X, face = x + s * (Wd / 2 + 0.01), rr = R * 0.55;
      b.add(new THREE.CylinderGeometry(R, R, Wd, 14), '#2f2a33', x, 0, 0, 0, 0, Math.PI / 2);
      b.add(new THREE.CylinderGeometry(rr, rr, Wd + 0.04, 10), '#dfe3ea', x, 0, 0, 0, 0, Math.PI / 2);
      b.add(new THREE.BoxGeometry(0.05, rr * 1.6, 0.12), '#aab2bf', face, 0, 0);
      b.add(new THREE.CylinderGeometry(0.08, 0.08, Wd + 0.08, 6), '#5a5260', x, 0, 0, 0, 0, Math.PI / 2);
    }
    return b.geometry();
  }
  function addBumper(k, zFace, s) {
    const z = zFace + s * 0.04;
    k.add(slab(2.6, 0.18, 0.5, 0.1, 0.1, 0.4, 0.06), '#46404e', 0, 0, z);
    k.box(0.7, 0.18, 0.04, '#fbf7ee', 0, 0.26, z + s * 0.22); k.box(0.5, 0.06, 0.02, '#3a3440', 0, 0.32, z + s * 0.24);
  }

  // ---------- one carriage ----------
  // spec: { L, role: 'solo'|'front'|'rear', deck: 1|2, axles:[z], steerZ, doors:[{z,w}], seatsZ:[5 z]|null,
  //         see: true if this carriage gets the see-through upper mesh }
  function carriage(spec, shared, opts) {
    const L = spec.L, zf = L / 2, zb = -L / 2, dbl = spec.deck === 2;
    const hasFront = spec.role !== 'rear', hasRear = spec.role !== 'front';
    const low = new Kit(!spec.see), up = spec.see ? new Kit(false) : low;
    const winTop = dbl ? 2.18 : 2.34, roof0 = dbl ? 3.64 : winTop, roof1 = dbl ? 4.36 : 3.1;
    const doorTop = dbl ? 2.1 : 2.26;
    const doorGaps = spec.doors.map((d) => [d.z - d.w / 2 - 0.06, d.z + d.w / 2 + 0.06]);
    const archGaps = spec.axles.map((z) => [z - 0.74, z + 0.74]);
    const g = new THREE.Group();

    // --- lower body: a rounded skirt, then a hollow tub (thin walls with a cream lining) so the seats show from above
    low.add(slab(2.52, SKIRT0, FLOOR_Y, 0.06, 0.16, L), '~#a3a3a3');
    low.box(2.34, 0.03, L - 0.3, FLOOR, 0, FLOOR_Y - 0.01, 0);
    const wallZ0 = zb + 0.12, wallZ1 = zf - 0.12;
    for (const s of [1, -1]) {
      const gaps = s > 0 ? doorGaps : [];
      for (const [a, b] of cut(wallZ0, wallZ1, gaps)) {
        const zc = (a + b) / 2, len = b - a;
        low.box(0.06, WAIST - FLOOR_Y, len, '~#ffffff', s * 1.22, FLOOR_Y, zc);
        low.box(0.04, WAIST - FLOOR_Y, len, LINING, s * 1.17, FLOOR_Y, zc);
        low.box(0.16, 0.05, len, '~#c9c9c9', s * 1.19, WAIST - 0.03, zc);                 // window sill
      }
      // a cream band with a dark pin-stripe under it, and amber side marker lamps along the skirt
      for (const [a, b] of cut(wallZ0 + 0.1, wallZ1 - 0.1, gaps)) {
        low.box(0.03, 0.15, b - a, '#fff6e0', s * 1.255, 1.04, (a + b) / 2);
        low.box(0.03, 0.06, b - a, '#3a3440', s * 1.256, 0.96, (a + b) / 2);
      }
      for (const [a, b] of cut(zb + 0.6, zf - 0.6, gaps.concat(archGaps))) if (b - a > 0.4) low.box(0.03, 0.06, 0.14, LAMP_IND, s * 1.262, 0.5, (a + b) / 2);
      // wheel arches (dark half discs) and the wheel housings inside
      for (const z of spec.axles) {
        low.add(new THREE.CircleGeometry(0.74, 10, 0, Math.PI), ARCH, s * 1.264, SKIRT0 + 0.02, z, 0, s * Math.PI / 2, 0);
        low.box(0.4, 1.08 - FLOOR_Y, 1.3, HOUSING, s * 1.0, FLOOR_Y, z);
      }
    }
    // doorway steps (a yellow edge on the floor at each door)
    for (const d of spec.doors) low.box(0.2, 0.02, d.w, '#ffd45c', 1.1, FLOOR_Y + 0.01, d.z);

    // --- seats: two rows of five (a ten-frame): row 1 (seats 0-4) blue on the door side, row 2 orange
    const seats = [];
    if (spec.seatsZ) {
      for (let i = 0; i < 10; i++) {
        const sx = i < 5 ? 0.6 : -0.6, z = spec.seatsZ[i % 5], col = i < 5 ? SEAT_A : SEAT_B;
        low.box(0.34, 0.08, 0.3, '#5a5260', sx, FLOOR_Y, z);
        low.box(0.66, 0.12, 0.58, col, sx, FLOOR_Y + 0.06, z);
        low.box(0.66, 0.62, 0.1, col, sx, FLOOR_Y + 0.18, z - 0.33, NO, -0.08);
        low.box(0.06, 0.06, 0.12, '#c9c3cf', sx + (i < 5 ? -0.34 : 0.34), FLOOR_Y + 0.75, z - 0.33);  // grab handle
        seats.push({ x: sx, y: 1.25, z });
      }
    }

    // --- the driver (right-hand side, -x) behind a cab screen, with a cap and a steering wheel (no face)
    if (hasFront) {
      const dz = zf - 0.95;
      low.box(0.66, 0.36, 0.58, '#4a4250', -0.62, FLOOR_Y, dz);
      low.box(0.66, 0.7, 0.12, '#4a4250', -0.62, FLOOR_Y + 0.3, dz - 0.32, NO, -0.12);
      low.cyl(0.22, 0.28, 0.6, 6, '#4f7fe0', -0.62, FLOOR_Y + 0.62, dz + 0.05);
      low.ball(0.24, '#d9a679', -0.62, FLOOR_Y + 1.18, dz + 0.05);
      low.ball(0.26, '#2b5aa8', -0.62, FLOOR_Y + 1.28, dz + 0.02, 1, 0.55, 1);
      low.box(0.34, 0.05, 0.26, '#2b5aa8', -0.62, FLOOR_Y + 1.26, dz + 0.25);
      low.add(new THREE.TorusGeometry(0.22, 0.04, 4, 10), '#3a2a3c', -0.62, FLOOR_Y + 0.78, dz + 0.42, -0.9, 0, 0);
      low.box(0.95, 0.75, 0.05, '#ded6c8', -0.72, FLOOR_Y, dz - 0.5);                      // cab screen
      low.box(0.95, 0.42, 0.04, GLASS_OPAQUE, -0.72, FLOOR_Y + 0.75, dz - 0.5);
      low.box(1.0, 0.5, 0.5, '#3a3440', -0.6, FLOOR_Y, zf - 0.32);                          // dashboard
    }

    // --- front end
    let nose = null;
    if (hasFront) {
      const FZ = zf;
      // lower front panel, grille, headlight clusters with indicators
      low.box(2.46, 1.02 - SKIRT0, 0.1, '~#ffffff', 0, SKIRT0, FZ - 0.05);
      low.box(2.46, 0.12, 0.1, '~#b0b0b0', 0, SKIRT0, FZ - 0.04);
      low.box(1.2, 0.34, 0.04, '#3a3440', 0, 0.56, FZ + 0.01);
      for (let k = 0; k < 4; k++) low.box(1.14, 0.03, 0.05, '#6c6470', 0, 0.6 + k * 0.08, FZ + 0.02);
      for (const s of [1, -1]) {
        low.box(0.56, 0.26, 0.05, FRAME, s * 0.9, 0.58, FZ + 0.01);
        low.box(0.3, 0.18, 0.04, LAMP_HEAD, s * 0.98, 0.62, FZ + 0.035);
        low.box(0.14, 0.18, 0.04, LAMP_IND, s * 0.73, 0.62, FZ + 0.035);
        low.box(0.03, 0.12, 0.22, LAMP_IND, s * 1.262, 0.72, FZ - 0.3);                       // side repeater
      }
      // windscreen: two panes split by a pillar, framed (border pieces, so you can see the driver through it)
      const wy0 = 1.02, wy1 = winTop - 0.04, wh = wy1 - wy0;
      up.box(2.46, 0.07, 0.07, FRAME, 0, wy0 - 0.02, FZ);
      up.box(2.46, 0.07, 0.07, FRAME, 0, wy1 - 0.05, FZ);
      for (const x of [-1.2, 0, 1.2]) up.box(x ? 0.08 : 0.06, wh, 0.07, FRAME, x, wy0, FZ);
      for (const x of [-0.6, 0.6]) up.glass(1.12, wh - 0.04, 0.03, x, wy0 + 0.02, FZ + 0.01);
      for (const x of [-0.75, 0.45]) up.box(0.7, 0.035, 0.035, RUBBER, x, wy0 + 0.06, FZ + 0.045, NO, 0, 0, 0.16);  // wipers
      // the front route display: above the windscreen (single, bendy) or between the decks (double-decker)
      const dy = winTop + 0.02;
      up.box(2.24, 0.34, 0.06, '#211e25', 0, dy, FZ + 0.01);
      up.sign(0.52, 0.28, UV_NUM, -0.78, dy + 0.17, FZ + 0.045);
      up.sign(1.5, 0.26, UV_DEST, 0.26, dy + 0.17, FZ + 0.045);
      // mirrors on arms ("rabbit ears"): from the top corners, forward, hanging in front of the windscreen corners
      const ay = dbl ? 2.4 : roof0 + 0.08;
      for (const s of [1, -1]) {
        up.box(0.06, 0.06, 0.62, FRAME, s * 1.28, ay, FZ + 0.24, NO, 0, s * 0.22);
        up.box(0.06, ay - 1.95, 0.06, FRAME, s * 1.36, 1.95, FZ + 0.52);
        up.box(0.24, 0.5, 0.1, '#2b2830', s * 1.38, 1.5, FZ + 0.52);
        up.box(0.19, 0.42, 0.02, '#a7c8dc', s * 1.38, 1.54, FZ + 0.465);
      }
      nose = FZ;
    } else {
      // bendy rear carriage: a dark bulkhead at the joint end
      low.box(2.4, roof1 - 0.4 - SKIRT0, 0.08, '#463e50', 0, SKIRT0, zf - 0.04);
    }
    if (spec.role === 'front') {
      low.box(2.4, WAIST - SKIRT0, 0.08, '#463e50', 0, SKIRT0, zb + 0.04);
      up.box(2.4, roof0 - WAIST, 0.08, '#463e50', 0, WAIST, zb + 0.04);
    }

    // --- rear end
    if (hasRear) {
      const BZ = zb;
      const panelTop = dbl ? 2.62 : 1.42;
      low.box(2.46, panelTop - SKIRT0, 0.1, '~#ffffff', 0, SKIRT0, BZ + 0.05);
      low.box(2.46, 0.12, 0.1, '~#b0b0b0', 0, SKIRT0, BZ + 0.04);
      low.box(1.5, 0.6, 0.04, '#3a3440', 0, 0.56, BZ - 0.01);                                    // engine grille
      for (let k = 0; k < 5; k++) low.box(1.42, 0.04, 0.05, '#6c6470', 0, 0.62 + k * 0.11, BZ - 0.02);
      for (const s of [1, -1]) {                                                                 // tail-light clusters
        low.box(0.34, 0.92, 0.05, FRAME, s * 1.0, 0.56, BZ - 0.01);
        low.box(0.26, 0.36, 0.04, LAMP_TAIL, s * 1.0, 1.0, BZ - 0.035);
        low.box(0.26, 0.16, 0.04, LAMP_IND, s * 1.0, 0.8, BZ - 0.035);
        low.box(0.26, 0.14, 0.04, LAMP_REV, s * 1.0, 0.62, BZ - 0.035);
        low.box(0.14, 0.08, 0.04, LAMP_TAIL, s * 0.95, roof1 - 0.2, BZ - 0.01);                  // high marker
      }
      // rear window (single / bendy) or the upper-deck rear window (double)
      const ry0 = dbl ? 2.78 : 1.46, ry1 = dbl ? 3.5 : winTop - 0.1;
      // the painted rear wall around the window (pieces, so the glass stays see-through)
      const wz = BZ + 0.05;
      up.box(2.46, ry0 - panelTop + 0.02, 0.1, '~#ffffff', 0, panelTop - 0.02, wz);
      up.box(2.46, roof0 - ry1, 0.1, '~#ffffff', 0, ry1, wz);
      for (const s of [1, -1]) up.box(0.26, ry1 - ry0, 0.1, '~#ffffff', s * 1.1, ry0, wz);
      up.box(2.0, 0.06, 0.07, FRAME, 0, ry0 - 0.03, BZ - 0.01); up.box(2.0, 0.06, 0.07, FRAME, 0, ry1 - 0.03, BZ - 0.01);
      for (const s of [1, -1]) up.box(0.06, ry1 - ry0, 0.07, FRAME, s * 0.97, ry0, BZ - 0.01);
      up.glass(1.9, ry1 - ry0 - 0.02, 0.03, 0, ry0 + 0.01, BZ - 0.035);
      // rear route number
      const rny = dbl ? 2.3 : roof1 - 0.5;
      (dbl ? low : up).box(0.66, 0.3, 0.05, '#211e25', 0, rny, BZ - 0.02);
      (dbl ? low : up).sign(0.56, 0.24, UV_NUM, 0, rny + 0.15, BZ - 0.05, Math.PI);
    }

    // --- side windows: framed glass with pillars; the doors get glass leaves instead
    const sideWin = (k, yb, yt, z0, z1, gapsPlus, barPitch) => {
      for (const s of [1, -1]) {
        for (const [a, b] of cut(z0, z1, s > 0 ? gapsPlus : [])) {
          const n = Math.max(1, Math.round((b - a) / barPitch)), zc = (a + b) / 2;
          k.glass(0.03, yt - yb, b - a, s * 1.215, yb, zc);
          k.box(0.06, 0.06, b - a, FRAME, s * 1.235, yb, zc);
          k.box(0.06, 0.07, b - a, FRAME, s * 1.235, yt - 0.07, zc);
          for (let i = 0; i <= n; i++) k.box(0.07, yt - yb, 0.11, FRAME, s * 1.232, yb, a + (b - a) * i / n + (i === 0 ? 0.05 : i === n ? -0.05 : 0));
        }
      }
    };
    const sz0 = zb + 0.16, sz1 = zf - 0.16;
    if (!dbl) sideWin(up, WAIST, winTop, sz0, sz1, doorGaps, 1.35);
    else {
      sideWin(up, WAIST, winTop, zb + 2.5, sz1, doorGaps, 1.35);                         // lower deck (solid at the back)
      for (const s of [1, -1]) {
        up.box(0.06, winTop - WAIST, 2.5 - 0.12, '~#ffffff', s * 1.22, WAIST, zb + 0.06 + 1.19);
        up.box(0.04, winTop - WAIST, 2.5 - 0.12, LINING, s * 1.17, WAIST, zb + 0.06 + 1.19);
      }
    }
    // headers above the doors
    for (const d of spec.doors) up.box(0.06, winTop - doorTop, d.w + 0.12, FRAME, 1.235, doorTop, d.z);

    // --- double-decker: band between the decks, upper floor, upper deck seats and windows, panoramic front window,
    //     and a staircase at the back on the right (it stays in the cut-away view as a hint)
    if (dbl) {
      for (const s of [1, -1]) {
        up.box(0.06, 2.62 - winTop, L - 0.24, '~#ffffff', s * 1.22, winTop, 0);
        up.box(0.03, 0.12, L - 0.4, '#fff6e0', s * 1.255, winTop + 0.12, 0);
      }
      up.box(2.46, 2.66 - winTop, 0.1, '~#ffffff', 0, winTop, zf - 0.05);                      // front band behind the display
      up.box(2.34, 0.08, L - 3.0, FLOOR, 0, 2.5, 1.25);                                          // upper floor (stairwell left open)
      up.box(1.1, 0.08, 2.6, FLOOR, 0.62, 2.5, zb + 1.5);
      for (let i = 0; i < 6; i++) for (const sx of [0.6, -0.6]) {
        const z = zf - 1.3 - i * 1.25;
        if (sx < 0 && z < zb + 2.9) continue;
        up.box(0.66, 0.1, 0.56, SEAT_UP, sx, 2.58, z);
        up.box(0.66, 0.55, 0.1, SEAT_UP, sx, 2.68, z - 0.32, NO, -0.08);
      }
      sideWin(up, 2.62, roof0, zb + 0.3, zf - 0.08, [], 1.5);
      // the panoramic upper front window
      const py0 = 2.66, py1 = roof0 - 0.06;
      up.box(2.46, 0.07, 0.08, FRAME, 0, py0 - 0.04, zf);
      up.box(2.46, 0.08, 0.08, FRAME, 0, py1 - 0.02, zf);
      for (const s of [1, -1]) up.box(0.08, py1 - py0, 0.08, FRAME, s * 1.2, py0, zf);
      up.glass(2.34, py1 - py0, 0.03, 0, py0, zf + 0.01);
      // staircase: steps rising from the back towards the front, on the driver's (-x) side
      const n = 9, s0 = zb + 0.45, s1 = zb + 2.75;
      for (let i = 0; i < n; i++) {
        const z = s0 + (s1 - s0) * i / (n - 1), top = FLOOR_Y + (2.5 - FLOOR_Y) * (i + 1) / n;
        low.box(0.72, top - FLOOR_Y, (s1 - s0) / (n - 1) + 0.02, '#9a92a4', -0.72, FLOOR_Y, z);
        low.box(0.72, 0.03, 0.06, '#ffd45c', -0.72, top - 0.01, z + (s1 - s0) / (n - 1) / 2);
      }
      low.box(0.05, 1.6 - FLOOR_Y + 0.9, 0.05, '#ffd45c', -0.34, FLOOR_Y, s1);                 // a yellow grab pole
    }

    // --- roof: rounded, with an air-con pod and a cream ceiling inside
    up.add(slab(2.5, roof0, roof1, 0.46, 0.04, L), '~#ffffff');
    up.box(2.3, 0.03, L - 0.3, CEIL, 0, roof0 - 0.04, 0);
    const podZ = spec.podZ != null ? spec.podZ : -L * 0.12, podL = spec.podL || L * 0.3;
    up.box(1.5, 0.3, podL, '#f1ebe0', 0, roof1 - 0.06, podZ);
    up.box(1.2, 0.08, podL - 0.3, '#ffffff', 0, roof1 + 0.24, podZ);
    for (let k = 0; k < 3; k++) up.box(0.9, 0.02, 0.18, '#cfc7b8', 0, roof1 + 0.32, podZ - podL / 3 + k * podL / 3);

    // --- kerb-side route display (beside the front door, at the top of the windows)
    if (hasFront) {
      const d0 = spec.doors[0], zc = d0.z - d0.w / 2 - 0.9, y = winTop - 0.36;
      up.box(0.05, 0.3, 1.5, '#211e25', 1.24, y, zc);
      up.sign(0.4, 0.24, UV_NUM, 1.27, y + 0.15, zc + 0.52, Math.PI / 2);
      up.sign(0.98, 0.22, UV_DEST, 1.27, y + 0.15, zc - 0.2, Math.PI / 2);
    } else if (spec.role === 'rear') {
      const zc = -0.5, y = winTop - 0.36;
      low.box(0.05, 0.3, 0.6, '#211e25', 1.24, y, zc);
      low.sign(0.44, 0.24, UV_NUM, 1.27, y + 0.15, zc, Math.PI / 2);
    }

    // --- glass doors (kerb side), two glass leaves each. The front door's leaves both slide back along the side
    //     (the front one over the other, so nothing pokes past the nose); the other doors part both ways.
    const doors = [];
    spec.doors.forEach((d, di) => {
      const k = spec.see ? up : low, lw = d.w / 2, idx = di + 1, h0 = SKIRT0 + 0.08, h1 = doorTop;
      for (const sgn of [-1, 1]) {
        const zc = d.z + sgn * lw / 2;
        const o = di === 0 && hasFront ? { door: idx, dk: sgn < 0 ? -lw : -2 * lw, outer: sgn > 0 } : { door: idx, dk: sgn * lw };
        k.box(0.05, 0.06, lw, FRAME, 1.27, h0, zc, o);
        k.box(0.05, 0.06, lw, FRAME, 1.27, h1 - 0.06, zc, o);
        k.box(0.05, h1 - h0, 0.06, FRAME, 1.27, h0, zc + sgn * (lw / 2 - 0.03), o);
        k.box(0.06, h1 - h0, 0.05, RUBBER, 1.275, h0, zc - sgn * (lw / 2 - 0.025), o);
        k.box(0.05, 0.05, lw, '#c9c3cf', 1.275, 1.12, zc, o);                                     // handrail
        k.glass(0.025, h1 - h0 - 0.1, lw - 0.1, 1.265, h0 + 0.05, zc, o);
      }
      const proxy = new THREE.Object3D(); proxy.name = 'door' + idx;
      proxy.position.set(1.27, 0.5, d.z); proxy.userData = { x: 1.27, z: d.z, w: d.w };
      g.add(proxy);
      doors.push({ proxy, d, idx, kit: k });
    });

    // --- bendy: the accordion (half on each carriage, so it bends with no gap), merged into the carriage
    if (spec.joint) {
      const hz = spec.joint.z, side = spec.joint.side;
      for (let k = 0; k < 3; k++) low.add(slab(2.3, 0.5, 2.95, 0.4, 0.1, 0.13, 0.04), k % 2 ? '#5d5466' : '#463e50', 0, 0, hz + side * (0.08 + k * 0.17));
      low.box(2.0, 0.08, 0.55, '#6c6470', 0, 0.5, hz + side * 0.27);
    }

    if (opts.bumpers) {
      if (hasFront) addBumper(low, zf, 1);
      if (hasRear) addBumper(low, zb, -1);
    }

    // --- meshes
    const lowMat = busMaterial(shared, false);
    const lowMesh = new THREE.Mesh(low.geometry(), lowMat); lowMesh.name = 'body';
    g.add(lowMesh);
    let upMesh = null, upMat = null;
    if (spec.see) {
      upMat = busMaterial(shared, true);
      upMesh = new THREE.Mesh(up.geometry(), upMat); upMesh.name = 'upper'; upMesh.renderOrder = 3;
      g.add(upMesh);
    }
    // door uniforms follow the proxies just before each draw
    const doorsOn = (mesh, mat) => {
      const mine = doors.filter((d) => (d.kit === up && mesh === upMesh) || (d.kit === low && mesh === lowMesh));
      if (!mine.length) return;
      mesh.onBeforeRender = () => {
        const u = mat.userData.doorU.value;
        for (const d of mine) {
          const p = d.proxy, open = Math.max(0, Math.min(1, (p.position.z - p.userData.z) / DOOR_SLIDE)), dx = p.position.x - p.userData.x;
          if (d.idx === 1) { u.x = dx; u.y = open; } else { u.z = dx; u.w = open; }
        }
      };
    };
    doorsOn(lowMesh, lowMat); if (upMesh) doorsOn(upMesh, upMat);

    // wheels (one mesh per axle, spinning about x; bus.js may swap the geometry for its part wheels) and hubs
    const wheels = [], steer = [], hubs = [];
    for (const z of spec.axles) {
      const wm = new THREE.Mesh(wheelGeometry(), BB.mk.mat); wm.name = 'wheels';
      wm.position.set(0, TYRE_R, z); wm.rotation.order = 'YXZ';
      g.add(wm); wheels.push(wm);
      if (z === spec.steerZ) steer.push(wm);
      const hub = new THREE.Group(); hub.name = 'wheelHub'; hub.position.set(0, TYRE_R, z); g.add(hub); hubs.push(hub);
    }
    let blob = null;
    if (opts.shadow !== false && BB.mk.blob) { blob = BB.mk.blob(3.6, L + 1.6); blob.position.y = 0.08; g.add(blob); }

    return { g, L, zf, zb, lowMesh, upMesh, mats: [lowMat, upMat].filter(Boolean), seats, doors, wheels, steer, hubs, blob, roof1, roof0, winTop };
  }

  // ---------- the three types ----------
  const SPECS = {
    bendy: {
      LF: 7.4, LR: 6.0, GAP: 1.0,
      front: { L: 7.4, role: 'front', deck: 1, axles: [1.7, -1.9], steerZ: 1.7, doors: [{ z: 3.0, w: 1.1 }], seatsZ: [1.75, 0.65, -0.45, -1.55, -2.65], see: true, podZ: -0.4, podL: 2.4 },
      rear: { L: 6.0, role: 'rear', deck: 1, axles: [-1.2], steerZ: null, doors: [{ z: 1.4, w: 1.1 }], seatsZ: null, see: false, podZ: 1.55, podL: 1.6 },
    },
    single: { L: 10.8, role: 'solo', deck: 1, axles: [3.3, -2.7], steerZ: 3.3, doors: [{ z: 4.55, w: 1.1 }, { z: -0.35, w: 1.15 }], seatsZ: [2.4, 1.3, 0.2, -0.9, -2.0], see: true, podZ: 1.6, podL: 2.6 },
    double: { L: 10.8, role: 'solo', deck: 2, axles: [3.3, -2.3, -3.45], steerZ: 3.3, doors: [{ z: 4.55, w: 1.1 }, { z: -0.35, w: 1.15 }], seatsZ: [2.4, 1.3, 0.2, -0.9, -2.0], see: true, podZ: -4.3, podL: 1.6 },
  };

  function anchor(parent, x, y, z, ry, rx, size) {
    const o = new THREE.Object3D(); o.position.set(x, y, z); o.rotation.set(rx || 0, ry, 0, 'YXZ'); o.userData.size = size; parent.add(o); return o;
  }

  function build(type, paintColour, opts) {
    opts = opts || {};
    if (!SPECS[type]) type = 'bendy';
    const sign = makeSign();
    const shared = { paint: new THREE.Color(paintColour || (BB.P && BB.P.busGreen) || '#3fae49'), lamp: { value: 1 }, tex: sign.tex };
    let F, R = null, spec;
    if (type === 'bendy') {
      spec = SPECS.bendy;
      const hitchF = -(spec.LF / 2 + spec.GAP / 2), hitchR = spec.GAP / 2 + spec.LR / 2;
      F = carriage(Object.assign({ joint: { z: hitchF, side: 1 } }, spec.front), shared, opts);
      R = carriage(Object.assign({ joint: { z: hitchR, side: -1 } }, spec.rear), shared, opts);
      F.hitch = hitchF; R.hitch = hitchR;
    } else {
      spec = SPECS[type];
      F = carriage(spec, shared, opts);
    }
    F.g.name = type + ':front'; if (R) R.g.name = type + ':rear';
    const last = R || F;

    // part mounts: origin on the ground at the nose / tail face centre, local +z pointing outwards
    const mount = (parent, name, x, y, z, ry) => { const m = new THREE.Group(); m.name = name; m.position.set(x, y, z); m.rotation.y = ry || 0; parent.add(m); return m; };
    const sx = WIDTH / 2.5;
    const partMounts = {
      lightsFront: mount(F.g, 'lightsFront', 0, 0, F.zf),
      bumperFront: mount(F.g, 'bumperFront', 0, 0, F.zf),
      bumperRear: mount(last.g, 'bumperRear', 0, 0, last.zb, Math.PI),
      // on the roof's front edge; on the see-through upper mesh so it hides with the roof in the cut-away view
      roofFront: mount(F.upMesh || F.g, 'roofFront', 0, F.roof1, F.zf),
      underglow: mount(F.g, 'underglow', 0, 0.06, 0),
      underglowRear: R ? mount(R.g, 'underglowRear', 0, 0.06, 0) : null,
      wheelHubs: F.hubs.concat(R ? R.hubs : []),
    };
    partMounts.bumperFront.scale.x = partMounts.bumperRear.scale.x = sx;
    partMounts.underglow.userData = { length: F.L, width: WIDTH };
    if (R) partMounts.underglowRear.userData = { length: R.L, width: WIDTH };
    partMounts.lightsFront.userData = { headlightY: 0.62, windscreenBottom: 1.0, roofY: F.roof1 };

    // sticker anchors: slot 0 front sides, slot 1 rear sides, slot 2 the super spot on the roof
    let stickerAnchors;
    if (type === 'bendy') {
      stickerAnchors = [
        [anchor(F.g, 1.27, 0.98, -0.1, Math.PI / 2, 0, 1.05), anchor(F.g, -1.27, 0.98, -0.1, -Math.PI / 2, 0, 1.05)],
        [anchor(R.g, 1.27, 0.98, -2.42, Math.PI / 2, 0, 0.95), anchor(R.g, -1.27, 0.98, -2.42, -Math.PI / 2, 0, 0.95)],
        [anchor(R.g, 0, R.roof1 + 0.012, -1.2, 0, -Math.PI / 2, 2.0)],
      ];
    } else if (type === 'single') {
      stickerAnchors = [
        [anchor(F.g, 1.27, 0.98, 1.4, Math.PI / 2, 0, 1.05), anchor(F.g, -1.27, 0.98, 1.4, -Math.PI / 2, 0, 1.05)],
        [anchor(F.g, 1.27, 0.98, -4.35, Math.PI / 2, 0, 1.0), anchor(F.g, -1.27, 0.98, -4.35, -Math.PI / 2, 0, 1.0)],
        [anchor(F.upMesh, 0, F.roof1 + 0.012, -2.4, 0, -Math.PI / 2, 2.2)],
      ];
    } else {
      stickerAnchors = [
        [anchor(F.g, 1.27, 0.98, 1.4, Math.PI / 2, 0, 1.05), anchor(F.g, -1.27, 0.98, 1.4, -Math.PI / 2, 0, 1.05)],
        [anchor(F.upMesh, 1.27, 1.6, -4.15, Math.PI / 2, 0, 1.1), anchor(F.upMesh, -1.27, 1.6, -4.15, -Math.PI / 2, 0, 1.1)],
        [anchor(F.upMesh, 0, F.roof1 + 0.012, -1.4, 0, -Math.PI / 2, 2.2)],
      ];
    }

    const doors = [];
    for (const d of F.doors) doors.push({ mesh: d.proxy, z: d.d.z, w: d.d.w, carriage: 0, slide: DOOR_SLIDE });
    if (R) for (const d of R.doors) doors.push({ mesh: d.proxy, z: d.d.z, w: d.d.w, carriage: 1, slide: DOOR_SLIDE });
    const d0 = F.doors[0].d;
    const mats = F.mats.concat(R ? R.mats : []);
    sign.setNumber(opts.number != null ? opts.number : '10');

    const axlesF = spec === SPECS.bendy ? spec.front.axles : spec.axles;
    const out = {
      type,
      carriages: [F.g, R ? R.g : null],
      jointGroup: null,                      // the accordion is merged into the two carriages (see header notes)
      hitch: R ? { front: { z: F.hitch }, rear: { z: R.hitch } } : null,
      length: F.L, lengthRear: R ? R.L : 0, width: WIDTH, height: F.roof1,
      axles: { front: axlesF.slice(), rear: R ? SPECS.bendy.rear.axles.slice() : [] },
      wheels: { front: F.wheels, rear: R ? R.wheels : [], steer: F.steer, radius: TYRE_R },
      doors,
      seatsLocal: F.seats,
      doorLocal: { x: 1.6, y: 0, z: d0.z },
      roofParts: [F.upMesh],
      stickerAnchors,
      partMounts,
      shadows: [F.blob, R && R.blob].filter(Boolean),
      routeSign: { setNumber: sign.setNumber, setDest: sign.setDest, get number() { return sign.number; } },
      paintMaterial: F.mats[0],
      materials: mats,
      setPaint(c) { shared.paint.set(c); },
      setLights(on) { shared.lamp.value = on ? 1 : 0.12; },
      // the upper mesh's material, for fading the roof (opacity) instead of hiding it
      roofMaterial: F.upMesh ? F.upMesh.material : null,
      dispose() {
        for (const car of [F, R]) {
          if (!car) continue;
          car.lowMesh.geometry.dispose(); if (car.upMesh) car.upMesh.geometry.dispose();
          for (const w of car.wheels) w.geometry.dispose();
          if (car.blob) { car.blob.geometry.dispose(); car.blob.material.dispose(); }
          if (car.g.parent) car.g.parent.remove(car.g);
        }
        for (const m of mats) m.dispose();
        sign.tex.dispose();
      },
    };
    // wheelbase of the front carriage (front axle to the first rear axle), for the driving controller
    out.wheelbase = axlesF[0] - axlesF[1];
    return out;
  }

  // A static whole bus in one Group, centred on its length (for the garage's bus-type tiles).
  function preview(type, paintColour, number) {
    const b = build(type, paintColour, { bumpers: true, number: number != null ? number : '10' });
    const g = new THREE.Group(); g.name = 'preview:' + b.type;
    const [F, R] = b.carriages;
    g.add(F);
    let minZ = -b.length / 2;
    const maxZ = b.length / 2;
    if (R) { R.position.z = b.hitch.front.z - b.hitch.rear.z; g.add(R); minZ = R.position.z - b.lengthRear / 2; }
    const total = maxZ - minZ, shift = -(maxZ + minZ) / 2;
    for (const c of g.children) c.position.z += shift;
    g.userData = { length: total, height: b.height, bus: b, dispose: b.dispose };
    return g;
  }

  BB.fleet = {
    TYPES: ['bendy', 'double', 'single'],
    NAMES: { bendy: 'Bendy bus', double: 'Double-decker', single: 'Single-decker' },
    build, preview,
  };
})();
