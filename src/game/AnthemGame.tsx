import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/**
 * ANTHEM — a semi-open 3D walk through Ayn Rand's novella.
 * Huge map, enterable buildings, gated doors. Each chapter unlocks
 * the next door, so you can wander freely between checkpoints.
 */

type Beat = {
  id: string;
  title: string;
  body: string;
};

const STORY: Beat[] = [
  {
    id: "start",
    title: "I. The Home of the Street Sweepers",
    body:
      "“It is a sin to write this. It is a sin to think words no others think and to put them down upon a paper no others are to see.”\n\nYou are Equality 7-2521. You sleep in a long hall of one hundred beds. Step outside. Find the iron grating beyond the city — there is something the Councils do not wish you to see.",
  },
  {
    id: "tunnel_entry",
    title: "II. The Tunnel from the Unmentionable Times",
    body:
      "An iron grating in the cobbles, half-buried. Below: a tunnel of stone, perfect and forbidden. ‘What is this place?’ you whisper. ‘Why was it built?’ Descend the stair.",
  },
  {
    id: "tunnel_light",
    title: "III. The Power of the Sky",
    body:
      "Wires. Glass. A box that holds lightning torn from the storm. For two years you have worked in secret, and tonight the metal glows — a light without fire, without smoke. You have made it. You alone.",
  },
  {
    id: "field_meet",
    title: "IV. The Golden One",
    body:
      "In the fields beyond the city walks a woman with hair the color of gold. Liberty 5-3000. Your eyes meet, and a law older than the Council is written between you.",
  },
  {
    id: "council",
    title: "V. The World Council of Scholars",
    body:
      "You bring them the light. You expect joy. Instead: terror. ‘How dared you, gutter cleaner!’ You snatch the glass box and run — through the door, into the Uncharted Forest where no man has ever gone.",
  },
  {
    id: "forest",
    title: "VI. The Uncharted Forest",
    body:
      "The trees are old and the silence is older. Liberty 5-3000 has followed. You name her The Golden One; she names you The Unconquered. Beyond the trees: a road of stone.",
  },
  {
    id: "house",
    title: "VII. The House of the Unmentionable Times",
    body:
      "A house of glass and color, made for two — perhaps three. Inside: mirrors, clothes, and books in a tongue you can almost read. You read for days. And then, on a page worn soft by another's hand, you find a word so simple it stops your breath.",
  },
  {
    id: "ego",
    title: "VIII. EGO",
    body:
      "“I am. I think. I will.\n\nMy hands… My spirit… My sky… My forest… This earth of mine….\n\nI stand here on the summit of the mountain. I lift my head and I spread my arms. This, my body and spirit, this is the end of the quest. I am the warrant and the sanction.”\n\n— The sacred word: EGO.",
  },
];

type Interactable = {
  beatId: string;
  position: THREE.Vector3;
  mesh: THREE.Object3D;
  label: string;
  order: number;
};

// A gated door: blocks the player until `unlockAfter` order is reached.
type Gate = {
  unlockAfter: number; // order index that must be completed first
  collider: { box: THREE.Box3 };
  mesh: THREE.Mesh;
  open: boolean;
  label: string;
  position: THREE.Vector3;
};

