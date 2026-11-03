import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createLick } from './lick.js?v=1';
import { createIdol } from './idol.js?v=1';

const qs = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);

/* ── 原图坐标 ────────────────────────────────────────────────
   原图 1088×1080。开场镜头由画反推：消失点 VP、焦距 F（原图像素）、
   地平线向右上翘 ROLL、眼高 EYE（米）。画上任何一点 (u,v) 都能沿视线
   投回世界里——投到某个深度的竖直面上，或投到地面上——所以开场那一帧
   和原图对得上，走起来才露出纵深。 */
const IMG = { w: 1088, h: 1080 };
const VP = { x: 580, y: 562 };
const F = 1000;
const ROLL = Math.atan2(29, 870);
const EYE = 2;
const cR = Math.cos(ROLL), sR = Math.sin(ROLL);
const DS = 3.5; // 画纸立在眼前 3.5 米，穿过它上面的洞就进了画

const PAL = {
  sky: '#6a7bc1', ground: '#4c53a3', road: '#2b3283', roadShadow: '#20266a',
  dash: '#e6e6e6', block: '#c4c4c8', blockSide: '#acafc6', ink: '#141418',
  chalk: '#f4f4f6', yellow: '#faef61', yellowShade: '#e8d54a', yellowEdge: '#dcc434',
  zenith: '#1a205e', nadir: '#252a69', longShadow: '#161b52',
};

function level(u, v) {
  const sx = u - VP.x, sy = VP.y - v;
  return [(sx * cR + sy * sR) / F, (-sx * sR + sy * cR) / F];
}
function atDepth(u, v, D) {
  const [a, b] = level(u, v);
  return new THREE.Vector3(a * D, EYE + b * D, -D);
}
function onGround(u, v) {
  const [a, b] = level(u, v);
  const D = EYE / -b;
  return new THREE.Vector3(a * D, 0, -D);
}

