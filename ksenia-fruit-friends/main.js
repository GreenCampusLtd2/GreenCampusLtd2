/*
Ksenia's Fruit Friends
A tiny 3D walking game using Three.js. Collect fruit/veggies for points.
Press F near an animal to feed it from your bag for super points; fed animals
become friends and follow in a long line behind the player.
*/

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// World configuration constants
const WORLD_SIZE = 220; // square world side length
const HALF_WORLD = WORLD_SIZE / 2;
const PLAYER_HEIGHT = 0.9;
const PLAYER_MOVE_SPEED = 7.0; // units per second
const PLAYER_TURN_LERP = 0.15;
const RIVER_WIDTH = 5.0; // half width either side of centerline
const RIVER_AMPLITUDE = 12.0; // curve amplitude
const RIVER_FREQ = 0.05; // curve frequency

// Scoring and game mechanics
const POINTS_PER_PICKUP = 1;
const POINTS_PER_FEED = 5;
const FEED_DISTANCE = 2.6;
const TRAIL_POINT_SPACING_MS = 60; // how often to record the player's trail
const FRIEND_SPACING_POINTS = 9; // how many trail points between friends

// State variables
let score = 0;
let foodInBag = 0;
const friends = []; // animals following the player (in order)

// DOM references
const scoreEl = document.getElementById('score');
const bagEl = document.getElementById('bag');
const friendsEl = document.getElementById('friends');

// Three.js essentials
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87d7a4);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

document.body.appendChild(renderer.domElement);

// Lighting to feel like a cheerful day
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 1.1);
sunLight.position.set(10, 20, 5);
scene.add(sunLight);

// Utility random helpers
function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// River math: centerline z(x) and predicate to check if a point is water
function riverCenterZ(x) {
  return Math.sin(x * RIVER_FREQ) * RIVER_AMPLITUDE;
}

function isInRiver(x, z) {
  const dz = Math.abs(z - riverCenterZ(x));
  return dz <= RIVER_WIDTH;
}

// Ground
function buildGround() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0x5fb55e })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

// River: build as many short quads along x; simple and cheap
function buildRiver() {
  const riverGroup = new THREE.Group();
  const material = new THREE.MeshPhongMaterial({ color: 0x54b2f0, transparent: true, opacity: 0.55, shininess: 80 });

  const segments = 140;
  const xMin = -HALF_WORLD;
  const xMax = HALF_WORLD;
  const step = (xMax - xMin) / segments;

  for (let i = 0; i < segments; i++) {
    const x0 = xMin + i * step;
    const x1 = x0 + step + 0.001;
    const z0 = riverCenterZ(x0);
    const z1 = riverCenterZ(x1);

    const quad = new THREE.BufferGeometry();
    const hw = RIVER_WIDTH;
    const vertices = new Float32Array([
      x0, 0.01, z0 - hw,
      x1, 0.01, z1 - hw,
      x1, 0.01, z1 + hw,
      x0, 0.01, z0 + hw,
    ]);
    const indices = [0, 1, 2, 0, 2, 3];
    quad.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    quad.setIndex(indices);
    quad.computeVertexNormals();

    const mesh = new THREE.Mesh(quad, material);
    riverGroup.add(mesh);
  }
  scene.add(riverGroup);
}

// Decorative trees and bushes
function createTree(x, z) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.35, 2, 8),
    new THREE.MeshStandardMaterial({ color: 0x8d5a3b, roughness: 0.9 })
  );
  trunk.position.set(x, 1, z);

  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x3e8e41, roughness: 0.8 })
  );
  crown.position.set(x, 2.4, z);

  scene.add(trunk);
  scene.add(crown);
}

function createBush(x, z) {
  const bush = new THREE.Mesh(
    new THREE.SphereGeometry(randomRange(0.5, 0.9), 10, 10),
    new THREE.MeshLambertMaterial({ color: 0x2f7d3b })
  );
  bush.position.set(x, bush.geometry.parameters.radius, z);
  scene.add(bush);
}

function scatterFoliage() {
  for (let i = 0; i < 35; i++) {
    const x = randomRange(-HALF_WORLD + 10, HALF_WORLD - 10);
    const z = randomRange(-HALF_WORLD + 10, HALF_WORLD - 10);
    if (isInRiver(x, z)) continue;
    createTree(x, z);
  }
  for (let i = 0; i < 40; i++) {
    const x = randomRange(-HALF_WORLD + 5, HALF_WORLD - 5);
    const z = randomRange(-HALF_WORLD + 5, HALF_WORLD - 5);
    if (isInRiver(x, z)) continue;
    createBush(x, z);
  }
}

// Produce and animals
const produceMeshes = [];
const animals = [];