export default function AnthemGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [locked, setLocked] = useState(false);
  const [activeBeat, setActiveBeat] = useState<Beat | null>(null);
  const [progress, setProgress] = useState(0);
  const [nearby, setNearby] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [objective, setObjective] = useState<string>("Step outside the dormitory");

  const progressRef = useRef(0);
  const activeBeatRef = useRef<Beat | null>(null);

  useEffect(() => {
    if (!started || !mountRef.current) return;

    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8a9bb0);
    scene.fog = new THREE.Fog(0x8a9bb0, 180, 700);

    const camera = new THREE.PerspectiveCamera(
      74,
      mount.clientWidth / mount.clientHeight,
      0.1,
      1500,
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    // ---------- LIGHTING ----------
    scene.add(new THREE.HemisphereLight(0xcfd3dc, 0x2a2a30, 0.95));
    scene.add(new THREE.AmbientLight(0x6a6a70, 0.35));
    const sun = new THREE.DirectionalLight(0xffe8c8, 1.1);
    sun.position.set(140, 220, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -400;
    sun.shadow.camera.right = 400;
    sun.shadow.camera.top = 400;
    sun.shadow.camera.bottom = -400;
    sun.shadow.camera.far = 800;
    scene.add(sun);

    // ---------- GROUND ----------
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshStandardMaterial({ color: 0x3a3631, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ---------- COLLIDERS & HELPERS ----------
    const colliders: { box: THREE.Box3 }[] = [];
    const gates: Gate[] = [];

    const addBlock = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: number,
      opts: { solid?: boolean; emissive?: number; emissiveIntensity?: number; roughness?: number } = {},
    ) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({
          color,
          roughness: opts.roughness ?? 0.85,
          emissive: opts.emissive ?? 0x000000,
          emissiveIntensity: opts.emissive ? (opts.emissiveIntensity ?? 0.6) : 0,
        }),
      );
      mesh.position.set(x, y + h / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      if (opts.solid !== false) {
        const box = new THREE.Box3().setFromObject(mesh).expandByScalar(0.15);
        colliders.push({ box });
      }
      return mesh;
    };

    // A hollow building: 4 walls (with a door gap on one side), floor, roof.
    // Returns interior center for placing things inside.
    const addBuilding = (
      cx: number,
      cz: number,
      w: number,
      h: number,
      d: number,
      wallColor: number,
      doorSide: "south" | "north" | "east" | "west",
      doorWidth: number,
      opts: { interiorColor?: number; roof?: boolean; emissiveWindows?: boolean } = {},
    ) => {
      const t = 0.4; // wall thickness
      // Floor interior tile
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(w - t * 2, d - t * 2),
        new THREE.MeshStandardMaterial({
          color: opts.interiorColor ?? 0x4a4238,
          roughness: 0.9,
        }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(cx, 0.03, cz);
      scene.add(floor);

      // helper to add a wall segment with collider
      const wall = (x: number, z: number, ww: number, hh: number, dd: number) => {
        addBlock(x, 0, z, ww, hh, dd, wallColor, { emissive: opts.emissiveWindows ? 0x1a1408 : 0 });
      };

      // South wall (z = cz + d/2)
      if (doorSide === "south") {
        const sideLen = (w - doorWidth) / 2;
        wall(cx - (doorWidth / 2 + sideLen / 2), cz + d / 2, sideLen, h, t);
        wall(cx + (doorWidth / 2 + sideLen / 2), cz + d / 2, sideLen, h, t);
        // lintel
        addBlock(cx, h - 0.8, cz + d / 2, doorWidth, 1.2, t, wallColor);
      } else {
        wall(cx, cz + d / 2, w, h, t);
      }
      // North wall
      if (doorSide === "north") {
        const sideLen = (w - doorWidth) / 2;
        wall(cx - (doorWidth / 2 + sideLen / 2), cz - d / 2, sideLen, h, t);
        wall(cx + (doorWidth / 2 + sideLen / 2), cz - d / 2, sideLen, h, t);
        addBlock(cx, h - 0.8, cz - d / 2, doorWidth, 1.2, t, wallColor);
      } else {
        wall(cx, cz - d / 2, w, h, t);
      }
      // East wall
      if (doorSide === "east") {
        const sideLen = (d - doorWidth) / 2;
        wall(cx + w / 2, cz - (doorWidth / 2 + sideLen / 2), t, h, sideLen);
        wall(cx + w / 2, cz + (doorWidth / 2 + sideLen / 2), t, h, sideLen);
        addBlock(cx + w / 2, h - 0.8, cz, t, 1.2, doorWidth, wallColor);
      } else {
        wall(cx + w / 2, cz, t, h, d);
      }
      // West wall
      if (doorSide === "west") {
        const sideLen = (d - doorWidth) / 2;
        wall(cx - w / 2, cz - (doorWidth / 2 + sideLen / 2), t, h, sideLen);
        wall(cx - w / 2, cz + (doorWidth / 2 + sideLen / 2), t, h, sideLen);
        addBlock(cx - w / 2, h - 0.8, cz, t, 1.2, doorWidth, wallColor);
      } else {
        wall(cx - w / 2, cz, t, h, d);
      }

      if (opts.roof !== false) {
        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(w + 0.3, 0.4, d + 0.3),
          new THREE.MeshStandardMaterial({ color: 0x1f1c17, roughness: 1 }),
        );
        roof.position.set(cx, h + 0.2, cz);
        scene.add(roof);
      }

      // door position (world coords)
      let doorX = cx, doorZ = cz;
      if (doorSide === "south") doorZ = cz + d / 2;
      if (doorSide === "north") doorZ = cz - d / 2;
      if (doorSide === "east") doorX = cx + w / 2;
      if (doorSide === "west") doorX = cx - w / 2;
      return { doorX, doorZ, cx, cz, w, h, d };
    };

    // A door that blocks the player until a chapter unlocks it.
    const addGate = (
      x: number,
      z: number,
      orient: "ns" | "ew",
      doorWidth: number,
      unlockAfter: number,
      label: string,
    ) => {
      const w = orient === "ns" ? doorWidth : 0.5;
      const d = orient === "ns" ? 0.5 : doorWidth;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, 3.4, d),
        new THREE.MeshStandardMaterial({
          color: 0x4a3a20,
          emissive: 0xff8030,
          emissiveIntensity: 0.5,
          metalness: 0.4,
          roughness: 0.6,
        }),
      );
      mesh.position.set(x, 1.7, z);
      scene.add(mesh);
      const box = new THREE.Box3().setFromObject(mesh).expandByScalar(0.1);
      const collider = { box };
      colliders.push(collider);
      gates.push({ unlockAfter, collider, mesh, open: false, label, position: new THREE.Vector3(x, 1.7, z) });
    };

    // Deterministic RNG
    let rngSeed = 1337;
    const rand = () => {
      rngSeed = (rngSeed * 1664525 + 1013904223) >>> 0;
      return (rngSeed & 0xffffff) / 0xffffff;
    };

    // =========================================================
    // THE CITY — huge dense grid, with corridors carved out
    // =========================================================
    const greys = [0x2a2823, 0x35322c, 0x1f1d18, 0x403c34, 0x282520, 0x312d27];
    const GRID = 9; // 19x19
    for (let i = -GRID; i <= GRID; i++) {
      for (let j = -GRID; j <= GRID; j++) {
        // central plaza
        if (Math.abs(i) <= 1 && Math.abs(j) <= 1) continue;
        // N/S/E/W boulevards
        if (Math.abs(i) <= 1) continue;
        if (Math.abs(j) <= 1) continue;
        // skip slots where story buildings sit
        if (i === -3 && j === -3) continue; // dormitory
        if (i === 5 && j === 0) continue; // (corridor already skipped)
        const x = i * 16 + (rand() - 0.5) * 1.5;
        const z = j * 16 + (rand() - 0.5) * 1.5;
        const w = 9 + rand() * 5;
        const dd = 9 + rand() * 5;
        const h = 11 + rand() * 26;
        const c = greys[Math.floor(rand() * greys.length)];
        addBlock(x, 0, z, w, h, dd, c);
        // rooftop detail
        if (rand() > 0.45) {
          addBlock(x + (rand() - 0.5) * 2, h, z + (rand() - 0.5) * 2, 1.4, 1.8, 1.4, 0x3a342a, { solid: false });
        }
        // lit windows on the side facing nearest boulevard
        if (rand() > 0.4) {
          const winMat = new THREE.MeshStandardMaterial({
            color: 0xffd98a,
            emissive: 0xffc060,
            emissiveIntensity: 1.0,
          });
          const face: "south" | "north" | "east" | "west" =
            j > 0 ? "north" : j < 0 ? "south" : i > 0 ? "west" : "east";
          const cols = 2 + Math.floor(rand() * 3);
          const rows = 3 + Math.floor(rand() * 4);
          for (let a = 0; a < cols; a++) {
            for (let b = 0; b < rows; b++) {
              if (rand() > 0.55) continue;
              const wx = -w / 2 + (a + 0.5) * (w / cols);
              const wy = 2 + (b + 0.5) * ((h - 3) / rows);
              const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.1), winMat);
              if (face === "south") { win.position.set(x + wx, wy, z + dd / 2 + 0.02); }
              else if (face === "north") { win.position.set(x + wx, wy, z - dd / 2 - 0.02); win.rotation.y = Math.PI; }
              else if (face === "east") { win.position.set(x + w / 2 + 0.02, wy, z + wx); win.rotation.y = Math.PI / 2; }
              else { win.position.set(x - w / 2 - 0.02, wy, z + wx); win.rotation.y = -Math.PI / 2; }
              scene.add(win);
            }
          }
        }
      }
    }

    // Street lamps along the four boulevards
    const addLamp = (x: number, z: number) => {
      addBlock(x, 0, z, 0.3, 4.5, 0.3, 0x2a2620, { solid: false });
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffc060, emissiveIntensity: 1.6 }),
      );
      bulb.position.set(x, 4.6, z);
      scene.add(bulb);
      const pl = new THREE.PointLight(0xffd58a, 1.1, 18);
      pl.position.set(x, 4.6, z);
      scene.add(pl);
    };
    for (let k = -GRID; k <= GRID; k++) {
      if (k === 0) continue;
      addLamp(-5, k * 16);
      addLamp(5, k * 16);
      addLamp(k * 16, -5);
      addLamp(k * 16, 5);
    }
    // central plaza fire pit
    const fire = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.4, 0.6, 16),
      new THREE.MeshStandardMaterial({ color: 0xff7733, emissive: 0xff4400, emissiveIntensity: 1.4 }),
    );
    fire.position.set(0, 0.3, 0);
    scene.add(fire);
    const fireLight = new THREE.PointLight(0xff7733, 2.5, 40);
    fireLight.position.set(0, 2, 0);
    scene.add(fireLight);

    // =========================================================
    // 1) HOME OF THE STREET SWEEPERS — enterable dormitory (start)
    // =========================================================
    const dorm = addBuilding(-48, -48, 22, 6.5, 14, 0x2a2520, "north", 3, {
      interiorColor: 0x3a342a,
      emissiveWindows: true,
    });
    // beds inside
    for (let i = 0; i < 5; i++) {
      const bx = -48 - 8 + i * 4;
      addBlock(bx, 0, -52, 2, 0.6, 4, 0x4a3a2a, { solid: false });
      addBlock(bx, 0.6, -53.5, 2, 0.3, 1.2, 0xc8b890, { solid: false });
    }
    // a candle on a small table — the "parchment" interactable lives here
    const parchmentTable = addBlock(-48, 0, -45, 1.4, 0.8, 1.4, 0x6a5a3a, { solid: false });
    const candle = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xfff0aa, emissive: 0xffcc66, emissiveIntensity: 2.2 }),
    );
    candle.position.set(-48, 1.1, -45);
    scene.add(candle);
    const candleLight = new THREE.PointLight(0xffc060, 1.6, 14);
    candleLight.position.set(-48, 1.6, -45);
    scene.add(candleLight);
    // dim interior fill
    const dormFill = new THREE.PointLight(0xffd58a, 0.6, 22);
    dormFill.position.set(-48, 4, -48);
    scene.add(dormFill);

    // =========================================================
    // 2) IRON GRATING — east edge of city. Opens, then descends.
    // =========================================================
    const GRATE_X = 165, GRATE_Z = 0;
    // stone rim around the grate
    addBlock(GRATE_X - 2.3, 0, GRATE_Z, 0.6, 0.4, 5, 0x3a342a, { solid: false });
    addBlock(GRATE_X + 2.3, 0, GRATE_Z, 0.6, 0.4, 5, 0x3a342a, { solid: false });
    addBlock(GRATE_X, 0, GRATE_Z - 2.3, 5, 0.4, 0.6, 0x3a342a, { solid: false });
    addBlock(GRATE_X, 0, GRATE_Z + 2.3, 5, 0.4, 0.6, 0x3a342a, { solid: false });
    // dark shaft revealed when the grate slides aside
    const shaftHole = new THREE.Mesh(
      new THREE.PlaneGeometry(3.8, 3.8),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    shaftHole.rotation.x = -Math.PI / 2;
    shaftHole.position.set(GRATE_X, 0.04, GRATE_Z);
    scene.add(shaftHole);
    // the grate itself
    const grate = new THREE.Mesh(
      new THREE.BoxGeometry(4, 0.18, 4),
      new THREE.MeshStandardMaterial({
        color: 0x3a3228, metalness: 0.7, roughness: 0.4,
        emissive: 0x2a1a08, emissiveIntensity: 0.6,
      }),
    );
    grate.position.set(GRATE_X, 0.1, GRATE_Z);
    scene.add(grate);
    let grateOpen = false;
    let grateSlideT = 0;
    // beacon above
    const grateBeacon = new THREE.PointLight(0xff9050, 2.5, 60);
    grateBeacon.position.set(GRATE_X, 6, GRATE_Z);
    scene.add(grateBeacon);

    // =========================================================
    // 2b) THE UNDERGROUND — a hidden network at a distant X offset
    // =========================================================
    const UG_OX = 3000;
    const undergroundGroup = new THREE.Group();
    scene.add(undergroundGroup);
    const undergroundColliders: { box: THREE.Box3 }[] = [];

    const ugAddCollider = (mesh: THREE.Mesh) => {
      undergroundColliders.push({ box: new THREE.Box3().setFromObject(mesh).expandByScalar(0.15) });
    };

    // Build a corridor between two underground-local points, with rails + ties + lanterns.
    const buildCorridor = (
      x1: number, z1: number, x2: number, z2: number,
      width = 6, height = 5,
    ) => {
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      const angle = Math.atan2(dz, dx);
      const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      // Floor
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(len, width),
        new THREE.MeshStandardMaterial({ color: 0x14110c, roughness: 1 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.rotation.z = -angle;
      floor.position.set(UG_OX + cx, 0.02, cz);
      undergroundGroup.add(floor);
      // Ceiling
      const ceil = new THREE.Mesh(
        new THREE.PlaneGeometry(len, width),
        new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 1, side: THREE.DoubleSide }),
      );
      ceil.rotation.x = Math.PI / 2;
      ceil.rotation.z = angle;
      ceil.position.set(UG_OX + cx, height, cz);
      undergroundGroup.add(ceil);
      // Two walls
      const nx = -Math.sin(angle), nz = Math.cos(angle);
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 1 });
      for (const side of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(len, height, 0.3), wallMat);
        wall.position.set(UG_OX + cx + nx * (width / 2) * side, height / 2, cz + nz * (width / 2) * side);
        wall.rotation.y = -angle;
        undergroundGroup.add(wall);
        ugAddCollider(wall);
      }
      // Rails (two parallel)
      const railMat = new THREE.MeshStandardMaterial({
        color: 0x6a5a48, metalness: 0.85, roughness: 0.35,
        emissive: 0x1a1208, emissiveIntensity: 0.3,
      });
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.12), railMat);
        rail.position.set(UG_OX + cx + nx * 0.6 * side, 0.1, cz + nz * 0.6 * side);
        rail.rotation.y = -angle;
        undergroundGroup.add(rail);
      }
      // Wooden ties across the rails
      const tieMat = new THREE.MeshStandardMaterial({ color: 0x2a1e12, roughness: 1 });
      const tieCount = Math.max(2, Math.floor(len / 1.6));
      for (let i = 0; i < tieCount; i++) {
        const tx = -len / 2 + (i + 0.5) * (len / tieCount);
        const tie = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, Math.min(width - 1, 2.2)), tieMat);
        tie.position.set(UG_OX + cx + Math.cos(angle) * tx, 0.06, cz + Math.sin(angle) * tx);
        tie.rotation.y = -angle;
        undergroundGroup.add(tie);
      }
      // Hanging lanterns
      const lanternCount = Math.max(2, Math.floor(len / 14));
      for (let i = 0; i < lanternCount; i++) {
        const tx = -len / 2 + (i + 0.5) * (len / lanternCount);
        const lx = UG_OX + cx + Math.cos(angle) * tx;
        const lz = cz + Math.sin(angle) * tx;
        const lantern = new THREE.Mesh(
          new THREE.SphereGeometry(0.28, 10, 10),
          new THREE.MeshStandardMaterial({ color: 0xffc060, emissive: 0xffaa44, emissiveIntensity: 2.2 }),
        );
        lantern.position.set(lx, height - 0.5, lz);
        undergroundGroup.add(lantern);
        const pl = new THREE.PointLight(0xffaa55, 1.6, 18);
        pl.position.set(lx, height - 0.5, lz);
        undergroundGroup.add(pl);
      }
    };

    // Junction chamber floor & ceiling
    const junctionFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshStandardMaterial({ color: 0x14110c, roughness: 1 }),
    );
    junctionFloor.rotation.x = -Math.PI / 2;
    junctionFloor.position.set(UG_OX, 0.02, 0);
    undergroundGroup.add(junctionFloor);
    const junctionCeil = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshStandardMaterial({ color: 0x0a0806, side: THREE.DoubleSide }),
    );
    junctionCeil.rotation.x = Math.PI / 2;
    junctionCeil.position.set(UG_OX, 5, 0);
    undergroundGroup.add(junctionCeil);
    // Junction corner walls (filling gaps between the 4 corridor entrances)
    const jwMat = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 1 });
    const jSegs: [number, number, number, number][] = [
      [-5, -7, 4, 0.3], [5, -7, 4, 0.3],
      [-5, 7, 4, 0.3], [5, 7, 4, 0.3],
      [-7, -5, 0.3, 4], [-7, 5, 0.3, 4],
      [7, -5, 0.3, 4], [7, 5, 0.3, 4],
    ];
    for (const [sx, sz, sw, sd] of jSegs) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sw, 5, sd), jwMat);
      m.position.set(UG_OX + sx, 2.5, sz);
      undergroundGroup.add(m);
      ugAddCollider(m);
    }
    // Stair back to the surface — glowing pad at the junction
    const stair = new THREE.Mesh(
      new THREE.BoxGeometry(3, 0.25, 3),
      new THREE.MeshStandardMaterial({ color: 0x6a5a3a, emissive: 0xffc060, emissiveIntensity: 0.9 }),
    );
    stair.position.set(UG_OX, 0.12, 5);
    undergroundGroup.add(stair);
    const stairLight = new THREE.PointLight(0xffd58a, 2.6, 22);
    stairLight.position.set(UG_OX, 4, 5);
    undergroundGroup.add(stairLight);

    // The network — corridors radiate from the junction with branches
    buildCorridor(0, -7, 0, -160, 6, 5);   // main north — leads to the light box
    buildCorridor(0, 7, 0, 80, 6, 5);      // south
    buildCorridor(-7, 0, -140, 0, 6, 5);   // west
    buildCorridor(7, 0, 130, 0, 6, 5);     // east
    // branches
    buildCorridor(0, -80, -90, -80, 5, 5);
    buildCorridor(0, -80, 90, -80, 5, 5);
    buildCorridor(-140, 0, -140, -70, 5, 5);
    buildCorridor(-140, 0, -140, 60, 5, 5);
    buildCorridor(130, 0, 130, 80, 5, 5);
    buildCorridor(0, 80, 60, 80, 5, 5);

    // Dead-end details: broken minecart on rails
    const cart = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.1, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x2a1e12, roughness: 1 }),
    );
    cart.position.set(UG_OX + 60, 0.6, 0);
    undergroundGroup.add(cart);
    ugAddCollider(cart);
    const cart2 = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.1, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x2a1e12, roughness: 1 }),
    );
    cart2.position.set(UG_OX - 90, 0.6, 0);
    cart2.rotation.y = 0.3;
    undergroundGroup.add(cart2);
    ugAddCollider(cart2);
    // glowing crystals scattered in alcoves
    for (let i = 0; i < 40; i++) {
      const c = new THREE.Mesh(
        new THREE.ConeGeometry(0.3, 1.3, 5),
        new THREE.MeshStandardMaterial({ color: 0x88aaff, emissive: 0x4466cc, emissiveIntensity: 1.4 }),
      );
      // place near corridor walls
      const corridorPicks = [
        { x: 0, zMin: -160, zMax: -10, axis: "z" as const },
        { x: 0, zMin: 10, zMax: 80, axis: "z" as const },
        { z: 0, xMin: -140, xMax: -10, axis: "x" as const },
        { z: 0, xMin: 10, xMax: 130, axis: "x" as const },
      ];
      const pick = corridorPicks[i % corridorPicks.length];
      let lx = UG_OX, lz = 0;
      if (pick.axis === "z") {
        lx = UG_OX + (Math.random() < 0.5 ? -2.4 : 2.4);
        lz = pick.zMin + Math.random() * (pick.zMax - pick.zMin);
      } else {
        lx = UG_OX + (pick.xMin + Math.random() * (pick.xMax - pick.xMin));
        lz = Math.random() < 0.5 ? -2.4 : 2.4;
      }
      c.position.set(lx, 0.65, lz);
      c.rotation.z = (Math.random() - 0.5) * 0.4;
      undergroundGroup.add(c);
    }

    // The LIGHT BOX — far end of the north corridor
    const lightBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.9, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xfff8dd, emissive: 0xfff0aa, emissiveIntensity: 2.0 }),
    );
    lightBox.position.set(UG_OX, 1.0, -155);
    undergroundGroup.add(lightBox);
    const lightBoxLight = new THREE.PointLight(0xffeeaa, 4, 60);
    lightBoxLight.position.set(UG_OX, 2, -155);
    undergroundGroup.add(lightBoxLight);
    // small altar under the box
    const lbAltar = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.6, 1.4),
      new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }),
    );
    lbAltar.position.set(UG_OX, 0.3, -155);
    undergroundGroup.add(lbAltar);
    // ambient underground glow
    const ugAmbient = new THREE.AmbientLight(0x2a2018, 0.6);
    undergroundGroup.add(ugAmbient);

    undergroundGroup.visible = false;

    // =========================================================
    // 3) THE FIELD — south, beyond a low wall with a gap
    // =========================================================
    for (let x = -160; x <= 160; x += 4) {
      if (Math.abs(x) < 6) continue;
      addBlock(x, 0, 168, 3.8, 2.6, 1.2, 0x3c362c);
    }
    const fieldMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(380, 280),
      new THREE.MeshStandardMaterial({ color: 0x8a7a3a, roughness: 1 }),
    );
    fieldMesh.rotation.x = -Math.PI / 2;
    fieldMesh.position.set(0, 0.02, 300);
    scene.add(fieldMesh);
    for (let i = 0; i < 500; i++) {
      const tuft = new THREE.Mesh(
        new THREE.ConeGeometry(0.35, 1.3, 5),
        new THREE.MeshStandardMaterial({ color: 0xc8a84a }),
      );
      tuft.position.set((Math.random() - 0.5) * 360, 0.65, 180 + Math.random() * 240);
      scene.add(tuft);
    }
    // Liberty 5-3000
    const liberty = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.45, 1.7, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8d18a, emissive: 0x4a3a10, emissiveIntensity: 0.4 }),
    );
    body.position.y = 0.85;
    liberty.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffe8b8, emissive: 0x886622, emissiveIntensity: 0.5 }),
    );
    head.position.y = 1.95;
    liberty.add(head);
    liberty.position.set(20, 0, 260);
    scene.add(liberty);
    const libLight = new THREE.PointLight(0xffd070, 2.5, 30);
    libLight.position.set(20, 2.5, 260);
    scene.add(libLight);

    // =========================================================
    // 4) COUNCIL HALL — far north, large enterable temple
    // =========================================================
    const council = addBuilding(0, -200, 50, 14, 36, 0x3a342a, "south", 6, {
      interiorColor: 0x2a2418,
    });
    // gate at entrance — locked until you've met the Golden One
    addGate(0, council.doorZ + 0.6, "ew", 6, 3, "Council sealed — meet the Golden One first");
    // pillars in front
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      addBlock(i * 7, 0, -178, 1.6, 12, 1.6, 0x4a4438);
    }
    // pillars inside
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const px = Math.cos(a) * 10;
      const pz = -200 + Math.sin(a) * 10;
      addBlock(px, 0, pz, 1.4, 12, 1.4, 0x5a5040);
    }
    const altar = new THREE.Mesh(
      new THREE.BoxGeometry(3, 1.6, 3),
      new THREE.MeshStandardMaterial({ color: 0x6a5a3a, emissive: 0x221810, emissiveIntensity: 0.6 }),
    );
    altar.position.set(0, 0.8, -200);
    scene.add(altar);
    const altarLight = new THREE.PointLight(0xffaa66, 2.2, 40);
    altarLight.position.set(0, 6, -200);
    scene.add(altarLight);
    // braziers
    [[-15, -180], [15, -180]].forEach(([bx, bz]) => {
      const t = addBlock(bx, 4, bz, 1, 1, 1, 0xffaa55, { emissive: 0xff7733, solid: false });
      t.position.y = 4.5;
      const pl = new THREE.PointLight(0xffaa55, 2, 30);
      pl.position.set(bx, 5, bz);
      scene.add(pl);
    });

    // =========================================================
    // 5) UNCHARTED FOREST — far west, expansive
    // =========================================================
    // forest gate at city's west boundary
    addGate(-170, 0, "ns", 8, 4, "Forest forbidden — flee the Council first");
    for (let i = 0; i < 700; i++) {
      const x = -180 - Math.random() * 360;
      const z = (Math.random() - 0.5) * 480;
      const h = 6 + Math.random() * 5;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.6, h, 6),
        new THREE.MeshStandardMaterial({ color: 0x231a12 }),
      );
      trunk.position.set(x, h / 2, z);
      scene.add(trunk);
      const top = new THREE.Mesh(
        new THREE.ConeGeometry(2.6, 6, 7),
        new THREE.MeshStandardMaterial({ color: 0x1e3a22 }),
      );
      top.position.set(x, h + 2.5, z);
      scene.add(top);
      colliders.push({ box: new THREE.Box3().setFromObject(trunk).expandByScalar(0.2) });
    }
    // forest beacon to guide the player
    const forestBeacon = new THREE.PointLight(0x88ffaa, 1.4, 50);
    forestBeacon.position.set(-220, 8, 0);
    scene.add(forestBeacon);
    const forestMarker = addBlock(-220, 0, 0, 1.5, 0.3, 1.5, 0x4a3a2a, { emissive: 0x1a1208, solid: false });

    // =========================================================
    // 6) HOUSE OF THE UNMENTIONABLE TIMES — deep west, enterable
    // =========================================================
    const houseColors = [0x7a3a3a, 0x3a5a7a, 0x6a6a3a, 0x4a3a6a];
    const HX = -450, HZ = 0;
    // colored glass walls (each face a different color)
    const houseT = 0.4, houseW = 22, houseH = 9, houseD = 26, doorW = 4;
    // south door
    const sideS = (houseW - doorW) / 2;
    addBlock(HX - (doorW / 2 + sideS / 2), 0, HZ + houseD / 2, sideS, houseH, houseT, houseColors[0], { emissive: houseColors[0], emissiveIntensity: 0.35 });
    addBlock(HX + (doorW / 2 + sideS / 2), 0, HZ + houseD / 2, sideS, houseH, houseT, houseColors[0], { emissive: houseColors[0], emissiveIntensity: 0.35 });
    addBlock(HX, houseH - 0.8, HZ + houseD / 2, doorW, 1.2, houseT, houseColors[0], { emissive: houseColors[0], emissiveIntensity: 0.35 });
    // north
    addBlock(HX, 0, HZ - houseD / 2, houseW, houseH, houseT, houseColors[1], { emissive: houseColors[1], emissiveIntensity: 0.35 });
    // east
    addBlock(HX + houseW / 2, 0, HZ, houseT, houseH, houseD, houseColors[2], { emissive: houseColors[2], emissiveIntensity: 0.35 });
    // west
    addBlock(HX - houseW / 2, 0, HZ, houseT, houseH, houseD, houseColors[3], { emissive: houseColors[3], emissiveIntensity: 0.35 });
    // roof
    const houseRoof = new THREE.Mesh(
      new THREE.BoxGeometry(houseW + 0.4, 0.3, houseD + 0.4),
      new THREE.MeshStandardMaterial({ color: 0x2a2018 }),
    );
    houseRoof.position.set(HX, houseH + 0.15, HZ);
    scene.add(houseRoof);
    // floor
    const houseFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(houseW - 1, houseD - 1),
      new THREE.MeshStandardMaterial({ color: 0x6a5a3a, roughness: 0.8 }),
    );
    houseFloor.rotation.x = -Math.PI / 2;
    houseFloor.position.set(HX, 0.03, HZ);
    scene.add(houseFloor);
    // mirror & furniture
    addBlock(HX + 8, 0, HZ - 8, 2, 4, 0.2, 0xddddee, { emissive: 0x88aacc, emissiveIntensity: 0.3, solid: false });
    addBlock(HX - 8, 0, HZ + 6, 3, 1, 1.5, 0x6a4a2a, { solid: false });
    // gate at house entrance — locked until you reach the Forest
    addGate(HX, HZ + houseD / 2 + 0.6, "ew", doorW, 5, "House sealed — walk the forest first");
    // big inner light
    const houseLight = new THREE.PointLight(0xfff0c0, 3, 60);
    houseLight.position.set(HX, 5, HZ);
    scene.add(houseLight);

    // The Book — final pickup, on a pedestal inside the house
    addBlock(HX, 0, HZ - 4, 1.4, 1.1, 1.4, 0x4a3a2a, { solid: false });
    const bookGroup = new THREE.Group();
    const book = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.18, 1.3),
      new THREE.MeshStandardMaterial({ color: 0xeeddaa, emissive: 0xffe8a0, emissiveIntensity: 1.1 }),
    );
    bookGroup.add(book);
    bookGroup.position.set(HX, 1.5, HZ - 4);
    scene.add(bookGroup);
    const bookLight = new THREE.PointLight(0xffeebb, 3.5, 24);
    bookLight.position.set(HX, 2.3, HZ - 4);
    scene.add(bookLight);

    // =========================================================
    // BEACONS — glowing pillars of light marking the next objective
    // =========================================================
    const beaconForBeat: Record<string, THREE.Mesh> = {};
    const makeBeacon = (id: string, x: number, z: number, color: number) => {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 80, 8, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
      );
      beam.position.set(x, 40, z);
      scene.add(beam);
      beaconForBeat[id] = beam;
    };
    makeBeacon("start", -48, -48, 0xffcc66);
    makeBeacon("tunnel_entry", GRATE_X, GRATE_Z, 0xff8844);
    makeBeacon("tunnel_light", 228, 0, 0xfff0aa);
    makeBeacon("field_meet", 20, 260, 0xffd070);
    makeBeacon("council", 0, -200, 0xffaa66);
    makeBeacon("forest", -220, 0, 0x88ffaa);
    makeBeacon("house", HX, HZ, 0xff88dd);
    makeBeacon("ego", HX, HZ - 4, 0xffffff);

    // =========================================================
    // INTERACTABLES
    // =========================================================
    const interactables: Interactable[] = [
      { beatId: "start", position: new THREE.Vector3(-48, 1, -45), mesh: parchmentTable, label: "Read the parchment", order: 0 },
      { beatId: "tunnel_entry", position: new THREE.Vector3(GRATE_X, 1, GRATE_Z), mesh: grate, label: "Lift the iron grating", order: 1 },
      { beatId: "tunnel_light", position: lightBox.position.clone(), mesh: lightBox, label: "Touch the light without fire", order: 2 },
      { beatId: "field_meet", position: liberty.position.clone(), mesh: liberty, label: "Approach the Golden One", order: 3 },
      { beatId: "council", position: altar.position.clone(), mesh: altar, label: "Present the light to the Council", order: 4 },
      { beatId: "forest", position: new THREE.Vector3(-220, 1, 0), mesh: forestMarker, label: "Enter the Uncharted Forest", order: 5 },
      { beatId: "house", position: new THREE.Vector3(HX, 1, HZ), mesh: houseFloor, label: "Step into the glass house", order: 6 },
      { beatId: "ego", position: bookGroup.position.clone(), mesh: bookGroup, label: "Open the book", order: 7 },
    ];

    const OBJECTIVES = [
      "Read the parchment in the dormitory",
      "Find the iron grating east of the city",
      "Descend into the tunnel — find the glowing box",
      "Cross the south wall to the field — find the Golden One",
      "Return north to the Council Hall",
      "Flee west — enter the Uncharted Forest",
      "Find the glass house deep in the forest",
      "Open the book — discover the sacred word",
    ];
    setObjective(OBJECTIVES[0]);

    // ---------- SPAWN inside the dormitory ----------
    camera.position.set(-48, 1.7, -48);
    let yaw = Math.PI; // face the door (north door, looking +z... actually north door is -z; face -z)
    yaw = 0; // facing -z (north door)
    let pitch = 0;

    // ---------- CONTROLS ----------
    const keys: Record<string, boolean> = {};
    const onKey = (e: KeyboardEvent, down: boolean) => {
      keys[e.code] = down;
      if (down && e.code === "KeyE") tryInteract();
      if (down && e.code === "Escape") {
        setActiveBeat(null);
        activeBeatRef.current = null;
      }
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== renderer.domElement) return;
      yaw -= e.movementX * 0.0025;
      pitch -= e.movementY * 0.0025;
      pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
    };
    window.addEventListener("mousemove", onMouseMove);

    const lockChange = () => setLocked(document.pointerLockElement === renderer.domElement);
    document.addEventListener("pointerlockchange", lockChange);

    renderer.domElement.addEventListener("click", () => {
      if (activeBeatRef.current) return;
      renderer.domElement.requestPointerLock();
    });

    // ---------- INTERACT ----------
    const tryInteract = () => {
      if (activeBeatRef.current) {
        setActiveBeat(null);
        activeBeatRef.current = null;
        return;
      }
      const p = camera.position;
      let best: Interactable | null = null;
      let bestD = 5.5;
      for (const it of interactables) {
        if (it.order < progressRef.current) continue;
        if (it.order > progressRef.current) continue; // must be the next beat
        const d = p.distanceTo(it.position);
        if (d < bestD) {
          bestD = d;
          best = it;
        }
      }
      if (best) {
        const beat = STORY.find((b) => b.id === best!.beatId)!;
        setActiveBeat(beat);
        activeBeatRef.current = beat;
        progressRef.current = best.order + 1;
        setProgress(progressRef.current);
        // unlock any gate that was waiting on this beat
        for (const g of gates) {
          if (!g.open && progressRef.current > g.unlockAfter) {
            g.open = true;
            // remove collider + visually drop the door
            const idx = colliders.indexOf(g.collider);
            if (idx >= 0) colliders.splice(idx, 1);
            g.mesh.visible = false;
          }
        }
        // advance objective
        if (best.order + 1 < OBJECTIVES.length) {
          setObjective(OBJECTIVES[best.order + 1]);
        } else {
          setObjective("You found the word.");
        }
        if (best.order === STORY.length - 1) setFinished(true);
      }
    };

    // ---------- LOOP ----------
    const velocity = new THREE.Vector3();
    const tmpForward = new THREE.Vector3();
    const tmpRight = new THREE.Vector3();
    let last = performance.now();
    const startedAt = performance.now();
    let raf = 0;

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setElapsed(Math.floor((now - startedAt) / 1000));

      const q = new THREE.Quaternion();
      q.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
      camera.quaternion.copy(q);

      tmpForward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      tmpRight.set(Math.cos(yaw), 0, -Math.sin(yaw));

      const move = new THREE.Vector3();
      if (!activeBeatRef.current && document.pointerLockElement === renderer.domElement) {
        if (keys["KeyW"]) move.add(tmpForward);
        if (keys["KeyS"]) move.sub(tmpForward);
        if (keys["KeyD"]) move.add(tmpRight);
        if (keys["KeyA"]) move.sub(tmpRight);
      }
      const speed = keys["ShiftLeft"] || keys["ShiftRight"] ? 14 : 7;
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);
      velocity.lerp(move, 0.4);

      const next = camera.position.clone();
      next.x += velocity.x;
      const bx = new THREE.Box3(
        new THREE.Vector3(next.x - 0.4, 0, camera.position.z - 0.4),
        new THREE.Vector3(next.x + 0.4, 2, camera.position.z + 0.4),
      );
      if (!colliders.some((c) => c.box.intersectsBox(bx))) camera.position.x = next.x;

      next.copy(camera.position);
      next.z += velocity.z;
      const bz = new THREE.Box3(
        new THREE.Vector3(camera.position.x - 0.4, 0, next.z - 0.4),
        new THREE.Vector3(camera.position.x + 0.4, 2, next.z + 0.4),
      );
      if (!colliders.some((c) => c.box.intersectsBox(bz))) camera.position.z = next.z;

      camera.position.y = 1.7;

      // bobbing pickups
      const t = now / 600;
      lightBox.position.y = 1.0 + Math.sin(t) * 0.1;
      lightBox.rotation.y += dt * 0.6;
      bookGroup.position.y = 1.5 + Math.sin(t * 0.8) * 0.08;
      bookGroup.rotation.y += dt * 0.3;
      liberty.rotation.y = Math.sin(t * 0.5) * 0.3;
      // pulsing gates
      for (const g of gates) {
        if (g.open) continue;
        const mat = g.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.4 + Math.sin(t * 2) * 0.25;
      }
      // beacons: only show next objective's beacon
      const nextBeatId = STORY[progressRef.current]?.id;
      for (const [id, m] of Object.entries(beaconForBeat)) {
        m.visible = id === nextBeatId;
      }

      // nearby prompt
      let near: string | null = null;
      let nd = 5.5;
      for (const it of interactables) {
        if (it.order !== progressRef.current) continue;
        const d = camera.position.distanceTo(it.position);
        if (d < nd) {
          nd = d;
          near = it.label;
        }
      }
      // show locked gate hint
      if (!near) {
        let gd = 6;
        for (const g of gates) {
          if (g.open) continue;
          const d = camera.position.distanceTo(g.position);
          if (d < gd) {
            gd = d;
            near = g.label;
          }
        }
      }
      setNearby(near);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerlockchange", lockChange);
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [started]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0e0c09] text-[#e8dcc0]">
      <div ref={mountRef} className="absolute inset-0" />

      {!started && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-[#0e0c09]/95">
          <div className="max-w-xl text-center space-y-6">
            <p className="uppercase tracking-[0.4em] text-xs text-[#b8a37a]">A 3D walk through</p>
            <h1 className="text-6xl font-serif tracking-wider">ANTHEM</h1>
            <p className="text-sm text-[#b8a37a] italic">after the novella by Ayn Rand</p>
            <p className="text-sm leading-relaxed text-[#c8b890]">
              A semi-open world. You are Equality 7-2521. The city is vast and you may wander
              freely — but the Council's doors stay sealed until each chapter is found. Follow
              the beam of light to your next objective.
            </p>
            <div className="text-xs text-[#8a7a5a] grid grid-cols-2 gap-2 max-w-sm mx-auto pt-2">
              <div><span className="text-[#e8dcc0]">WASD</span> — walk</div>
              <div><span className="text-[#e8dcc0]">Shift</span> — run</div>
              <div><span className="text-[#e8dcc0]">Mouse</span> — look</div>
              <div><span className="text-[#e8dcc0]">E</span> — interact / close</div>
            </div>
            <button
              onClick={() => setStarted(true)}
              className="mt-4 px-8 py-3 bg-[#c8a84a] text-[#0e0c09] font-serif tracking-widest uppercase text-sm hover:bg-[#e8c870] transition-colors"
            >
              Begin
            </button>
            <p className="text-xs text-[#6a5a40] pt-2">~15 minutes to speedrun · ~30 to soak in</p>
          </div>
        </div>
      )}

      {started && (
        <>
          <div className="absolute top-4 left-4 z-10 text-xs uppercase tracking-widest text-[#b8a37a] space-y-1 pointer-events-none">
            <div>Chapter {Math.min(progress + 1, STORY.length)} of {STORY.length}</div>
            <div className="text-[#8a7a5a]">{mm}:{ss}</div>
            <div className="text-[#e8c870] normal-case tracking-normal text-sm pt-2 max-w-xs">
              ▸ {objective}
            </div>
          </div>
          <div className="absolute top-4 right-4 z-10 text-right text-xs uppercase tracking-widest text-[#8a7a5a] pointer-events-none">
            <div>WASD · Mouse · E</div>
            <div className="text-[#6a5a40] normal-case tracking-normal pt-1">Follow the beam of light</div>
          </div>

          {locked && !activeBeat && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#e8dcc0]/70 pointer-events-none" />
          )}

          {nearby && !activeBeat && locked && (
            <div className="absolute left-1/2 bottom-24 -translate-x-1/2 z-10 px-4 py-2 border border-[#c8a84a]/40 bg-black/40 text-sm tracking-wide pointer-events-none">
              [E] {nearby}
            </div>
          )}

          {!locked && !activeBeat && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 pointer-events-none">
              <div className="text-sm uppercase tracking-[0.3em] text-[#c8b890] border border-[#c8a84a]/40 px-6 py-3 bg-black/60">
                Click to look
              </div>
            </div>
          )}

          {activeBeat && (
            <div
              className="absolute inset-0 z-30 flex items-center justify-center p-6 bg-black/80"
              onClick={() => { setActiveBeat(null); activeBeatRef.current = null; }}
            >
              <div
                className="max-w-2xl border border-[#c8a84a]/40 bg-[#15110b] p-10 space-y-5"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="font-serif text-2xl tracking-wider text-[#e8c870]">
                  {activeBeat.title}
                </h2>
                <p className="text-[#d8c8a0] leading-relaxed whitespace-pre-line font-serif text-[15px]">
                  {activeBeat.body}
                </p>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-xs uppercase tracking-widest text-[#6a5a40]">
                    Press E or click to continue
                  </span>
                  <button
                    onClick={() => { setActiveBeat(null); activeBeatRef.current = null; }}
                    className="px-5 py-2 bg-[#c8a84a] text-[#0e0c09] uppercase tracking-widest text-xs hover:bg-[#e8c870]"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          )}

          {finished && !activeBeat && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 text-center text-xs uppercase tracking-[0.3em] text-[#e8c870]">
              You found the word. Final time {mm}:{ss}.
            </div>
          )}
        </>
      )}
    </div>
  );
}
