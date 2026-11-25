(function (root) {
  'use strict';

  const CODES = Object.freeze(['V60100', 'V60150', 'V60300', 'V61100', 'V61150', 'V62025', 'V62050', 'V62020', 'U48601', 'J48601', 'H66060', 'H66090', 'H66150', 'H66180', 'H66240', 'D60615', 'D60915', 'D61515', 'D61815', 'D62415']);
  const COLORS = Object.freeze(Object.fromEntries(CODES.map((code, index) => [code, [
    '#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9', '#A6761D', '#6A3D9A', '#1B9E77', '#E7298A',
    '#1F78B4', '#FF7F00', '#33A02C', '#B15928', '#A6A600', '#4B4BCE', '#C2185B', '#00838F', '#7B1FA2', '#AD6B00'
  ][index]])));
  const LIMIT = 50000;
  const MAX_COORDINATE = 1e9;
  const FIXED_LENGTHS = Object.freeze({V60100: 1, V60150: 1.5, V60300: 3, V61100: 1, V61150: 1.5, V62025: 0.25, V62050: 0.5, V62020: 0.2});
  const ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
  const CODE_PATTERN = /^[A-Z0-9_][A-Z0-9_-]{0,39}$/;

  function kindOf(code) {
    if (/^V6[01]/.test(code) && CODES.includes(code)) return 'vertical';
    if (/^H/.test(code) && CODES.includes(code)) return 'horizontal';
    if (/^D/.test(code) && CODES.includes(code)) return 'diagonal';
    return CODES.includes(code) ? 'accessory' : 'other';
  }

  function radiusOf(code) {
    return /^V62/.test(code) ? 0.043 : /^[UJ]/.test(code) ? 0.036 : /^V6/.test(code) ? 0.03 : /^H/.test(code) ? 0.024 : 0.022;
  }

  function coordinate(value, context) {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
      throw new Error(context + '座標必須是有限數值，且絕對值不得超過 1,000,000,000 m。');
    }
    return Object.is(value, -0) ? 0 : value;
  }

  function count(value, context) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(context + '數量必須是非負整數。');
    return value;
  }

  function cleanInferred(value) { return Number(value.toFixed(9)); }

  function makeMember(id, code, start, end, source, note = '') {
    if (!ID_PATTERN.test(id)) throw new Error('桿件識別碼格式不正確。');
    if (!CODE_PATTERN.test(code)) throw new Error('桿件型號僅可使用大寫英文字母、數字、底線及連字號，且首字不可是連字號。');
    if (!Array.isArray(start) || !Array.isArray(end) || start.length !== 3 || end.length !== 3) throw new Error('桿件起終點必須各有 X、Y、Z 三個座標。');
    const first = start.map(value => coordinate(value, id + ' 起點'));
    const second = end.map(value => coordinate(value, id + ' 終點'));
    if (!(Math.hypot(...first.map((value, index) => second[index] - value)) > 0)) throw new Error(id + ' 的起終點相同，無法建立零長度桿件。');
    return {id, code, kind: kindOf(code), start: first, end: second, radius: radiusOf(code), source, note};
  }

  function extraColor(code, used) {
    let hash = 2166136261;
    for (const character of code) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    for (let attempt = 0; attempt < 16777216; attempt++) {
      // Keep unknown catalog colors deterministic and avoid repeated exact hex values.
      const value = ((hash + Math.imul(attempt, 2654435761)) >>> 0) & 0xffffff;
      const color = '#' + value.toString(16).padStart(6, '0').toUpperCase();
      if (!used.has(color) && value > 0x222222 && value < 0xeeeeee) return color;
    }
    throw new Error('無法分配桿件顏色。');
  }

  function finish(members, issues, source) {
    if (!members.length) throw new Error('目前沒有可產生圖面的桿件。');
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const quantities = Array(CODES.length).fill(0);
    const colors = {...COLORS};
    const used = new Set(Object.values(colors));
    const ids = new Set();
    for (const member of members) {
      if (ids.has(member.id)) throw new Error('桿件識別碼重複：' + member.id);
      ids.add(member.id);
      for (const point of [member.start, member.end]) point.forEach((value, index) => {
        min[index] = Math.min(min[index], value); max[index] = Math.max(max[index], value);
      });
      const index = CODES.indexOf(member.code);
      if (index >= 0) quantities[index]++;
      if (!colors[member.code]) { colors[member.code] = extraColor(member.code, used); used.add(colors[member.code]); }
    }
    return {members, bounds: {min, max}, colors, issues: Array.from(issues), source, quantities};
  }

  function fromCalculation(details) {
    if (!details || !details.input || !Array.isArray(details.xGaps) || !Array.isArray(details.yGaps) || !Array.isArray(details.heights) || !details.verticalCounts) {
      throw new Error('缺少配置座標或逐點桿件資料，請重新運算。');
    }
    if (details.truncated) throw new Error('配置資料超出 3D 圖面上限，請縮小範圍後重新運算。');
    if (!Array.isArray(details.rails) || !Array.isArray(details.diagonals)) throw new Error('缺少逐跨橫桿或斜桿資料。');
    if (details.xGaps.length < 3 || details.yGaps.length < 3) throw new Error('每個方向至少需要一跨支撐，才能產生組立圖。請增加範圍或調整間距。');
    if (!Array.isArray(details.quantities) || details.quantities.length !== CODES.length) throw new Error('缺少完整 20 種桿件數量。');
    const expected = Array.from(details.quantities, (value, index) => count(value, CODES[index]));
    const total = expected.reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(total) || total > LIMIT) throw new Error('3D 圖面最多支援 50,000 個桿件，請縮小配置範圍。');
    const base = coordinate(details.input.baseHeight, '下調高度');
    if (base < 0) throw new Error('下調高度不可小於 0。');
    const axes = [details.xGaps, details.yGaps].map((gaps, axis) => {
      const values = [0];
      let sum = 0;
      for (let index = 0; index < gaps.length - 1; index++) {
        const gap = coordinate(gaps[index], axis === 0 ? 'X 間距' : 'Y 間距');
        if (gap < 0 || (index > 0 && gap === 0)) throw new Error('實體支撐跨距必須大於 0。');
        sum = coordinate(sum + gap, '累計間距'); values.push(cleanInferred(sum));
      }
      return values;
    });
    const [xs, ys] = axes;
    const members = [];
    const issues = new Set();
    const addIssue = message => issues.add(message);
    function add(code, start, end, note) {
      if (members.length >= LIMIT) throw new Error('3D 圖面最多支援 50,000 個桿件。');
      members.push(makeMember(code + '-' + String(members.length + 1).padStart(6, '0'), code,
        start.map(cleanInferred), end.map(cleanInferred), 'inferred', note));
    }
    function height(i, j) {
      if (!Number.isInteger(i) || !Number.isInteger(j) || i < 1 || j < 1 || i >= xs.length || j >= ys.length) throw new Error('桿件連接到邊界哨兵，沒有對應的實體支撐點。');
      const value = details.heights[i]?.[j];
      return coordinate(value, '支撐頂高');
    }
    function point(axis, row, index) {
      const i = axis === 'X' ? index : row;
      const j = axis === 'X' ? row : index;
      return {x: xs[i], y: ys[j], height: height(i, j)};
    }
    function verticalCount(code, i, j) {
      const value = details.verticalCounts[code]?.[i]?.[j];
      return count(value, code + ' 位置(' + i + ',' + j + ')');
    }
    for (let i = 1; i < xs.length; i++) {
      for (let j = 1; j < ys.length; j++) {
        const top = height(i, j);
        const x = xs[i], y = ys[j];
        let z = 0;
        const jacks = verticalCount('J48601', i, j);
        for (let index = 0; index < jacks; index++) {
          const length = base > 0 ? base : 0.03;
          add('J48601', [x, y, z], [x, y, z + length], base > 0 ? '下調件高度依輸入值推導。' : '下調高度為 0，以 0.03 m 符號顯示，不代表實際行程。');
          if (base > 0) z += base;
          else addIssue('下調高度為 0，J48601 以小基座符號表示。');
        }
        for (const code of ['V62020', 'V60100', 'V60150', 'V60300', 'V61100', 'V61150', 'V62025', 'V62050']) {
          const amount = verticalCount(code, i, j);
          for (let index = 0; index < amount; index++) {
            const length = FIXED_LENGTHS[code];
            add(code, [x, y, z], [x, y, z + length], /^V62/.test(code) ? '依名義長度推導套筒位置，實際插入與重疊待確認。' : '依標準桿件長度堆疊。');
            z += length;
          }
        }
        const tops = verticalCount('U48601', i, j);
        const remaining = top - z;
        for (let index = 0; index < tops; index++) {
          const length = remaining > 0 ? remaining / tops : 0.03;
          add('U48601', [x, y, z], [x, y, z + length], remaining > 0 ? '上調件以頂高與名義桿長差值推導，實際可調行程待確認。' : '名義桿件已超出設定高度，U48601 以 0.03 m 符號顯示。');
          z += length;
        }
        if (remaining <= 0 || z > top + 1e-7) addIssue('部分名義桿件長度超出設定支撐高度；可調件及組立可行性需確認。');
      }
    }

    // The 200 mm standard base has its rosette 100 mm above the jack.
    const bottom = base + 0.1;
    function validLink(link, firstType, lastType) {
      if (!link || !['X', 'Y'].includes(link.axis) || !Number.isInteger(link.typeIndex) || link.typeIndex < firstType || link.typeIndex > lastType) throw new Error('橫桿或斜桿配置資料格式不正確。');
      count(link.count, '逐跨桿件');
      if (!Number.isInteger(link.startIndex) || !Number.isInteger(link.endIndex) || link.endIndex !== link.startIndex + 1) throw new Error('逐跨桿件必須連接相鄰支撐點。');
      return [point(link.axis, link.row, link.startIndex), point(link.axis, link.row, link.endIndex)];
    }
    for (const rail of details.rails || []) {
      const [first, second] = validLink(rail, 10, 14);
      if (!rail.count) continue;
      const cap = Math.max(bottom, Math.min(first.height, second.height) - 0.15);
      const levels = [];
      for (let index = 0; index < rail.count && bottom + index * 1.5 <= cap + 1e-8; index++) levels.push(bottom + index * 1.5);
      if (!levels.length) levels.push(bottom);
      while (levels.length < rail.count) {
        const sorted = levels.slice().sort((a, b) => a - b);
        if (sorted[sorted.length - 1] < cap) sorted.push(cap);
        let gap = 0, midpoint = bottom;
        for (let index = 1; index < sorted.length; index++) {
          if (sorted[index] - sorted[index - 1] > gap) { gap = sorted[index] - sorted[index - 1]; midpoint = (sorted[index] + sorted[index - 1]) / 2; }
        }
        levels.push(midpoint);
        if (gap < 1e-7) addIssue('部分橫桿沒有足夠接點高度，圖面保留重合示意以對應計算數量。');
      }
      for (const z of levels.sort((a, b) => a - b)) add(CODES[rail.typeIndex], [first.x, first.y, z], [second.x, second.y, z], '橫桿接點依 1.5 m 層距及可用高度推導，實際接點待確認。');
      if (Math.min(first.height, second.height) - 0.15 < bottom) addIssue('部分橫桿接點高於支撐可用高度，需確認配置。');
    }
    if ((details.rails || []).some(rail => rail.count > 0)) addIssue('橫桿接點標高依層距推導；原數量程式未提供實際接頭位置。');
    for (const diagonal of details.diagonals || []) {
      const [first, second] = validLink(diagonal, 15, 19);
      for (let index = 0; index < diagonal.count; index++) {
        const lower = bottom + index * 1.5;
        const upper = lower + 1.5;
        const riseToSecond = (second.height >= first.height) !== (index % 2 === 1);
        const z1 = riseToSecond ? lower : upper;
        const z2 = riseToSecond ? upper : lower;
        let note = '斜桿依名義 1.5 m 高差交替配置，接點位置待確認。';
        if (z1 > first.height + 1e-7 || z2 > second.height + 1e-7) {
          note += ' 端點超出設定支撐頂高。';
          addIssue('部分斜桿端點超出支撐頂高；保留名義高差與數量，實際組立需確認。');
        }
        add(CODES[diagonal.typeIndex], [first.x, first.y, z1], [second.x, second.y, z2], note);
      }
    }
    const model = finish(members, issues, 'inferred');
    if (model.quantities.some((value, index) => value !== expected[index])) throw new Error('3D 桿件數量與計算清單不一致，請重新運算。');
    return model;
  }

  function csvRows(text) {
    if (typeof text !== 'string') throw new Error('請提供 CSV 文字內容。');
    const source = text.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', quoted = false, closed = false;
    function endField() { row.push(field); field = ''; closed = false; }
    function endRow() {
      endField();
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
      if (rows.length > LIMIT + 1) throw new Error('CSV 最多支援 50,000 個桿件。');
    }
    for (let index = 0; index < source.length; index++) {
      const character = source[index];
      if (quoted) {
        if (character === '"') {
          if (source[index + 1] === '"') { field += '"'; index++; }
          else { quoted = false; closed = true; }
        } else field += character;
      } else if (character === ',') endField();
      else if (character === '\n' || character === '\r') { endRow(); if (character === '\r' && source[index + 1] === '\n') index++; }
      else if (character === '"') {
        if (field.trim() || closed) throw new Error('CSV 引號格式不正確。');
        field = ''; quoted = true;
      } else if (closed) {
        if (!/[ \t]/.test(character)) throw new Error('CSV 引號後出現不正確內容。');
      } else field += character;
    }
    if (quoted) throw new Error('CSV 有未關閉的引號。');
    if (field || row.length || closed) endRow();
    return rows;
  }

  function parseCSV(text) {
    const rows = csvRows(text);
    if (rows.length < 2) throw new Error('CSV 必須包含欄位名稱及至少一個桿件。');
    const headers = rows[0].map(value => value.trim().toLowerCase());
    const required = ['id', 'code', 'x1', 'y1', 'z1', 'x2', 'y2', 'z2'];
    if (new Set(headers).size !== headers.length || required.some(name => !headers.includes(name))) throw new Error('CSV 欄位須完整包含 id,code,x1,y1,z1,x2,y2,z2，且不能重複。');
    const reserved = new Set();
    const parsed = rows.slice(1).map((row, index) => {
      if (row.length !== headers.length) throw new Error('CSV 第 ' + (index + 2) + ' 列欄位數量不正確。');
      const value = name => row[headers.indexOf(name)].trim();
      const id = value('id'), code = value('code');
      if (id && !ID_PATTERN.test(id)) throw new Error('CSV 第 ' + (index + 2) + ' 列 ID 格式不正確。');
      if (!CODE_PATTERN.test(code)) throw new Error('CSV 第 ' + (index + 2) + ' 列型號格式不正確。');
      if (id && reserved.has(id)) throw new Error('CSV 桿件 ID 重複：' + id);
      if (id) reserved.add(id);
      const numbers = required.slice(2).map(name => {
        const token = value(name);
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) throw new Error('CSV 第 ' + (index + 2) + ' 列的 ' + name + ' 必須是數字且不能留空。');
        return coordinate(Number(token), 'CSV 第 ' + (index + 2) + ' 列 ');
      });
      return {id, code, numbers};
    });
    const members = parsed.map((entry, index) => {
      let id = entry.id;
      if (!id) {
        let sequence = index + 1;
        do { id = 'MEMBER-' + String(sequence++).padStart(6, '0'); } while (reserved.has(id));
        reserved.add(id);
      }
      return makeMember(id, entry.code, entry.numbers.slice(0, 3), entry.numbers.slice(3), 'coordinates', '由 CSV 明確起終點座標匯入，單位 m。');
    });
    return finish(members, [], 'coordinates');
  }

  function toCSV(model) {
    if (!model || !Array.isArray(model.members) || !model.members.length || model.members.length > LIMIT) throw new Error('沒有有效圖面可匯出。');
    const ids = new Set();
    const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
    const lines = ['id,code,x1,y1,z1,x2,y2,z2,source,note'];
    for (const raw of model.members) {
      const member = makeMember(raw.id, raw.code, raw.start, raw.end, raw.source, raw.note);
      if (ids.has(member.id)) throw new Error('桿件識別碼重複：' + member.id);
      ids.add(member.id);
      const source = ['inferred', 'coordinates'].includes(member.source) ? member.source : 'coordinates';
      let note = String(member.note || '');
      if (/^[\s]*[=+\-@]/.test(note) || /^[\t\r]/.test(note)) note = "'" + note;
      lines.push([member.id, member.code, ...member.start, ...member.end, source, note].map(quote).join(','));
    }
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  function fromMembers(records, issues = []) {
    if (!records.length || records.length > LIMIT) throw new Error('3D 圖面支援 1 至 50,000 支桿件。');
    const members = records.map((record, index) => makeMember(
      record.code + '-' + (index + 1), record.code, record.start, record.end, 'inferred', record.note
    ));
    return finish(members, issues, 'inferred');
  }

  root.ScaffoldModel = Object.freeze({COLORS, fromCalculation, fromMembers, parseCSV, toCSV});
})(typeof window === 'undefined' ? globalThis : window);
