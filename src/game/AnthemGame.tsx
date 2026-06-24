import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/**
 * ANTHEM — an interactive 3D walkthrough of Ayn Rand's novella.
 * Six zones the player walks between. Each zone has interactive
 * objects (press E) that advance the story.
 *
 *  1. Home of the Street Sweepers      — collectivist city
 *  2. The Tunnel                       — discovery of forbidden knowledge
 *  3. The Field                        — meeting the Golden One
 *  4. The Palace of Corrective Detention / Council
 *  5. The Uncharted Forest
 *  6. The House from the Unmentionable Times — the word "I"
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
      "“It is a sin to write this. It is a sin to think words no others think and to put them down upon a paper no others are to see.”\n\nYou are Equality 7-2521. You have been sentenced to be a Street Sweeper for the rest of your days, for the crime of being born with a mind quicker than your brothers'. Find the iron grating beyond the city — there is something the Councils do not wish you to see.",
  },
  {
    id: "tunnel_entry",
    title: "II. The Tunnel from the Unmentionable Times",
    body:
      "An iron grating, half-buried. Below: a tunnel of stone, perfect and forbidden. ‘What is this place?’ you whisper. ‘Why was it built?’ The Council would have you flogged for asking. Descend.",
  },
  {
    id: "tunnel_light",
    title: "III. The Power of the Sky",
    body:
      "Wires. Glass. A box that holds lightning torn from the storm. For two years you have worked in secret, and tonight the metal glows — a light without fire, without smoke, without the candle of the Home of the Scholars. You have made it. You alone.",
  },
  {
    id: "field_meet",
    title: "IV. The Golden One",
    body:
      "In the fields beyond the city walks a woman with hair the color of gold and eyes like the sky before a flame. Liberty 5-3000. You are not to think of women, nor they of men, except on the one night of the Time of Mating. And yet — your eyes meet, and a law older than the Council is written between you.",
  },
  {
    id: "council",
    title: "V. The World Council of Scholars",
    body:
      "You bring them the light. You expect joy. Instead: terror. ‘How dared you, gutter cleaner,’ they cry, ‘to think that your mind held greater wisdom than the minds of your brothers? You shall be lashed till there is nothing left under the lashes.’\n\nYou snatch the glass box and run — through the door, through the streets, into the Uncharted Forest where no man has ever gone.",
  },
  {
    id: "forest",
    title: "VI. The Uncharted Forest",
    body:
      "The trees are old and the silence is older. For the first time in your life you are alone — and you are not afraid. Liberty 5-3000 finds you here. She has followed. You name her The Golden One; she names you The Unconquered. Together you walk on, until the trees thin, and a road of stone appears.",
  },
  {
    id: "house",
    title: "VII. The House of the Unmentionable Times",
    body:
      "A house of glass and color, made for two — perhaps three. Inside: clothes, mirrors, and books in a tongue you can almost read. You read for days. And then, on a page worn soft by another's hand, you find a word so simple it stops your breath.",
  },
  {
    id: "ego",
    title: "VIII. EGO",
    body:
      "“I am. I think. I will.\n\nMy hands… My spirit… My sky… My forest… This earth of mine….\n\nWhat must I say besides? These are the words. This is the answer.\n\nI stand here on the summit of the mountain. I lift my head and I spread my arms. This, my body and spirit, this is the end of the quest. I wished to know the meaning of things. I am the meaning. I wished to find a warrant for being. I need no warrant for being, and no word of sanction upon my being. I am the warrant and the sanction.”\n\n— The sacred word: EGO.",
  },
];

type Interactable = {
  beatId: string;
  position: THREE.Vector3;
  mesh: THREE.Object3D;
  label: string;
  order: number;
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

  const progressRef = useRef(0);
  const activeBeatRef = useRef<Beat | null>(null);

  useEffect(() => {
    if (!started || !mountRef.current) return;

    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1814);
    scene.fog = new THREE.Fog(0x1a1814, 25, 120);

    const camera = new THREE.PerspectiveCamera(
      72,
      mount.clientWidth / mount.clientHeight,
      0.1,
      400,
    );
    camera.position.set(0, 1.7, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    // ---------- LIGHTING ----------
    const hemi = new THREE.HemisphereLight(0xb8a37a, 0x1a1410, 0.45);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd8a8, 0.7);
    sun.position.set(40, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    scene.add(sun);

    // ---------- GROUND ----------
    const groundGeo = new THREE.PlaneGeometry(600, 600, 1, 1);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2a2620,
      roughness: 0.95,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Helper builders
    const colliders: { box: THREE.Box3 }[] = [];
    const addBlock = (
      x: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: number,
      opts: { solid?: boolean; emissive?: number } = {},
    ) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.85,
        emissive: opts.emissive ?? 0x000000,
        emissiveIntensity: opts.emissive ? 0.6 : 0,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      if (opts.solid !== false) {
        const box = new THREE.Box3().setFromObject(mesh);
        box.expandByScalar(0.2);
        colliders.push({ box });
      }
      return mesh;
    };

    // ---------- ZONE 1: THE CITY (grey brutalist blocks) ----------
    // central plaza around origin
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        if (Math.abs(i) < 2 && Math.abs(j) < 2) continue;
        if (Math.random() > 0.55) continue;
        const x = i * 9 + (Math.random() - 0.5) * 2;
        const z = j * 9 + (Math.random() - 0.5) * 2;
        const h = 6 + Math.random() * 10;
        addBlock(x, z, 4 + Math.random() * 2, h, 4 + Math.random() * 2, 0x4a4438);
      }
    }
    // a big Council pillar to the north
    addBlock(0, -28, 14, 20, 8, 0x3a342a);
    // torches (small glowing blocks) on the council
    const torchA = addBlock(-5, -23, 0.6, 0.6, 0.6, 0xffaa55, { emissive: 0xff7733, solid: false });
    const torchB = addBlock(5, -23, 0.6, 0.6, 0.6, 0xffaa55, { emissive: 0xff7733, solid: false });
    torchA.position.y = 4;
    torchB.position.y = 4;
    scene.add(new THREE.PointLight(0xffaa55, 1.2, 14)).position.set(-5, 4, -23);
    scene.add(new THREE.PointLight(0xffaa55, 1.2, 14)).position.set(5, 4, -23);

    // ---------- TRANSITION: low wall with break leading south to field ----------
    for (let x = -30; x <= 30; x += 4) {
      if (Math.abs(x) < 4) continue;
      addBlock(x, 25, 3.5, 2.5, 1.2, 0x3c362c);
    }

    // ---------- ZONE 2: THE FIELD (south, golden grass) ----------
    const fieldGeo = new THREE.PlaneGeometry(80, 80);
    const fieldMat = new THREE.MeshStandardMaterial({ color: 0x8a7a3a, roughness: 1 });
    const field = new THREE.Mesh(fieldGeo, fieldMat);
    field.rotation.x = -Math.PI / 2;
    field.position.set(0, 0.02, 55);
    scene.add(field);
    // tufts of grass
    for (let i = 0; i < 120; i++) {
      const g = new THREE.ConeGeometry(0.3, 1.2, 5);
      const m = new THREE.MeshStandardMaterial({ color: 0xc8a84a });
      const tuft = new THREE.Mesh(g, m);
      tuft.position.set((Math.random() - 0.5) * 70, 0.6, 30 + Math.random() * 50);
      scene.add(tuft);
    }
    // Liberty 5-3000 — a tall golden figure
    const liberty = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.4, 1.6, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8d18a, emissive: 0x4a3a10, emissiveIntensity: 0.3 }),
    );
    body.position.y = 0.8;
    liberty.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffe8b8, emissive: 0x886622, emissiveIntensity: 0.4 }),
    );
    head.position.y = 1.85;
    liberty.add(head);
    liberty.position.set(8, 0, 60);
    scene.add(liberty);
    scene.add(new THREE.PointLight(0xffd070, 1.5, 12)).position.set(8, 2, 60);

    // ---------- ZONE 3: THE TUNNEL (east of city, down stairs into dim chamber) ----------
    // grating marker
    const grate = new THREE.Mesh(
      new THREE.BoxGeometry(3, 0.1, 3),
      new THREE.MeshStandardMaterial({ color: 0x222018, metalness: 0.7, roughness: 0.4 }),
    );
    grate.position.set(40, 0.05, 0);
    scene.add(grate);
    // tunnel walls (a small underground room east further)
    const tunnelGroup = new THREE.Group();
    const tunFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 14),
      new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 1 }),
    );
    tunFloor.rotation.x = -Math.PI / 2;
    tunFloor.position.set(60, 0.03, 0);
    tunnelGroup.add(tunFloor);
    // walls
    [
      [60, 0, -7, 20, 4, 0.5],
      [60, 0, 7, 20, 4, 0.5],
      [70, 0, 0, 0.5, 4, 14],
    ].forEach(([x, , z, w, h, d]) => {
      addBlock(x, z, w, h, d, 0x2a2620);
    });
    scene.add(tunnelGroup);
    // the LIGHT BOX — glowing pickup
    const lightBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.8, 0.6),
      new THREE.MeshStandardMaterial({
        color: 0xfff8dd,
        emissive: 0xfff0aa,
        emissiveIntensity: 1.5,
      }),
    );
    lightBox.position.set(65, 0.9, 0);
    scene.add(lightBox);
    const lightBoxLight = new THREE.PointLight(0xffeeaa, 2, 18);
    lightBoxLight.position.set(65, 1.5, 0);
    scene.add(lightBoxLight);

    // ---------- ZONE 4: THE COUNCIL CHAMBER (north of the city, behind the big block) ----------
    // a circle of pillars
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = Math.cos(a) * 7;
      const z = -50 + Math.sin(a) * 7;
      addBlock(x, z, 1.2, 8, 1.2, 0x5a5040);
    }
    // central altar where the player presents the light
    const altar = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1.2, 2),
      new THREE.MeshStandardMaterial({ color: 0x6a5a3a, emissive: 0x221810, emissiveIntensity: 0.4 }),
    );
    altar.position.set(0, 0.6, -50);
    scene.add(altar);
    scene.add(new THREE.PointLight(0xffaa66, 1, 18)).position.set(0, 4, -50);

    // ---------- ZONE 5: THE UNCHARTED FOREST (west, dark trees) ----------
    for (let i = 0; i < 90; i++) {
      const x = -40 - Math.random() * 80;
      const z = (Math.random() - 0.5) * 100;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.5, 5 + Math.random() * 3, 6),
        new THREE.MeshStandardMaterial({ color: 0x231a12 }),
      );
      trunk.position.set(x, 2.5, z);
      scene.add(trunk);
      const top = new THREE.Mesh(
        new THREE.ConeGeometry(2.2, 5, 7),
        new THREE.MeshStandardMaterial({ color: 0x1e3a22 }),
      );
      top.position.set(x, 6.5, z);
      scene.add(top);
      colliders.push({ box: new THREE.Box3().setFromObject(trunk).expandByScalar(0.2) });
    }

    // ---------- ZONE 6: THE HOUSE OF THE UNMENTIONABLE TIMES (far west) ----------
    // colored glass house
    const houseGroup = new THREE.Group();
    const houseColors = [0x7a3a3a, 0x3a5a7a, 0x6a6a3a, 0x4a3a6a];
    [
      [-100, 0, -10, 12, 6, 0.4],
      [-100, 0, 10, 12, 6, 0.4],
      [-106, 0, 0, 0.4, 6, 20],
      [-94, 0, 0, 0.4, 6, 20],
    ].forEach(([x, , z, w, h, d], i) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.MeshStandardMaterial({
        color: houseColors[i],
        emissive: houseColors[i],
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.85,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, h / 2, z);
      houseGroup.add(mesh);
      colliders.push({ box: new THREE.Box3().setFromObject(mesh).expandByScalar(0.15) });
    });
    // roof
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(13, 0.3, 21),
      new THREE.MeshStandardMaterial({ color: 0x2a2018 }),
    );
    roof.position.set(-100, 6.1, 0);
    houseGroup.add(roof);
    scene.add(houseGroup);
    scene.add(new THREE.PointLight(0xfff0c0, 1.5, 25)).position.set(-100, 4, 0);

    // The Book — the final pickup
    const bookGroup = new THREE.Group();
    const book = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.15, 1.0),
      new THREE.MeshStandardMaterial({
        color: 0xeeddaa,
        emissive: 0xffe8a0,
        emissiveIntensity: 0.8,
      }),
    );
    bookGroup.add(book);
    bookGroup.position.set(-100, 1.2, 0);
    scene.add(bookGroup);
    scene.add(new THREE.PointLight(0xffeebb, 2.5, 14)).position.set(-100, 2, 0);

    // ---------- INTERACTABLES (story beats anchored to world objects) ----------
    const interactables: Interactable[] = [
      {
        beatId: "start",
        position: new THREE.Vector3(0, 1, 0),
        mesh: addBlock(0, 0, 1.4, 0.4, 1.4, 0x6a5d44, { emissive: 0x2a1f10, solid: false }),
        label: "Read the parchment",
        order: 0,
      },
      {
        beatId: "tunnel_entry",
        position: grate.position.clone(),
        mesh: grate,
        label: "Lift the iron grating",
        order: 1,
      },
      {
        beatId: "tunnel_light",
        position: lightBox.position.clone(),
        mesh: lightBox,
        label: "Touch the light without fire",
        order: 2,
      },
      {
        beatId: "field_meet",
        position: liberty.position.clone(),
        mesh: liberty,
        label: "Approach the Golden One",
        order: 3,
      },
      {
        beatId: "council",
        position: altar.position.clone(),
        mesh: altar,
        label: "Present the light to the Council",
        order: 4,
      },
      {
        beatId: "forest",
        position: new THREE.Vector3(-55, 1, 0),
        mesh: addBlock(-55, 0, 1, 0.2, 1, 0x4a3a2a, { emissive: 0x1a1208, solid: false }),
        label: "Enter the Uncharted Forest",
        order: 5,
      },
      {
        beatId: "house",
        position: new THREE.Vector3(-100, 1, 0),
        mesh: houseGroup,
        label: "Enter the glass house",
        order: 6,
      },
      {
        beatId: "ego",
        position: bookGroup.position.clone(),
        mesh: bookGroup,
        label: "Open the book",
        order: 7,
      },
    ];

    // ---------- CONTROLS ----------
    const keys: Record<string, boolean> = {};
    const onKey = (e: KeyboardEvent, down: boolean) => {
      keys[e.code] = down;
      if (down && e.code === "KeyE") tryInteract();
      if (down && e.code === "Escape") {
        // close popup
        setActiveBeat(null);
        activeBeatRef.current = null;
      }
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    let yaw = 0;
    let pitch = 0;
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
      let bestD = 4.5;
      for (const it of interactables) {
        if (it.order < progressRef.current) continue;
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
        if (best.order >= progressRef.current) {
          progressRef.current = best.order + 1;
          setProgress(progressRef.current);
          if (best.order === STORY.length - 1) setFinished(true);
        }
      }
    };

    // ---------- MOVEMENT + LOOP ----------
    const velocity = new THREE.Vector3();
    const tmpForward = new THREE.Vector3();
    const tmpRight = new THREE.Vector3();
    let last = performance.now();
    let startedAt = performance.now();
    let raf = 0;

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setElapsed(Math.floor((now - startedAt) / 1000));

      // camera orientation
      const q = new THREE.Quaternion();
      q.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
      camera.quaternion.copy(q);

      // forward / right on the XZ plane
      tmpForward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      tmpRight.set(Math.cos(yaw), 0, -Math.sin(yaw));

      const move = new THREE.Vector3();
      if (!activeBeatRef.current && document.pointerLockElement === renderer.domElement) {
        if (keys["KeyW"]) move.add(tmpForward);
        if (keys["KeyS"]) move.sub(tmpForward);
        if (keys["KeyD"]) move.add(tmpRight);
        if (keys["KeyA"]) move.sub(tmpRight);
      }
      const speed = keys["ShiftLeft"] || keys["ShiftRight"] ? 11 : 6;
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);
      velocity.lerp(move, 0.4);

      // try x then z with collisions
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
      lightBox.position.y = 0.9 + Math.sin(t) * 0.1;
      lightBox.rotation.y += dt * 0.6;
      bookGroup.position.y = 1.2 + Math.sin(t * 0.8) * 0.08;
      bookGroup.rotation.y += dt * 0.3;
      liberty.rotation.y = Math.sin(t * 0.5) * 0.3;

      // nearby prompt
      let near: string | null = null;
      let nd = 4.5;
      for (const it of interactables) {
        if (it.order < progressRef.current) continue;
        const d = camera.position.distanceTo(it.position);
        if (d < nd) {
          nd = d;
          near = it.label;
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
              You are Equality 7-2521. In a world that has forgotten the word "I", you will
              cross a city, descend into a forbidden tunnel, meet the Golden One, face the
              Council, flee into the Uncharted Forest, and find — in a house from the
              Unmentionable Times — the sacred word.
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
          {/* HUD */}
          <div className="absolute top-4 left-4 z-10 text-xs uppercase tracking-widest text-[#b8a37a] space-y-1 pointer-events-none">
            <div>Chapter {Math.min(progress + 1, STORY.length)} of {STORY.length}</div>
            <div className="text-[#8a7a5a]">{mm}:{ss}</div>
          </div>
          <div className="absolute top-4 right-4 z-10 text-right text-xs uppercase tracking-widest text-[#8a7a5a] pointer-events-none">
            <div>WASD · Mouse · E</div>
          </div>

          {/* crosshair */}
          {locked && !activeBeat && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#e8dcc0]/70 pointer-events-none" />
          )}

          {/* interact prompt */}
          {nearby && !activeBeat && locked && (
            <div className="absolute left-1/2 bottom-24 -translate-x-1/2 z-10 px-4 py-2 border border-[#c8a84a]/40 bg-black/40 text-sm tracking-wide pointer-events-none">
              [E] {nearby}
            </div>
          )}

          {/* click-to-lock overlay */}
          {!locked && !activeBeat && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 pointer-events-none">
              <div className="text-sm uppercase tracking-[0.3em] text-[#c8b890] border border-[#c8a84a]/40 px-6 py-3 bg-black/60">
                Click to look
              </div>
            </div>
          )}

          {/* story popup */}
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

          {/* finished */}
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
