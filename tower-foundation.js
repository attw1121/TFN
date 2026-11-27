(function (root) {
  'use strict';

  // Measurements from 範例圖.dxf, in mm (DXF DIMENSION group 42).
  const dimensions = Object.freeze([
    {key: 'diameter', number: '①', label: '井桶直徑φ', example: 6000, min: 1}, // FC01
    {key: 'projection', number: '②', label: '梁突出井桶長度', example: 5725, min: 0}, // 101CA
    {key: 'innerDepth', number: '③', label: '梁內緣深', example: 2300, min: 1}, // FC07
    {key: 'outerDepth', number: '④', label: '梁外緣深', example: 1900, min: 1}, // FC0A
    {key: 'width', number: '⑤', label: '梁寬', example: 1700, min: 1}, // F527
    {key: 'clearance', number: '⑥', label: '梁內緣距地面高度', example: 5000, min: 0} // 101B2
  ]);
  const example = Object.freeze(Object.fromEntries(dimensions.map(({key, example}) => [key, example])));
  const beamArms = Object.freeze(['d', 'c', 'b', 'a']); // +X, +Y, -X, -Y
  const beamRotations = Object.freeze([point => point, ([x, y, z]) => [-y, x, z],
    ([x, y, z]) => [-x, -y, z], ([x, y, z]) => [y, -x, z]]);
  const memberCategories = Object.freeze({
    well: {name: '井桶', color: '#7898a4'},
    beam: {name: '大梁', color: '#17958b'},
    pedestal: {name: '梁上墩座', color: '#d5923b'},
    formwork: {name: '模板', color: '#d8a274'},
    timber: {name: '木角材', color: '#925d32'},
    steel: {name: '型鋼', color: '#33415e'},
    flat: {name: '平主架', color: '#2968aa'},
    post: {name: '主架', color: '#7161aa'},
    rail: {name: '橫桿', color: '#44835e'},
    brace: {name: '斜桿', color: '#bd5448'},
    base: {name: '標準基座', color: '#738141'},
    fixedBase: {name: '下底座', color: '#bf8722'},
    extension: {name: '輔助桿', color: '#a45685'},
    lowerJack: {name: '下調整座', color: '#6a747e'},
    upperJack: {name: '上調整座', color: '#346c73'},
    other: {name: '其他桿件', color: '#485463'}
  });
  const colors = Object.freeze(Object.fromEntries(['well', 'beam', 'pedestal']
    .map(code => [code, memberCategories[code].color])));
  // NLMA wood construction specifications, Tables 4.2-1, 4.3-1(a) and 4.4-1.
  // Ordinary structural lumber: parallel-to-grain E and long-duration Fb/Fv, in kgf/cm².
  const woodMaterials = Object.freeze([
    {id: 'chinese-fir', label: '杉木（氣乾比重 > 0.3）', e: 70000, fb: 75, fv: 6},
    {id: 'chinese-fir-light', label: '杉木（氣乾比重 ≤ 0.3）', e: 49000, fb: 52.5, fv: 4.2},
    {id: 'lauan', label: '柳安（柳桉）', e: 70000, fb: 90, fv: 6},
    {id: 'western-hemlock', label: '北美鐵杉', e: 80000, fb: 85, fv: 7},
    {id: 'douglas-fir', label: '花旗松', e: 100000, fb: 95, fv: 8}
  ].map(material => Object.freeze(material)));
  // Tung Ho Steel 2025 catalog, hot-rolled H sections. All dimensions are in mm.
  // Height, width, web thickness, flange thickness, root fillet radius.
  const steelProfiles = Object.freeze([
    [100, 50, 5, 7, 8],
    [100, 100, 6, 8, 8],
    [125, 125, 6.5, 9, 8],
    [150, 75, 5, 7, 8],
    [148, 100, 6, 9, 8],
    [150, 150, 7, 10, 8],
    [175, 90, 5, 8, 8],
    [200, 100, 5.5, 8, 8],
    [194, 150, 6, 9, 8],
    [200, 200, 8, 12, 13],
    [250, 125, 6, 9, 8],
    [250, 250, 9, 14, 13],
    [300, 150, 6.5, 9, 13],
    [294, 200, 8, 12, 13],
    [300, 300, 10, 15, 13],
    [350, 175, 7, 11, 13]
  ].map(profile => Object.freeze(profile)));

  function sectionProperties(area, inertia, halfHeight) {
    const modulus = inertia / halfHeight;
    return [area, inertia, modulus].every(value => Number.isFinite(value) && value > 0)
      ? {A: area, I: inertia, Z: modulus} : null;
  }

  function rectangleSection(widthMm, heightMm) {
    const width = widthMm / 10;
    const height = heightMm / 10;
    if (!(width > 0 && height > 0)) return null;
    return sectionProperties(width * height, width * height ** 3 / 12, height / 2);
  }

  function steelSection(profile) {
    if (!profile) return null;
    const [height, width, web, flange, radius] = profile.map(dimension => dimension / 10);
    const webHeight = height - 2 * flange;
    const flangeCenter = (height - flange) / 2;
    // Each fillet is a square minus a quarter circle. Transfer its moments to X–X.
    const filletArea = (1 - Math.PI / 4) * radius ** 2;
    const filletFirstMoment = radius ** 3 / 6;
    const filletSecondMoment = (1 / 3 - Math.PI / 16) * radius ** 4;
    const circleCenter = webHeight / 2 - radius;
    const filletInertia = filletSecondMoment + 2 * circleCenter * filletFirstMoment + circleCenter ** 2 * filletArea;
    const area = web * webHeight + 2 * width * flange + 4 * filletArea;
    const inertia = web * webHeight ** 3 / 12 +
      2 * width * flange * (flange ** 2 / 12 + flangeCenter ** 2) + 4 * filletInertia;
    return sectionProperties(area, inertia, height / 2);
  }

  function beddingSection(type, dimensions) {
    if (type === 'steel') return steelSection(dimensions);
    const [height, width, wall, flange] = dimensions.map(value => value / 10);
    if (type === 'timber') return rectangleSection(width * 10, height * 10);
    if (!(height > 0 && width > 0 && wall > 0)) return null;
    // Channel and tube dimensions define sharp-corner nominal sections.
    const hollowHeight = height - 2 * (type === 'tube' ? wall : flange);
    const hollowWidth = width - (type === 'tube' ? 2 : 1) * wall;
    if (!(hollowHeight > 0 && hollowHeight < height && hollowWidth > 0)) return null;
    return sectionProperties(width * height - hollowWidth * hollowHeight,
      (width * height ** 3 - hollowWidth * hollowHeight ** 3) / 12, height / 2);
  }

  function calculate(values) {
    for (const {key, number, label, min} of dimensions) {
      const value = values[key];
      if (!Number.isFinite(value) || value < min) {
        throw new Error(number + label + '須為大於或等於 ' + min + ' mm 的數值。');
      }
    }
    const {diameter, projection, innerDepth, outerDepth, width, clearance} = values;
    if (width > diameter) throw new Error('⑤梁寬須小於或等於①井桶直徑φ。');
    const length = diameter + 2 * projection;
    const top = clearance + innerDepth;
    const outerSoffit = top - outerDepth;
    const radius = diameter / 2;
    const halfWidth = width / 2;
    const chord = Math.sqrt((radius - halfWidth) * (radius + halfWidth));
    // FB0F and F7E2/F7E3 define the tapered pier shown on each beam.
    // Keep its drawing dimensions where it fits and scale its footprint on smaller beams.
    const pierScale = Math.min(1, width / 1000, projection / 2180);
    const pierEnd = length / 2 - 580 * pierScale;
    const pier = projection > 0 ? {
      start: pierEnd - 1600 * pierScale, end: pierEnd,
      topEnd: pierEnd - 600 * pierScale, halfWidth: 500 * pierScale, height: 2000
    } : null;
    if (!Number.isFinite(Math.max(length, top + (pier?.height ?? 0), outerDepth, chord))) {
      throw new Error('尺寸超出可計算範圍，請縮小輸入值。');
    }
    return {...values, length, top, outerSoffit, radius, halfWidth, chord, pier};
  }

  function quad(triangles, a, b, c, d) {
    triangles.push([a, b, c], [a, c, d]);
  }

  function cappedRings(bottom, top) {
    const triangles = [];
    for (let i = 0; i < bottom.length; i++) {
      const next = (i + 1) % bottom.length;
      quad(triangles, bottom[i], bottom[next], top[next], top[i]);
      if (i > 0 && next > 0) {
        triangles.push([bottom[0], bottom[next], bottom[i]], [top[0], top[i], top[next]]);
      }
    }
    return triangles;
  }

  // Distances and elevations are in mm. At a step, the second height applies at the station and outward.
  function groundElevation(profile, distance) {
    const origin = profile?.origin ?? 0;
    let x = 0, z = origin;
    for (const [nextX, relativeElevation] of profile?.points ?? []) {
      const nextZ = origin + relativeElevation;
      if (distance < nextX - 1e-7) {
        const ratio = Math.max(0, (distance - x) / (nextX - x));
        return (1 - ratio) * z + ratio * nextZ;
      }
      x = nextX;
      z = nextZ;
    }
    return z;
  }

  function groundStations(profile, length) {
    const origin = profile?.origin ?? 0;
    const stations = [[0, origin]];
    for (const [distance, elevation] of profile?.points ?? []) {
      if (distance > length) break;
      stations.push([distance, origin + elevation]);
    }
    if (stations.at(-1)[0] < length) stations.push([length, groundElevation(profile, length)]);
    return stations;
  }

  function makeModel(shape, groundProfiles = {}, endExtension = 0) {
    const {radius, halfWidth, chord, projection, clearance, length, top, outerSoffit, pier} = shape;
    const tip = length / 2;
    const members = [];
    const labels = [];
    const groundLines = [];
    const metres = vector => vector.map(value => value / 1000);
    const add = (code, triangles, orient, start, end, arm, facts) => {
      members.push({code, start: metres(orient(start)), end: metres(orient(end)),
        triangles: triangles.map(triangle => triangle.map(point => metres(orient(point)))),
        inspection: {category: code, arm, facts}});
    };
    const circle = Array.from({length: 96}, (_, index) => {
      const angle = index * Math.PI / 48;
      return [radius * Math.cos(angle), radius * Math.sin(angle)];
    });
    add('well', cappedRings(circle.map(point => [...point, 0]), circle.map(point => [...point, top])),
      point => point, [0, 0, 0], [0, 0, top], null, [
        ['井桶直徑', shape.diameter, 'mm'], ['模型高度', top, 'mm']
      ]);

    if (projection > 0) {
      const beam = [];
      const stations = [[chord, clearance], [radius, clearance], [tip, outerSoffit]];
      const ring = ([x, bottom]) => [[x, -halfWidth, bottom], [x, halfWidth, bottom],
        [x, halfWidth, top], [x, -halfWidth, top]];
      const rings = stations.map(ring);
      quad(beam, ...rings[0].slice().reverse());
      quad(beam, ...rings[2]);
      for (let i = 0; i < rings.length - 1; i++) {
        for (let side = 0; side < 4; side++) {
          const next = (side + 1) % 4;
          quad(beam, rings[i][side], rings[i][next], rings[i + 1][next], rings[i + 1][side]);
        }
      }
      const footprint = (end, z) => [[pier.start, -pier.halfWidth, z], [end, -pier.halfWidth, z],
        [end, pier.halfWidth, z], [pier.start, pier.halfWidth, z]];
      const pedestal = cappedRings(footprint(pier.end, top), footprint(pier.topEnd, top + pier.height));
      for (const [index, orient] of beamRotations.entries()) {
        const arm = beamArms[index];
        const ground = groundProfiles[arm];
        if (ground?.origin || ground?.points.length) {
          groundLines.push(groundStations(ground, projection + endExtension)
            .map(([distance, elevation]) => metres(orient([radius + distance, 0, elevation]))));
        }
        const midpoint = radius + projection / 2;
        labels.push({text: arm, position: metres(orient([tip, 0, top]))});
        add('beam', beam, orient, [midpoint, 0, clearance], [midpoint, 0, top], arm, [
          ['外伸長度', projection, 'mm'], ['梁寬', shape.width, 'mm'],
          ['內緣深度', shape.innerDepth, 'mm'], ['外緣深度', shape.outerDepth, 'mm']
        ]);
        add('pedestal', pedestal, orient, [pier.start, 0, top], [pier.start, 0, top + pier.height], arm, [
          ['底面長', pier.end - pier.start, 'mm'], ['頂面長', pier.topEnd - pier.start, 'mm'],
          ['寬度', 2 * pier.halfWidth, 'mm'], ['高度', pier.height, 'mm']
        ]);
      }
    }
    const bottom = projection > 0 ? Math.min(0, outerSoffit) : 0;
    const highest = top + (pier?.height ?? 0);
    const bounds = {min: metres([-tip, -tip, bottom]), max: metres([tip, tip, highest])};
    for (const line of groundLines) {
      for (const point of line) {
        for (const [axis, value] of point.entries()) {
          bounds.min[axis] = Math.min(bounds.min[axis], value);
          bounds.max[axis] = Math.max(bounds.max[axis], value);
        }
      }
    }
    const centerZ = (bounds.min[2] + bounds.max[2]) / 2;
    let fitRadius = 0.5;
    for (const {triangles} of members) {
      for (const triangle of triangles) {
        for (const [x, y, z] of triangle) fitRadius = Math.max(fitRadius, Math.hypot(x, y, z - centerZ));
      }
    }
    for (const line of groundLines) {
      for (const [x, y, z] of line) fitRadius = Math.max(fitRadius, Math.hypot(x, y, z - centerZ));
    }
    return {members, labels, groundLines, colors, groundZ: 0, bounds, fitRadius};
  }

  root.TowerFoundation = Object.freeze({
    dimensions, example, beamArms, beamRotations, colors, memberCategories, calculate, makeModel, groundElevation, groundStations,
    woodMaterials, steelProfiles, rectangleSection, steelSection, beddingSection
  });
})(typeof window === 'undefined' ? globalThis : window);
