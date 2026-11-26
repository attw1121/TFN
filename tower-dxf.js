(function (root) {
  'use strict';

  const round = value => Number(value.toFixed(4));
  const xy = (group, [x, y]) => [group, x, group + 10, y, group + 20, 0];
  const angle = (x, y) => Math.atan2(y, x) * 180 / Math.PI;
  const sectionLinkRise = {rail: 12.7234, brace: 4.9001};

  function createDrawing() {
    const library = root.TowerDxfBlocks;
    const blocks = new Map();
    const entities = [];
    const schematic = new Set();
    const block = (name, outline = library?.[name], offsetY = 0) => {
      if (!blocks.has(name)) blocks.set(name, {outline, offsetY});
      return name;
    };
    const put = (layer, primitive) => entities.push({layer, primitive});
    const line = (layer, a, b) => put(layer, ['L', ...a, ...b]);
    const polyline = (layer, points, closed = true) => put(layer, ['P', closed, ...points.map(p => [...p, 0])]);
    const circle = (layer, center, radius) => put(layer, ['C', ...center, radius]);
    const text = (position, value, height, rotation = 0, centered = true) =>
      put('TEXT', ['T', position, value, height, rotation, centered]);
    const insert = (layer, name, position, scaleX = 1, scaleY = 1, rotation = 0) =>
      put(layer, ['I', name, position, scaleX, scaleY, rotation]);
    const hasBlock = name => Boolean(library?.[name]);

    function serialize({min, max}) {
      const template = root.TowerDxfTemplate;
      if (!template) throw new Error('DXF 格式資料未載入。');
      let number = 256;
      const next = () => (number++).toString(16).toUpperCase();
      const blockRecords = new Map([...blocks.keys()].map(name => [name, next()]));
      const out = [];
      function write(...data) {
        for (let i = 0; i < data.length; i += 2) {
          const value = data[i + 1];
          if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('DXF 圖面含有無效座標。');
          out.push(data[i], typeof value === 'number' ? round(value) : value);
        }
      }
      function entity(type, owner, layer, subclass, data) {
        write(0, type, 5, next(), 330, owner, 100, 'AcDbEntity', 8, layer, 100, subclass, ...data);
      }
      function writePrimitive(owner, layer, [type, ...p], offsetY = 0) {
        const point = (group, [x, y]) => xy(group, [x, y + offsetY]);
        switch (type) {
          case 'L':
            entity('LINE', owner, layer, 'AcDbLine', [...point(10, p), ...point(11, p.slice(2))]);
            break;
          case 'C':
          case 'A': {
            const data = [...point(10, p), 40, p[2]];
            if (type === 'A') data.push(100, 'AcDbArc', 50, p[3], 51, p[4]);
            entity(type === 'C' ? 'CIRCLE' : 'ARC', owner, layer, 'AcDbCircle', data);
            break;
          }
          case 'E':
            entity('ELLIPSE', owner, layer, 'AcDbEllipse', [...point(10, p), ...xy(11, p.slice(2, 4)),
              210, 0, 220, 0, 230, p[7], 40, p[4], 41, p[5], 42, p[6]]);
            break;
          case 'P':
            entity('LWPOLYLINE', owner, layer, 'AcDbPolyline', [90, p.length - 1, 70, p[0] ? 1 : 0,
              ...p.slice(1).flatMap(([x, y, bulge]) => [10, x, 20, y + offsetY, 42, bulge])]);
            break;
          case 'T': {
            const [position, value, height, rotation, centered] = p;
            entity('TEXT', owner, layer, 'AcDbText', [...xy(10, position), 40, height, 1, value, 50, rotation,
              7, 'TFN_TEXT', 72, centered ? 1 : 0, ...xy(11, position), 100, 'AcDbText', 73, 0]);
            break;
          }
          case 'I': {
            const [name, position, sx, sy, rotation] = p;
            entity('INSERT', owner, layer, 'AcDbBlockReference',
              [2, name, ...xy(10, position), 41, sx, 42, sy, 43, 1, 50, rotation]);
            break;
          }
        }
      }
      for (const [name, handle] of blockRecords) {
        write(0, 'BLOCK_RECORD', 5, handle, 330, template.blockTableOwner,
          100, 'AcDbSymbolTableRecord', 100, 'AcDbBlockTableRecord', 2, name, 340, '0', 70, 0, 280, 1, 281, 0);
      }
      out.push(template.beforeBlocks.slice(0, -1));
      for (const [name, {outline, offsetY}] of blocks) {
        const owner = blockRecords.get(name);
        entity('BLOCK', owner, '0', 'AcDbBlockBegin', [2, name, 70, 0, ...xy(10, [0, 0]), 3, name, 1, '']);
        for (const primitive of outline) writePrimitive(owner, '0', primitive, offsetY);
        entity('ENDBLK', owner, '0', 'AcDbBlockEnd', []);
      }
      out.push(template.beforeEntities.slice(0, -1));
      for (const {layer, primitive} of entities) writePrimitive(template.modelOwner, layer, primitive);
      const fields = {MIN_X: round(min[0]), MIN_Y: round(min[1]), MAX_X: round(max[0]), MAX_Y: round(max[1]),
        VIEW_X: round((min[0] + max[0]) / 2), VIEW_Y: round((min[1] + max[1]) / 2),
        VIEW_HEIGHT: round(max[1] - min[1]), RECORD_COUNT: blockRecords.size + 2, SEED: next()};
      const preamble = template.preamble.replace(/@([A-Z_]+)@/g, (_, key) => fields[key]);
      return (preamble + out.join('\n') + '\n' + template.trailer).replace(/\n/g, '\r\n');
    }

    return {block, put, line, polyline, circle, text, insert, hasBlock, schematic, serialize};
  }

  function exportDrawing({shape, layout, endExtension = 0, sideExtension = 0, groundProfiles = {}}) {
    if (!shape) throw new Error('請先填寫有效的電塔尺寸。');
    if (!root.TowerDxfBlocks) throw new Error('DXF 圖塊資料未載入。');
    const {beamArms, beamRotations, groundStations} = root.TowerFoundation;
    const {radius, length, clearance, top, outerSoffit, halfWidth, chord, projection, pier} = shape;
    const {line, polyline, circle, text, insert, block, hasBlock, schematic, serialize} = createDrawing();
    const family = new Map((layout?.armFrames ?? []).map(frame => [frame.arm, frame]));
    const extent = length / 2 + endExtension * 1000;
    const groundLength = projection + endExtension * 1000;
    const textHeight = Math.max(80, extent / 62);
    const spacing = textHeight * 2.3;
    const memberTextHeight = Math.min(82, textHeight * 0.52);
    const dimensionNumber = value => String(round(value));
    const mm = value => value * 1000;
    const project = point => point.slice(0, 2);
    const orient = arm => point => project(beamRotations[beamArms.indexOf(arm)]([...point, 0]));
    const prefix = (arm, item) => arm.toUpperCase() + ' ' + item;
    const sectionGround = new Map(beamArms.map(arm => [arm, groundStations(groundProfiles[arm], groundLength)]));

    function labelDimension(a, b, offset, label) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const distance = Math.hypot(dx, dy);
      if (!distance) return;
      const u = [dx / distance, dy / distance];
      const n = [-u[1], u[0]];
      const shift = (p, amount) => [p[0] + n[0] * amount, p[1] + n[1] * amount];
      const ends = [shift(a, offset), shift(b, offset)];
      line('DIMENSION', a, shift(ends[0], Math.sign(offset) * textHeight * 0.35));
      line('DIMENSION', b, shift(ends[1], Math.sign(offset) * textHeight * 0.35));
      line('DIMENSION', ...ends);
      for (const [x, y] of ends) {
        const tick = [(u[0] + n[0]) * textHeight * 0.28, (u[1] + n[1]) * textHeight * 0.28];
        line('DIMENSION', [x - tick[0], y - tick[1]], [x + tick[0], y + tick[1]]);
      }
      let rotation = angle(dx, dy);
      if (rotation > 90 || rotation <= -90) rotation += 180;
      text(shift([(ends[0][0] + ends[1][0]) / 2, (ends[0][1] + ends[1][1]) / 2], textHeight * 0.28),
        label ?? dimensionNumber(distance), textHeight, rotation);
    }

    function rectangle(layer, a, b, half, transform) {
      polyline(layer, [[a, -half], [b, -half], [b, half], [a, half]].map(transform));
    }

    function discConnections(member, kind) {
      const {start, end} = member;
      // The supplied brace blocks run from the lower disc to the upper disc.
      return kind === 'brace' && start[2] > end[2] ? [end, start] : [start, end];
    }

    function insertSchematicLink(a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      insert('SCHEMATIC', block('SCHEMATIC_LINK', [['L', 0, 0, 1, 0]]), a, Math.hypot(dx, dy), 1, angle(dx, dy));
    }

    function labelMember(code, a, b, offset, vertical = false) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (!length) return;
      const height = Math.min(memberTextHeight, length / Math.max(1, code.length * 0.63));
      const shortVertical = vertical && length < memberTextHeight * code.length * 0.7;
      let rotation = angle(dx, dy);
      if (rotation > 90 || rotation <= -90) rotation += 180;
      const x = (a[0] + b[0]) / 2 - dy / length * offset;
      const y = (a[1] + b[1]) / 2 + dx / length * offset;
      text([shortVertical ? x - height * code.length * 0.28 : x, y], code,
        shortVertical ? memberTextHeight * 0.86 : height, shortVertical ? 0 : rotation);
    }

    function insertPlanPart(member, a, b, category, side) {
      const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const name = 'P_' + member.code;
      const spec = layout.parts.get(member.code);
      const rotation = angle(b[0] - a[0], b[1] - a[1]);
      if (hasBlock(name)) {
        insert(category === 'brace' ? 'BRACE' : 'RAIL', block(name), a, width / mm(spec.size),
          category === 'brace' ? side : 1, rotation);
      } else {
        schematic.add(member.code);
        insertSchematicLink(a, b);
      }
      labelMember(member.code, a, b, side * (category === 'brace' ? 100 + memberTextHeight * 0.55 : -memberTextHeight * 0.9));
    }

    circle('WELL', [0, 0], radius);
    line('CENTER', [-extent, 0], [extent, 0]);
    line('CENTER', [0, -extent], [0, extent]);
    text([0, extent + spacing * 4.8], '電塔基座支撐平面圖（mm）', textHeight * 1.6);
    labelDimension([-length / 2, 0], [length / 2, 0], extent + spacing * 2.5, '(7) 梁全長 ' + dimensionNumber(length));
    labelDimension([-radius, 0], [radius, 0], spacing * 0.8, '(1) 井桶直徑 ' + dimensionNumber(radius * 2));
    const axesOrigin = [radius * 0.5, radius * 0.5];
    for (const [label, unit] of [['X', [1, 0]], ['Y', [0, 1]]]) {
      const mark = (along, cross = 0) => axesOrigin.map((value, i) =>
        value + along * unit[i] + cross * (i ? unit[0] : -unit[1]));
      const tip = Math.min(spacing * 1.4, radius * 0.3);
      line('CENTER', axesOrigin, mark(tip));
      for (const side of [-1, 1]) line('CENTER', mark(tip), mark(tip * 0.75, side * tip * 0.12));
      text(mark(tip + textHeight * 0.6), label, textHeight);
    }
    for (const arm of beamArms) {
      const toXY = orient(arm);
      const armFrame = family.get(arm);
      const frameEdge = mm(armFrame?.frameAcross.positions[0] ?? 0) - halfWidth;
      const planEdge = Math.min(-halfWidth - mm(sideExtension), frameEdge);
      if (pier) {
        rectangle('BEAM', chord, length / 2, halfWidth, toXY);
        rectangle('PEDESTAL', pier.start, pier.end, pier.halfWidth, toXY);
        line('PEDESTAL', toXY([pier.topEnd, -pier.halfWidth]), toXY([pier.topEnd, pier.halfWidth]));
        if (endExtension || sideExtension) rectangle('PLATFORM', radius, extent, halfWidth + mm(sideExtension), toXY);
        const lengthOffset = planEdge + halfWidth - spacing * 3.4;
        labelDimension(toXY([radius, -halfWidth]), toXY([length / 2, -halfWidth]), lengthOffset,
          '(2) ' + dimensionNumber(projection));
        if (endExtension) labelDimension(toXY([length / 2, -halfWidth]), toXY([extent, -halfWidth]), lengthOffset,
          dimensionNumber(mm(endExtension)));
        labelDimension(toXY([extent, -halfWidth]), toXY([extent, halfWidth]), -spacing, '(5) ' + dimensionNumber(2 * halfWidth));
      }
      text(toXY([extent + spacing * 3.35, 0]), prefix(arm, '梁'), textHeight * 1.2);
      if (!armFrame) continue;
      const {frame, frameAlong, frameAcross} = armFrame;
      const world = ([x, y]) => toXY([radius + mm(frameAlong.positions[0] + x), mm(frameAcross.positions[0] + y) - halfWidth]);
      for (const x of frameAlong.positions) for (const y of frameAcross.positions) {
        insert('SUPPORT', block('P_RING'), toXY([radius + mm(x), mm(y) - halfWidth]));
      }
      for (let i = 1; i < frameAcross.positions.length; i++) {
        labelDimension(toXY([extent, mm(frameAcross.positions[i - 1]) - halfWidth]),
          toXY([extent, mm(frameAcross.positions[i]) - halfWidth]), -spacing * 2.1,
          dimensionNumber(mm(frameAcross.gaps[i - 1])));
      }
      for (let i = 1; i < frameAlong.positions.length; i++) {
        labelDimension(toXY([radius + mm(frameAlong.positions[i - 1]), frameEdge]),
          toXY([radius + mm(frameAlong.positions[i]), frameEdge]), planEdge - frameEdge - spacing * 1.65,
          dimensionNumber(mm(frameAlong.gaps[i - 1])));
      }
      const projectedMembers = new Map();
      for (const member of frame.members) {
        const {kind} = layout.parts.get(member.code) ?? {};
        if (kind !== 'rail' && kind !== 'brace') continue;
        const [from, to] = discConnections(member, kind);
        const key = member.code + '/' + [world(from), world(to)].sort().flat().map(round).join('/');
        const previous = projectedMembers.get(key);
        if (!previous || from[2] < previous.from[2]) projectedMembers.set(key, {member, kind, from, to});
      }
      for (const {member, kind, from, to} of projectedMembers.values()) {
        const along = Math.abs(to[0] - from[0]) > 1e-7;
        const stations = along ? frameAcross.positions : frameAlong.positions;
        const row = stations.findIndex(value => Math.abs(value - stations[0] - from[along ? 1 : 0]) < 1e-7);
        // The last grid line faces outward even when it ends an incomplete pair.
        const outward = row === stations.length - 1 || row % 2 === 1 ? 1 : -1;
        const side = outward * (along ? Math.sign(to[0] - from[0]) : -Math.sign(to[1] - from[1]));
        insertPlanPart(member, world(from), world(to), kind, side);
      }
    }

    function sectionPart(member, mapPoint) {
      const spec = layout.parts.get(member.code);
      const [from, to] = discConnections(member, spec?.kind);
      const a = mapPoint(from), b = mapPoint(to);
      const vertical = Math.abs(b[0] - a[0]) < 1e-7;
      const labelSide = vertical || b[0] > a[0] ? 1 : -1;
      labelMember(member.code, a, b, labelSide * (vertical ? 75 : spec?.kind === 'brace' ? 65 : 70), vertical);
      const name = 'E_' + member.code;
      if (member.code === 'J48601') {
        insert('SUPPORT', block('E_J48601_PLATE'), a);
        insert('SUPPORT', block('E_J48601_NUT'), b);
        for (const x of [-24.1, 24.1]) line('SUPPORT', [a[0] + x, a[1] + 6], [b[0] + x, b[1] - 35]);
      } else if (member.code === 'U48601') {
        insert('SUPPORT', block('E_U48601_HEAD'), b);
        if (b[1] - a[1] > 106) for (const x of [-24.1, 24.1]) line('SUPPORT', [a[0] + x, a[1]], [b[0] + x, b[1] - 106]);
      } else if (hasBlock(name)) {
        if (spec?.kind === 'rail' || spec?.kind === 'brace') {
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          // Adjust the outline inside the block so its insertion point remains at the disc centre.
          insert(spec.kind === 'rail' ? 'RAIL' : 'BRACE', block(name, undefined, sectionLinkRise[spec.kind]), a, dx / mm(spec.size),
            spec.kind === 'brace' ? dz / mm(spec.rise) : 1);
        } else insert('SUPPORT', block(name), a);
      } else {
        schematic.add(member.code);
        if (spec?.kind === 'rail' || spec?.kind === 'brace') insertSchematicLink(a, b);
        else line('SCHEMATIC', a, b);
      }
    }

    const groundMin = Math.min(0, outerSoffit, ...[...sectionGround.values()].flat().map(([, z]) => z));
    const highest = Math.max(top + (pier?.height ?? 0), ...[...sectionGround.values()].flat().map(([, z]) => z));
    function section(left, right, datum) {
      const toXY = ([x, z]) => [x, z + datum];
      const profile = (layer, points) => polyline(layer, points.map(toXY));
      profile('WELL', [[-radius, 0], [radius, 0], [radius, top], [-radius, top]]);
      line('CENTER', toXY([-extent - spacing, 0]), toXY([extent + spacing, 0]));
      text(toXY([-extent - spacing * 1.6, textHeight * 0.35]), '±0', textHeight);
      text(toXY([0, highest + spacing * 2.1]), left.toUpperCase() + '–' + right.toUpperCase() + ' 剖面圖（mm）', textHeight * 1.6);
      labelDimension(toXY([-length / 2, top]), toXY([length / 2, top]), highest - top + spacing,
        '(7) 梁全長 ' + dimensionNumber(length));
      labelDimension(toXY([-radius, 0]), toXY([radius, 0]), groundMin - spacing * 1.2, '(1) ' + dimensionNumber(radius * 2));
      labelDimension(toXY([-radius, 0]), toXY([-radius, clearance]), extent - radius + spacing * 1.4, '(6) ' + dimensionNumber(clearance));
      labelDimension(toXY([-radius, clearance]), toXY([-radius, top]), extent - radius + spacing * 1.4, '(3) ' + dimensionNumber(top - clearance));
      for (const [arm, sign] of [[left, -1], [right, 1]]) {
        if (!pier) continue;
        const local = ([x, z]) => toXY([sign * x, z]);
        const localOutline = (layer, points) => polyline(layer, points.map(local));
        const tip = length / 2;
        localOutline('BEAM', [[radius, clearance], [tip, outerSoffit], [tip, top], [radius, top]]);
        localOutline('PEDESTAL', [[pier.start, top], [pier.end, top], [pier.topEnd, top + pier.height], [pier.start, top + pier.height]]);
        text(local([extent + spacing * 0.8, top + spacing * 0.35]), prefix(arm, '梁'), textHeight);
        labelDimension(local([radius, groundMin]), local([tip, groundMin]), -sign * spacing * 2.1, '(2) ' + dimensionNumber(projection));
        if (sign > 0) labelDimension(local([tip, outerSoffit]), local([tip, top]), -(extent - tip + spacing * 1.2),
          '(4) ' + dimensionNumber(top - outerSoffit));
        const ground = sectionGround.get(arm);
        polyline('GROUND', ground.map(([x, z]) => local([radius + x, z])), false);
        const stations = new Map();
        for (const [x, z] of ground) {
          if (!stations.has(x)) stations.set(x, []);
          stations.get(x).push(z);
        }
        let callout = 0;
        for (const [x, z] of stations) {
          if (!groundProfiles[arm]?.points.some(([distance]) => distance === x)) continue;
          const [labelX] = local([radius + x, 0]);
          const labelY = datum + groundMin - spacing * (3.1 + callout++ * 0.6);
          line('DIMENSION', local([radius + x, Math.min(...z)]), [labelX, labelY + textHeight]);
          text([labelX, labelY], dimensionNumber(x) + ': ' + z.map(dimensionNumber).join(' → '), textHeight * 0.8);
        }
        const armFrame = family.get(arm);
        if (!armFrame) continue;
        let depth = 0;
        for (const [layer, material] of [['FORMWORK', layout.board], ['TIMBER', layout.timber], ['STEEL', layout.steel]]) {
          const start = mm(layout.soffit(0)) - depth;
          const end = mm(layout.soffit(layout.totalLength)) - depth;
          depth += mm(material.height);
          localOutline(layer, [[radius, start], [extent, end], [extent, end - mm(material.height)], [radius, start - mm(material.height)]]);
        }
        const along = armFrame.frameAlong.positions;
        for (const member of armFrame.frame.members) {
          if (Math.abs(member.start[1]) > 1e-7 || Math.abs(member.end[1]) > 1e-7) continue;
          sectionPart(member, ([x, , z]) => local([radius + mm(along[0] + x), mm(z)]));
        }
        for (let i = 1; i < along.length; i++) {
          labelDimension(local([radius + mm(along[i - 1]), groundMin]), local([radius + mm(along[i]), groundMin]),
            -sign * spacing * 0.62, dimensionNumber(mm(armFrame.frameAlong.gaps[i - 1])));
        }
      }
      text(toXY([0, groundMin - spacing * 2.9]), '順梁剖面取外側一排支撐', textHeight * 0.8);
    }

    const maxPoints = Math.max(...[...sectionGround.values()].map(points => points.length));
    const firstDatum = -extent - highest - spacing * 7.3;
    const nextDatum = firstDatum - highest + groundMin - spacing * (6 + maxPoints * 0.6);
    section('a', 'c', firstDatum);
    section('b', 'd', nextDatum);
    const noteY = nextDatum + groundMin - spacing * (4 + maxPoints * 0.6);
    if (!family.size) text([0, noteY], '目前未配置支撐架', textHeight);
    else if (family.size !== beamArms.length) {
      text([0, noteY], '未配置大梁：' + beamArms.filter(arm => !family.has(arm)).sort().join('、').toUpperCase(), textHeight);
    }
    if (schematic.size) text([0, noteY - spacing], '下列料號無對應圖塊，採示意線：' + [...schematic].sort().join('、'), textHeight);
    const bound = extent + spacing * 5.8;
    return {content: serialize({min: [-bound, noteY - spacing * 2], max: [bound, bound]}),
      schematicParts: [...schematic].sort()};
  }

  root.TowerDxf = Object.freeze({exportDrawing});
})(typeof window === 'undefined' ? globalThis : window);
