// 黄色圣物的五级反应：画被舔掉的百分比越高，它越离谱。
// 1 果冻乱颤 → 2 陀螺、光环甩飞 → 3 有丝分裂、满路小人 → 4 圣经级天使（六翼、眼轮）→ 5 飞升，再砸回来，一切复原
import * as THREE from 'three';

export const STAGES = [5, 15, 30, 50, 75];
const SAY = ['', '它开始发抖了', '它转起来了', '它……分裂了', '不要害怕', '它要升天了'];

export function createIdol(ctx) {
  const { scene, camera, U, yellow, body, halo, YPOS, headLocal } = ctx;
  let stage = 0;
  let wob = 0, wobV = 0, base = 0;
  let spinX = 0, spinRate = 0, orbit = 0, angel = 0, angelTarget = 0;
  let asc = null, bounce = -1;
  const off = new THREE.Vector3();   // 飞升/坠落时本体的偏移
  const clones = [];
  const _a = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();

  /* ── 小分身：本体的克隆，长两条简笔画的腿 ─────────────────── */
  const tpl = body.clone(true);
  for (const c of [...tpl.children]) if (c.geometry?.type === 'TorusGeometry') tpl.remove(c);
  tpl.position.set(0, 0, 0); tpl.rotation.set(0, 0, 0); tpl.scale.set(1, 1, 1);
  const legMat = new THREE.MeshBasicMaterial({ color: '#141418' });
  const legGeo = new THREE.CylinderGeometry(0.11, 0.11, 2.4, 6).translate(0, -1.2, 0);
  const footGeo = new THREE.SphereGeometry(0.32, 10, 6).scale(1, 0.45, 1.6);
  const CS = 0.32, LEG = 2.4 * CS;
  function makeClone() {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(CS);
    inner.position.y = LEG;
    inner.add(tpl.clone(true));
    const legs = [-0.45, 0.45].map((x) => {
      const hip = new THREE.Group();
      hip.position.set(x, 0.25, 0.3);
      const leg = new THREE.Mesh(legGeo, legMat), foot = new THREE.Mesh(footGeo, legMat);
      foot.position.set(0, -2.45, 0.2);
      hip.add(leg, foot);
      inner.add(hip);
      return hip;
    });
    group.add(inner);
    scene.add(group);
    return { group, inner, legs };
  }
  function spawnClone() {
    const c = makeClone();
    const a = Math.random() * Math.PI * 2;
    c.group.position.set(YPOS.x + Math.cos(a) * 1.5, 2.5 + body.position.y, YPOS.z + Math.sin(a) * 1.5);
    c.vel = new THREE.Vector3(Math.cos(a) * (4 + Math.random() * 3), 6 + Math.random() * 3, Math.sin(a) * (4 + Math.random() * 3));
    c.air = true; c.age = 0; c.heading = a; c.speed = 2.2 + Math.random() * 1.6; c.phase = Math.random() * 6;
    c.state = null;
    clones.push(c);
  }
  function updateClones(dt, t) {
    for (let i = clones.length - 1; i >= 0; i--) {
      const c = clones[i];
      if (c.state === 'slurp') continue;
      if (c.state === 'gone') { scene.remove(c.group); clones.splice(i, 1); continue; }
      c.age += dt;
      const p = c.group.position;
      if (c.state === 'home') { // 被吸回本体
        c.home += dt;
        const k = Math.min(1, c.home / 0.8);
        p.lerp(_a.set(YPOS.x, 2.5 + body.position.y, YPOS.z), k * 0.25);
        c.group.scale.setScalar(1 - k);
        if (k >= 1) { scene.remove(c.group); clones.splice(i, 1); }
        continue;
      }
      c.group.scale.setScalar(Math.min(1, c.age / 0.35));
      if (c.air) {
        c.vel.y -= 14 * dt;
        p.addScaledVector(c.vel, dt);
        if (p.y <= 0) { p.y = 0; c.air = false; }
        c.legs.forEach((l, k) => { l.rotation.x = (k ? 1 : -1) * 0.9; });
        continue;
      }
      // 乱跑：随机转向，离本体太远就往回拐，别撞进它
      c.heading += (Math.sin(t * 0.7 + c.phase * 3) * 1.4 + (Math.random() - 0.5) * 2) * dt;
      _a.set(YPOS.x - p.x, 0, YPOS.z - p.z);
      const d = _a.length();
      if (d > 55 || d < 4) {
        const want = Math.atan2(d > 55 ? _a.x : -_a.x, d > 55 ? _a.z : -_a.z);
        let diff = want - c.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        c.heading += diff * Math.min(1, dt * 3);
      }
      p.x += Math.sin(c.heading) * c.speed * dt;
      p.z += Math.cos(c.heading) * c.speed * dt;
      c.phase += dt * c.speed * 3.2;
      p.y = Math.abs(Math.sin(c.phase)) * 0.12;
      c.group.rotation.y = c.heading;
      c.inner.rotation.z = Math.sin(c.phase) * 0.12;
      c.legs.forEach((l, k) => { l.rotation.x = Math.sin(c.phase + k * Math.PI) * 0.9; });
    }
  }

  /* ── 天使：六只线稿翅膀、三圈眼轮、身上也睁开眼睛 ─────────── */
  const angelG = new THREE.Group();
  angelG.visible = false;
  yellow.add(angelG);
  const wingMat = new THREE.MeshBasicMaterial({ color: '#fffaf0', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const wings = [];
  {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0.1);
    sh.bezierCurveTo(1.4, 1.5, 3.4, 2.4, 5.8, 1.7);
    const feathers = 6;
    let px = 5.8, py = 1.7;
    for (let k = 0; k < feathers; k++) {
      const nx = 5.8 - (k + 1) * (5.4 / feathers), ny = 0.2 - (k === feathers - 1 ? 0 : 0.15 * Math.sin(k));
      sh.quadraticCurveTo((px + nx) / 2 + 0.2, Math.min(py, ny) - 0.9 + k * 0.08, nx, ny);
      px = nx; py = ny;
    }
    sh.lineTo(0, 0.1);
    const geo = new THREE.ShapeGeometry(sh, 8);
    const outlinePts = sh.getPoints(10).map((p) => new THREE.Vector3(p.x, p.y, 0));
    const veins = [0.25, 0.45, 0.65].map((f) => [new THREE.Vector3(0.3, 0.2, 0), new THREE.Vector3(5.8 * f + 1, 1.2 - f * 1.4, 0)]);
    [[1.3, 0.6], [0.1, 0.08], [-1.1, -0.5]].forEach(([y, rz], pair) => {
      for (const side of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.55, y, -0.3);
        pivot.scale.x = side;
        const w = new THREE.Group();
        w.rotation.z = rz;
        w.add(new THREE.Mesh(geo, wingMat));
        w.add(ctx.inkLine(outlinePts, '#141418', 2.2, 1, true));
        for (const v of veins) w.add(ctx.inkLine(v, '#8a7a5a', 1.4, 1, true));
        pivot.add(w);
        angelG.add(pivot);
        wings.push({ pivot, side, pair });
      }
    });
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: '#f3cf5a' });
  const ringInk = new THREE.MeshBasicMaterial({ color: '#4d3a10', side: THREE.BackSide });
  const rings = [3.4, 4.1, 4.8].map((R, i) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.12, 10, 120), ringMat));
    g.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.17, 10, 120), ringInk));
    g.rotation.set(i === 1 ? Math.PI / 2 : 0, i === 2 ? Math.PI / 2 : 0, 0);
    g.userData = { R, n: 9 + i * 2, axis: new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0.3, i === 2 ? 1 : 0).normalize(), w: 0.5 + i * 0.25 };
    angelG.add(g);
    return g;
  });
  const BODY_EYES = [[0, 1.9], [0, 2.7], [0, 3.5], [-0.84, 0.95], [0.84, 0.95], [-0.5, 1.4], [0.5, 1.45]];
  const EYES = rings.reduce((a, r) => a + r.userData.n, 0) + BODY_EYES.length;
  const eyeSeed = new Float32Array(EYES);
  for (let i = 0; i < EYES; i++) eyeSeed[i] = Math.random();
  const eyeGeo = new THREE.SphereGeometry(1, 24, 16);
  eyeGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(eyeSeed, 1));
  const eyes = new THREE.InstancedMesh(eyeGeo, new THREE.ShaderMaterial({
    uniforms: { time: U.time },
    vertexShader: /* glsl */`
      attribute float aSeed; varying vec3 vN, vC; varying float vSeed;
      void main() {
        mat4 m = modelMatrix * instanceMatrix;
        vC = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vN = normalize(mat3(m) * normal);
        vSeed = aSeed;
        gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float time; varying vec3 vN, vC; varying float vSeed;
      void main() {
        vec3 n = normalize(vN), f = normalize(cameraPosition - vC);
        vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f)), u = cross(f, r);
        float d = dot(n, f);
        // 眨眼：每只眼睛自己的节奏
        float ph = fract(time * (0.18 + vSeed * 0.2) + vSeed * 7.0);
        float open = 1.0 - smoothstep(0.0, 0.03, ph) * (1.0 - smoothstep(0.03, 0.07, ph));
        vec3 c = mix(vec3(0.82, 0.8, 0.78), vec3(1.0), smoothstep(0.0, 0.6, d));
        float iris = smoothstep(0.86, 0.875, d), pupil = smoothstep(0.955, 0.962, d);
        c = mix(c, mix(vec3(0.85, 0.55, 0.12), vec3(0.98, 0.8, 0.3), smoothstep(0.86, 0.95, d)), iris);
        c = mix(c, vec3(0.03), pupil);
        float hl = smoothstep(0.985, 0.99, dot(n, normalize(f + r * 0.25 + u * 0.3)));
        c = mix(c, vec3(1.0), hl);
        float lid = abs(dot(n, u));
        if (lid > open * 0.92 + 0.04 && d > -0.3) c = vec3(0.98, 0.86, 0.35) * (0.85 + 0.15 * d);
        c = mix(vec3(0.08, 0.06, 0.05), c, smoothstep(0.08, 0.22, d + 0.2));   // 描边
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }), EYES);
  eyes.frustumCulled = false;
  eyes.visible = false;
  scene.add(eyes);
  function updateAngel(dt, t) {
    angel += (angelTarget - angel) * Math.min(1, dt * (angelTarget ? 1.6 : 3));
    const k = angel < 0.001 ? 0 : angel;
    angelG.visible = eyes.visible = k > 0.001;
    if (!angelG.visible) return;
    const pop = k * (1 + Math.sin(Math.min(1, k) * Math.PI) * 0.25);
    angelG.position.set(0, 2.6 + body.position.y, 0).add(off);
    // 翅膀和眼轮整体朝着你（只转水平方向）
    _a.subVectors(camera.position, yellow.position);
    angelG.rotation.y = Math.atan2(_a.x, _a.z);
    for (const w of wings) {
      w.pivot.scale.set(w.side * pop, pop, pop);
      w.pivot.rotation.y = -w.side * (0.35 + Math.sin(t * 2.4 + w.pair * 0.9) * 0.38);
    }
    for (const r of rings) {
      r.rotateOnAxis(r.userData.axis, r.userData.w * dt);
      r.scale.setScalar(pop);
    }
    angelG.updateMatrixWorld(true);
    let e = 0;
    for (const r of rings) {
      for (let j = 0; j < r.userData.n; j++) {
        const a = (j / r.userData.n) * Math.PI * 2;
        _a.set(Math.cos(a) * r.userData.R, Math.sin(a) * r.userData.R, 0).applyMatrix4(r.matrixWorld);
        eyes.setMatrixAt(e++, _m.compose(_a, _q.identity(), _s.setScalar(0.42 * pop)));
      }
    }
    body.updateMatrixWorld(true);
    for (const [x, y] of BODY_EYES) {
      _a.set(x, y, x ? 0.55 + 0.88 : 0.48).applyMatrix4(body.matrixWorld);
      eyes.setMatrixAt(e++, _m.compose(_a, _q.identity(), _s.setScalar(0.27 * pop)));
    }
    eyes.instanceMatrix.needsUpdate = true;
  }

  /* ── 飞升与坠落 ───────────────────────────────────────── */
  const glowTex = ctx.softDisc;
  const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff4c0', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  star.visible = false;
  scene.add(star);
  const trail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 2.6, 1, 24, 1, true).translate(0, 0.5, 0),
    new THREE.ShaderMaterial({
      uniforms: { col: { value: new THREE.Color('#ffb347') }, a: { value: 0 } },
      vertexShader: /* glsl */`
        varying float vH; varying vec3 vN, vV;
        void main() {
          vH = position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 col; uniform float a; varying float vH; varying vec3 vN, vV;
        void main() {
          float e = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
          gl_FragColor = vec4(col * e * (1.0 - vH) * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }),
  );
  trail.visible = false;
  scene.add(trail);
  const FALL_FROM = new THREE.Vector3(40, 70, -260); // 天边那颗星的位置，平视也看得见
  function updateAscension(dt, t) {
    if (!asc) {
      if (bounce >= 0) {
        bounce += dt;
        off.set(0, Math.abs(Math.sin(bounce * 7)) * 2.4 * Math.exp(-bounce * 2.6), 0);
        if (bounce > 2.5) { bounce = -1; off.set(0, 0, 0); }
      }
      return;
    }
    asc.t += dt;
    const T = asc.t;
    star.visible = false;
    trail.visible = false;
    body.visible = true;
    if (T < 1.6) { // 颤抖、发光
      const k = T / 1.6;
      off.set((Math.random() - 0.5) * 0.3 * k, (Math.random() - 0.5) * 0.15 * k, (Math.random() - 0.5) * 0.3 * k);
      U.boost.value = 1 + k * 1.5;
      ctx.fx.shake = Math.max(ctx.fx.shake, 0.08 * k);
    } else if (T < 3.6) { // 顺着天光冲上去
      const k = (T - 1.6) / 2;
      off.set(0, 700 * k * k * k, 0);
      U.boost.value = 2.5 - k;
      trail.visible = true;
      trail.position.set(YPOS.x, body.position.y, YPOS.z);
      trail.quaternion.identity();
      trail.scale.set(1.2, Math.max(1, off.y * 0.8), 1.2);
      trail.material.uniforms.a.value = 0.5 * (1 - k * 0.5);
      trail.material.uniforms.col.value.set('#fff1b8');
    } else if (T < 5.6) { // 变成天顶的一颗星
      off.set(0, 700, 0);
      body.visible = false;
      star.visible = true;
      star.position.copy(YPOS).add(FALL_FROM);
      const s = (9 + Math.sin(T * 9) * 3) * Math.min(1, (T - 3.6) * 2);
      star.scale.set(s, s, 1);
      U.boost.value = 1;
    } else if (T < 6.7) { // 拖着火尾砸下来
      const k = (T - 5.6) / 1.1, e = k * k;
      off.copy(FALL_FROM).multiplyScalar(1 - e);
      trail.visible = true;
      _a.copy(FALL_FROM).normalize();
      trail.position.set(YPOS.x + off.x, off.y + 2.5, YPOS.z + off.z);
      trail.quaternion.setFromUnitVectors(ctx.UP, _a);
      trail.scale.set(2, 90, 2);
      trail.material.uniforms.a.value = 0.9;
      trail.material.uniforms.col.value.set('#ff9a3c');
    } else { // 落地
      asc = null;
      off.set(0, 0, 0);
      bounce = 0;
      ctx.onImpact(_a.set(YPOS.x, 0, YPOS.z));
      calm();
      ctx.say('一切都回来了', 4000);
    }
  }

  /* ── 状态 ─────────────────────────────────────────────── */
  function calm() {
    stage = 0;
    angelTarget = 0;
    U.dark.value = 0; U.swirl.value = 0; U.boost.value = 1;
    for (const c of clones) if (!c.state) { c.state = 'home'; c.home = 0; }
  }
  function enterStage(s) {
    stage = s;
    ctx.say(SAY[s], 4000);
    kick(2.5);
    if (s === 4) angelTarget = 1;
    if (s === 5) asc = { t: 0 };
  }
  function kick(a) { wobV += a * 5; }

  let spawnT = 0;
  function update(dt, t, percent, enabled) {
    if (enabled && !asc) while (stage < 5 && percent >= STAGES[stage]) enterStage(stage + 1);
    // 果冻：一个带阻尼的弹簧，被舔、被弹开都会踢它一脚
    wobV += (-170 * wob - 5 * wobV) * dt;
    wob += wobV * dt;
    base += ((stage >= 1 ? 0.6 : 0) - base) * Math.min(1, dt * 2);
    const sq = wob * 0.1 + base * 0.08 * Math.sin(t * 13);
    body.scale.set(1 + sq, 1 - sq * 1.25, 1 + sq);
    body.rotation.z = wob * 0.05 + base * 0.07 * Math.sin(t * 9 + 1);
    body.rotation.x = wob * 0.03 + base * 0.05 * Math.sin(t * 7.3);
    // 陀螺
    const wantRate = stage === 2 || stage === 3 ? 9 : stage === 4 ? 0.6 : 0;
    spinRate += (wantRate - spinRate) * Math.min(1, dt * 0.8);
    if (stage === 0 && spinRate < 0.05) {
      const target = Math.round(spinX / (Math.PI * 2)) * Math.PI * 2;
      spinX += (target - spinX) * Math.min(1, dt * 2);
    } else spinX += spinRate * dt;
    body.rotation.y += spinX;
    orbit += ((stage >= 2 && stage <= 3 ? 1 : 0) - orbit) * Math.min(1, dt * 1.5);
    if (orbit > 0.001) {
      const a = t * 4;
      _a.set(Math.cos(a) * 3.4, headLocal.y - 0.8 + Math.sin(a * 2) * 0.6, Math.sin(a) * 3.4);
      halo.position.lerp(_a, orbit);
    }
    U.swirl.value += ((stage >= 2 ? 1 : 0) - U.swirl.value) * Math.min(1, dt);
    U.dark.value += ((stage === 4 ? 0.55 : 0) - U.dark.value) * Math.min(1, dt * 0.8);
    // 分裂
    if (stage >= 3 && stage < 5 && enabled) {
      spawnT -= dt;
      if (spawnT <= 0 && clones.filter((c) => !c.state).length < 24) { spawnClone(); kick(1); spawnT = 1.1; }
    }
    updateClones(dt, t);
    updateAscension(dt, t);
    body.position.add(off);
    updateAngel(dt, t);
  }

  function reset() {
    asc = null; bounce = -1; off.set(0, 0, 0);
    star.visible = trail.visible = false;
    body.visible = true;
    calm();
  }

  return {
    update, reset, kick, clones,
    force(s) { while (stage < s) enterStage(stage + 1); }, // 调试用：直接跳到某一级
    get stage() { return stage; },
    get busy() { return !!asc; },
    // 天使形态时，没被舔掉的字绕着它转
    orbitPos(i, n, t, out) {
      const a = t * 0.35 + (i / n) * Math.PI * 2;
      return out.set(YPOS.x + Math.cos(a) * 9, 13 + Math.sin(a * 2 + i) * 2 + body.position.y, YPOS.z + Math.sin(a) * 9);
    },
    get angel() { return angel; },
  };
}
