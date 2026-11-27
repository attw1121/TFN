window.mountTowerFoundation = function (options) {
  'use strict';

  const {getCatalog, buildFrame, materialMethod, endBayAtStart = false, fixedNeighborRule = false} = options;
  const {dimensions, example, beamArms, colors, memberCategories, calculate, makeModel, groundElevation, groundStations, woodMaterials,
    steelProfiles, rectangleSection, steelSection, beddingSection} = window.TowerFoundation;
  const byId = id => document.getElementById('tower-' + id);
  const form = byId('form');
  const fields = byId('fields');
  const output = byId('length');
  const error = byId('error');
  const modelError = byId('model-error');
  const loadForm = byId('load-form');
  const loadError = byId('load-error');
  const supportStatus = byId('support-status');
  const previewStatus = byId('preview-status');
  const supportResults = byId('support-results');
  const supportIssues = byId('support-issues');
  const legend = byId('legend');
  const inspector = byId('member-inspector');
  const platformLoad = byId('platform-load');
  const sideExtensionSelect = byId('side-extension');
  const endExtensionSelect = byId('end-extension');
  const materialFields = byId('material-fields');
  let supportLoads;
  let currentShape;
  let baseModel;
  let supportUpdate = 0;
  let groundProfiles = {};
  let groundVersion = 0;
  let renderedGroundVersion;
  let renderedEndExtension;
  const sectionGrounds = new Map();
  const numberFormat = new Intl.NumberFormat('zh-TW', {maximumFractionDigits: 10});
  const detailFormat = new Intl.NumberFormat('zh-TW', {maximumFractionDigits: 3});
  const background = '#f8fbfa';
  const ink = '#314e54';
  const [east, north, west, south] = beamArms;
  const sectionWidth = 500;
  const sectionHeight = 346;
  const sectionSupportStyles = {
    brace: {label: '斜桿', width: 1.35},
    rail: {label: '橫桿', width: 1.4},
    post: {label: '立桿', width: 1.8},
    lowerJack: {label: '調整座', width: 2.4}
  };
  const inputs = Object.fromEntries(dimensions.map(({key, number, label, min}) => {
    const field = document.createElement('label');
    field.textContent = number + ' ' + label;
    const input = document.createElement('input');
    input.id = 'tower-' + key;
    input.name = key;
    input.type = 'number';
    input.min = min;
    input.step = 'any';
    input.required = true;
    input.setAttribute('aria-describedby', error.id);
    field.append(input);
    fields.append(field);
    return [key, input];
  }));

  function canvas(name, description, width = 500, height = 320) {
    const element = byId(name);
    element.width = width * 2;
    element.height = height * 2;
    element.setAttribute('aria-label', description);
    const ctx = element.getContext('2d');
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1.15;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 15px "Segoe UI", "Microsoft JhengHei", sans-serif';
    return ctx;
  }

  function line(ctx, a, b) {
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.stroke();
  }

  function polygon(ctx, points, fill) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    points.slice(1).forEach(point => ctx.lineTo(...point));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  }

  function text(ctx, content, x, y) {
    const width = ctx.measureText(content).width + 8;
    ctx.fillStyle = background;
    ctx.fillRect(x - width / 2, y - 9, width, 18);
    ctx.fillStyle = ink;
    ctx.fillText(content, x, y);
  }

  function beamMark(ctx, code, x, y) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, 2 * Math.PI);
    ctx.fillStyle = '#17665d';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(code, x, y - 0.5);
    ctx.restore();
  }

  function measure(ctx, axis, start, end, offset, label, position = (start[0] + end[0]) / 2) {
    const point = (value, fixed) => axis === 'x' ? [value, fixed] : [fixed, value];
    ctx.save();
    ctx.strokeStyle = '#52777b';
    const tick = (a, b) => {
      line(ctx, point(a, b), point(a, offset));
      line(ctx, point(a - 3, offset - 3), point(a + 3, offset + 3));
    };
    tick(...start);
    tick(...end);
    line(ctx, point(start[0], offset), point(end[0], offset));
    const labelPoint = axis === 'x' ? [position, offset - 10] : [offset, position];
    text(ctx, label, ...labelPoint);
    ctx.restore();
  }

  const annotated = (number, value) => number + ' ' + numberFormat.format(value);
  const describe = (title, shape, keys) => title + '，單位 mm。' + dimensions
    .filter(({key}) => keys.includes(key))
    .map(({key, number, label}) => annotated(number + ' ' + label, shape[key]))
    .concat(annotated('⑦ 梁全長', shape.length)).join('，');

  function drawPlan(shape) {
    const {radius, length, halfWidth, chord, pier} = shape;
    const title = pier ? '平面圖，從六點鐘方向順時針為 ' + [south, west, north, east].join('、') : '平面圖';
    const ctx = canvas('plan', describe(title, shape, ['diameter', 'projection', 'width']));
    const scale = 224 / length;
    const tip = length / 2;
    const x = value => 250 + value * scale;
    const y = value => 163 - value * scale;
    if (pier) {
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.translate(x(0), y(0));
        ctx.rotate(i * Math.PI / 2);
        const rect = (start, end, half, fill) => polygon(ctx, [
          [start * scale, -half * scale], [end * scale, -half * scale],
          [end * scale, half * scale], [start * scale, half * scale]
        ], fill);
        rect(chord, tip, halfWidth, '#d4ebe5');
        rect(pier.start, pier.end, pier.halfWidth, '#f6e0b9');
        line(ctx, [pier.topEnd * scale, -pier.halfWidth * scale], [pier.topEnd * scale, pier.halfWidth * scale]);
        ctx.restore();
      }
    }
    ctx.beginPath();
    ctx.arc(x(0), y(0), radius * scale, 0, 2 * Math.PI);
    ctx.fillStyle = '#dce8ec';
    ctx.fill();
    ctx.stroke();
    if (pier) {
      ctx.save();
      ctx.strokeStyle = '#17665d';
      ctx.setLineDash([5, 4]);
      line(ctx, [x(0), y(-tip)], [x(0), y(tip)]);
      line(ctx, [x(-tip), y(0)], [x(tip), y(0)]);
      ctx.restore();
    }
    measure(ctx, 'x', [x(-tip), y(halfWidth)], [x(tip), y(halfWidth)], 29, annotated('⑦', length));
    measure(ctx, 'y', [y(halfWidth), x(tip)], [y(-halfWidth), x(tip)], 425, annotated('⑤', shape.width));
    measure(ctx, 'x', [x(-radius), y(0)], [x(radius), y(0)], 177, annotated('①', shape.diameter));
    measure(ctx, 'x', [x(radius), y(-halfWidth)], [x(tip), y(-halfWidth)], 290, annotated('②', shape.projection));
    if (pier) {
      beamMark(ctx, south, x(0), y(-tip) + 11);
      beamMark(ctx, west, x(-tip) - 11, y(0));
      beamMark(ctx, north, x(0), y(tip) - 11);
      beamMark(ctx, east, x(tip) + 11, y(0));
    }
  }

  function drawSection(shape, left, right, endExtension, model) {
    const {radius, length, top, clearance, outerSoffit, pier} = shape;
    const name = 'section-' + left + right;
    const axis = left === south ? 1 : 0;
    const transverse = 1 - axis;
    const supportLines = [];
    const supportedArms = new Set();
    for (const {start, end, triangles, inspection} of model?.members ?? []) {
      if (triangles || (inspection?.arm !== left && inspection?.arm !== right)) continue;
      // Transverse rails and braces are out of the longitudinal projection.
      if (Math.abs(start[transverse] - end[transverse]) > 1e-7) continue;
      const {category, arm} = inspection;
      const style = category === 'upperJack' ? 'lowerJack' : Object.hasOwn(sectionSupportStyles, category) ? category : 'post';
      supportLines.push({start: [start[axis] * 1000, start[2] * 1000], end: [end[axis] * 1000, end[2] * 1000], style});
      supportedArms.add(arm);
    }
    const missingArms = [left, right].filter(arm => !supportedArms.has(arm));
    const supportNote = supportedArms.size
      ? '支撐架順梁投影' + (missingArms.length ? '，' + missingArms[0] + ' 梁未配置' : '')
      : '尚未產生支撐架配置';
    const title = left + '–' + right + ' 剖面，由左至右為 ' + left + ' 梁、井桶、' + right + ' 梁' +
      (pier ? '。深綠線為可編輯的地面線。' + supportNote : '');
    const ctx = canvas(name, describe(title, shape,
      ['diameter', 'projection', 'innerDepth', 'outerDepth', 'clearance']), sectionWidth, sectionHeight);
    const tip = length / 2;
    const groundLength = shape.projection + endExtension;
    const grounds = pier ? [left, right].map((arm, index) => {
      const stations = groundStations(groundProfiles[arm], groundLength);
      return {arm, sign: index ? 1 : -1, stations};
    }) : [];
    const elevations = grounds.flatMap(({stations}) => stations.map(([, elevation]) => elevation));
    for (const {start, end} of supportLines) elevations.push(start[1], end[1]);
    const lowest = pier ? Math.min(0, outerSoffit, ...elevations) : 0;
    const highest = top + (pier?.height ?? 0);
    const scale = Math.min(328 / (length + 2 * endExtension), 178 / (Math.max(highest, ...elevations) - lowest));
    const x = value => 250 + value * scale;
    const y = value => 238 - (value - lowest) * scale;
    const profile = (points, fill) => polygon(ctx, points.map(([distance, height]) => [x(distance), y(height)]), fill);
    profile([[-radius, 0], [radius, 0], [radius, top], [-radius, top]], '#dce8ec');
    if (pier) {
      for (const side of [-1, 1]) {
        const arm = (points, fill) => profile(points.map(([distance, height]) => [side * distance, height]), fill);
        arm([[radius, clearance], [tip, outerSoffit], [tip, top], [radius, top]], '#d4ebe5');
        arm([[pier.start, top], [pier.end, top], [pier.topEnd, highest], [pier.start, highest]], '#f6e0b9');
      }
    }
    ctx.setLineDash([5, 4]);
    line(ctx, [67, y(0)], [433, y(0)]);
    ctx.setLineDash([]);
    if (supportLines.length) {
      ctx.save();
      for (const [style, {width}] of Object.entries(sectionSupportStyles)) {
        ctx.strokeStyle = memberCategories[style].color;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (const {start, end, style: type} of supportLines) {
          if (type !== style) continue;
          ctx.moveTo(x(start[0]), y(start[1]));
          ctx.lineTo(x(end[0]), y(end[1]));
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    text(ctx, '±0 基準', 461, y(0));
    measure(ctx, 'x', [x(-tip), y(top)], [x(tip), y(top)], 30, annotated('⑦', length));
    // Stagger the vertical labels when the projected dimension lines are short.
    const innerMid = (y(top) + y(clearance)) / 2;
    const clearanceMid = Math.max(innerMid + 22, (y(clearance) + y(0)) / 2);
    measure(ctx, 'y', [y(top), x(-radius)], [y(clearance), x(-radius)], 42, annotated('③', shape.innerDepth), innerMid);
    measure(ctx, 'y', [y(clearance), x(-radius)], [y(0), 67], 42, annotated('⑥', clearance), clearanceMid);
    if (pier) {
      measure(ctx, 'y', [y(top), x(tip)], [y(outerSoffit), x(tip)], 457, annotated('④', shape.outerDepth),
        Math.min(y(0) - 22, (y(top) + y(outerSoffit)) / 2));
    }
    measure(ctx, 'x', [x(-radius), y(0)], [x(radius), y(0)], 269, annotated('①', shape.diameter));
    measure(ctx, 'x', [x(radius), y(clearance)], [x(tip), y(pier ? outerSoffit : clearance)], 306, annotated('②', shape.projection));
    if (pier) {
      const markerY = Math.max(49, y(top) - 14);
      beamMark(ctx, left, x(-tip) - 12, markerY);
      beamMark(ctx, right, x(tip) + 12, markerY);
    }
    for (const ground of grounds) {
      const {arm, stations, sign} = ground;
      const profile = groundProfiles[arm];
      ground.path = stations.map(([distance, elevation]) => [x(sign * (radius + distance)), y(elevation)]);
      ground.handles = stations.map(([distance], index) => ({distance, point: ground.path[index], pointIndex: index - 1}))
        .filter(({distance, pointIndex}) => distance === 0 || profile?.points[pointIndex]?.[0] === distance);
      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#17665d';
      ctx.fillStyle = '#17665d';
      for (let i = 1; i < ground.path.length; i++) line(ctx, ground.path[i - 1], ground.path[i]);
      for (const {point} of ground.handles) {
        ctx.beginPath();
        ctx.arc(...point, 3.5, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.restore();
    }
    if (pier) {
      ctx.save();
      ctx.font = '600 12px "Segoe UI", "Microsoft JhengHei", sans-serif';
      const legendY = 330;
      if (supportLines.length) {
        let cursor = 24;
        ctx.textAlign = 'left';
        ctx.fillStyle = ink;
        ctx.fillText(supportNote, cursor, legendY);
        cursor += ctx.measureText(supportNote).width + 18;
        for (const [style, {label, width}] of Object.entries(sectionSupportStyles)) {
          ctx.strokeStyle = memberCategories[style].color;
          ctx.lineWidth = width;
          line(ctx, [cursor, legendY], [cursor + 13, legendY]);
          ctx.fillText(label, cursor + 17, legendY);
          cursor += ctx.measureText(label).width + 31;
        }
      } else {
        ctx.fillStyle = ink;
        ctx.fillText(supportNote, sectionWidth / 2, legendY);
      }
      ctx.restore();
    }
    sectionGrounds.set(byId(name), {grounds, groundLength});
  }

  function setupGroundEditor() {
    const dialog = byId('ground-dialog');
    const editor = byId('ground-form');
    const mode = byId('ground-mode');
    const clearance = byId('ground-clearance');
    const pointList = byId('ground-points');
    const add = byId('ground-add');
    const message = byId('ground-error');
    let arm;
    let maxDistance;
    let outsidePoints;
    let originalClearance;

    function showMode() {
      const pointMode = mode.value === 'point';
      byId('ground-point-fields').hidden = !pointMode;
      byId('ground-clearance-field').hidden = pointMode;
      message.hidden = true;
      byId('ground-note').textContent = pointMode
        ? '以井桶外壁的地面交點為 (0, 0)。同一距離最多輸入兩筆，第一筆為原高，第二筆為下切或上抬後高程。' +
          (outsidePoints.length ? '超出目前梁端範圍的既有點仍保留。' : '末點以外維持末點高程。')
        : '設定井桶外壁處梁底到地面的淨高，各地面點會等量升降。';
    }

    function updatePointLabels() {
      const rows = [...pointList.children];
      const counts = new Map();
      for (const row of rows) {
        const distance = row.querySelector('input').valueAsNumber;
        counts.set(distance, (counts.get(distance) ?? 0) + 1);
      }
      const seen = new Set();
      for (const row of rows) {
        const distance = row.querySelector('input').valueAsNumber;
        const label = row.querySelector('[data-ground-elevation-label]');
        label.textContent = Number.isFinite(distance) && counts.get(distance) > 1
          ? (seen.has(distance) ? '下切／上抬後（mm）' : '原高（mm）') : '高程（mm）';
        seen.add(distance);
      }
    }

    function appendPoint(distance = '', elevation = '') {
      const row = document.createElement('div');
      row.className = 'tower-ground-entry';
      for (const [labelText, value] of [['距原點（mm）', distance], ['高程（mm）', elevation]]) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = value;
        if (labelText === '高程（mm）') {
          const caption = document.createElement('span');
          caption.dataset.groundElevationLabel = '';
          caption.textContent = labelText;
          label.append(caption, input);
        } else label.append(labelText, input);
        row.append(label);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'button';
      remove.textContent = '移除';
      remove.setAttribute('aria-label', '移除此高程點');
      remove.addEventListener('click', () => {
        row.remove();
        updatePointLabels();
        add.focus();
      });
      row.append(remove);
      pointList.append(row);
      return row;
    }

    function open(code, position = null, pointIndex) {
      if (!currentShape?.pier) return;
      arm = code;
      maxDistance = currentShape.projection + Number(endExtensionSelect.value) * 1000;
      const profile = groundProfiles[arm] ?? {origin: 0, points: []};
      outsidePoints = profile.points.filter(([distance]) => distance > maxDistance);
      pointList.replaceChildren();
      let focusPoint;
      for (const [index, [distance, elevation]] of profile.points.entries()) {
        if (distance > maxDistance) continue;
        const row = appendPoint(distance, elevation);
        if (index === pointIndex) focusPoint = row.querySelectorAll('input')[1];
        else if (distance === position && !focusPoint) focusPoint = row.querySelector('input');
      }
      if (position > 0 && !focusPoint) {
        focusPoint = appendPoint(position, groundElevation(profile, position) - profile.origin).querySelector('input');
      }
      updatePointLabels();
      byId('ground-title').textContent = arm + ' 梁地面高程';
      mode.value = position === 0 ? 'clearance' : 'point';
      originalClearance = currentShape.clearance - profile.origin;
      clearance.value = originalClearance;
      showMode();
      dialog.showModal();
      (position === 0 ? clearance : focusPoint ?? add).focus();
    }

    function apply(profile) {
      groundProfiles[arm] = profile;
      groundVersion++;
      dialog.close();
      queueSupport();
    }

    function hitTest(canvasElement, event) {
      const section = sectionGrounds.get(canvasElement);
      if (!currentShape?.pier || !section) return null;
      const rect = canvasElement.getBoundingClientRect();
      const x = (event.clientX - rect.left) * sectionWidth / rect.width;
      const y = (event.clientY - rect.top) * sectionHeight / rect.height;
      const tolerance = 10 * sectionWidth / rect.width;
      let best = tolerance;
      let hit = null;
      for (const {arm, path, stations, handles} of section.grounds) {
        for (const {point: [px, py], distance, pointIndex} of handles) {
          const separation = Math.hypot(px - x, py - y);
          if (separation <= tolerance && separation <= best) {
            best = separation;
            hit = {arm, distance, pointIndex};
          }
        }
      }
      if (hit) return hit;
      for (const {arm, path, stations} of section.grounds) {
        for (let i = 1; i < path.length; i++) {
          const [ax, ay] = path[i - 1];
          const [bx, by] = path[i];
          const dx = bx - ax, dy = by - ay;
          const lengthSquared = dx * dx + dy * dy;
          if (!lengthSquared) continue;
          const ratio = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared));
          const separation = Math.hypot(x - ax - ratio * dx, y - ay - ratio * dy);
          if (separation >= best) continue;
          best = separation;
          const [start, end] = [stations[i - 1][0], stations[i][0]];
          if (start === end) {
            hit = {arm, distance: start, pointIndex: ratio < 0.5 ? i - 2 : i - 1};
            continue;
          }
          const distance = Math.min(section.groundLength, Math.max(Math.min(1, section.groundLength),
            Math.round(start + ratio * (end - start))));
          hit = {arm, distance};
        }
      }
      return hit;
    }

    for (const element of [byId('section-ac'), byId('section-bd')]) {
      element.addEventListener('pointermove', event => {
        element.style.cursor = hitTest(element, event) ? 'pointer' : '';
      });
      element.addEventListener('click', event => {
        const hit = hitTest(element, event);
        if (hit) open(hit.arm, hit.distance, hit.pointIndex);
      });
    }
    const editButtons = [...document.querySelectorAll('[data-ground-arm]')];
    for (const button of editButtons) {
      button.addEventListener('click', () => open(button.dataset.groundArm));
    }
    mode.addEventListener('change', showMode);
    byId('ground-cancel').addEventListener('click', () => dialog.close());
    pointList.addEventListener('input', updatePointLabels);
    add.addEventListener('click', () => appendPoint().querySelector('input').focus());
    editor.addEventListener('submit', event => {
      event.preventDefault();
      if (!currentShape?.pier) return;
      const value = clearance.valueAsNumber;
      const origin = currentShape.clearance - value;
      function showError(modeValue, field, text) {
        mode.value = modeValue;
        showMode();
        message.textContent = text;
        message.hidden = false;
        field.focus();
      }
      if (!Number.isFinite(value) || (value < 0 && value !== originalClearance) ||
          outsidePoints.some(([, z]) => !Number.isFinite(origin + z))) {
        showError('clearance', clearance, '請輸入有效且大於或等於 0 的垂直淨高。');
        return;
      }
      const points = [...outsidePoints];
      const counts = new Map();
      for (const row of pointList.children) {
        const [distance, elevation] = row.querySelectorAll('input');
        const x = distance.valueAsNumber, z = elevation.valueAsNumber;
        if (!Number.isFinite(x) || x <= 0 || x > maxDistance) {
          showError('point', distance, '距原點須大於 0，且至多為 ' + numberFormat.format(maxDistance) + ' mm。');
          return;
        }
        const count = (counts.get(x) ?? 0) + 1;
        if (count > 2) {
          showError('point', distance, '同一距離最多設定兩筆高程。請依原高、下切或上抬後高程的順序輸入。');
          return;
        }
        if (!Number.isFinite(z) || !Number.isFinite(origin + z)) {
          showError('point', elevation, '請輸入有效的高程。');
          return;
        }
        counts.set(x, count);
        points.push([x, z]);
      }
      apply({origin, points: points.sort((a, b) => a[0] - b[0])});
    });
    return enabled => {
      for (const button of editButtons) button.disabled = !enabled;
    };
  }

  function drawFormworkSection(shape, {board, timber, steel, layers, beddingIssue}, layout, extension) {
    const values = byId('formwork-section-values');
    const note = byId('formwork-section-note');
    if (!shape.projection) {
      const ctx = canvas('formwork-section', '梁突出長度為 0，無外伸梁底模板。', 660, 340);
      text(ctx, '目前無外伸梁底模板', 330, 170);
      values.replaceChildren();
      values.hidden = true;
      note.hidden = true;
      return;
    }
    values.hidden = false;
    note.hidden = false;
    const beamWidth = shape.width / 1000;
    const totalWidth = beamWidth + 2 * extension;
    const mm = value => detailFormat.format(value * 1000);
    const joistPitch = layout ? '@' + Math.round(layout.joistPitch * 1000) : '';
    const stack = layers ?? [];
    const pitches = stack.map((layer, i) => {
      if (i === stack.length - 1 && layer.type !== 'timber') return '';
      const lanes = layout?.bedding?.rows[i].lanes;
      const gaps = lanes ? lanes.slice(1).map((lane, j) => lane - lanes[j])
        : layout ? i === 0 ? [layout.joistPitch] : layout.frameAcross.gaps : [];
      const values = [...new Set(gaps.map(gap => Math.round(gap * 1000)))];
      return values.length ? (layer.direction === 'along' ? '橫梁' : '順梁') + '間距 ' + values.map(gap => '@' + gap).join('、') : '';
    });
    const boardHeight = Number.isFinite(board?.height) && board.height > 0 ? board.height : 0;
    const beddingHeight = stack.reduce((sum, layer) => sum + (layer.valid ? layer.height : 0), 0);
    const complete = boardHeight && stack.every(layer => layer.valid);
    const rows = [
      ['beam-width', '⑤ 梁寬', mm(beamWidth) + ' mm'],
      ['extension', '兩側外延', extension ? '各 ' + mm(extension) + ' mm' : '不延伸'],
      ['total-width', '模板總寬', mm(totalWidth) + ' mm'],
      ['board', '模板厚度', boardHeight ? mm(boardHeight) + ' mm' : '待輸入'],
      ...(layers ? [
        ['bedding-height', '墊條總高', stack.every(layer => layer.valid) ? mm(beddingHeight) + ' mm' : '待輸入'],
        ...stack.map((layer, i) => ['bedding-' + i, '第 ' + (i + 1) + ' 層 ' + layer.name,
          [layer.directionName, layer.specification, pitches[i]].filter(Boolean).join(' · ')]),
        ['net-clearance', '內／外梁底扣除材料後（基準高程 0）', complete
          ? [shape.clearance, shape.outerSoffit].map(height => mm(height / 1000 - boardHeight - beddingHeight)).join('／') + ' mm' : '待輸入']
      ] : [
        ['timber', '木角材寬 × 高', timber ? mm(timber.width) + ' × ' + mm(timber.height) + ' mm' : '待輸入'],
        ['steel', '型鋼 H × B × 腹板厚 × 翼板厚', steel ? [steel.height, steel.width, steel.web, steel.flange].map(mm).join(' × ') + ' mm' : '待選規格'],
        ['joist-pitch', '木角材順梁中心間距（mm）', joistPitch || '待自動配置']
      ]),
      ['support-gaps', '支撐排中心間距', layout ? layout.frameAcross.gaps.map(mm).join(' ＋ ') + ' mm' : '待自動配置']
    ];
    values.replaceChildren(...rows.map(([key, label, value]) => {
      const item = document.createElement('div');
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.dataset.detail = key;
      detail.textContent = value;
      item.append(term, detail);
      return item;
    }));
    note.textContent = layout ? '圖示截取 ' + layout.arm + ' 梁底局部，垂直比例放大。'
      : beddingIssue || '圖示截取梁底局部。墊條間距依自動配置結果標示。';

    const schematic = Boolean(layers);
    const drawingHeight = schematic ? Math.max(340, 215 + stack.length * 36) : 340;
    const ctx = canvas('formwork-section', (layout ? layout.arm + ' ' : '') + '梁底模板橫斷面。' +
      rows.map(([, label, value]) => label + ' ' + value).join('，'), 660, drawingHeight);
    const scale = 408 / totalWidth;
    const x = value => 42 + (value + extension) * scale;
    const [left, innerLeft, innerRight, right] = [-extension, 0, beamWidth, beamWidth + extension].map(x);
    const deck = 136;
    const sectionScale = 99 / ((board?.height ?? 0) + (timber?.height ?? 0) + (steel?.height ?? 0) || 1);
    const boardBottom = deck + (boardHeight ? schematic ? 10 : Math.max(8, boardHeight * sectionScale) : 0);
    const timberBottom = boardBottom + (timber ? Math.max(15, timber.height * sectionScale) : 0);
    const steelBottom = timberBottom + (steel && layout ? Math.max(24, steel.height * sectionScale) : 0);
    const rectangle = (a, b, top, bottom, fill) => polygon(ctx, [[a, top], [b, top], [b, bottom], [a, bottom]], fill);
    function leader(from, y, labelY, label, detail) {
      line(ctx, [from, y], [464, y]);
      line(ctx, [464, y], [492, labelY]);
      ctx.save();
      ctx.textAlign = 'left';
      ctx.fillStyle = ink;
      ctx.fillText(label, 501, labelY);
      if (detail) ctx.fillText(detail, 501, labelY + 17, 155);
      ctx.restore();
    }

    rectangle(innerLeft, innerRight, 91, deck, '#cbe7e0');
    if (boardHeight) rectangle(left, right, deck, boardBottom, '#edc299');
    else {
      ctx.setLineDash([5, 3]);
      line(ctx, [left, deck], [right, deck]);
      ctx.setLineDash([]);
    }
    if (schematic) {
      let top = boardBottom;
      for (const [i, layer] of stack.entries()) {
        const depth = layer.valid ? Math.max(17, layer.height / beddingHeight * 95) : 20;
        const bottom = top + depth;
        const labelY = 179 + i * 36;
        if (layer.valid) {
          const long = layer.direction === 'along';
          const positions = layout?.bedding?.rows[i].lanes ?? layout?.frameAcross.positions;
          const centers = positions?.map(x) ?? [(left + right) / 2];
          const half = Math.min((right - left) / 2, Math.max(layout ? 2 : 14, layer.width * scale / 2));
          const shapes = long ? centers.map(center => [center - half, center + half]) : [[left, right]];
          const color = layer.type === 'timber' ? '#c49870' : '#637691';
          for (const [a, b] of shapes) {
            if (long && ['steel', 'channel'].includes(layer.type)) {
              const flange = Math.max(2, depth * layer.flange / layer.height);
              const web = Math.min(b - a, Math.max(1, layer.web / layer.width * (b - a)));
              const webStart = layer.type === 'steel' ? (a + b - web) / 2 : a;
              rectangle(a, b, top, top + flange, color);
              rectangle(webStart, webStart + web, top + flange, bottom - flange, color);
              rectangle(a, b, bottom - flange, bottom, color);
            } else {
              rectangle(a, b, top, bottom, color);
              if (long && layer.type === 'tube') {
                const inset = Math.max(1, (b - a) * layer.web / layer.width);
                const wall = Math.max(2, depth * layer.web / layer.height);
                if (a + inset < b - inset && top + wall < bottom - wall) rectangle(a + inset, b - inset, top + wall, bottom - wall, background);
              }
            }
          }
          leader(shapes.at(-1)[1], (top + bottom) / 2, labelY, (i + 1) + ' ' + layer.name + ' · ' + layer.directionName, pitches[i]);
        } else leader(right, (top + bottom) / 2, labelY, (i + 1) + ' ' + layer.name + ' · 尺寸待輸入');
        top = bottom;
      }
    } else if (timber) rectangle(left, right, boardBottom, timberBottom, '#c49870');
    if (!schematic && layout && steel) {
      const halfFlange = Math.max(7, steel.width * scale / 2);
      const halfWeb = Math.max(1, steel.web * scale / 2);
      const flange = Math.max(3, (steelBottom - timberBottom) * steel.flange / steel.height);
      for (const row of layout.frameAcross.positions) {
        const center = x(row);
        rectangle(center - halfFlange, center + halfFlange, timberBottom, timberBottom + flange, '#637691');
        rectangle(center - halfWeb, center + halfWeb, timberBottom + flange, steelBottom - flange, '#637691');
        rectangle(center - halfFlange, center + halfFlange, steelBottom - flange, steelBottom, '#637691');
      }
      const last = x(layout.frameAcross.positions.at(-1));
      leader(last + halfFlange, (timberBottom + steelBottom) / 2, 221, 'H 型鋼');
    }
    leader(innerRight, 111, 111, '大梁（局部）');
    if (boardHeight) leader(right, (deck + boardBottom) / 2, 144, '模板');
    if (!schematic && timber) leader(right, (boardBottom + timberBottom) / 2, 179, '木角材',
      joistPitch ? '順梁間距 ' + joistPitch : '');
    measure(ctx, 'x', [left, 90], [right, 90], 30, '模板總寬 ' + mm(totalWidth) + ' mm');
    measure(ctx, 'x', [innerLeft, 90], [innerRight, 90], 64, '⑤ ' + mm(beamWidth));
    if (innerLeft - left >= 33) {
      measure(ctx, 'x', [left, 90], [innerLeft, 90], 64, mm(extension));
      measure(ctx, 'x', [innerRight, 90], [right, 90], 64, mm(extension));
    }
  }

  function showMember(member) {
    const inspection = member?.inspection;
    inspector.hidden = !inspection;
    const announcement = byId('member-announcement');
    if (!inspection) {
      announcement.textContent = '';
      return;
    }
    const {category, arm, facts, catalogCode} = inspection;
    const {name, color} = memberCategories[category];
    const title = byId('member-title');
    title.style.setProperty('--swatch', color);
    title.textContent = [name, catalogCode].filter(Boolean).join(' · ') + (arm ? '（' + arm + ' 梁）' : '');
    let {loads = [], note = '此構件的個別載重尚未計算。'} = inspection;
    if (category === 'beam' && currentShape && [supportLoads.concrete, supportLoads.impact, supportLoads.live].every(Number.isFinite)) {
      const {concrete, impact, live} = supportLoads;
      loads = [
        ['梁內緣面載重估算', concrete * currentShape.innerDepth / 1000 + impact + live, 'tf/m²'],
        ['梁外緣面載重估算', concrete * currentShape.outerDepth / 1000 + impact + live, 'tf/m²']
      ];
      note = '面載重包含混凝土自重、澆注衝擊及活載重。';
    }
    const items = [...facts, ...loads].map(([label, value, unit]) => {
      const item = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = (typeof value === 'number' ? detailFormat.format(value) : value) + ' ' + unit;
      item.append(term, detail);
      return item;
    });
    byId('member-values').replaceChildren(...items);
    byId('member-note').textContent = note;
    announcement.textContent = title.textContent + '。' + items.map(
      item => item.firstChild.textContent + ' ' + item.lastChild.textContent).join('，') + '。' + note;
  }

  function showLegend(model) {
    const active = new Set(model.members.map(member => member.inspection?.category));
    const items = Object.entries(memberCategories).filter(([key]) => active.has(key)).map(([, {name, color}]) => {
      const item = document.createElement('li');
      item.textContent = name;
      item.style.setProperty('--swatch', color);
      return item;
    });
    legend.replaceChildren(...items);
  }

  const viewer = window.ScaffoldViewer3D.create(byId('model'), {
    label: '電塔基座支撐 3D 模型',
    surfaceSelection: true,
    onSelect: showMember,
    onError(failure) {
      modelError.textContent = failure.message;
      modelError.hidden = false;
    }
  });
  byId('member-clear').addEventListener('click', () => {
    viewer.clearSelection();
    byId('model').querySelector('canvas')?.focus({preventScroll: true});
  });
  const buttons = Array.from(byId('views').querySelectorAll('button'));
  function selectView(view) {
    viewer.setView(view);
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }

  function updateLoads() {
    function loadValue(id, positive = false) {
      const field = byId(id);
      const value = field.valueAsNumber;
      const valid = field.validity.valid && Number.isFinite(value) && (!positive || value > 0);
      field.setAttribute('aria-invalid', String(!valid));
      return valid ? value : NaN;
    }
    function showResult(id, value) {
      byId(id).value = Number.isFinite(value) ? numberFormat.format(value) : '—';
    }

    const concrete = loadValue('concrete-weight', true);
    const impact = loadValue('impact-load');
    const live = loadValue('live-load');
    const testLoad = loadValue('test-load', true);
    const safetyFactor = loadValue('safety-factor');
    loadError.hidden = [concrete, impact, live, testLoad, safetyFactor].every(Number.isFinite);

    for (const [edge, depth] of [['inner', inputs.innerDepth], ['outer', inputs.outerDepth]]) {
      const dead = depth.validity.valid ? concrete * (depth.valueAsNumber / 1000) : NaN;
      showResult(edge + '-dead', dead);
      showResult(edge + '-load', dead + impact + live);
    }
    const legsPerTestedFrame = 4;
    const legCapacity = testLoad / safetyFactor / legsPerTestedFrame;
    showResult('test-capacity', legCapacity);
    supportLoads = {concrete, impact, live, testLoad, safetyFactor, legsPerTestedFrame, legCapacity};
  }

  const steelProfileOptions = new Map(steelProfiles.map(profile => [profile.slice(0, 4).join('×'), profile]));

  function setupBeddingLayers() {
    const list = byId('bedding-layers');
    if (!list) return null;
    const add = byId('add-bedding');
    const checks = byId('bedding-checks');
    const rows = [];
    const types = {timber: '角木', steel: 'H 型鋼', channel: '槽鋼', tube: '方鋼管'};
    const directions = {across: '橫梁向', along: '順梁向'};
    const profileMap = sizes => new Map(sizes.map(size => [size.join('×'), size]));
    const catalogs = {
      steel: steelProfileOptions,
      // 國凱鋼鐵黑鐵槽鋼，H × B × 腹板厚 × 翼板厚（mm）。
      channel: profileMap([
        [75, 40, 5, 7], [100, 50, 5, 7.5], [125, 65, 6, 8], [150, 75, 6.5, 10],
        [180, 75, 7, 10.5], [200, 80, 7.5, 11], [200, 90, 8, 13.5], [250, 90, 9, 13],
        [300, 90, 9, 13], [300, 90, 10, 15.5], [380, 100, 13, 16.5]
      ]),
      // 鑫陽鋼鐵 CNS 7141 G3134 表五，正方形鋼管邊長與管壁厚（mm）。
      tube: profileMap([
        [20, [1.6]], [25, [1.6, 2, 2.5]], [30, [1.6, 2]],
        ...[35, 40, 50, 60, 65, 75].map(side => [side, [1.6, 2, 2.5, 3, 3.5, 4, 4.5, 5]]),
        [89, [2, 2.5, 3, 3.5]], [100, [2.3, 3.2, 4, 4.5]], [125, [3.5, 4, 5]], [150, [4, 5, 6]]
      ].flatMap(([side, thicknesses]) => thicknesses.map(thickness => [side, side, thickness])))
    };

    function relabel() {
      rows.forEach(({heading, remove}, i) => {
        heading.textContent = '第 ' + (i + 1) + ' 層';
        remove.setAttribute('aria-label', '刪除第 ' + (i + 1) + ' 層墊條');
      });
    }

    function standard(layers) {
      return layers.length === 2 && layers[0].type === 'timber' && layers[0].direction === 'across' &&
        layers[1].type === 'steel' && layers[1].direction === 'along';
    }

    function append(kind, direction) {
      const item = document.createElement('li');
      item.className = 'tower-bedding-row';
      const header = document.createElement('header');
      const heading = document.createElement('strong');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'button';
      remove.textContent = '刪除';
      header.append(heading, remove);
      const controls = document.createElement('div');
      controls.className = 'tower-bedding-controls';
      const geometry = document.createElement('div');
      geometry.className = 'tower-bedding-controls';
      const check = document.createElement('fieldset');
      const checkTitle = document.createElement('legend');
      const strength = document.createElement('div');
      strength.className = 'tower-bedding-controls';
      const sectionValues = document.createElement('p');
      const result = document.createElement('div');
      check.append(checkTitle, sectionValues, strength, result);
      function field(parent, caption, input) {
        const label = document.createElement('label');
        label.append(caption, input);
        parent.append(label);
        return input;
      }
      function select(parent, caption, choices, value) {
        const input = document.createElement('select');
        for (const [key, name] of choices) input.add(new Option(name, key));
        input.value = value;
        return field(parent, caption, input);
      }
      function numberInput(parent, caption, value = '') {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.min = '0';
        input.value = value;
        return field(parent, caption, input);
      }
      const material = select(controls, '材料', Object.entries(types), kind);
      const axis = select(controls, '方向', Object.entries(directions), direction);
      item.append(header, controls, geometry);
      const dimensionsByType = new Map();
      function changeMaterial() {
        const type = material.value;
        if (!dimensionsByType.has(type)) {
          const fields = document.createElement('div');
          const inputs = {};
          const catalog = catalogs[type];
          if (catalog) {
            const choices = [...catalog.keys()].map(size => [size, size]);
            if (type !== 'steel') choices.unshift(['', '請選擇規格'], ['custom', '自訂尺寸']);
            inputs.profile = select(fields, types[type] + '規格（mm）', choices, type === 'steel' ? '200×100×5.5×8' : '');
          }
          if (type !== 'steel') {
            const manual = document.createElement('div');
            manual.className = 'tower-bedding-controls tower-wide';
            const sizes = type === 'timber' ? [['height', '高', 150], ['width', '寬', 90]]
              : type === 'channel' ? [['height', '高'], ['width', '寬'], ['web', '腹板厚'], ['flange', '翼板厚']]
                : [['height', '高'], ['width', '寬'], ['web', '管壁厚']];
            for (const [key, name, value] of sizes) inputs[key] = numberInput(manual, name + '（mm）', value);
            if (inputs.profile) {
              const showManual = () => { manual.hidden = inputs.profile.value !== 'custom'; };
              inputs.profile.addEventListener('change', showManual);
              showManual();
            }
            fields.append(manual);
          }
          const propertyFields = document.createElement('div');
          const timber = type === 'timber';
          if (timber) inputs.wood = select(propertyFields, '角木材種', [['', '自訂材種'],
            ...woodMaterials.map(value => [value.id, value.label])], 'chinese-fir');
          inputs.e = numberInput(propertyFields, 'E（kgf/cm²）', timber ? '' : 2040000);
          if (timber) {
            inputs.fb = numberInput(propertyFields, '長期 Fb（kgf/cm²）');
            inputs.fv = numberInput(propertyFields, '長期 Fv（kgf/cm²）');
            const loadWood = () => {
              const wood = woodMaterials.find(value => value.id === inputs.wood.value);
              for (const key of ['e', 'fb', 'fv']) inputs[key].value = wood?.[key] ?? '';
            };
            inputs.wood.addEventListener('change', loadWood);
            loadWood();
          } else {
            inputs.fy = numberInput(propertyFields, 'Fy（kgf/cm²）', 2520);
          }
          dimensionsByType.set(type, {inputs, fields: [...fields.children], properties: [...propertyFields.children]});
        }
        geometry.replaceChildren(...dimensionsByType.get(type).fields);
        strength.replaceChildren(...dimensionsByType.get(type).properties);
      }
      material.addEventListener('change', changeMaterial);
      const row = {heading, remove, material, checkTitle, sectionValues, result, read() {
        const type = material.value;
        const {inputs} = dimensionsByType.get(type);
        const selected = inputs.profile?.value;
        const profile = catalogs[type]?.get(selected);
        const [height, width, web, flange] = profile ?? (type === 'timber' || selected === 'custom'
          ? ['height', 'width', 'web', 'flange'].map(key => inputs[key]?.valueAsNumber) : []);
        const required = type === 'tube' ? [height, width, web] : type === 'timber' ? [height, width] : [height, width, web, flange];
        const valid = required.every(value => Number.isFinite(value) && value > 0) &&
          (type !== 'tube' || 2 * web < Math.min(height, width)) &&
          (type !== 'channel' || (web < width && 2 * flange < height));
        const section = valid ? beddingSection(type, profile ?? required) : null;
        const fy = inputs.fy?.valueAsNumber;
        const timber = type === 'timber';
        const clearWeb = height - 2 * (type === 'tube' ? web : flange);
        return {...section, type, name: types[type], direction: axis.value, directionName: directions[axis.value],
          woodName: inputs.wood?.selectedOptions[0]?.textContent, e: inputs.e.valueAsNumber,
          fb: timber ? inputs.fb.valueAsNumber * 2 : fy * 0.60, fv: timber ? inputs.fv.valueAsNumber * 2 : fy * 0.40, fy,
          shearArea: timber ? section?.A / 1.5 : clearWeb * web * (type === 'tube' ? 2 : 1) / 100,
          referenceShearArea: height * web / 100, webSlenderness: (clearWeb - 2 * (profile?.[4] ?? 0)) / web,
          height: height / 1000, width: width / 1000, web: web / 1000, flange: flange / 1000, valid,
          specification: valid ? (type === 'steel' ? selected :
            (type === 'timber' ? [width, height] : required).join(' × ')) + ' mm'
            : inputs.profile && !selected ? '規格待選' : '尺寸待補齊'};
      }};
      remove.addEventListener('click', () => {
        const i = rows.indexOf(row);
        rows.splice(i, 1);
        item.remove();
        check.remove();
        relabel();
        (rows[i]?.material ?? rows[i - 1]?.material ?? add).focus();
        queueSupport();
      });
      rows.push(row);
      list.append(item);
      checks.append(check);
      changeMaterial();
      relabel();
      return material;
    }
    function reset() {
      list.replaceChildren();
      checks.replaceChildren();
      rows.length = 0;
      append('timber', 'across');
      append('steel', 'along');
    }
    add.addEventListener('click', () => {
      append('timber', rows.at(-1)?.read().direction === 'across' ? 'along' : 'across').focus();
      queueSupport();
    });
    reset();
    return {read: () => rows.map(row => row.read()), standard, fillExample: reset, render(layers, layout) {
      const reference = standard(layers);
      const automatic = (layout.armFrames ?? []).map(arm => [arm.arm, window.TowerSupport.getMaterialChecks(layout, arm)]);
      const display = value => Number.isFinite(value) ? detailFormat.format(value) : '—';
      return layers.map((layer, i) => {
        const row = rows[i];
        row.checkTitle.textContent = '第 ' + (i + 1) + ' 層 ' + layer.name + '檢核';
        const shearArea = reference ? (layer.type === 'timber' ? layer.A : layer.referenceShearArea) : layer.shearArea;
        row.sectionValues.textContent = [layer.specification, layer.directionName,
          'Z ' + display(layer.Z) + ' cm³', 'I ' + display(layer.I) + ' cm⁴', 'A ' + display(layer.A) + ' cm²',
          '受剪面積 ' + display(shearArea) + ' cm²',
          ...(['tube', 'channel'].includes(layer.type) ? ['名目斷面（直角近似）'] : []),
          (layer.type === 'timber' ? '短期 ' : '初估 ') + 'Fb ' + display(layer.fb) + '／Fv ' + display(layer.fv) + ' kgf/cm²'
        ].join(' · ');
        const results = automatic.flatMap(([arm, data]) => (data.bedding?.[i] ?? data[layer.type])
          .map(criterion => ({arm, ...criterion})));
        row.result.replaceChildren();
        if (!results.length) {
          row.result.textContent = automatic.length ? '本層由同向墊條連續承托，荷載直接傳至下層。'
            : '抗彎、抗剪、撓度等候符合條件的自動配置。';
        } else {
          const table = document.createElement('table');
          table.className = 'tower-bedding-results';
          const head = table.createTHead().insertRow();
          const fromReactions = results.some(({force}) => Number.isFinite(force));
          const headers = ['項目', '檢核跨長（mm）', ...(fromReactions ? ['跨內荷載（tf）'] : []), '需求／容許', '利用率'];
          for (const caption of headers) {
            const column = document.createElement('th');
            column.scope = 'col';
            column.textContent = caption;
            head.append(column);
          }
          const body = table.createTBody();
          for (const {arm, criterion, demand, limit, cantilever, span, force} of results) {
            const entry = body.insertRow();
            const unit = criterion === '撓度' ? 'mm' : 'kgf/cm²';
            const scale = criterion === '撓度' ? 10 : 1;
            const status = display(demand / limit * 100) + '% ' + (demand <= limit ? '通過' : '超限');
            for (const value of [(arm ? arm.toUpperCase() + ' 梁 ' : '') + (cantilever ? '懸臂 ' : '') + criterion,
              display(span * 1000), ...(fromReactions ? [display(force)] : []),
              display(demand * scale) + '／' + display(limit * scale) + ' ' + unit, status]) entry.insertCell().textContent = value;
          }
          row.result.append(table);
        }
        return results;
      });
    }};
  }

  function setupMaterials() {
    const sectionFormat = new Intl.NumberFormat('zh-TW', {maximumSignificantDigits: 7});
    const steelSize = byId('steel-size');
    const profileOptions = steelProfileOptions;
    for (const size of profileOptions.keys()) steelSize?.add(new Option('H ' + size, size));
    const woodOptions = new Map(woodMaterials.map(material => [material.id, material]));
    const boardNote = byId('formwork-board-note');
    const sectionUpdates = [];
    const shortTermOutputs = new Map();
    const shortTermFactor = 2;
    let refreshSteelStress;

    function readPositiveValue(input) {
      const value = input.valueAsNumber;
      const valid = Number.isFinite(value) && value > 0;
      input.setAttribute('aria-invalid', String(input.validity.badInput || (input.value !== '' && !valid)));
      return valid ? value : NaN;
    }

    const calculateSection = {
      formwork: () => rectangleSection(1000, readPositiveValue(byId('formwork-thickness'))),
      timber: () => rectangleSection(readPositiveValue(byId('timber-width')), readPositiveValue(byId('timber-height'))),
      steel: () => steelSection(profileOptions.get(steelSize.value))
    };
    const properties = [['e', '彈性係數（E）'], ['fb', '容許應力（Fb）'], ['fv', '容許剪力（Fv）']];
    const metrics = [['Z', 'cm³'], ['I', 'cm⁴'], ['A', 'cm²']];
    for (const fieldset of materialFields.querySelectorAll('[data-material]')) {
      const key = fieldset.dataset.material;
      const name = fieldset.querySelector('legend').textContent;
      const title = document.createElement('p');
      title.className = 'tower-material-label';
      title.id = 'tower-' + key + '-properties';
      title.textContent = name + '材料性質（kgf/cm²）';
      const propertyFields = document.createElement('div');
      propertyFields.className = 'tower-material-properties';
      propertyFields.setAttribute('role', 'group');
      propertyFields.setAttribute('aria-labelledby', title.id);
      const steel = key === 'steel';
      const shortTermResults = new Map();
      const fields = steel ? [properties[0], ['fy', '降伏應力（fy）'], ...properties.slice(1)] : properties;
      const propertyInputs = fields.map(([code, text]) => {
        const label = document.createElement('label');
        const shortTerm = !steel && (code === 'fb' || code === 'fv');
        label.textContent = (shortTerm ? '長期' : '') + text;
        const input = document.createElement('input');
        input.type = 'number';
        input.id = 'tower-' + key + '-' + code;
        input.min = '0';
        input.step = 'any';
        label.append(input);
        if (shortTerm) {
          const detail = document.createElement('small');
          const result = document.createElement('output');
          result.id = input.id + '-short-term';
          result.htmlFor.add(input.id);
          result.setAttribute('aria-label', name + '短期' + text);
          result.value = '—';
          input.setAttribute('aria-describedby', result.id);
          detail.append('短期（×' + shortTermFactor + '） ', result);
          label.append(detail);
          shortTermResults.set(code, result);
        }
        propertyFields.append(label);
        return [code, input];
      });
      if (!steel) shortTermOutputs.set(key, shortTermResults);

      if (steel) {
        const {e, fy, fb, fv} = Object.fromEntries(propertyInputs);
        e.value = '2040000';
        fy.value = '2520';
        fy.setAttribute('aria-describedby', 'tower-steel-stress-note');
        for (const result of [fb, fv]) {
          result.readOnly = true;
          result.placeholder = '—';
          result.setAttribute('aria-describedby', 'tower-steel-stress-note');
        }
        function updateSteelStress() {
          const yieldStress = readPositiveValue(fy);
          fb.value = Number.isFinite(yieldStress) ? Number((yieldStress * 0.60).toPrecision(15)) : '';
          fv.value = Number.isFinite(yieldStress) ? Number((yieldStress * 0.40).toPrecision(15)) : '';
        }
        fy.addEventListener('input', updateSteelStress);
        refreshSteelStress = updateSteelStress;
        updateSteelStress();
      }

      const woodSelect = byId(key + '-wood');
      if (woodSelect) {
        const solidWood = document.createElement('optgroup');
        solidWood.label = '實木';
        for (const material of woodOptions.values()) solidWood.append(new Option(material.label, material.id));
        woodSelect.insertBefore(solidWood, woodSelect.children[1] ?? null);
        woodSelect.addEventListener('change', () => {
          const material = woodOptions.get(woodSelect.value);
          for (const [code, input] of propertyInputs) input.value = material?.[code] ?? '';
          if (key === 'formwork') boardNote.hidden = !woodSelect.value || Boolean(material);
        });
      }

      const summary = document.createElement('dl');
      summary.className = 'tower-material-results';
      const outputs = metrics.map(([symbol, unit]) => {
        const item = document.createElement('div');
        const term = document.createElement('dt');
        term.textContent = symbol + '（' + unit + '）';
        const detail = document.createElement('dd');
        const result = document.createElement('output');
        result.id = 'tower-' + key + '-' + symbol.toLowerCase();
        result.setAttribute('aria-label', name + ' ' + term.textContent);
        detail.append(result);
        item.append(term, detail);
        summary.append(item);
        return [symbol, result];
      });
      fieldset.append(title, propertyFields, summary);

      function updateSection() {
        const section = calculateSection[key]();
        for (const [symbol, result] of outputs) result.value = section ? sectionFormat.format(section[symbol]) : '—';
      }
      fieldset.addEventListener('input', updateSection);
      sectionUpdates.push(updateSection);
      updateSection();
    }

    function material(key, dimensions, shearArea) {
      const strengths = {};
      for (const [code] of properties) {
        const value = readPositiveValue(byId(key + '-' + code));
        const output = shortTermOutputs.get(key)?.get(code);
        strengths[code] = output ? value * shortTermFactor : value;
        if (output) output.value = Number.isFinite(strengths[code]) ? sectionFormat.format(strengths[code]) : '—';
      }
      const section = calculateSection[key]();
      if (!section) return null;
      return {...section, ...strengths, ...dimensions, shearArea: shearArea ?? section.A / 1.5};
    }
    return () => {
      refreshSteelStress?.();
      for (const updateSection of sectionUpdates) updateSection();
      const board = material('formwork', {height: byId('formwork-thickness').valueAsNumber / 1000});
      if (beddingEditor) {
        const layers = beddingEditor.read();
        const standard = beddingEditor.standard(layers);
        const [timber, girder] = standard ? layers : [];
        const steel = girder?.valid ? {...girder, fb: girder.fy * 0.60, fv: girder.fy * 0.40,
          shearArea: girder.referenceShearArea} : null;
        return {board, layers, timber: timber?.valid ? timber : null, steel, layered: standard ? undefined : layers,
          beddingIssue: layers.some(layer => !layer.valid) ? '請補齊各層墊條的有效尺寸。' : ''};
      }
      const profile = profileOptions.get(steelSize.value);
      let steel = null;
      if (profile) {
        const [height, width, web, flange, fillet] = profile.map(value => value / 1000);
        steel = material('steel', {height, width, web, flange, fy: byId('steel-fy').valueAsNumber,
          webSlenderness: (height - 2 * flange - 2 * fillet) / web}, height * web * 10000);
      }
      return {steel, board,
        timber: material('timber', {height: byId('timber-height').valueAsNumber / 1000,
          width: byId('timber-width').valueAsNumber / 1000})};
    };
  }

  function setupSupportPartSelection() {
    const picker = byId('part-picker');
    if (!picker) return () => null;
    const groups = byId('part-groups');
    const excluded = new Set();
    const kindNames = {frame: '平主架', main: '主架', rail: '橫桿', brace: '斜桿', other: '基座、輔助桿與調整座'};
    const partNames = {V62025: '輔助桿', V62050: '輔助桿', V62020: '標準基座',
      U48601: '上調整座', J48601: '下調整座', J60350: '下底座'};
    let previousCatalog;
    let inputs = [];
    const updateCount = () => {
      byId('part-count').textContent = '已選 ' + inputs.filter(input => input.checked).length + '／' + inputs.length;
    };
    picker.addEventListener('change', ({target}) => {
      if (target.type !== 'checkbox') return;
      if (target.checked) excluded.delete(target.value);
      else excluded.add(target.value);
      updateCount();
      queueSupport();
    });
    for (const [button, checked] of [['parts-all', true], ['parts-none', false]]) {
      byId(button).addEventListener('click', () => {
        excluded.clear();
        for (const input of inputs) {
          input.checked = checked;
          if (!checked) excluded.add(input.value);
        }
        updateCount();
        queueSupport();
      });
    }
    return catalog => {
      if (catalog !== previousCatalog) {
        previousCatalog = catalog;
        const fixedBase = window.ScaffoldSucoot?.fixedBase;
        const parts = fixedBase && !catalog.some(part => part.code === fixedBase.code)
          ? [...catalog, {code: fixedBase.code, size: fixedBase.height, kind: 'other'}] : catalog;
        inputs = [];
        groups.replaceChildren();
        for (const [kind, title] of Object.entries(kindNames)) {
          const group = parts.filter(part => part.kind === kind);
          if (!group.length) continue;
          const fieldset = document.createElement('fieldset');
          const legend = document.createElement('legend');
          legend.textContent = title;
          fieldset.append(legend);
          for (const {code, size, rise} of group) {
            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = code;
            input.checked = !excluded.has(code);
            inputs.push(input);
            const dimension = size ? ' ' + size + (rise ? ' × ' + rise : '') + ' m' : '';
            label.append(input, code + (partNames[code] ? ' ' + partNames[code] : '') + dimension);
            fieldset.append(label);
          }
          groups.append(fieldset);
        }
        updateCount();
      }
      const selected = inputs.filter(input => input.checked);
      return selected.length === inputs.length ? null : new Set(selected.map(input => input.value));
    };
  }

  function queueSupport() {
    if (supportUpdate) return;
    supportUpdate = window.requestAnimationFrame(() => {
      supportUpdate = 0;
      configureSupport();
    });
  }

  function showPartTotal(layout) {
    const total = byId('part-total');
    if (!total) return;
    const status = byId('part-statistics-status');
    total.hidden = !layout.armFrames?.length;
    if (total.hidden) {
      total.replaceChildren();
      status.textContent = '完成自動配置後顯示桿件數量與重量總表。';
      status.hidden = false;
      return;
    }

    const {byBeam, rows, totalQuantity, weight, hasMissingWeights} =
      window.TowerSupport.summarizeParts(layout.armFrames, layout.parts);
    const tags = [...beamArms].sort();
    const weightFormat = new Intl.NumberFormat('zh-TW', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    const kg = value => value === null ? '—' : weightFormat.format(value);
    const count = value => value === undefined ? '—' : numberFormat.format(value);
    const missing = tags.filter(arm => !byBeam.has(arm));
    const notices = [];
    if (missing.length) notices.push('總表合計已配置的大梁。' + missing.join('、') + ' 梁未配置。');
    if (hasMissingWeights) notices.push('缺少單重的桿件以「—」表示，重量合計僅計入有單重的桿件。');
    status.textContent = notices.join(' ');
    status.hidden = !notices.length;

    const table = document.createElement('table');
    table.createCaption().textContent = '桿件數量與重量總表';
    const head = table.createTHead().insertRow();
    const headings = ['料號', ...tags.map(arm => arm + ' 梁（支）'), '合計（支）', '單重（kg）', '小計（kg）'];
    for (const heading of headings) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = heading;
      head.append(cell);
    }
    function appendRow(group, [label, ...values]) {
      const row = group.insertRow();
      const cell = document.createElement('th');
      cell.scope = 'row';
      cell.textContent = label;
      row.append(cell);
      for (const value of values) row.insertCell().textContent = value;
    }
    const body = table.createTBody();
    for (const {code, quantity, unitWeight, weight: subtotal} of rows) {
      appendRow(body, [code, ...tags.map(arm => count(byBeam.has(arm) ? byBeam.get(arm).counts.get(code) ?? 0 : undefined)),
        count(quantity), kg(unitWeight), kg(subtotal)]);
    }
    appendRow(table.createTFoot(), [hasMissingWeights ? '數量及已知重量合計' : '總計',
      ...tags.map(arm => count(byBeam.get(arm)?.total)), count(totalQuantity), '—', kg(weight)]);
    total.replaceChildren(table);
  }

  function configureSupport(manual = false) {
    let layout;
    let model = baseModel;
    let materials;
    let platformPressure;
    const sideExtension = Number(sideExtensionSelect.value);
    const endExtension = Number(endExtensionSelect.value);
    platformLoad.disabled = !sideExtension && !endExtension;
    try {
      updateDimensions(endExtension * 1000);
      updateLoads();
      materials = readMaterials();
      const catalog = getCatalog();
      const allowedPartCodes = readSupportParts(catalog);
      model = baseModel;
      platformLoad.placeholder = Number.isFinite(supportLoads.live) ? numberFormat.format(supportLoads.live) : '';
      platformPressure = !platformLoad.validity.valid ? NaN
        : platformLoad.value === '' ? supportLoads.live : platformLoad.valueAsNumber;
      platformLoad.setAttribute('aria-invalid', String(!platformLoad.validity.valid));
      layout = currentShape
        ? materials.beddingIssue ? {message: materials.beddingIssue} : window.TowerSupport.plan(currentShape, {...supportLoads, ...materials, platformPressure, sideExtension, endExtension,
          groundProfiles, materialMethod, endBayAtStart, allowedPartCodes, fixedNeighborRule},
          catalog, buildFrame)
        : {message: '請先修正梁的尺寸設定。'};
      if (!layout.message) model = window.TowerSupport.addToModel(baseModel, layout);
      if (viewer.available && model) viewer.setModel(model);
    } catch (failure) {
      layout = {message: '支撐架模型無法產生。' + failure.message};
      model = baseModel;
      if (viewer.available && model) {
        try {
          viewer.setModel(model);
        } catch (fallbackFailure) {
          modelError.textContent = fallbackFailure.message;
          modelError.hidden = false;
        }
      }
    }
    const hasLayout = !layout.message;
    const beddingResults = materials?.layers ? beddingEditor.render(materials.layers, layout) : undefined;
    showPartTotal(layout);
    if (currentShape) {
      drawSection(currentShape, south, north, endExtension * 1000, hasLayout ? model : null);
      drawSection(currentShape, west, east, endExtension * 1000, hasLayout ? model : null);
    }
    if (currentShape && materials) drawFormworkSection(currentShape, materials, hasLayout ? layout.armFrames[0] : null, sideExtension);
    const configured = hasLayout ? '已配置 ' + layout.armFrames.length + '／4 支梁，共 ' +
      detailFormat.format(layout.legCount) + ' 支腳。' : '';
    const groups = hasLayout ? layout.armFrames.filter(({frame}) => frame.groundGroupCount > 1)
      .map(({arm, frame}) => arm + ' 梁 ' + frame.groundGroupCount + ' 組') : [];
    const groupNotice = groups.length ? '高差分組預覽：' + groups.join('、') +
      '，已在同高圓盤配置組間橫桿。架體穩定及斜撐仍須另行檢核。' : '';
    supportStatus.textContent = layout.message ?? (manual ? '已重新檢核各梁。' : '') + configured;
    previewStatus.textContent = layout.message ?? [configured, groupNotice, ...layout.unconfigured].filter(Boolean).join(' ');
    previewStatus.hidden = false;
    byId('preview-material-example').hidden = !(layout.missingMaterials || materials?.beddingIssue);
    supportResults.hidden = !hasLayout;
    supportIssues.textContent = hasLayout ? [groupNotice, ...layout.unconfigured,
      ...new Set(layout.armFrames.flatMap(({frame}) => frame.issues))].filter(Boolean).join(' ') : '';
    supportIssues.hidden = !supportIssues.textContent;
    if (hasLayout) {
      function formatBays(gaps) {
        const runs = [];
        for (const gap of gaps) {
          if (runs.at(-1)?.gap === gap) runs.at(-1).count++;
          else runs.push({gap, count: 1});
        }
        return runs.map(({gap, count}) => count + ' 跨 × ' + detailFormat.format(gap) + ' m').join(' → ');
      }
      const extensionBay = value => detailFormat.format(value) + ' m 延伸';
      function showByArm(id, format) {
        const values = layout.armFrames.map(arm => [arm.arm, format(arm)]);
        const field = byId(id);
        if (!layout.unconfigured.length && values.every(([, value]) => value === values[0][1])) {
          field.textContent = values[0][1];
          return;
        }
        const list = document.createElement('ul');
        list.className = 'tower-support-by-arm';
        for (const [arm, value] of values) {
          const item = document.createElement('li');
          item.textContent = arm + ' 梁 ' + value;
          list.append(item);
        }
        field.replaceChildren(list);
      }
      const supportSpanLabel = byId('steel-support-span').previousElementSibling;
      supportSpanLabel.textContent = layout.layered ? '底層墊條採用最大支距（水平）' : 'H 型鋼最大容許支距（水平）';
      const joistPitchLabel = byId('support-joist-pitch').previousElementSibling;
      joistPitchLabel.textContent = layout.layered ? '首層墊條最大設計間距' : '木角材中心間距';
      showByArm('steel-support-span', ({steelSupportSpan}) =>
        Number.isFinite(steelSupportSpan) ? detailFormat.format(steelSupportSpan) + ' m' : '無線載重');
      showByArm('support-longitudinal', ({x}) => {
        if (endExtension && endBayAtStart) {
          return detailFormat.format(endExtension) + ' m（外延增設跨） → ' + formatBays(x.gaps.slice(1));
        }
        const spans = formatBays(x.gaps);
        return endExtension ? spans + ' → ' + extensionBay(endExtension) : spans;
      });
      showByArm('support-first-row', ({frameAlong}) => detailFormat.format(frameAlong.positions[0] * 1000) + ' mm');
      showByArm('support-transverse', ({y}) => {
        const spans = formatBays(y.gaps);
        return sideExtension ? [extensionBay(sideExtension), spans, extensionBay(sideExtension)].join(' ＋ ') : spans;
      });
      byId('extension-width').textContent = (sideExtension ? '各 ' + detailFormat.format(sideExtension) + ' m' : '不延伸') +
        '／總寬 ' + detailFormat.format(layout.width + 2 * sideExtension) + ' m';
      byId('extension-length').textContent = (endExtension ? detailFormat.format(endExtension) + ' m' : '不延伸') +
        '／總長 ' + detailFormat.format(layout.totalLength) + ' m';
      showByArm('support-joist-pitch', ({joistPitch}) => detailFormat.format(joistPitch * 100) + ' cm');
      byId('support-pressure').textContent = detailFormat.format(layout.pressure) + ' tf/m²';
      byId('support-count').textContent = detailFormat.format(layout.legCount) + ' 支';
      byId('support-leg-load').textContent = detailFormat.format(layout.peakLegLoad) + '／' + detailFormat.format(layout.legCapacity) + ' tf／支';
    }
    if (model) {
      showLegend(model);
      showMember(null);
    }
    return {shape: currentShape, loads: supportLoads, materials, layout, beddingResults, sideExtension, endExtension, materialMethod, endBayAtStart,
      platformPressure, warnings: supportIssues.textContent};
  }

  function createReport() {
    const status = byId('report-status');
    status.hidden = true;
    let preview;
    try {
      if (!window.TowerReport) throw new Error('計算書模組未載入，請確認網頁檔案在同一資料夾。');
      preview = window.open('', '_blank');
      if (!preview) throw new Error('瀏覽器已封鎖計算書視窗，請允許此頁開啟新視窗。');
      window.cancelAnimationFrame(supportUpdate);
      supportUpdate = 0;
      const report = configureSupport();
      if (!report.shape) throw new Error('請先修正梁的尺寸設定。');
      const figures = Object.fromEntries(['plan', 'section-ac', 'section-bd', 'formwork-section']
        .map(name => [name, byId(name).toDataURL('image/png')]));
      if (viewer.available && modelError.hidden) {
        try {
          figures.assembly = viewer.snapshot();
        } catch (failure) {
          figures.assembly = null;
        }
      }
      const wood = key => byId(key + '-wood')?.selectedOptions[0]?.textContent.trim();
      window.TowerReport.open(preview, {...report, groundProfiles, figures,
        woodNames: {board: wood('formwork'), timber: report.materials.timber?.woodName ?? wood('timber') ?? '角木'}});
    } catch (failure) {
      preview?.close();
      status.textContent = '無法製作計算書。' + failure.message;
      status.hidden = false;
    }
  }

  function exportDxf() {
    const status = byId('dxf-status');
    status.hidden = false;
    try {
      if (!window.TowerDxf) throw new Error('DXF 匯出模組未載入，請確認網頁資源在同一資料夾。');
      window.cancelAnimationFrame(supportUpdate);
      supportUpdate = 0;
      const snapshot = configureSupport();
      const {content, schematicParts} = window.TowerDxf.exportDrawing({...snapshot, groundProfiles});
      const url = URL.createObjectURL(new Blob([content], {type: 'application/dxf'}));
      const attachment = document.createElement('a');
      attachment.href = url;
      attachment.download = '電塔基座支撐.dxf';
      document.body.append(attachment);
      attachment.click();
      attachment.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = snapshot.layout.message ? 'DXF 已匯出目前的平面圖與剖面圖。' + snapshot.layout.message
        : 'DXF 已匯出平面圖、a–c 與 b–d 剖面圖及支撐配置。' +
          (schematicParts.length ? '採用示意線的料號：' + schematicParts.join('、') + '。' : '');
    } catch (failure) {
      status.textContent = '無法匯出 DXF。' + failure.message;
    }
  }

  function fillSupportExample() {
    beddingEditor?.fillExample();
    for (const [id, value] of Object.entries({
      'formwork-thickness': '21', 'timber-width': '90', 'timber-height': '150',
      'steel-size': '200×100×5.5×8', 'steel-e': '2040000', 'steel-fy': '2520'
    })) {
      const field = byId(id);
      if (!field) continue;
      field.value = value;
      field.dispatchEvent(new Event('input', {bubbles: true}));
    }
    for (const id of ['formwork-wood', 'timber-wood']) {
      const field = byId(id);
      if (!field) continue;
      field.value = 'chinese-fir';
      field.dispatchEvent(new Event('change', {bubbles: true}));
    }
  }

  function updateDimensions(endExtension) {
    const values = Object.fromEntries(dimensions.map(({key}) => [key, inputs[key].valueAsNumber]));
    for (const {key} of dimensions) inputs[key].setAttribute('aria-invalid', String(!inputs[key].validity.valid));
    if (values.width > values.diameter) inputs.width.setAttribute('aria-invalid', 'true');
    let shape;
    try {
      shape = calculate(values);
    } catch (failure) {
      currentShape = null;
      setGroundControlsEnabled(false);
      error.textContent = failure.message + ' 圖面保留上一組有效尺寸。';
      error.hidden = false;
      return;
    }
    error.hidden = true;
    output.value = numberFormat.format(shape.length);
    const shapeChanged = !currentShape || dimensions.some(({key}) => shape[key] !== currentShape[key]);
    if (shapeChanged) {
      drawPlan(shape);
      setGroundControlsEnabled(Boolean(shape.pier));
    }
    if (shapeChanged || groundVersion !== renderedGroundVersion || endExtension !== renderedEndExtension) {
      baseModel = makeModel(shape, groundProfiles, endExtension);
      renderedGroundVersion = groundVersion;
      renderedEndExtension = endExtension;
    }
    currentShape = shape;
  }

  function reset() {
    for (const {key} of dimensions) inputs[key].value = example[key];
    groundProfiles = {};
    groundVersion++;
    queueSupport();
  }

  form.addEventListener('submit', event => event.preventDefault());
  loadForm.addEventListener('submit', event => event.preventDefault());
  byId('reset').addEventListener('click', reset);
  for (const button of buttons) {
    button.disabled = !viewer.available;
    button.addEventListener('click', () => selectView(button.dataset.view));
  }
  const beddingEditor = setupBeddingLayers();
  const readMaterials = setupMaterials();
  const readSupportParts = setupSupportPartSelection();
  const setGroundControlsEnabled = setupGroundEditor();
  for (const element of [form, loadForm, materialFields, byId('platform-options'), platformLoad]) {
    element.addEventListener('input', queueSupport);
    element.addEventListener('change', queueSupport);
  }
  byId('configure-support').addEventListener('click', () => {
    window.cancelAnimationFrame(supportUpdate);
    supportUpdate = 0;
    configureSupport(true);
  });
  byId('support-example').addEventListener('click', fillSupportExample);
  byId('preview-material-example').addEventListener('click', fillSupportExample);
  byId('create-report').addEventListener('click', createReport);
  byId('export-dxf')?.addEventListener('click', exportDxf);
  reset();
  selectView('iso');
  return queueSupport;
};
