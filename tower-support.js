(function (root) {
  'use strict';

  const edgeClearance = 0.10;
  const platformOptions = [0, 0.6, 0.9];
  const deflectionRatio = 240;
  const tolerance = 1e-8;
  const auxiliaryStacks = [[0.5, 0.25], [0.5], [0.25, 0.25], [0.25]];
  const auxiliaryCodes = {0.25: 'V62025', 0.5: 'V62050'};
  const terrainHardware = Object.freeze({maxLowerJack: 0.45, ringSpacing: 0.50, socketRingOffset: 0.10, firstPostRingOffset: 0.40});
  const pointKey = ([x, y]) => Math.round(x * 100000) + '/' + Math.round(y * 100000);
  const fixedCategories = {
    V62020: 'base', V62025: 'extension', V62050: 'extension', J48601: 'lowerJack', U48601: 'upperJack',
    J60350: 'fixedBase'
  };
  const catalogCategories = {frame: 'flat', main: 'post', rail: 'rail', brace: 'brace'};

  // Cross-section units are cm, kgf; candidate spans and tributary widths are m.
  function uniformChecks(section, span, line) {
    const length = span * 100;
    return [
      {criterion: '抗彎', demand: line * length ** 2 / (8 * section.Z), limit: section.fb, span},
      {criterion: '抗剪', demand: line * length / (2 * section.shearArea), limit: section.fv, span},
      {criterion: '撓度', demand: 5 * line * length ** 4 / (384 * section.e * section.I), limit: length / deflectionRatio, span}
    ];
  }

  function lineCapacity(section, span) {
    return Math.min(...uniformChecks(section, span, 1).map(({demand, limit}) => limit / demand));
  }

  function steelLoadFactor(span, offset) {
    return 2 * (1 + 2 * offset / span);
  }

  function maximumSteelSupportSpan(steel, line, offset, slopeLengthFactor, acceptedSpan) {
    if (line <= 0) return Infinity;
    const passes = span => line * steelLoadFactor(span, offset) <=
      lineCapacity(steel, span * slopeLengthFactor);
    let lower = 0;
    let upper = acceptedSpan;
    while (passes(upper)) {
      lower = upper;
      upper *= 2;
    }
    // The bending, shear and deflection utilization each increase with horizontal span.
    for (let i = 0; i < 48; i++) {
      const middle = (lower + upper) / 2;
      if (passes(middle)) lower = middle;
      else upper = middle;
    }
    return lower;
  }

  function axisCandidates(length, sizes, {shortBaysAtStart = false, allowShifts = false, leadingPlatformBay = 0} = {}) {
    const candidates = new Map();
    const usable = length - 2 * edgeClearance;
    for (const primary of sizes) {
      for (const last of sizes) {
        if (last > primary || last > usable + tolerance) continue;
        const repeats = Math.floor((usable - last + tolerance) / primary);
        if (repeats > 150) continue;
        const gaps = Array(repeats).fill(primary);
        const position = shortBaysAtStart && (last === 0.6 || last === 0.9) ? 0 : Math.floor(repeats / 2);
        gaps.splice(position, 0, last);
        if (leadingPlatformBay) gaps.unshift(leadingPlatformBay);
        const total = repeats * primary + last;
        const free = length - total;
        const maxEndMargin = Math.min(gaps.at(-1), leadingPlatformBay || Infinity) / 2;
        const minimum = Math.max(edgeClearance, free - maxEndMargin);
        const maximum = Math.min(free - edgeClearance, gaps[0] / 2);
        if (minimum > maximum + tolerance) continue;
        const centered = shortBaysAtStart ? Math.max(minimum, Math.min(maximum, free / 2)) : free / 2;
        const margins = allowShifts ? [centered, minimum, maximum] : [centered];
        for (const margin of margins) {
          const endMargin = free - margin;
          if (endMargin > maxEndMargin + tolerance || margin > gaps[0] / 2 + tolerance) continue;
          const nominal = Math.max(...gaps);
          const positions = [margin];
          for (const gap of gaps) positions.push(positions.at(-1) + gap);
          const key = gaps.join('/') + '/' + Math.round(margin / tolerance);
          if (!candidates.has(key)) candidates.set(key, {gaps, positions, nominal, endMargin, shifted: margin !== centered});
        }
      }
    }
    return [...candidates.values()];
  }

  function extendAxis(axis, length, startExtension, endExtension, endBayAtStart = false) {
    const positions = [...axis.positions];
    const gaps = [...axis.gaps];
    if (startExtension) {
      positions.unshift(positions[0] - startExtension);
      gaps.unshift(startExtension);
    }
    if (endExtension && !endBayAtStart) {
      positions.push(positions.at(-1) + endExtension);
      gaps.push(endExtension);
    }
    const boundaries = [-startExtension, ...positions.slice(1).map((position, index) => (position + positions[index]) / 2),
      length + endExtension];
    const strips = positions.map((_, index) => {
      const start = boundaries[index], end = boundaries[index + 1];
      const beam = Math.max(0, Math.min(length, end) - Math.max(0, start));
      return {beam, total: end - start};
    });
    return {gaps, positions, strips, nominal: Math.max(axis.nominal, startExtension, endExtension)};
  }

  // Each timber span is screened against the loads that actually cross it.
  // All loads and moments here apply to a one-metre longitudinal tributary strip.
  function timberPitchLimit(timber, positions, width, sideExtension, pressure, outsidePressure) {
    const loadZones = [[-sideExtension, 0, outsidePressure], [0, width, pressure],
      [width, width + sideExtension, outsidePressure]];
    const overhangs = [positions[0] + sideExtension, width + sideExtension - positions.at(-1)];
    const edgePressure = sideExtension ? outsidePressure : pressure;
    const endMoments = overhangs.map(length => -edgePressure * length ** 2 / 2);
    const stiffness = timber.e * timber.I;
    let limit = {pitch: Infinity, criterion: '', span: 0};
    const governing = new Map();
    function check(span, moment, shear, deformation) {
      const checks = [
        ['抗彎', moment * 100000 / timber.Z, timber.fb],
        ['抗剪', shear * 1000 / timber.shearArea, timber.fv],
        ['撓度', deformation * 1e9 / stiffness, span * 100 / deflectionRatio]
      ];
      for (const [criterion, demand, allowable] of checks) {
        const pitch = allowable / demand;
        if (pitch < limit.pitch) limit = {pitch, criterion, span};
        if (!governing.has(criterion) || pitch < governing.get(criterion).pitch) {
          governing.set(criterion, {criterion, demand, limit: allowable, span, pitch});
        }
      }
    }

    for (const span of overhangs) {
      if (span > tolerance && edgePressure > 0) {
        check(span, edgePressure * span ** 2 / 2, edgePressure * span, edgePressure * span ** 4 / 8);
      }
    }
    for (let i = 0; i < positions.length - 1; i++) {
      const left = positions[i], right = positions[i + 1], span = right - left;
      const patches = loadZones.map(([start, end, load]) => ({
        start: Math.max(left, start) - left, end: Math.min(right, end) - left, load
      })).filter(patch => patch.end > patch.start);
      const leftMoment = i === 0 ? endMoments[0] : 0;
      const rightMoment = i === positions.length - 2 ? endMoments[1] : 0;
      let total = 0, firstMoment = 0, maxPressure = 0;
      for (const {start, end, load} of patches) {
        const force = (end - start) * load;
        total += force;
        firstMoment += force * (start + end) / 2;
        maxPressure = Math.max(maxPressure, load);
      }
      let shear = (total * span - firstMoment + rightMoment - leftMoment) / span;
      let moment = leftMoment;
      let maxShear = Math.abs(shear);
      let maxMoment = Math.max(Math.abs(leftMoment), Math.abs(rightMoment));
      for (const {start, end, load} of patches) {
        const length = end - start;
        const nextShear = shear - load * length;
        if (shear > 0 && nextShear < 0) maxMoment = Math.max(maxMoment, Math.abs(moment + shear ** 2 / (2 * load)));
        moment += (shear + nextShear) * length / 2;
        shear = nextShear;
        maxShear = Math.max(maxShear, Math.abs(shear));
        maxMoment = Math.max(maxMoment, Math.abs(moment));
      }
      // Bound deflection by a uniform envelope or the total load at midspan.
      const deformation = Math.min(5 * maxPressure * span ** 4 / 384, total * span ** 3 / 48)
        + (Math.abs(leftMoment) + Math.abs(rightMoment)) * span ** 2 / 8;
      check(span, maxMoment, maxShear, deformation);
    }
    return {...limit, checks: [...governing.values()]};
  }

  function supportedLoad(alongStrip, acrossStrip, pressure, platformPressure) {
    const beamArea = alongStrip.beam * acrossStrip.beam;
    const totalArea = alongStrip.total * acrossStrip.total;
    return beamArea * pressure + (totalArea - beamArea) * platformPressure;
  }

  function legLoads(frame, along, across, parts, pressure, platformPressure, footLoads) {
    const masses = new Map();
    for (const member of frame.members) {
      const halfWeight = (parts.get(member.code)?.weight ?? 0) / 2;
      for (const end of [member.start, member.end]) {
        const point = pointKey(end);
        masses.set(point, (masses.get(point) ?? 0) + halfWeight);
      }
    }
    let maximum = 0;
    let governingLeg;
    const byPoint = new Map();
    for (const [i, x] of along.positions.entries()) {
      for (const [j, y] of across.positions.entries()) {
        const point = pointKey([x - along.positions[0], y - across.positions[0]]);
        const mass = masses.get(point) ?? 0;
        const transferredLoad = footLoads?.[i][j];
        const load = (transferredLoad ?? supportedLoad(along.strips[i], across.strips[j], pressure, platformPressure)) + mass / 1000;
        byPoint.set(point, load);
        if (load > maximum) {
          maximum = load;
          const beamArea = along.strips[i].beam * across.strips[j].beam;
          const totalArea = along.strips[i].total * across.strips[j].total;
          governingLeg = {x, y, beamArea, extensionArea: totalArea - beamArea, frameLoad: mass / 1000, load, transferredLoad};
        }
      }
    }
    return {byPoint, maximum, governingLeg};
  }

  function groupRingLevels(frame, x, y) {
    const {ringSpacing, socketRingOffset, firstPostRingOffset} = terrainHardware;
    const elevations = [];
    for (const member of frame.members) {
      const [memberX, memberY, bottom] = member.start;
      if (Math.abs(memberX - x) > 1e-7 || Math.abs(memberY - y) > 1e-7) continue;
      if (member.code === 'V62020') {
        elevations.push(bottom + socketRingOffset);
        continue;
      }
      if (!/^V6[01](?:100|150|200|300)$/.test(member.code)) continue;
      for (let z = bottom + firstPostRingOffset; z < member.end[2] - tolerance; z += ringSpacing) {
        elevations.push(z);
      }
    }
    return elevations;
  }

  function connectGroundGroups(left, right, rows, rail, fixedNeighborRule = false) {
    if (!rail) return null;
    const connections = [];
    for (const [index, y] of rows.entries()) {
      const from = left.farRings[index];
      const to = right.nearRings[index];
      const common = from.filter(z => to.some(other => Math.abs(z - other) <= 1e-7)).sort((a, b) => a - b);
      const shared = fixedNeighborRule ? fixedRailLevels(common, left.fixedStack, right.fixedStack) : common;
      if (!shared.length) return null;
      for (const [index, z] of shared.entries()) {
        if (index % 3 === 0 || index === shared.length - 1) connections.push({code: rail.code, y, z});
      }
    }
    return connections;
  }

  function groundRingPhases(levels) {
    const {maxLowerJack, ringSpacing, socketRingOffset} = terrainHardware;
    const minLowerJack = root.ScaffoldACT.MIN_LOWER_JACK_EXTENSION;
    const phase = height => ((height % ringSpacing) + ringSpacing) % ringSpacing;
    const boundaries = [...new Set(levels.flatMap(level => [
      phase(level + socketRingOffset + minLowerJack), phase(level + socketRingOffset + maxLowerJack)
    ]))].sort((a, b) => a - b);
    const midpoints = boundaries.map((start, index) =>
      phase((start + (boundaries[index + 1] ?? boundaries[0] + ringSpacing)) / 2));
    return [...new Set([phase(Math.max(...levels) + socketRingOffset + 0.20), ...midpoints, ...boundaries])];
  }

  function buildGroundGroups(along, across, levels, supportTop, buildFrame, parts) {
    const {positions, gaps} = along;
    if (positions.length < 4) return null;
    const rows = across.positions.map(position => position - across.positions[0]);
    const rails = new Map([...parts.values()].filter(part => part.kind === 'rail').map(part => [part.size, part]));
    let best;
    // Grow only braced groups that can be connected to a feasible suffix at the same ring phase.
    for (const ringPhase of groundRingPhases(levels)) {
      const groupsFrom = Array.from({length: positions.length}, () => []);
      for (let first = positions.length - 2; first >= 0; first--) {
        for (let last = first + 1; last < positions.length; last++) {
          const terminal = last === positions.length - 1;
          if ((first === 0 && terminal) || (!terminal && !groupsFrom[last + 1].length)) continue;
          let frame;
          try {
            frame = buildFrame(gaps.slice(first, last), across.gaps, supportTop(positions[first]),
              supportTop(positions[last]), levels.slice(first, last + 1), {ringPhase, firstRow: first});
          } catch (failure) {
            if (!failure.towerFrameFit) throw failure;
            if (failure.terrainRelief || failure.ringPhaseFit) break;
            continue;
          }
          const axes = new Set(frame.members.filter(member => parts.get(member.code)?.kind === 'brace')
            .map(member => Math.abs(member.start[0] - member.end[0]) > tolerance ? 'x' : 'y'));
          if (axes.size !== 2 || frame.issues.length) continue;
          const group = {first, last, frame, count: 1,
            nearRings: rows.map(y => groupRingLevels(frame, 0, y)),
            farRings: rows.map(y => groupRingLevels(frame, positions[last] - positions[first], y))};
          if (terminal) {
            groupsFrom[first].push(group);
            continue;
          }
          const suffixes = groupsFrom[last + 1].sort((a, b) => a.count - b.count);
          for (const next of suffixes) {
            const connections = connectGroundGroups(group, next, rows, rails.get(gaps[last]));
            if (!connections) continue;
            groupsFrom[first].push({...group, count: next.count + 1, next, connections});
            break;
          }
        }
      }
      for (const group of groupsFrom[0]) {
        if (!best || group.count < best.count) best = group;
      }
      if (best?.count === 2) break;
    }
    if (!best) return null;
    const members = [];
    for (let group = best, index = 1; group; group = group.next, index++) {
      const offset = positions[group.first] - positions[0];
      for (const member of group.frame.members) members.push({
        ...member, groundGroup: index,
        start: [member.start[0] + offset, member.start[1], member.start[2]],
        end: [member.end[0] + offset, member.end[1], member.end[2]]
      });
      if (!group.next) continue;
      const start = positions[group.last] - positions[0];
      const end = positions[group.next.first] - positions[0];
      for (const {code, y, z} of group.connections) {
        members.push({code, start: [start, y, z], end: [end, y, z], groundGroups: [index, index + 1]});
      }
    }
    return {members, products: best.frame.products, issues: [], groundGroupCount: best.count};
  }

  function fixedSupportStacks(top, ground, base, parts, minimum = root.ScaffoldACT.MIN_UPPER_JACK_EXTENSION) {
    const {MAX_UPPER_JACK_EXTENSION, JACK_TOLERANCE} = root.ScaffoldACT;
    return auxiliaryStacks.flatMap(stack => {
      const stackTop = stack.reduce((height, length) => height + length, ground + base.height);
      const extension = top - stackTop;
      if (extension < minimum - JACK_TOLERANCE ||
          extension >= MAX_UPPER_JACK_EXTENSION - JACK_TOLERANCE ||
          !parts.has('U48601') || stack.some(length => !parts.has(auxiliaryCodes[length]))) return [];
      const rings = [ground + base.ringHeight];
      const stackParts = [{code: base.code, bottom: ground, top: ground + base.height,
        shortStack: ['下底座', ...stack.map(length => length * 100 + ' cm')].join(' ＋ ')}];
      for (const length of stack) {
        const bottom = stackParts.at(-1).top;
        stackParts.push({code: auxiliaryCodes[length], bottom, top: bottom + length});
        // The existing auxiliary meshes are inverted, with their rings 100 mm below the tip.
        rings.push(bottom + length - 0.1);
      }
      stackParts.push({code: 'U48601', bottom: stackTop, top});
      return [{stackParts, rings, stackTop, auxiliary: stack}];
    });
  }

  function needsFixedSupportSplit(neighbor, support) {
    return neighbor?.auxiliary.length === 1 && neighbor.auxiliary[0] === 0.25 &&
      support?.auxiliary.length === 1 && support.auxiliary[0] === 0.5;
  }

  function fixedRailLevels(levels, left, right) {
    const has50And25 = stack => stack?.auxiliary[0] === 0.5 && stack.auxiliary[1] === 0.25;
    if (has50And25(left) && has50And25(right) && Math.abs(left.rings[2] - right.rings[2]) <= 1e-7) {
      return levels.filter(z => Math.abs(z - left.rings[1]) > 1e-7);
    }
    return levels;
  }

  function fixedStacksConnect(left, right) {
    if (!left || !right) return true;
    if (needsFixedSupportSplit(left, right) || needsFixedSupportSplit(right, left)) return false;
    const [short, tall] = left.auxiliary.length === 1 ? [left, right] : [right, left];
    const needsAuxiliaryRail = short.auxiliary.length === 1 && short.auxiliary[0] === 0.25 &&
      tall.auxiliary.length === 2 && tall.auxiliary.every(length => length === 0.25);
    return !needsAuxiliaryRail || Math.abs(short.rings[1] - tall.rings[1]) <= 1e-7;
  }

  function shortRowChoices(x, rows, acrossGaps, ground, top, base, parts, rails, fixedNeighborRule) {
    return fixedSupportStacks(top, ground, base, parts).map(stack => {
      const {stackParts, rings} = stack;
      const railLevels = fixedNeighborRule ? fixedRailLevels(rings, stack, stack) : rings;
      const members = rows.flatMap(y => stackParts.map(({bottom, top, ...part}) =>
        ({...part, start: [x, y, bottom], end: [x, y, top]})));
      for (const [index, gap] of acrossGaps.entries()) {
        for (const z of railLevels) {
          members.push({code: rails.get(gap).code, start: [x, rows[index], z], end: [x, rows[index + 1], z]});
        }
      }
      const rowRings = rows.map(() => rings);
      return {frame: {members, issues: []}, nearRings: rowRings, farRings: rowRings, fixedStack: stack};
    });
  }

  function buildLowClearanceFrame(along, across, levels, tops, base, buildFrame, parts, fixedNeighborRule) {
    const stations = along.positions.map(position => Number((position - along.positions[0]).toFixed(9)));
    const rows = across.positions.map(position => Number((position - across.positions[0]).toFixed(9)));
    const rails = new Map([...parts.values()].filter(({kind}) => kind === 'rail').map(part => [part.size, part]));
    const shortChoices = stations.map((x, i) =>
      shortRowChoices(x, rows, across.gaps, levels[i], tops[i], base, parts, rails, fixedNeighborRule));
    if (!shortChoices.some(choices => choices.length)) return null;
    const routes = stations.map(() => new Map());
    const lastRow = stations.length - 1;
    for (let first = lastRow; first >= 0; first--) {
      for (const choice of shortChoices[first]) saveRoute(first, first, choice, true);
      if (first > 0 && !shortChoices[first - 1].length) continue;
      for (let last = lastRow; last >= first; last--) {
        if (first === 0 && last === lastRow) continue;
        if (last < lastRow && ![...routes[last + 1].values()].some(route => route.short)) continue;
        for (const choice of regularChoices(first, last)) saveRoute(first, last, choice, false);
      }
    }

    function regularChoices(first, last) {
      const neighborRings = [shortChoices[first - 1], shortChoices[last + 1]]
        .flatMap(choices => choices?.flatMap(({nearRings}) => nearRings[0]) ?? []);
      const {ringSpacing} = terrainHardware;
      const phases = new Set(neighborRings.map(z => ((z % ringSpacing) + ringSpacing) % ringSpacing));
      const localLevels = levels.slice(first, last + 1);
      const gaps = along.gaps.slice(first, last);
      // Fit a single regular row against a duplicate, then retain its transverse members.
      if (!gaps.length) {
        gaps.push(along.gaps[first] ?? along.gaps[first - 1]);
        localLevels.push(localLevels[0]);
      }
      const choices = [];
      for (const ringPhase of [undefined, ...phases]) {
        try {
          const frame = buildFrame(gaps, across.gaps, tops[first], tops[last], localLevels, {ringPhase, firstRow: first});
          const distance = stations[last] - stations[first];
          const nearRings = rows.map(y => groupRingLevels(frame, 0, y));
          const farRings = rows.map(y => groupRingLevels(frame, distance, y));
          const members = frame.members.filter(member => first !== last || (member.start[0] === 0 && member.end[0] === 0))
            .map(member => ({...member, start: [member.start[0] + stations[first], ...member.start.slice(1)],
              end: [member.end[0] + stations[first], ...member.end.slice(1)]}));
          choices.push({frame: {...frame, members}, nearRings, farRings});
        } catch (failure) {
          if (!failure.towerFrameFit) throw failure;
        }
      }
      return choices;
    }

    function saveRoute(first, last, choice, short) {
      let best;
      const shortRows = Number(short);
      if (last === lastRow) best = {...choice, last, short, shortRows};
      else {
        for (const next of routes[last + 1].values()) {
          // Contiguous regular rows are fitted together as a single assembly.
          if ((!short && !next.short) || (best && best.shortRows <= shortRows + next.shortRows)) continue;
          if (fixedNeighborRule && !fixedStacksConnect(choice.fixedStack, next.fixedStack)) continue;
          const connections = connectGroundGroups(choice, next, rows, rails.get(along.gaps[last]), fixedNeighborRule);
          if (connections) best = {...choice, last, short, shortRows: shortRows + next.shortRows, next, connections};
        }
      }
      if (!best) return;
      // An upstream segment only needs the compatible near rings and the lowest short-row count.
      const key = short + '/' + JSON.stringify(choice.nearRings);
      const saved = routes[first].get(key);
      if (!saved || saved.shortRows > best.shortRows) routes[first].set(key, best);
    }

    const best = [...routes[0].values()].reduce((best, route) =>
      !best || route.shortRows < best.shortRows ? route : best, null);
    if (!best) {
      throw Object.assign(new Error('常規架與下底座組合無法配合支腳淨高或同高圓盤接點。'), {towerFrameFit: true});
    }
    const members = [];
    const products = {};
    const issues = new Set(['下底座短支撐僅配置同高圓盤的橫桿。短跨斜撐及架體穩定須另行檢核。']);
    for (let choice = best; choice; choice = choice.next) {
      members.push(...choice.frame.members);
      Object.assign(products, choice.frame.products);
      for (const issue of choice.frame.issues) issues.add(issue);
      if (!choice.next) continue;
      const from = stations[choice.last];
      const to = stations[choice.last + 1];
      for (const {code, y, z} of choice.connections) {
        members.push({code, start: [from, y, z], end: [to, y, z]});
      }
    }
    return {members, products, issues: [...issues]};
  }

  function plan(shape, {concrete, impact, live, legCapacity, board, timber, steel, layered,
    sideExtension = 0.9, endExtension = 0, platformPressure = live, groundProfiles = {}, materialMethod,
    endBayAtStart = false, allowedPartCodes, fixedNeighborRule = false}, catalog, buildFrame) {
    if (!(shape.projection > 0)) return {message: '梁突出長度為 0，無需配置外伸梁支撐。'};
    if (allowedPartCodes && !allowedPartCodes.size) return {message: '請先在支撐桿件清單勾選可用桿件。'};
    if (allowedPartCodes && !allowedPartCodes.has('U48601')) return {message: '請選用 U48601 上調整座，才能配置支撐。'};
    if (![concrete, impact, live, legCapacity].every(Number.isFinite)) return {message: '請填入有效的載重與載重試驗資料。'};
    if (![sideExtension, endExtension].every(value => platformOptions.includes(value))) {
      return {message: '施工平台可選不延伸、60 cm 或 90 cm。'};
    }
    if (!sideExtension && !endExtension) platformPressure = 0;
    if (!Number.isFinite(platformPressure) || platformPressure < 0) return {message: '施工平台延伸區面載重須為大於或等於 0 的數值。'};
    const selectedMaterials = layered ? layered.map((layer, i) => ['第 ' + (i + 1) + ' 層 ' + layer.name, layer])
      : [['木角材', timber], ['型鋼', steel]];
    const missingMaterials = [['模板', board], ...selectedMaterials].flatMap(([name, material]) => {
      if (!material) return [name + '尺寸'];
      const missing = [['e', 'E'], ['fb', 'Fb'], ['fv', 'Fv'], ...(layered ? [['Z', 'Z'], ['I', 'I'], ['shearArea', '受剪面積']] : [])]
        .filter(([key]) => !(Number.isFinite(material[key]) && material[key] > 0)).map(([, label]) => label);
      return missing.length ? [name + ' ' + missing.join('、')] : [];
    });
    if (missingMaterials.length) return {missingMaterials: true, message: '請補齊' + missingMaterials.join('；') + '，再產生支撐架。'};
    if (layered && !layered.length) return {message: '請至少新增一層墊條，再自動配置支撐架。'};
    if (layered?.at(-1)?.width > 0.158 + tolerance) return {message: '底層墊條寬度超過 U48601 上調整座的模型槽內寬 158 mm。'};

    const length = shape.projection / 1000;
    const totalLength = length + endExtension;
    const width = shape.width / 1000;
    const radius = shape.radius / 1000;
    if (width / 2 + sideExtension > radius + tolerance) {
      return {message: '目前井桶直徑及梁寬會使井桶旁的 ' + sideExtension * 100 + ' cm 兩側延伸區重疊。'};
    }
    const layerDepth = board.height + (layered ?? [timber, steel]).reduce((depth, layer) => depth + layer.height, 0);
    const slope = (shape.outerSoffit - shape.clearance) / shape.projection;
    const slopeLengthFactor = Math.hypot(1, slope);
    const soffit = distance => shape.clearance / 1000 + slope * distance;
    const pressure = concrete * Math.max(shape.innerDepth, shape.outerDepth) / 1000 + impact + live;
    if (!Number.isFinite(pressure) || !Number.isFinite(slope)) return {message: '尺寸或載重超出可計算範圍。'};
    const {beamArms, groundElevation, groundStations} = root.TowerFoundation;
    const shortArms = new Set(beamArms.filter(arm => groundStations(groundProfiles[arm], totalLength * 1000)
      .some(([distance, elevation]) => soffit(distance / 1000) - elevation / 1000 <= layerDepth)));
    if ((layered ?? [steel]).some(layer => layer.webSlenderness > 100 / Math.sqrt(layer.fy / 1000))) {
      return {message: '所選型鋼腹板深厚比超出基準剪應力的適用範圍，請選擇其他規格或另行檢核。'};
    }
    const available = allowedPartCodes ? catalog.filter(part => allowedPartCodes.has(part.code)) : catalog;
    const braces = new Set(available.filter(part => part.kind === 'brace' && part.rise === 1.5).map(part => part.size));
    const sizes = [...new Set(available.filter(part => part.kind === 'rail' && braces.has(part.size)).map(part => part.size))]
      .sort((a, b) => b - a);
    const missingExtension = [sideExtension, endExtension].find(value => value && !sizes.includes(value));
    if (missingExtension) return {message: (allowedPartCodes ? '請選用 ' : '桿件資料庫須有 ') +
      missingExtension * 100 + ' cm 橫桿及對應斜桿，才能配置延伸架。'};
    const adjustedArms = new Set(beamArms.filter(arm =>
      groundProfiles[arm]?.origin || groundProfiles[arm]?.points.some(([, elevation]) => elevation !== 0)));
    const along = axisCandidates(length, sizes, {shortBaysAtStart: true, allowShifts: adjustedArms.size > 0,
      leadingPlatformBay: endBayAtStart ? endExtension : 0})
      .filter(axis => !endExtension || axis.endMargin <= endExtension / 2 + tolerance)
      .map(axis => ({x: axis, frameAlong: extendAxis(axis, length, 0, endExtension, endBayAtStart)}));
    const across = axisCandidates(width, sizes);
    if (!along.length || !across.length) return {message: '梁底範圍放不下符合邊距的制式橫桿與斜桿跨距。'};

    // Maximum one-way span limits for the 1 m board strip.
    const boardLine = Math.max(pressure, platformPressure) * 10;
    const boardActualSpan = materialMethod ? materialMethod.spanLimit('board', board, boardLine) : Math.min(
      Math.sqrt(8 * board.fb * board.Z / boardLine),
      2 * board.fv * board.shearArea / boardLine,
      Math.cbrt(384 * board.e * board.I / (5 * deflectionRatio * boardLine))
    ) / 100;
    const boardSpan = boardActualSpan / slopeLengthFactor;
    const centimetres = (value, digits = 1) => (value * 100).toFixed(digits) + ' cm';
    if (!layered && boardSpan < timber.width - tolerance) {
      return {message: '目前載重下模板容許板跨上限為 ' + centimetres(boardSpan, 2) +
        '，小於木角材寬 ' + centimetres(timber.width) + '，無法排入角材。'};
    }
    const grids = [];
    const timberPitch = materialMethod?.timberPitch ?? timberPitchLimit;
    let widestTimberPitch = 0;
    let widestTimberCheck;
    for (const y of across) {
      if (sideExtension && Math.max(y.positions[0], y.endMargin) > sideExtension / 2 + tolerance) continue;
      const frameAcross = extendAxis(y, width, sideExtension, sideExtension);
      if (layered) {
        for (const {x, frameAlong} of along) {
          const legCount = frameAlong.positions.length * frameAcross.positions.length;
          if (legCount > 400) continue;
          const bedding = materialMethod.layoutBedding(layered, frameAlong.positions, frameAcross.positions,
            {length, width, totalLength, extension: sideExtension, pressure, platform: platformPressure,
              boardSpan: boardActualSpan, slope: slopeLengthFactor});
          if (!bedding || bedding.footLoads.some(row => row.some(load => load > legCapacity + tolerance))) continue;
          grids.push({x, y, frameAlong, frameAcross, legCount, bedding, joistSpans: bedding.rows[0].lanes.length - 1,
            joistPitch: bedding.boardGap / (layered[0].direction === 'across' ? slopeLengthFactor : 1)});
        }
        continue;
      }
      let timberCheck = timberPitch(timber, frameAcross.positions, width, sideExtension, pressure, platformPressure);
      let timberChecks = timberCheck.checks;
      if (endExtension) {
        const endCheck = timberPitch(timber, frameAcross.positions, width, sideExtension, platformPressure, platformPressure);
        const endByCriterion = new Map(endCheck.checks.map(check => [check.criterion, check]));
        timberChecks = timberChecks.map(check => endByCriterion.get(check.criterion)?.pitch < check.pitch
          ? endByCriterion.get(check.criterion) : check);
        if (endCheck.pitch < timberCheck.pitch) timberCheck = endCheck;
      }
      const maxTimberPitch = Math.min(boardSpan, timberCheck.pitch);
      if (maxTimberPitch > widestTimberPitch) {
        widestTimberPitch = maxTimberPitch;
        widestTimberCheck = timberCheck;
      }
      const joistSpans = Math.ceil(totalLength / maxTimberPitch);
      if (joistSpans > 400) continue;
      const joistPitch = totalLength / joistSpans;
      if (joistPitch < timber.width - tolerance) continue;
      if (y.positions[0] < steel.width / 2 - tolerance || frameAcross.gaps.some(gap => gap < steel.width - tolerance)) continue;
      const steelLineLoads = frameAcross.strips.map(({beam, total}) => {
        const beamBayLoad = beam * pressure + (total - beam) * platformPressure;
        return endExtension ? Math.max(beamBayLoad, total * platformPressure) : beamBayLoad;
      });
      const steelLine = Math.max(...steelLineLoads) * 10;
      for (const {x, frameAlong} of along) {
        const legCount = frameAlong.positions.length * frameAcross.positions.length;
        if (legCount > 400) continue;
        const spanOffset = Math.max(joistPitch, x.positions[0], x.endMargin);
        const steelFactor = materialMethod ? 1 : steelLoadFactor(frameAlong.nominal, spanOffset);
        const steelSpan = frameAlong.nominal * slopeLengthFactor;
        const steelOverhang = Math.max(frameAlong.positions[0], totalLength - frameAlong.positions.at(-1)) * slopeLengthFactor;
        const steelCapacity = materialMethod ? Math.min(materialMethod.lineCapacity('steel', steel, steelSpan),
          materialMethod.lineCapacity('steel', steel, steelOverhang, true)) : lineCapacity(steel, steelSpan);
        if (steelLine * steelFactor > steelCapacity + tolerance || frameAlong.strips.some(alongStrip =>
          frameAcross.strips.some(acrossStrip =>
            supportedLoad(alongStrip, acrossStrip, pressure, platformPressure) > legCapacity + tolerance))) continue;
        const boardSpanLength = joistPitch * slopeLengthFactor;
        grids.push({x, y, frameAlong, frameAcross, steelLineLoads, legCount, joistPitch, joistSpans, screening: {
          boardSpanLength, boardLine, boardCapacity: materialMethod
            ? materialMethod.lineCapacity('board', board, boardSpanLength) : lineCapacity(board, boardSpanLength),
          timberSpan: frameAcross.nominal, timberLine: boardLine * joistPitch, timberLimit: timberCheck.pitch, timberChecks,
          steelSpan, steelFactor, steelCapacity, spanOffset, steelOverhang
        }});
      }
    }
    if (!grids.length && widestTimberPitch > 0 && widestTimberPitch < timber.width - tolerance) {
      return {message: '梁身與延伸區檢核後，木角材間距上限為 ' + centimetres(widestTimberPitch, 2) +
        '，小於角材寬 ' + centimetres(timber.width) + '。控制項為木角材' + widestTimberCheck.criterion +
        '（跨距 ' + centimetres(widestTimberCheck.span) + '）。'};
    }
    grids.sort((a, b) => a.legCount - b.legCount || a.joistSpans - b.joistSpans || b.y.nominal - a.y.nominal);
    const parts = new Map(available.map(part => [part.code, part]));
    const base = root.ScaffoldSucoot?.fixedBase;
    const fixedBase = base && (!allowedPartCodes || allowedPartCodes.has(base.code)) ? base : null;
    if (fixedBase && !parts.has(fixedBase.code)) parts.set(fixedBase.code, {code: fixedBase.code, weight: fixedBase.weight});
    const fitFrame = allowedPartCodes ? buildSelectedFrame : buildFrame;

    function buildSelectedFrame(xGaps, yGaps, insideHeight, outsideHeight, levels, options) {
      const frame = buildFrame(xGaps, yGaps, insideHeight, outsideHeight, levels, {...options, allowedPartCodes});
      if (frame?.members.some(member => !allowedPartCodes.has(member.code))) {
        throw Object.assign(new Error('現有支撐架組合需使用未勾選的桿件。'), {towerFrameFit: true});
      }
      return frame;
    }
    const heightFailures = new Map();
    const splitEligible = new Set();
    const assembled = new Set();
    const pending = new Set(beamArms.filter(arm => !shortArms.has(arm)));
    const armFrames = [];
    const supportTop = distance => soffit(distance) - layerDepth;
    const spanGroups = sizes.map(span => grids.filter(({x}) => x.nominal === span));
    for (const spanGrids of spanGroups) {
      if (!pending.size) break;
      fitSpan(spanGrids, 'regular');
      fitSpan(spanGrids, 'split');
    }
    if (fixedBase) {
      for (const spanGrids of spanGroups) {
        if (!pending.size) break;
        fitSpan(spanGrids, 'short');
      }
    }

    function fitSpan(spanGrids, mode) {
      const candidates = [...pending].filter(arm => mode !== 'split' || splitEligible.has(arm));
      if (!candidates.length) return;
      for (const grid of spanGrids) {
        const {frameAlong, frameAcross} = grid;
        const fitted = new Map();
        for (const arm of candidates) {
          if (!pending.has(arm) || (grid.x.shifted && !adjustedArms.has(arm))) continue;
          const levels = frameAlong.positions.map(distance => groundElevation(groundProfiles[arm], distance * 1000) / 1000);
          const key = levels.join('/');
          if (!fitted.has(key)) {
            try {
              const tops = frameAlong.positions.map(supportTop);
              let frame;
              if (mode === 'short') {
                frame = buildLowClearanceFrame(frameAlong, frameAcross, levels, tops, fixedBase, fitFrame, parts, fixedNeighborRule);
              } else if (mode === 'split') {
                frame = buildGroundGroups(frameAlong, frameAcross, levels, supportTop, fitFrame, parts);
              } else {
                frame = fitFrame(frameAlong.gaps, frameAcross.gaps, tops[0], tops.at(-1), levels);
              }
              if (frame) {
                const {maximum, byPoint, governingLeg} = legLoads(frame, frameAlong, frameAcross, parts, pressure, platformPressure, grid.bedding?.footLoads);
                fitted.set(key, {frame, peakLegLoad: maximum, legLoadsByPoint: byPoint, governingLeg});
              } else {
                fitted.set(key, null);
              }
            } catch (failure) {
              if (!failure.towerFrameFit) throw failure;
              fitted.set(key, {failure});
            }
          }
          const result = fitted.get(key);
          if (!result) continue;
          if (result.failure) {
            heightFailures.set(arm, result.failure.message);
            if (result.failure.terrainRelief) splitEligible.add(arm);
            continue;
          }
          assembled.add(arm);
          if (result.peakLegLoad > legCapacity + tolerance) continue;
          pending.delete(arm);
          const steelSupportSpan = grid.bedding ? grid.bedding.bottomSpan : materialMethod
            ? materialMethod.spanLimit('steel', steel, Math.max(...grid.steelLineLoads) * 10) / slopeLengthFactor
            : maximumSteelSupportSpan(steel, Math.max(...grid.steelLineLoads) * 10, grid.screening.spanOffset, slopeLengthFactor, frameAlong.nominal);
          armFrames.push({arm, ...grid, ...result, steelSupportSpan});
        }
        if (!candidates.some(arm => pending.has(arm))) break;
      }
    }
    const unconfigured = [...shortArms, ...pending].sort().map(arm => arm + ' 梁未配置：' +
      (shortArms.has(arm) ? '梁底或梁端延伸處淨高不足。'
        : assembled.has(arm) ? '支腳荷載超出容許值。'
        : splitEligible.has(arm) ? '現有架材與下調整座行程內，找不到可用同高圓盤連接的分組。'
        : heightFailures.get(arm) ?? '目前沒有同時符合材料、單支荷載及制式間距的組合。'));
    if (!armFrames.length) return {message: unconfigured.join(' ')};
    const modelMemberCount = armFrames.reduce((count, {frame, bedding, joistSpans, frameAcross}) =>
      count + frame.members.length + 1 + (bedding ? bedding.rows.reduce((sum, layer) => sum + layer.lanes.length, 0)
        : 1 + joistSpans + frameAcross.positions.length), 9);
    if (modelMemberCount > 6000) return {message: '候選配置超出 3D 實體圖可顯示的桿件數量。'};
    armFrames.sort((a, b) => a.arm.localeCompare(b.arm));
    const peakLegLoad = Math.max(...armFrames.map(arm => arm.peakLegLoad));
    const legCount = armFrames.reduce((count, arm) => count + arm.legCount, 0);
    return {armFrames, unconfigured, legCount, length, totalLength, width, radius, soffit, pressure,
      sideExtension, endExtension, platformPressure, peakLegLoad, legCapacity, parts, board, timber, steel, materialMethod, layered};
  }

  function addToModel(base, layout) {
    const {armFrames, radius, totalLength, width, soffit, board, timber, steel,
      pressure, platformPressure, sideExtension, endExtension, legCapacity, parts} = layout;
    const extendedHalfWidth = width / 2 + sideExtension;
    const members = [...base.members];
    const {memberCategories: categories, beamArms, beamRotations} = root.TowerFoundation;
    const colors = {...base.colors};
    for (const {arm, frame, frameAlong, frameAcross, steelLineLoads, joistSpans, joistPitch, screening, legLoadsByPoint, bedding} of armFrames) {
      const orient = beamRotations[beamArms.indexOf(arm)];
      const saddleAxis = orient(bedding?.rows.at(-1).direction === 'across' ? [0, 1, 0] : [1, 0, 0]);
      const local = ([a, b, z]) => [a + radius + frameAlong.positions[0], b + frameAcross.positions[0] - width / 2, z];
      for (const member of frame.members) {
        const part = parts.get(member.code);
        const category = fixedCategories[member.code] ?? catalogCategories[part?.kind] ?? 'other';
        const start = orient(local(member.start));
        const end = orient(local(member.end));
        const modelLength = Math.hypot(...end.map((value, i) => value - start[i]));
        const facts = [];
        if (member.groundGroup) facts.push(['高差分組', member.groundGroup, '']);
        if (member.groundGroups) facts.push(['連接架組', member.groundGroups.join(' ↔ '), '']);
        if (member.shortStack) facts.push(['短支撐組合', member.shortStack, '']);
        if (part?.size > 0) facts.push([category === 'brace' || category === 'rail' ? '制式跨距' : '制式長度', part.size, 'm']);
        if (part?.rise > 0) facts.push(['制式高差', part.rise, 'm']);
        const jack = category === 'upperJack' || category === 'lowerJack';
        facts.push([jack ? '調整座伸出量' : '模型端點距離', modelLength, 'm']);
        if (category === 'upperJack') facts.push(['U 槽方向', saddleAxis[0] ? '沿 X 向墊條' : '沿 Y 向墊條', '']);
        if (part?.weight > 0) facts.push([category === 'fixedBase' && !part.kind ? '下底座估算單重' : '資料庫單重', part.weight, 'kg']);
        const legLoad = legLoadsByPoint.get(pointKey(member.start));
        const supportedLeg = category !== 'rail' && category !== 'brace' && Number.isFinite(legLoad);
        const loads = supportedLeg ? [
          ['該支腳估算垂直荷載', legLoad, 'tf'], ['單支支撐架容許荷載', legCapacity, 'tf'],
          ['支腳荷載比', legLoad / legCapacity * 100, '%']
        ] : [];
        const note = member.groundGroups ? '橫桿兩端接在相同高程的圓盤。' : supportedLeg ? '荷載為整支腳的配置估算。'
          : category === 'brace' ? member.note + '斜桿個別桿力尚未計算。'
          : '桿件用於水平連結。個別桿力尚未計算。';
        colors[member.code] = categories[category].color;
        members.push({...member, start, end, ...(category === 'upperJack' ? {saddleAxis} : {}),
          inspection: {category, arm, facts, loads, note, catalogCode: member.code}});
      }
      function prism(start, end, left, right, top, depth) {
        const ring = offset => [[start, left], [end, left], [end, right], [start, right]]
          .map(([a, b]) => orient([a + radius, b, soffit(a) - top - offset]));
        const lower = ring(depth), upper = ring(0);
        const triangles = [[lower[0], lower[2], lower[1]], [lower[0], lower[3], lower[2]],
          [upper[0], upper[1], upper[2]], [upper[0], upper[2], upper[3]]];
        for (let i = 0; i < 4; i++) {
          const next = (i + 1) % 4;
          triangles.push([lower[i], lower[next], upper[next]], [lower[i], upper[next], upper[i]]);
        }
        return {start: lower[0], end: upper[2], triangles};
      }
      function addLayer(code, category, mesh, facts, loads) {
        colors[code] = categories[category].color;
        members.push({code, ...mesh, inspection: {category, arm, facts, loads,
          note: '利用率取彎曲、剪力與撓度檢核的控制值。'}});
      }
      if (bedding) {
        addLayer('tower-form-panel', 'formwork', prism(0, totalLength, -extendedHalfWidth, extendedHalfWidth, 0, board.height),
          [['厚度', board.height * 1000, 'mm'], ['板跨', bedding.boardGap, 'm']], [['梁下估算面載重', pressure, 'tf/m²']]);
        let depth = board.height;
        for (const [i, layer] of bedding.rows.entries()) {
          const along = layer.direction === 'along';
          for (const lane of layer.lanes) {
            const center = along ? lane - width / 2 : lane;
            const half = layer.width / 2;
            const mesh = along ? prism(0, totalLength, center - half, center + half, depth, layer.height)
              : prism(center - half, center + half, -extendedHalfWidth, extendedHalfWidth, depth, layer.height);
            addLayer('tower-bedding-' + (i + 1), layer.type === 'timber' ? 'timber' : 'steel', mesh,
              [['材料', layer.name, ''], ['規格', layer.specification, ''], ['方向', layer.directionName, '']],
              layer.checks.map(({criterion, ratio}) => [criterion + '利用率', ratio * 100, '%']));
          }
          depth += layer.height;
        }
        continue;
      }
      addLayer('tower-form-panel', 'formwork',
        prism(0, totalLength, -extendedHalfWidth, extendedHalfWidth, 0, board.height),
        [['厚度', board.height * 1000, 'mm'], ['模板總寬', extendedHalfWidth * 2, 'm'],
          ['順梁水平總長', totalLength, 'm'], ['板跨', screening.boardSpanLength, 'm']],
        [['梁下估算面載重', pressure, 'tf/m²'],
          ...(sideExtension || endExtension ? [['延伸區面載重', platformPressure, 'tf/m²']] : []),
          ['板跨最大檢核利用率', screening.boardLine / screening.boardCapacity * 100, '%']]);
      for (let i = 0; i <= joistSpans; i++) {
        const distance = i * joistPitch;
        addLayer('tower-wood-joist', 'timber', prism(Math.max(0, distance - timber.width / 2),
          Math.min(totalLength, distance + timber.width / 2), -extendedHalfWidth, extendedHalfWidth, board.height, timber.height),
        [['斷面寬', timber.width * 1000, 'mm'], ['斷面高', timber.height * 1000, 'mm'],
          ['模型全長', extendedHalfWidth * 2, 'm'], ['採用最大跨距', screening.timberSpan, 'm']],
        [['檢核線載重上限', screening.timberLine / 10, 'tf/m'],
          ['最大檢核利用率', joistPitch / screening.timberLimit * 100, '%']]);
      }
      const girderTop = board.height + timber.height;
      for (const [rowIndex, row] of frameAcross.positions.entries()) {
        const center = row - width / 2;
        const top = prism(0, totalLength, center - steel.width / 2, center + steel.width / 2, girderTop, steel.flange);
        const web = prism(0, totalLength, center - steel.web / 2, center + steel.web / 2,
          girderTop + steel.flange, steel.height - 2 * steel.flange);
        const bottom = prism(0, totalLength, center - steel.width / 2, center + steel.width / 2,
          girderTop + steel.height - steel.flange, steel.flange);
        const lineLoad = steelLineLoads[rowIndex];
        const equivalentLoad = lineLoad * screening.steelFactor;
        const spec = [steel.height, steel.width, steel.web, steel.flange].map(value => Math.round(value * 10000) / 10);
        addLayer('tower-steel-girder', 'steel', {...top, triangles: [...top.triangles, ...web.triangles, ...bottom.triangles]},
          [['H 型鋼規格', spec.join(' × '), 'mm'], ['模型全長', Math.hypot(totalLength, soffit(totalLength) - soffit(0)), 'm'],
            ['採用最大跨距', screening.steelSpan, 'm']],
          [['最大分攤線載重', lineLoad, 'tf/m'], ['檢核等效線載重', equivalentLoad, 'tf/m'],
            ['該排最大檢核利用率', equivalentLoad * 10 / screening.steelCapacity * 100, '%']]);
      }
    }
    const tip = radius + totalLength;
    const bounds = {
      min: [-tip, -tip, base.bounds.min[2]],
      max: [tip, tip, Math.max(base.bounds.max[2], soffit(totalLength))]
    };
    const centerZ = (bounds.min[2] + bounds.max[2]) / 2;
    let fitRadius = 0.5;
    for (const member of members) {
      const points = member.triangles?.flat() ?? [member.start, member.end];
      for (const [x, y, z] of points) fitRadius = Math.max(fitRadius, Math.hypot(x, y, z - centerZ));
    }
    for (const line of base.groundLines ?? []) {
      for (const [x, y, z] of line) fitRadius = Math.max(fitRadius, Math.hypot(x, y, z - centerZ));
    }
    return {...base, bounds, fitRadius, members, products: armFrames[0].frame.products, colors};
  }

  function getMaterialChecks(layout, arm) {
    if (arm.bedding) return {board: layout.materialMethod.checks('board', layout.board, arm.bedding.boardGap,
      Math.max(layout.pressure, layout.platformPressure) * 10), bedding: arm.bedding.rows.map(layer => layer.checks)};
    const {screening, steelLineLoads, joistPitch} = arm;
    const steelLine = Math.max(...steelLineLoads) * 10 * screening.steelFactor;
    const {materialMethod} = layout;
    if (materialMethod) {
      const steelSpanChecks = materialMethod.checks('steel', layout.steel, screening.steelSpan, steelLine);
      const steelEndChecks = materialMethod.checks('steel', layout.steel, screening.steelOverhang, steelLine, true);
      return {
        board: materialMethod.checks('board', layout.board, screening.boardSpanLength, screening.boardLine),
        timber: screening.timberChecks.map(check => ({...check, demand: check.demand * joistPitch})),
        steel: steelSpanChecks.map((check, i) => steelEndChecks[i].demand / steelEndChecks[i].limit > check.demand / check.limit
          ? steelEndChecks[i] : check)
      };
    }
    return {
      board: uniformChecks(layout.board, screening.boardSpanLength, screening.boardLine),
      timber: screening.timberChecks.map(check => ({...check, demand: check.demand * joistPitch})),
      steel: uniformChecks(layout.steel, screening.steelSpan, steelLine)
    };
  }

  function summarizeParts(armFrames, parts) {
    const totalsByCode = new Map();
    const byBeam = new Map();
    let totalQuantity = 0;
    for (const {arm, frame} of armFrames) {
      const counts = new Map();
      for (const {code} of frame.members) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
        totalsByCode.set(code, (totalsByCode.get(code) ?? 0) + 1);
      }
      byBeam.set(arm, {counts, total: frame.members.length});
      totalQuantity += frame.members.length;
    }
    const rows = [...totalsByCode].sort(([a], [b]) => a.localeCompare(b)).map(([code, quantity]) => {
      const weight = parts?.get(code)?.weight;
      const unitWeight = Number.isFinite(weight) && weight > 0 ? weight : null;
      return {code, quantity, unitWeight, weight: unitWeight === null ? null : quantity * unitWeight};
    });
    return {byBeam, rows, totalQuantity, weight: rows.reduce((sum, row) => sum + (row.weight ?? 0), 0),
      hasMissingWeights: rows.some(row => row.weight === null)};
  }

  root.TowerSupport = Object.freeze({
    plan, addToModel, getMaterialChecks, summarizeParts, fixedSupportStacks, needsFixedSupportSplit, fixedRailLevels, terrainHardware
  });
})(typeof window === 'undefined' ? globalThis : window);
