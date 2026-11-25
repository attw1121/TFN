(function (root) {
  'use strict';

  const LIMIT = 50000;
  const BRACE_DROP = 0.5;
  const EXTENSION_CONNECTIONS = new Map([
    ['25/25', 25], ['25/50', 25], ['50/50', 50],
    ['75/75', 75], ['75/100', 50], ['100/150', 100]
  ]);

  function build({catalog, quantities, xGaps, yGaps, heights, base, supports, links, truncated}) {
    const total = quantities.reduce((sum, value) => sum + value, 0);
    if (truncated || total > LIMIT) throw new Error('配置超過 50,000 支桿件，請縮小範圍以查看 3D 圖面。');
    if (xGaps.length < 3 || yGaps.length < 3) throw new Error('X、Y 軸各需至少一跨才能繪製組立圖。');
    const products = Object.create(null);
    const kinds = {frame: 'flat', main: 'post', rail: 'rail', brace: 'brace'};
    for (const part of catalog) {
      if (!kinds[part.kind]) continue;
      products[part.code] = {
        kind: kinds[part.kind],
        span: part.kind === 'frame' || part.kind === 'main' ? [0, 0, part.size] : [part.size, 0, part.rise || 0]
      };
    }
    const axes = [xGaps, yGaps].map(gaps => {
      let coordinate = 0;
      return [0, ...gaps.slice(0, -1).map(gap => coordinate += Number(gap))];
    });
    const [xs, ys] = axes;
    const records = [];
    const counts = Array(catalog.length).fill(0);
    const issues = new Set();
    const extensions = new Map();
    const frameTops = new Map();
    const clean = point => point.map(value => Number(value.toFixed(9)));
    function add(index, start, end, note) {
      records.push({code: catalog[index].code, start: clean(start), end: clean(end), note});
      counts[index]++;
    }
    for (const {i, j, parts} of supports) {
      const x = xs[i], y = ys[j];
      const top = Number(heights[i][j]);
      const supportKey = i + '/' + j;
      let z = 0;
      let lastFrame, sleeveStart;
      const sleeves = [];
      for (const [index, amount] of parts) {
        for (let n = 0; n < amount; n++) {
          const {code, kind, size} = catalog[index];
          let length = size;
          if (kind === 'frame' || kind === 'main') lastFrame = {start: z, size: Math.round(size * 100)};
          if (code === 'V62025' || code === 'V62050') {
            sleeveStart ??= z;
            sleeves.push(code);
          }
          if (code === 'J48601') length = base;
          if (code === 'U48601') {
            const extension = sleeveStart === undefined ? lastFrame : {start: sleeveStart, size: Math.round((z - sleeveStart) * 100)};
            if (extension) {
              if (sleeves.length === 2 && sleeves[0] === 'V62050' && sleeves[1] === 'V62025') {
                extension.joint = sleeveStart + 0.5;
              }
              extensions.set(supportKey, extension);
            }
            frameTops.set(supportKey, Math.min(z, top));
            length = top - z;
          }
          const shown = length > 1e-7 ? length : 0.03;
          if (length <= 1e-7) issues.add('部分調整座的推估高度不足，以 30 mm 圖示顯示。');
          if (/^[JU]48601$/.test(code) && (length < 0.08 || length > 0.45)) {
            issues.add('部分調整座的推估伸出量超出型錄所列 80–450 mm。');
          }
          add(index, [x, y, z], [x, y, z + shown]);
          z += Math.max(0, length);
        }
      }
    }
    const bottom = base + 0.1;
    for (const {index, count, alongY, row, first, second} of links) {
      const [i, j] = alongY ? [row, first] : [first, row];
      const [k, l] = alongY ? [row, second] : [second, row];
      const firstKey = i + '/' + j;
      const secondKey = k + '/' + l;
      const firstHeight = frameTops.get(firstKey) ?? Number(heights[i][j]);
      const secondHeight = frameTops.get(secondKey) ?? Number(heights[k][l]);
      const part = catalog[index];
      if (part.kind === 'rail') {
        const lowerSupportHeight = Math.min(firstHeight, secondHeight);
        const prior = extensions.get(firstKey);
        const next = extensions.get(secondKey);
        const commonStart = prior && next && Math.abs(prior.start - next.start) <= 1e-7;
        const match = commonStart && EXTENSION_CONNECTIONS.get([prior.size, next.size].sort((a, b) => a - b).join('/'));
        const connection = match ? prior.start + match / 100 : null;
        const frontJoint = prior?.joint;
        const terminalJoint = frontJoint !== undefined &&
          firstHeight - prior.start <= 1 + 1e-7 &&
          secondHeight - prior.start > 0.75 + 1e-7 ? frontJoint : null;
        const levels = [];
        let terminalOverride = false;
        let z = bottom;
        for (let n = 0; n < count; n++) {
          let note = '第一層橫桿位於標準基座圓盤高度。';
          if (n > 0) {
            const terminal = n === count - 1;
            const remainingLevels = count - 1 - n;
            const cap = terminalJoint !== null && !terminal ?
              Math.min(lowerSupportHeight, terminalJoint - remainingLevels * 0.25) : lowerSupportHeight;
            const available = cap - z;
            const frontRemaining = firstHeight - z;
            const rearRemaining = secondHeight - z;
            if (terminal && terminalJoint !== null) {
              terminalOverride = true;
              z = terminalJoint;
              note = '最上層橫桿對準前端 50＋25 cm 補高組合中，50 cm 桿件的上端。';
            } else {
              terminalOverride = terminal && frontRemaining >= -1e-7 &&
                frontRemaining <= 0.75 + 1e-7 && rearRemaining > 0.75 + 1e-7;
              const interval = terminalOverride ? 0.5 :
                ([1.5, 1, 0.75, 0.5].find(step => available >= step - 1e-7) ?? 0.25);
              z += interval;
              note = '橫桿與下方一層相距 ' + interval * 100 + ' cm。';
              if (terminalOverride) note += ' 前端剩餘高度不超過 75 cm，後端超過 75 cm。';
            }
          }
          levels.push({z, note});
        }
        if (!terminalOverride && connection !== null && !levels.some(level => Math.abs(level.z - connection) <= 1e-7)) {
          let nearest = count > 1 ? 1 : 0;
          for (let n = nearest + 1; n < levels.length; n++) {
            if (Math.abs(levels[n].z - connection) < Math.abs(levels[nearest].z - connection)) nearest = n;
          }
          levels[nearest] = {z: connection, note: '前後補高段為 ' + prior.size + '／' + next.size +
            ' cm，橫桿設在補高段起點上方 ' + match + ' cm。'};
        }
        for (const level of levels) {
          if (level.z > lowerSupportHeight + 1e-7) {
            issues.add('部分橫桿的示意接點超出較低端的主架頂高（已扣除上調整座）。');
          }
          add(index, [xs[i], ys[j], level.z], [xs[k], ys[l], level.z], level.note);
        }
      } else {
        const tolerance = 1e-7;
        const level = Math.abs(firstHeight - secondHeight) <= tolerance;
        for (let n = 0; n < count; n++) {
          const uphill = level ? n % 2 === 0 : secondHeight > firstHeight;
          const low = bottom + n * part.rise;
          const high = low + part.rise;
          const [z1, z2] = uphill ? [low, high] : [high, low];
          const drop = z1 > firstHeight + tolerance || z2 > secondHeight + tolerance ? BRACE_DROP : 0;
          const lowered = [z1 - drop, z2 - drop];
          if (lowered[0] > firstHeight + tolerance || lowered[1] > secondHeight + tolerance ||
              Math.min(...lowered) < bottom - tolerance) {
            issues.add('部分斜桿下移 ' + BRACE_DROP * 100 + ' cm 後，仍有端點超出可用的支撐範圍。');
          }
          const note = drop ? '扣除上調整座後，原位置高度不足，整支斜桿下移 ' + drop * 100 + ' cm。' :
            '斜桿接點依扣除上調整座後的主架頂高推估。';
          add(index, [xs[i], ys[j], lowered[0]], [xs[k], ys[l], lowered[1]], note);
        }
      }
    }
    if (counts.some((value, index) => value !== quantities[index])) {
      throw new Error('示意圖的逐桿數量與材料清單不同。');
    }
    return {...root.ScaffoldModel.fromMembers(records, issues), products};
  }

  root.ScaffoldACT = Object.freeze({build, LIMIT});
})(typeof window === 'undefined' ? globalThis : window);