const PRODUCE_DEFS = [
  { name: 'Apple', color: 0xff4d4d },
  { name: 'Banana', color: 0xffe066 },
  { name: 'Carrot', color: 0xff8c42 },
  { name: 'Tomato', color: 0xe34234 },
  { name: 'Blueberry', color: 0x5465ff },
  { name: 'Broccoli', color: 0x4caf50 },
  { name: 'Seaweed', color: 0x2f8e48, waterOnly: true },
];

function createProduceMesh(def) {
  const radius = def.name === 'Banana' ? 0.35 : 0.4;
  const geometry = new THREE.SphereGeometry(radius, 12, 12);
  const material = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5, metalness: 0.0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = { isProduce: true, def };
  mesh.castShadow = true;
  return mesh;
}

function scatterProduce() {
  const total = 120;
  for (let i = 0; i < total; i++) {
    const def = PRODUCE_DEFS[Math.floor(Math.random() * PRODUCE_DEFS.length)];
    let x, z;
    let tries = 0;
    while (true) {
      tries++;
      x = randomRange(-HALF_WORLD + 6, HALF_WORLD - 6);
      z = randomRange(-HALF_WORLD + 6, HALF_WORLD - 6);
      const water = isInRiver(x, z);
      if (def.waterOnly ? water : !water) break;
      if (tries > 50) break;
    }
    const mesh = createProduceMesh(def);
    mesh.position.set(x, 0.4, z);
    scene.add(mesh);
    produceMeshes.push(mesh);
  }
}

function createSeaweedPatch(x, z) {
  const count = 5 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++) {
    const h = randomRange(0.8, 1.6);
    const geo = new THREE.CylinderGeometry(0.05, 0.05, h, 6);
    const mat = new THREE.MeshLambertMaterial({ color: 0x208f4f });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x + randomRange(-0.6, 0.6), h / 2 + 0.01, z + randomRange(-0.6, 0.6));
    scene.add(m);
  }
}

function scatterSeaweed() {
  const patches = 30;
  for (let i = 0; i < patches; i++) {
    const x = randomRange(-HALF_WORLD + 8, HALF_WORLD - 8);
    const z = riverCenterZ(x) + randomRange(-RIVER_WIDTH * 0.6, RIVER_WIDTH * 0.6);
    createSeaweedPatch(x, z);
  }
}

function createAnimal() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffdd99 })
  );
  body.castShadow = true;
  body.position.y = 0.5;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffcc88 })
  );
  head.position.set(0, 0.8, 0.4);
  group.add(head);

  group.position.set(randomRange(-HALF_WORLD + 5, HALF_WORLD - 5), 0, randomRange(-HALF_WORLD + 5, HALF_WORLD - 5));
  group.userData = {
    isAnimal: true,
    isFriend: false,
    velocity: new THREE.Vector3(randomRange(-1, 1), 0, randomRange(-1, 1)).normalize().multiplyScalar(2.2),
    friendIndex: -1,
  };

  scene.add(group);
  animals.push(group);
}

function scatterAnimals() {
  for (let i = 0; i < 15; i++) createAnimal();
}

// Player character: a friendly body with a face plane sprite
const player = new THREE.Group();

const playerBody = new THREE.Mesh(
  new THREE.SphereGeometry(0.7, 18, 18),
  new THREE.MeshStandardMaterial({ color: 0xfff0d0, roughness: 0.7 })
);
playerBody.position.y = PLAYER_HEIGHT;
player.add(playerBody);

function makeFallbackFaceTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffe4cf';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(88, 110, 16, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(168, 110, 16, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(128, 170, 45, 0, Math.PI); ctx.stroke();
  return new THREE.CanvasTexture(canvas);
}

function addFaceSprite() {
  const textureLoader = new THREE.TextureLoader();
  textureLoader.load(
    './assets/ksenia.png',
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(1.3, 1.3, 1.3);
      sprite.position.set(0, PLAYER_HEIGHT + 0.05, 0.7);
      sprite.userData.billboard = true;
      player.add(sprite);
    },
    undefined,
    () => {
      const tex = makeFallbackFaceTexture();
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(1.3, 1.3, 1.3);
      sprite.position.set(0, PLAYER_HEIGHT + 0.05, 0.7);
      sprite.userData.billboard = true;
      player.add(sprite);
    }
  );
}

addFaceSprite();

player.position.set(0, 0, 0);
scene.add(player);

// Camera follows from slightly above and behind
camera.position.set(0, 5, 8);

// Controls
const keysDown = new Set();
window.addEventListener('keydown', (e) => {
  keysDown.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === 'f') tryFeedNearestAnimal();
});
window.addEventListener('keyup', (e) => keysDown.delete(e.key.toLowerCase()));

function getMoveVector() {
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0; forward.normalize();
  right.copy(forward).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

  const move = new THREE.Vector3();
  if (keysDown.has('w')) move.add(forward);
  if (keysDown.has('s')) move.add(forward.clone().multiplyScalar(-1));
  if (keysDown.has('a')) move.add(right.clone().multiplyScalar(-1));
  if (keysDown.has('d')) move.add(right);
  return move.normalize();
}

