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
   Also five other vehicles kids can drive (taxi, fire engine, ambulance, ice cream van, tow truck), see VEHICLES.
   Exposes BB.fleet = { TYPES, NAMES, KIND, PAINT, build(type, paint, opts), preview(type, paint), dims(type) }. Conventions as bus.js:
   forward +z, y up, ground y = 0 under the wheels, width 2.5. */
(function () {
  'use strict';
  const BB = window.BB = window.BB || {};

  // ---------- sizes and colours ----------
  const HW = 1.25, WIDTH = 2.5, TYRE_R = 0.52, WHEEL_X = 1.08;
  const SKIRT0 = 0.36, FLOOR_Y = 0.66, WAIST = 1.32;
  const FRAME = '#33303a', RUBBER = '#26232b', GLASS = '#d6f1fb', GLASS_A = 0.34, GLASS_OPAQUE = '#86a3b6';
  // ('&' = lit by the cabin lights at night, see setCabinLight)
  const FLOOR = '&#8f8699', LINING = '&#efe6d6', ARCH = '#3f3744', HOUSING = '&#7a7284', CEIL = '&#f4eee2';
  const SEAT_A = '&#4f8fe0', SEAT_B = '&#f29a3a', SEAT_UP = '&#6f86c9', CABIN_LAMP = '^#fff1c8';
  const LAMP_HEAD = '*#fff6c8', LAMP_IND = '*#ffae3a', LAMP_TAIL = '*#ff4a3a', LAMP_REV = '*#fbf3e0';
  const DOOR_SLIDE = 1.1;          // how far bus.js moves a door proxy along +z when the door is fully open
  // Row 2 (seats 5-9, the far side) sits on a step this high and half a seat along, so from the kerb, a little
  // raised, its heads show clearly above and between row 1's: a ten-frame seen from the side.
  const RAISE = 0.76, SEAT_Y = 0.39;   // seat anchor (a passenger's middle) above the floor it sits on
  // LED sign texture (256 x 64): route number on the left, destination dots on the right, and a white block in the
  // top-right corner that every other vertex samples (so the map leaves ordinary surfaces untouched).
  const TEX_W = 256, TEX_H = 64;
  const UV_WHITE = [252 / TEX_W, 1 - 4 / TEX_H];
  const UV_NUM = [2 / TEX_W, 2 / TEX_H, 94 / TEX_W, 62 / TEX_H], UV_DEST = [100 / TEX_W, 6 / TEX_H, 244 / TEX_W, 58 / TEX_H];

  // ---------- part collector: merges parts into one flat-shaded geometry with paint/glow/door/uv attributes ----------
  // Colour strings: '#rrggbb' plain, '~#rrggbb' paint (the paint colour times this shade: '~#ffffff' = the paint,
  // '~#b0b0b0' a deeper tone of it), '*#rrggbb' a lamp (glows while the lights are on), '!#rrggbb' / '%#rrggbb'
  // light-bar lamps of group A / B (they flash in turn while the siren is on, day or night), and for the cabin lights
  // (setCabinLight): '^#rrggbb' a cabin lamp strip, '&#rrggbb' an inside surface they light, '@#rrggbb' window glass
  // that glows warm from inside.
  // Options o: { a: alpha (glass), door: 1 | 2 (door number), dk: the leaf's slide along z when fully open (signed),
  //   outer: true for a leaf that slides over the other one (it pops out further), uv: [u0,v0,u1,v1] }.
  const NO = {};
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const colCache = {};
  function parseCol(c) {
    if (colCache[c]) return colCache[c];
    const paint = c[0] === '~' ? 1 : 0, glow = { '*': 1, '!': 2, '%': 3, '^': 4, '&': 5, '@': 6 }[c[0]] || 0;
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
      if (this.opaqueGlass) return this.box(w, h, d, '@' + GLASS_OPAQUE, x, y, z, o || NO);
      return this.box(w, h, d, '@' + GLASS, x, y, z, Object.assign({ a: GLASS_A }, o || NO));
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
      sh.uniforms.uLamp = shared.lamp; sh.uniforms.uDoor = doorU; sh.uniforms.uSiren = shared.siren; sh.uniforms.uCabin = shared.cabin;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPaint;\nattribute float aGlow;\nattribute float aDoor;\nattribute float aDoorK;\nuniform vec4 uDoor;\nuniform float uLamp;\nuniform vec2 uSiren;\nuniform float uCabin;\nvarying float vPaint;\nvarying float vGlow;\nvarying float vWarm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaint = aPaint; vWarm = 0.0; vGlow = aGlow < 1.5 ? aGlow * uLamp : aGlow < 2.5 ? uSiren.x : aGlow < 3.5 ? uSiren.y : aGlow < 4.5 ? uCabin * 1.2 : aGlow < 5.5 ? uCabin * 0.42 : 0.0;\nif (aGlow > 5.5) vWarm = uCabin;\nif (aDoor > 0.5) { float id = floor(aDoor + 0.01); vec2 dd = id < 1.5 ? uDoor.xy : uDoor.zw; transformed.x += dd.x + dd.y * (0.06 + (aDoor - id) * 0.16); transformed.z += aDoorK * dd.y; }');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPaint;\nvarying float vGlow;\nvarying float vWarm;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( mix( vec3( 1.0 ), diffuse, vPaint ), opacity );')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow + vec3(1.0, 0.8, 0.48) * vWarm * 0.75;\ndiffuseColor.a = mix(diffuseColor.a, max(diffuseColor.a, 0.55), vWarm);\ndiffuseColor.rgb *= 1.0 - 0.55 * min(vGlow, 1.0);');
    };
    m.userData.doorU = doorU;
    return m;
  }

  // Adds this vehicle's cabin light to another material (passengers inside): a warm glow scaled by the level.
  function cabinPatch(mat, cabinU) {
    if (!mat || mat.userData.cabinPatched) return mat;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.uniforms.uCabin = cabinU;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uCabin;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uCabin * 0.45;');
    };
    const prevKey = mat.customProgramCacheKey.bind(mat);
    mat.customProgramCacheKey = () => prevKey() + '|cabin';
    mat.userData.cabinPatched = true; mat.needsUpdate = true;
    return mat;
  }

  // ---------- LED sign texture (one small canvas per bus) ----------
  // mode 'plate' (the other vehicles): the number region is a number plate, the right part a lit label (taxi sign)
  function makeSign(mode, label, labelBg) {
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
    let num = '', dest = mode === 'plate' ? (label || '') : 'Interchange';
    const fit = (str, X, Y, W, H, font, col) => {
      x.save(); x.font = font; x.fillStyle = col; x.textAlign = 'center'; x.textBaseline = 'middle';
      const k = Math.min(1, (W - 6) / Math.max(1, x.measureText(str).width));
      x.translate(X + W / 2, Y + H / 2 + 2); x.scale(k, 1); x.fillText(str, 0, 0); x.restore();
    };
    const draw = () => {
      if (mode === 'plate') {
        x.fillStyle = labelBg || '#fff3c4'; x.fillRect(0, 0, TEX_W, TEX_H);
        x.fillStyle = '#26232b'; x.fillRect(0, 0, 96, TEX_H);
        x.fillStyle = '#fbf7ee'; x.fillRect(4, 6, 88, TEX_H - 12);
        fit(num, 4, 6, 88, TEX_H - 12, 'bold 40px sans-serif', '#26232b');
        if (dest) fit(dest, 100, 4, 144, 56, 'bold 42px sans-serif', '#26232b');
        x.fillStyle = '#ffffff'; x.fillRect(TEX_W - 10, 0, 10, 10);
        tex.needsUpdate = true;
        return;
      }
      x.fillStyle = '#17151b'; x.fillRect(0, 0, TEX_W, TEX_H);
      dots(num, 2, 2, 92, 60, 4, 'bold 15px sans-serif');
      dots(dest, 100, 8, 144, 48, 3, 'bold 12px sans-serif');
      x.fillStyle = '#ffffff'; x.fillRect(TEX_W - 10, 0, 10, 10);       // the white block (UV_WHITE)
      tex.needsUpdate = true;
    };
    return {
      tex,
      setNumber(str) { num = String(str == null ? '' : str).replace(/[^0-9A-Za-z]/g, '').slice(0, mode === 'plate' ? 5 : 3); draw(); },
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
  // A roof piece from x0 to x1 (square bottom), top corners rounded by rL (left, -x) and rR (right, +x).
  function roofPiece(x0, x1, y0, y1, rL, rR, len, bevel = 0.1) {
    const s = new THREE.Shape(), a = x0 + bevel, b = x1 - bevel, lo = y0 + bevel, hi = y1 - bevel;
    s.moveTo(a, lo); s.lineTo(b, lo); s.lineTo(b, hi - rR); if (rR) s.quadraticCurveTo(b, hi, b - rR, hi);
    s.lineTo(a + rL, hi); if (rL) s.quadraticCurveTo(a, hi, a, hi - rL); s.lineTo(a, lo);
    const g = new THREE.ExtrudeGeometry(s, { depth: len - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 2 });
    g.translate(0, 0, -(len - 2 * bevel) / 2);
    return g;
  }
  const SPLIT = -0.35;             // the kerb-side half of the roof / upper floor (x > SPLIT) belongs to the kerb wall mesh
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
  function wheelGeometry(R = TYRE_R, X = WHEEL_X, Wd = 0.36) {
    const b = BB.mk.builder();
    for (const s of [-1, 1]) {
      const x = s * X, face = x + s * (Wd / 2 + 0.01), rr = R * 0.55;
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
    // kerb: the kerb-side (+x) wall above the sill of the seated (lower) deck, a mesh of its own so the stop's side
    // view can fade it away like a dollhouse
    const kerb = spec.seatsZ ? new Kit(false) : up;
    // tall enough inside for row 2's heads on their step
    const winTop = 2.84, deck2 = winTop + 0.36, upF = deck2 - 0.12;
    const roof0 = dbl ? deck2 + 0.98 : winTop, roof1 = roof0 + (dbl ? 0.68 : 0.72);
    const doorTop = winTop - 0.08;
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
      // row 2 stands on a raised step along the far (-x) side, with a yellow edge
      const sh = spec.row2Shift || 0, pz0 = Math.min(spec.seatsZ[4], spec.seatsZ[4] + sh) - 0.45, pz1 = Math.max(spec.seatsZ[0], spec.seatsZ[0] + sh) + 0.42;
      low.box(0.94, RAISE, pz1 - pz0, '#9a92a4', -0.71, FLOOR_Y, (pz0 + pz1) / 2);
      low.box(0.05, 0.05, pz1 - pz0, '#ffd45c', -0.24, FLOOR_Y + RAISE - 0.04, (pz0 + pz1) / 2);
      low.box(0.03, RAISE - 0.06, pz1 - pz0 - 0.1, '#857d90', -0.23, FLOOR_Y, (pz0 + pz1) / 2);
      for (let i = 0; i < 10; i++) {
        const sx = i < 5 ? 0.6 : -0.6, z = spec.seatsZ[i % 5] + (i < 5 ? 0 : sh), col = i < 5 ? SEAT_A : SEAT_B, fy = FLOOR_Y + (i < 5 ? 0 : RAISE);
        low.box(0.34, 0.08, 0.3, '#5a5260', sx, fy, z);
        low.box(0.66, 0.12, 0.58, col, sx, fy + 0.06, z);
        low.box(0.66, 0.62, 0.1, col, sx, fy + 0.18, z - 0.33, NO, -0.08);
        low.box(0.06, 0.06, 0.12, '#c9c3cf', sx + (i < 5 ? -0.34 : 0.34), fy + 0.75, z - 0.33);  // grab handle
        seats.push({ x: sx, y: fy + SEAT_Y, z });
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
      // the front route display: above the windscreen (single, bendy) or between the decks (double-decker)
      const dy = winTop + 0.02;
      up.box(2.24, 0.34, 0.06, '#211e25', 0, dy, FZ + 0.01);
      up.sign(0.52, 0.28, UV_NUM, -0.78, dy + 0.17, FZ + 0.045);
      up.sign(1.5, 0.26, UV_DEST, 0.26, dy + 0.17, FZ + 0.045);
      // mirrors on arms ("rabbit ears"): from the top corners, forward, hanging in front of the windscreen corners
      const ay = dbl ? winTop + 0.22 : roof0 + 0.08;
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
      const panelTop = dbl ? deck2 : 1.42;
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
      const ry0 = dbl ? deck2 + 0.16 : 1.46, ry1 = dbl ? roof0 - 0.14 : winTop - 0.1;
      // the painted rear wall around the window (pieces, so the glass stays see-through)
      const wz = BZ + 0.05;
      up.box(2.46, ry0 - panelTop + 0.02, 0.1, '~#ffffff', 0, panelTop - 0.02, wz);
      up.box(2.46, roof0 - ry1, 0.1, '~#ffffff', 0, ry1, wz);
      for (const s of [1, -1]) up.box(0.26, ry1 - ry0, 0.1, '~#ffffff', s * 1.1, ry0, wz);
      up.box(2.0, 0.06, 0.07, FRAME, 0, ry0 - 0.03, BZ - 0.01); up.box(2.0, 0.06, 0.07, FRAME, 0, ry1 - 0.03, BZ - 0.01);
      for (const s of [1, -1]) up.box(0.06, ry1 - ry0, 0.07, FRAME, s * 0.97, ry0, BZ - 0.01);
      up.glass(1.9, ry1 - ry0 - 0.02, 0.03, 0, ry0 + 0.01, BZ - 0.035);
      // rear route number
      const rny = dbl ? winTop + 0.12 : roof1 - 0.5;
      (dbl ? low : up).box(0.66, 0.3, 0.05, '#211e25', 0, rny, BZ - 0.02);
      (dbl ? low : up).sign(0.56, 0.24, UV_NUM, 0, rny + 0.15, BZ - 0.05, Math.PI);
    }

    // --- side windows: framed glass with pillars; the doors get glass leaves instead
    const sideWin = (k, yb, yt, z0, z1, gapsPlus, barPitch, kPlus) => {
      for (const s of [1, -1]) {
        const k0 = k; k = s > 0 && kPlus ? kPlus : k0;
        for (const [a, b] of cut(z0, z1, s > 0 ? gapsPlus : [])) {
          const n = Math.max(1, Math.round((b - a) / barPitch)), zc = (a + b) / 2;
          k.glass(0.03, yt - yb, b - a, s * 1.215, yb, zc);
          k.box(0.06, 0.06, b - a, FRAME, s * 1.235, yb, zc);
          k.box(0.06, 0.07, b - a, FRAME, s * 1.235, yt - 0.07, zc);
          for (let i = 0; i <= n; i++) k.box(0.07, yt - yb, 0.11, FRAME, s * 1.232, yb, a + (b - a) * i / n + (i === 0 ? 0.05 : i === n ? -0.05 : 0));
        }
        k = k0;
      }
    };
    const sz0 = zb + 0.16, sz1 = zf - 0.16;
    if (!dbl) sideWin(up, WAIST, winTop, sz0, sz1, doorGaps, 1.35, kerb);
    else {
      sideWin(up, WAIST, winTop, zb + 2.5, sz1, doorGaps, 1.35, kerb);                   // lower deck (solid at the back)
      for (const s of [1, -1]) {
        (s > 0 ? kerb : up).box(0.06, winTop - WAIST, 2.5 - 0.12, '~#ffffff', s * 1.22, WAIST, zb + 0.06 + 1.19);
        (s > 0 ? kerb : up).box(0.04, winTop - WAIST, 2.5 - 0.12, LINING, s * 1.17, WAIST, zb + 0.06 + 1.19);
      }
    }
    // headers above the doors
    for (const d of spec.doors) up.box(0.06, winTop - doorTop, d.w + 0.12, FRAME, 1.235, doorTop, d.z);

    // --- double-decker: band between the decks, upper floor, upper deck seats and windows, panoramic front window,
    //     and a staircase at the back on the right (it stays in the cut-away view as a hint)
    if (dbl) {
      for (const s of [1, -1]) {
        const k = s > 0 ? kerb : up;
        k.box(0.06, deck2 - winTop, L - 0.24, '~#ffffff', s * 1.22, winTop, 0);
        k.box(0.03, 0.12, L - 0.4, '#fff6e0', s * 1.255, winTop + 0.12, 0);
      }
      up.box(2.46, deck2 + 0.04 - winTop, 0.1, '~#ffffff', 0, winTop, zf - 0.05);                      // front band behind the display
      // upper floor (stairwell left open); its kerb half goes with the kerb wall so row 2 shows in the side view
      up.box(SPLIT + 1.17, 0.08, L - 3.0, FLOOR, (SPLIT - 1.17) / 2, upF, 1.25);
      kerb.box(1.17 - SPLIT, 0.08, L - 3.0, FLOOR, (SPLIT + 1.17) / 2, upF, 1.25);
      kerb.box(1.1, 0.08, 2.6, FLOOR, 0.62, upF, zb + 1.5);
      for (let i = 0; i < 6; i++) for (const sx of [0.6, -0.6]) {
        const z = zf - 1.3 - i * 1.25;
        if (sx < 0 && z < zb + 2.9) continue;
        const k = sx > 0 ? kerb : up;
        k.box(0.66, 0.1, 0.56, SEAT_UP, sx, upF + 0.08, z);
        k.box(0.66, 0.55, 0.1, SEAT_UP, sx, upF + 0.18, z - 0.32, NO, -0.08);
      }
      sideWin(up, deck2, roof0, zb + 0.3, zf - 0.08, [], 1.5, kerb);
      // the panoramic upper front window
      const py0 = deck2 + 0.04, py1 = roof0 - 0.06;
      up.box(2.46, 0.07, 0.08, FRAME, 0, py0 - 0.04, zf);
      up.box(2.46, 0.08, 0.08, FRAME, 0, py1 - 0.02, zf);
      for (const s of [1, -1]) up.box(0.08, py1 - py0, 0.08, FRAME, s * 1.2, py0, zf);
      up.glass(2.34, py1 - py0, 0.03, 0, py0, zf + 0.01);
      // staircase: steps rising from the back towards the front, on the driver's (-x) side
      const n = 9, s0 = zb + 0.45, s1 = zb + 2.75;
      for (let i = 0; i < n; i++) {
        const z = s0 + (s1 - s0) * i / (n - 1), top = FLOOR_Y + (upF - FLOOR_Y) * (i + 1) / n;
        low.box(0.72, top - FLOOR_Y, (s1 - s0) / (n - 1) + 0.02, '#9a92a4', -0.72, FLOOR_Y, z);
        low.box(0.72, 0.03, 0.06, '#ffd45c', -0.72, top - 0.01, z + (s1 - s0) / (n - 1) / 2);
      }
      low.box(0.05, 1.6 - FLOOR_Y + 0.9, 0.05, '#ffd45c', -0.34, FLOOR_Y, s1);                 // a yellow grab pole
    }

    // --- roof: rounded, with an air-con pod and a cream ceiling inside
    // (on the seated carriage the kerb half of the roof, with the pod, is part of the kerb wall mesh)
    const split = kerb !== up;
    if (split) {
      up.add(roofPiece(-HW, SPLIT, roof0, roof1, 0.46, 0, L), '~#ffffff');
      kerb.add(roofPiece(SPLIT, HW, roof0, roof1, 0, 0.46, L), '~#ffffff');
      up.box(SPLIT + 1.15, 0.03, L - 0.3, CEIL, (SPLIT - 1.15) / 2, roof0 - 0.04, 0);
      kerb.box(1.15 - SPLIT, 0.03, L - 0.3, CEIL, (SPLIT + 1.15) / 2, roof0 - 0.04, 0);
    } else {
      up.add(slab(2.5, roof0, roof1, 0.46, 0.04, L), '~#ffffff');
      up.box(2.3, 0.03, L - 0.3, CEIL, 0, roof0 - 0.04, 0);
    }
    // cabin light strips along the ceiling (and under the upper floor on the double-decker); they glow at night
    for (const x of [-0.62, 0.62]) {
      const k = split && x > SPLIT ? kerb : up;
      k.box(0.14, 0.03, L - 1.2, CABIN_LAMP, x, roof0 - 0.075, 0);
      if (dbl) k.box(0.14, 0.03, L - 1.6, CABIN_LAMP, x, upF - 0.035, 0.5);
    }
    const podZ = spec.podZ != null ? spec.podZ : -L * 0.12, podL = spec.podL || L * 0.3, pk = split ? kerb : up;
    pk.box(1.5, 0.3, podL, '#f1ebe0', 0, roof1 - 0.06, podZ);
    pk.box(1.2, 0.08, podL - 0.3, '#ffffff', 0, roof1 + 0.24, podZ);
    for (let k = 0; k < 3; k++) pk.box(0.9, 0.02, 0.18, '#cfc7b8', 0, roof1 + 0.32, podZ - podL / 3 + k * podL / 3);

    // --- kerb-side route display (beside the front door, at the top of the windows)
    if (hasFront) {
      const d0 = spec.doors[0], zc = d0.z - d0.w / 2 - 0.9, y = winTop - 0.36;
      kerb.box(0.05, 0.3, 1.5, '#211e25', 1.24, y, zc);
      kerb.sign(0.4, 0.24, UV_NUM, 1.27, y + 0.15, zc + 0.52, Math.PI / 2);
      kerb.sign(0.98, 0.22, UV_DEST, 1.27, y + 0.15, zc - 0.2, Math.PI / 2);
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
      for (let k = 0; k < 3; k++) low.add(slab(2.3, 0.5, roof1 - 0.15, 0.4, 0.1, 0.13, 0.04), k % 2 ? '#5d5466' : '#463e50', 0, 0, hz + side * (0.08 + k * 0.17));
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
    let kerbMesh = null, kerbMat = null;
    if (kerb !== up) {
      kerbMat = busMaterial(shared, true);
      kerbMesh = new THREE.Mesh(kerb.geometry(), kerbMat); kerbMesh.name = 'kerbWall'; kerbMesh.renderOrder = 3;
      upMesh.add(kerbMesh);              // a child of the upper mesh: hiding roofParts hides it too
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
    // windscreen wipers: two pivots (at the bottom of the glass, the arm points up along local +y, rotation.z sweeps;
    // at rest they lie along the bottom pointing towards +x), both drawn by one small mesh
    const wipers = [];
    if (hasFront) {
      const wb = BB.mk.builder();
      wb.box(0.045, 0.06, 0.04, RUBBER, 0, -0.03, 0);
      wb.box(0.03, 0.82, 0.03, '#3a3640', 0, 0, 0.0);
      wb.box(0.05, 0.78, 0.035, RUBBER, 0, 0.06, 0.03);
      const REST = -1.42, X = [-1.0, 0.18], arm = wb.geometry(), n = arm.attributes.position.count;
      for (const x of X) {
        const pv = new THREE.Object3D(); pv.name = 'wiper'; pv.position.set(x, 1.08, zf + 0.06); pv.rotation.z = REST;
        pv.userData = { rest: REST, sweep: [REST, -0.12] };
        g.add(pv); wipers.push(pv);
      }
      // both arms in one geometry; the vertex shader turns each about its pivot by the pivot's rotation.z
      const geo = new THREE.BufferGeometry(), cat = (name, k) => { const src = arm.attributes[name].array, out = new Float32Array(src.length * 2); out.set(src); out.set(src, src.length); return new THREE.BufferAttribute(out, k); };
      geo.setAttribute('position', cat('position', 3)); geo.setAttribute('normal', cat('normal', 3)); geo.setAttribute('color', cat('color', 3));
      const piv = new Float32Array(n * 6), wid = new Float32Array(n * 2);
      for (let i = 0; i < n * 2; i++) { const w = i < n ? 0 : 1; wid[i] = w; piv.set([X[w], 1.08, zf + 0.06], i * 3); }
      geo.setAttribute('aPivot', new THREE.BufferAttribute(piv, 3)); geo.setAttribute('aWiper', new THREE.BufferAttribute(wid, 1));
      arm.dispose();
      const wu = { value: new THREE.Vector2(REST, REST) };
      const wmat = new THREE.MeshLambertMaterial({ vertexColors: true });
      wmat.onBeforeCompile = (sh) => {
        sh.uniforms.uWipe = wu;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec3 aPivot;\nattribute float aWiper;\nuniform vec2 uWipe;\nvec3 wipeRot(vec3 v) { float a = aWiper < 0.5 ? uWipe.x : uWipe.y; float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }')
          .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = wipeRot(vec3( normal ));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif')
          .replace('#include <begin_vertex>', 'vec3 transformed = wipeRot(vec3( position )) + aPivot;');
      };
      const wim = new THREE.Mesh(geo, wmat); wim.name = 'wipers'; wim.frustumCulled = false;
      wim.onBeforeRender = () => { wu.value.set(wipers[0].rotation.z, wipers[1].rotation.z); };
      g.add(wim); wipers.mesh = wim;
    }
    let blob = null;
    if (opts.shadow !== false && BB.mk.blob) { blob = BB.mk.blob(3.6, L + 1.6); blob.position.y = 0.08; g.add(blob); }

    return { g, wipers, L, zf, zb, lowMesh, upMesh, mats: [lowMat, upMat, kerbMat].filter(Boolean), kerbMesh, seats, doors, wheels, steer, hubs, blob, roof1, roof0, winTop };
  }

  // ---------- the three types ----------
  const SPECS = {
    bendy: {
      LF: 7.4, LR: 6.0, GAP: 1.0,
      front: { L: 7.4, role: 'front', deck: 1, axles: [1.7, -1.9], steerZ: 1.7, doors: [{ z: 3.0, w: 1.1 }], seatsZ: [1.75, 0.65, -0.45, -1.55, -2.65], row2Shift: -0.5, see: true, podZ: -0.4, podL: 2.4 },
      rear: { L: 6.0, role: 'rear', deck: 1, axles: [-1.2], steerZ: null, doors: [{ z: 1.4, w: 1.1 }], seatsZ: null, see: false, podZ: 1.55, podL: 1.6 },
    },
    single: { L: 10.8, role: 'solo', deck: 1, axles: [3.3, -2.7], steerZ: 3.3, doors: [{ z: 4.55, w: 1.1 }, { z: -0.35, w: 1.15 }], seatsZ: [2.4, 1.3, 0.2, -0.9, -2.0], row2Shift: 0.55, see: true, podZ: 1.6, podL: 2.6 },
    double: { L: 10.8, role: 'solo', deck: 2, axles: [3.3, -2.3, -3.45], steerZ: 3.3, doors: [{ z: 4.55, w: 1.1 }, { z: -0.35, w: 1.15 }], seatsZ: [2.4, 1.3, 0.2, -0.9, -2.0], row2Shift: 0.55, see: true, podZ: -4.3, podL: 1.6 },
  };

  function anchor(parent, x, y, z, ry, rx, size) {
    const o = new THREE.Object3D(); o.position.set(x, y, z); o.rotation.set(rx || 0, ry, 0, 'YXZ'); o.userData.size = size; parent.add(o); return o;
  }

  function build(type, paintColour, opts) {
    opts = opts || {};
    if (VEHICLES[type]) return buildVehicle(type, paintColour, opts);
    if (!SPECS[type]) type = 'bendy';
    const sign = makeSign();
    const shared = { paint: new THREE.Color(paintColour || (BB.P && BB.P.busGreen) || '#3fae49'), lamp: { value: 1 }, siren: { value: new THREE.Vector2(0.15, 0.15) }, cabin: { value: 0 }, tex: sign.tex };
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
      roofFront: mount(F.kerbMesh || F.upMesh || F.g, 'roofFront', 0, F.roof1, F.zf),
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
        [anchor(F.kerbMesh, 0, F.roof1 + 0.012, -2.4, 0, -Math.PI / 2, 2.2)],
      ];
    } else {
      stickerAnchors = [
        [anchor(F.g, 1.27, 0.98, 1.4, Math.PI / 2, 0, 1.05), anchor(F.g, -1.27, 0.98, 1.4, -Math.PI / 2, 0, 1.05)],
        [anchor(F.kerbMesh, 1.27, 1.6, -4.15, Math.PI / 2, 0, 1.1), anchor(F.upMesh, -1.27, 1.6, -4.15, -Math.PI / 2, 0, 1.1)],
        [anchor(F.kerbMesh, 0, F.roof1 + 0.012, -1.4, 0, -Math.PI / 2, 2.2)],
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
      // the kerb-side wall above the sill of the seated deck (windows, pillars, panels, kerb-side display): fade or
      // hide it for the stop's side view; the doors stay on the upper mesh
      kerbWallParts: [F.kerbMesh],
      // windscreen wipers: Object3D pivots at the bottom of the glass; sweep rotation.z between userData.sweep[0]
      // (rest, lying along the bottom) and userData.sweep[1] (nearly upright). One mesh draws both (shader-turned).
      wipers: F.wipers.slice(),
      kerbWallMaterial: F.kerbMesh ? F.kerbMesh.material : null,
      stickerAnchors,
      partMounts,
      shadows: [F.blob, R && R.blob].filter(Boolean),
      routeSign: { setNumber: sign.setNumber, setDest: sign.setDest, get number() { return sign.number; } },
      paintMaterial: F.mats[0],
      materials: mats,
      setPaint(c) { shared.paint.set(c); },
      // cabin lights (0..1): ceiling strips glow, seats, floor and inside walls are lit, windows glow warm from inside
      setCabinLight(level) { shared.cabin.value = Math.max(0, Math.min(1, +level || 0)); },
      get cabinLight() { return shared.cabin.value; },
      // patch any Lambert/Phong/Standard material (e.g. the passengers') so it is lit by this vehicle's cabin lights too
      lightUp(mat) { return cabinPatch(mat, shared.cabin); },
      setLights(on) { shared.lamp.value = on ? 1 : 0.12; },
      // the upper mesh's material, for fading the roof (opacity) instead of hiding it
      roofMaterial: F.upMesh ? F.upMesh.material : null,
      dispose() {
        for (const car of [F, R]) {
          if (!car) continue;
          car.lowMesh.geometry.dispose(); if (car.upMesh) car.upMesh.geometry.dispose(); if (car.kerbMesh) car.kerbMesh.geometry.dispose();
          for (const w of car.wheels) w.geometry.dispose();
          if (car.wipers.mesh) { car.wipers.mesh.geometry.dispose(); car.wipers.mesh.material.dispose(); }
          if (car.blob) { car.blob.geometry.dispose(); car.blob.material.dispose(); }
          if (car.g.parent) car.g.parent.remove(car.g);
        }
        for (const m of mats) m.dispose();
        sign.tex.dispose();
      },
    };
    // wheelbase of the front carriage (front axle to the first rear axle), for the driving controller
    out.wheelbase = axlesF[0] - axlesF[1];
    out.kind = 'bus'; out.wheels.x = WHEEL_X; out.siren = null;
    out.userData = { siren: null, ladder: null, hatch: null, boom: null, hook: null };
    out.exitDoorLocal = F.doors[1] ? { x: 1.6, y: 0, z: F.doors[1].d.z } : null;
    return out;
  }

  // ======================================================================================================
  // ---------- other vehicles kids can drive: taxi, fire engine, ambulance, ice cream van, tow truck ----------
  // Same build() result as the buses (one carriage). Generic: no branding, liveries or service symbols. Each is one
  // opaque mesh (paint, details, lamps, plates), one see-through mesh (glass, cab roof; the taxi also has a kerb-wall
  // mesh for the side cut-away), one wheel mesh per axle and at most one or two moving-part meshes.
  const VEHICLES = {
    //          length, width, tyre radius, wheel x, axles (front steers), roof height, default paint
    taxi: { L: 5.0, W: 2.0, R: 0.42, WX: 0.86, axles: [1.6, -1.55], H: 2.3, paint: '#f5b83d', label: 'TAXI' },
    fire: { L: 8.4, W: 2.5, R: 0.55, WX: 1.06, axles: [2.6, -2.3], H: 3.2, paint: '#e8463a' },
    ambulance: { L: 6.4, W: 2.3, R: 0.47, WX: 0.98, axles: [2.05, -1.9], H: 2.8, paint: '#f4f1ea' },
    icecream: { L: 5.8, W: 2.3, R: 0.46, WX: 0.96, axles: [1.9, -1.7], H: 3.85, paint: '#ff8fab' },
    tow: { L: 6.8, W: 2.4, R: 0.5, WX: 1.02, axles: [2.2, -1.9], H: 2.9, paint: '#ffb81f' },
  };
  // x0..x1, y0..y1, z0..z1 box
  const bx = (k, x0, x1, y0, y1, z0, z1, col, o) => k.box(x1 - x0, y1 - y0, z1 - z0, col, (x0 + x1) / 2, y0, (z0 + z1) / 2, o);
  // a rounded body block (rounded top edges) from z0 to z1
  const block = (k, w, y0, y1, z0, z1, col, rt = 0.12, rb = 0.1, xc = 0) => k.add(slab(w, y0, y1, rt, rb, z1 - z0, 0.08), col, xc, 0, (z0 + z1) / 2);
  function vDriver(k, x, fy, z) {             // a driver (no face), seat and steering wheel; z = seat centre
    k.box(0.5, 0.3, 0.5, '#4a4250', x, fy, z); k.box(0.5, 0.6, 0.1, '#4a4250', x, fy + 0.25, z - 0.28, NO, -0.12);
    k.cyl(0.2, 0.26, 0.55, 6, '#4f7fe0', x, fy + 0.58, z + 0.04);
    k.ball(0.22, '#d9a679', x, fy + 1.08, z + 0.04); k.ball(0.24, '#2b5aa8', x, fy + 1.17, z + 0.02, 1, 0.55, 1);
    k.box(0.3, 0.05, 0.22, '#2b5aa8', x, fy + 1.15, z + 0.22);
    k.add(new THREE.TorusGeometry(0.19, 0.035, 4, 10), '#3a2a3c', x, fy + 0.72, z + 0.42, -0.9, 0, 0);
  }
  function vSeat(k, x, fy, z, col) {
    k.box(0.6, 0.12, 0.52, col, x, fy + 0.06, z); k.box(0.6, 0.56, 0.1, col, x, fy + 0.18, z - 0.3, NO, -0.08);
    k.box(0.3, 0.07, 0.26, '#5a5260', x, fy, z);
  }
  // framed side glass from z0 to z1 (z0 > z1) with pillars at the given z
  function vWindows(k, s, hw, y0, y1, z0, z1, pillars) {
    const zc = (z0 + z1) / 2, len = Math.abs(z0 - z1);
    k.glass(0.03, y1 - y0, len, s * (hw - 0.03), y0, zc);
    k.box(0.05, 0.06, len, FRAME, s * (hw - 0.01), y0, zc); k.box(0.05, 0.06, len, FRAME, s * (hw - 0.01), y1 - 0.06, zc);
    for (const z of pillars) k.box(0.06, y1 - y0, 0.1, FRAME, s * (hw - 0.01), y0, z);
  }
  function vHeadlights(k, hw, y, z) {
    for (const s of [1, -1]) {
      k.box(0.44, 0.24, 0.04, FRAME, s * (hw - 0.34), y - 0.03, z);
      k.box(0.26, 0.17, 0.04, LAMP_HEAD, s * (hw - 0.4), y, z + 0.02);
      k.box(0.11, 0.17, 0.04, LAMP_IND, s * (hw - 0.17), y, z + 0.02);
      k.box(0.03, 0.1, 0.18, LAMP_IND, s * (hw + 0.005), y + 0.04, z - 0.3);
    }
  }
  function vTaillights(k, hw, y, z) {
    for (const s of [1, -1]) {
      k.box(0.3, 0.46, 0.04, FRAME, s * (hw - 0.22), y - 0.03, z);
      k.box(0.22, 0.2, 0.04, LAMP_TAIL, s * (hw - 0.22), y + 0.2, z - 0.02);
      k.box(0.22, 0.09, 0.04, LAMP_IND, s * (hw - 0.22), y + 0.09, z - 0.02);
      k.box(0.22, 0.08, 0.04, LAMP_REV, s * (hw - 0.22), y, z - 0.02);
    }
  }
  function vPlate(k, y, z, ry) { k.box(0.62, 0.22, 0.03, '#26232b', 0, y - 0.11, z); k.add(new THREE.PlaneGeometry(0.56, 0.17), '#ffffff', 0, y, z + (ry ? -0.02 : 0.02), 0, ry || 0, 0, { uv: UV_NUM }); }
  function vArches(k, hw, axles, R, y) { for (const z of axles) for (const s of [1, -1]) k.add(new THREE.CircleGeometry(R + 0.13, 10, 0, Math.PI), ARCH, s * (hw + 0.012), y, z, 0, s * Math.PI / 2, 0); }
  function vMirrors(k, hw, y, z) {
    for (const s of [1, -1]) {
      k.box(0.24, 0.05, 0.05, FRAME, s * (hw + 0.1), y, z);
      k.box(0.08, 0.26, 0.16, '#2b2830', s * (hw + 0.24), y - 0.08, z);
      k.box(0.02, 0.2, 0.12, '#a7c8dc', s * (hw + 0.285), y - 0.05, z);
    }
  }
  // a light bar: a dark base with lamps in two groups that flash in turn (siren)
  function vLightBar(k, w, y, z, colA, colB) {
    k.box(w, 0.08, 0.36, FRAME, 0, y, z);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const xx = -w / 2 + w * (i + 0.5) / n, c = (i < n / 2) ? '!' + colA : '%' + colB;
      k.box(w / n - 0.05, 0.16, 0.3, c, xx, y + 0.08, z);
    }
  }
  function vHeart(k, x, y, z, ry, size, col) {
    const sh = new THREE.Shape(), u = size / 2;
    sh.moveTo(0, -u); sh.bezierCurveTo(-u * 1.6, -u * 0.1, -u * 0.9, u * 1.05, 0, u * 0.45); sh.bezierCurveTo(u * 0.9, u * 1.05, u * 1.6, -u * 0.1, 0, -u);
    k.add(new THREE.CircleGeometry(size * 0.72, 16), '#fbf7ee', x, y, z, 0, ry, 0);
    k.add(new THREE.ShapeGeometry(sh, 6), col, x + Math.sin(ry) * 0.005, y, z + Math.cos(ry) * 0.005, 0, ry, 0);
  }

  function vehicle(type, shared, opts) {
    const V = VEHICLES[type], L = V.L, hw = V.W / 2, zf = L / 2, zb = -L / 2, R = V.R;
    const low = new Kit(false), up = new Kit(false);
    const kerb = type === 'taxi' ? new Kit(false) : up;
    const g = new THREE.Group();
    const seats = [], doorsSpec = [], extra = [], ud = {};
    let doorLocal = { x: hw + 0.4, y: 0, z: 0 }, roof1 = V.H, stretcherLocal = null, serverLocal = null;
    let stickerSpots = [];
    const sk = 0.3;                                      // body bottom (skirt)
    if (type === 'taxi') {
      // a tall generic city cab: hood, a high cabin with a sliding kerb-side door, a lit roof sign, a boot
      const FY = 0.5, RAISE_T = 0.25, rf0 = 2.12, rf1 = 2.28, wz0 = 1.45, wz1 = 0.85;   // floor, roof, windscreen base/top z
      block(low, V.W, sk, 0.6, zb, zf, '~#b0b0b0', 0.05, 0.1);                       // skirt
      bx(low, -hw + 0.08, hw - 0.08, FY - 0.03, FY, zb + 0.6, wz0, FLOOR);
      block(low, V.W, 0.55, 1.02, wz0 - 0.05, zf, '~#ffffff', 0.16, 0.05);              // hood
      block(low, V.W, 0.55, 1.08, zb, zb + 0.75, '~#ffffff', 0.12, 0.05);               // boot
      for (const s of [1, -1]) {                                                        // cabin walls (thin: a tub)
        for (const [a, b] of s > 0 ? [[zb + 0.7, -1.34], [-0.1, wz0]] : [[zb + 0.7, wz0]]) {
          bx(low, s > 0 ? hw - 0.06 : -hw, s > 0 ? hw : -hw + 0.06, 0.55, 1.05, a, b, '~#ffffff');
          bx(low, s > 0 ? hw - 0.1 : -hw + 0.06, s > 0 ? hw - 0.06 : -hw + 0.1, 0.55, 1.05, a, b, LINING);
        }
        bx(low, s * hw - 0.015, s * hw + 0.015, 0.78, 0.86, zb + 0.15, zf - 0.2, '#26232b');   // a dark band
      }
      bx(low, -hw, hw, 0.55, 1.05, zb + 0.7, zb + 0.78, '~#ffffff');
      for (const z of V.axles) for (const s of [1, -1]) bx(low, s > 0 ? hw - 0.32 : -hw + 0.06, s > 0 ? hw - 0.06 : -hw + 0.32, FY, 0.9, z - 0.55, z + 0.55, HOUSING);
      // seats: driver front right; passengers on two benches behind (near row seats 0-1, far row 2-3 raised)
      vDriver(low, -0.45, FY, 0.72);
      vSeat(low, 0.45, FY, 0.72, '#6c6470');
      bx(low, -hw + 0.08, -0.1, FY, FY + RAISE_T, -1.8, 0.2, '#9a92a4');
      bx(low, -0.13, -0.08, FY + RAISE_T - 0.04, FY + RAISE_T, -1.8, 0.2, '#ffd45c');
      for (let i = 0; i < 4; i++) {
        const sx = i < 2 ? 0.45 : -0.45, z = i % 2 ? -1.32 : -0.12, fy = FY + (i < 2 ? 0 : RAISE_T);
        vSeat(low, sx, fy, z, i < 2 ? SEAT_A : SEAT_B);
        seats.push({ x: sx, y: fy + SEAT_Y, z });
      }
      // cabin glass, pillars, roof (kerb half of the roof and the kerb windows on the kerb mesh)
      const wy0 = 1.05, wy1 = rf0;
      const ws = Math.atan2(wz0 - wz1, wy1 - wy0), wl = Math.hypot(wz0 - wz1, wy1 - wy0);
      up.glass(V.W - 0.16, wl, 0.03, 0, (wy0 + wy1) / 2 - wl / 2, (wz0 + wz1) / 2, null);
      up.parts[up.parts.length - 1].m = new THREE.Matrix4().compose(new THREE.Vector3(0, (wy0 + wy1) / 2, (wz0 + wz1) / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(-ws, 0, 0)), new THREE.Vector3(1, 1, 1));
      for (const s of [1, -1]) up.add(new THREE.BoxGeometry(0.08, wl, 0.08), FRAME, s * (hw - 0.05), (wy0 + wy1) / 2, (wz0 + wz1) / 2, -ws, 0, 0);
      up.box(V.W - 0.1, 0.06, 0.08, FRAME, 0, wy0 - 0.03, wz0);
      vWindows(up, -1, hw, wy0, wy1, wz1, zb + 0.75, [wz1 - 0.05, -0.55, zb + 0.8]);
      vWindows(kerb, 1, hw, wy0, wy1, wz1, -0.15 + 0.05, [wz1 - 0.05]);
      vWindows(kerb, 1, hw, wy0, wy1, -1.34, zb + 0.75, [zb + 0.8]);
      up.glass(V.W - 0.3, wy1 - wy0 - 0.15, 0.03, 0, wy0 + 0.05, zb + 0.74);                 // rear window
      up.box(V.W - 0.2, 0.06, 0.06, FRAME, 0, wy1 - 0.08, zb + 0.73);
      const SPL = 0.42;
      up.add(roofPiece(-hw, SPL, rf0, rf1, 0.1, 0, wz1 - (zb + 0.7)), '~#ffffff', 0, 0, (wz1 + zb + 0.7) / 2);
      kerb.add(roofPiece(SPL, hw, rf0, rf1, 0, 0.1, wz1 - (zb + 0.7)), '~#ffffff', 0, 0, (wz1 + zb + 0.7) / 2);
      // the roof sign: lit, with TAXI front and back (it sits on the driver's half of the roof)
      up.box(0.16, 0.03, 2.6, CABIN_LAMP, 0, rf0 - 0.035, -0.55);
      up.box(0.78, 0.26, 0.34, '#fff3c4', 0, rf1, -0.35);
      up.add(new THREE.PlaneGeometry(0.72, 0.2), '*#ffffff', 0, rf1 + 0.13, -0.35 + 0.175, 0, 0, 0, { uv: UV_DEST });
      up.add(new THREE.PlaneGeometry(0.72, 0.2), '*#ffffff', 0, rf1 + 0.13, -0.35 - 0.175, 0, Math.PI, 0, { uv: UV_DEST });
      // a sliding door on the kerb side for the back benches (slides forward)
      doorsSpec.push({ z: -0.72, w: 1.2, y0: 0.4, y1: wy1 - 0.04, slideK: 1.0 });
      doorLocal = { x: hw + 0.45, y: 0, z: -0.72 };
      // front: grille, lamps, plate; rear: lamps, plate
      bx(low, -0.5, 0.5, 0.42, 0.62, zf - 0.02, zf + 0.02, '#3a3440');
      vHeadlights(low, hw, 0.68, zf); vTaillights(low, hw, 0.6, zb);
      vPlate(low, 0.38, zf + 0.04); vPlate(low, 0.75, zb - 0.04, Math.PI);
      vArches(low, hw, V.axles, R, sk + 0.02);
      vMirrors(up, hw, 1.3, wz0 - 0.15);
      roof1 = rf1 + 0.26;
      stickerSpots = [[0.68, 1.25, 0.9], [0.68, -1.95, 0.75], [rf1 + 0.012, -1.3, 1.0]];
    } else if (type === 'fire') {
      // a fire engine: crew cab (driver + 4 crew seats), equipment body with lockers, a ladder that raises, hose reel
      const FY = 0.75, RAISE_T = 0.25, cab0 = 0.85, cabTop = 2.7, wz = zf - 0.12;
      block(low, V.W, sk + 0.05, 0.85, zb, zf, '~#a8a8a8', 0.06, 0.12);
      // cab: lower panels painted, big glass, roof
      for (const s of [1, -1]) bx(low, s > 0 ? hw - 0.06 : -hw, s > 0 ? hw : -hw + 0.06, 0.85, 1.45, cab0, zf, '~#ffffff');
      bx(low, -hw, hw, 0.85, 1.45, zf - 0.08, zf, '~#ffffff');
      bx(low, -hw, hw, 0.85, cabTop, cab0, cab0 + 0.08, '~#d0d0d0');
      bx(low, -hw + 0.06, hw - 0.06, FY - 0.03, FY, cab0, zf - 0.1, FLOOR);
      vDriver(low, -0.6, FY, 3.25); vSeat(low, 0.6, FY, 3.25, '#6c6470');
      bx(low, -hw + 0.08, -0.15, FY, FY + RAISE_T, cab0 + 0.1, 2.75, '#9a92a4');
      for (let i = 0; i < 4; i++) {
        const sx = i < 2 ? 0.6 : -0.6, z = i % 2 ? 1.35 : 2.35, fy = FY + (i < 2 ? 0 : RAISE_T);
        vSeat(low, sx, fy, z, i < 2 ? SEAT_A : SEAT_B); seats.push({ x: sx, y: fy + SEAT_Y, z });
      }
      vWindows(up, 1, hw, 1.45, cabTop - 0.12, zf - 0.1, cab0 + 0.1, [zf - 0.12, 2.85, cab0 + 0.12]);
      vWindows(up, -1, hw, 1.45, cabTop - 0.12, zf - 0.1, cab0 + 0.1, [zf - 0.12, 2.85, cab0 + 0.12]);
      up.box(V.W - 0.1, 0.07, 0.07, FRAME, 0, 1.42, wz + 0.1); up.box(0.07, cabTop - 1.55, 0.07, FRAME, 0, 1.45, wz + 0.1);
      up.glass(V.W - 0.16, cabTop - 1.6, 0.03, 0, 1.47, wz + 0.11);
      up.add(slab(V.W, cabTop - 0.12, cabTop + 0.12, 0.14, 0.02, zf - cab0, 0.06), '~#ffffff', 0, 0, (zf + cab0) / 2);
      vLightBar(up, 1.7, cabTop + 0.12, zf - 0.45, '#ff4a3a', '#fff3e0');
      up.box(0.16, 0.03, zf - cab0 - 0.6, CABIN_LAMP, 0, cabTop - 0.155, (zf + cab0) / 2);
      // equipment body with roller lockers (silver), a white stripe, the ladder turntable and a hose reel at the back
      block(low, V.W, 0.85, 2.45, zb, cab0 - 0.05, '~#ffffff', 0.08, 0.02);
      for (const s of [1, -1]) {
        for (let i = 0; i < 3; i++) {
          const z0 = cab0 - 0.3 - i * 1.55, z1 = z0 - 1.35;
          bx(low, s * hw - 0.01, s * hw + 0.02, 1.0, 2.2, z1, z0, '#d5d9e0');
          for (let j = 0; j < 6; j++) bx(low, s * hw + 0.015, s * hw + 0.03, 1.08 + j * 0.19, 1.1 + j * 0.19, z1 + 0.04, z0 - 0.04, '#aeb5c0');
        }
        bx(low, s * hw - 0.01, s * hw + 0.025, 0.9, 0.98, zb + 0.1, zf - 0.1, '#fff3e0');
      }
      low.cyl(0.5, 0.55, 0.3, 10, '#5a5260', 0, 2.6, -3.0);
      low.box(0.7, 0.35, 0.7, '~#c8c8c8', 0, 2.65, -3.0);
      // hose reel on the back: a drum with a yellow hose coil
      low.add(new THREE.CylinderGeometry(0.42, 0.42, 1.3, 12), '#c9c3cf', 0, 1.75, zb - 0.28, 0, 0, Math.PI / 2);
      low.add(new THREE.CylinderGeometry(0.36, 0.36, 1.2, 12), '#ffd45c', 0, 1.75, zb - 0.28, 0, 0, Math.PI / 2);
      for (const s of [1, -1]) low.box(0.06, 0.95, 0.5, FRAME, s * 0.7, 1.25, zb - 0.22);
      // front and back
      bx(low, -0.8, 0.8, 0.5, 0.82, zf - 0.02, zf + 0.02, '#d5d9e0');
      for (let j = 0; j < 4; j++) bx(low, -0.75, 0.75, 0.54 + j * 0.07, 0.565 + j * 0.07, zf + 0.02, zf + 0.04, '#6c6470');
      vHeadlights(low, hw, 0.95, zf); vTaillights(low, hw, 0.62, zb);
      vPlate(low, 0.36, zf + 0.04); vPlate(low, 0.42, zb - 0.04, Math.PI);
      vArches(low, hw, V.axles, R, sk + 0.06);
      vMirrors(up, hw, 2.15, zf - 0.2);
      // the ladder (its own mesh): pivot at the back of the turntable, lying forward over the cab; rotation.x < 0 raises
      const lad = new Kit(false), LL = 6.6;
      for (const s of [1, -1]) lad.box(0.08, 0.16, LL, '#dfe3ea', s * 0.42, 0, LL / 2 - 0.2);
      for (let i = 0; i < 16; i++) lad.box(0.8, 0.05, 0.06, '#aab2bf', 0, 0.05, -0.05 + i * (LL - 0.3) / 15);
      lad.box(0.4, 0.3, 0.6, '#5a5260', 0, -0.2, 0);
      ud.ladder = { kit: lad, pos: [0, 3.05, -3.0], name: 'ladder', userData: { raise: [0, -0.75] } };
      roof1 = cabTop + 0.36;
      stickerSpots = [[1.6, 2.0, 0.9], [1.6, -3.0, 0.9], [cabTop + 0.13, 1.9, 0.9]];
    } else if (type === 'ambulance') {
      // a van-fronted ambulance: low hood, cab, a tall box body with a sliding kerb door and rear doors; a heart emblem
      const FY = 0.6, cabEnd = 1.55, wz0 = 2.35, wz1 = 1.75, boxTop = 2.75;
      block(low, V.W, sk, 0.62, zb, zf, '~#b5b5b5', 0.05, 0.1);
      block(low, V.W, 0.58, 1.12, wz0 - 0.05, zf, '~#ffffff', 0.18, 0.05);             // hood
      for (const s of [1, -1]) bx(low, s > 0 ? hw - 0.06 : -hw, s > 0 ? hw : -hw + 0.06, 0.58, 1.2, cabEnd, wz0, '~#ffffff');
      bx(low, -hw + 0.06, hw - 0.06, FY - 0.03, FY, cabEnd, wz0, FLOOR);
      vDriver(low, -0.5, FY, 1.95); vSeat(low, 0.5, FY, 1.95, '#6c6470');
      const ws = Math.atan2(wz0 - wz1, 2.2 - 1.15), wl = Math.hypot(wz0 - wz1, 2.2 - 1.15);
      up.add(new THREE.BoxGeometry(V.W - 0.16, wl, 0.03), GLASS, 0, (1.15 + 2.2) / 2, (wz0 + wz1) / 2, -ws, 0, 0, { a: GLASS_A });
      for (const s of [1, -1]) up.add(new THREE.BoxGeometry(0.08, wl, 0.08), FRAME, s * (hw - 0.05), (1.15 + 2.2) / 2, (wz0 + wz1) / 2, -ws, 0, 0);
      for (const s of [1, -1]) vWindows(up, s, hw, 1.2, 2.18, wz1, cabEnd + 0.05, [wz1 - 0.04, cabEnd + 0.08]);
      up.add(slab(V.W, 2.16, 2.32, 0.1, 0.02, wz1 - cabEnd + 0.1, 0.05), '~#ffffff', 0, 0, (wz1 + cabEnd) / 2);
      // the box body (solid: the crew inside are seen through the open doors and the small windows)
      const bw = hw + 0.02, dz0 = 0.15 - 0.6, dz1 = 0.15 + 0.6;
      bx(low, -bw, -bw + 0.06, 0.58, boxTop, zb, cabEnd, '~#ffffff');
      bx(low, bw - 0.06, bw, 0.58, boxTop, zb, dz0, '~#ffffff'); bx(low, bw - 0.06, bw, 0.58, boxTop, dz1, cabEnd, '~#ffffff');
      bx(low, bw - 0.06, bw, 2.35, boxTop, dz0, dz1, '~#ffffff');
      low.add(roofPiece(-bw, bw, boxTop - 0.14, boxTop + 0.04, 0.1, 0.1, cabEnd - zb), '~#ffffff', 0, 0, (zb + cabEnd) / 2);
      bx(low, -bw, bw, 1.2, boxTop, cabEnd - 0.06, cabEnd, '~#ffffff');
      for (const s of [1, -1]) bx(low, s > 0 ? bw - 0.1 : -bw + 0.06, s > 0 ? bw - 0.06 : -bw + 0.1, FY, boxTop - 0.1, zb + 0.05, cabEnd - 0.06, LINING);
      bx(low, -hw - 0.03, hw + 0.03, boxTop - 0.04, boxTop + 0.12, cabEnd - 0.05, cabEnd + 0.35, '~#ffffff');   // over-cab peak
      for (const s of [1, -1]) {
        for (const [a, b] of cut(zb + 0.1, cabEnd - 0.1, s > 0 ? [[dz0, dz1]] : [])) {                         // stripes
          bx(low, s * (hw + 0.02) - 0.012, s * (hw + 0.02) + 0.012, 1.0, 1.2, a, b, '#4fa3e0');
          bx(low, s * (hw + 0.02) - 0.012, s * (hw + 0.02) + 0.012, 1.24, 1.3, a, b, '#ff6b5c');
        }
        vHeart(low, s * (hw + 0.035), 1.95, -1.6, s * Math.PI / 2, 0.62, '#ff6b5c');
        for (const z of [cabEnd - 0.15, zb + 0.15]) { low.box(0.05, 0.14, 0.18, s > 0 === (z > 0) ? '!#4fa3ff' : '%#ff4a3a', s * (hw + 0.03), boxTop - 0.18, z); }
      }
      // rear: two doors with windows, a step, lamps
      for (const s of [1, -1]) {
        bx(low, s > 0 ? 0.02 : -hw + 0.08, s > 0 ? hw - 0.08 : -0.02, 0.62, boxTop - 0.15, zb - 0.03, zb, '~#e6e6e6');
        low.box(0.62, 0.55, 0.03, '#46708f', s * 0.55, 1.75, zb - 0.035);
        low.box(0.06, 0.04, 0.2, '#c9c3cf', s * 0.12, 1.4, zb - 0.1);
      }
      vHeart(low, 0, 1.32, zb - 0.05, Math.PI, 0.32, '#ff6b5c');
      bx(low, -0.9, 0.9, 0.36, 0.46, zb - 0.32, zb, '#5a5260');
      low.box(1.4, 0.16, 0.12, '!#4fa3ff', -0.35, boxTop - 0.12, zb - 0.05); low.box(0.7, 0.16, 0.12, '%#ff4a3a', 0.35, boxTop - 0.12, zb - 0.05);
      vLightBar(up, 1.5, 2.32, 2.0, '#4fa3ff', '#ff4a3a');
      // the crew compartment: 2 crew seats on the kerb side, a stretcher on the far side
      bx(low, -hw + 0.08, hw - 0.08, FY, FY + 0.02, zb + 0.1, cabEnd - 0.05, FLOOR);
      seats.push({ x: 0.55, y: FY + SEAT_Y, z: 0.7 }, { x: 0.55, y: FY + SEAT_Y, z: -0.4 });
      vSeat(low, 0.55, FY, 0.7, SEAT_A); vSeat(low, 0.55, FY, -0.4, SEAT_A);
      bx(low, -0.95, -0.25, FY, FY + 0.55, -2.7, -0.6, '#c9c3cf');
      bx(low, -0.92, -0.28, FY + 0.55, FY + 0.68, -2.65, -0.65, '#fbf7ee');
      bx(low, -0.9, -0.3, FY + 0.68, FY + 0.8, -0.95, -0.65, '#ffffff');
      stretcherLocal = { x: -0.6, y: FY + 0.75, z: -1.65 };
      for (const x of [-0.5, 0.5]) low.box(0.14, 0.03, 3.6, CABIN_LAMP, x, boxTop - 0.175, (zb + cabEnd) / 2);
      doorsSpec.push({ z: 0.15, w: 1.15, y0: 0.45, y1: 2.35, slideK: -1.0, solid: true });
      doorLocal = { x: hw + 0.45, y: 0, z: 0.15 };
      bx(low, -0.55, 0.55, 0.6, 0.86, zf - 0.02, zf + 0.02, '#3a3440');
      vHeadlights(low, hw, 0.85, zf); vTaillights(low, hw, 0.68, zb - 0.03);
      vPlate(low, 0.4, zf + 0.04); vPlate(low, 0.62, zb - 0.06, Math.PI);
      vArches(low, hw, V.axles, R, sk + 0.02);
      vMirrors(up, hw, 1.55, wz0 - 0.2);
      roof1 = boxTop;
      stickerSpots = [[1.55, 0.6, 0.6], [1.0, -2.6, 0.5], [boxTop + 0.012, -1.0, 1.1]];
    } else if (type === 'icecream') {
      // an ice cream van: a cab, a pastel box body with a serving hatch on the kerb side and a giant cone on the roof
      const FY = 0.6, cabEnd = 1.35, wz0 = 2.25, wz1 = 1.7, boxTop = 2.6;
      block(low, V.W, sk, 0.62, zb, zf, '~#b5b5b5', 0.05, 0.1);
      block(low, V.W, 0.58, 1.12, wz0 - 0.05, zf, '~#ffffff', 0.18, 0.05);
      for (const s of [1, -1]) bx(low, s > 0 ? hw - 0.06 : -hw, s > 0 ? hw : -hw + 0.06, 0.58, 1.2, cabEnd, wz0, '~#ffffff');
      bx(low, -hw + 0.06, hw - 0.06, FY - 0.03, FY, cabEnd, wz0, FLOOR);
      vDriver(low, -0.5, FY, 1.85);
      const ws = Math.atan2(wz0 - wz1, 2.15 - 1.15), wl = Math.hypot(wz0 - wz1, 2.15 - 1.15);
      up.add(new THREE.BoxGeometry(V.W - 0.16, wl, 0.03), GLASS, 0, (1.15 + 2.15) / 2, (wz0 + wz1) / 2, -ws, 0, 0, { a: GLASS_A });
      for (const s of [1, -1]) up.add(new THREE.BoxGeometry(0.08, wl, 0.08), FRAME, s * (hw - 0.05), (1.15 + 2.15) / 2, (wz0 + wz1) / 2, -ws, 0, 0);
      for (const s of [1, -1]) vWindows(up, s, hw, 1.2, 2.12, wz1, cabEnd + 0.05, [wz1 - 0.04, cabEnd + 0.08]);
      up.add(slab(V.W, 2.1, 2.26, 0.1, 0.02, wz1 - cabEnd + 0.1, 0.05), '~#ffffff', 0, 0, (wz1 + cabEnd) / 2);
      // box body with an opening on the kerb side (z -1.75..0.75, y 1.2..2.15)
      const hz0 = -1.75, hz1 = 0.75, hy0 = 1.2, hy1 = 2.15;
      block(low, V.W + 0.04, 0.58, hy0, zb, cabEnd, '~#ffffff', 0.02, 0.04);
      block(low, V.W + 0.04, hy1, boxTop, zb, cabEnd, '~#ffffff', 0.14, 0.0);
      bx(low, -hw - 0.02, -hw + 0.04, hy0, hy1, zb, cabEnd, '~#ffffff');
      bx(low, hw - 0.04, hw + 0.02, hy0, hy1, zb, hz0, '~#ffffff'); bx(low, hw - 0.04, hw + 0.02, hy0, hy1, hz1, cabEnd, '~#ffffff');
      bx(low, -hw, hw, hy0, hy1, zb, zb + 0.06, '~#ffffff'); bx(low, -hw, hw, hy0, hy1, cabEnd - 0.06, cabEnd, '~#ffffff');
      // inside: a counter with tubs of ice cream, a cone stand, and the server's spot
      bx(low, 0.3, hw + 0.08, hy0 - 0.02, hy0 + 0.06, hz0, hz1, '#fbf7ee');
      const tubs = ['#ff8fab', '#fff3c4', '#8fe0c4', '#c58a55', '#ffd45c'];
      tubs.forEach((c, i) => { const z = hz0 + 0.3 + i * 0.48; low.box(0.34, 0.1, 0.34, '#dfe3ea', 0.55, hy0 + 0.06, z); low.ball(0.14, c, 0.55, hy0 + 0.2, z, 1, 0.6, 1); });
      bx(low, -hw + 0.06, hw - 0.06, FY, FY + 0.03, zb + 0.06, cabEnd - 0.06, FLOOR);
      serverLocal = { x: -0.2, y: FY, z: (hz0 + hz1) / 2 };
      low.box(0.16, 0.03, hz1 - hz0, CABIN_LAMP, 0.2, hy1 - 0.03, (hz0 + hz1) / 2);
      // pastel trim: cream scallops under the roof edge, a mint stripe
      for (const s of [1, -1]) {
        for (let z = zb + 0.2; z < cabEnd - 0.1; z += 0.36) low.add(new THREE.CircleGeometry(0.16, 8, Math.PI, Math.PI), '#fff3c4', s * (hw + 0.03), hy1 + 0.02, z, 0, s * Math.PI / 2, 0);
        bx(low, s * (hw + 0.02) - 0.012, s * (hw + 0.02) + 0.012, 0.8, 0.92, zb + 0.1, cabEnd - 0.1, '#8fe0c4');
      }
      // the giant cone on the roof: a wafer cone, three scoops and a cherry
      const cz = -0.6;
      low.add(new THREE.ConeGeometry(0.42, 1.0, 8), '#e2b07c', 0, boxTop + 0.45, cz, Math.PI, 0, 0);
      low.ball(0.42, '#fff3c4', 0, boxTop + 1.05, cz, 1, 0.9, 1);
      low.ball(0.36, '#ff8fab', -0.18, boxTop + 1.4, cz + 0.05, 1, 0.9, 1);
      low.ball(0.33, '#8fe0c4', 0.2, boxTop + 1.42, cz - 0.05, 1, 0.9, 1);
      low.ball(0.12, '#ef3a4b', 0, boxTop + 1.78, cz);
      low.box(0.5, 0.1, 0.5, '#ffffff', 0, boxTop, cz);
      // rear: window, lamps, step
      low.box(1.2, 0.6, 0.03, '#46708f', 0, 1.55, zb - 0.03);
      bx(low, -0.8, 0.8, 0.36, 0.46, zb - 0.3, zb, '#5a5260');
      bx(low, -0.55, 0.55, 0.6, 0.86, zf - 0.02, zf + 0.02, '#3a3440');
      vHeadlights(low, hw, 0.85, zf); vTaillights(low, hw, 0.68, zb - 0.03);
      vPlate(low, 0.4, zf + 0.04); vPlate(low, 0.62, zb - 0.04, Math.PI);
      vArches(low, hw, V.axles, R, sk + 0.02);
      vMirrors(up, hw, 1.5, wz0 - 0.2);
      // the serving hatch (its own mesh): hinged at the top of the opening; rotation.z > 0 lifts it into an awning
      const hk = new Kit(false), hl = hz1 - hz0 + 0.1;
      hk.box(0.06, hy1 - hy0 + 0.04, hl, '~#ffffff', 0.03, -(hy1 - hy0 + 0.06), 0);
      for (let i = 0; i < 5; i++) hk.box(0.07, (hy1 - hy0) / 5 * 0.5, hl, i % 2 ? '#fff3c4' : '#ff6b5c', 0.045, -(i + 0.5) * (hy1 - hy0) / 5 - 0.05, 0);
      ud.hatch = { kit: hk, pos: [hw + 0.03, hy1 + 0.02, (hz0 + hz1) / 2], name: 'hatch', userData: { open: [0, 1.5] }, axis: 'z' };
      doorLocal = { x: hw + 0.6, y: 0, z: (hz0 + hz1) / 2 };
      roof1 = boxTop;
      stickerSpots = [[1.0, 0.95, 0.6], [1.0, -2.45, 0.6], [boxTop + 0.012, -2.0, 0.9]];
    } else {
      // tow truck (the makeTowTruck look, drivable): chassis, cab, deck, a boom that raises and a hanging hook
      const FY = 1.2;
      block(low, V.W - 0.1, 0.45, 1.25, zb, zf, '~#d08a2e', 0.1, 0.12);
      block(low, V.W - 0.1, 1.2, 2.85, 0.9, zf - 0.6, '~#ffffff', 0.4, 0.04);
      bx(low, -hw + 0.1, hw - 0.1, 0.9, 1.3, zf - 0.6, zf, '~#ffffff');
      vDriver(low, -0.55, FY, 1.85); vSeat(low, 0.55, FY, 1.85, '#6c6470');
      low.box(V.W - 0.4, 0.9, 0.04, '@#46708f', 0, 1.75, zf - 0.58);
      for (const s of [1, -1]) low.box(0.04, 0.8, 1.6, '@#46708f', s * (hw - 0.04), 1.8, 1.8);
      for (const s of [1, -1]) low.box(0.05, 0.6, 0.18, '#6a93b0', s * (hw - 0.02), 1.9, 2.2, NO, 0, 0, 0.3);
      bx(low, -0.55, 0.55, 0.6, 1.1, zf - 0.02, zf + 0.02, '#3a3440');
      for (let j = 0; j < 3; j++) bx(low, -0.5, 0.5, 0.68 + j * 0.13, 0.72 + j * 0.13, zf + 0.02, zf + 0.04, '#8a8492');
      vHeadlights(low, hw - 0.05, 0.95, zf);
      vLightBar(low, 1.7, 2.85, 1.6, '#ffb43a', '#ffd45c');
      // deck, turret, rear lamps and the chequered tow bar
      bx(low, -0.9, 0.9, 1.25, 1.5, zb + 0.1, 0.85, '#e9e2d6');
      bx(low, -0.2, 0.2, 1.5, 2.15, -0.8, -0.4, '#ff6b5c');
      for (let k = 0; k < 4; k++) bx(low, -0.6 + k * 0.3, -0.3 + k * 0.3, 0.6, 0.8, zb - 0.06, zb, k % 2 ? '#3a2a3c' : '#ffb81f');
      vTaillights(low, hw - 0.05, 0.85, zb);
      vPlate(low, 0.42, zf + 0.04); vPlate(low, 1.05, zb - 0.02, Math.PI);
      vArches(low, hw - 0.05, V.axles, R, 0.45);
      vMirrors(up, hw - 0.05, 2.2, zf - 0.75);
      // the boom (its own mesh): pivot on the turret, reaching back; rotation.x > 0 raises it
      const bk = new Kit(false), BL = 3.0;
      bk.box(0.32, 0.32, BL, '#ff6b5c', 0, -0.16, -BL / 2);
      bk.box(0.2, 0.2, 0.3, '#5a5260', 0, -0.1, -BL);
      ud.boom = { kit: bk, pos: [0, 2.05, -0.6], name: 'boom', userData: { raise: [0.05, 0.6] }, rx: 0.35 };
      // the hook (its own mesh) hangs straight down from the boom's tip
      const hk = new Kit(false);
      hk.box(0.04, 1.0, 0.04, '#5a5260', 0, -1.0, 0);
      hk.add(new THREE.TorusGeometry(0.16, 0.05, 4, 8, Math.PI * 1.4), '#5a5260', 0, -1.12, 0, 0, Math.PI / 2, 0);
      ud.hook = { kit: hk, name: 'hook' };
      roof1 = 3.0;
      stickerSpots = [[1.75, 1.8, 0.6], [1.0, -2.5, 0.6], [2.86, 2.0, 0.8]];
    }

    // doors (proxies like the buses'; a single leaf slides along z in the shader)
    const doors = [];
    doorsSpec.forEach((d, i) => {
      const k = up, idx = i + 1, o = { door: idx, dk: d.slideK * d.w };
      k.box(0.05, 0.06, d.w, FRAME, hw + 0.02, d.y0, d.z, o); k.box(0.05, 0.06, d.w, FRAME, hw + 0.02, d.y1 - 0.06, d.z, o);
      k.box(0.05, d.y1 - d.y0, 0.06, FRAME, hw + 0.02, d.y0, d.z + d.w / 2 - 0.03, o); k.box(0.05, d.y1 - d.y0, 0.06, FRAME, hw + 0.02, d.y0, d.z - d.w / 2 + 0.03, o);
      if (d.solid) { k.box(0.04, d.y1 - d.y0 - 0.12, d.w - 0.1, '~#ffffff', hw + 0.02, d.y0 + 0.06, d.z, o); k.box(0.045, 0.5, d.w - 0.3, '#46708f', hw + 0.025, d.y1 - 0.75, d.z, o); }
      else { k.box(0.04, (d.y1 - d.y0) * 0.42, d.w - 0.1, '~#ffffff', hw + 0.02, d.y0 + 0.06, d.z, o); k.glass(0.03, (d.y1 - d.y0) * 0.5, d.w - 0.1, hw + 0.02, d.y0 + (d.y1 - d.y0) * 0.45, d.z, o); }
      k.box(0.05, 0.05, 0.18, '#c9c3cf', hw + 0.05, d.y0 + (d.y1 - d.y0) * 0.45, d.z - d.w / 2 + 0.2, o);
      const proxy = new THREE.Object3D(); proxy.name = 'door' + idx; proxy.position.set(1.27, 0.5, d.z); proxy.userData = { x: 1.27, z: d.z, w: d.w };
      g.add(proxy); doors.push({ proxy, d, idx });
    });

    if (opts.bumpers) {
      const bmp = (z, s) => { low.add(slab(V.W + 0.08, 0.2, 0.48, 0.08, 0.08, 0.3, 0.05), '#46404e', 0, 0, z + s * 0.1); };
      bmp(zf, 1); bmp(zb, -1);
    }

    const lowMat = busMaterial(shared, false), upMat = busMaterial(shared, true);
    const lowMesh = new THREE.Mesh(low.geometry(), lowMat); lowMesh.name = 'body'; g.add(lowMesh);
    const upMesh = new THREE.Mesh(up.geometry(), upMat); upMesh.name = 'upper'; upMesh.renderOrder = 3; g.add(upMesh);
    let kerbMesh = null, kerbMat = null;
    if (kerb !== up) { kerbMat = busMaterial(shared, true); kerbMesh = new THREE.Mesh(kerb.geometry(), kerbMat); kerbMesh.name = 'kerbWall'; kerbMesh.renderOrder = 3; upMesh.add(kerbMesh); }
    if (doors.length) upMesh.onBeforeRender = () => {
      const u = upMat.userData.doorU.value;
      for (const d of doors) { const p = d.proxy, open = Math.max(0, Math.min(1, (p.position.z - p.userData.z) / DOOR_SLIDE)), dx = p.position.x - p.userData.x; if (d.idx === 1) { u.x = dx; u.y = open; } else { u.z = dx; u.w = open; } }
    };
    // moving parts: a Group (pivot) holding its own mesh (shares the body material: paint, lamps)
    const moving = {};
    for (const key of ['ladder', 'hatch', 'boom']) {
      const m = ud[key]; if (!m) continue;
      const pv = new THREE.Group(); pv.name = m.name; pv.position.set(m.pos[0], m.pos[1], m.pos[2]); pv.userData = m.userData;
      if (m.rx) pv.rotation.x = m.rx;
      const mesh = new THREE.Mesh(m.kit.geometry(), lowMat); mesh.name = m.name + 'Mesh'; pv.add(mesh); g.add(pv); moving[key] = pv; extra.push(mesh);
    }
    if (ud.hook) {
      const tip = new THREE.Group(); tip.name = 'hook'; tip.position.set(0, -0.1, -3.0); moving.boom.add(tip);
      const mesh = new THREE.Mesh(ud.hook.kit.geometry(), lowMat); mesh.name = 'hookMesh'; tip.add(mesh); extra.push(mesh);
      mesh.onBeforeRender = () => { tip.rotation.x = -moving.boom.rotation.x; tip.updateMatrixWorld(true); };   // hangs straight down (same frame)
      tip.userData.end = new THREE.Object3D(); tip.userData.end.position.set(0, -1.15, 0); tip.add(tip.userData.end);
      moving.hook = tip;
    }

    const wheels = [], steer = [], hubs = [];
    for (const z of V.axles) {
      const wm = new THREE.Mesh(wheelGeometry(R, V.WX, R * 0.7), BB.mk.mat); wm.name = 'wheels';
      wm.position.set(0, R, z); wm.rotation.order = 'YXZ'; g.add(wm); wheels.push(wm);
      if (z === V.axles[0]) steer.push(wm);
      const hub = new THREE.Group(); hub.name = 'wheelHub'; hub.position.set(0, R, z); g.add(hub); hubs.push(hub);
    }
    let blob = null;
    if (opts.shadow !== false && BB.mk.blob) { blob = BB.mk.blob(V.W + 1.0, L + 1.2); blob.position.y = 0.08; g.add(blob); }
    return { g, L, zf, zb, V, lowMesh, upMesh, kerbMesh, extra, mats: [lowMat, upMat, kerbMat].filter(Boolean), seats, doors, wheels, steer, hubs, blob,
      roof1, moving, doorLocal, stretcherLocal, serverLocal, stickerSpots, wipers: [] };
  }

  function buildVehicle(type, paintColour, opts) {
    const V = VEHICLES[type];
    const sign = makeSign('plate', V.label || '', '#fff3c4');
    const shared = { paint: new THREE.Color(paintColour || V.paint), lamp: { value: 1 }, siren: { value: new THREE.Vector2(0.15, 0.15) }, cabin: { value: 0 }, tex: sign.tex };
    const F = vehicle(type, shared, opts);
    F.g.name = type;
    const mount = (parent, name, x, y, z, ry) => { const m = new THREE.Group(); m.name = name; m.position.set(x, y, z); m.rotation.y = ry || 0; parent.add(m); return m; };
    const partMounts = {
      lightsFront: mount(F.g, 'lightsFront', 0, 0, F.zf), bumperFront: mount(F.g, 'bumperFront', 0, 0, F.zf),
      bumperRear: mount(F.g, 'bumperRear', 0, 0, F.zb, Math.PI), roofFront: mount(F.upMesh, 'roofFront', 0, F.roof1, F.zf),
      underglow: mount(F.g, 'underglow', 0, 0.06, 0), underglowRear: null, wheelHubs: F.hubs,
    };
    partMounts.bumperFront.scale.x = partMounts.bumperRear.scale.x = V.W / 2.5;
    partMounts.underglow.userData = { length: F.L, width: V.W };
    partMounts.lightsFront.userData = { headlightY: 0.7, windscreenBottom: 1.1, roofY: F.roof1 };
    const hw = V.W / 2, sp = F.stickerSpots;
    const stickerAnchors = [
      [anchor(F.g, hw + 0.03, sp[0][0], sp[0][1], Math.PI / 2, 0, sp[0][2]), anchor(F.g, -hw - 0.03, sp[0][0], sp[0][1], -Math.PI / 2, 0, sp[0][2])],
      [anchor(F.g, hw + 0.03, sp[1][0], sp[1][1], Math.PI / 2, 0, sp[1][2]), anchor(F.g, -hw - 0.03, sp[1][0], sp[1][1], -Math.PI / 2, 0, sp[1][2])],
      [anchor(F.kerbMesh || F.g, 0, sp[2][0], sp[2][1], 0, -Math.PI / 2, sp[2][2])],
    ];
    // the light bar's siren: lamp groups A and B flash in turn while on (driven from the body mesh's draw)
    let siren = null;
    if (type === 'fire' || type === 'ambulance' || type === 'tow') {
      let on = false;
      siren = { get on() { return on; }, setOn(v) { on = !!v; if (!on) shared.siren.value.set(0.15, 0.15); } };
      F.lowMesh.onBeforeRender = () => {
        if (!on) return;
        const t = performance.now() / 1000, ph = (t * (type === 'tow' ? 1.6 : 2.4)) % 1, a = ph < 0.5 ? 1.6 : 0.1;
        shared.siren.value.set(a, 1.7 - a);
      };
    }
    const userData = { siren, ladder: F.moving.ladder || null, hatch: F.moving.hatch || null, boom: F.moving.boom || null, hook: F.moving.hook || null };
    Object.assign(F.g.userData, userData);
    sign.setNumber(opts.number != null ? opts.number : (type === 'taxi' ? '1234' : '88'));
    const doors = F.doors.map((d) => ({ mesh: d.proxy, z: d.d.z, w: d.d.w, carriage: 0, slide: DOOR_SLIDE }));
    const out = {
      type, kind: type, carriages: [F.g, null], jointGroup: null, hitch: null,
      length: F.L, lengthRear: 0, width: V.W, height: F.roof1,
      axles: { front: V.axles.slice(), rear: [] }, wheelbase: V.axles[0] - V.axles[1],
      wheels: { front: F.wheels, rear: [], steer: F.steer, radius: V.R, x: V.WX },
      doors, seatsLocal: F.seats, doorLocal: F.doorLocal, exitDoorLocal: F.doorLocal,
      stretcherLocal: F.stretcherLocal, serverLocal: F.serverLocal,
      roofParts: [F.upMesh], kerbWallParts: F.kerbMesh ? [F.kerbMesh] : [], kerbWallMaterial: F.kerbMesh ? F.kerbMesh.material : null,
      wipers: [], stickerAnchors, partMounts, shadows: F.blob ? [F.blob] : [],
      routeSign: { setNumber: sign.setNumber, setDest: sign.setDest, get number() { return sign.number; } },
      userData, siren, ladder: userData.ladder, hatch: userData.hatch, boom: userData.boom, hook: userData.hook,
      paintMaterial: F.mats[0], materials: F.mats, roofMaterial: F.upMesh.material,
      setPaint(c) { shared.paint.set(c); },
      // cabin lights (0..1): ceiling strips glow, seats, floor and inside walls are lit, windows glow warm from inside
      setCabinLight(level) { shared.cabin.value = Math.max(0, Math.min(1, +level || 0)); },
      get cabinLight() { return shared.cabin.value; },
      // patch any Lambert/Phong/Standard material (e.g. the passengers') so it is lit by this vehicle's cabin lights too
      lightUp(mat) { return cabinPatch(mat, shared.cabin); },
      setLights(on) { shared.lamp.value = on ? 1 : 0.12; },
      dispose() {
        F.lowMesh.geometry.dispose(); F.upMesh.geometry.dispose(); if (F.kerbMesh) F.kerbMesh.geometry.dispose();
        for (const m of F.extra) m.geometry.dispose();
        for (const w of F.wheels) w.geometry.dispose();
        if (F.blob) { F.blob.geometry.dispose(); F.blob.material.dispose(); }
        if (F.g.parent) F.g.parent.remove(F.g);
        for (const m of F.mats) m.dispose();
        sign.tex.dispose();
      },
    };
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

  // Plain sizes of a type, for the cheap low-detail buses of friends in a family room (net.js): carriage lengths, the
  // joint gap, axle z (front carriage centre / rear carriage centre), door z, roof height, decks, tyre radius, wheel x.
  function dims(type) {
    const roofOf = (deck) => (deck === 2 ? 2.84 + 0.36 + 0.98 + 0.68 : 2.84 + 0.72);
    if (VEHICLES[type]) {
      const V = VEHICLES[type];
      return { type, kind: type, tyre: V.R, wheelX: V.WX, width: V.W, LF: V.L, LR: 0, GAP: 0, axlesF: V.axles.slice(), axlesR: [],
        doorsF: [], doorsR: [], deck: 1, roof: V.H, paint: V.paint, seats: { taxi: 4, fire: 4, ambulance: 2, icecream: 0, tow: 0 }[type] };
    }
    const base = { tyre: TYRE_R, wheelX: WHEEL_X, width: WIDTH };
    base.kind = 'bus';
    if (type === 'bendy' || !SPECS[type]) {
      const s = SPECS.bendy;
      return Object.assign(base, { type: 'bendy', LF: s.LF, LR: s.LR, GAP: s.GAP, axlesF: s.front.axles.slice(), axlesR: s.rear.axles.slice(),
        doorsF: s.front.doors.map((d) => d.z), doorsR: s.rear.doors.map((d) => d.z), deck: 1, roof: roofOf(1) });
    }
    const s = SPECS[type];
    return Object.assign(base, { type, LF: s.L, LR: 0, GAP: 0, axlesF: s.axles.slice(), axlesR: [], doorsF: s.doors.map((d) => d.z), doorsR: [], deck: s.deck, roof: roofOf(s.deck) });
  }

  BB.fleet = {
    TYPES: ['bendy', 'double', 'single', 'taxi', 'fire', 'ambulance', 'icecream', 'tow'],
    NAMES: { bendy: 'Bendy bus', double: 'Double-decker', single: 'Single-decker', taxi: 'Taxi', fire: 'Fire engine',
      ambulance: 'Ambulance', icecream: 'Ice cream van', tow: 'Tow truck' },
    KIND: { bendy: 'bus', double: 'bus', single: 'bus', taxi: 'taxi', fire: 'fire', ambulance: 'ambulance', icecream: 'icecream', tow: 'tow' },
    // default paint of each type (buses use the save's paint)
    PAINT: { taxi: '#f5b83d', fire: '#e8463a', ambulance: '#f4f1ea', icecream: '#ff8fab', tow: '#ffb81f' },
    build, preview, dims,
  };
})();