function rng(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// 平滑抖动：几条随机正弦叠起来，幅度约 ±1
function wobble(r, base = 1) {
  const w = [0, 1, 2].map((i) => [base * (0.6 + r() * 0.9) * (i + 1), r() * 6.283, 1 / (i + 1)]);
  return (t) => w.reduce((s, [f, p, a]) => s + a * Math.sin(f * t + p), 0) / 1.83;
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (t) => t * t * (3 - 2 * t);

/* ── 渲染器 ─────────────────────────────────────────────── */
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const DPR = Math.min(devicePixelRatio || 1, 2);
renderer.setPixelRatio(DPR);
const scene = new THREE.Scene();
scene.background = new THREE.Color(PAL.sky);
const camera = new THREE.PerspectiveCamera(60, 1, 0.15, 14000);
camera.rotation.order = 'YXZ';

// 梦的进度：dream 0 是原画，1 是进去之后的样子；holy 先到，lift（路升天）最后
const U = {
  time: { value: 0 }, dream: { value: 0 }, lift: { value: 0 }, holy: { value: 0 }, px: { value: 500 },
  skyLick: { value: null }, dark: { value: 0 }, swirl: { value: 0 }, boost: { value: 1 },
  shockC: { value: new THREE.Vector2() }, shockR: { value: 0 }, shockS: { value: 0 },
};
const UP = new THREE.Vector3(0, 1, 0);
// 落地冲击之类的一次性效果
const fx = { shake: 0, flash: 0, slabShake: 0, boilFast: 0, impactT: -99, impactP: new THREE.Vector3(), jumpDirty: false };

// 线条抖动（hand-drawn line boil）：每样墨线做 3 份，每秒换 8 次
const BOIL = 3;
const boilSets = [];
let boilSeed = 1;
function boil(parent, make) {
  const arr = [];
  for (let i = 0; i < BOIL; i++) {
    const o = make(rng(boilSeed * 7919 + i * 104729), i);
    o.visible = i === 0;
    parent.add(o);
    arr.push(o);
  }
  boilSeed++;
  boilSets.push(arr);
  return arr;
}

// 屏幕宽度恒定的墨线（宽度以原图像素计，随画面缩放）
const inks = [];
function inkLine(pts, color, px, order = -7, depth = false) {
  const g = new LineGeometry();
  g.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
  const m = new LineMaterial({
    color, linewidth: 1, depthTest: depth, depthWrite: false,
    polygonOffset: depth, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  inks.push({ m, px });
  const l = new Line2(g, m);
  l.computeLineDistances();
  l.renderOrder = order;
  return l;
}

// 镜面倒影里不该出现的东西（贴地的线和贴花）
const reflectHide = [];

/* ── 天穹：原画里是平涂的蓝，梦里天顶暗下去、白天出星星 ───── */
const dome = new THREE.Mesh(
  new THREE.SphereGeometry(5000, 64, 32),
  new THREE.ShaderMaterial({
    uniforms: {
      sky: { value: new THREE.Color(PAL.sky) }, zenith: { value: new THREE.Color(PAL.zenith) },
      nadir: { value: new THREE.Color(PAL.nadir) }, dream: U.dream, time: U.time, skyLick: U.skyLick, dark: U.dark,
    },
    vertexShader: /* glsl */`
      varying vec3 vD;
      void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 sky, zenith, nadir; uniform float dream, time, dark; uniform sampler2D skyLick; varying vec3 vD;
      vec4 hash43(vec3 p) {
        vec4 p4 = fract(vec4(p.xyzx) * vec4(.1031, .1030, .0973, .1099));
        p4 += dot(p4, p4.wzxy + 33.33);
        return fract((p4.xxyz + p4.yzzw) * p4.zywx);
      }
      void main() {
        vec3 d = normalize(vD);
        float e = d.y;
        vec3 c = mix(sky, zenith, smoothstep(0.03, 1.0, e) * 0.85 * dream);
        c = mix(c, nadir, smoothstep(-0.02, -0.5, e) * dream);
        // 被舌头舔过的天：蓝色被舔掉，露出更深的夜，星星更密，边上一圈湿亮的粉
        float m = smoothstep(0.08, 0.85, texture2D(skyLick, vec2(atan(d.z, d.x) / 6.2831853 + 0.5, asin(clamp(e, -1.0, 1.0)) / 3.14159265 + 0.5)).r);
        c = mix(c, vec3(0.006, 0.007, 0.03), m);
        c += vec3(0.9, 0.35, 0.5) * m * (1.0 - m) * 0.5;
        c = mix(c, c * vec3(0.3, 0.32, 0.55), dark);
        vec3 p = d * 110.0, cell = floor(p);
        vec4 h = hash43(cell);
        float dist = length(p - (cell + 0.15 + 0.7 * h.xyz));
        float tw = 0.55 + 0.45 * sin(time * (0.8 + 2.5 * h.w) + h.x * 40.0);
        float star = smoothstep(0.22, 0.0, dist) * step(0.86 - 0.3 * max(m, dark), h.w) * tw;
        c += vec3(1.0, 0.97, 0.9) * star * max(max(dream, m), dark) * (1.0 + m) * smoothstep(0.02, 0.25, e);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false,
  }),
);
dome.renderOrder = -20;
dome.frustumCulled = false;
scene.add(dome);

/* ── 大地：梦里变成一面微微起皱的镜子；它和地平线都跟着人走 ── */
const R = 4000;
const follow = new THREE.Group();
scene.add(follow);
const MirrorShader = {
  name: 'MirrorGround',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vW = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 color; uniform sampler2D tDiffuse; uniform float dream, time, shockR, shockS; uniform vec2 shockC;
    varying vec4 vUv; varying vec3 vW;
    void main() {
      vec3 c = color;
      vec2 sd = vW.xz - shockC;
      float ring = exp(-pow((length(sd) - shockR) / 9.0, 2.0)) * shockS;   // 落地的冲击波
      if (dream > 0.004) {
        vec4 uv = vUv;
        uv.xy += normalize(sd + 1e-4) * ring * 0.04 * uv.w;
        uv.xy += vec2(sin(vW.z * 0.31 + time * 0.7) + sin(vW.x * 0.17 - time * 0.5),
                      cos(vW.x * 0.27 + time * 0.6) + sin(vW.z * 0.13 + time * 0.4)) * 0.0035 * uv.w;
        vec3 r = texture2DProj(tDiffuse, uv).rgb;
        c = mix(color, r * vec3(0.8, 0.85, 1.0), dream * 0.6);
      }
      c += vec3(1.0, 0.85, 0.55) * ring * 0.45;
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
};
const mirror = new Reflector(new THREE.CircleGeometry(R, 180), {
  color: PAL.ground, textureWidth: 1024, textureHeight: 1024, clipBias: 0.002, multisample: 4, shader: MirrorShader,
});
mirror.rotation.x = -Math.PI / 2;
mirror.renderOrder = -10;
Object.assign(mirror.material.uniforms, { dream: U.dream, time: U.time, shockC: U.shockC, shockR: U.shockR, shockS: U.shockS });
follow.add(mirror);
{
  const pass = mirror.onBeforeRender;
  mirror.onBeforeRender = function (...a) {
    if (U.dream.value < 0.004) return; // 原画里不需要倒影，省一遍渲染
    for (const o of reflectHide) { o.userData.vis = o.visible; o.visible = false; }
    pass.apply(this, a);
    for (const o of reflectHide) o.visible = o.userData.vis;
  };
}

boil(follow, (r) => {
  const n = wobble(r, 9), pts = [];
  for (let i = 0; i <= 900; i++) {
    const a = (i / 900) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.sin(a) * R, n(a) * R * 0.0012, -Math.cos(a) * R));
  }
  const l = inkLine(pts, PAL.ink, 3.6, -9.5);
  reflectHide.push(l);
  return l;
});

/* ── 公路：近处照画铺在地上；230 米以外梦里会揭起来，弯着伸进天里 ── */
const ROAD = 1.95; // 半宽：画里路边正好落在画框两个下角
const D0 = 230, RC = 500, SLOPE = 0.62, LX = 520;
function liftC(D) {
  const s = Math.max(0, D - D0), s1 = SLOPE * RC;
  const y = s < s1 ? s * s / (2 * RC) : s1 * s1 / (2 * RC) + (s - s1) * SLOPE;
  return new THREE.Vector3(LX * (1 - Math.exp(-((s / LX) ** 2))), y, -D);
}
const liftW = (D) => ROAD * (1 + Math.max(0, D - D0) / 180); // 越往上越宽，像一条展开的带子
function liftFrame(D) {
  const c = liftC(D);
  const t = liftC(D + 0.5).sub(c).normalize();
  const right = new THREE.Vector3().crossVectors(t, UP).normalize();
  return { c, t, right, up: new THREE.Vector3().crossVectors(right, t) };
}
// 顶点同时存平铺和升天两套位置，着色器里按 lift 插值
function liftable(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLift = U.lift;
    sh.vertexShader = 'attribute vec3 aLift;\nuniform float uLift;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n  transformed = mix(transformed, aLift, uLift);');
  };
  return mat;
}
function liftLine(l, upPts) {
  const g2 = new LineGeometry();
  g2.setPositions(upPts.flatMap((p) => [p.x, p.y, p.z]));
  l.geometry.setAttribute('liftStart', g2.attributes.instanceStart);
  l.geometry.setAttribute('liftEnd', g2.attributes.instanceEnd);
  l.frustumCulled = false;
  l.material.onBeforeCompile = (sh) => {
    sh.uniforms.uLift = U.lift;
    sh.vertexShader = sh.vertexShader
      .replace('attribute vec3 instanceEnd;', 'attribute vec3 instanceEnd;\nattribute vec3 liftStart;\nattribute vec3 liftEnd;\nuniform float uLift;')
      .replace('vec4( instanceStart, 1.0 )', 'vec4( mix( instanceStart, liftStart, uLift ), 1.0 )')
      .replace('vec4( instanceEnd, 1.0 )', 'vec4( mix( instanceEnd, liftEnd, uLift ), 1.0 )');
  };
}
{
  const Ds = [-4000, -1500, 0, 100, D0];
  for (let D = D0 + 3; D < D0 + 1600; D += 3) Ds.push(D);
  for (let D = D0 + 1600; D <= 8000; D += 15) Ds.push(D);
  const pos = [], alt = [], idx = [];
  Ds.forEach((D, i) => {
    const f = liftFrame(D);
    for (const s of [-1, 1]) {
      pos.push(s * ROAD, 0, -D);
      const p = f.c.clone().addScaledVector(f.right, s * liftW(D));
      alt.push(p.x, p.y, p.z);
    }
    if (i) { const a = 2 * (i - 1); idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLift', new THREE.Float32BufferAttribute(alt, 3));
  g.setIndex(idx);
  const road = new THREE.Mesh(g, liftable(new THREE.MeshBasicMaterial({
    color: PAL.road, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  })));
  road.renderOrder = -9;
  road.frustumCulled = false;
  scene.add(road);
}

// 路边墨线：近处密、远处疏
const edgeDs = [];
for (let D = -4000; D <= 8000;) { edgeDs.push(D); const a = Math.abs(D); D += a < 2000 ? Math.min(0.5 + a * 0.03, 6) : 60; }
for (const side of [-1, 1]) {
  boil(scene, (r) => {
    const n = wobble(r, 0.35), flat = [], up = [];
    for (const D of edgeDs) {
      const w = side * (ROAD + n(D) * 0.03);
      flat.push(new THREE.Vector3(w, 0, -D));
      const f = liftFrame(D);
      up.push(f.c.addScaledVector(f.right, w * liftW(D) / ROAD));
    }
    const l = inkLine(flat, PAL.ink, 2.4, -7, true);
    liftLine(l, up);
    reflectHide.push(l);
    return l;
  });
}

// 中线：头两段按画里的样子投回地面（画得比透视更长），之后才是规整的虚线
const quadMat = new THREE.MeshBasicMaterial({ color: PAL.dash, depthTest: false });
function groundQuad(corners) {
  const p = corners.map(([u, v]) => onGround(u, v));
  const g = new THREE.BufferGeometry().setFromPoints([p[0], p[1], p[2], p[0], p[2], p[3]]);
  const m = new THREE.Mesh(g, quadMat);
  m.renderOrder = -8;
  reflectHide.push(m);
  return m;
}
const quads = [groundQuad([[530, 985], [660, 985], [637, 800], [555, 800]]), groundQuad([[562, 735], [622, 735], [616, 640], [578, 640]])];
scene.add(...quads);

// 其余虚线：升天段跟着路走；黄色物体后面那一截有几条会飘起来翻跟头
const dashInfo = [];
const dashes = (() => {
  const r = rng(77);
  const Dc = [];
  for (let d = 44; d < 7900; d += 10) Dc.push(d + 2.5);
  for (let d = 4.73 - 5; d > -3900; d -= 10) Dc.push(d - 2.5); // 身后的虚线
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.66, 5).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: PAL.dash, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }),
    Dc.length,
  );
  const m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  Dc.forEach((D, i) => {
    const x = 0.15 + (r() - 0.5) * 0.06;
    const d = { p0: new THREE.Vector3(x, 0, -D), q0: new THREE.Quaternion() };
    if (D > D0) {
      const f = liftFrame(D);
      d.lifts = true;
      const k = liftW(D) / ROAD;
      d.p1 = f.c.clone().addScaledVector(f.right, x * k);
      d.s1 = new THREE.Vector3(k, 1, Math.min(k, 1.8));
      d.q1 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, f.up, f.t.clone().negate()));
    } else if (D > 48 && D < 225 && i % 2) {
      d.float = { H: 3 + r() * 12, ax: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), w: 0.25 + r() * 0.4, ph: r() * 6.28, dx: (r() - 0.5) * 5 };
    }
    d.cur = d.p0.clone(); d.curQ = d.q0.clone(); d.curS = one.clone();
    dashInfo.push(d);
    mesh.setMatrixAt(i, m.compose(d.p0, d.q0, one));
  });
  mesh.renderOrder = -8;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
})();
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
let lastLift = -1;
function updateDashes(t) {
  const L = U.lift.value, dr = U.dream.value, liftMoved = L !== lastLift;
  lastLift = L;
  const jt = clock - fx.impactT, jumping = jt >= 0 && jt < 5, jumpEnd = !jumping && fx.jumpDirty;
  fx.jumpDirty = jumping;
  let touched = false;
  dashInfo.forEach((d, i) => {
    if (d.float) {
      if (dr <= 0 && !d.dirty && !jumping && !jumpEnd) return;
      const f = d.float;
      _p.copy(d.p0);
      _p.y += dr * (f.H + Math.sin(t * f.w + f.ph) * 0.8);
      _p.x += f.dx * dr;
      _q.setFromAxisAngle(f.ax, dr * (t * f.w * 0.7 + f.ph));
      _s.copy(_one);
      d.dirty = dr > 0;
    } else if (d.lifts && (liftMoved || jumping || jumpEnd)) {
      _p.lerpVectors(d.p0, d.p1, L);
      _q.slerpQuaternions(d.q0, d.q1, L);
      _s.lerpVectors(_one, d.s1, L);
    } else if (jumping || jumpEnd) {
      _p.copy(d.p0); _q.copy(d.q0); _s.copy(_one);
    } else return;
    d.cur.copy(_p); d.curQ.copy(_q); d.curS.copy(_s);
    if (jumping) { // 冲击波经过时整条路的白线都蹦一下
      const dist = Math.hypot(_p.x - fx.impactP.x, _p.z - fx.impactP.z), k = jt - dist / 110;
      if (k > 0 && k < 0.7) _p.y += Math.sin(k / 0.7 * Math.PI) * 2.4 * Math.exp(-dist / 500);
    }
    if (d.licked) return; // 被舔的由舌头那边接管
    dashes.setMatrixAt(i, _m.compose(_p, _q, _s));
    touched = true;
  });
  if (touched) dashes.instanceMatrix.needsUpdate = true;
}
function setDash(i, p, k) {
  const d = dashInfo[i];
  dashes.setMatrixAt(i, _m.compose(p, d.curQ, _s.copy(d.curS).multiplyScalar(Math.max(0, k))));
  dashes.instanceMatrix.needsUpdate = true;
}
// 人站在哪儿，脚下有多高（在升天的路上就是路面的高度，否则是地面）
function floorAt(x, z, feet) {
  const D = -z, L = U.lift.value;
  if (D <= D0 || L <= 0) return 0;
  const c = liftC(D);
  const cy = c.y * L;
  const hw = ROAD + (liftW(D) - ROAD) * L;
  return Math.abs(x - c.x * L) < hw + 0.4 && feet > cy - 1.2 ? cy : 0;
}

/* ── 尽头的黄色物体（梦里成了圣物） ─────────────────────────── */
const DM = 40.5; // 它在画里的深度
const P = (u, v) => atDepth(u, v, DM);
const pxM = DM / F; // 那个深度上一像素多少米

function scribbleTex(r) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.lineCap = g.lineJoin = 'round';
  for (let k = 0; k < 30; k++) {
    const x0 = r() * 512, y0 = r() * 256, a = r() * Math.PI * 2;
    const loopR = 7 + r() * 11, w = 0.42 + r() * 0.2, step = 2 + r() * 1.5;
    g.strokeStyle = `rgba(214, 188, 36, ${0.4 + r() * 0.45})`;
    g.lineWidth = 1.6 + r() * 1.8;
    for (const ox of [-512, 0, 512]) {
      g.beginPath();
      for (let t = 0; t < 80; t++) {
        const px = x0 + ox + Math.cos(a) * t * step + loopR * Math.cos(t * w);
        const py = y0 + Math.sin(a) * t * step + loopR * Math.sin(t * w);
        t ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
const scribbles = [0, 1, 2].map((i) => scribbleTex(rng(31 + i * 17)));

const yMat = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: scribbles[0] },
    base: { value: new THREE.Color(PAL.yellow) },
    shade: { value: new THREE.Color(PAL.yellowShade) },
    light: { value: new THREE.Vector3(-0.45, 0.75, 0.55).normalize() },
    holy: U.holy, time: U.time,
  },
  vertexShader: /* glsl */`
    varying vec3 vN, vNv; varying vec2 vUv;
    void main() {
      vUv = uv;
      vN = normalize(mat3(modelMatrix) * normal);
      vNv = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D map; uniform vec3 base, shade, light; uniform float holy, time;
    varying vec3 vN, vNv; varying vec2 vUv;
    void main() {
      float l = dot(normalize(vN), light);
      vec3 c = mix(shade, base, smoothstep(-0.2, 0.05, l));
      vec4 s = texture2D(map, vUv);
      c = mix(c, s.rgb, s.a * 0.65);
      float rim = pow(1.0 - abs(normalize(vNv).z), 2.0);
      c += vec3(1.0, 0.9, 0.55) * rim * holy * 0.6;
      c *= 1.0 + holy * (0.1 + 0.06 * sin(time * 1.3));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
});
const edgeMat = new THREE.MeshBasicMaterial({ color: PAL.yellowEdge, side: THREE.BackSide });

const yellow = new THREE.Group();   // 不转的部分：天光、光芒、光点
const body = new THREE.Group();     // 会浮起、自转的本体
yellow.add(body);
const top = P(586, 503), base = P(587, 590);
const rS = 11.5 * pxM, rB = 22 * pxM;
const cx = (top.x + base.x) / 2;
yellow.position.set(cx, 0, -DM);
const headLocal = new THREE.Vector3(top.x - cx, top.y, 0);
{
  const len = top.y - rS - 0.5;
  const shaft = new THREE.Mesh(new THREE.CapsuleGeometry(rS, len, 8, 20), yMat);
  shaft.position.set(top.x - cx, 0.5 + len / 2, 0);
  const shaftEdge = new THREE.Mesh(new THREE.CapsuleGeometry(rS + 0.05, len, 8, 20), edgeMat);
  shaftEdge.position.copy(shaft.position);
  body.add(shaft, shaftEdge);
  const ballG = new THREE.SphereGeometry(rB, 32, 20);
  for (const u of [565, 607]) {
    const b = P(u, 592);
    const ball = new THREE.Mesh(ballG, yMat);
    ball.position.set(b.x - cx, Math.max(b.y, rB * 1.05 + 0.01), 0.55); // 刚好落地，不扎进地面
    ball.rotation.y = u * 0.7;
    const edge = new THREE.Mesh(ballG, edgeMat);
    edge.position.copy(ball.position);
    edge.scale.setScalar(1.05);
    body.add(ball, edge);
  }
}
scene.add(yellow);
// 柔边圆斑：贴地的影子和光池共用（alpha 从中心往外淡到 0，没有硬边）
const softDisc = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [k, a] of [[0, 1], [0.2, 0.78], [0.42, 0.42], [0.65, 0.14], [0.85, 0.03], [1, 0]]) grd.addColorStop(k, `rgba(255,255,255,${a})`);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
// 脚下的接触影：正好在两个球底下；浮起来越高越淡越散
const contact = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({
    color: PAL.roadShadow, alphaMap: softDisc, transparent: true, opacity: 0.85, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  }),
);
contact.position.set(0, 0, 0.55);
contact.renderOrder = -6;
reflectHide.push(contact);
yellow.add(contact);
const YPOS = yellow.position.clone();

// 光环：浮在头顶
const halo = new THREE.Mesh(
  new THREE.TorusGeometry(0.62, 0.06, 12, 72),
  new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, depthWrite: false }),
);
halo.rotation.x = Math.PI / 2 - 0.28;
body.add(halo);

// 身后的放射光芒：永远朝着镜头的一张大圆盘，叠加发光
const rays = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.ShaderMaterial({
    uniforms: { holy: U.holy, time: U.time, swirl: U.swirl, boost: U.boost, gold: { value: new THREE.Color('#ffe7a0') } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float holy, time, swirl, boost; uniform vec3 gold; varying vec2 vUv;
      void main() {
        float r = length(vUv), a = atan(vUv.y, vUv.x) + swirl * ((1.0 - r) * 5.0 + time * 2.0);
        float s1 = pow(0.5 + 0.5 * cos(a * 14.0 + time * 0.12), 6.0);
        float s2 = pow(0.5 + 0.5 * cos(a * 23.0 - time * 0.08 + 1.3), 10.0);
        float fall = smoothstep(1.0, 0.12, r);
        float core = exp(-r * r * 10.0);
        float ring = smoothstep(0.03, 0.0, abs(r - 0.36)) * 0.45;
        float v = (s1 * 0.32 + s2 * 0.2) * fall * fall + core * 0.4 + ring * fall * 0.5;
        gl_FragColor = vec4(gold * v * holy * boost, 1.0); // 叠加光直接按屏幕色值加，不过色彩空间换算，免得一加就白
      }`,
    // 不进透明队列、不做深度测试：紧跟在地面之后画，黄色物体和字再盖上来；
    // 这样它不会和地面相交出一道横缝，看起来像空气里散开的光
    transparent: false, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }),
);
rays.renderOrder = -5;
rays.scale.setScalar(30);
reflectHide.push(rays);

// 天光落地的光池
const pool = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({
    color: '#6b5a22', alphaMap: softDisc, transparent: false, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
);
pool.scale.set(16, 1, 16);
pool.position.set(YPOS.x, 0, YPOS.z + 0.4);
pool.renderOrder = -6;
reflectHide.push(pool);
scene.add(pool);
scene.add(rays);

// 一束天光从高处照下来
const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(1.1, 2.5, 420, 48, 1, true),
  new THREE.ShaderMaterial({
    uniforms: { holy: U.holy, time: U.time },
    vertexShader: /* glsl */`
      varying vec3 vN, vV; varying float vH;
      void main() {
        vH = position.y / 420.0 + 0.5;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float holy, time; varying vec3 vN, vV; varying float vH;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
        float fade = smoothstep(0.0, 0.015, vH) * pow(1.0 - vH, 1.6);
        float shimmer = 0.82 + 0.18 * sin(vH * 70.0 - time * 1.4);
        gl_FragColor = vec4(vec3(1.0, 0.94, 0.72) * edge * fade * shimmer * 0.16 * holy, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }),
);
beam.position.y = 210;
yellow.add(beam);

// 金色光点，绕着它慢慢往上飘
{
  const r = rng(808), n = 200, pos = [], seed = [];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, rad = 0.8 + Math.sqrt(r()) * 4.2;
    pos.push(Math.cos(a) * rad, r() * 16, Math.sin(a) * rad);
    seed.push(r(), r(), r(), r());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
  const motes = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { holy: U.holy, time: U.time, px: U.px },
    vertexShader: /* glsl */`
      uniform float holy, time, px; attribute vec4 aSeed; varying float vA;
      void main() {
        float h = mod(position.y + time * (0.35 + aSeed.x * 0.5), 16.0);
        float ang = aSeed.y * 6.2831 + time * (0.1 + aSeed.z * 0.2);
        float rad = length(position.xz) * (0.75 + 0.25 * sin(time * 0.3 + aSeed.w * 6.28));
        vec4 mv = modelViewMatrix * vec4(cos(ang) * rad, h, sin(ang) * rad, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.07 + aSeed.w * 0.09) * px * projectionMatrix[1][1] / -mv.z;
        vA = holy * smoothstep(0.0, 1.5, h) * smoothstep(16.0, 11.0, h) * (0.6 + 0.4 * sin(time * 3.0 + aSeed.x * 30.0));
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() {
        float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.55) * a * vA, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  motes.frustumCulled = false;
  yellow.add(motes);
}

// 圣光从它背后来，影子就长长地拖到你脚边（基里科的下午）
const longShadow = (() => {
  // 从两个球底下起头，越往你这边越淡、越散；画成白形黑底，当 alphaMap 用
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 512);
  g.filter = 'blur(5px)';
  g.fillStyle = '#fff';
  for (const x of [40, 88]) { g.beginPath(); g.ellipse(x, 30, 30, 22, 0, 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.roundRect(50, 22, 28, 460, 14); g.fill();
  g.filter = 'none';
  g.globalCompositeOperation = 'multiply';
  const fade = g.createLinearGradient(0, 0, 0, 512);
  fade.addColorStop(0, '#fff'); fade.addColorStop(0.35, '#bbb'); fade.addColorStop(1, '#000');
  g.fillStyle = fade; g.fillRect(0, 0, 128, 512);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(3.3, 26).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: PAL.longShadow, alphaMap: t, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    }),
  );
  m.position.set(YPOS.x + 0.05, 0, YPOS.z - 0.6 + 13);
  m.renderOrder = -6;
  reflectHide.push(m);
  scene.add(m);
  return m;
})();

/* ── 粉笔字、小笔触：投到各自深度上的白色管子 ──────────────── */
const chalk = new THREE.MeshBasicMaterial({ color: PAL.chalk });
const unitSphere = new THREE.SphereGeometry(1, 12, 8);
function stroke(pts, D, rPx, mat, r, jit) {
  const grp = new THREE.Group();
  const p3 = pts.map(([u, v]) => atDepth(u + (r() - 0.5) * jit, v + (r() - 0.5) * jit, D));
  const rad = rPx * D / F;
  const caps = [p3[0], p3[p3.length - 1]];
  if (p3.length > 1) {
    const curve = new THREE.CatmullRomCurve3(p3, false, 'centripetal');
    const segs = Math.max(6, Math.ceil(curve.getLength() / rad * 1.2));
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, rad, 8, false), mat));
  } else caps.length = 1;
  for (const c of caps) {
    const s = new THREE.Mesh(unitSphere, mat);
    s.position.copy(c);
    s.scale.setScalar(rad);
    grp.add(s);
  }
  return grp;
}
const ellipse = (cx, cy, rx, ry, tilt, a0, a1, n = 26) => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + (a1 - a0) * (i / n);
  const x = rx * Math.cos(a), y = ry * Math.sin(a);
  return [cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)];
});

// 日期 2026.11.1：画里是一道向下弯的弧，放进三维时两头近、中间远，像一条横幅罩着路
const DATE = [
  { r: 6, p: [[148, 322], [172, 314], [193, 322], [197, 338], [180, 352], [150, 364], [132, 371], [165, 384], [198, 396], [225, 407]] },
  { r: 6.5, p: ellipse(305, 423, 45, 29, 0.2, -1.9, -1.9 + Math.PI * 2.08) },
  { r: 6, p: [[418, 433], [438, 420], [460, 422], [468, 437], [458, 455], [432, 478], [410, 496], [442, 495], [478, 496], [528, 500]] },
  { r: 6.5, p: [[614, 417], [597, 428], [582, 450], [575, 476], [582, 497], [600, 505], [617, 496], [619, 478], [604, 468], [586, 472], [577, 483]] },
  { r: 4.5, p: [[677, 489]] },
  { r: 7, p: [[783, 410], [793, 433], [804, 459]] },
  { r: 7, p: [[842, 403], [855, 419], [868, 437]] },
  { r: 4.5, p: [[912, 428]] },
  { r: 6.5, p: [[957, 303], [972, 328], [987, 356]] },
];
const dateD = (u) => 105 + 35 * (1 - Math.min(1, ((u - 580) / 430) ** 2));
// 每个字挂在自己的中心上，梦里各自慢慢浮沉、转身
const glyphs = DATE.map((s) => {
  const u = s.p.reduce((a, [x]) => a + x, 0) / s.p.length;
  const v = s.p.reduce((a, [, y]) => a + y, 0) / s.p.length;
  const center = atDepth(u, v, dateD(u));
  const pivot = new THREE.Group();
  pivot.position.copy(center);
  const inner = new THREE.Group();
  inner.position.copy(center).negate();
  pivot.add(inner);
  boil(inner, (r) => stroke(s.p, dateD(u), s.r, chalk, r, 2.4));
  scene.add(pivot);
  return { pivot, base: center };
});

// 黄色物体头上两道小高光：漫画符号，挂在头顶、永远朝着镜头
const shine = new THREE.Group();
{
  const tickMat = new THREE.MeshBasicMaterial({ color: '#f3e352' });
  const loc = (u, v) => new THREE.Vector3((u - 586) * pxM, -(v - 503) * pxM, 0);
  for (const seg of [[[598, 522], [611, 517]], [[600, 530], [613, 527]]]) {
    boil(shine, (r) => {
      const a = loc(...seg[0]).add(new THREE.Vector3(r() - 0.5, r() - 0.5, 0).multiplyScalar(0.05));
      const b = loc(...seg[1]).add(new THREE.Vector3(r() - 0.5, r() - 0.5, 0).multiplyScalar(0.05));
      const g = new THREE.Group(), rad = 1.8 * pxM;
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 4, rad, 6), tickMat));
      for (const c of [a, b]) { const s = new THREE.Mesh(unitSphere, tickMat); s.position.copy(c); s.scale.setScalar(rad); g.add(s); }
      return g;
    });
  }
}
scene.add(shine);

// 地平线上一道淡白（左边）
const haze = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false });
const hazeG = new THREE.Group();
hazeG.add(stroke([[328, 563], [380, 561], [432, 557]], 520, 6, haze, rng(5), 0));
hazeG.add(stroke([[432, 556], [500, 551], [556, 547]], 520, 3.2, haze, rng(6), 0));
scene.add(hazeG);

// 左上角那团喷白
const sprayG = new THREE.Group();
scene.add(sprayG);
{
  const r = rng(404), pts = [];
  for (let i = 0; i < 220; i++) {
    const t = r(), u = 132 + t * 165 + (r() - 0.5) * 14;
    const v = 120 - 18 * Math.sin(t * 3) + (r() + r() + r() - 1.5) * 22;
    pts.push(atDepth(u, v, 1600));
  }
  for (const [lo, hi, size] of [[0, 140, 1.4], [140, 220, 2.4]]) {
    const pm = new THREE.PointsMaterial({ color: '#ffffff', size: 1, sizeAttenuation: false, transparent: true, opacity: 0.45, depthWrite: false });
    inks.push({ m: pm, px: size, points: true });
    sprayG.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts.slice(lo, hi)), pm));
  }
}

/* ── 天上两块半透明的灰 ─────────────────────────────────── */
function speckTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
  const r = rng(9);
  g.fillStyle = 'rgba(70, 76, 120, .55)';
  for (let i = 0; i < 14; i++) g.fillRect(r() * 256, r() * 256, 1.5 + r() * 2.5, 1.5 + r() * 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 260, 1 / 260);
  return t;
}
const specks = speckTex();
const blockCap = new THREE.MeshBasicMaterial({ color: PAL.block, map: specks, transparent: true, opacity: 0.62, depthWrite: false });
const blockSide = new THREE.MeshBasicMaterial({ color: PAL.blockSide, transparent: true, opacity: 0.62, depthWrite: false });
function slab(poly, D, thick, round) {
  const pts = poly.map(([u, v]) => { const p = atDepth(u, v, D); return new THREE.Vector2(p.x, p.y); });
  const rr = round * D / F, n = pts.length, shape = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const ab = b.clone().sub(a), bc = c.clone().sub(b);
    const p1 = b.clone().sub(ab.setLength(Math.min(rr, ab.length() / 2)));
    const p2 = b.clone().add(bc.setLength(Math.min(rr, bc.length() / 2)));
    i ? shape.lineTo(p1.x, p1.y) : shape.moveTo(p1.x, p1.y);
    shape.quadraticCurveTo(b.x, b.y, p2.x, p2.y);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 4 });
  // 以自身中心为轴，梦里好让它漂、让它转
  g.computeBoundingBox();
  const bb = g.boundingBox, c = bb.getCenter(new THREE.Vector3());
  const box = { minX: bb.min.x, minY: bb.min.y, w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y };
  g.translate(-c.x, -c.y, -c.z);
  const m = new THREE.Mesh(g, [blockCap, blockSide]);
  m.position.set(c.x, c.y, c.z - D - thick);
  m.userData = { base: m.position.clone(), box, center: c, thick, poly: pts };
  return m;
}
// 轮廓从原图像素掩膜量出来：左块微微逆时针转、右下缺一角；右块上半截转了约 19°
const slabL = slab([[292, 160], [519, 143], [545, 455], [474, 462], [478, 559], [326, 571],
  [304, 305], [290, 303], [289, 287], [302, 284]], 700, 46, 14);
const slabR = slab([[510, 185], [772, 95], [812, 218], [725, 247], [725, 322], [842, 322], [842, 495], [747, 495],
  [747, 552], [595, 552], [595, 513], [495, 513], [495, 362], [590, 362], [590, 292], [552, 305]], 860, 56, 14);
scene.add(slabL, slabR);
slabR.updateMatrixWorld();
for (const p of [[[665, 240], [676, 233], [686, 228]], [[588, 272], [597, 265]]]) slabR.attach(stroke(p, 850, 2.6, chalk, rng(3), 0));

/* ── 右下角的 @：画在地上，从画里那个位置看才是圆的 ───────── */
const atG = new THREE.Group();
scene.add(atG);
{
  const inner = ellipse(941, 928, 8, 8.5, 0, 0, Math.PI * 2, 20);
  const outer = [[949, 918], [949, 933], [953, 938], [960, 939], ...ellipse(944, 925, 24, 24, 0, 0.6, 0.6 - Math.PI * 1.86, 40)];
  for (const s of [inner, outer]) {
    for (const l of boil(atG, (r) => inkLine(s.map(([u, v]) => onGround(u + (r() - 0.5) * 1.2, v + (r() - 0.5) * 1.2)), PAL.chalk, 3))) reflectHide.push(l);
  }
}

/* ── 画纸：屏幕上一张（盖住画框外），三维里一张一模一样的立在眼前 ── */
const holeEl = $('#hole');
$('#sheet').setAttribute('d', 'M-8000,-8000H9000V9000H-8000Z ' + holeEl.getAttribute('d'));
function samplePath(el, step) {
  const L = el.getTotalLength(), out = [[]];
  let prev = null;
  for (let l = 0; l <= L + 0.01; l += step) {
    const p = el.getPointAtLength(Math.min(l, L));
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > step * 2.5) out.push([]);
    out[out.length - 1].push([p.x, p.y]);
    prev = p;
  }
  return out.filter((s) => s.length);
}
const paper = new THREE.Group();
let paperSheet;
{
  const xy = ([u, v]) => { const p = atDepth(u, v, DS); return new THREE.Vector2(p.x, p.y); };
  const sheet = new THREE.Shape([[0, 0], [IMG.w, 0], [IMG.w, IMG.h], [0, IMG.h]].map(xy));
  sheet.holes.push(new THREE.Path(samplePath(holeEl, 4)[0].map(xy)));
  const g = new THREE.ShapeGeometry(sheet, 1).translate(0, 0, -DS);
  paperSheet = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
  paper.add(paperSheet);
  const mats = {};
  const matOf = (css) => (mats[css] ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(css), side: THREE.DoubleSide }));
  for (const el of document.querySelectorAll('#pg path')) {
    if (el.id === 'sheet' || el.id === 'hole') continue;
    const cs = getComputedStyle(el);
    if (cs.fill !== 'none') {
      const blob = new THREE.Shape(samplePath(el, 2)[0].map(xy));
      paper.add(new THREE.Mesh(new THREE.ShapeGeometry(blob).translate(0, 0, -DS + 0.003), matOf(cs.fill)));
    } else {
      for (const seg of samplePath(el, 3)) paper.add(stroke(seg, DS, parseFloat(cs.strokeWidth) / 2, matOf(cs.stroke), rng(1), 0));
    }
  }
}
scene.add(paper);
const SHEET_X = [atDepth(0, VP.y, DS).x, atDepth(IMG.w, VP.y, DS).x];
const HOLE_X = [atDepth(132, VP.y, DS).x + 0.12, atDepth(1002, VP.y, DS).x - 0.12];

/* ── 版式 ───────────────────────────────────────────────── */
const pg = $('#pg');
let W = 1, H = 1, S = 1, paperFov = 60, worldFov = 60;
function layout() {
  W = innerWidth; H = innerHeight;
  const pad = 24;
  S = Math.min((W / 2) / (VP.x + pad), (W / 2) / (IMG.w - VP.x + pad), (H / 2) / (VP.y + pad), (H / 2) / (IMG.h - VP.y + pad));
  paperFov = 2 * Math.atan((H / 2) / (S * F)) * 180 / Math.PI;
  worldFov = Math.min(paperFov, 72);
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  U.px.value = H * DPR * 0.5;
  mirror.getRenderTarget().setSize(Math.round(W * DPR * 0.6), Math.round(H * DPR * 0.6));
  for (const k of inks) {
    if (k.points) k.m.size = k.px * S * DPR;
    else k.m.linewidth = k.px * S * DPR;
  }
}
addEventListener('resize', layout);
layout();

/* ── 舌头和圣物 ─────────────────────────────────────────── */
const flashEl = $('#flash'), meterEl = $('#meter');
const inkNow = (...a) => { const l = inkLine(...a); const k = inks[inks.length - 1]; k.m.linewidth = k.px * S * DPR; return l; };
const ballOf = (q) => { q.geometry.computeBoundingSphere(); return q.geometry.boundingSphere; };
const ctx = {
  scene, camera, canvas, U, UP, YPOS, yellow, body, halo, headLocal, glyphs, softDisc, fx, floorAt, setDash, dashInfo, reflectHide,
  slabs: [slabL, slabR], solid: [slabL, slabR, paperSheet], inkLine: inkNow, say: (...a) => say(...a),
  misc: [
    { objs: [quads[0]], center: ballOf(quads[0]).center.clone(), radius: ballOf(quads[0]).radius, weight: 1.5 },
    { objs: [quads[1]], center: ballOf(quads[1]).center.clone(), radius: ballOf(quads[1]).radius, weight: 1.5 },
    { objs: [atG], center: onGround(944, 925), radius: 0.8, weight: 2 },
    { objs: [sprayG], center: atDepth(215, 120, 1600), radius: 120, weight: 2.5 },
    { objs: [hazeG], center: atDepth(440, 555, 520), radius: 45, weight: 2.5 },
  ],
  onImpact(p) {
    Object.assign(fx, { flash: 1, shake: 1.4, slabShake: 1, boilFast: 2.2, impactT: clock });
    fx.impactP.copy(p);
    U.shockC.value.set(p.x, p.z); U.shockS.value = 1;
    lick.forceRetract(); lick.restore();
  },
};
const idol = createIdol(ctx);
ctx.idol = idol;
const lick = createLick(ctx);

/* ── 状态与补间 ─────────────────────────────────────────── */
const view = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: -ROLL, fovK: 0, dream: 0, dodge: 0, dodgeT: 0, spin: 0 };
let mode = 'paper'; // paper → entering → world → returning → paper
const tweens = [];
const ease = { inOut: smooth, in: (t) => t * t, out: (t) => 1 - (1 - t) * (1 - t) };
let clock = 0;
function tween(key, to, dur, delay = 0, fn = ease.inOut, done) {
  for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].key === key) tweens.splice(i, 1);
  tweens.push({ key, from: view[key], to, t0: clock + delay, dur, fn, done });
}

const hint = $('#hint');
const touch = matchMedia('(pointer: coarse)').matches;
let hintTimer = 0;
function say(text, hold = 0) {
  hint.textContent = text;
  hint.classList.add('on');
  clearTimeout(hintTimer);
  if (hold) hintTimer = setTimeout(() => hint.classList.remove('on'), hold);
}

let toldSky = false;
function enter() {
  if (mode !== 'paper') return;
  mode = 'entering';
  document.body.classList.replace('paper', 'walking');
  // 不淡出、不切换：镜头一路往前推，屏幕上的画纸按透视同步放大（等于一张无限大的纸），
  // 从洞里穿过去；过了纸面才把地平线摆正、视角放开，梦随后展开
  tween('z', -7, 2.6, 0, (t) => t * t * t * (t * (6 * t - 15) + 10), () => { mode = 'world'; });
  tween('roll', 0, 1.8, 1.7);
  tween('fovK', 1, 1.8, 1.7);
  tween('dream', 1, 9, 2.2, (t) => t);
  say(touch ? '单指 伸舌头 · 双指拖 环顾 · 双指按住 前进' : '左键按住 伸舌头 · 右键或 Alt+拖 环顾 · WASD 走 · R 回到画里', 9000);
}
function back() {
  if (mode !== 'world') return;
  mode = 'returning';
  vel.set(0, 0, 0); wheelV = 0; vy = 0; look = null;
  lick.forceRetract(); lick.restore(); idol.reset();
  view.yaw = Math.atan2(Math.sin(view.yaw), Math.cos(view.yaw));
  // 先飞回画纸后面 7 米、摆回画里的角度，再顺着原路从洞里退出去
  const BZ = -7;
  const dur = Math.min(4.2, 1.4 + Math.hypot(view.x, view.z - BZ, view.y) / 250);
  for (const k of ['x', 'y', 'yaw', 'pitch']) tween(k, 0, dur);
  tween('z', BZ, dur, 0, ease.inOut, () => tween('z', 0, 2.2, 0, ease.inOut, () => {
    mode = 'paper';
    document.body.classList.replace('walking', 'paper');
    say('点一下 · 走进画里');
  }));
  // 飞回去的直线若穿过黄色物体，就往旁边绕一道弧
  const ax = view.x, az = view.z - BZ, L2 = ax * ax + az * az || 1;
  const t = clamp01((YPOS.x * ax + (YPOS.z - BZ) * az) / L2);
  const ox = ax * t - YPOS.x, oz = az * t + BZ - YPOS.z;
  view.dodge = Math.hypot(ox, oz) < 3.5 ? (ox >= 0 ? 1 : -1) * 4.5 : 0;
  view.dodgeT = 0;
  tween('dodgeT', 1, dur, 0, (u) => u);
  tween('roll', -ROLL, dur);
  tween('fovK', 0, dur);
  tween('dream', 0, dur);
  tween('spin', Math.round(view.spin / (Math.PI * 2)) * Math.PI * 2, dur);
  hint.classList.remove('on');
}
$('#back').addEventListener('click', (e) => { e.stopPropagation(); back(); });

/* ── 输入 ───────────────────────────────────────────────── */
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (mode === 'paper' && [' ', 'enter', 'w', 'arrowup'].includes(k)) { enter(); e.preventDefault(); }
  if (k === 'r' || k === 'escape') back();
  if (k.startsWith('arrow') || k === ' ') e.preventDefault();
  keys.add(k);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// 左键按住：伸舌头，舌尖跟着鼠标；右键（或 Alt+左键）拖：环顾。触屏：单指舌头，双指拖环顾、双指按住前进
let look = null;
const touches = new Map();
const centroid = () => {
  let x = 0, y = 0;
  for (const p of touches.values()) { x += p.x; y += p.y; }
  return { x: x / touches.size, y: y / touches.size };
};
function turn(dx, dy) {
  const k = (camera.fov / 60) * 0.0042;
  view.yaw += dx * k;
  view.pitch = Math.max(-1.3, Math.min(1.3, view.pitch + dy * k));
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (mode === 'paper') { enter(); return; }
  if (mode !== 'world') return;
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 1) { lick.aimAt(e.clientX, e.clientY); lick.press(); }
    else { lick.release(); look = { touch: true, ...centroid(), t: clock, moved: 0 }; }
    return;
  }
  if (e.button === 2 || (e.button === 0 && e.altKey)) { look = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
  if (e.button === 0) { lick.aimAt(e.clientX, e.clientY); lick.press(); }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2 && look?.touch) {
      const c = centroid(), dx = c.x - look.x, dy = c.y - look.y;
      look.x = c.x; look.y = c.y; look.moved += Math.abs(dx) + Math.abs(dy);
      turn(dx, dy);
    } else if (touches.size === 1) lick.aimAt(e.clientX, e.clientY);
    return;
  }
  lick.aimAt(e.clientX, e.clientY);
  if (look && look.id === e.pointerId) {
    turn(e.clientX - look.x, e.clientY - look.y);
    look.x = e.clientX; look.y = e.clientY;
  }
});
const release = (e) => {
  if (e.pointerType === 'touch') {
    touches.delete(e.pointerId);
    if (touches.size < 2 && look?.touch) look = null;
    if (!touches.size) lick.release();
    return;
  }
  if (look && look.id === e.pointerId) { look = null; return; }
  if (e.button === 0) lick.release();
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

let wheelV = 0;
addEventListener('wheel', (e) => {
  e.preventDefault();
  if (mode === 'paper') { enter(); return; }
  if (mode !== 'world') return;
  wheelV = Math.max(-30, Math.min(30, wheelV - e.deltaY * 0.04));
}, { passive: false });

/* ── 每帧 ───────────────────────────────────────────────── */
const vel = new THREE.Vector3();
const want = new THREE.Vector3();
const _v = new THREE.Vector3();
let walked = 0, boilI = 0, vy = 0;

function walk(dt) {
  let fwd = 0, side = 0;
  if (keys.has('w') || keys.has('arrowup')) fwd += 1;
  if (keys.has('s') || keys.has('arrowdown')) fwd -= 1;
  if (keys.has('a')) side -= 1;
  if (keys.has('d')) side += 1;
  if (keys.has('arrowleft')) view.yaw += 1.5 * dt;
  if (keys.has('arrowright')) view.yaw -= 1.5 * dt;
  if (look?.touch && look.moved < 10 && clock - look.t > 0.3) fwd = 1;
  const speed = keys.has('shift') ? 24 : 4.5;
  const sy = Math.sin(view.yaw), cy = Math.cos(view.yaw);
  want.set(-sy * fwd + cy * side, 0, -cy * fwd - sy * side);
  if (want.lengthSq() > 1) want.normalize();
  want.multiplyScalar(speed);
  want.x += -sy * wheelV; want.z += -cy * wheelV;
  wheelV *= Math.exp(-dt * 2.5);
  vel.lerp(want, 1 - Math.exp(-dt * 5));
  const pz = view.z;
  view.x += vel.x * dt;
  view.z += vel.z * dt;
  // 画纸只有洞那一块能穿过去
  if ((pz + DS) * (view.z + DS) < 0 && view.y < 1.9 && view.x > SHEET_X[0] - 0.1 && view.x < SHEET_X[1] + 0.1
    && !(view.x > HOLE_X[0] && view.x < HOLE_X[1])) { view.z = pz; vel.z = 0; }
  // 绕开黄色物体
  const dx = view.x - YPOS.x, dz = view.z - (YPOS.z + 0.3), d = Math.hypot(dx, dz);
  if (d < 2.3 && view.y < 6) { view.x = YPOS.x + dx / d * 2.3; view.z = YPOS.z + 0.3 + dz / d * 2.3; }
  const rr = Math.hypot(view.x, view.z);
  if (rr > 3600) { view.x *= 3600 / rr; view.z *= 3600 / rr; }
  // 踩在升天的路上就跟着它走高；从路边踩空，像梦里那样慢慢飘下去
  const floor = floorAt(view.x, view.z, view.y);
  if (floor >= view.y - 0.6) { view.y = floor; vy = 0; }
  else {
    vy = Math.max(vy - 6 * dt, -(4 + view.y * 0.3));
    view.y = Math.max(floor, view.y + vy * dt);
  }
  walked += vel.length() * dt;
}

function update(dt) {
  clock += dt;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    if (clock < tw.t0) continue;
    const t = clamp01((clock - tw.t0) / tw.dur);
    view[tw.key] = tw.from + (tw.to - tw.from) * tw.fn(t);
    if (t >= 1) { tweens.splice(i, 1); tw.done?.(); }
  }
  if (mode === 'world') walk(dt);

  const t = clock, dr = view.dream;
  U.time.value = t;
  U.dream.value = dr;
  U.holy.value = smooth(clamp01(dr * 1.7));
  U.lift.value = smooth(clamp01((dr - 0.3) / 0.7));
  const holy = U.holy.value;
  if (U.lift.value >= 1 && !toldSky && mode === 'world') { toldSky = true; say('路，往天上去了', 5000); }

  // 圣物：浮起、慢慢自转；光环、光芒、天光
  if (mode === 'world') view.spin += dt * 0.2 * holy;
  body.position.y = holy * (0.7 + Math.sin(t * 0.9) * 0.18);
  body.rotation.y = view.spin;
  halo.position.set(headLocal.x, headLocal.y + rS + 0.55 + Math.sin(t * 1.3) * 0.06, 0);
  halo.material.opacity = holy;
  halo.visible = holy > 0.002;
  idol.update(dt, t, lick.percent, mode === 'world');
  rays.visible = beam.visible = holy > 0.002;
  longShadow.material.opacity = 0.42 * holy;
  longShadow.visible = holy > 0.002;
  // 浮得越高，脚下的影子越大越淡；天光落地的光池跟着圣光亮起来
  const lev = body.position.y;
  contact.scale.set(3.4 * (1 + lev * 0.6), 1, 2.6 * (1 + lev * 0.6));
  contact.material.opacity = 0.85 / (1 + lev * 1.6);
  pool.material.color.setRGB(0.04 * holy, 0.034 * holy, 0.013 * holy); // 线性值，叠加后约 +55 的暖光
  pool.visible = holy > 0.002;

  // 梦里的漂浮：每个字、两块灰板
  glyphs.forEach((g, i) => {
    if (g.state === 'slurp' || g.state === 'gone') return;
    g.pivot.position.copy(g.base);
    g.pivot.position.y += Math.sin(t * 0.6 + i * 0.9) * 0.9 * dr;
    g.pivot.rotation.y = Math.sin(t * 0.25 + i * 1.7) * 0.35 * dr;
    g.pivot.rotation.z = Math.sin(t * 0.33 + i * 2.3) * 0.08 * dr;
    if (idol.angel > 0.001) { // 天使形态：没被舔掉的字缩小，绕着它转
      const k = smooth(Math.min(1, idol.angel));
      g.pivot.position.lerp(idol.orbitPos(i, glyphs.length, t, _v), k);
      if (g.state !== 'regrow') g.pivot.scale.setScalar(1 - 0.75 * k);
    } else if (!g.state) g.pivot.scale.setScalar(1);
    if (g.state === 'regrow') { // 吐回来，弹一下长回原大小
      g.regrow += dt;
      const k = Math.min(1, g.regrow / 0.7);
      g.pivot.scale.setScalar(1 - Math.cos(k * Math.PI * 2.5) * (1 - k));
      if (k >= 1) { g.state = null; g.pivot.scale.setScalar(1); }
    }
  });
  slabL.position.copy(slabL.userData.base);
  slabL.position.y += dr * (28 + Math.sin(t * 0.21) * 5);
  slabL.rotation.y = Math.sin(t * 0.05) * 0.1 * dr;
  slabR.position.copy(slabR.userData.base);
  slabR.position.y += dr * Math.sin(t * 0.17 + 2) * 7;
  slabR.rotation.z = Math.sin(t * 0.07 + 1) * 0.06 * dr;
  if (fx.slabShake > 0.01) {
    slabL.position.x += (Math.random() - 0.5) * fx.slabShake * 8; slabL.position.y += (Math.random() - 0.5) * fx.slabShake * 5;
    slabR.position.x += (Math.random() - 0.5) * fx.slabShake * 8; slabR.position.y += (Math.random() - 0.5) * fx.slabShake * 5;
  }
  updateDashes(t);

  const bob = mode === 'world' && view.y === floorAt(view.x, view.z, view.y)
    ? Math.sin(walked * 1.8) * 0.035 * Math.min(1, vel.length() / 4.5) : 0;
  const dodge = mode === 'returning' ? view.dodge * Math.sin(Math.PI * view.dodgeT) : 0;
  camera.position.set(view.x + dodge, view.y + EYE + bob, view.z);
  camera.rotation.set(view.pitch, view.yaw, view.roll);
  if (fx.shake > 0.002) { // 落地震动
    camera.position.x += (Math.random() - 0.5) * fx.shake * 0.5;
    camera.position.y += (Math.random() - 0.5) * fx.shake * 0.4;
    camera.rotation.z += (Math.random() - 0.5) * fx.shake * 0.04;
  }
  const fov = paperFov + (worldFov - paperFov) * view.fovK;
  if (Math.abs(camera.fov - fov) > 1e-4 || camera.userData.aspect !== camera.aspect) {
    camera.fov = fov;
    camera.userData.aspect = camera.aspect;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
  follow.position.set(view.x, 0, view.z);
  dome.position.copy(camera.position);
  lick.update(dt, t, mode === 'world');

  // 朝着镜头的东西
  yellow.updateMatrixWorld();
  const head = body.localToWorld(_v.copy(headLocal));
  shine.quaternion.copy(camera.quaternion);
  shine.position.copy(camera.position).sub(head).setLength(0.8).add(head);
  rays.quaternion.copy(camera.quaternion);
  rays.position.set(YPOS.x, 2.9 + body.position.y, YPOS.z);
  rays.position.add(_v.copy(rays.position).sub(camera.position).setLength(2.5));

  // 屏幕上的画纸 = 一张无限大、立在 DS 处的纸：镜头沿视轴推近 dz，它就以消失点为中心放大 DS/(DS-dz)
  const dz = -view.z;
  const onAxis = mode !== 'world' && Math.abs(view.x) < 1e-3 && Math.abs(view.y) < 1e-3;
  const showPaper = onAxis && dz < DS - 0.2;
  pg.style.display = showPaper ? '' : 'none';
  if (showPaper) pg.setAttribute('transform', `translate(${W / 2} ${H / 2}) scale(${S * DS / (DS - dz)}) translate(${-VP.x} ${-VP.y})`);
  blockSide.opacity = 0.62 * clamp01(dz / 7); // 画里只看得到正面，走出来才有厚度

  fx.shake *= Math.exp(-dt * 2.2);
  fx.flash = Math.max(0, fx.flash - dt * 2.2);
  fx.slabShake *= Math.exp(-dt * 1.4);
  fx.boilFast -= dt;
  U.shockR.value = (clock - fx.impactT) * 150;
  U.shockS.value *= Math.exp(-dt * 0.5);
  flashEl.style.opacity = fx.flash;
  const pct = Math.floor(lick.percent);
  meterEl.textContent = `舔掉 ${pct}%`;
  meterEl.classList.toggle('on', mode === 'world' && (pct > 0 || lick.active));

  const bi = Math.floor(performance.now() / (fx.boilFast > 0 ? 40 : 125)) % BOIL;
  if (bi !== boilI) {
    boilI = bi;
    for (const set of boilSets) set.forEach((o, i) => { o.visible = i === bi; });
    yMat.uniforms.map.value = scribbles[bi];
  }
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame); // 先排下一帧：哪帧出错也不至于整个停住
  update(Math.min(0.05, (now - last) / 1000));
  last = now;
  renderer.render(scene, camera);
}

// 调试：?in 直接进画（梦已做完）；?z=-30&x=0&y=0&yaw=0.3&pitch=0&dream=0.5
if (qs.has('in') || qs.has('z')) {
  mode = 'world';
  document.body.classList.replace('paper', 'walking');
  Object.assign(view, { roll: 0, fovK: 1, z: -7, dream: qs.has('dream') ? +qs.get('dream') : 1 });
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch']) if (qs.has(k)) view[k] = +qs.get(k);
  toldSky = true;
} else say('点一下 · 走进画里');
window.JT = { view, U, enter, back, scene, camera, renderer, liftC, floorAt, lick, idol, glyphs, get mode() { return mode; } };
update(0);
requestAnimationFrame(frame);