// Player trail for friend following
const trail = [];
let lastTrailTime = 0;
function recordTrailPoint(timeMs) {
  if (timeMs - lastTrailTime < TRAIL_POINT_SPACING_MS) return;
  lastTrailTime = timeMs;
  trail.unshift(player.position.clone());
  const maxPoints = (friends.length + 1) * (FRIEND_SPACING_POINTS + 2) + 200;
  if (trail.length > maxPoints) trail.length = maxPoints;
}

function updateCameraFollow() {
  const desired = player.position.clone()
    .add(new THREE.Vector3(0, 5.5, 9).applyAxisAngle(new THREE.Vector3(0,1,0), player.rotation.y));
  camera.position.lerp(desired, 0.08);
  camera.lookAt(player.position.clone().add(new THREE.Vector3(0, 1.0, 0)));
}

function updatePlayer(dt) {
  const move = getMoveVector();
  if (move.lengthSq() > 0) {
    player.position.add(move.multiplyScalar(PLAYER_MOVE_SPEED * dt));
    const desiredYaw = Math.atan2(move.x, move.z);
    const currentYaw = player.rotation.y;
    let delta = desiredYaw - currentYaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    player.rotation.y = currentYaw + delta * PLAYER_TURN_LERP;
  }
  player.position.x = clamp(player.position.x, -HALF_WORLD + 2, HALF_WORLD - 2);
  player.position.z = clamp(player.position.z, -HALF_WORLD + 2, HALF_WORLD - 2);
}

function updateAnimals(dt) {
  for (const animal of animals) {
    const data = animal.userData;
    if (data.isFriend) {
      const idx = (data.friendIndex + 1) * FRIEND_SPACING_POINTS;
      const target = trail[Math.min(idx, trail.length - 1)];
      if (target) {
        const to = target.clone().sub(animal.position);
        to.y = 0;
        const distance = to.length();
        if (distance > 0.001) {
          to.normalize();
          const speed = 4.0 + 0.6 * data.friendIndex;
          animal.position.add(to.multiplyScalar(Math.min(speed * dt, distance)));
          const yaw = Math.atan2(to.x, to.z);
          animal.rotation.y = THREE.MathUtils.lerp(animal.rotation.y, yaw, 0.2);
        }
      }
    } else {
      animal.position.add(data.velocity.clone().multiplyScalar(dt));
      if (animal.position.x < -HALF_WORLD + 2 || animal.position.x > HALF_WORLD - 2) data.velocity.x *= -1;
      if (animal.position.z < -HALF_WORLD + 2 || animal.position.z > HALF_WORLD - 2) data.velocity.z *= -1;
      if (Math.random() < 0.01) data.velocity.applyAxisAngle(new THREE.Vector3(0,1,0), randomRange(-0.5, 0.5));
      const dirYaw = Math.atan2(data.velocity.x, data.velocity.z);
      animal.rotation.y = THREE.MathUtils.lerp(animal.rotation.y, dirYaw, 0.1);
    }
  }
}

function tryFeedNearestAnimal() {
  if (foodInBag <= 0) return;
  let nearest = null;
  let nearestDist = Infinity;
  for (const animal of animals) {
    if (animal.userData.isFriend) continue;
    const d = animal.position.distanceTo(player.position);
    if (d < nearestDist) { nearest = animal; nearestDist = d; }
  }
  if (nearest && nearestDist <= FEED_DISTANCE) {
    nearest.userData.isFriend = true;
    nearest.userData.friendIndex = friends.length;
    friends.push(nearest);
    foodInBag -= 1;
    score += POINTS_PER_FEED;
    updateUI();
  }
}

function updateUI() {
  scoreEl.textContent = String(score);
  bagEl.textContent = String(foodInBag);
  friendsEl.textContent = String(friends.length);
}

function handleProduceCollection() {
  for (let i = produceMeshes.length - 1; i >= 0; i--) {
    const p = produceMeshes[i];
    if (!p) continue;
    const dist = p.position.distanceTo(player.position);
    if (dist < 1.1) {
      scene.remove(p);
      produceMeshes.splice(i, 1);
      score += POINTS_PER_PICKUP;
      foodInBag += 1;
      updateUI();
    }
  }
}

// Scene assembly
buildGround();
buildRiver();
scatterFoliage();
scatterSeaweed();
scatterProduce();
scatterAnimals();
updateUI();

// Animate
let lastT = performance.now();
function animate() {
  const t = performance.now();
  const dt = Math.min(0.033, (t - lastT) / 1000); // clamp dt for stability
  lastT = t;

  updatePlayer(dt);
  updateAnimals(dt);
  handleProduceCollection();
  updateCameraFollow();
  recordTrailPoint(t);

  // Make any face sprite billboard toward camera
  for (const c of player.children) {
    if (c.userData && c.userData.billboard) c.lookAt(camera.position);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

// Resize handling
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});