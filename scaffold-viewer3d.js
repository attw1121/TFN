(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const normalize = value => {
    const length = Math.hypot(...value);
    return length ? value.map(component => component / length) : [0, 0, 1];
  };
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function multiply(a, b) {
    const result = new Float32Array(16);
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        result[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
      }
    }
    return result;
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0,
      (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
  }

  function lookAt(eye, target) {
    const z = normalize(subtract(eye, target));
    const x = normalize(cross([0, 0, 1], z));
    const y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }

  function hexColor(value) {
    const text = String(value || '#238b80').replace('#', '');
    const hex = text.length === 3 ? text.split('').map(character => character + character).join('') : text;
    if (!/^[0-9a-f]{6}$/i.test(hex)) return [0.14, 0.55, 0.5];
    return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  }

  function memberColor(index) {
    const h = ((index * 137.50776405003785) % 360) / 60;
    const saturation = 0.72;
    const lightness = 0.48 + (index % 3) * 0.035;
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const second = chroma * (1 - Math.abs(h % 2 - 1));
    const pairs = [[chroma, second, 0], [second, chroma, 0], [0, chroma, second],
      [0, second, chroma], [second, 0, chroma], [chroma, 0, second]];
    return pairs[Math.floor(h)].map(value => value + lightness - chroma / 2);
  }

  function create(container, {onSelect = () => {}, onError = () => {}, label = '桿件 3D 圖面', surfaceSelection = false} = {}) {
    if (!container || typeof container.appendChild !== 'function') throw new Error('找不到 3D 圖面容器。');
    const document = container.ownerDocument;
    const window = document.defaultView;
    const originalPosition = container.style.position;
    if (window.getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const canvas = document.createElement('canvas');
    canvas.className = 'scaffold-webgl-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline-offset:-4px;';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', label + '。拖曳旋轉、滾輪縮放、右鍵或 Shift 拖曳平移。方向鍵可旋轉，Home 回到全圖。');
    const overlay = document.createElement('canvas');
    overlay.className = 'scaffold-webgl-labels';
    overlay.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none;';
    overlay.setAttribute('aria-hidden', 'true');
    container.append(canvas, overlay);
    const context2d = overlay.getContext('2d');
    let gl;
    try { gl = canvas.getContext('webgl', {antialias: true, alpha: false, preserveDrawingBuffer: true}); }
    catch (_) { /* 訊息由下方統一顯示。 */ }

    if (!gl) {
      const failure = new Error('此瀏覽器無法使用 WebGL 3D 圖面，請改用支援硬體加速的瀏覽器。');
      const message = document.createElement('p');
      message.textContent = failure.message;
      message.className = 'viewer3d-error';
      message.style.cssText = 'position:absolute;inset:24px;color:#a83c36;';
      container.appendChild(message);
      onError(failure);
      const noop = () => false;
      return {available: false, setModel: noop, setColorMode: noop, setVisibleTypes: noop,
        setView: noop, zoom: noop, fit: noop, clearSelection: noop,
        snapshot() { throw failure; },
        destroy() { canvas.remove(); overlay.remove(); message.remove(); container.style.position = originalPosition; }};
    }

    let destroyed = false;
    let lost = false;
    let frame = 0;
    let model = null;
    let origin = [0, 0, 0];
    let size = [1, 1, 1];
    let radius = 1;
    let members = [];
    let visible = null;
    let colorMode = 'type';
    let selectedIndex = -1;
    let yaw = -Math.PI / 4;
    let pitch = 0.54;
    let distance = 7;
    let target = [0, 0, 0];
    let cssWidth = 640;
    let cssHeight = 440;
    let autoFit = true;
    let matrix = new Float32Array(16);
    let meshCount = 0;
    let gridCount = 0;
    let lineMode = false;
    let axisAnchor = [0, 0, 0];
    let axisLength = 1;
    const listeners = [];
    const pointers = new Map();
    let gesture = null;

    const vertexSource = `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      attribute vec3 aTypeColor;
      attribute vec3 aMemberColor;
      attribute float aId;
      uniform mat4 uMatrix;
      uniform float uColorMode;
      uniform float uSelected;
      uniform float uPicking;
      varying vec3 vColor;
      void main() {
        vec3 color = mix(aTypeColor, aMemberColor, uColorMode);
        float light = 1.0;
        if (dot(aNormal, aNormal) > 0.1) {
          light = 0.55 + 0.38 * max(dot(normalize(aNormal), normalize(vec3(0.4, -0.5, 0.85))), 0.0)
            + 0.12 * abs(aNormal.z);
        }
        if (abs(aId - uSelected) < 0.25) color = mix(color, vec3(1.0, 0.80, 0.15), 0.8);
        vColor = color * light;
        if (uPicking > 0.5) {
          vColor = vec3(mod(aId, 256.0), mod(floor(aId / 256.0), 256.0), floor(aId / 65536.0)) / 255.0;
        }
        gl_Position = uMatrix * vec4(aPosition, 1.0);
      }`;
    const fragmentSource = `
      precision mediump float;
      varying vec3 vColor;
      void main() { gl_FragColor = vec4(vColor, 1.0); }`;

    function shader(type, source) {
      const result = gl.createShader(type);
      gl.shaderSource(result, source);
      gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
        const failure = new Error('3D 著色程式無法編譯：' + gl.getShaderInfoLog(result));
        gl.deleteShader(result);
        throw failure;
      }
      return result;
    }
    let program;
    let meshBuffer;
    let gridBuffer;
    let locations;
    let pickTarget;
    try {
      const vertex = shader(gl.VERTEX_SHADER, vertexSource);
      const fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('3D 著色程式無法連結。');
      meshBuffer = gl.createBuffer(); gridBuffer = gl.createBuffer();
      locations = Object.fromEntries(['aPosition', 'aNormal', 'aTypeColor', 'aMemberColor', 'aId'].map(name => [name, gl.getAttribLocation(program, name)]));
      locations.matrix = gl.getUniformLocation(program, 'uMatrix');
      locations.colorMode = gl.getUniformLocation(program, 'uColorMode');
      locations.selected = gl.getUniformLocation(program, 'uSelected');
      locations.picking = gl.getUniformLocation(program, 'uPicking');
    } catch (failure) {
      canvas.remove(); overlay.remove();
      if (program) gl.deleteProgram(program);
      const message = document.createElement('p'); message.textContent = failure.message;
      message.className = 'viewer3d-error'; container.appendChild(message);
      onError(failure);
      throw failure;
    }

    function schedule() {
      if (!frame && !destroyed && !lost) frame = window.requestAnimationFrame(render);
    }
    function listen(element, name, callback, options) {
      element.addEventListener(name, callback, options);
      listeners.push(() => element.removeEventListener(name, callback, options));
    }
    function local(point) { return subtract(point, origin); }
    function vertex(array, position, normal, typeColor, individualColor, id) {
      array.push(...position, ...normal, ...typeColor, ...individualColor, id);
    }
    function line(array, first, second, color) {
      vertex(array, first, [0, 0, 0], color, color, 0);
      vertex(array, second, [0, 0, 0], color, color, 0);
    }

    function rebuild() {
      const filtered = members.filter(entry => !visible || visible.has(entry.member.code));
      // 大型場景切成逐桿線模型，保留每支桿件與其顏色、座標及選取功能。
      lineMode = filtered.length > 6000;
      const data = [];
      const sides = 8;
      const detailed = filtered.length <= 600;
      for (const {member, index} of filtered) {
        const start = local(member.start);
        const end = local(member.end);
        const byType = hexColor(model.colors?.[member.code]);
        const byMember = memberColor(index);
        const id = index + 1;
        if (lineMode) {
          vertex(data, start, [0, 0, 0], byType, byMember, id);
          vertex(data, end, [0, 0, 0], byType, byMember, id);
          continue;
        }
        if (member.triangles) {
          for (const [a, b, c] of member.triangles) {
            const normal = normalize(cross(subtract(b, a), subtract(c, a)));
            for (const point of [a, b, c]) vertex(data, local(point), normal, byType, byMember, id);
          }
          continue;
        }
        const direction = normalize(subtract(end, start));
        const defaultSide = cross(direction, Math.hypot(direction[0], direction[1]) > 1e-7 ? [0, 0, 1] : [0, 1, 0]);
        // The U-shaped head is open along local Y in the part mesh.
        const saddleSide = member.saddleAxis && cross(member.saddleAxis, direction);
        const u = normalize(saddleSide && Math.hypot(...saddleSide) > 1e-7 ? saddleSide : defaultSide);
        const v = cross(direction, u);
        const orient = ([x, y, z]) => u.map((value, axis) => value * x + v[axis] * y + direction[axis] * z);
        if (root.ScaffoldSucoot?.mesh(member.code, Math.hypot(...subtract(end, start)), (point, normal) => {
          const position = orient(point).map((value, axis) => value + start[axis]);
          vertex(data, position, orient(normal), byType, byMember, id);
        }, {detailed, specimen: model.source === 'catalog', product: model.products?.[member.code], slope: direction[2]})) continue;
        const tubeRadius = Number(member.radius) > 0 ? Number(member.radius) : /^[UJ]/.test(member.code) ? 0.045 : 0.03;
        function ring(angle, point) {
          const normal = u.map((value, axis) => value * Math.cos(angle) + v[axis] * Math.sin(angle));
          return {normal, point: point.map((value, axis) => value + normal[axis] * tubeRadius)};
        }
        function emit(item, normal = item.normal) { vertex(data, item.point, normal, byType, byMember, id); }
        for (let side = 0; side < sides; side++) {
          const angle = side * TAU / sides;
          const next = (side + 1) * TAU / sides;
          const first = ring(angle, start); const second = ring(next, start);
          const third = ring(angle, end); const fourth = ring(next, end);
          emit(first); emit(third); emit(second); emit(second); emit(third); emit(fourth);
          emit({point: start}, direction.map(value => -value));
          emit(second, direction.map(value => -value)); emit(first, direction.map(value => -value));
          emit({point: end}, direction); emit(third, direction); emit(fourth, direction);
        }
      }
      meshCount = data.length / 13;
      gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      schedule();
    }

    function buildGrid() {
      const data = [];
      const floor = (model.groundZ ?? model.bounds.min[2]) - origin[2];
      const dimension = Math.max(size[0], size[1], 1);
      const rough = dimension / 12;
      const magnitude = 10 ** Math.floor(Math.log10(rough));
      const step = [1, 2, 5, 10].find(value => value * magnitude >= rough) * magnitude;
      const extentX = Math.max(size[0] / 2 + step, dimension / 4);
      const extentY = Math.max(size[1] / 2 + step, dimension / 4);
      const color = [0.82, 0.88, 0.84];
      for (let x = Math.ceil(-extentX / step) * step; x <= extentX; x += step) line(data, [x, -extentY, floor], [x, extentY, floor], color);
      for (let y = Math.ceil(-extentY / step) * step; y <= extentY; y += step) line(data, [-extentX, y, floor], [extentX, y, floor], color);
      for (const profile of model.groundLines ?? []) {
        for (let i = 1; i < profile.length; i++) {
          line(data, local(profile[i - 1]), local(profile[i]), [0.076, 0.40, 0.30]);
        }
      }
      axisAnchor = [-size[0] / 2, -size[1] / 2, floor];
      axisLength = Math.max(radius * 0.28, 0.3);
      line(data, axisAnchor, [axisAnchor[0] + axisLength, axisAnchor[1], floor], [0.82, 0.25, 0.23]);
      line(data, axisAnchor, [axisAnchor[0], axisAnchor[1] + axisLength, floor], [0.2, 0.57, 0.33]);
      line(data, axisAnchor, [axisAnchor[0], axisAnchor[1], floor + axisLength], [0.2, 0.4, 0.8]);
      gridCount = data.length / 13;
      gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    }

    function bind(buffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const stride = 13 * 4;
      for (const [name, count, offset] of [['aPosition', 3, 0], ['aNormal', 3, 3], ['aTypeColor', 3, 6], ['aMemberColor', 3, 9], ['aId', 1, 12]]) {
        gl.enableVertexAttribArray(locations[name]);
        gl.vertexAttribPointer(locations[name], count, gl.FLOAT, false, stride, offset * 4);
      }
    }

    function project(point) {
      const x = point[0], y = point[1], z = point[2];
      const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
      if (w <= 0) return null;
      return [(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w * cssWidth / 2 + cssWidth / 2,
        cssHeight / 2 - (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w * cssHeight / 2,
        (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w];
    }

    function drawLabels() {
      if (!context2d) return;
      const dpr = overlay.width / cssWidth;
      context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      context2d.clearRect(0, 0, cssWidth, cssHeight);
      context2d.font = 'bold 12px sans-serif';
      context2d.lineWidth = 4;
      [['X', [axisAnchor[0] + axisLength, axisAnchor[1], axisAnchor[2]], '#be433c'],
        ['Y', [axisAnchor[0], axisAnchor[1] + axisLength, axisAnchor[2]], '#328b51'],
        ['Z', [axisAnchor[0], axisAnchor[1], axisAnchor[2] + axisLength], '#3266b9']].forEach(([label, point, color]) => {
        const projected = project(point);
        if (!projected) return;
        context2d.strokeStyle = '#f7fcf8'; context2d.fillStyle = color;
        context2d.strokeText(label, projected[0] + 6, projected[1] - 4);
        context2d.fillText(label, projected[0] + 6, projected[1] - 4);
      });
      if (lineMode) {
        context2d.font = '12px sans-serif'; context2d.fillStyle = '#42635b';
        context2d.fillText('大型配置：逐桿線模型（所有桿件均保留）', 14, cssHeight - 15);
      }
      if (selectedIndex >= 0 && !model.members[selectedIndex].triangles) {
        const member = model.members[selectedIndex];
        for (const point of [member.start, member.end]) {
          const screen = project(local(point));
          if (!screen) continue;
          context2d.beginPath(); context2d.arc(screen[0], screen[1], 4, 0, TAU);
          context2d.fillStyle = '#ffd166'; context2d.fill();
          context2d.lineWidth = 1.5; context2d.strokeStyle = '#173e40'; context2d.stroke();
        }
      }
      if (model.labels?.length) {
        context2d.save();
        context2d.font = 'bold 14px sans-serif';
        context2d.textAlign = 'center';
        context2d.textBaseline = 'middle';
        context2d.lineWidth = 1;
        const placed = [];
        for (const {text, position} of model.labels) {
          const anchor = project(local(position));
          if (!anchor || Math.abs(anchor[2]) > 1 || anchor[0] < 0 || anchor[0] > cssWidth ||
              anchor[1] < 0 || anchor[1] > cssHeight) continue;
          const x = clamp(anchor[0], 12, cssWidth - 12);
          const y = [0, -24, 24, -48, 48].map(offset => clamp(anchor[1] - 17 + offset, 12, cssHeight - 12))
            .find(value => placed.every(([px, py]) => Math.hypot(x - px, value - py) >= 22));
          if (y === undefined) continue;
          placed.push([x, y]);
          context2d.strokeStyle = '#17665d';
          context2d.beginPath();
          context2d.moveTo(anchor[0], anchor[1]);
          context2d.lineTo(x, y);
          context2d.stroke();
          context2d.beginPath();
          context2d.arc(x, y, 10, 0, TAU);
          context2d.fillStyle = '#17665d';
          context2d.fill();
          context2d.fillStyle = '#fff';
          context2d.fillText(text, x, y - 0.5);
        }
        context2d.restore();
      }
    }

    function render() {
      frame = 0;
      if (destroyed || lost) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.967, 0.984, 0.972, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!model) { if (context2d) context2d.clearRect(0, 0, overlay.width, overlay.height); return; }
      const eye = [target[0] + Math.cos(yaw) * Math.cos(pitch) * distance,
        target[1] + Math.sin(yaw) * Math.cos(pitch) * distance, target[2] + Math.sin(pitch) * distance];
      matrix = multiply(perspective(0.72, cssWidth / cssHeight, Math.max(radius / 1000, 0.0001), distance + radius * 12 + 1), lookAt(eye, target));
      gl.useProgram(program); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.uniformMatrix4fv(locations.matrix, false, matrix);
      gl.uniform1f(locations.colorMode, colorMode === 'member' ? 1 : 0);
      gl.uniform1f(locations.selected, selectedIndex < 0 ? -1 : selectedIndex + 1);
      gl.uniform1f(locations.picking, 0);
      bind(gridBuffer); gl.drawArrays(gl.LINES, 0, gridCount);
      bind(meshBuffer); gl.drawArrays(lineMode ? gl.LINES : gl.TRIANGLES, 0, meshCount);
      drawLabels();
    }

    function fitDistance() {
      distance = (model?.fitRadius ?? radius) / Math.sin(0.36) * 1.17 / Math.min(1, cssWidth / cssHeight);
    }
    function fit() { autoFit = true; target = [0, 0, 0]; fitDistance(); schedule(); }
    function resize() {
      const bounds = container.getBoundingClientRect();
      cssWidth = Math.max(1, bounds.width || 640); cssHeight = Math.max(1, bounds.height || 440);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = overlay.width = Math.max(1, Math.round(cssWidth * dpr));
      canvas.height = overlay.height = Math.max(1, Math.round(cssHeight * dpr));
      if (autoFit) fitDistance();
      schedule();
    }
    const resizeObserver = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(resize) : null;
    if (resizeObserver) resizeObserver.observe(container);
    else listen(window, 'resize', resize);

    function zoom(factor) {
      if (!Number.isFinite(factor) || factor <= 0) return;
      autoFit = false; distance = clamp(distance / factor, radius * 0.13, radius * 100); schedule();
    }
    function pan(dx, dy) {
      autoFit = false;
      const scale = distance * 0.75 / cssHeight;
      const right = [-Math.sin(yaw), Math.cos(yaw), 0];
      const up = [-Math.cos(yaw) * Math.sin(pitch), -Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch)];
      target = target.map((value, axis) => value - right[axis] * dx * scale + up[axis] * dy * scale);
    }
    function rotate(dx, dy) { yaw -= dx * 0.008; pitch = clamp(pitch + dy * 0.008, -1.5, 1.56); }
    function clearSelection() {
      selectedIndex = -1;
      onSelect(null);
      schedule();
    }

    function createPickTarget(size) {
      const framebuffer = gl.createFramebuffer();
      const texture = gl.createTexture();
      const depth = gl.createRenderbuffer();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (complete) return {framebuffer, texture, depth};
      gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture); gl.deleteRenderbuffer(depth);
      return null;
    }

    function pickSurface(x, y) {
      const width = 9;
      const center = (width - 1) / 2;
      if (pickTarget === undefined) pickTarget = createPickTarget(width);
      if (!pickTarget) return null;
      const pixelX = Math.floor(x * canvas.width / cssWidth);
      const pixelY = canvas.height - 1 - Math.floor(y * canvas.height / cssHeight);
      const pixels = new Uint8Array(width * width * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickTarget.framebuffer);
      // Keep the displayed projection and rasterize only the pixels near the pointer.
      gl.viewport(center - pixelX, center - pixelY, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DITHER);
      gl.uniform1f(locations.picking, 1);
      bind(meshBuffer);
      gl.drawArrays(lineMode ? gl.LINES : gl.TRIANGLES, 0, meshCount);
      gl.readPixels(0, 0, width, width, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.uniform1f(locations.picking, 0);
      gl.enable(gl.DITHER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      let bestDistance = Infinity;
      let index = -1;
      for (let row = 0; row < width; row++) {
        for (let col = 0; col < width; col++) {
          const offset = (row * width + col) * 4;
          const id = pixels[offset] + 256 * pixels[offset + 1] + 65536 * pixels[offset + 2];
          const distance = (row - center) ** 2 + (col - center) ** 2;
          if (id > 0 && id <= model.members.length && distance < bestDistance) {
            index = id - 1;
            bestDistance = distance;
          }
        }
      }
      return index;
    }

    function choose(clientX, clientY) {
      if (!model || lost) return;
      render();
      const box = canvas.getBoundingClientRect();
      const x = clientX - box.left, y = clientY - box.top;
      if (surfaceSelection) {
        const index = pickSurface(x, y);
        if (index !== null) {
          selectedIndex = index;
          onSelect(model.members[index] ?? null);
          schedule();
          return;
        }
      }
      let nearest = null;
      for (const {member, index} of members) {
        if (visible && !visible.has(member.code)) continue;
        const a = project(local(member.start)); const b = project(local(member.end));
        if (!a || !b || (a[2] > 1 && b[2] > 1)) continue;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
        const gap = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
        const depth = a[2] + t * (b[2] - a[2]);
        if (gap <= 8 && (!nearest || gap < nearest.gap - 2 || (Math.abs(gap - nearest.gap) <= 2 && depth < nearest.depth))) nearest = {index, gap, depth};
      }
      selectedIndex = nearest ? nearest.index : -1;
      onSelect(selectedIndex < 0 ? null : model.members[selectedIndex]);
      schedule();
    }

    listen(canvas, 'contextmenu', event => event.preventDefault());
    listen(canvas, 'wheel', event => { event.preventDefault(); zoom(Math.exp(-clamp(event.deltaY, -200, 200) * 0.0015)); }, {passive: false});
    listen(canvas, 'pointerdown', event => {
      canvas.focus({preventScroll: true}); canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
      gesture = {x: event.clientX, y: event.clientY, moved: pointers.size > 1, pan: event.button === 2 || event.shiftKey};
      event.preventDefault();
    });
    listen(canvas, 'pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      const previous = pointers.get(event.pointerId);
      const next = {x: event.clientX, y: event.clientY};
      if (pointers.size >= 2) {
        const other = Array.from(pointers.entries()).find(([id]) => id !== event.pointerId)[1];
        const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
        const newDistance = Math.hypot(next.x - other.x, next.y - other.y);
        if (oldDistance > 1 && newDistance > 1) zoom(newDistance / oldDistance);
        pan((next.x - previous.x) / 2, (next.y - previous.y) / 2);
        gesture.moved = true;
      } else {
        const dx = next.x - previous.x, dy = next.y - previous.y;
        if (Math.hypot(next.x - gesture.x, next.y - gesture.y) > 4) gesture.moved = true;
        if (gesture.pan || event.shiftKey) pan(dx, dy); else rotate(dx, dy);
      }
      pointers.set(event.pointerId, next); schedule(); event.preventDefault();
    });
    function finishPointer(event, cancelled) {
      const wasTracked = pointers.has(event.pointerId);
      pointers.delete(event.pointerId);
      if (wasTracked && !cancelled && gesture && !gesture.moved && pointers.size === 0) choose(event.clientX, event.clientY);
      if (!pointers.size) gesture = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }
    listen(canvas, 'pointerup', event => finishPointer(event, false));
    listen(canvas, 'pointercancel', event => finishPointer(event, true));
    listen(canvas, 'keydown', event => {
      const actions = {ArrowLeft: () => rotate(-10, 0), ArrowRight: () => rotate(10, 0),
        ArrowUp: () => rotate(0, -10), ArrowDown: () => rotate(0, 10),
        '+': () => zoom(1.2), '=': () => zoom(1.2), '-': () => zoom(1 / 1.2), Home: fit,
        Escape: clearSelection};
      if (actions[event.key]) { event.preventDefault(); actions[event.key](); schedule(); }
    });
    listen(canvas, 'webglcontextlost', event => {
      event.preventDefault(); lost = true;
      onError(new Error('3D 繪圖連線中斷，請重新產生圖面。'));
    });

    resize();
    return {
      available: true,
      setModel(value) {
        if (destroyed) throw new Error('3D 檢視器已關閉。');
        if (!value || !Array.isArray(value.members) || !value.bounds ||
            ![value.bounds.min, value.bounds.max].every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))) {
          throw new Error('3D 模型或邊界格式不正確。');
        }
        if (value.members.length > 500000) throw new Error('桿件超過 500,000 支，請縮小配置範圍後產生 3D 圖面。');
        const clean = value.members.map((member, index) => {
          if (![member.start, member.end].every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)) ||
              Math.hypot(...subtract(member.end, member.start)) <= 1e-9) throw new Error('桿件 ' + (member.id ?? index + 1) + ' 的端點座標不正確。');
          return {member, index};
        });
        model = value; members = clean;
        origin = value.bounds.min.map((minimum, axis) => (minimum + value.bounds.max[axis]) / 2);
        size = value.bounds.min.map((minimum, axis) => Math.max(0, value.bounds.max[axis] - minimum));
        radius = Math.max(Math.hypot(...size) / 2, 0.5);
        selectedIndex = -1; target = [0, 0, 0]; autoFit = true;
        buildGrid(); rebuild(); fitDistance(); schedule();
      },
      setColorMode(value) { colorMode = value === 'member' ? 'member' : 'type'; schedule(); },
      setVisibleTypes(codes) {
        visible = codes == null ? null : new Set(codes);
        if (model && selectedIndex >= 0 && visible && !visible.has(model.members[selectedIndex].code)) { selectedIndex = -1; onSelect(null); }
        if (model) rebuild();
      },
      setView(view) {
        const views = {iso: [-Math.PI / 4, 0.54], top: [-Math.PI / 2, Math.PI / 2 - 0.001], front: [-Math.PI / 2, 0], side: [0, 0]};
        [yaw, pitch] = views[view] || views.iso; fit();
      },
      zoom, fit, clearSelection,
      snapshot() {
        if (destroyed || lost) throw new Error('3D 圖面尚無法匯出。');
        render();
        const output = document.createElement('canvas'); output.width = canvas.width; output.height = canvas.height;
        const context = output.getContext('2d'); context.drawImage(canvas, 0, 0); context.drawImage(overlay, 0, 0);
        return output.toDataURL('image/png');
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (frame) window.cancelAnimationFrame(frame);
        resizeObserver?.disconnect(); listeners.forEach(remove => remove());
        gl.deleteBuffer(meshBuffer); gl.deleteBuffer(gridBuffer); gl.deleteProgram(program);
        if (pickTarget) {
          gl.deleteFramebuffer(pickTarget.framebuffer);
          gl.deleteTexture(pickTarget.texture);
          gl.deleteRenderbuffer(pickTarget.depth);
        }
        canvas.remove(); overlay.remove(); container.style.position = originalPosition;
        model = null; members = [];
      }
    };
  }

  root.ScaffoldViewer3D = Object.freeze({create});
})(typeof window === 'undefined' ? globalThis : window);
