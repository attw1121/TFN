(function (root) {
  'use strict';

  // 161kV 天輪～潭南 #40 塔基計算書，第三至五章。斷面與應力採 cm、kgf。
  const fixedDeflectionLimit = 0.30;

  function checks(type, section, span, line, cantilever = false) {
    const length = span * 100;
    const area = type === 'steel' ? section.shearArea : section.A;
    return [
      {criterion: '抗彎', demand: line * length ** 2 / ((cantilever ? 2 : 10) * section.Z), limit: section.fb, span},
      {criterion: '抗剪', demand: line * length / ((cantilever ? 1 : 2) * area), limit: section.fv, span},
      {criterion: '撓度', demand: line * length ** 4 / ((cantilever ? 8 : 128) * section.e * section.I),
        limit: type === 'timber' ? length / 240 : fixedDeflectionLimit, span}
    ].map(check => ({...check, cantilever}));
  }

  function lineCapacity(type, section, span, cantilever = false) {
    return Math.min(...checks(type, section, span, 1, cantilever).map(({demand, limit}) => limit / demand));
  }

  // Uniform line load. Span and displacement are entered in mm, load in tf/m.
  function beddingChecks(section, {span, load, deflection, cantilever}) {
    if (!section || ![section.Z, section.I, section.shearArea, section.fb, section.fv, section.e, span, deflection]
      .every(value => Number.isFinite(value) && value > 0) || !(Number.isFinite(load) && load >= 0)) return [];
    const length = span / 10;
    const w = load * 10;
    return [
      {criterion: '抗彎', demand: w * length ** 2 / ((cantilever ? 2 : 8) * section.Z), limit: section.fb},
      {criterion: '抗剪', demand: w * length / ((cantilever ? 1 : 2) * section.shearArea), limit: section.fv},
      {criterion: '撓度', demand: w * length ** 4 / ((cantilever ? 8 : 384 / 5) * section.e * section.I), limit: deflection / 10}
    ].map(check => ({...check, span: span / 1000, cantilever}));
  }

  // Board and steel have a fixed displacement limit in the reference.
  function spanLimit(type, section, line) {
    if (line === 0) return Infinity;
    const area = type === 'steel' ? section.shearArea : section.A;
    return Math.min(Math.sqrt(10 * section.Z * section.fb / line), 2 * area * section.fv / line,
      (128 * section.e * section.I * fixedDeflectionLimit / line) ** 0.25) / 100;
  }

  function timberPitch(timber, positions, width, sideExtension, pressure, platformPressure) {
    const leftEdge = -sideExtension;
    const rightEdge = width + sideExtension;
    const governing = new Map();
    // Extend the reference with cantilever checks for the unsupported edges.
    function check(start, end, cantilever) {
      const span = end - start;
      if (span <= 1e-8) return;
      const beamLoad = start < width && end > 0 ? pressure : 0;
      const platformLoad = start < 0 || end > width ? platformPressure : 0;
      const line = Math.max(beamLoad, platformLoad) * 10;
      for (const result of checks('timber', timber, span, line, cantilever)) {
        const pitch = result.limit / result.demand;
        if (!governing.has(result.criterion) || pitch < governing.get(result.criterion).pitch) {
          governing.set(result.criterion, {...result, pitch});
        }
      }
    }
    check(leftEdge, positions[0], true);
    for (let i = 1; i < positions.length; i++) check(positions[i - 1], positions[i], false);
    check(positions.at(-1), rightEdge, true);
    const results = [...governing.values()];
    return {...results.reduce((worst, result) => result.pitch < worst.pitch ? result : worst, {pitch: Infinity}), checks: results};
  }

  // One member line. Loads are tf at a point or tf/m on an interval, coordinates are m.
  function transferLine(section, loads, supports, edges, slope) {
    const positions = [edges[0], ...supports, edges[1]];
    const direct = supports.map(() => 0);
    const spans = positions.slice(1).map((end, i) => ({start: positions[i], end, force: 0, first: 0, line: 0, point: false}));
    for (const [start, end, intensity] of loads) {
      if (start === end) {
        const seat = supports.findIndex(x => Math.abs(x - start) < 1e-8);
        if (seat >= 0) direct[seat] += intensity;
        else {
          const span = spans.find(({start: a, end: b}) => a <= start && start <= b);
          span.force += intensity;
          span.first += intensity * (start - span.start);
          span.point = true;
        }
      } else for (const span of spans) {
        const a = Math.max(start, span.start), b = Math.min(end, span.end);
        if (b <= a) continue;
        const force = intensity * (b - a);
        span.force += force;
        span.first += force * ((a + b) / 2 - span.start);
        span.line = Math.max(span.line, intensity);
      }
    }
    const last = spans.length - 1;
    const endMoments = [-(spans[0].force * (spans[0].end - spans[0].start) - spans[0].first), -spans[last].first];
    direct[0] += spans[0].force;
    direct[direct.length - 1] += spans[last].force;
    const controlling = new Map();
    const stiffness = section.e * section.I;
    const endRotation = [0, 0];
    function record(span, force, moment, shear, displacement, cantilever) {
      const rows = [
        ['抗彎', moment * 100000 * slope / section.Z, section.fb],
        ['抗剪', shear * 1000 / section.shearArea, section.fv],
        ['撓度', displacement, section.type === 'timber' ? span * 100 / 240 : fixedDeflectionLimit]
      ];
      for (const [criterion, demand, limit] of rows) {
        if (demand / limit > (controlling.get(criterion)?.ratio ?? -1)) {
          controlling.set(criterion, {criterion, demand, limit, ratio: demand / limit, span, force, cantilever});
        }
      }
    }
    for (let i = 1; i < last; i++) {
      const {start, end, force, first, line, point} = spans[i];
      const length = end - start;
      const left = i === 1 ? endMoments[0] : 0;
      const right = i === last - 1 ? endMoments[1] : 0;
      const reaction = force - first / length + (right - left) / length;
      direct[i - 1] += reaction;
      direct[i] += force - reaction;
      const moment = Math.max(-left, -right, Math.min(force * length / 4, point ? Infinity : line * length ** 2 / 8));
      const cm = length * slope * 100;
      const rotation = moment * 100000 * slope * cm / (2 * stiffness);
      if (i === 1) endRotation[0] = rotation;
      if (i === last - 1) endRotation[1] = rotation;
      const displacement = Math.min(force * 1000 * cm ** 3 / 48,
        point ? Infinity : 5 * line * 10 / slope * cm ** 4 / 384) / stiffness +
        (-left - right) * 100000 * slope * cm ** 2 / (8 * stiffness);
      record(length * slope, force, moment, Math.max(Math.abs(reaction), Math.abs(force - reaction)), displacement, false);
    }
    for (const [side, span] of [[0, spans[0]], [1, spans[last]]]) {
      const length = (span.end - span.start) * slope;
      if (length < 1e-8) continue;
      const cm = length * 100;
      const displacement = Math.min(span.force * 1000 * cm ** 3 / 3,
        span.point ? Infinity : span.line * 10 / slope * cm ** 4 / 8) / stiffness + endRotation[side] * cm;
      record(length, span.force, -endMoments[side], span.force, displacement, true);
    }
    if (direct.some(force => force < -1e-8)) return null;
    return {reactions: direct.map(force => Math.max(0, force)), checks: [...controlling.values()]};
  }

  function layoutBedding(layers, x, y, {length, width, totalLength, extension, pressure, platform, boardSpan, slope}) {
    const axes = {along: {beam: length, edges: [0, totalLength], feet: x, slope},
      across: {beam: width, edges: [-extension, width + extension], feet: y, slope: 1}};
    const opposite = direction => direction === 'along' ? 'across' : 'along';
    function regular(axis, memberWidth, pitch) {
      const [start, end] = axis.edges;
      const usable = end - start - memberWidth;
      const bays = Math.max(1, Math.ceil(usable / pitch));
      if (usable / bays < memberWidth - 1e-8 || bays > 400) return null;
      return Array.from({length: bays + 1}, (_, i) => start + memberWidth / 2 + usable / bays * i);
    }
    for (const pitch of [0.9, 0.6, 0.45, 0.3, 0.225, 0.15, 0.1, 0.075, 0.05]) {
      const rows = [];
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i], below = rows[i + 1];
        const normal = axes[opposite(layer.direction)];
        const lanes = !below ? normal.feet : below.direction === layer.direction ? below.lanes
          : regular(normal, layer.width, i === 0 ? Math.min(pitch, boardSpan / normal.slope) : pitch);
        if (!lanes || lanes[0] - layer.width / 2 < normal.edges[0] - 1e-8 ||
          lanes.at(-1) + layer.width / 2 > normal.edges[1] + 1e-8 ||
          lanes.some((lane, j) => j && lane - lanes[j - 1] < layer.width - 1e-8)) break;
        rows[i] = {...layer, lanes};
      }
      if (!rows[0]) continue;
      const normal = axes[opposite(rows[0].direction)];
      const plane = axes[rows[0].direction];
      const cuts = [normal.edges[0], ...rows[0].lanes.slice(1).map((value, i) => (value + rows[0].lanes[i]) / 2), normal.edges[1]];
      const boardGap = Math.max(...rows[0].lanes.slice(1).map((v, i) => v - rows[0].lanes[i]),
        2 * (rows[0].lanes[0] - cuts[0]), 2 * (cuts.at(-1) - rows[0].lanes.at(-1))) * normal.slope;
      if (boardGap > boardSpan + 1e-8) continue;
      let incoming = rows[0].lanes.map((_, i) => {
        const tributary = cuts[i + 1] - cuts[i];
        const beamWidth = Math.max(0, Math.min(normal.beam, cuts[i + 1]) - Math.max(0, cuts[i]));
        return [[plane.edges[0], 0, tributary * platform], [0, plane.beam, beamWidth * pressure + (tributary - beamWidth) * platform],
          [plane.beam, plane.edges[1], tributary * platform]].filter(([a, b]) => b > a);
      });
      for (const [i, layer] of rows.entries()) {
        const below = rows[i + 1];
        if (below?.direction === layer.direction) {
          layer.checks = [];
          continue;
        }
        const axis = axes[layer.direction];
        const supports = below?.lanes ?? axis.feet;
        const lines = incoming.map(loads => transferLine(layer, loads, supports, axis.edges, axis.slope));
        if (lines.some(line => !line)) break;
        const governing = new Map();
        for (const {checks} of lines) for (const row of checks) {
          if (row.ratio > (governing.get(row.criterion)?.ratio ?? -1)) governing.set(row.criterion, row);
        }
        layer.checks = [...governing.values()];
        if (layer.checks.some(check => check.ratio > 1 + 1e-8)) break;
        const reactions = supports.map((_, column) => lines.map(line => line.reactions[column]));
        if (!below) {
          const footLoads = layer.direction === 'along' ? reactions : lines.map(line => line.reactions);
          return {rows, footLoads, boardGap, bottomSpan: Math.max(...supports.slice(1).map((v, j) => v - supports[j]))};
        }
        incoming = reactions.map(line => line.map((force, j) => [layer.lanes[j], layer.lanes[j], force]));
      }
    }
    return null;
  }

  root.TowerSucootMaterialChecks = Object.freeze({checks, lineCapacity, spanLimit, timberPitch, beddingChecks, layoutBedding});
})(typeof window === 'undefined' ? globalThis : window);
