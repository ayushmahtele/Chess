// Interactive 3D board for the sign-in page: "The Immortal Game" (Anderssen vs Kieseritzky, London 1851).
// Shows the famous final combination 22.Qf6+ Nxf6 23.Be7# on a loop. Drag to rotate, scroll/pinch to zoom.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Position before 22.Qf6+ (same as the classic diagram)
const START = {
  a8: 'br', c8: 'bb', d8: 'bk', g8: 'bn', h8: 'br',
  a7: 'bp', d7: 'bp', f7: 'bp', g7: 'wn', h7: 'bp',
  a6: 'bn', d6: 'wb',
  b5: 'bp', d5: 'wn', e5: 'wp', h5: 'wp',
  g4: 'wp',
  d3: 'wp', f3: 'wq',
  a2: 'wp', c2: 'wp', e2: 'wk',
  a1: 'bq', g1: 'bb',
};
const FINISH = [['f3', 'f6'], ['g8', 'f6'], ['d6', 'e7']];   // Qf6+  Nxf6  Be7#
const MATED_KING = 'd8';

const sqPos = sq => new THREE.Vector3('abcdefgh'.indexOf(sq[0]) - 3.5, 0, 3.5 - (+sq[1] - 1));

/* ---------------- materials ---------------- */
function woodTexture(base, grain, seed = 1, size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 140; i++) {
    const y = rnd() * size, amp = 3 + rnd() * 10, freq = 0.004 + rnd() * 0.01, w = 0.6 + rnd() * 2.2;
    g.strokeStyle = grain; g.globalAlpha = 0.06 + rnd() * 0.16; g.lineWidth = w;
    g.beginPath();
    for (let x = 0; x <= size; x += 8) g.lineTo(x, y + Math.sin(x * freq + i) * amp);
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

/* ---------------- turned pieces ---------------- */
const V = (r, y) => new THREE.Vector2(r, y);
function base(r = 0.36) {
  return [V(0, 0), V(r, 0), V(r, 0.05), V(r - 0.02, 0.07), V(r - 0.02, 0.1), V(r - 0.06, 0.13), V(r - 0.1, 0.16)];
}
function ball(cx, cy, r, from = -Math.PI / 2, to = Math.PI / 2, n = 10) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = from + (to - from) * i / n; pts.push(V(Math.max(0.0001, cx + Math.cos(a) * r), cy + Math.sin(a) * r)); }
  return pts;
}
const PROFILES = {
  p: () => [...base(0.3), V(0.17, 0.2), V(0.12, 0.3), V(0.1, 0.38), V(0.17, 0.4), V(0.17, 0.43), V(0.09, 0.45), ...ball(0, 0.56, 0.13, -Math.PI / 2.6, Math.PI / 2)],
  r: () => [...base(0.34), V(0.22, 0.22), V(0.18, 0.36), V(0.17, 0.5), V(0.23, 0.53), V(0.23, 0.58), V(0.25, 0.6), V(0.25, 0.72), V(0.19, 0.72), V(0.19, 0.66), V(0, 0.66)],
  b: () => [...base(0.32), V(0.18, 0.22), V(0.12, 0.38), V(0.1, 0.52), V(0.18, 0.55), V(0.18, 0.58), V(0.1, 0.6), V(0.14, 0.66), V(0.16, 0.74), V(0.13, 0.82), V(0.07, 0.89), V(0.03, 0.92), ...ball(0, 0.96, 0.045, -Math.PI / 2, Math.PI / 2, 6)],
  q: () => [...base(0.37), V(0.22, 0.24), V(0.15, 0.45), V(0.12, 0.66), V(0.21, 0.69), V(0.21, 0.72), V(0.13, 0.74), V(0.16, 0.86), V(0.22, 0.97), V(0.19, 0.99), V(0.08, 0.96), V(0, 0.98)],
  k: () => [...base(0.38), V(0.23, 0.24), V(0.16, 0.46), V(0.13, 0.7), V(0.22, 0.73), V(0.22, 0.76), V(0.14, 0.78), V(0.17, 0.9), V(0.21, 1.0), V(0.17, 1.04), V(0, 1.05)],
  n: () => [...base(0.34), V(0.22, 0.22), V(0.2, 0.28), V(0, 0.28)],
};

function knightHead() {
  const s = new THREE.Shape();
  s.moveTo(-0.17, 0); s.lineTo(0.2, 0);
  s.bezierCurveTo(0.22, 0.18, 0.12, 0.3, 0.16, 0.42);   // chest
  s.bezierCurveTo(0.2, 0.5, 0.3, 0.5, 0.32, 0.43);       // muzzle bottom
  s.bezierCurveTo(0.36, 0.5, 0.3, 0.62, 0.2, 0.66);      // nose
  s.bezierCurveTo(0.12, 0.72, 0.06, 0.74, 0.02, 0.78);   // forehead
  s.lineTo(-0.02, 0.85); s.lineTo(-0.07, 0.76);          // ear
  s.bezierCurveTo(-0.2, 0.7, -0.24, 0.5, -0.2, 0.3);     // mane
  s.bezierCurveTo(-0.18, 0.18, -0.2, 0.08, -0.17, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.04, bevelSegments: 5, curveSegments: 18 });
  g.translate(0, 0, -0.08);
  return g;
}

