// 面筋舌头：左键按住伸出去，舌尖跟着鼠标，长度不限，像一根有弹性的面筋；
// 舔到的东西被嗦回嘴里。黄色物体舔不得——碰到会被圣光弹开。
import * as THREE from 'three';

const N = 44;          // 绳子上的点
const M = 150;         // 渲染时沿舌头的采样
const RAD = 12;        // 截面分段
const MAXD = 4800;     // 够得到天穹
const SKY_W = 1024, SKY_H = 512;

export function createLick(ctx) {
  const { scene, camera, U, YPOS } = ctx;

  /* ── 绳子 ─────────────────────────────────────────────── */
  const P = Array.from({ length: N }, () => new THREE.Vector3());
  // 各段的长度按等比递增：嘴边几段很短（近处看得清、稳），远处一段段拉长
  const GROW = 1.14, W = [], CUM = [0];
  { let sum = 0; for (let i = 0; i < N - 1; i++) { W.push(GROW ** i); sum += GROW ** i; } for (let i = 0; i < N - 1; i++) { W[i] /= sum; CUM.push(CUM[i] + W[i]); } }
  const Q = Array.from({ length: N }, () => new THREE.Vector3());
  let active = false, holding = false, tipDist = 0, hitKind = 'sky';
  const aim = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  const mouth = new THREE.Vector3(), tipT = new THREE.Vector3();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

  /* ── 舌头的网格：每帧原地改写顶点 ──────────────────────── */
  const vCount = M * (RAD + 1);
  const pos = new Float32Array(vCount * 3), nrm = new Float32Array(vCount * 3), uvs = new Float32Array(vCount * 2);
  const idx = [];
  for (let i = 0; i < M - 1; i++) {
    for (let j = 0; j < RAD; j++) {
      const a = i * (RAD + 1) + j, b = a + RAD + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  const papillae = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 22; i++) {
      g.fillStyle = `rgba(150, 40, 70, ${0.18 + Math.random() * 0.25})`;
      g.beginPath(); g.arc(Math.random() * 64, Math.random() * 64, 1 + Math.random() * 1.6, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const tongueMat = new THREE.ShaderMaterial({
    uniforms: {
      base: { value: new THREE.Color('#ec7d92') }, shade: { value: new THREE.Color('#c4566d') },
      groove: { value: new THREE.Color('#a8445a') }, tex: { value: papillae }, zap: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vN, vV; varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 base, shade, groove; uniform sampler2D tex; uniform float zap;
      varying vec3 vN, vV; varying vec2 vUv;
      void main() {
        vec3 n = normalize(vN), L = normalize(vec3(-0.35, 0.85, 0.45));
        vec3 c = mix(shade, base, smoothstep(-0.25, 0.25, dot(n, L)));
        c *= texture2D(tex, vec2(vUv.x, vUv.y * 3.0)).rgb;
        c = mix(c, groove, smoothstep(0.035, 0.0, abs(vUv.y - 0.25)) * 0.7);   // 舌面中缝
        float spec = pow(max(dot(reflect(-normalize(vV), n), L), 0.0), 24.0);
        c += vec3(1.0, 0.92, 0.95) * spec * 0.55;                              // 湿亮
        c = mix(c, vec3(1.0, 0.95, 0.7), zap);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  // 描边：沿法线往外推，推出的宽度随距离变，屏幕上大致恒宽
  const outlineMat = new THREE.ShaderMaterial({
    uniforms: { ink: { value: new THREE.Color('#4a1624') } },
    vertexShader: /* glsl */`
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * (0.0028 * -mv.z + 0.004);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 ink;
      void main() {
        gl_FragColor = vec4(ink, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
  });
  const tongue = new THREE.Mesh(geo, tongueMat);
  const outline = new THREE.Mesh(geo, outlineMat);
  for (const m of [tongue, outline]) { m.frustumCulled = false; m.visible = false; scene.add(m); ctx.reflectHide.push(m); } // 镜子里不照舌头，免得像多出一根

  // Catmull-Rom 沿绳子取点
  const S = Array.from({ length: M }, () => new THREE.Vector3());
  function sampleRope() {
    for (let k = 0; k < M; k++) {
      const s = (k / (M - 1)) * (N - 1);
      const i = Math.min(N - 2, Math.floor(s)), t = s - i;
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(N - 1, i + 2)];
      const t2 = t * t, t3 = t2 * t;
      for (const ax of ['x', 'y', 'z']) {
        S[k][ax] = 0.5 * ((2 * p1[ax]) + (-p0[ax] + p2[ax]) * t + (2 * p0[ax] - 5 * p1[ax] + 4 * p2[ax] - p3[ax]) * t2
          + (-p0[ax] + 3 * p1[ax] - 3 * p2[ax] + p3[ax]) * t3);
      }
    }
  }
  const T = new THREE.Vector3(), B = new THREE.Vector3(), Nn = new THREE.Vector3(), prevB = new THREE.Vector3(1, 0, 0);
  function buildMesh(len) {
    sampleRope();
    const thin = Math.max(0.35, Math.min(1, Math.sqrt(8 / Math.max(8, len)))); // 拉得越长越细，像面筋
    let arc = 0;
    for (let k = 0; k < M; k++) {
      const a = S[Math.max(0, k - 1)], b = S[Math.min(M - 1, k + 1)];
      T.subVectors(b, a);
      if (T.lengthSq() < 1e-10) T.set(0, 0, -1);
      T.normalize();
      B.crossVectors(T, ctx.UP);
      if (B.lengthSq() < 1e-6) B.copy(prevB); else B.normalize();
      if (B.dot(prevB) < 0) B.negate();
      prevB.copy(B);
      Nn.crossVectors(B, T).normalize();
      if (k) arc += S[k].distanceTo(S[k - 1]);
      const u = k / (M - 1);
      let r = 0.085 * (1 - 0.45 * u) * thin;
      r = Math.max(r, S[k].distanceTo(camera.position) * 0.0026 * (1 - 0.4 * u));
      if (u > 0.95) r *= Math.sqrt(Math.max(0, 1 - ((u - 0.95) / 0.05) ** 2));
      const rw = r * 1.4, rh = r * 0.72;
      for (let j = 0; j <= RAD; j++) {
        const th = (j / RAD) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
        const o = (k * (RAD + 1) + j);
        pos[o * 3] = S[k].x + B.x * cs * rw + Nn.x * sn * rh;
        pos[o * 3 + 1] = S[k].y + B.y * cs * rw + Nn.y * sn * rh;
        pos[o * 3 + 2] = S[k].z + B.z * cs * rw + Nn.z * sn * rh;
        _a.set(0, 0, 0).addScaledVector(B, cs / rw).addScaledVector(Nn, sn / rh).normalize();
        nrm[o * 3] = _a.x; nrm[o * 3 + 1] = _a.y; nrm[o * 3 + 2] = _a.z;
        uvs[o * 2] = arc / 0.35; uvs[o * 2 + 1] = j / RAD;
      }
    }
    geo.attributes.position.needsUpdate = geo.attributes.normal.needsUpdate = geo.attributes.uv.needsUpdate = true;
  }

  /* ── 舌尖会落在什么上 ──────────────────────────────────── */
  const shieldC = new THREE.Vector3(YPOS.x, 3.2, YPOS.z + 0.3), SHIELD = 3.6;
  const sphereHit = (o, d, c, r) => {
    _c.subVectors(o, c);
    const b = _c.dot(d), q = _c.lengthSq() - r * r, h = b * b - q;
    if (h < 0) return Infinity;
    const t = -b - Math.sqrt(h);
    return t > 0 ? t : Infinity;
  };
  function surfaceHit() {
    const o = ray.ray.origin, d = ray.ray.direction;
    let best = MAXD; hitKind = 'sky';
    if (d.y < -1e-4) { const t = -o.y / d.y; if (t < best) { best = t; hitKind = 'ground'; } }
    for (const h of ray.intersectObjects(ctx.solid, false)) { if (h.distance < best) { best = h.distance; hitKind = 'solid'; } break; }
    shieldC.y = 3.2 + ctx.body.position.y;
    const ts = sphereHit(o, d, shieldC, SHIELD);
    if (ts < best) { best = ts; hitKind = 'idol'; }
    for (const g of ctx.glyphs) {
      if (g.state) continue;
      const t = sphereHit(o, d, g.pivot.position, 4);
      if (t < best) { best = t; hitKind = 'glyph'; }
    }
    for (const c of ctx.idol.clones) {
      if (c.state) continue;
      const t = sphereHit(o, d, c.group.position, 1.4);
      if (t < best) { best = t; hitKind = 'clone'; }
    }
    return best;
  }

  /* ── 能舔掉的东西 ──────────────────────────────────────── */
  // 灰板：每块一张遮罩当 alphaMap，舔过的地方擦成透明
  const slabs = ctx.slabs.map((m) => {
    const ud = m.userData;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.repeat.set(1 / ud.box.w, 1 / ud.box.h);
    tex.offset.set(-ud.box.minX / ud.box.w, -ud.box.minY / ud.box.h);
    const mat = m.material[0].clone();
    mat.alphaMap = tex;
    m.material = [mat, m.material[1]];
    // 32×32 网格里哪些格子在板子形状内，用来算舔掉的比例
    const cells = new Uint8Array(32 * 32), inside = new Uint8Array(32 * 32);
    let nIn = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const px = ud.box.minX + (x + 0.5) / 32 * ud.box.w, py = ud.box.minY + (y + 0.5) / 32 * ud.box.h;
      let inPoly = false;
      for (let i = 0, j = ud.poly.length - 1; i < ud.poly.length; j = i++) {
        const a = ud.poly[i], b = ud.poly[j];
        if ((a.y > py) !== (b.y > py) && px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x) inPoly = !inPoly;
      }
      if (inPoly) { inside[y * 32 + x] = 1; nIn++; }
    }
    return { m, ud, g, tex, cells, inside, nIn, licked: 0, regrow: 0, dirty: false };
  });
  function paintSlab(s, p, rc) {
    _a.copy(p);
    s.m.worldToLocal(_a);
    if (Math.abs(_a.z) > s.ud.thick / 2 + rc) return false;
    const sx = _a.x + s.ud.center.x, sy = _a.y + s.ud.center.y, bx = s.ud.box;
    const u = (sx - bx.minX) / bx.w, v = (sy - bx.minY) / bx.h;
    if (u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1) return false;
    const rx = rc / bx.w * 256, ry = rc / bx.h * 256;
    const grd = s.g.createRadialGradient(u * 256, (1 - v) * 256, 0, u * 256, (1 - v) * 256, Math.max(rx, ry));
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.7, 'rgba(0,0,0,.85)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    s.g.fillStyle = grd;
    s.g.beginPath(); s.g.ellipse(u * 256, (1 - v) * 256, rx, ry, 0, 0, 7); s.g.fill();
    s.dirty = true;
    let gained = false;
    const cr = Math.ceil(Math.max(rx, ry) / 8);
    const cx = Math.floor(u * 32), cy = Math.floor(v * 32);
    for (let y = cy - cr; y <= cy + cr; y++) for (let x = cx - cr; x <= cx + cr; x++) {
      if (x < 0 || y < 0 || x > 31 || y > 31) continue;
      const k = y * 32 + x;
      if (!s.inside[k] || s.cells[k]) continue;
      const du = ((x + 0.5) / 32 - u) * bx.w, dv = ((y + 0.5) / 32 - v) * bx.h;
      if (du * du + dv * dv < rc * rc) { s.cells[k] = 1; s.licked++; gained = true; }
    }
    return gained;
  }

  // 天空：等距柱状投影的一张遮罩，舔过的地方露出更深的夜和更多星星
  const skyC = document.createElement('canvas');
  skyC.width = SKY_W; skyC.height = SKY_H;
  const skyG = skyC.getContext('2d');
  skyG.fillStyle = '#000'; skyG.fillRect(0, 0, SKY_W, SKY_H);
  const skyTex = new THREE.CanvasTexture(skyC);
  skyTex.wrapS = THREE.RepeatWrapping;
  U.skyLick.value = skyTex;
  const skyCells = new Uint8Array(64 * 32);
  let skyLicked = 0, skyDirty = false, skyFade = 0;
  const SKY_TOTAL = 64 * 14; // 地平线以上的格子
  function paintSky(dir) {
    const u = Math.atan2(dir.z, dir.x) / (Math.PI * 2) + 0.5;
    const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    if (lat < 0.03) return false;
    const v = lat / Math.PI + 0.5;
    const ry = 0.085 / Math.PI * SKY_H, rx = Math.min(SKY_W / 4, 0.085 / (Math.PI * 2) * SKY_W / Math.max(0.15, Math.cos(lat)));
    for (const ox of [-SKY_W, 0, SKY_W]) {
      const grd = skyG.createRadialGradient(u * SKY_W + ox, (1 - v) * SKY_H, 0, u * SKY_W + ox, (1 - v) * SKY_H, ry);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.6, 'rgba(255,255,255,.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      skyG.save();
      skyG.translate(u * SKY_W + ox, (1 - v) * SKY_H); skyG.scale(rx / ry, 1); skyG.translate(-(u * SKY_W + ox), -(1 - v) * SKY_H);
      skyG.fillStyle = grd;
      skyG.beginPath(); skyG.arc(u * SKY_W + ox, (1 - v) * SKY_H, ry, 0, 7); skyG.fill();
      skyG.restore();
    }
    skyDirty = true;
    const x = Math.floor(u * 64) % 64, y = Math.floor(v * 32);
    let gained = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy;
      if (yy < 17 || yy > 31) continue;
      const k = yy * 64 + ((x + dx + 64) % 64);
      if (!skyCells[k]) { skyCells[k] = 1; skyLicked++; gained = true; }
    }
    return gained;
  }

  // 一件件的东西：日期的字、两段画出来的白线、@、喷白、地平线的淡白、分身
  const misc = ctx.misc.map((it) => ({ ...it, state: null, t: 0 }));
  const dashes = ctx.dashInfo;
  const DASH_QUOTA = 24;
  let dashLicked = 0;

  /* ── 嗦回嘴里：沿着舌头往回走 ──────────────────────────── */
  function ropeAt(s, out) { // s: 0 嘴 → 1 舌尖
    const f = Math.max(0, Math.min(1, s || 0)) * (N - 1), i = Math.min(N - 2, Math.floor(f)), t = f - i;
    return out.lerpVectors(P[i], P[i + 1], t);
  }
  const slurps = []; // { obj, base:{pos,scale}, t, dur, onDone }
  function slurp(obj, onDone, dur = 0.9) {
    slurps.push({ obj, from: obj.position.clone(), s0: obj.scale.clone(), t: 0, dur, onDone });
  }

  /* ── 小特效：火花、口水、拟声字 ─────────────────────────── */
  const SPARKS = 160;
  const spPos = new Float32Array(SPARKS * 3), spCol = new Float32Array(SPARKS * 3), spV = [], spLife = new Float32Array(SPARKS);
  for (let i = 0; i < SPARKS; i++) spV.push(new THREE.Vector3());
  const spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3).setUsage(THREE.DynamicDrawUsage));
  spGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 3).setUsage(THREE.DynamicDrawUsage));
  const sparks = new THREE.Points(spGeo, new THREE.ShaderMaterial({
    uniforms: { px: U.px },
    vertexShader: /* glsl */`
      uniform float px; attribute vec3 color; varying vec3 vC;
      void main() {
        vC = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(2.0, 0.006 * px * projectionMatrix[1][1] * length(mv.xyz) / -mv.z * 3.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main() { float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5)); gl_FragColor = vec4(vC * a, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let spI = 0;
  function burst(p, n, color, speed) {
    for (let k = 0; k < n; k++) {
      const i = spI++ % SPARKS;
      spPos[i * 3] = p.x; spPos[i * 3 + 1] = p.y; spPos[i * 3 + 2] = p.z;
      spV[i].set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      spLife[i] = 0.5 + Math.random() * 0.5;
      spCol[i * 3] = color[0]; spCol[i * 3 + 1] = color[1]; spCol[i * 3 + 2] = color[2];
    }
  }
  const WORDS = { lick: ['嗦', '吸溜', '啧', '嗦——'], zap: ['滋！', '啪！', '烫！'] };
  const pops = Array.from({ length: 6 }, () => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sp.renderOrder = 10;
    sp.visible = false;
    scene.add(sp);
    return { sp, c, tex, t: 1 };
  });
  let popI = 0, popCool = 0;
  function pop(p, kind) {
    if (popCool > 0) return;
    popCool = kind === 'zap' ? 0.25 : 0.45;
    const o = pops[popI++ % pops.length], g = o.c.getContext('2d');
    const w = WORDS[kind][Math.floor(Math.random() * WORDS[kind].length)];
    g.clearRect(0, 0, 256, 128);
    g.font = '600 72px "PingFang SC", "Hiragino Sans GB", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = '#141418';
    g.save(); g.translate(128, 64); g.rotate((Math.random() - 0.5) * 0.4);
    g.strokeText(w, 0, 0);
    g.fillStyle = kind === 'zap' ? '#fff3a0' : '#f4f4f6';
    g.fillText(w, 0, 0);
    g.restore();
    o.tex.needsUpdate = true;
    o.sp.position.copy(p);
    o.base = p.clone();
    o.t = 0;
    o.sp.visible = true;
  }

  /* ── 输入 ─────────────────────────────────────────────── */
  function aimAt(x, y, finger) {
    const r = ctx.canvas.getBoundingClientRect();
    if (finger) y -= 52; // 手指会盖住舌尖：触屏瞄准点比指尖高一点
    aim.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }
  function press() {
    holding = true;
    if (!active) {
      camera.updateMatrixWorld();
      mouth.set(0, -0.36, -0.55).applyMatrix4(camera.matrixWorld);
      for (let i = 0; i < N; i++) { P[i].copy(mouth); Q[i].copy(mouth); }
      tipDist = 0;
      active = true;
    }
  }
  function release() { holding = false; }
  function forceRetract() { holding = false; tipDist = Math.min(tipDist, 30); }

  /* ── 进度 ─────────────────────────────────────────────── */
  let percent = 0, clonesEaten = 0;
  function compute() {
    const glyphP = ctx.glyphs.filter((g) => g.state).length / ctx.glyphs.length;
    const slabIn = slabs.reduce((a, s) => a + s.nIn, 0), slabL = slabs.reduce((a, s) => a + s.licked, 0);
    const miscW = misc.reduce((a, m) => a + (m.state ? m.weight : 0), 0);
    percent = Math.min(100, 30 * glyphP + 20 * Math.min(1, dashLicked / DASH_QUOTA)
      + 25 * Math.min(1, slabL / (slabIn * 0.35)) + 15 * Math.min(1, skyLicked / (SKY_TOTAL * 0.12))
      + miscW + clonesEaten * 0.6);
  }

  /* ── 每帧 ─────────────────────────────────────────────── */
  let zapT = 0, lickCool = 0;
  const tip = new THREE.Vector3(), lastTip = new THREE.Vector3();
  function update(dt, t, enabled) {
    if (!enabled) holding = false;
    popCool -= dt; lickCool -= dt;
    zapT = Math.max(0, zapT - dt * 3);
    tongueMat.uniforms.zap.value = zapT;

    if (active) {
      camera.updateMatrixWorld();
      mouth.set(0, -0.36, -0.55).applyMatrix4(camera.matrixWorld);
      ray.setFromCamera(aim, camera);
      const dHit = surfaceHit();
      if (holding) tipDist = Math.min(tipDist + (22 + tipDist * 2.4) * dt, dHit);
      else tipDist = Math.max(0, tipDist - (30 + tipDist * 5) * dt);
      _b.copy(ray.ray.origin).addScaledVector(ray.ray.direction, Math.max(tipDist, 1));
      tipT.lerpVectors(mouth, _b, Math.min(1, tipDist));
      const L = mouth.distanceTo(tipT);
      const total = L * (1.0008 + 0.12 * Math.exp(-L / 15)) + 0.05; // 短的时候软塌塌，长了就绷直
      _c.subVectors(tipT, mouth).normalize(); // 舌根朝着舌尖的方向
      // 面筋：有点下垂、自己轻轻扭；越长绷得越紧
      const g = 5 * Math.min(1, 20 / Math.max(1, L)) * dt * dt, wig = 2.5 * dt * dt;
      for (let i = 1; i < N - 1; i++) {
        const p = P[i], q = Q[i];
        _a.subVectors(p, q).multiplyScalar(0.94);
        q.copy(p);
        p.add(_a);
        p.y -= g;
        const w = Math.sin(t * 6 + i * 0.7) * wig * Math.min(1, CUM[i] * L);
        p.x += w * Math.cos(i * 1.3); p.z += w * Math.sin(i * 1.3);
      }
      for (let it = 0; it < 16; it++) {
        P[0].copy(mouth); P[N - 1].copy(tipT);
        for (let i = 1; i < 9; i++) { // 舌根有肌肉：往直线上拉
          _b.copy(mouth).addScaledVector(_c, CUM[i] * total);
          P[i].lerp(_b, 0.3 * (1 - i / 9));
        }
        for (let i = 0; i < N - 1; i++) {
          const a = P[i], b = P[i + 1], seg = total * W[i];
          _a.subVectors(b, a);
          const d = _a.length();
          if (d <= seg || d < 1e-9) continue;
          const k = (d - seg) / d;
          if (i === 0) b.addScaledVector(_a, -k);
          else if (i + 1 === N - 1) a.addScaledVector(_a, k);
          else { a.addScaledVector(_a, k * 0.5); b.addScaledVector(_a, -k * 0.5); }
        }
        for (let i = 1; i < N - 1; i++) {
          const fl = ctx.floorAt(P[i].x, P[i].z, P[i].y);
          if (P[i].y < fl + 0.04) P[i].y = fl + 0.04;
        }
      }
      P[0].copy(mouth); P[N - 1].copy(tipT);
      Q[0].copy(mouth); Q[N - 1].copy(tipT);
      if (!holding && tipDist <= 0) active = false;
      buildMesh(L);
    }
    tongue.visible = outline.visible = active;
    if (!active || tipDist <= 0.8) lastTip.set(0, 0, 0);

    // 舔
    if (active && tipDist > 0.8) {
      tip.copy(P[N - 1]);
      const rc = Math.max(0.6, tipDist * 0.018);
      // 碰到圣物：被弹开
      _a.subVectors(tip, shieldC);
      if (_a.length() < SHIELD + 0.4) {
        zapT = 1;
        tipDist = Math.max(0, tipDist - 5);
        burst(tip, 18, [1.0, 0.85, 0.4], 6 + tipDist * 0.05);
        pop(tip, 'zap');
        ctx.idol.kick(1.2);
      }
      let licked = false;
      // 两帧之间也涂上，舔出来是连续的一道，不是一串点
      const steps = lastTip.lengthSq() ? Math.min(14, Math.ceil(lastTip.distanceTo(tip) / (rc * 0.5))) : 1;
      for (let k = 1; k <= steps; k++) {
        _b.lerpVectors(lastTip.lengthSq() ? lastTip : tip, tip, k / steps);
        for (const s of slabs) if (paintSlab(s, _b, rc)) licked = true;
        if (hitKind === 'sky' && tipDist > 2500 && paintSky(_c.subVectors(_b, camera.position).normalize())) licked = true;
      }
      lastTip.copy(tip);
      for (const gl of ctx.glyphs) {
        if (gl.state || gl.pivot.position.distanceTo(tip) > rc + 4.5) continue;
        gl.state = 'slurp';
        slurp(gl.pivot, () => { gl.state = 'gone'; gl.pivot.visible = false; });
        licked = true;
      }
      for (let i = 0; i < dashes.length; i++) {
        const d = dashes[i];
        if (d.licked || !d.cur || d.cur.distanceTo(tip) > rc + 2.6) continue;
        d.licked = { t: 0, from: d.cur.clone() };
        dashLicked++;
        licked = true;
      }
      for (const m of misc) {
        if (m.state || m.center.distanceTo(tip) > rc + m.radius) continue;
        m.state = 'gone';
        for (const o of m.objs) o.visible = false;
        if (m.onLick) m.onLick();
        burst(m.center, 14, [0.9, 0.9, 0.95], 3 + tipDist * 0.03);
        licked = true;
      }
      for (const c of ctx.idol.clones) {
        if (c.state || c.group.position.distanceTo(tip) > rc + 1.2) continue;
        c.state = 'slurp';
        slurp(c.group, () => { c.state = 'gone'; c.group.visible = false; clonesEaten++; });
        licked = true;
      }
      if (licked) {
        if (lickCool <= 0) { burst(tip, 8, [1.0, 0.75, 0.82], 2 + tipDist * 0.02); lickCool = 0.12; }
        pop(_a.copy(tip).add(_b.set(0, rc * 1.5 + 1, 0)), 'lick');
        ctx.idol.kick(0.35);
      }
    }

    // 被嗦的东西沿舌头回到嘴里，越来越小、被拉长
    for (let i = slurps.length - 1; i >= 0; i--) {
      const s = slurps[i];
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      if (active) {
        const stick = Math.min(1, k / 0.18);
        ropeAt(1 - Math.max(0, (k - 0.18) / 0.82), _a);
        s.obj.position.lerpVectors(s.from, _a, stick);
      }
      const sc = 1 - k * k;
      s.obj.scale.set(s.s0.x * sc * 0.7, s.s0.y * sc * (1 + k * 1.5), s.s0.z * sc * 0.7);
      if (k >= 1 || !active) { slurps.splice(i, 1); s.obj.scale.copy(s.s0); s.onDone(); }
    }
    // 舔掉的白线：先被扯向舌尖，再缩没
    for (let i = 0; i < dashes.length; i++) {
      const d = dashes[i];
      if (!d.licked) continue;
      const L = d.licked;
      if (L.restore) {
        L.restore = Math.max(0, L.restore - dt * 1.6);
        const k = 1 - L.restore;
        ctx.setDash(i, d.cur, k * (1 + Math.sin(k * Math.PI) * 0.4));
        if (L.restore <= 0) { d.licked = null; ctx.setDash(i, d.cur, 1); }
        continue;
      }
      L.t += dt;
      const k = Math.min(1, L.t / 0.45);
      if (active) _a.lerpVectors(L.from, P[N - 1], k * k); else _a.copy(L.from);
      ctx.setDash(i, _a, 1 - k);
    }
    // 灰板复原
    for (const s of slabs) {
      if (s.regrow > 0) {
        s.regrow -= dt;
        s.g.fillStyle = 'rgba(255,255,255,.09)';
        s.g.fillRect(0, 0, 256, 256);
        if (s.regrow <= 0) { s.g.fillStyle = '#fff'; s.g.fillRect(0, 0, 256, 256); }
        s.dirty = true;
      }
      if (s.dirty) { s.tex.needsUpdate = true; s.dirty = false; }
    }
    if (skyFade > 0) {
      skyFade -= dt;
      skyG.fillStyle = 'rgba(0,0,0,.08)';
      skyG.fillRect(0, 0, SKY_W, SKY_H);
      if (skyFade <= 0) { skyG.fillStyle = '#000'; skyG.fillRect(0, 0, SKY_W, SKY_H); }
      skyDirty = true;
    }
    if (skyDirty) { skyTex.needsUpdate = true; skyDirty = false; }
    // 火花
    for (let i = 0; i < SPARKS; i++) {
      if (spLife[i] <= 0) { spPos[i * 3 + 1] = -1e5; continue; }
      spLife[i] -= dt;
      spV[i].y -= 6 * dt;
      spPos[i * 3] += spV[i].x * dt; spPos[i * 3 + 1] += spV[i].y * dt; spPos[i * 3 + 2] += spV[i].z * dt;
      const f = Math.max(0, spLife[i]);
      spCol[i * 3] *= 0.985; spCol[i * 3 + 1] *= 0.975; spCol[i * 3 + 2] *= 0.97;
      if (f <= 0) spPos[i * 3 + 1] = -1e5;
    }
    spGeo.attributes.position.needsUpdate = spGeo.attributes.color.needsUpdate = true;
    // 拟声字
    for (const o of pops) {
      if (!o.sp.visible) continue;
      o.t += dt;
      const k = o.t / 0.9;
      const dist = o.base.distanceTo(camera.position);
      o.sp.position.copy(o.base).y += k * dist * 0.03;
      o.sp.scale.set(dist * 0.1, dist * 0.05, 1).multiplyScalar(0.8 + Math.min(1, k * 6) * 0.2);
      o.sp.material.opacity = 1 - Math.max(0, (k - 0.5) * 2);
      if (k >= 1) o.sp.visible = false;
    }
    compute();
  }

  // 一切复原：吐回来的东西重新长出来
  function restore() {
    for (const s of slurps) { s.obj.scale.copy(s.s0); s.onDone(); }
    slurps.length = 0;
    for (const gl of ctx.glyphs) {
      if (!gl.state) continue;
      gl.state = 'regrow';
      gl.pivot.visible = true;
      gl.regrow = 0;
    }
    for (const d of dashes) if (d.licked) d.licked.restore = 1;
    dashLicked = 0;
    for (const s of slabs) { s.regrow = 1.4; s.cells.fill(0); s.licked = 0; }
    skyCells.fill(0); skyLicked = 0; skyFade = 1.6;
    for (const m of misc) { if (m.state) { m.state = null; for (const o of m.objs) o.visible = true; } }
    clonesEaten = 0;
    compute();
  }

  return {
    aimAt, press, release, forceRetract, update, restore,
    get percent() { return percent; },
    get active() { return active; },
  };
}
