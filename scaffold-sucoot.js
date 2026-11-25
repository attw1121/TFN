(function (root) {
  'use strict';

  // 桿件細部說明圖.pdf，構件及規格。模型尺寸以 m 表示。
  const postRadius = 0.0301;
  const postWall = 0.0032;
  const socketRadius = 0.0351;
  const socketWall = 0.004;
  // 下底座.dxf, block J66350 (elevation), converted from mm to m.
  // Gross steel weight assumes a square plate and omits deductions for rosette openings.
  const fixedBase = Object.freeze({code: 'J60350', height: 0.35, plateHalfWidth: 0.07,
    plateThickness: 0.006, ringHeight: 0.25, weight: 3.4});
  const posts = {'100': 1, '150': 1.5, '200': 2, '300': 3};
  const bays = {'060': 0.6, '090': 0.9, '120': 1.2, '150': 1.5, '180': 1.8, '240': 2.4};
  const specs = Object.create(null);
  function register(code, kind, label, span) {
    specs[code] = Object.freeze({kind, label, span: Object.freeze(span)});
  }
  for (const [size, height] of Object.entries(posts)) {
    register('V60' + size, 'flat', '平主架 ' + height + ' m', [0, 0, height]);
    register('V61' + size, 'post', '主架 ' + height + ' m', [0, 0, height]);
  }
  register('V62020', 'base', '標準基座 0.20 m', [0, 0, 0.2]);
  register('V62025', 'aux', '輔助桿 0.25 m', [0, 0, 0.25]);
  register('V62050', 'aux', '輔助桿 0.50 m', [0, 0, 0.5]);
  register('FIXED_BASE', 'foot', '下底座 0.35 m', [0, 0, fixedBase.height]);
  register('SPLICE_300', 'splice', '方管連接棒 0.30 m', [0, 0, 0.3]);
  register('J48601', 'jack', '下調整座（示例伸出 0.25 m）', [0, 0, 0.25]);
  register('U48601', 'saddle', 'U 型調整座（示例伸出 0.25 m）', [0, 0, 0.25]);
  register('J63601', 'jack', 'J63601 下調整座', [0, 0, 0.25]);
  register('U63601', 'saddle', 'U63601 上調整座', [0, 0, 0.25]);
  register('U63601S', 'swivel', 'U63601S U 型活動調整座', [0, 0, 0.25]);
  for (const [size, width] of Object.entries(bays)) register('H66' + size, 'rail', '橫桿 ' + width + ' m', [width, 0, 0]);
  for (const [riseCode, sizes] of [['10', ['060', '090', '120', '180']], ['15', Object.keys(bays)]]) {
    for (const size of sizes) {
      const rise = Number(riseCode) / 10;
      register('D6' + size.slice(0, 2) + riseCode, 'brace', '斜桿 ' + bays[size] + ' × ' + rise + ' m', [bays[size], 0, rise]);
    }
  }
  for (const [x, y] of [[1.5, 1.2], [1.5, 1.5], [1.8, 1.2], [1.8, 1.5], [1.8, 1.8], [2.4, 1.5]]) {
    register('LOC_' + x * 100 + '_' + y * 100, 'locator', '定位桿 ' + x + ' × ' + y + ' m', [x, y, 0]);
  }
  Object.freeze(specs);

  function previewCSV(selectedCode = '') {
    const entries = selectedCode ? [[selectedCode, specs[selectedCode]]] : Object.entries(specs);
    const rows = entries.map(([code, spec], index) => {
      const start = [(index % 5) * 3.2, Math.floor(index / 5) * 2.2, 0];
      const end = start.map((value, axis) => value + spec.span[axis]);
      return [code, code, ...start, ...end].join(',');
    });
    return ['id,code,x1,y1,z1,x2,y2,z2', ...rows].join('\r\n');
  }

  // Emit in member coordinates: x/y are radial, z runs from start toward end.
  function mesh(code, length, emit, {detailed = true, specimen = false, product, slope = 0} = {}) {
    const spec = product || specs[code === fixedBase.code ? 'FIXED_BASE' : code];
    if (!spec) return false;
    const flipAuxiliary = code === 'V62025' || code === 'V62050';
    function vertex(point, normal) {
      if (flipAuxiliary) {
        const [x, y, z] = point;
        const [nx, ny, nz] = normal;
        emit([x, -y, length - z], [nx, -ny, -nz]);
      } else {
        emit(point, normal);
      }
    }
    function quad(a, b, c, d) {
      const u = b.map((value, i) => value - a[i]);
      const v = c.map((value, i) => value - a[i]);
      const n = [u[1]*v[2] - u[2]*v[1], u[2]*v[0] - u[0]*v[2], u[0]*v[1] - u[1]*v[0]];
      const magnitude = Math.hypot(...n);
      if (!magnitude) return;
      const normal = n.map(value => value / magnitude);
      for (const point of [a, b, c, a, c, d]) vertex(point, normal);
    }
    function box(x0, x1, y0, y1, z0, z1, transform = point => point) {
      const [a,b,c,d,e,f,g,h] = [
        [x0,y0,z0], [x1,y0,z0], [x1,y1,z0], [x0,y1,z0],
        [x0,y0,z1], [x1,y0,z1], [x1,y1,z1], [x0,y1,z1]
      ].map(transform);
      quad(a,d,c,b); quad(e,f,g,h); quad(a,b,f,e); quad(b,c,g,f); quad(c,d,h,g); quad(d,a,e,h);
    }
    function ring(z0, z1, outer, inner, sides = detailed ? 12 : 8, phase = 0) {
      if (z1 <= z0) return;
      for (let i = 0; i < sides; i++) {
        const a = phase + i * 2 * Math.PI / sides;
        const b = phase + (i + 1) * 2 * Math.PI / sides;
        sector(z0, z1, outer, inner, a, b);
      }
    }
    function sector(z0, z1, outer, inner, a, b) {
      const point = (r, angle, z) => [r * Math.cos(angle), r * Math.sin(angle), z];
      const a0 = point(outer,a,z0), b0 = point(outer,b,z0), a1 = point(outer,a,z1), b1 = point(outer,b,z1);
      const c0 = point(inner,a,z0), d0 = point(inner,b,z0), c1 = point(inner,a,z1), d1 = point(inner,b,z1);
      quad(a0,b0,b1,a1); quad(c0,c1,d1,d0);
      if (inner > 0) {
        quad(c0,d0,b0,a0); quad(c1,a1,b1,d1);
      } else {
        const down = [0,0,-1], up = [0,0,1];
        for (const p of [c0,b0,a0]) vertex(p, down);
        for (const p of [c1,a1,b1]) vertex(p, up);
      }
    }
    function rosette(z) {
      const lo = z - 0.005, hi = z + 0.005;
      if (!detailed) {
        ring(lo, hi, 0.067, postRadius, 12);
        return;
      }
      // Eight openings, alternating narrow ledger slots and wide brace slots.
      for (let i = 0; i < 8; i++) {
        const axis = i * Math.PI / 4;
        const wide = i % 2 === 1;
        const gap = wide ? 0.32 : 0.12;
        const a = axis - Math.PI / 8, b = axis + Math.PI / 8;
        sector(lo, hi, 0.067, postRadius, a, axis - gap);
        sector(lo, hi, 0.067, postRadius, axis + gap, b);
        // Approximate the curved openings using radial sectors.
        const openingInner = wide ? 0.036 : 0.037;
        const openingOuter = 0.056;
        for (let step = 0; step < 4; step++) {
          const start = axis - gap + step * gap / 2;
          const end = start + gap / 2;
          sector(lo, hi, openingInner, postRadius, start, end);
          sector(lo, hi, 0.067, openingOuter, start, end);
        }
        for (const edge of [axis - gap, axis + gap]) {
          const p = (radius, height) => [radius * Math.cos(edge), radius * Math.sin(edge), height];
          const face = [p(openingInner, lo), p(openingOuter, lo), p(openingOuter, hi), p(openingInner, hi)];
          if (edge < axis) face.reverse();
          quad(...face);
        }
      }
    }

    if (['rail', 'brace', 'locator'].includes(spec.kind)) {
      const clearance = Math.min(length / 5, postRadius);
      const head = Math.min(length / 6, 0.072);
      ring(clearance + head * 0.65, length - clearance - head * 0.65, 0.0241, 0.0216);
      for (const end of [0, length]) {
        const inward = end === 0 ? 1 : -1;
        const start = end === 0 ? clearance : end - clearance - head;
        // Two jaws straddle the 10 mm rosette; the bridge joins them to the tube.
        for (const y of [-0.023, 0.006]) box(-0.022, 0.022, y, y + 0.017, start, start + head);
        const bridge = end === 0 ? start + head * 0.65 : start;
        box(-0.022, 0.022, -0.006, 0.006, bridge, bridge + head * 0.35);
        const pin = end + inward * (clearance + head * 0.28);
        const horizontal = Math.sqrt(Math.max(0, 1 - slope ** 2));
        box(-0.003, 0.003, -0.070, 0.070, -0.0135, 0.0135,
          ([x, y, z]) => [x, y * horizontal - z * slope, pin + y * slope + z * horizontal]);
      }
    } else if (['jack', 'saddle', 'swivel'].includes(spec.kind)) {
      const upper = spec.kind !== 'jack';
      const plate = upper ? length : 0;
      const bracket = spec.kind === 'swivel' ? 0.025 : 0;
      const first = upper ? plate - 0.006 - bracket - 0.6 : plate + 0.006;
      const last = upper ? plate - 0.006 - bracket : first + 0.6;
      // The full 600 mm shaft is visible in the catalog. In an assembly its
      // inserted portion is inside the supporting tube.
      const exposed = Math.min(0.6, length);
      const shaftStart = specimen || !upper ? first : Math.max(first, plate - exposed);
      const shaftEnd = specimen || upper ? last : Math.min(last, exposed);
      ring(shaftStart, shaftEnd, 0.0241, 0.0191);
      if (detailed) {
        for (let z = shaftStart + 0.004; z < shaftEnd - 0.002; z += 0.008) {
          ring(z, z + 0.002, 0.025, 0.0241, 8);
        }
      }
      const nut = upper ? Math.min(plate - 0.012, 0.009) : Math.max(0.013, length - 0.009);
      ring(nut - 0.008, nut + 0.008, 0.034, 0.0241);
      box(-0.063, 0.063, -0.008, 0.008, nut - 0.005, nut + 0.005);
      if (upper) {
        box(-0.085, 0.085, -0.075, 0.075, plate - 0.006, plate);
        for (const x of [-0.085, 0.079]) box(x, x + 0.006, -0.075, 0.075, plate, plate + 0.044);
        if (bracket) {
          for (const x of [-0.029, 0.023]) box(x, x + 0.006, -0.025, 0.025, last - 0.014, plate - 0.006);
          box(-0.034, 0.034, -0.006, 0.006, last - 0.010, last + 0.002);
        }
      } else box(-0.07, 0.07, -0.07, 0.07, 0, 0.006);
    } else if (spec.kind === 'foot') {
      const {height, plateHalfWidth: half, plateThickness, ringHeight} = fixedBase;
      box(-half, half, -half, half, 0, plateThickness);
      ring(plateThickness, height, postRadius, postRadius - postWall);
      rosette(ringHeight);
    } else if (spec.kind === 'splice') {
      ring(0, length, 0.020 * Math.SQRT2, 0.017 * Math.SQRT2, 4, Math.PI / 4);
    } else {
      ring(0, length, postRadius, postRadius - postWall);
      if (spec.kind === 'base' || spec.kind === 'aux') {
        const collarLength = spec.kind === 'base' ? 0.100 : 0.070;
        const collarStart = length - 0.010;
        ring(collarStart, collarStart + collarLength, socketRadius, socketRadius - socketWall);
        rosette(0.100);
      } else {
        const diskLimit = Math.min(length, spec.span[2]) - 0.015;
        for (let z = 0.4; z < diskLimit; z += 0.5) rosette(z);
        if (spec.kind === 'post') ring(-0.15, 0.15, 0.020 * Math.SQRT2, 0.017 * Math.SQRT2, 4, Math.PI / 4);
      }
    }
    return true;
  }

  root.ScaffoldSucoot = Object.freeze({specs, previewCSV, mesh, fixedBase});
})(typeof window === 'undefined' ? globalThis : window);