function makePiece(code, mats) {
  const color = code[0], type = code[1];
  const mat = color === 'w' ? mats.white : mats.black;
  const group = new THREE.Group();
  const add = (geo, m = mat) => { const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh; };
  add(new THREE.LatheGeometry(PROFILES[type](), 40));
  if (type === 'n') {
    const head = add(knightHead()); head.position.y = 0.26;
    head.rotation.y = color === 'w' ? Math.PI / 2 - 0.75 : -Math.PI / 2 + 0.75;   // face the opponent, turned so the profile shows
  }
  if (type === 'r') {           // crenellations
    for (let i = 0; i < 6; i++) {
      const m = add(new THREE.BoxGeometry(0.1, 0.09, 0.07));
      const a = i / 6 * Math.PI * 2; m.position.set(Math.cos(a) * 0.21, 0.765, Math.sin(a) * 0.21); m.rotation.y = -a;
    }
  }
  if (type === 'q') {           // crown points
    for (let i = 0; i < 8; i++) {
      const m = add(new THREE.SphereGeometry(0.032, 12, 8));
      const a = i / 8 * Math.PI * 2; m.position.set(Math.cos(a) * 0.2, 1.0, Math.sin(a) * 0.2);
    }
    add(new THREE.SphereGeometry(0.05, 16, 12)).position.y = 1.02;
  }
  if (type === 'k') {           // cross
    add(new THREE.BoxGeometry(0.06, 0.2, 0.06)).position.y = 1.15;
    add(new THREE.BoxGeometry(0.16, 0.055, 0.06)).position.y = 1.17;
  }
  group.userData = { code };
  return group;
}

