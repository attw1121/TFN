(function (root) {
  'use strict';

  const projectName = '電塔基座支撐工程';
  const sourceName = '161kV天輪~潭南#40塔基計算書20240410.pdf';
  const format = new Intl.NumberFormat('zh-TW', {maximumFractionDigits: 3});
  const fine = new Intl.NumberFormat('zh-TW', {maximumFractionDigits: 4});
  const number = (value, precise = false) => Number.isFinite(value) ? (precise ? fine : format).format(value) : '待輸入';
  const quantity = (value, unit) => Number.isFinite(value) ? number(value) + ' ' + unit : '待輸入';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);
  const heading = text => '<h3>' + escape(text) + '</h3>';
  const paragraph = text => '<p>' + escape(text) + '</p>';
  const formula = text => '<p class="formula">' + escape(text) + '</p>';
  const notice = text => '<p class="notice">' + escape(text) + '</p>';
  const name = '<span data-project>' + projectName + '</span>';

  const style = [
    '@page{size:A4;margin:0}',
    '*{box-sizing:border-box}',
    'body{margin:0;background:#e5e7eb;color:#111;font:11pt/1.6 "Noto Serif TC","PMingLiU","Microsoft JhengHei",serif}',
    '.toolbar{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:12px;background:#f9fafb;border-bottom:1px solid #ced1d5;padding:10px;font:10.5pt "Microsoft JhengHei",sans-serif}',
    '.toolbar input,.toolbar button{font:inherit;padding:5px 9px}',
    '.toolbar input{width:min(16em,62vw)}',
    '.toolbar button{border:1px solid #222;border-radius:4px;background:#222;color:#fff;cursor:pointer}',
    '.sheet{position:relative;display:flex;flex-direction:column;width:210mm;min-height:297mm;margin:12px auto;padding:19mm 16mm 13mm;background:#fff;box-shadow:0 1px 9px #0002;break-after:page}',
    '.sheet:last-child{break-after:auto}',
    '.cover{text-align:center;padding-top:31mm}',
    '.cover h1,.cover h2,.contents h1,.intro h1,.intro h2{margin:0;text-align:center}',
    '.cover h1,.intro h1{font-size:18pt;line-height:1.45;overflow-wrap:anywhere}',
    '.cover h2,.intro h2{font-size:15pt}',
    '.cover .vertical{white-space:pre-line;margin:24mm auto 0;font-size:25pt;font-weight:700;line-height:1.38}',
    '.cover .date{margin:auto auto 25mm;letter-spacing:.18em}',
    '.contents{padding-top:30mm}',
    '.contents h1{font-size:17pt;letter-spacing:.12em}',
    '.contents h2{text-align:center;margin:3mm 0 12mm;font-size:15pt}',
    '.contents table{margin:0 10mm;width:calc(100% - 20mm)}',
    '.contents td{border:0;padding:2.5mm 0}',
    '.contents td:last-child{text-align:right}',
    '.intro h3{margin-top:9mm}',
    '.frame{border:1.25pt solid #111;min-height:245mm}',
    '.running{border-bottom:1.25pt solid #111;text-align:center;font:bold 13pt/1.45 "Times New Roman",serif;letter-spacing:.035em}',
    '.body{padding:4mm 5mm}',
    'h2{margin:0 0 3mm;font-size:14pt;line-height:1.45}',
    'h3{margin:4mm 0 1.4mm;font-size:11.5pt}',
    'p{margin:1.4mm 0}',
    '.formula{padding-left:4mm;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}',
    '.notice{border:1px solid #555;background:#f2f2f2;padding:1.5mm 3mm;overflow-wrap:anywhere}',
    'table{border-collapse:collapse;width:100%;margin:1.6mm 0 3mm;font-size:9.4pt;line-height:1.38;table-layout:fixed}',
    'th,td{border:1px solid #444;padding:.85mm 1.5mm;vertical-align:middle;overflow-wrap:anywhere}',
    'th{background:#eee;font-weight:bold}',
    'tr,figure{break-inside:avoid}',
    '.page-number{position:absolute;bottom:7mm;left:0;right:0;text-align:center;font:9pt "Times New Roman",serif}',
    '.figure-grid{display:grid;grid-template-columns:1fr 1fr;align-items:start;gap:4mm;margin-top:3mm}',
    'figure{margin:0 0 3mm;text-align:center}',
    'figcaption{margin-top:1mm;font-size:9pt}',
    'figure img{display:block;width:100%;max-height:95mm;object-fit:contain}',
    'figure.plan img{max-width:140mm;margin:auto}',
    'figure.detail img{max-height:83mm}',
    'figure.assembly img{max-height:114mm}',
    '@media screen and (max-width:800px){.sheet{margin-inline:0}}',
    '@media print{body{background:#fff}.toolbar{display:none}.sheet{margin:0;box-shadow:none}.notice,th{print-color-adjust:exact}}'
  ].join('\n');

  function table(headers, rows) {
    return '<table><thead><tr>' + headers.map(cell => '<th scope="col">' + escape(cell) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map(row => '<tr>' +
        row.map(cell => '<td>' + escape(cell) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  }

  function figure(src, caption, className = '') {
    return src
      ? '<figure class="' + className + '"><img alt="' + escape(caption) + '" src="' + escape(src) +
        '"><figcaption>' + escape(caption) + '</figcaption></figure>'
      : paragraph(caption + '目前無法擷取。');
  }

  function render(snapshot) {
    const {shape, loads, materials = {}, layout, sideExtension, endExtension, platformPressure, warnings, materialMethod, endBayAtStart, beddingResults,
      groundProfiles, figures, woodNames} = snapshot;
    const {concrete, impact, live, testLoad, safetyFactor, legsPerTestedFrame, legCapacity} = loads;
    const arms = layout.armFrames ?? [];
    const status = layout.message ? '未完成配置。' + layout.message
      : layout.unconfigured.length || warnings
        ? '初估配置有待確認事項。' + (warnings || layout.unconfigured.join(' '))
        : '已產生四臂初估配置。';
    const coverStatus = layout.message ? '初估資料 · 未完成配置'
      : layout.unconfigured.length ? '初估資料 · 部分梁未配置' : '初估配置';
    const materialChecks = new Map(arms.map(arm => [arm.arm, root.TowerSupport.getMaterialChecks(layout, arm)]));
    const materialSpec = {
      board: materials.board ? '厚 ' + quantity(materials.board.height * 1000, 'mm') : '厚度待輸入',
      timber: materials.timber ? [materials.timber.width, materials.timber.height]
        .map(value => number(value * 1000)).join(' × ') + ' mm' : '尺寸待輸入',
      steel: materials.steel ? 'H ' + [materials.steel.height, materials.steel.width, materials.steel.web, materials.steel.flange]
        .map(value => number(value * 1000)).join(' × ') + ' mm' : '規格待選'
    };
    const materialName = {board: woodNames.board, timber: woodNames.timber, steel: 'H 型鋼'};
    const sections = [];
    function add(title, body, contentsTitle = title) {
      sections.push({title, body, contentsTitle});
    }

    const governingArm = arms.reduce((worst, arm) => !worst || arm.peakLegLoad > worst.peakLegLoad ? arm : worst, null);
    const beamDepth = Math.max(shape.innerDepth, shape.outerDepth) / 1000;
    const beamPressure = concrete * beamDepth + impact + live;
    const effectivePlatformPressure = sideExtension || endExtension ? platformPressure : 0;
    add('一、檢核圓盤支撐架荷載',
      table(['計算項目', '輸入值'], [
        ['混凝土單位重（D/L）', quantity(concrete, 'tf/m³')],
        ['澆注衝擊載重（Impact Load）', quantity(impact, 'tf/m²')],
        ['人員、機具、模板活載重（L/L）', quantity(live, 'tf/m²')],
        ['施工平台延伸區面載重', sideExtension || endExtension ? quantity(platformPressure, 'tf/m²') : '無延伸區']
      ]) +
      heading('梁身面載重') +
      formula('q = 混凝土單位重 × 最大梁深 + 衝擊載重 + 活載重') +
      formula('q = ' + number(concrete) + ' × ' + number(beamDepth) + ' + ' + number(impact) + ' + ' + number(live) +
        ' = ' + quantity(beamPressure, 'tf/m²')) +
      table(['位置', '梁深（mm）', '混凝土自重（tf/m²）', '載重合計（tf/m²）'], [
        ['梁內緣', number(shape.innerDepth), number(concrete * shape.innerDepth / 1000), number(concrete * shape.innerDepth / 1000 + impact + live)],
        ['梁外緣', number(shape.outerDepth), number(concrete * shape.outerDepth / 1000), number(concrete * shape.outerDepth / 1000 + impact + live)]
      ]) +
      paragraph('以梁身及平台各自分攤面積乘對應面載重，另加架材分攤自重。梁上墩座荷載排除於本次支撐配置。') +
      heading('各梁支撐配置') + (arms.length ? table(
        ['梁號', '順梁跨距（m）', '橫梁跨距（m）', '首排距井桶（mm）', '支腳（支）'],
        arms.map(arm => [arm.arm, formatGaps(arm.frameAlong.gaps), formatGaps(arm.frameAcross.gaps),
          number(arm.frameAlong.positions[0] * 1000), arm.legCount])
      ) : notice(status)));

    const leg = governingArm?.governingLeg;
    add('二、檢核圓盤支撐架承載力',
      heading('載重試驗值折減法') +
      table(['計算項目', '數值'], [
        ['一座四支腳載重試驗報告輸入值', quantity(testLoad, 'tf')],
        ['安全係數', number(safetyFactor)],
        ['每座試驗支腳數', legsPerTestedFrame],
        ['單支支撐架容許荷載', quantity(legCapacity, 'tf／支')]
      ]) +
      formula('單支容許荷載 = ' + number(testLoad) + ' ÷ ' + number(safetyFactor) + ' ÷ ' + legsPerTestedFrame +
        ' = ' + quantity(legCapacity, 'tf／支')) +
      (leg ? heading('控制支腳 · ' + governingArm.arm + ' 梁，距井桶外壁 ' + number(leg.x * 1000) + ' mm') +
        table(['分項', '分攤面積（m²）', '荷載（tf）'], [...(leg.transferredLoad !== undefined
          ? [['墊條逐層傳遞至支腳的反力', '—', number(leg.transferredLoad, true)]] : [
          ['混凝土自重', number(leg.beamArea, true), number(leg.beamArea * concrete * beamDepth, true)],
          ['澆注衝擊載重', number(leg.beamArea, true), number(leg.beamArea * impact, true)],
          ['人員、機具、模板活載重', number(leg.beamArea, true), number(leg.beamArea * live, true)],
          ['平台延伸區載重', number(leg.extensionArea, true), number(leg.extensionArea * effectivePlatformPressure, true)]]),
          ['架材分攤自重', '—', number(leg.frameLoad, true)],
          ['單支估算荷載合計', '—', number(leg.load, true)]
        ]) +
        table(['梁號', '最大單支估算荷載（tf）', '容許荷載利用率（%）'],
          arms.map(arm => [arm.arm, number(arm.peakLegLoad), number(arm.peakLegLoad / legCapacity * 100)]))
        : notice(status)) +
      (arms.some(({frame}) => frame.members.some(member => member.shortStack))
        ? paragraph('下底座 J60350 採用單重 ' + quantity(layout.parts.get('J60350')?.weight, 'kg') + '，計入架材分攤自重。') : '') +
      paragraph('本章列示程式採用的試驗值折減檢核。AISC 構材軸壓挫屈、架體側向穩定及基礎承載須另行檢核。'));

    function materialPage(key, title, description, equations, inputHeaders, inputValues) {
      const material = materials[key];
      const metrics = [['E（kgf/cm²）', 'e'], ['採用 Fb（kgf/cm²）', 'fb'], ['採用 Fv（kgf/cm²）', 'fv'],
        ['Z（cm³）', 'Z'], ['I（cm⁴）', 'I'], ['A（cm²）', 'A']];
      if (!materialMethod || key === 'steel') metrics.push(['剪力有效面積（cm²）', 'shearArea']);
      if (key === 'steel') metrics.unshift(['Fy（kgf/cm²）', 'fy']);
      const checkRows = arms.flatMap(({arm}) => materialChecks.get(arm)[key].map(({criterion, demand, limit, span, cantilever}) => [
        arm, (cantilever ? '懸伸段' : '') + criterion + (criterion === '撓度' ? '（cm）' : '（kgf/cm²）'), number(span * 100, true),
        number(demand, true), number(limit, true), number(demand / limit * 100)
      ]));
      const properties = metrics.map(([label, property]) => [label, number(material?.[property], true)]);
      const propertyRows = [];
      for (let i = 0; i < properties.length; i += 2) {
        propertyRows.push([...properties[i], ...(properties[i + 1] ?? ['', ''])]);
      }
      add(title, paragraph(materialName[key] + '　' + materialSpec[key]) + paragraph(description) +
        table(['斷面與強度', '數值', '斷面與強度', '數值'], propertyRows) +
        heading('檢核方式') + equations.map(formula).join('') +
        (arms.length ? table(['梁號', ...inputHeaders], arms.map(arm => [arm.arm, ...inputValues(arm)])) : '') +
        heading('各梁控制值') +
        (checkRows.length ? table(['梁號', '檢核項目', '採用跨度（cm）', '需求值', '容許值', '利用率（%）'], checkRows)
          : notice('未檢核。請補齊輸入並取得支撐配置。')));
    }

    function referenceMaterialPages() {
      const uniformFormulas = ['彎曲應力 fb = wL² ÷ (8Z)', '剪應力 fv = wL ÷ (2Av)',
        '撓度 δ = 5wL⁴ ÷ (384EI)，上限 L/240'];
      const referenceFormulas = limit => ['彎矩 M = wL² ÷ 10，彎曲應力 fb = M ÷ Z',
        '剪應力 fv = wL ÷ (2A)', '撓度 δ = wL⁴ ÷ (128EI)，上限 ' + limit];
      const overhang = '端部懸伸另以懸臂式 M = wL² ÷ 2、V = wL、δ = wL⁴ ÷ (8EI) 檢核。';
      materialPage('board', '三、設計模板', '以 1 m 寬板帶檢核，板跨依木角材中心間距及梁底坡度換算。' +
        (materialMethod ? '木角材中心間距依角材檢核結果與模板容許板跨決定。' : '木材採短期 Fb、Fv。'),
        ['w 取梁身與平台面載重上限換算為 1 m 板帶線載重。',
          ...(materialMethod ? referenceFormulas('0.30 cm') : uniformFormulas)],
        ['採用線載重 w（kgf/cm）', '木角材中心間距（cm）'],
        arm => [number(arm.screening.boardLine, true), number(arm.joistPitch * 100, true)]);
      materialPage('timber', '四、設計次墊條（木角材）', '按梁身、側向延伸與端部延伸的分區荷載及懸伸段檢核。' +
        (materialMethod ? '跨內面載重採該跨所涵蓋分區的最大值。' : '木材採短期 Fb、Fv。'),
        [materialMethod ? '線載重 w = 面載重 × 木角材中心間距。' : '分區線載重 w = 各區面載重 × 木角材中心間距。',
          ...(materialMethod ? [...referenceFormulas('L/240'), overhang] :
            ['彎曲應力 = |M|max ÷ Z，剪應力 = |V|max ÷ Av。', '依分區載重與端部彎矩估算撓度上界，檢核上限為 L/240。'])],
        ['木角材中心間距（cm）', '檢核線載重上限（kgf/cm）'],
        arm => [number(arm.joistPitch * 100, true), number(arm.screening.timberLine, true)]);
      const steelSlope = 'L 為水平支距按梁底坡度換算的型鋼跨度，Fb = 0.60Fy，Fv = 0.40Fy。';
      materialPage('steel', '五、設計主墊條（H 型鋼）', '優先配置全梁常規架，其次試配下底座。各階段沿梁優先採用通過配置檢核的最大制式跨距。' +
        (materialMethod ? '型鋼容許支距按選用配置的控制排分攤線載重計算。' : '型鋼容許支距依採用配置的控制排線載重及荷載包絡求得。'),
        materialMethod
          ? ['w 取各型鋼支撐排的最大分攤線載重。A = 型鋼總高 × 腹板厚。', steelSlope, ...referenceFormulas('0.30 cm'), overhang]
          : ['w = 控制排分攤線載重 × 2(1 + 2s ÷ l)，l 為水平支距，s 取角材間距與兩端邊距的最大值。', steelSlope, ...uniformFormulas],
        [...(materialMethod ? ['控制排線載重 w（kgf/cm）'] : ['控制排線載重（kgf/cm）', '包絡係數', '檢核線載重 w（kgf/cm）']),
          '最大容許水平支距（m）', '採用最大水平支距（m）'],
        arm => {
          const line = Math.max(...arm.steelLineLoads) * 10;
          return [number(line, true), ...(materialMethod ? [] : [number(arm.screening.steelFactor, true), number(line * arm.screening.steelFactor, true)]),
            arm.steelSupportSpan === Infinity ? '無線載重' : number(arm.steelSupportSpan, true), number(arm.frameAlong.nominal, true)];
        });
    }
    if (materials.layered || materials.beddingIssue) {
      add('三、模板檢核', arms.length ? table(['梁號', '控制模板板跨（mm）'], arms.map(arm =>
        [arm.arm, number(arm.bedding.boardGap * 1000, true)])) : notice(status));
      (materials.layers ?? []).forEach((layer, i) => {
        const results = beddingResults?.[i] ?? [];
        add('第 ' + (i + 1) + ' 層墊條初檢（' + layer.name + '）',
          paragraph(layer.directionName + '　' + layer.specification) +
          table(['斷面項目', '數值'], [['Z（cm³）', number(layer.Z)], ['I（cm⁴）', number(layer.I)], ['A（cm²）', number(layer.A)]]) +
          (results.length ? paragraph('依配置跨度及上下層傳遞的荷載檢核。') +
            table(['梁號', '檢核項目', '跨度（mm）', '跨內荷載（tf）', '需求值', '容許值', '利用率（%）'], results.map(({arm, criterion, demand, limit, span, force, cantilever}) => {
              const scale = criterion === '撓度' ? 10 : 1;
              const unit = criterion === '撓度' ? 'mm' : 'kgf/cm²';
              return [arm, (cantilever ? '懸臂 ' : '') + criterion, number(span * 1000), number(force), quantity(demand * scale, unit),
                quantity(limit * scale, unit), number(demand / limit * 100)];
            })) : notice(arms.length ? '本層由同向墊條連續承托，荷載直接傳至下層。' : '未完成檢核。')));
      });
    } else {
      referenceMaterialPages();
    }

    add('圖說一　平面圖及 a–c、b–d 剖面', figure(figures.plan, '大梁編號與尺寸平面圖', 'plan') +
      '<div class="figure-grid">' + figure(figures['section-ac'], 'a–c 剖面') + figure(figures['section-bd'], 'b–d 剖面') + '</div>');
    add('圖說二　梁底模板斷面及 3D 組立圖',
      figure(figures['formwork-section'], '梁底模板斷面詳圖', 'detail') +
      figure(figures.assembly, arms.length ? '目前 3D 組立配置' : '目前 3D 幾何圖', 'assembly') + notice(status));

    const groundRows = Object.entries(groundProfiles).sort(([a], [b]) => a.localeCompare(b)).flatMap(([arm, profile]) =>
      [[arm, '0', '0', number(profile.origin), ''], ...profile.points.map(([x, z], i, points) => {
        const previous = points[i - 1];
        let step = '';
        if (previous?.[0] === x) step = z < previous[1] ? '下切後' : z > previous[1] ? '上抬後' : '變更後';
        else if (points[i + 1]?.[0] === x) step = '原高';
        return [arm, number(x), number(z), number(z + profile.origin), step];
      })]);
    if (groundRows.length) {
      const headers = ['梁號', '距井桶外壁（mm）', '相對交點高程（mm）', '基準高程（mm）'];
      const hasSteps = groundRows.some(row => row[4]);
      if (hasSteps) headers.push('高程順序');
      appendTable(add, '附錄一　地面高程點', headers, hasSteps ? groundRows : groundRows.map(row => row.slice(0, 4)));
    }
    addPartCounts(add, arms, layout.unconfigured ?? [], groundRows.length > 0);

    const date = new Intl.DateTimeFormat('zh-TW-u-ca-roc', {timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric'})
      .format(new Date());
    const cover = '<section class="sheet cover"><h1>' + name + '</h1><h2>圓盤系統支撐架</h2>' +
      '<div class="vertical" aria-label="結構計算書">結\n構\n計\n算\n書</div>' + paragraph(coverStatus) +
      '<p class="date">' + escape(date) + '</p></section>';
    const contents = '<section class="sheet contents"><h1>圓盤支撐架結構計算書</h1><h2>目錄</h2>' +
      '<table><tbody><tr><td>首頁</td><td></td></tr>' + sections.map(({contentsTitle}, i) => contentsTitle
        ? '<tr><td>' + escape(contentsTitle) + '</td><td>······ ' + (i + 1) + '</td></tr>' : '').join('') +
      '</tbody></table></section>';
    const intro = '<section class="sheet intro"><h1>' + name + '</h1><h2>圓盤支撐架結構計算</h2>' +
      heading('壹、設計參考') + paragraph((materialMethod ? '材料檢核參考第三至第五章，來源為 ' : '編排參考：') + sourceName) +
      paragraph('依本頁輸入及電塔基座支撐程式的運算結果編製。') +
      heading('貳、工程尺寸及設計範圍') + table(['尺寸項目', '數值'],
        root.TowerFoundation.dimensions.map(({key, number: marker, label}) => [marker + ' ' + label, quantity(shape[key], 'mm')])
          .concat([['⑦ 梁全長', quantity(shape.length, 'mm')],
            ['兩側平台（每側）', quantity(sideExtension * 1000, 'mm')], ['梁端平台', quantity(endExtension * 1000, 'mm') +
              (endExtension && endBayAtStart ? '，增設短跨置於井桶側' : '')]])) +
      heading('參、材料與配置') + table(['材料', '規格'], [['模板', materialSpec.board], ...(materials.layers
        ? materials.layers.map((layer, i) => ['第 ' + (i + 1) + ' 層 ' + layer.name, layer.directionName + ' · ' + layer.specification])
        : [['木角材', materialSpec.timber], ['H 型鋼', materialSpec.steel]])]) +
      notice(status) + '</section>';
    const pages = sections.map(({title, body}, i) =>
      '<section class="sheet"><div class="frame"><header class="running">DESIGN CALCULATION SHEET</header>' +
      '<div class="body"><h2>' + escape(title) + '</h2>' + body + '</div></div><footer class="page-number">' +
      (i + 1) + '</footer></section>').join('');
    return '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
      '<title>電塔基座支撐工程 - 結構計算書</title><style>' + style + '</style><body>' +
      '<div class="toolbar"><label>工程名稱 <input id="project-title" maxlength="100" value="' + projectName + '"></label>' +
      '<button type="button" id="print-report">列印／儲存 PDF</button></div><main>' +
      cover + contents + intro + pages + '</main></body></html>';
  }

  function formatGaps(gaps) {
    const runs = [];
    for (const gap of gaps) {
      if (runs.at(-1)?.gap === gap) runs.at(-1).count++;
      else runs.push({gap, count: 1});
    }
    return runs.map(({gap, count}) => (count > 1 ? count + ' × ' : '') + number(gap)).join('、');
  }

  function addPartCounts(add, arms, unconfigured, hasGroundAppendix) {
    const detailedTitle = hasGroundAppendix ? '附錄二' : '附錄一';
    const totalNumber = hasGroundAppendix && arms.length ? '三' : hasGroundAppendix || arms.length ? '二' : '一';
    const totalTitle = '附錄' + totalNumber + '　支撐架桿件數量總表';
    if (!arms.length) {
      add(totalTitle, notice('目前未取得支撐架配置，尚無桿件數量可彙總。'));
      return;
    }

    const beamNames = ['a', 'b', 'c', 'd'];
    const {byBeam, rows: parts} = root.TowerSupport.summarizeParts(arms);
    const codes = parts.map(({code}) => code);
    for (const arm of beamNames) {
      const title = detailedTitle + '　' + arm + ' 梁支撐架桿件數量';
      const data = byBeam.get(arm);
      if (!data) {
        add(title, notice(unconfigured.find(issue => issue.startsWith(arm + ' 梁')) ?? '本梁尚未配置。'));
        continue;
      }
      const rows = codes.filter(code => data.counts.has(code)).map(code => [code, data.counts.get(code)]);
      appendTable(add, title, ['料號', '數量（支）'], [...rows, ['本梁小計', data.total]]);
    }

    const missingBeams = beamNames.filter(arm => !byBeam.has(arm));
    const sum = values => values.reduce((total, value) => total + (value ?? 0), 0);
    const totalRows = codes.map(code => {
      const values = beamNames.map(arm => byBeam.has(arm) ? byBeam.get(arm).counts.get(code) ?? 0 : undefined);
      return [code, ...values.map(value => value ?? '—'), sum(values)];
    });
    const subtotals = beamNames.map(arm => byBeam.get(arm)?.total);
    totalRows.push(['桿件總數', ...subtotals.map(value => value ?? '—'), sum(subtotals)]);
    appendTable(add, totalTitle, ['料號', ...beamNames.map(arm => arm + ' 梁'), '合計（支）'], totalRows,
      missingBeams.length ? notice('總表僅合計已配置的梁。' + missingBeams.join('、') + ' 梁未配置，以「—」表示。') : '');
  }

  function appendTable(add, title, headings, rows, preface = '') {
    const rowsPerPage = 30;
    for (let i = 0; i < rows.length; i += rowsPerPage) {
      add(i ? title + '（續）' : title, preface + table(headings, rows.slice(i, i + rowsPerPage)), i ? '' : title);
    }
  }

  function open(preview, snapshot) {
    const doc = preview.document;
    doc.open();
    doc.write(render(snapshot));
    doc.close();
    doc.querySelector('#print-report').addEventListener('click', () => preview.print());
    const input = doc.querySelector('#project-title');
    input.addEventListener('input', () => {
      const title = input.value.trim() || projectName;
      for (const label of doc.querySelectorAll('[data-project]')) label.textContent = title;
      doc.title = title + ' - 結構計算書';
    });
    preview.opener = null;
  }

  root.TowerReport = Object.freeze({open});
})(window);
