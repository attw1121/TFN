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

  root.TowerSucootMaterialChecks = Object.freeze({checks, lineCapacity, spanLimit, timberPitch});
})(typeof window === 'undefined' ? globalThis : window);
