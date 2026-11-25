(function (root) {
  'use strict';

  const instances = new WeakMap();
  const SAMPLE_CSV = [
    'id,code,x1,y1,z1,x2,y2,z2,note',
    'S-V-01,V60300,0,0,0,0,0,3,示例立柱',
    'S-V-02,V60300,1.5,0,0,1.5,0,3,示例立柱',
    'S-V-03,V60300,0,1.5,0,0,1.5,3,示例立柱',
    'S-V-04,V60300,1.5,1.5,0,1.5,1.5,3,示例立柱',
    'S-H-01,H66150,0,0,1.5,1.5,0,1.5,示例橫桿',
    'S-H-02,H66150,0,1.5,1.5,1.5,1.5,1.5,示例橫桿',
    'S-H-03,H66150,0,0,1.5,0,1.5,1.5,示例橫桿',
    'S-H-04,H66150,1.5,0,1.5,1.5,1.5,1.5,示例橫桿',
    'S-H-05,H66150,0,0,3,1.5,0,3,示例橫桿',
    'S-H-06,H66150,0,1.5,3,1.5,1.5,3,示例橫桿',
    'S-H-07,H66150,0,0,3,0,1.5,3,示例橫桿',
    'S-H-08,H66150,1.5,0,3,1.5,1.5,3,示例橫桿',
    'S-D-01,D61515,0,0,0,1.5,0,1.5,示例斜桿',
    'S-D-02,D61515,0,1.5,0,1.5,1.5,1.5,示例斜桿'
  ].join('\r\n');

  function create(section, {loadExample} = {}) {
    if (!section || typeof section.replaceChildren !== 'function') throw new Error('找不到 3D 圖面區塊。');
    instances.get(section)?.destroy();
    const document = section.ownerDocument;
    const window = document.defaultView;
    let viewer = null;
    let model = null;
    let displaySource = '';
    let lastDetails = null;
    let operation = 0;
    let busy = false;
    let destroyed = false;
    let instance;

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function button(action, label, primary = false) {
      const node = element('button', 'button ' + (primary ? 'primary' : 'secondary'), label);
      node.type = 'button'; node.dataset.modelAction = action; node.id = 'model3d-' + action;
      return node;
    }
    function number(value) {
      return Number(value).toLocaleString('zh-TW', {maximumFractionDigits: 4});
    }
    const heading = element('div', 'panel-header');
    const headingText = element('div');
    headingText.appendChild(element('p', 'panel-kicker', '3D MODEL · 桿件座標'));
    const title = element('h2', '', '3D 桿件圖面'); title.id = 'model3d-title';
    headingText.appendChild(title);
    const badge = element('span', 'badge model-source', '尚未載入'); badge.id = 'model3d-source';
    heading.append(headingText, badge);
    section.setAttribute('aria-labelledby', title.id);
    const metadata = element('p', 'model-meta hint', '完成上方配置運算，或匯入逐桿端點座標，即可產生圖面。');
    metadata.id = 'model3d-meta'; metadata.setAttribute('role', 'status');
    const notice = element('p', 'model-notice hint'); notice.id = 'model3d-notice'; notice.hidden = true;
    const error = element('p', 'model-error', ''); error.id = 'model3d-error'; error.hidden = true; error.setAttribute('role', 'alert');

    const toolbar = element('div', 'model-toolbar');
    const colorLabel = element('label', 'model-color-label', '桿件配色'); colorLabel.htmlFor = 'model3d-color-mode';
    const colorMode = element('select'); colorMode.id = 'model3d-color-mode';
    for (const [value, label] of [['member', '每支桿件不同色'], ['type', '依桿件型號配色']]) {
      const option = element('option', '', label); option.value = value; colorMode.appendChild(option);
    }
    colorMode.value = 'member';
    const colorGroup = element('div', 'model-color-control'); colorGroup.append(colorLabel, colorMode);
    const views = element('div', 'actions model-views');
    for (const [action, label] of [['view-iso', '立體'], ['view-top', '俯視'], ['view-front', '正視'], ['view-side', '側視'], ['fit', '全圖'], ['zoom-in', '放大 ＋'], ['zoom-out', '縮小 −']]) views.appendChild(button(action, label));
    toolbar.append(colorGroup, views);

    const canvasBox = element('div', 'model-canvas'); canvasBox.id = 'model3d-canvas';
    const empty = element('div', 'model-empty');
    empty.append(element('strong', '', '讓每一支桿件，都有自己的位置。'),
      element('p', 'hint', '請先運算配置，或使用下方的 CSV 匯入與示例。'));
    canvasBox.appendChild(empty);
    const gestureHint = element('p', 'hint model-gesture-hint', '拖曳旋轉 · 滾輪縮放 · 右鍵或 Shift 拖曳平移 · 點選桿件查看座標。手機可單指旋轉、雙指縮放。');

    const dataActions = element('div', 'model-toolbar actions model-data-actions');
    const pngButton = button('export-png', '匯出 PNG');
    const csvButton = button('export-csv', '匯出座標 CSV');
    const importButton = button('import-csv', '匯入端點 CSV', true);
    const sampleButton = button('download-sample', '下載 CSV 範例');
    const exampleButton = button('example', '載入示例');
    const catalogButton = button('catalog', '查看實固桿件型錄');
    const catalogPicker = element('select');
    const catalogPickerLabel = element('label', 'model-color-control', '型錄規格 ');
    catalogPicker.id = 'model3d-catalog-size';
    catalogPickerLabel.htmlFor = catalogPicker.id;
    catalogPickerLabel.appendChild(catalogPicker);
    catalogPickerLabel.hidden = true;
    for (const [code, label] of [['', '全部規格'], ...Object.entries(root.ScaffoldSucoot?.specs ?? {}).map(([code, spec]) => [code, spec.label])]) {
      const option = element('option', '', label);
      option.value = code;
      catalogPicker.appendChild(option);
    }
    dataActions.append(pngButton, csvButton, importButton, sampleButton, exampleButton);
    if (root.ScaffoldSucoot) dataActions.append(catalogButton, catalogPickerLabel);
    const fileInput = element('input'); fileInput.type = 'file'; fileInput.accept = '.csv,text/csv'; fileInput.hidden = true; fileInput.id = 'model3d-import-file';
    dataActions.appendChild(fileInput);

    const legendHeading = element('div', 'model-legend-heading');
    legendHeading.append(element('h3', '', '桿件顯示篩選'), button('show-all', '全部顯示'));
    const legendHint = element('p', 'hint'); legendHint.id = 'model3d-legend-hint';
    const legend = element('div', 'model-legend'); legend.id = 'model3d-legend'; legend.setAttribute('role', 'group'); legend.setAttribute('aria-label', '依型號顯示或隱藏桿件');
    const legendArea = element('div', 'model-legend-area'); legendArea.append(legendHeading, legendHint, legend);
    const selection = element('div', 'model-selection'); selection.id = 'model3d-selection'; selection.setAttribute('aria-live', 'polite');
    const issues = element('details', 'model-issues'); issues.id = 'model3d-issues'; issues.hidden = true;
    section.replaceChildren(heading, metadata, notice, error, toolbar, canvasBox, gestureHint, dataActions, legendArea, selection, issues);

    function showError(failure, prefix = '') {
      error.textContent = prefix + (failure?.message || String(failure)); error.hidden = false;
    }
    function clearError() { error.textContent = ''; error.hidden = true; }
    function ready() { return Boolean(model && model.members.length); }
    function updateControls() {
      const canDraw = ready() && viewer?.available !== false && Boolean(viewer);
      colorMode.disabled = busy || !canDraw;
      views.querySelectorAll('button').forEach(node => { node.disabled = busy || !canDraw; });
      pngButton.disabled = busy || !canDraw;
      csvButton.disabled = busy || !ready();
      importButton.disabled = busy || !root.ScaffoldModel;
      exampleButton.disabled = busy || !root.ScaffoldModel;
      sampleButton.disabled = busy;
      catalogButton.disabled = busy || !root.ScaffoldModel;
      catalogPicker.disabled = catalogButton.disabled;
      catalogPickerLabel.hidden = displaySource !== 'catalog';
      legend.querySelectorAll('input').forEach(node => { node.disabled = busy || !canDraw; });
      legendHeading.querySelector('button').disabled = busy || !canDraw;
      fileInput.disabled = busy;
    }
    function updateMetadata() {
      if (!ready()) {
        metadata.textContent = '完成上方配置運算，或匯入逐桿端點座標，即可產生圖面。';
        return;
      }
      const shown = new Set(Array.from(legend.querySelectorAll('input:checked')).map(input => input.value));
      const visibleCount = model.members.filter(member => shown.has(member.code)).length;
      const kinds = new Set(model.members.map(member => member.code)).size;
      const extent = model.bounds.max.map((value, axis) => value - model.bounds.min[axis]);
      metadata.textContent = '共 ' + number(model.members.length) + ' 支 · ' + kinds + ' 種型號 · 顯示 ' + number(visibleCount) + ' 支 · ' +
        '範圍 X ' + number(extent[0]) + ' × Y ' + number(extent[1]) + ' × Z ' + number(extent[2]) + ' m';
    }
    function updateLegendColors() {
      const byType = colorMode.value === 'type';
      legendHint.textContent = byType ? '相同型號使用相同顏色；取消勾選可隱藏該型號。' :
        '目前每支桿件獨立配色，以下灰色標記僅供型號篩選；切換「依桿件型號配色」可查看固定色。';
      legend.querySelectorAll('.model-legend-dot').forEach(dot => {
        dot.style.backgroundColor = byType ? model?.colors?.[dot.dataset.code] || root.ScaffoldModel?.COLORS?.[dot.dataset.code] || '#6e8982' : '#bdccc5';
      });
    }
    function applyVisibility() {
      const codes = Array.from(legend.querySelectorAll('input:checked')).map(input => input.value);
      viewer?.setVisibleTypes(codes); updateMetadata();
    }
    function showSelection(member) {
      selection.replaceChildren();
      if (!member) {
        selection.append(element('strong', '', '桿件座標'), element('p', 'hint', '點選圖面中的桿件，查看型號與兩端座標。'));
        return;
      }
      selection.append(element('strong', '', String(member.id) + ' · ' + String(member.code)));
      const spec = root.ScaffoldSucoot?.specs[member.code];
      if (spec) selection.appendChild(element('p', 'hint', spec.label));
      const list = element('dl', 'model-coordinate-list');
      const length = Math.hypot(...member.end.map((value, index) => value - member.start[index]));
      for (const [label, value] of [
        ['起點（X, Y, Z）m', '(' + member.start.map(number).join(', ') + ')'],
        ['終點（X, Y, Z）m', '(' + member.end.map(number).join(', ') + ')'],
        ['端點距離', number(length) + ' m']
      ]) list.append(element('dt', '', label), element('dd', '', value));
      selection.appendChild(list);
      if (member.note) selection.appendChild(element('p', 'hint', String(member.note)));
    }
    function dropModel() {
      viewer?.destroy(); viewer = null; model = null; displaySource = '';
      empty.hidden = false; badge.textContent = '尚未載入'; delete badge.dataset.source;
      legend.replaceChildren(); notice.hidden = true; issues.replaceChildren(); issues.hidden = true;
      showSelection(null); updateMetadata(); updateLegendColors(); updateControls();
    }
    function applyModel(value, source) {
      if (!value || !Array.isArray(value.members) || !value.members.length || !value.bounds) throw new Error('沒有可顯示的桿件端點座標。');
      viewer?.destroy(); viewer = null;
      model = value; displaySource = source;
      empty.hidden = true;
      badge.dataset.source = source;
      const sourceLabels = {inferred: '配置推導示意', sample: '示例座標', catalog: '實固桿件型錄', coordinates: '匯入端點座標'};
      badge.textContent = sourceLabels[source];
      notice.hidden = false;
      const sourceNotices = {
        inferred: '依實固型錄規格與配置座標繪製。接點高度由配置推估，未標註尺寸的零件以近似外形呈現。',
        sample: '目前顯示內建示例。',
        catalog: '型錄第 20–21 頁桿件與調整座。點選構件可查看標稱尺寸，未標註尺寸的零件以近似外形呈現。',
        coordinates: '圖面使用匯入檔案指定的桿件端點座標。'
      };
      notice.textContent = sourceNotices[source];
      const counts = new Map();
      model.members.forEach(member => counts.set(member.code, (counts.get(member.code) || 0) + 1));
      legend.replaceChildren();
      for (const [code, count] of counts) {
        const label = element('label', 'model-legend-item');
        const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.value = code;
        checkbox.setAttribute('aria-label', '顯示 ' + code); checkbox.dataset.modelType = code;
        const dot = element('span', 'model-legend-dot'); dot.dataset.code = code; dot.setAttribute('aria-hidden', 'true');
        const spec = root.ScaffoldSucoot?.specs[code];
        const caption = source === 'catalog' && spec ? spec.label : code;
        label.append(checkbox, dot, element('span', '', caption), element('small', '', number(count) + ' 支'));
        legend.appendChild(label);
      }
      issues.replaceChildren();
      const notes = Array.isArray(value.issues) ? value.issues : [];
      issues.hidden = !notes.length;
      if (notes.length) {
        issues.appendChild(element('summary', '', '座標與組立提示（' + notes.length + ' 項）'));
        const list = element('ul');
        notes.slice(0, 20).forEach(note => list.appendChild(element('li', '', String(note))));
        issues.appendChild(list);
        if (notes.length > 20) issues.appendChild(element('p', 'hint', '此處顯示前 20 項，共有 ' + notes.length + ' 項提示。'));
      }
      clearError(); showSelection(null); updateLegendColors(); updateMetadata();
      if (!root.ScaffoldViewer3D) showError(new Error('無法載入 3D 繪圖程式，請確認 scaffold-viewer3d.js 位於相同資料夾。'));
      else {
        try {
          viewer = root.ScaffoldViewer3D.create(canvasBox, {onSelect: showSelection, onError: showError});
          if (viewer.available !== false) { viewer.setColorMode(colorMode.value); viewer.setModel(model); }
        } catch (failure) { viewer?.destroy(); viewer = null; showError(failure); }
      }
      updateControls();
    }

    function download(content, filename, mime = 'text/csv;charset=utf-8') {
      const link = document.createElement('a');
      let objectUrl = null;
      link.href = typeof content === 'string' && content.startsWith('data:image/png') ? content :
        (objectUrl = window.URL.createObjectURL(new Blob(['\uFEFF', content], {type: mime})));
      link.download = filename; document.body.appendChild(link); link.click(); link.remove();
      if (objectUrl) window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
    }
    function showCatalog(code) {
      const preview = root.ScaffoldModel.parseCSV(root.ScaffoldSucoot.previewCSV(code));
      applyModel({...preview, source: 'catalog'}, 'catalog');
    }
    function onClick(event) {
      const control = event.target.closest('button[data-model-action]');
      if (!control || !section.contains(control) || control.disabled || busy) return;
      const action = control.dataset.modelAction;
      clearError();
      try {
        if (action.startsWith('view-')) viewer?.setView(action.slice(5));
        else if (action === 'fit') viewer?.fit();
        else if (action === 'zoom-in') viewer?.zoom(1.25);
        else if (action === 'zoom-out') viewer?.zoom(0.8);
        else if (action === 'export-png') download(viewer.snapshot(), displaySource === 'sample' ? '桿件3D圖面_示例.png' : '桿件3D圖面.png');
        else if (action === 'export-csv') download(root.ScaffoldModel.toCSV(model), displaySource === 'sample' ? '桿件端點座標_示例.csv' : '桿件端點座標.csv');
        else if (action === 'import-csv') fileInput.click();
        else if (action === 'download-sample') download(SAMPLE_CSV, '桿件端點座標_範例.csv');
        else if (action === 'example') {
          if (loadExample) loadExample();
          else {
            operation++;
            applyModel(root.ScaffoldModel.parseCSV(SAMPLE_CSV), 'sample');
          }
        }
        else if (action === 'catalog') {
          operation++;
          catalogPicker.value = '';
          showCatalog('');
        }
        else if (action === 'show-all') {
          legend.querySelectorAll('input').forEach(input => { input.checked = true; }); applyVisibility();
        }
      } catch (failure) { showError(failure); }
    }
    async function onChange(event) {
      if (event.target === colorMode) { viewer?.setColorMode(colorMode.value); updateLegendColors(); }
      else if (event.target === catalogPicker) {
        try { showCatalog(catalogPicker.value); } catch (failure) { showError(failure); }
      }
      else if (event.target.matches('input[data-model-type]')) applyVisibility();
      else if (event.target === fileInput) {
        const file = fileInput.files[0]; fileInput.value = '';
        if (!file || busy) return;
        const currentOperation = ++operation;
        busy = true; clearError(); updateControls();
        try {
          if (file.size > 10 * 1024 * 1024) throw new Error('座標 CSV 超過 10 MB，請縮小檔案後再匯入。');
          const parsed = root.ScaffoldModel.parseCSV(await file.text());
          if (destroyed || currentOperation !== operation) return;
          applyModel(parsed, 'coordinates');
        } catch (failure) {
          if (!destroyed && currentOperation === operation) showError(failure, '匯入失敗，原圖面保留：');
        } finally {
          if (!destroyed && currentOperation === operation) { busy = false; updateControls(); }
        }
      }
    }
    section.addEventListener('click', onClick); section.addEventListener('change', onChange);
    updateLegendColors(); showSelection(null); updateControls();
    if (!root.ScaffoldModel) showError(new Error('無法載入座標模型程式，請確認 scaffold-model.js 位於相同資料夾。'));

    instance = {
      setAssembly(value) {
        if (destroyed) return;
        operation++;
        busy = false;
        lastDetails = null;
        applyModel(value, 'inferred');
      },
      setCalculation(details) {
        if (destroyed || !details || (details === lastDetails && displaySource === 'inferred')) return;
        lastDetails = details;
        operation++; busy = false;
        try { applyModel(root.ScaffoldModel.fromCalculation(details), 'inferred'); }
        catch (failure) {
          if (displaySource === 'inferred') dropModel();
          showError(failure, '配置圖面無法產生：'); updateControls();
        }
      },
      clearCalculation() {
        if (!destroyed && displaySource === 'inferred') { operation++; busy = false; dropModel(); lastDetails = null; clearError(); }
      },
      destroy() {
        if (destroyed) return;
        destroyed = true; operation++; viewer?.destroy(); viewer = null; model = null;
        section.removeEventListener('click', onClick); section.removeEventListener('change', onChange);
        section.replaceChildren();
        if (instances.get(section) === instance) instances.delete(section);
      }
    };
    instances.set(section, instance);
    return instance;
  }

  root.Scaffold3DPanel = Object.freeze({create});
})(typeof window === 'undefined' ? globalThis : window);