/* ---------------- scene ---------------- */
export function mountImmortal(container, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 8.6, 10.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0.2);
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 7; controls.maxDistance = 19;
  controls.minPolarAngle = 0.15; controls.maxPolarAngle = 1.36;
  controls.autoRotate = !reducedMotion; controls.autoRotateSpeed = 0.55;
  controls.rotateSpeed = 0.7;
  let resumeTimer;
  controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(resumeTimer); container.classList.add('touched'); });
  controls.addEventListener('end', () => { clearTimeout(resumeTimer); if (!reducedMotion) resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 5000); });

  // lights
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x2a2018, 0.55));
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
  sun.position.set(-5, 11, 6); sun.castShadow = true;
  const sm = window.innerWidth < 700 ? 1024 : 2048;
  sun.shadow.mapSize.set(sm, sm); sun.shadow.camera.left = -7; sun.shadow.camera.right = 7; sun.shadow.camera.top = 7; sun.shadow.camera.bottom = -7;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xbcd2ff, 0.6); rim.position.set(6, 5, -7); scene.add(rim);

  // board
  const lightWood = woodTexture('#e8cfa6', '#a0784c', 7), darkWood = woodTexture('#8a5634', '#3e2213', 11), frameWood = woodTexture('#4a2a17', '#1d0f07', 5);
  const lightMat = new THREE.MeshStandardMaterial({ map: lightWood, roughness: 0.45, metalness: 0 });
  const darkMat = new THREE.MeshStandardMaterial({ map: darkWood, roughness: 0.42, metalness: 0 });
  const frameMat = new THREE.MeshStandardMaterial({ map: frameWood, roughness: 0.38 });
  const board = new THREE.Group(); scene.add(board);
  const sqGeo = new THREE.BoxGeometry(1, 0.12, 1);
  for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) {
    const m = new THREE.Mesh(sqGeo, (f + r) % 2 ? lightMat : darkMat);
    m.position.set(f - 3.5, -0.06, 3.5 - r); m.receiveShadow = true;
    // vary the grain on each square
    m.material = m.material.clone(); m.material.map = m.material.map.clone(); m.material.map.offset.set(Math.random(), Math.random()); m.material.map.rotation = (f * 7 + r) % 2 ? 0 : Math.PI / 2; m.material.map.needsUpdate = true;
    board.add(m);
  }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(9.1, 0.34, 9.1), frameMat);
  frame.position.y = -0.2; frame.receiveShadow = true; frame.castShadow = true; board.add(frame);
  const table = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.ShadowMaterial({ opacity: 0.32 }));
  table.rotation.x = -Math.PI / 2; table.position.y = -0.37; table.receiveShadow = true; scene.add(table);

  // pieces
  const mats = {
    white: new THREE.MeshPhysicalMaterial({ color: 0xf3e7d3, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.25, sheen: 0.2 }),
    black: new THREE.MeshPhysicalMaterial({ color: 0x23180f, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    slit: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }),
  };
  mats.white.color.convertSRGBToLinear?.(); mats.black.color.convertSRGBToLinear?.();
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.62, 48), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.copy(sqPos(MATED_KING)); glow.position.y = 0.006; scene.add(glow);

  let pieces = {};
  function setup() {
    for (const p of Object.values(pieces)) scene.remove(p);
    pieces = {};
    for (const [sq, code] of Object.entries(START)) {
      const p = makePiece(code, mats); p.position.copy(sqPos(sq));
      p.rotation.y = (Math.random() - 0.5) * 0.25;            // pieces never sit perfectly aligned on a real board
      scene.add(p); pieces[sq] = p;
    }
    glow.material.opacity = 0;
  }
  setup();

  // animation timeline for the finishing combination
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  let phase = 0, phaseStart = 0, active = null;
  const STEP = 1.1, PAUSE_BEFORE = 2.6, PAUSE_BETWEEN = 1.0, HOLD = 4.2;
  function startMove(i, now) {
    const [from, to] = FINISH[i];
    const piece = pieces[from], victim = pieces[to];
    active = { piece, victim, from: sqPos(from), to: sqPos(to), start: now, jump: piece.userData.code[1] === 'n' };
    delete pieces[from]; pieces[to] = piece;
  }
  function tick(now) {
    if (reducedMotion) return;
    const t = (now - phaseStart) / 1000;
    if (phase === 0 && t > PAUSE_BEFORE) { phase = 1; startMove(0, now); }
    else if (phase >= 1 && phase <= 3 && active) {
      const k = Math.min(1, (now - active.start) / 1000 / STEP), e = ease(k);
      active.piece.position.lerpVectors(active.from, active.to, e);
      active.piece.position.y = (active.jump ? 0.9 : 0.35) * Math.sin(Math.PI * e);
      if (active.victim) {
        const v = Math.max(0, (k - 0.55) / 0.45);
        active.victim.scale.setScalar(1 - v * 0.9); active.victim.position.y = -v * 0.3;
        if (v >= 1) { scene.remove(active.victim); active.victim = null; }
      }
      if (k >= 1) {
        active.piece.position.y = 0; active = null;
        if (phase < 3) { phaseStart = now; phase += 0.5; }       // short pause before the next move
        else { phase = 4; phaseStart = now; }
      }
    } else if (phase % 1 === 0.5 && t > PAUSE_BETWEEN) { phase += 0.5; startMove(phase - 1, now); }
    else if (phase === 4) {
      glow.material.opacity = 0.55 + 0.25 * Math.sin(t * 5);   // checkmate!
      const king = pieces[MATED_KING]; if (king) king.rotation.z = Math.min(0.3, t * 0.5);   // the king topples
      if (t > HOLD) { phase = 5; phaseStart = now; }
    } else if (phase === 5) {
      const f = Math.min(1, t / 0.6);
      glow.material.opacity = 0.55 * (1 - f);
      for (const p of Object.values(pieces)) p.scale.setScalar(1 - f * 0.999);
      if (f >= 1) { setup(); for (const p of Object.values(pieces)) p.scale.setScalar(0.001); phase = 6; phaseStart = now; }
    } else if (phase === 6) {
      const f = Math.min(1, t / 0.6);
      for (const p of Object.values(pieces)) p.scale.setScalar(Math.max(0.001, ease(f)));
      if (f >= 1) { phase = 0; phaseStart = now; }
    }
  }

  // sizing
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the whole board in view on narrow/tall screens
    camera.fov = w / h < 0.9 ? 44 : w / h < 1.2 ? 38 : 34;
    camera.updateProjectionMatrix();
    // back the camera off until the whole board (with frame) fits the width
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const fit = Math.max(12.4, 5.3 / Math.tan(hfov / 2));
    controls.minDistance = Math.min(7, fit * 0.6); controls.maxDistance = Math.max(19, fit * 1.5);
    if (!container.classList.contains('touched')) {
      const dir = camera.position.clone().sub(controls.target).normalize();
      camera.position.copy(controls.target).addScaledVector(dir, fit);
    }
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  // render loop (pauses when the tab or the canvas is not visible)
  let raf = 0, visible = true, running = true;
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; });
  io.observe(container);
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    if (!phaseStart) phaseStart = now;
    tick(now);
    controls.update();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);
  if (reducedMotion) {                // show the final, mated position without animation
    for (const [from, to] of FINISH) { const p = pieces[from], v = pieces[to]; if (v) scene.remove(v); p.position.copy(sqPos(to)); pieces[to] = p; delete pieces[from]; }
    glow.material.opacity = 0.6;
  }

  return function destroy() {
    if (!running) return; running = false;
    cancelAnimationFrame(raf); clearTimeout(resumeTimer); ro.disconnect(); io.disconnect(); controls.dispose();
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map?.dispose(); m.dispose(); }); } });
    env.dispose(); pmrem.dispose(); renderer.dispose(); renderer.domElement.remove();
  };
}
