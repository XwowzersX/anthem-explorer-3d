import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/**
 * ANTHEM — a semi-open 3D walk through Ayn Rand's novella.
 *
 * Architecture:
 *   - One Three.js scene.
 *   - The SURFACE world holds the city, fields, forest, and exterior
 *     building shells. Each enterable building has only an exterior door
 *     marker on the surface; you cannot walk inside on the surface map.
 *   - Each INTERIOR is its own Group placed at a far X offset (so it
 *     never collides with surface geometry) and is hidden by default.
 *   - Pressing E at a door teleports you into that interior's group and
 *     swaps the active collider list. Pressing E at the interior's exit
 *     pad teleports you back to the surface in front of the door.
 *
 * This is the same trick the underground tunnel uses — now extended to
 * the dormitory, council hall, and glass house.
 */

type Beat = { id: string; title: string; body: string };

const STORY: Beat[] = [
  {
    id: "start",
    title: "I. The Home of the Street Sweepers",
    body:
      "“It is a sin to write this. It is a sin to think words no others think and to put them down upon a paper no others are to see.”\n\nYou are Equality 7-2521. You sleep in a long hall of one hundred beds. Beneath your cot you have hidden a stub of candle and a sheaf of stolen paper. Take the parchment. Then step out into the street.",
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
  label: string;
  order: number;
  sceneKey: SceneKey;
};

type SceneKey = "surface" | "dorm" | "underground" | "council" | "house";

type Door = {
  /** Where the player stands on the surface to use this door */
  surfacePos: THREE.Vector3;
  /** Which interior it opens into */
  target: SceneKey;
  /** Where the player spawns inside that interior */
  interiorSpawn: THREE.Vector3;
  /** Facing yaw inside the interior */
  interiorYaw: number;
  /** Required progress to open (order index already completed) */
  unlockAfter: number;
  label: string;
  lockedLabel: string;
  /** Visible door mesh (for hiding when unlocked / open animations) */
  mesh?: THREE.Mesh;
};

type Gate = {
  unlockAfter: number;
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
  const [objective, setObjective] = useState<string>("Take the parchment from beneath your cot");
  const [muted, setMuted] = useState(false);
  const [hasLantern, setHasLantern] = useState(false);
  const [fragments, setFragments] = useState(0);
  const [puzzleProgress, setPuzzleProgress] = useState(0); // 0..3 for garden pedestals
  const [npcLine, setNpcLine] = useState<{ name: string; line: string } | null>(null);
  const [chase, setChase] = useState<{ active: boolean; timeLeft: number } | null>(null);
  const [stamina, setStamina] = useState(1);
  const [exhausted, setExhausted] = useState(false);
  const [lightParts, setLightParts] = useState(0);
  const [lightCharge, setLightCharge] = useState(0);
  const mutedRef = useRef(false);
  const masterGainRef = useRef<GainNode | null>(null);
  const hasLanternRef = useRef(false);
  const fragmentsRef = useRef(0);
  const npcLineRef = useRef<{ name: string; line: string } | null>(null);
  const compassRibbonRef = useRef<HTMLDivElement>(null);
  useEffect(() => { npcLineRef.current = npcLine; }, [npcLine]);

  useEffect(() => {
    mutedRef.current = muted;
    const g = masterGainRef.current;
    if (g) g.gain.setTargetAtTime(muted ? 0 : 0.55, g.context.currentTime, 0.05);
  }, [muted]);


  const progressRef = useRef(0);
  const activeBeatRef = useRef<Beat | null>(null);


  useEffect(() => {
    if (!started || !mountRef.current) return;
    const mount = mountRef.current;

    // =====================================================================
    // SCENE / RENDERER
    // =====================================================================
    const scene = new THREE.Scene();

    // Gradient sky dome (vertical CanvasTexture)
    const makeSky = () => {
      const c = document.createElement("canvas"); c.width = 16; c.height = 256;
      const g = c.getContext("2d")!;
      const grd = g.createLinearGradient(0, 0, 0, 256);
      grd.addColorStop(0.00, "#0b1726");
      grd.addColorStop(0.35, "#2a3850");
      grd.addColorStop(0.65, "#7a6a78");
      grd.addColorStop(1.00, "#d8a070");
      g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
      return t;
    };
    scene.background = makeSky();
    scene.fog = new THREE.Fog(0x3a3848, 60, 380);

    const camera = new THREE.PerspectiveCamera(74, mount.clientWidth / mount.clientHeight, 0.05, 900);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = false; // perf: shadows were the biggest cost
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.28;
    mount.appendChild(renderer.domElement);

    // =====================================================================
    // PROCEDURAL AUDIO (Web Audio API — no assets, starts on first gesture)
    // =====================================================================
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const actx = new AC();
    const masterGain = actx.createGain();
    masterGain.gain.value = mutedRef.current ? 0 : 0.55;
    masterGain.connect(actx.destination);
    masterGainRef.current = masterGain;


    // Reverb-ish: a short noise convolver for cathedral feel
    const convolver = actx.createConvolver();
    {
      const len = actx.sampleRate * 2.2;
      const buf = actx.createBuffer(2, len, actx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
      }
      convolver.buffer = buf;
    }
    const wetGain = actx.createGain();
    wetGain.gain.value = 0.22;
    convolver.connect(wetGain).connect(masterGain);

    // Ambient drone — two detuned oscillators + slow LFO filter
    const droneGain = actx.createGain();
    droneGain.gain.value = 0;
    droneGain.connect(masterGain);
    droneGain.connect(convolver);
    const droneFilter = actx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 480;
    droneFilter.Q.value = 4;
    droneFilter.connect(droneGain);
    const droneA = actx.createOscillator();
    const droneB = actx.createOscillator();
    const droneC = actx.createOscillator();
    droneA.type = "sawtooth"; droneA.frequency.value = 55;
    droneB.type = "sawtooth"; droneB.frequency.value = 55.4;
    droneC.type = "sine"; droneC.frequency.value = 82.5;
    droneA.connect(droneFilter); droneB.connect(droneFilter); droneC.connect(droneFilter);
    const lfo = actx.createOscillator();
    const lfoGain = actx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(droneFilter.frequency);
    droneA.start(); droneB.start(); droneC.start(); lfo.start();

    // Wind/noise bed for outdoor scenes
    const noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    {
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const noiseSrc = actx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;
    const noiseFilter = actx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 600;
    noiseFilter.Q.value = 0.6;
    const noiseGain = actx.createGain();
    noiseGain.gain.value = 0;
    noiseSrc.connect(noiseFilter).connect(noiseGain).connect(masterGain);
    noiseSrc.start();

    const sceneAmbience: Record<string, { drone: number; freq: number; filter: number; wind: number }> = {
      dorm:        { drone: 0.10, freq: 49,  filter: 320, wind: 0.00 },
      surface:     { drone: 0.07, freq: 55,  filter: 520, wind: 0.06 },
      underground: { drone: 0.16, freq: 41,  filter: 260, wind: 0.03 },
      council:    { drone: 0.13, freq: 47,  filter: 360, wind: 0.00 },
      house:       { drone: 0.08, freq: 65,  filter: 700, wind: 0.04 },
    };

    const applyAmbience = (key: string) => {
      const a = sceneAmbience[key] ?? sceneAmbience.surface;
      const now = actx.currentTime;
      const m = mutedRef.current ? 0 : 1;
      droneGain.gain.cancelScheduledValues(now);
      droneGain.gain.linearRampToValueAtTime(a.drone * m, now + 1.2);
      droneA.frequency.linearRampToValueAtTime(a.freq, now + 1.2);
      droneB.frequency.linearRampToValueAtTime(a.freq * 1.008, now + 1.2);
      droneC.frequency.linearRampToValueAtTime(a.freq * 1.5, now + 1.2);
      droneFilter.frequency.linearRampToValueAtTime(a.filter, now + 1.2);
      noiseGain.gain.cancelScheduledValues(now);
      noiseGain.gain.linearRampToValueAtTime(a.wind * m, now + 1.5);
    };

    // SFX helpers
    const blip = (freq: number, dur: number, type: OscillatorType = "sine", gain = 0.25, wet = 0.4) => {
      if (mutedRef.current) return;
      const t = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(masterGain);
      const wg = actx.createGain(); wg.gain.value = wet;
      g.connect(wg).connect(convolver);
      o.start(t); o.stop(t + dur + 0.05);
    };
    const noiseBurst = (dur: number, freq: number, q: number, gain = 0.3, wet = 0.3) => {
      if (mutedRef.current) return;
      const t = actx.currentTime;
      const src = actx.createBufferSource();
      src.buffer = noiseBuf;
      const f = actx.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
      const g = actx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(masterGain);
      const wg = actx.createGain(); wg.gain.value = wet;
      g.connect(wg).connect(convolver);
      src.start(t); src.stop(t + dur + 0.05);
    };
    const sfx = {
      footstep: () => noiseBurst(0.09, 220 + Math.random() * 80, 8, 0.18, 0.1),
      jump:     () => { blip(420, 0.12, "sine", 0.18, 0.15); noiseBurst(0.08, 800, 4, 0.1, 0.1); },
      land:     () => noiseBurst(0.14, 150, 5, 0.22, 0.2),
      interact: () => { blip(660, 0.18, "triangle", 0.2, 0.5); setTimeout(() => blip(990, 0.22, "sine", 0.15, 0.6), 60); },
      bell:     () => { blip(523, 1.2, "sine", 0.22, 0.9); blip(659, 1.2, "sine", 0.18, 0.9); blip(784, 1.4, "sine", 0.14, 0.9); },
      door:     () => { noiseBurst(0.7, 180, 2, 0.28, 0.5); blip(110, 0.6, "sawtooth", 0.12, 0.4); },
      metal:    () => { noiseBurst(0.35, 1800, 12, 0.3, 0.6); noiseBurst(0.5, 380, 3, 0.22, 0.5); },
      portal:   () => { blip(180, 0.5, "sine", 0.2, 0.7); setTimeout(() => blip(360, 0.4, "sine", 0.16, 0.7), 100); setTimeout(() => blip(540, 0.35, "sine", 0.12, 0.7), 200); },
    };

    const resumeAudio = () => { if (actx.state === "suspended") actx.resume(); };



    // =====================================================================
    // SCENE GROUPS — one per "map". Only the active one is visible.
    // =====================================================================
    const SCENE_OFFSETS: Record<SceneKey, number> = {
      surface: 0,
      dorm: 2000,
      underground: 4000,
      council: 6000,
      house: 8000,
    };

    const groups: Record<SceneKey, THREE.Group> = {
      surface: new THREE.Group(),
      dorm: new THREE.Group(),
      underground: new THREE.Group(),
      council: new THREE.Group(),
      house: new THREE.Group(),
    };
    for (const k of Object.keys(groups) as SceneKey[]) {
      groups[k].position.x = SCENE_OFFSETS[k];
      scene.add(groups[k]);
      groups[k].visible = k === "surface";
    }

    const colliderSets: Record<SceneKey, { box: THREE.Box3 }[]> = {
      surface: [],
      dorm: [],
      underground: [],
      council: [],
      house: [],
    };

    // =====================================================================
    // SHARED MATERIALS (huge perf win — one material instead of hundreds)
    // =====================================================================
    // ---------- Procedural textures (CanvasTexture — no asset deps) ----------
    const noiseTex = (
      w: number, h: number,
      base: [number, number, number],
      vary: number,
      lines?: { color: string; every: number; thick: number; horiz?: boolean },
      speckle?: { color: string; count: number; size: number },
      tile = 1,
    ) => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d")!;
      const img = g.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const n = (Math.random() - 0.5) * vary;
        img.data[i * 4 + 0] = Math.max(0, Math.min(255, base[0] + n));
        img.data[i * 4 + 1] = Math.max(0, Math.min(255, base[1] + n));
        img.data[i * 4 + 2] = Math.max(0, Math.min(255, base[2] + n));
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      if (lines) {
        g.strokeStyle = lines.color; g.lineWidth = lines.thick;
        if (lines.horiz) for (let y = 0; y < h; y += lines.every) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
        else for (let x = 0; x < w; x += lines.every) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      }
      if (speckle) {
        g.fillStyle = speckle.color;
        for (let i = 0; i < speckle.count; i++) {
          g.fillRect(Math.random() * w, Math.random() * h, speckle.size, speckle.size);
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(tile, tile);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    };

    const T = {
      stone: noiseTex(128, 128, [60, 56, 48], 38, { color: "#15110c", every: 32, thick: 1 }, { color: "#1a1612", count: 60, size: 2 }, 2),
      cobble: noiseTex(256, 256, [70, 64, 56], 50, { color: "#1a1612", every: 24, thick: 2 }, { color: "#2a241c", count: 120, size: 2 }, 24),
      wood: noiseTex(128, 256, [70, 48, 28], 28, { color: "#2a1808", every: 18, thick: 1, horiz: true }, undefined, 2),
      // 18th-century warm cream plaster (aged, sun-bleached)
      plaster: noiseTex(128, 128, [215, 200, 165], 25, undefined, { color: "#8a7a5a", count: 60, size: 2 }, 2),
      plasterDark: noiseTex(128, 128, [175, 158, 125], 28, undefined, { color: "#6a5a40", count: 70, size: 2 }, 2),
      // Clay tile roof - warm terracotta
      roof: noiseTex(128, 128, [145, 85, 60], 35, { color: "#8a4028", every: 20, thick: 2, horiz: true }, { color: "#3a1810", count: 40, size: 3 }, 3),
      // Brick texture for grand buildings
      brick: noiseTex(128, 128, [140, 72, 55], 45, { color: "#5a2a1a", every: 16, thick: 2 }, { color: "#1a0808", count: 50, size: 2 }, 2),
      grass: noiseTex(256, 256, [120, 108, 56], 60, undefined, { color: "#c8a84a", count: 400, size: 2 }, 40),
      iron: noiseTex(128, 128, [70, 64, 52], 40, { color: "#1a1612", every: 12, thick: 2 }, { color: "#a08050", count: 30, size: 2 }, 1),
      tunnel: noiseTex(128, 128, [38, 32, 26], 26, undefined, { color: "#0a0806", count: 100, size: 2 }, 3),
      bark: noiseTex(64, 256, [44, 32, 22], 24, { color: "#1a1208", every: 8, thick: 1, horiz: true }, undefined, 2),
      leaves: noiseTex(128, 128, [40, 70, 44], 50, undefined, { color: "#1a3a20", count: 200, size: 2 }, 2),
      gold: noiseTex(128, 128, [220, 190, 110], 30, undefined, { color: "#fff0a0", count: 80, size: 2 }, 1),
      // Slate for grand buildings
      slate: noiseTex(128, 128, [70, 75, 82], 18, { color: "#404550", every: 14, thick: 1 }, { color: "#2a2d32", count: 80, size: 2 }, 2),
    };

    // =====================================================================
    // SHARED MATERIALS (huge perf win — one material instead of hundreds)
    // =====================================================================
    const M = {
      stone:  new THREE.MeshStandardMaterial({ map: T.stone, color: 0x6a6258, roughness: 0.92, metalness: 0.02 }),
      stone2: new THREE.MeshStandardMaterial({ map: T.stone, color: 0x7a7268, roughness: 0.9,  metalness: 0.03 }),
      stone3: new THREE.MeshStandardMaterial({ map: T.stone, color: 0x55504a, roughness: 0.95, metalness: 0.02 }),
      stone4: new THREE.MeshStandardMaterial({ map: T.stone, color: 0x8a8278, roughness: 0.88, metalness: 0.04 }),
      cobble: new THREE.MeshStandardMaterial({ map: T.cobble, color: 0x8a8278, roughness: 0.95 }),
      wood:   new THREE.MeshStandardMaterial({ map: T.wood,   color: 0x8a6238, roughness: 0.85 }),
      woodDark: new THREE.MeshStandardMaterial({ map: T.wood, color: 0x5a3a20, roughness: 0.9 }),
      // Warm cream plaster for 18th-century facades
      plaster: new THREE.MeshStandardMaterial({ map: T.plaster, color: 0xdfd5b8, roughness: 0.93 }),
      plasterDark: new THREE.MeshStandardMaterial({ map: T.plasterDark, color: 0xc9b896, roughness: 0.94 }),
      // Terracotta clay tile roofs
      roof: new THREE.MeshStandardMaterial({ map: T.roof, color: 0x9a5a40, roughness: 0.85 }),
      // Brick for grand accents
      brick: new THREE.MeshStandardMaterial({ map: T.brick, color: 0x8a4838, roughness: 0.88 }),
      // Dark slate for council/institutional buildings
      slate: new THREE.MeshStandardMaterial({ map: T.slate, color: 0x485058, roughness: 0.9 }),
      door: new THREE.MeshStandardMaterial({
        map: T.wood, color: 0x4a3a20, emissive: 0xff8030, emissiveIntensity: 0.55,
        metalness: 0.35, roughness: 0.55,
      }),
      doorWood: new THREE.MeshStandardMaterial({
        map: T.wood, color: 0x4a3014, emissive: 0xffa050, emissiveIntensity: 0.45, roughness: 0.8,
      }),
      window: new THREE.MeshBasicMaterial({ color: 0xffd98a }),
      fire: new THREE.MeshBasicMaterial({ color: 0xff7733 }),
      candle: new THREE.MeshBasicMaterial({ color: 0xfff0aa }),
      ironGrate: new THREE.MeshStandardMaterial({
        map: T.iron, color: 0x6a5e4a, metalness: 0.85, roughness: 0.35,
        emissive: 0x2a1a08, emissiveIntensity: 0.5,
      }),
      tunnelWall:  new THREE.MeshStandardMaterial({ map: T.tunnel, color: 0x4a4238, roughness: 0.95 }),
      tunnelFloor: new THREE.MeshStandardMaterial({ map: T.tunnel, color: 0x2a2418, roughness: 0.95 }),
      tunnelCeil:  new THREE.MeshStandardMaterial({ map: T.tunnel, color: 0x1a1612, roughness: 0.95 }),
      lantern: new THREE.MeshBasicMaterial({ color: 0xffc060 }),
      flame:   new THREE.MeshBasicMaterial({ color: 0xff7028 }),
      flameCore: new THREE.MeshBasicMaterial({ color: 0xffe080 }),
      road:    new THREE.MeshStandardMaterial({ map: T.cobble, color: 0x4a4238, roughness: 0.98 }),
      curb:    new THREE.MeshStandardMaterial({ map: T.stone, color: 0x9a8e78, roughness: 0.9 }),
      timber:  new THREE.MeshStandardMaterial({ map: T.wood, color: 0x3a2410, roughness: 0.9 }),
      cloth: new THREE.MeshStandardMaterial({ color: 0xc8b890, roughness: 0.95 }),
      bedFrame: new THREE.MeshStandardMaterial({ map: T.wood, color: 0x4a2e18, roughness: 0.85 }),
      rail: new THREE.MeshStandardMaterial({ color: 0x9a8a78, metalness: 0.9, roughness: 0.25 }),
      grass: new THREE.MeshStandardMaterial({ map: T.grass, color: 0xa89a5a, roughness: 0.95 }),
      tuft: new THREE.MeshStandardMaterial({ color: 0xd8b85a, emissive: 0x4a3818, emissiveIntensity: 0.3, roughness: 0.9 }),
      trunk: new THREE.MeshStandardMaterial({ map: T.bark, color: 0x5a3e22, roughness: 0.95 }),
      leaves: new THREE.MeshStandardMaterial({ map: T.leaves, color: 0x4a7a48, roughness: 0.9 }),
      glassR: new THREE.MeshStandardMaterial({ color: 0xaa4040, emissive: 0xff3030, emissiveIntensity: 0.6, transparent: true, opacity: 0.7, metalness: 0.1, roughness: 0.15 }),
      glassB: new THREE.MeshStandardMaterial({ color: 0x4070aa, emissive: 0x3060ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.7, metalness: 0.1, roughness: 0.15 }),
      glassG: new THREE.MeshStandardMaterial({ color: 0x4aaa5a, emissive: 0x30ff60, emissiveIntensity: 0.55, transparent: true, opacity: 0.7, metalness: 0.1, roughness: 0.15 }),
      glassY: new THREE.MeshStandardMaterial({ color: 0xddbb3a, emissive: 0xffd040, emissiveIntensity: 0.7, transparent: true, opacity: 0.7, metalness: 0.1, roughness: 0.15 }),
      mirror: new THREE.MeshStandardMaterial({ color: 0xeef0ff, emissive: 0x88aacc, emissiveIntensity: 0.35, metalness: 0.9, roughness: 0.08 }),
      gold: new THREE.MeshStandardMaterial({ map: T.gold, color: 0xffe8a0, emissive: 0xffd060, emissiveIntensity: 1.2, metalness: 0.6, roughness: 0.25 }),
      altar: new THREE.MeshStandardMaterial({ map: T.wood, color: 0x8a6a3a, emissive: 0x402810, emissiveIntensity: 0.5 }),
      altarStone: new THREE.MeshStandardMaterial({ map: T.stone, color: 0x8a8278, roughness: 0.9 }),
      pillar: new THREE.MeshStandardMaterial({ map: T.stone, color: 0x7a7060, roughness: 0.88 }),
      pillarDark: new THREE.MeshStandardMaterial({ map: T.stone, color: 0x5a5040, roughness: 0.9 }),
      exitPad: new THREE.MeshStandardMaterial({ color: 0x6a5a3a, emissive: 0xffc060, emissiveIntensity: 1.3 }),
    };

    // Shared geometries
    const G = {
      bedFrame: new THREE.BoxGeometry(2, 0.45, 4.2),
      bedMattress: new THREE.BoxGeometry(1.9, 0.25, 4.0),
      pillow: new THREE.BoxGeometry(1.6, 0.15, 0.9),
      lamp: new THREE.SphereGeometry(0.22, 8, 6),
      tieBeam: new THREE.BoxGeometry(0.3, 0.4, 6),
    };

    // =====================================================================
    // HELPERS
    // =====================================================================
    const sceneAdd = (key: SceneKey, obj: THREE.Object3D) => groups[key].add(obj);

    const addBox = (
      key: SceneKey,
      x: number, y: number, z: number, w: number, h: number, d: number,
      mat: THREE.Material,
      solid = true,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y + h / 2, z);
      sceneAdd(key, mesh);
      if (solid) {
        // Local AABB computed directly — no world-matrix dependency.
        const box = new THREE.Box3(
          new THREE.Vector3(x - w / 2 - 0.05, y, z - d / 2 - 0.05),
          new THREE.Vector3(x + w / 2 + 0.05, y + h, z + d / 2 + 0.05),
        );
        colliderSets[key].push({ box });
      }
      return mesh;
    };


    /** Hollow building shell with a door gap. Returns door world coords + interior center. */
    const addBuilding = (
      key: SceneKey,
      cx: number, cz: number, w: number, h: number, d: number,
      wallMat: THREE.Material,
      doorSide: "south" | "north" | "east" | "west",
      doorWidth: number,
      addRoof = true,
      roofMat: THREE.Material = M.roof,
    ) => {
      const t = 0.4;
      const seg = (x: number, z: number, ww: number, hh: number, dd: number) =>
        addBox(key, x, 0, z, ww, hh, dd, wallMat, true);

      if (doorSide === "south") {
        const s = (w - doorWidth) / 2;
        seg(cx - (doorWidth / 2 + s / 2), cz + d / 2, s, h, t);
        seg(cx + (doorWidth / 2 + s / 2), cz + d / 2, s, h, t);
        addBox(key, cx, h - 0.8, cz + d / 2, doorWidth, 1.2, t, wallMat, false);
      } else seg(cx, cz + d / 2, w, h, t);

      if (doorSide === "north") {
        const s = (w - doorWidth) / 2;
        seg(cx - (doorWidth / 2 + s / 2), cz - d / 2, s, h, t);
        seg(cx + (doorWidth / 2 + s / 2), cz - d / 2, s, h, t);
        addBox(key, cx, h - 0.8, cz - d / 2, doorWidth, 1.2, t, wallMat, false);
      } else seg(cx, cz - d / 2, w, h, t);

      if (doorSide === "east") {
        const s = (d - doorWidth) / 2;
        seg(cx + w / 2, cz - (doorWidth / 2 + s / 2), t, h, s);
        seg(cx + w / 2, cz + (doorWidth / 2 + s / 2), t, h, s);
        addBox(key, cx + w / 2, h - 0.8, cz, t, 1.2, doorWidth, wallMat, false);
      } else seg(cx + w / 2, cz, t, h, d);

      if (doorSide === "west") {
        const s = (d - doorWidth) / 2;
        seg(cx - w / 2, cz - (doorWidth / 2 + s / 2), t, h, s);
        seg(cx - w / 2, cz + (doorWidth / 2 + s / 2), t, h, s);
        addBox(key, cx - w / 2, h - 0.8, cz, t, 1.2, doorWidth, wallMat, false);
      } else seg(cx - w / 2, cz, t, h, d);

      if (addRoof) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.4, d + 0.3), roofMat);
        r.position.set(cx, h + 0.2, cz);
        sceneAdd(key, r);
      }

      let dx = cx, dz = cz;
      if (doorSide === "south") dz = cz + d / 2;
      if (doorSide === "north") dz = cz - d / 2;
      if (doorSide === "east") dx = cx + w / 2;
      if (doorSide === "west") dx = cx - w / 2;
      return { doorX: dx, doorZ: dz };
    };

    // Floor tile (non-solid)
    const addFloor = (key: SceneKey, cx: number, cz: number, w: number, d: number, mat: THREE.Material) => {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      f.rotation.x = -Math.PI / 2;
      f.position.set(cx, 0.02, cz);
      sceneAdd(key, f);
      return f;
    };

    // Deterministic RNG
    let rs = 1337;
    const rand = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return (rs & 0xffffff) / 0xffffff; };

    // =====================================================================
    // SURFACE — LIGHTING
    // =====================================================================
    scene.add(new THREE.HemisphereLight(0xb8c4dc, 0x3a3024, 1.25));
    scene.add(new THREE.AmbientLight(0x806a60, 0.4));
    const sun = new THREE.DirectionalLight(0xffc890, 1.35);
    sun.position.set(140, 220, 80);
    scene.add(sun);
    // Sun disc (visible orb low on the horizon)
    const sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(22, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd090, fog: false }),
    );
    sunDisc.position.set(420, 90, 240);
    sceneAdd("surface", sunDisc);
    // Sun halo
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(40, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xff8040, transparent: true, opacity: 0.18, fog: false }),
    );
    halo.position.copy(sunDisc.position);
    sceneAdd("surface", halo);

    // Dust motes drifting through the air (Points)
    {
      const N = 800;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        pos[i * 3 + 0] = (Math.random() - 0.5) * 280;
        pos[i * 3 + 1] = Math.random() * 40 + 1;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 280;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xffd8a0, size: 0.18, transparent: true, opacity: 0.55,
        sizeAttenuation: true, depthWrite: false,
      });
      const motes = new THREE.Points(geo, mat);
      sceneAdd("surface", motes);
    }

    // =====================================================================
    // SURFACE — GROUND
    // =====================================================================
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), M.cobble);
    ground.rotation.x = -Math.PI / 2;
    sceneAdd("surface", ground);

    // =====================================================================
    // SURFACE — STREETS (lighter paved roads on top of cobble ground)
    // =====================================================================
    const roadGeoNS = new THREE.PlaneGeometry(6, 240);
    const roadGeoEW = new THREE.PlaneGeometry(240, 6);
    for (let k = -7; k <= 7; k++) {
      // E/W avenue at z = k*17
      const ew = new THREE.Mesh(roadGeoEW, M.road);
      ew.rotation.x = -Math.PI / 2;
      ew.position.set(0, 0.03, k * 17);
      sceneAdd("surface", ew);
      // N/S avenue at x = k*17
      const ns = new THREE.Mesh(roadGeoNS, M.road);
      ns.rotation.x = -Math.PI / 2;
      ns.position.set(k * 17, 0.03, 0);
      sceneAdd("surface", ns);
    }
    // central plaza ring (lighter cobble)
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(14, 32), M.curb);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(0, 0.04, 0);
    sceneAdd("surface", plaza);

    // =====================================================================
    // SURFACE — THE CITY (18th-century European aesthetic)
    // =====================================================================
    const facadeMats = [M.plaster, M.plasterDark, M.plaster, M.plasterDark];
    const accentMats = [M.brick, M.slate, M.stone3];
    const GRID = 7; // 15x15
    for (let i = -GRID; i <= GRID; i++) {
      for (let j = -GRID; j <= GRID; j++) {
        if (Math.abs(i) <= 1 && Math.abs(j) <= 1) continue; // plaza
        if (Math.abs(i) <= 1) continue; // N/S boulevard
        if (Math.abs(j) <= 1) continue; // E/W boulevard
        // Reserve slots
        if (i === -3 && j === -3) continue; // dormitory
        if (i === 0 && j === -6) continue; // council
        const x = i * 17 + (rand() - 0.5) * 1.4;
        const z = j * 17 + (rand() - 0.5) * 1.4;
        const w = 8 + rand() * 4;
        const dd = 8 + rand() * 5;
        // Taller 18th-century row houses (3-5 stories)
        const h = 6 + rand() * 7;
        const buildingStyle = Math.floor(rand() * 4);
        const mat = facadeMats[Math.floor(rand() * 4)];
        // Main building body
        addBox("surface", x, 0, z, w, h, dd, mat);
        // Ground floor accent (stone/brick base - common in 18th c.)
        const baseH = 1.2 + rand() * 0.6;
        const baseMat = buildingStyle === 0 ? M.brick : M.stone3;
        const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, baseH, dd + 0.02), baseMat);
        baseMesh.position.set(x, baseH / 2, z);
        sceneAdd("surface", baseMesh);
        // Horizontal string courses (cornices between floors)
        for (let floor = 1; floor < Math.floor(h / 2.8); floor++) {
          const corniceY = floor * 2.8;
          const cornice = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.08, dd + 0.04), M.timber);
          cornice.position.set(x, corniceY, z);
          sceneAdd("surface", cornice);
        }
        // Roof height varies with building style
        const roofH = 1.8 + rand() * 1.2;
        // Mansard roof (steep lower slope, flatter upper) - French 18th c.
        if (buildingStyle <= 1) {
          const mansardGeo = new THREE.ConeGeometry(Math.max(w, dd) * 0.72, roofH, 4);
          const mansardMesh = new THREE.Mesh(mansardGeo, M.roof);
          mansardMesh.rotation.y = Math.PI / 4;
          mansardMesh.position.set(x, h + roofH / 2, z);
          sceneAdd("surface", mansardMesh);
        } else {
          // Traditional gable
          const gableH = 2.2 + rand() * 1.5;
          const roofGeo = new THREE.ConeGeometry(Math.max(w, dd) * 0.68, gableH, 4);
          const roofMesh = new THREE.Mesh(roofGeo, M.roof);
          roofMesh.rotation.y = Math.PI / 4;
          roofMesh.position.set(x, h + gableH / 2, z);
          sceneAdd("surface", roofMesh);
        }
        // Dormer windows (only on front/back faces to avoid clipping)
        if (rand() > 0.5 && h > 8) {
          const dormerCount = 1 + Math.floor(rand() * 2);
          const dormerFace = rand() > 0.5 ? 1 : -1; // front (south) or back (north)
          for (let d = 0; d < dormerCount; d++) {
            const dormerX = x + (rand() - 0.5) * (w * 0.4); // centered within building
            const dormerZ = z + dormerFace * (dd / 2 + 0.4); // on front/back face
            const dormerW = 1.2, dormerH = 1.5, dormerD = 0.8;
            // Dormer box
            const dormerBox = new THREE.Mesh(new THREE.BoxGeometry(dormerW, dormerH, dormerD), mat);
            dormerBox.position.set(dormerX, h + dormerH / 2 + 0.3, dormerZ);
            sceneAdd("surface", dormerBox);
            // Dormer roof (small gable perpendicular to main roof)
            const dormerRoofH = 0.6;
            const dormerRoof = new THREE.Mesh(new THREE.ConeGeometry(dormerW * 0.9, dormerRoofH, 4), M.roof);
            dormerRoof.rotation.y = Math.PI / 4;
            dormerRoof.position.set(dormerX, h + dormerH + 0.3 + dormerRoofH / 2, dormerZ);
            sceneAdd("surface", dormerRoof);
            // Dormer window (glowing) - offset by half dormer depth
            const dormerWin = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0), M.window);
            dormerWin.position.set(dormerX, h + dormerH / 2 + 0.3, dormerZ + dormerFace * (dormerD / 2 + 0.01));
            if (dormerFace < 0) dormerWin.rotation.y = Math.PI;
            sceneAdd("surface", dormerWin);
          }
        }
        // Chimneys (positioned within building footprint, not floating)
        const chimneyCount = 1 + Math.floor(rand() * 2);
        for (let c = 0; c < chimneyCount; c++) {
          const chx = x + (rand() - 0.5) * (w * 0.5); // within building bounds
          const chz = z + (rand() - 0.5) * (dd * 0.5);
          const chimneyH = 1.8 + rand() * 0.8;
          const chimneyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, chimneyH, 0.5), M.brick);
          chimneyMesh.position.set(chx, h + chimneyH / 2, chz);
          sceneAdd("surface", chimneyMesh);
        }
        // Windows with shutters (multiple floors)
        for (let wy = 1.8; wy < h - 1; wy += 2.8) {
          // Pick a face for this floor
          const floorFace = rand() > 0.5 ? "south" : "north";
          if (rand() > 0.3) {
            const winW = 1.2 + rand() * 0.3;
            const winH = 1.4 + rand() * 0.3;
            const win = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), M.window);
            let wx = x, wz = z;
            const wallOffset = 0.03;
            if (floorFace === "south") { wz = z + dd / 2 + wallOffset; }
            else { wz = z - dd / 2 - wallOffset; win.rotation.y = Math.PI; }
            win.position.set(wx, wy, wz);
            sceneAdd("surface", win);
            // Shutters (closed on sides of window)
            if (rand() > 0.35) {
              const shutterMat = rand() > 0.5 ? M.timber : M.woodDark;
              const shutterW = 0.2, shutterH = winH;
              const leftShutter = new THREE.Mesh(new THREE.BoxGeometry(shutterW, shutterH, 0.04), shutterMat);
              const rightShutter = new THREE.Mesh(new THREE.BoxGeometry(shutterW, shutterH, 0.04), shutterMat);
              const shutterDepth = floorFace === "south" ? wallOffset + 0.02 : -(wallOffset + 0.02);
              leftShutter.position.set(wx - winW / 2 - shutterW / 2 - 0.02, wy, wz + shutterDepth);
              rightShutter.position.set(wx + winW / 2 + shutterW / 2 + 0.02, wy, wz + shutterDepth);
              sceneAdd("surface", leftShutter);
              sceneAdd("surface", rightShutter);
            }
          }
          // Also add east/west windows sometimes
          if (rand() > 0.6) {
            const winW = 1.1 + rand() * 0.25;
            const winH = 1.3 + rand() * 0.25;
            const ewFace = rand() > 0.5 ? "east" : "west";
            const win = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), M.window);
            let wx = x, wz = z;
            if (ewFace === "east") { wx = x + w / 2 + 0.03; win.rotation.y = Math.PI / 2; }
            else { wx = x - w / 2 - 0.03; win.rotation.y = -Math.PI / 2; }
            win.position.set(wx, wy, wz);
            sceneAdd("surface", win);
          }
        }
        // Window boxes / flower boxes under windows (only on front/back)
        if (rand() > 0.65) {
          const boxFace = j > 0 ? "north" : "south";
          const boxZ = boxFace === "north" ? z - dd / 2 - 0.15 : z + dd / 2 + 0.15;
          const flowerBox = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.22, 0.22), M.woodDark);
          flowerBox.position.set(x, 1.55, boxZ);
          sceneAdd("surface", flowerBox);
        }
      }
    }

    // Fire-burning street lamps along boulevards — 18th-century iron style
    const lampPostGeo = new THREE.CylinderGeometry(0.06, 0.1, 4.0, 8);
    const flameGeo = new THREE.ConeGeometry(0.22, 0.55, 6);
    const flameCoreGeo = new THREE.ConeGeometry(0.11, 0.35, 6);
    const flickerLamps: { light: THREE.PointLight | null; base: number; cone: THREE.Mesh; core?: THREE.Mesh }[] = [];
    for (let k = -GRID; k <= GRID; k++) {
      if (k === 0) continue;
      for (const [lx, lz] of [[-5, k * 17], [5, k * 17], [k * 17, -5], [k * 17, 5]] as const) {
        // Wrought iron post
        const post = new THREE.Mesh(lampPostGeo, M.rail);
        post.position.set(lx, 2.0, lz);
        sceneAdd("surface", post);
        // Lantern housing (glass box frame)
        const lanternH = 0.5;
        const lanternW = 0.32;
        const lanternBase = new THREE.Mesh(new THREE.BoxGeometry(lanternW, 0.06, lanternW), M.rail);
        lanternBase.position.set(lx, 4.06, lz);
        sceneAdd("surface", lanternBase);
        // Glass panes (implied by frame corners)
        const paneGeo = new THREE.BoxGeometry(0.04, lanternH, lanternW);
        for (const ox of [-lanternW/2 + 0.02, lanternW/2 - 0.02]) {
          const pane = new THREE.Mesh(paneGeo, M.rail);
          pane.position.set(lx + ox, 4.06 + lanternH/2, lz);
          sceneAdd("surface", pane);
        }
        const paneGeo2 = new THREE.BoxGeometry(lanternW, lanternH, 0.04);
        for (const oz of [-lanternW/2 + 0.02, lanternW/2 - 0.02]) {
          const pane = new THREE.Mesh(paneGeo2, M.rail);
          pane.position.set(lx, 4.06 + lanternH/2, lz + oz);
          sceneAdd("surface", pane);
        }
        // Lantern cap (pyramidal top)
        const capH = 0.18;
        const lanternCap = new THREE.Mesh(new THREE.ConeGeometry(lanternW * 0.8, capH, 4), M.rail);
        lanternCap.rotation.y = Math.PI / 4;
        lanternCap.position.set(lx, 4.06 + lanternH + capH/2, lz);
        sceneAdd("surface", lanternCap);
        // Flame inside lantern
        const flame = new THREE.Mesh(flameGeo, M.flame);
        flame.position.set(lx, 4.12, lz);
        sceneAdd("surface", flame);
        const core = new THREE.Mesh(flameCoreGeo, M.flameCore);
        core.position.set(lx, 4.09, lz);
        sceneAdd("surface", core);
        // Real PointLight
        const hasLight = (Math.abs(k) + (lx > 0 ? 0 : 1)) % 3 === 0;
        let pl: THREE.PointLight | null = null;
        if (hasLight) {
          pl = new THREE.PointLight(0xff9030, 1.6, 20);
          pl.position.set(lx, 4.2, lz);
          sceneAdd("surface", pl);
        }
        flickerLamps.push({ light: pl, base: 1.6, cone: flame, core });
      }
    }

    // Central plaza fire — bigger, real light
    const fire = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.6, 12), M.fire);
    fire.position.set(0, 0.3, 0);
    sceneAdd("surface", fire);
    const plazaFlame = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.6, 8), M.flame);
    plazaFlame.position.set(0, 1.8, 0);
    sceneAdd("surface", plazaFlame);
    const plazaCore = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 8), M.flameCore);
    plazaCore.position.set(0, 1.6, 0);
    sceneAdd("surface", plazaCore);
    const fireLight = new THREE.PointLight(0xff7733, 2.6, 60);
    fireLight.position.set(0, 2, 0);
    sceneAdd("surface", fireLight);
    flickerLamps.push({ light: fireLight, base: 2.6, cone: plazaFlame });

    // =====================================================================
    // SURFACE — DORMITORY exterior shell
    // =====================================================================
    const DORM_CX = -51, DORM_CZ = -51;
    const dormExt = addBuilding("surface", DORM_CX, DORM_CZ, 24, 7, 16, M.plasterDark, "north", 3.4);
    // Door marker mesh (the wooden door, locked-looking)
    const dormDoor = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.6, 0.18), M.doorWood);
    dormDoor.position.set(dormExt.doorX, 2.3, dormExt.doorZ - 0.05);
    sceneAdd("surface", dormDoor);

    // =====================================================================
    // SURFACE — IRON GRATING
    // =====================================================================
    const GRATE_X = 130, GRATE_Z = 0;
    for (const [ox, oz, sw, sd] of [[-2.3, 0, 0.6, 5], [2.3, 0, 0.6, 5], [0, -2.3, 5, 0.6], [0, 2.3, 5, 0.6]] as const) {
      addBox("surface", GRATE_X + ox, 0, GRATE_Z + oz, sw, 0.4, sd, M.plasterDark, false);
    }
    const shaftHole = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.8), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    shaftHole.rotation.x = -Math.PI / 2;
    shaftHole.position.set(GRATE_X, 0.04, GRATE_Z);
    sceneAdd("surface", shaftHole);
    const grate = new THREE.Mesh(new THREE.BoxGeometry(4, 0.18, 4), M.ironGrate);
    grate.position.set(GRATE_X, 0.1, GRATE_Z);
    sceneAdd("surface", grate);
    let grateOpen = false;
    let grateSlideT = 0;

    // =====================================================================
    // SURFACE — FIELD (fully fenced, only opens through the south wall gap)
    // =====================================================================
    for (let x = -140; x <= 140; x += 5) {
      if (Math.abs(x) < 5) continue;
      addBox("surface", x, 0, 150, 4.5, 2.4, 1.2, M.plasterDark);
    }
    // wheat field perimeter fence — east, west, and far south sides
    for (let z = 152; z <= 388; z += 4) {
      addBox("surface", -140, 0, z, 0.4, 1.6, 4, M.woodDark);
      addBox("surface", 140, 0, z, 0.4, 1.6, 4, M.woodDark);
    }
    for (let x = -140; x <= 140; x += 4) {
      addBox("surface", x, 0, 388, 4, 1.6, 0.4, M.woodDark);
    }
    const fieldMesh = new THREE.Mesh(new THREE.PlaneGeometry(340, 240), M.grass);
    fieldMesh.rotation.x = -Math.PI / 2;
    fieldMesh.position.set(0, 0.02, 270);
    sceneAdd("surface", fieldMesh);
    const tuftGeo = new THREE.ConeGeometry(0.35, 1.3, 4);
    for (let i = 0; i < 180; i++) {
      const tuft = new THREE.Mesh(tuftGeo, M.tuft);
      tuft.position.set((rand() - 0.5) * 320, 0.65, 170 + rand() * 200);
      sceneAdd("surface", tuft);
    }
    // ----- GARDEN GATE PUZZLE -----
    // A stone wall closes off the field. Three pedestals of ascending height
    // stand before it. Press E on them shortest→tallest to open the gate.
    // (Clue scroll pinned to the wall.)
    const GATE_Z = 200;
    const stoneWallMat = new THREE.MeshStandardMaterial({ color: 0x5a5348, roughness: 0.95, metalness: 0.02 });
    // Wall segments span from x=-140 to x=-10 and x=10 to x=140 → opening 20 wide.
    addBox("surface", -75, 0, GATE_Z, 130, 4, 0.8, stoneWallMat);
    addBox("surface",  75, 0, GATE_Z, 130, 4, 0.8, stoneWallMat);
    // Gate posts flush against wall ends
    addBox("surface", -10.5, 0, GATE_Z, 1.4, 5.2, 1.4, M.pillarDark);
    addBox("surface",  10.5, 0, GATE_Z, 1.4, 5.2, 1.4, M.pillarDark);
    // Raised lintel above head height. It is decorative only so it cannot leave
    // a hidden floor-level blocker after the portcullis opens.
    addBox("surface", 0, 4.8, GATE_Z, 22, 0.8, 0.8, M.woodDark, false);
    // Gate itself — a wooden portcullis, 20 wide to fully fill the opening
    const gateMesh = new THREE.Mesh(new THREE.BoxGeometry(20, 4, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.85, metalness: 0.1 }));
    gateMesh.position.set(0, 2, GATE_Z);
    sceneAdd("surface", gateMesh);
    const gateCollider = { box: new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(0, 2, GATE_Z), new THREE.Vector3(20, 4, 0.6)) };
    colliderSets.surface.push(gateCollider);
    const gatePuzzle = {
      mesh: gateMesh,
      collider: gateCollider,
      open: false,
      order: [] as number[],
      solved: false,
    };
    // Three pedestals on the CITY side of the gate (player approaches from z<200).
    const pedHeights = [0.9, 1.6, 1.25]; // indices 0,1,2 — correct shortest→tallest = 0,2,1
    const pedPositions: Array<[number, number]> = [[-9, 192], [4, 188], [10, 194]];
    const pedestals: Array<{ idx: number; base: THREE.Mesh; flame: THREE.Mesh; light: THREE.PointLight; lit: boolean; pos: THREE.Vector3 }> = [];
    for (let i = 0; i < 3; i++) {
      const [px, pz] = pedPositions[i];
      const h = pedHeights[i];
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, h, 12),
        new THREE.MeshStandardMaterial({ color: 0x6a6055, roughness: 0.95, map: T.stone }));
      base.position.set(px, h / 2, pz);
      sceneAdd("surface", base);
      // Rune on top — a Roman-numeral-ish rectangle groove
      const rune = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.05 + i * 0.08),
        new THREE.MeshStandardMaterial({ color: 0x1a1410, emissive: 0x000000 }));
      rune.position.set(px, h + 0.02, pz);
      sceneAdd("surface", rune);
      // Unlit flame bowl
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 8),
        new THREE.MeshStandardMaterial({ color: 0x1a120a, emissive: 0xff8020, emissiveIntensity: 0 }));
      flame.position.set(px, h + 0.32, pz);
      sceneAdd("surface", flame);
      const pl = new THREE.PointLight(0xffa050, 0, 8, 2);
      pl.position.set(px, h + 0.5, pz);
      sceneAdd("surface", pl);
      pedestals.push({ idx: i, base, flame, light: pl, lit: false, pos: new THREE.Vector3(px, h + 0.3, pz) });
    }
    const correctOrder = [0, 2, 1]; // sorted by ascending height

    // Liberty 5-3000
    const liberty = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 1.7, 10),
      new THREE.MeshLambertMaterial({ color: 0xe8d18a }));
    body.position.y = 0.85; liberty.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xffe8b8, emissive: 0x886622, emissiveIntensity: 0.45 }));
    head.position.y = 1.95; liberty.add(head);
    liberty.position.set(20, 0, 250);
    sceneAdd("surface", liberty);

    // =====================================================================
    // SURFACE — COUNCIL HALL EXTERIOR (grand institutional building)
    // =====================================================================
    const COUNCIL_CX = 0, COUNCIL_CZ = -160;
    // Exterior shell — slate grey institutional look
    addBox("surface", COUNCIL_CX, 0, COUNCIL_CZ + 18, 50, 16, 0.5, M.slate); // front
    addBox("surface", COUNCIL_CX, 0, COUNCIL_CZ - 18, 50, 16, 0.5, M.slate); // back
    addBox("surface", COUNCIL_CX + 25, 0, COUNCIL_CZ, 0.5, 16, 36, M.slate);
    addBox("surface", COUNCIL_CX - 25, 0, COUNCIL_CZ, 0.5, 16, 36, M.slate);
    // Grand stone portico columns
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      addBox("surface", COUNCIL_CX + i * 8, 0, COUNCIL_CZ + 22, 1.6, 13, 1.6, M.pillarDark);
    }
    // Classical pediment triangle above door
    const pedimentGeo = new THREE.ConeGeometry(12, 4, 3);
    const pedimentMesh = new THREE.Mesh(pedimentGeo, M.stone3);
    pedimentMesh.rotation.x = Math.PI / 2;
    pedimentMesh.rotation.z = Math.PI;
    pedimentMesh.position.set(COUNCIL_CX, 18, COUNCIL_CZ + 20);
    sceneAdd("surface", pedimentMesh);
    // roof slab
    const councilRoof = new THREE.Mesh(new THREE.BoxGeometry(52, 0.6, 38), M.slate);
    councilRoof.position.set(COUNCIL_CX, 16.3, COUNCIL_CZ);
    sceneAdd("surface", councilRoof);
    // Grand double door with arch
    const councilDoor = new THREE.Mesh(new THREE.BoxGeometry(6, 9, 0.3), M.doorWood);
    councilDoor.position.set(COUNCIL_CX, 4.5, COUNCIL_CZ + 18.2);
    sceneAdd("surface", councilDoor);
    // Ornate door frame
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(6.8, 9.8, 0.2), M.stone3);
    doorFrame.position.set(COUNCIL_CX, 4.5, COUNCIL_CZ + 18.1);
    sceneAdd("surface", doorFrame);
    // Arched window above door
    const archWin = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 8, 0, Math.PI * 2, Math.PI / 2), M.window);
    archWin.rotation.x = Math.PI / 2;
    archWin.position.set(COUNCIL_CX, 12, COUNCIL_CZ + 18.3);
    sceneAdd("surface", archWin);

    // =====================================================================
    // SURFACE — UNCHARTED FOREST
    // =====================================================================
    // Forest gate (still uses gate system — it's a barrier, not a door)
    const gates: Gate[] = [];
    const addGate = (x: number, z: number, orient: "ns" | "ew", w: number, unlockAfter: number, label: string) => {
      const ww = orient === "ns" ? w : 0.6;
      const dd = orient === "ns" ? 0.6 : w;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(ww, 3.6, dd), M.door);
      mesh.position.set(x, 1.8, z);
      sceneAdd("surface", mesh);
      const box = new THREE.Box3().setFromObject(mesh).expandByScalar(0.1);
      const collider = { box };
      colliderSets.surface.push(collider);
      gates.push({ unlockAfter, collider, mesh, open: false, label, position: new THREE.Vector3(x, 1.8, z) });
    };
    addGate(-140, 0, "ns", 8, 4, "Forest forbidden — flee the Council first");

    const trunkGeo = new THREE.CylinderGeometry(0.45, 0.6, 9, 5);
    const topGeo = new THREE.ConeGeometry(2.6, 6, 6);
    for (let i = 0; i < 240; i++) {
      const x = -160 - rand() * 280;
      const z = (rand() - 0.5) * 420;
      const trunk = new THREE.Mesh(trunkGeo, M.trunk);
      trunk.position.set(x, 4.5, z);
      sceneAdd("surface", trunk);
      const top = new THREE.Mesh(topGeo, M.leaves);
      top.position.set(x, 11, z);
      sceneAdd("surface", top);
      // Cheap cylinder collider via expanded box
      const box = new THREE.Box3(new THREE.Vector3(x - 0.7, 0, z - 0.7), new THREE.Vector3(x + 0.7, 9, z + 0.7));
      colliderSets.surface.push({ box });
    }
    // Forest marker
    const FOREST_X = -200, FOREST_Z = 0;
    const forestMarker = addBox("surface", FOREST_X, 0, FOREST_Z, 1.5, 0.3, 1.5, M.altar, false);
    forestMarker.position.y = 0.15;

    // =====================================================================
    // WORLD BORDER — ring of trees + invisible wall + heavy outer fog
    // =====================================================================
    // A big ring at radius ~460 so the surface world stops feeling infinite.
    const BORDER_R = 460;
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      const bx = Math.cos(a) * BORDER_R;
      const bz = Math.sin(a) * BORDER_R;
      // Skip if too close to forest region (already has trees)
      if (bx < -140 && Math.abs(bz) < 240) continue;
      const trunk = new THREE.Mesh(trunkGeo, M.trunk);
      trunk.position.set(bx, 4.5, bz);
      sceneAdd("surface", trunk);
      const top = new THREE.Mesh(topGeo, M.leaves);
      top.position.set(bx, 11, bz);
      sceneAdd("surface", top);
    }
    // A second inner ring so it reads as a wall of woods
    for (let a = 0.025; a < Math.PI * 2; a += 0.06) {
      const r = BORDER_R - 12;
      const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
      if (bx < -140 && Math.abs(bz) < 240) continue;
      const trunk = new THREE.Mesh(trunkGeo, M.trunk);
      trunk.position.set(bx, 4.5, bz);
      sceneAdd("surface", trunk);
      const top = new THREE.Mesh(topGeo, M.leaves);
      top.position.set(bx, 11, bz);
      sceneAdd("surface", top);
    }
    // Hard invisible wall at radius BORDER_R + 4 — implemented as segmented boxes
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const r = BORDER_R + 6;
      const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
      const box = new THREE.Box3(
        new THREE.Vector3(bx - 20, 0, bz - 20),
        new THREE.Vector3(bx + 20, 30, bz + 20),
      );
      // Only add walls that don't cover playable area (skip anything inside r-30)
      if (Math.hypot(bx, bz) > BORDER_R) colliderSets.surface.push({ box });
    }



    // =====================================================================
    // SURFACE — GLASS HOUSE EXTERIOR
    // =====================================================================
    const HX = -420, HZ = 0;
    const HW = 22, HH = 9, HD = 26, HT = 0.4, HDOOR = 4;
    const hs = (HW - HDOOR) / 2;
    // south wall with door gap (red glass)
    addBox("surface", HX - (HDOOR / 2 + hs / 2), 0, HZ + HD / 2, hs, HH, HT, M.glassR);
    addBox("surface", HX + (HDOOR / 2 + hs / 2), 0, HZ + HD / 2, hs, HH, HT, M.glassR);
    addBox("surface", HX, HH - 0.8, HZ + HD / 2, HDOOR, 1.2, HT, M.glassR, false);
    addBox("surface", HX, 0, HZ - HD / 2, HW, HH, HT, M.glassB); // north blue
    addBox("surface", HX + HW / 2, 0, HZ, HT, HH, HD, M.glassG); // east green
    addBox("surface", HX - HW / 2, 0, HZ, HT, HH, HD, M.glassY); // west yellow
    const houseRoofMesh = new THREE.Mesh(new THREE.BoxGeometry(HW + 0.4, 0.3, HD + 0.4), M.roof);
    houseRoofMesh.position.set(HX, HH + 0.15, HZ);
    sceneAdd("surface", houseRoofMesh);
    // door
    const houseDoor = new THREE.Mesh(new THREE.BoxGeometry(HDOOR, 5.2, 0.3), M.doorWood);
    houseDoor.position.set(HX, 2.6, HZ + HD / 2 + 0.05);
    sceneAdd("surface", houseDoor);

    // =====================================================================
    // INTERIOR — DORMITORY (period: long hall, oil lamps, iron cots)
    // =====================================================================
    // Big room ~ 28 x 18, low ceiling
    const D_W = 28, D_D = 18, D_H = 5;
    // Floor (wood plank)
    addFloor("dorm", 0, 0, D_W, D_D, M.wood);
    // Ceiling
    const dormCeil = new THREE.Mesh(new THREE.PlaneGeometry(D_W, D_D), M.woodDark);
    dormCeil.rotation.x = Math.PI / 2;
    dormCeil.position.set(0, D_H, 0);
    sceneAdd("dorm", dormCeil);
    // Four walls (plaster, no openings — this is a sealed room)
    addBox("dorm", 0, 0, -D_D / 2, D_W, D_H, 0.3, M.plaster);
    addBox("dorm", 0, 0, D_D / 2, D_W, D_H, 0.3, M.plaster);
    addBox("dorm", -D_W / 2, 0, 0, 0.3, D_H, D_D, M.plaster);
    addBox("dorm", D_W / 2, 0, 0, 0.3, D_H, D_D, M.plaster);
    // Exposed ceiling beams
    for (let i = -2; i <= 2; i++) {
      const beam = new THREE.Mesh(G.tieBeam, M.woodDark);
      beam.rotation.y = Math.PI / 2;
      beam.position.set(i * 5, D_H - 0.2, 0);
      // make beam span full width
      beam.scale.set(D_W / 6, 1, 1);
      sceneAdd("dorm", beam);
    }
    // Two rows of iron cots
    for (let row = 0; row < 2; row++) {
      const zRow = row === 0 ? -5 : 5;
      for (let i = 0; i < 6; i++) {
        const bx = -10 + i * 4;
        const frame = new THREE.Mesh(G.bedFrame, M.bedFrame);
        frame.position.set(bx, 0.25, zRow);
        sceneAdd("dorm", frame);
        const mattress = new THREE.Mesh(G.bedMattress, M.cloth);
        mattress.position.set(bx, 0.6, zRow);
        sceneAdd("dorm", mattress);
        const pillow = new THREE.Mesh(G.pillow, M.window);
        pillow.position.set(bx, 0.78, zRow - 1.4);
        sceneAdd("dorm", pillow);
      }
    }
    // Player's cot (highlighted) with the parchment underneath, near the entry
    const myCot = new THREE.Mesh(G.bedFrame, M.bedFrame);
    myCot.position.set(11, 0.25, 0);
    sceneAdd("dorm", myCot);
    addBox("dorm", 11, 0, -2, 1.4, 0.5, 1.4, M.wood, false); // small chest at foot
    // Parchment on chest — glows
    const parchment = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xeed9a4, emissive: 0xffe080, emissiveIntensity: 1.4 }));
    parchment.position.set(11, 0.78, -2);
    sceneAdd("dorm", parchment);
    // Oil lamp on a wall sconce
    const lamp1 = new THREE.Mesh(G.lamp, M.candle);
    lamp1.position.set(-10, 3.6, -D_D / 2 + 0.4);
    sceneAdd("dorm", lamp1);
    const dormLight1 = new THREE.PointLight(0xffc070, 1.4, 26);
    dormLight1.position.set(-10, 3.6, -D_D / 2 + 0.4);
    sceneAdd("dorm", dormLight1);
    const lamp2 = new THREE.Mesh(G.lamp, M.candle);
    lamp2.position.set(8, 3.6, D_D / 2 - 0.4);
    sceneAdd("dorm", lamp2);
    const dormLight2 = new THREE.PointLight(0xffc070, 1.4, 26);
    dormLight2.position.set(8, 3.6, D_D / 2 - 0.4);
    sceneAdd("dorm", dormLight2);
    // Exit pad — at one end, glowing — labeled "the door"
    const dormExit = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.15, 1.6), M.exitPad);
    dormExit.position.set(-D_W / 2 + 1.5, 0.08, 0);
    sceneAdd("dorm", dormExit);
    // Visible door frame at exit
    addBox("dorm", -D_W / 2 + 0.3, 0, 0, 0.4, 4.5, 3.2, M.doorWood, false);

    // =====================================================================
    // INTERIOR — UNDERGROUND (a clean enclosed network — no holes)
    // =====================================================================
    // Junction chamber
    const J = 18, JH = 5;
    addFloor("underground", 0, 0, J, J, M.tunnelFloor);
    const jc = new THREE.Mesh(new THREE.PlaneGeometry(J, J), M.tunnelCeil);
    jc.rotation.x = Math.PI / 2;
    jc.position.set(0, JH, 0);
    sceneAdd("underground", jc);
    // Junction walls with 4 openings (one per compass direction)
    // Each opening is 6 wide centered.
    const OPEN = 6;
    const side = (J - OPEN) / 2;
    for (const sign of [-1, 1] as const) {
      // North/south walls have openings in X
      const s1 = (-J / 2) + side / 2;
      const s2 = (J / 2) - side / 2;
      addBox("underground", sign * s1, 0, -J / 2, side, JH, 0.4, M.tunnelWall);
      addBox("underground", sign * s2, 0, -J / 2, side, JH, 0.4, M.tunnelWall);
      addBox("underground", sign * s1, 0, J / 2, side, JH, 0.4, M.tunnelWall);
      addBox("underground", sign * s2, 0, J / 2, side, JH, 0.4, M.tunnelWall);
      // East/west walls have openings in Z
      addBox("underground", -J / 2, 0, sign * s1, 0.4, JH, side, M.tunnelWall);
      addBox("underground", -J / 2, 0, sign * s2, 0.4, JH, side, M.tunnelWall);
      addBox("underground", J / 2, 0, sign * s1, 0.4, JH, side, M.tunnelWall);
      addBox("underground", J / 2, 0, sign * s2, 0.4, JH, side, M.tunnelWall);
    }
    // Shared underground decoration geometry/materials
    const archPostGeo = new THREE.BoxGeometry(0.35, JH, 0.35);
    const chainGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 4);
    const cageGeo = new THREE.BoxGeometry(0.32, 0.42, 0.32);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const stalGeo = new THREE.ConeGeometry(0.22, 1.4, 5);
    const puddleGeo = new THREE.CircleGeometry(1.1, 12);
    const puddleMat = new THREE.MeshStandardMaterial({ color: 0x0e141a, roughness: 0.05, metalness: 0.85 });
    const mossMat = new THREE.MeshStandardMaterial({ color: 0x2a4a2a, emissive: 0x0a2a10, emissiveIntensity: 0.25, roughness: 1 });
    const mossGeo = new THREE.CircleGeometry(0.8, 8);
    const tunnelFlicker: THREE.PointLight[] = [];

    // Corridor builder — closed box: floor, ceiling, two solid walls, capped at far end
    const buildCorridor = (
      fromX: number, fromZ: number, toX: number, toZ: number,
      width = OPEN, height = JH,
      capFar = false,
    ) => {
      const dx = toX - fromX, dz = toZ - fromZ;
      const len = Math.hypot(dx, dz);
      const angle = Math.atan2(dz, dx);
      const cx = (fromX + toX) / 2, cz = (fromZ + toZ) / 2;
      // floor
      const f = new THREE.Mesh(new THREE.PlaneGeometry(len, width), M.tunnelFloor);
      f.rotation.x = -Math.PI / 2;
      f.rotation.z = -angle;
      f.position.set(cx, 0.02, cz);
      sceneAdd("underground", f);
      // ceiling
      const c = new THREE.Mesh(new THREE.PlaneGeometry(len, width), M.tunnelCeil);
      c.rotation.x = Math.PI / 2;
      c.rotation.z = angle;
      c.position.set(cx, height, cz);
      sceneAdd("underground", c);
      // walls
      const nx = -Math.sin(angle), nz = Math.cos(angle);
      const tx = Math.cos(angle), tz = Math.sin(angle); // tangent along corridor
      const ax = Math.abs(tx) * (len / 2) + Math.abs(nx) * 0.2;
      const az = Math.abs(tz) * (len / 2) + Math.abs(nz) * 0.2;
      for (const sgn of [-1, 1]) {
        const wx = cx + nx * (width / 2) * sgn;
        const wz = cz + nz * (width / 2) * sgn;
        const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(len, height, 0.4), M.tunnelWall);
        wallMesh.position.set(wx, height / 2, wz);
        wallMesh.rotation.y = -angle;
        sceneAdd("underground", wallMesh);
        const box = new THREE.Box3(
          new THREE.Vector3(wx - ax - 0.05, 0, wz - az - 0.05),
          new THREE.Vector3(wx + ax + 0.05, height, wz + az + 0.05),
        );
        colliderSets.underground.push({ box });
      }
      if (capFar) {
        // End cap wall perpendicular to corridor at the far end (rotated 90°)
        const cap = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.4), M.tunnelWall);
        cap.position.set(toX, height / 2, toZ);
        cap.rotation.y = -angle + Math.PI / 2;
        sceneAdd("underground", cap);
        // After +90° rotation, the cap's length runs along the normal axis.
        const cax = Math.abs(nx) * (width / 2) + Math.abs(tx) * 0.2;
        const caz = Math.abs(nz) * (width / 2) + Math.abs(tz) * 0.2;
        const box = new THREE.Box3(
          new THREE.Vector3(toX - cax - 0.05, 0, toZ - caz - 0.05),
          new THREE.Vector3(toX + cax + 0.05, height, toZ + caz + 0.05),
        );
        colliderSets.underground.push({ box });
      }

      // rails
      for (const sgn of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.1), M.rail);
        rail.position.set(cx + nx * 0.7 * sgn, 0.1, cz + nz * 0.7 * sgn);
        rail.rotation.y = -angle;
        sceneAdd("underground", rail);
      }
      // timber support arches — posts + lintel every ~9 units (mine-shaft look)
      const archCount = Math.max(1, Math.floor(len / 9));
      for (let i = 0; i < archCount; i++) {
        const at = -len / 2 + (i + 0.5) * (len / archCount);
        const ax2 = cx + Math.cos(angle) * at;
        const az2 = cz + Math.sin(angle) * at;
        for (const sgn of [-1, 1]) {
          const post = new THREE.Mesh(archPostGeo, M.timber);
          post.position.set(ax2 + nx * (width / 2 - 0.35) * sgn, height / 2 - 0.15, az2 + nz * (width / 2 - 0.35) * sgn);
          post.rotation.y = -angle;
          sceneAdd("underground", post);
        }
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(width - 0.3, 0.35, 0.4), M.woodDark);
        lintel.position.set(ax2, height - 0.35, az2);
        lintel.rotation.y = -angle + Math.PI / 2;
        sceneAdd("underground", lintel);
      }
      // hanging iron lanterns on chains
      const lanternCount = Math.max(1, Math.floor(len / 18));
      for (let i = 0; i < lanternCount; i++) {
        const lt = -len / 2 + (i + 0.5) * (len / lanternCount);
        const lx = cx + Math.cos(angle) * lt;
        const lz = cz + Math.sin(angle) * lt;
        const chain = new THREE.Mesh(chainGeo, M.bedFrame);
        chain.position.set(lx, height - 0.3, lz);
        sceneAdd("underground", chain);
        const cage = new THREE.Mesh(cageGeo, M.ironGrate);
        cage.position.set(lx, height - 0.75, lz);
        sceneAdd("underground", cage);
        const lan = new THREE.Mesh(G.lamp, M.lantern);
        lan.scale.setScalar(0.65);
        lan.position.set(lx, height - 0.75, lz);
        sceneAdd("underground", lan);
        // only every other lantern gets a real light
        if (i % 2 === 0) {
          const pl = new THREE.PointLight(0xffaa55, 1.3, 22);
          pl.position.set(lx, height - 0.75, lz);
          sceneAdd("underground", pl);
          tunnelFlicker.push(pl);
        }
      }
      // scattered rubble along the walls
      for (let i = 0; i < Math.floor(len / 7); i++) {
        const rt = -len / 2 + rand() * len;
        const sgn = rand() > 0.5 ? 1 : -1;
        const rx = cx + Math.cos(angle) * rt + nx * (width / 2 - 0.6 - rand() * 0.5) * sgn;
        const rz = cz + Math.sin(angle) * rt + nz * (width / 2 - 0.6 - rand() * 0.5) * sgn;
        const rock = new THREE.Mesh(rockGeo, M.stone3);
        const s = 0.15 + rand() * 0.35;
        rock.scale.setScalar(s);
        rock.position.set(rx, s * 0.5, rz);
        rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
        sceneAdd("underground", rock);
      }
      // stalactites
      for (let i = 0; i < Math.floor(len / 12); i++) {
        const st = -len / 2 + rand() * len;
        const sx = cx + Math.cos(angle) * st + nx * (rand() - 0.5) * (width - 1.5);
        const sz = cz + Math.sin(angle) * st + nz * (rand() - 0.5) * (width - 1.5);
        const stal = new THREE.Mesh(stalGeo, M.tunnelWall);
        stal.position.set(sx, height - 0.5, sz);
        stal.rotation.x = Math.PI;
        stal.scale.setScalar(0.6 + rand() * 0.8);
        sceneAdd("underground", stal);
      }
      // shallow puddles catching the lantern light
      if (rand() > 0.4) {
        const pt = -len / 2 + rand() * len;
        const puddle = new THREE.Mesh(puddleGeo, puddleMat);
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.set(cx + Math.cos(angle) * pt + nx * (rand() - 0.5), 0.035, cz + Math.sin(angle) * pt + nz * (rand() - 0.5));
        puddle.scale.setScalar(0.7 + rand() * 1.2);
        sceneAdd("underground", puddle);
      }
      // moss patches on the walls
      for (let i = 0; i < Math.floor(len / 16); i++) {
        const mt = -len / 2 + rand() * len;
        const sgn = rand() > 0.5 ? 1 : -1;
        const mx = cx + Math.cos(angle) * mt + nx * (width / 2 - 0.25) * sgn;
        const mz = cz + Math.sin(angle) * mt + nz * (width / 2 - 0.25) * sgn;
        const moss = new THREE.Mesh(mossGeo, mossMat);
        moss.position.set(mx, 0.6 + rand() * 1.8, mz);
        moss.rotation.y = Math.atan2(nx * -sgn, nz * -sgn);
        moss.scale.set(0.6 + rand(), 0.4 + rand() * 0.6, 1);
        sceneAdd("underground", moss);
      }
    };

    // Main corridors radiating from the junction. Each is CAPPED so there
    // are no exposed ends. The "light box" room is the end of the north
    // corridor, with its own enclosed chamber.
    buildCorridor(0, -J / 2, 0, -90, OPEN, JH, false); // north corridor → leads to chamber
    buildCorridor(0, J / 2, 0, 70, OPEN, JH, true);    // south, dead end
    buildCorridor(-J / 2, 0, -110, 0, OPEN, JH, true); // west
    buildCorridor(J / 2, 0, 110, 0, OPEN, JH, true);   // east

    // Light box chamber at end of north corridor: 16x16 room
    const CHX = 0, CHZ = -110, CHS = 16;
    // floor
    addFloor("underground", CHX, CHZ, CHS, CHS, M.tunnelFloor);
    // ceiling
    const chCeil = new THREE.Mesh(new THREE.PlaneGeometry(CHS, CHS), M.tunnelCeil);
    chCeil.rotation.x = Math.PI / 2;
    chCeil.position.set(CHX, JH, CHZ);
    sceneAdd("underground", chCeil);
    // 4 walls with single opening on the south side connecting to corridor
    const chOpen = OPEN;
    const chSide = (CHS - chOpen) / 2;
    // south wall: opening to corridor (corridor ends at z=-90, chamber south face at CHZ + CHS/2 = -102)
    // So we need to extend corridor up to chamber south wall. Re-cap:
    // The north corridor goes (0,-9) → (0,-90). Chamber south face is at -102.
    // Bridge gap with another corridor segment from (0,-90) to (0,-102).
    buildCorridor(0, -90, 0, -102, chOpen, JH, false);
    addBox("underground", -chSide / 2 - chOpen / 2, 0, CHZ + CHS / 2, chSide, JH, 0.4, M.tunnelWall);
    addBox("underground", chSide / 2 + chOpen / 2, 0, CHZ + CHS / 2, chSide, JH, 0.4, M.tunnelWall);
    // north wall (back of chamber, solid)
    addBox("underground", CHX, 0, CHZ - CHS / 2, CHS, JH, 0.4, M.tunnelWall);
    // east/west walls solid
    addBox("underground", CHX + CHS / 2, 0, CHZ, 0.4, JH, CHS, M.tunnelWall);
    addBox("underground", CHX - CHS / 2, 0, CHZ, 0.4, JH, CHS, M.tunnelWall);
    // Altar — a wooden workbench with the invention on top
    const lbAltar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.8), M.altar);
    lbAltar.position.set(CHX, 0.45, CHZ - 2);
    sceneAdd("underground", lbAltar);
    // Wooden base for the bulb (like a physics prof's apparatus)
    const bulbBase = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.25, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x3a2818, map: T.wood, roughness: 0.9 }));
    bulbBase.position.set(CHX, 1.0, CHZ - 2);
    sceneAdd("underground", bulbBase);
    // Brass socket
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.35, 12),
      new THREE.MeshStandardMaterial({ color: 0xb08838, metalness: 0.85, roughness: 0.3 }));
    socket.position.set(CHX, 1.32, CHZ - 2);
    sceneAdd("underground", socket);
    // Glass bulb (the "light without fire") — dark until you BUILD it
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff8dd, emissive: 0xfff0aa, emissiveIntensity: 0,
      transparent: true, opacity: 0.85, roughness: 0.1, metalness: 0.1,
    });
    const lightBox = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 16), bulbMat);
    lightBox.position.set(CHX, 1.68, CHZ - 2);
    lightBox.visible = false;
    sceneAdd("underground", lightBox);
    // Filament (thin bright wire loop)
    const filamentMat = new THREE.MeshBasicMaterial({ color: 0x443322 });
    const filament = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 6, 16), filamentMat);
    filament.position.set(CHX, 1.68, CHZ - 2);
    filament.rotation.x = Math.PI / 2;
    filament.visible = false;
    sceneAdd("underground", filament);
    // Copper wires trailing from base to a small battery/jar
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10),
      new THREE.MeshStandardMaterial({ color: 0x8a9aa8, metalness: 0.7, roughness: 0.3, transparent: true, opacity: 0.6 }));
    jar.position.set(CHX + 0.7, 1.15, CHZ - 2);
    jar.visible = false;
    sceneAdd("underground", jar);
    const wires: THREE.Mesh[] = [];
    for (let w = 0; w < 2; w++) {
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6),
        new THREE.MeshStandardMaterial({ color: 0xb87a3a, metalness: 0.8, roughness: 0.4 }));
      wire.position.set(CHX + 0.35, 1.15 + (w === 0 ? 0.15 : -0.05), CHZ - 2);
      wire.rotation.z = Math.PI / 2;
      wire.visible = false;
      sceneAdd("underground", wire);
      wires.push(wire);
    }
    const lbLight = new THREE.PointLight(0xffeeaa, 0, 40);
    lbLight.position.set(CHX, 2.4, CHZ - 2);
    sceneAdd("underground", lbLight);

    // Hand-crank dynamo beside the bench — you spin this to charge the light
    const dynamoBase = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.8), M.stone3);
    dynamoBase.position.set(CHX + 2.2, 0.45, CHZ - 2);
    sceneAdd("underground", dynamoBase);
    const crankWheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0x8a7a5a, metalness: 0.85, roughness: 0.3 }));
    crankWheel.position.set(CHX + 2.2, 1.25, CHZ - 2);
    crankWheel.rotation.y = Math.PI / 2;
    sceneAdd("underground", crankWheel);
    const crankHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6),
      new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.8 }));
    crankHandle.position.set(0, 0.42, 0);
    crankWheel.add(crankHandle);

    // THE LIGHT — build state. Find 3 parts in the dead-end tunnels, mount
    // them on the bench, then crank the dynamo until the filament catches.
    const lightBuild = { parts: 0, assembled: false, charge: 0, lit: false, cranking: false };
    type LightPart = { name: string; pos: THREE.Vector3; mesh: THREE.Object3D; taken: boolean };
    const lightPartsArr: LightPart[] = [];
    const makePart = (name: string, x: number, z: number, build: (g: THREE.Group) => void) => {
      const g = new THREE.Group();
      build(g);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x80c0ff, transparent: true, opacity: 0.15 }));
      g.add(glow);
      g.position.set(x, 1.0, z);
      sceneAdd("underground", g);
      lightPartsArr.push({ name, pos: new THREE.Vector3(x, 1.0, z), mesh: g, taken: false });
    };
    // glass bulb — south dead end
    makePart("a blown glass globe", 0, 66, (g) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10),
        new THREE.MeshStandardMaterial({ color: 0xcfe8f0, transparent: true, opacity: 0.7, roughness: 0.1 }));
      g.add(b);
    });
    // copper coil — west dead end
    makePart("a coil of copper wire", -106, 0, (g) => {
      const c = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0xb87a3a, metalness: 0.85, roughness: 0.35 }));
      c.rotation.x = Math.PI / 2;
      g.add(c);
    });
    // storm jar — east dead end
    makePart("a jar that holds lightning", 106, 0, (g) => {
      const j = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.42, 10),
        new THREE.MeshStandardMaterial({ color: 0x8a9aa8, metalness: 0.7, roughness: 0.3, transparent: true, opacity: 0.65 }));
      g.add(j);
    });


    // Stair pad back to the surface — placed in the junction
    const stair = new THREE.Mesh(new THREE.BoxGeometry(3, 0.25, 3), M.exitPad);
    stair.position.set(0, 0.13, 6);
    sceneAdd("underground", stair);
    const stairLight = new THREE.PointLight(0xffd58a, 2.2, 18);
    stairLight.position.set(0, 3.5, 6);
    sceneAdd("underground", stairLight);
    // Ambient so it's not pitch black between lanterns
    sceneAdd("underground", new THREE.AmbientLight(0x2a2018, 0.55));
    sceneAdd("underground", new THREE.HemisphereLight(0x3a2a18, 0x0a0806, 0.35));

    // =====================================================================
    // INTERIOR — COUNCIL HALL (vast colonnaded chamber)
    // =====================================================================
    const C_W = 36, C_D = 28, C_H = 14;
    addFloor("council", 0, 0, C_W, C_D, M.altarStone);
    // ceiling
    const cCeil = new THREE.Mesh(new THREE.PlaneGeometry(C_W, C_D), M.woodDark);
    cCeil.rotation.x = Math.PI / 2;
    cCeil.position.set(0, C_H, 0);
    sceneAdd("council", cCeil);
    // walls
    addBox("council", 0, 0, -C_D / 2, C_W, C_H, 0.4, M.plasterDark);
    addBox("council", 0, 0, C_D / 2, C_W, C_H, 0.4, M.plasterDark);
    addBox("council", -C_W / 2, 0, 0, 0.4, C_H, C_D, M.plasterDark);
    addBox("council", C_W / 2, 0, 0, 0.4, C_H, C_D, M.plasterDark);
    // Two rows of pillars
    for (let i = -2; i <= 2; i++) {
      addBox("council", i * 6, 0, -7, 1.2, C_H, 1.2, M.pillar);
      addBox("council", i * 6, 0, 7, 1.2, C_H, 1.2, M.pillar);
    }
    // Long council table at the far end
    addBox("council", 0, 0, -C_D / 2 + 4, 18, 1.1, 1.6, M.wood);
    // Five chairs behind
    for (let i = -2; i <= 2; i++) {
      addBox("council", i * 3.4, 0, -C_D / 2 + 2.5, 1.2, 2.2, 1.2, M.woodDark);
    }
    // Altar at center where you present the light
    const councilAltar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 2.4), M.altar);
    councilAltar.position.set(0, 0.6, 0);
    sceneAdd("council", councilAltar);
    // braziers
    for (const [bx, bz] of [[-10, -4], [10, -4]] as const) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M.fire);
      t.position.set(bx, 4.5, bz);
      sceneAdd("council", t);
      const pl = new THREE.PointLight(0xff7733, 2.0, 26);
      pl.position.set(bx, 5.2, bz);
      sceneAdd("council", pl);
    }
    sceneAdd("council", new THREE.AmbientLight(0x6a5a48, 0.55));
    sceneAdd("council", new THREE.HemisphereLight(0xc8a880, 0x2a1810, 0.5));
    // Exit pad — at the south entrance
    const councilExit = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.15, 1.6), M.exitPad);
    councilExit.position.set(0, 0.08, C_D / 2 - 1.5);
    sceneAdd("council", councilExit);
    addBox("council", 0, 0, C_D / 2 - 0.3, 6, 9, 0.4, M.doorWood, false);

    // Five Council scholars seated behind the table (cutscene actors)
    const councilBoard: { mesh: THREE.Group; pos: THREE.Vector3; name: string }[] = [];
    const councilNames = ["World Scholar 1-8100", "Scholar Collective 1-1998", "Judge 2-5991", "Council 8-4111", "Scholar 3-0090"];
    for (let i = -2; i <= 2; i++) {
      const g = new THREE.Group();
      const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 2.0, 10),
        new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.95 }));
      robe.position.y = 1.0; g.add(robe);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xe8c8a8, roughness: 0.8 }));
      head.position.y = 2.25; g.add(head);
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 8),
        new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.9 }));
      hood.position.y = 2.55; g.add(hood);
      g.position.set(i * 3.4, 0, -C_D / 2 + 3);
      g.rotation.y = Math.PI; // face south toward player
      sceneAdd("council", g);
      councilBoard.push({ mesh: g, pos: new THREE.Vector3(i * 3.4, 1, -C_D / 2 + 3), name: councilNames[i + 2] });
    }


    // =====================================================================
    // INTERIOR — GLASS HOUSE (period: rugs, books, mirrors)
    // =====================================================================
    const H_W = 22, H_D = 26, H_H = 9;
    addFloor("house", 0, 0, H_W, H_D, M.wood);
    // Slight tint walls inside to echo the colored glass
    addBox("house", 0, 0, -H_D / 2, H_W, H_H, 0.3, M.plaster);
    addBox("house", 0, 0, H_D / 2, H_W, H_H, 0.3, M.plaster);
    addBox("house", -H_W / 2, 0, 0, 0.3, H_H, H_D, M.plaster);
    addBox("house", H_W / 2, 0, 0, 0.3, H_H, H_D, M.plaster);
    const hCeil = new THREE.Mesh(new THREE.PlaneGeometry(H_W, H_D), M.woodDark);
    hCeil.rotation.x = Math.PI / 2;
    hCeil.position.set(0, H_H, 0);
    sceneAdd("house", hCeil);
    // colored window slits (interior side of the glass walls)
    for (const [px, pz, ry, mat] of [
      [0, H_D / 2 - 0.31, Math.PI, M.glassR],
      [0, -H_D / 2 + 0.31, 0, M.glassB],
      [H_W / 2 - 0.31, 0, -Math.PI / 2, M.glassG],
      [-H_W / 2 + 0.31, 0, Math.PI / 2, M.glassY],
    ] as const) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), mat as THREE.Material);
      pane.position.set(px as number, 4.5, pz as number);
      pane.rotation.y = ry as number;
      sceneAdd("house", pane);
    }
    // furniture: bookcase
    addBox("house", -H_W / 2 + 1.2, 0, -6, 1.6, 5, 4, M.wood);
    addBox("house", -H_W / 2 + 1.2, 0, 0, 1.6, 5, 4, M.wood);
    addBox("house", -H_W / 2 + 1.2, 0, 6, 1.6, 5, 4, M.wood);
    // mirror
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5, 2.4), M.mirror);
    mirror.position.set(H_W / 2 - 0.4, 2.5, -6);
    sceneAdd("house", mirror);
    // table
    addBox("house", 4, 0, 0, 4, 1.1, 2.2, M.wood, false);
    // rug
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(8, 12),
      new THREE.MeshLambertMaterial({ color: 0x6a2a2a }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.04, 0);
    sceneAdd("house", rug);
    // The Book on a pedestal
    addBox("house", 0, 0, -H_D / 2 + 4, 1.4, 1.1, 1.4, M.wood, false);
    const bookGroup = new THREE.Group();
    const book = new THREE.Mesh(new THREE.BoxGeometry(1, 0.18, 1.3), M.gold);
    bookGroup.add(book);
    bookGroup.position.set(0, 1.5, -H_D / 2 + 4);
    sceneAdd("house", bookGroup);
    const bookLight = new THREE.PointLight(0xffeebb, 3.2, 26);
    bookLight.position.set(0, 2.3, -H_D / 2 + 4);
    sceneAdd("house", bookLight);
    sceneAdd("house", new THREE.AmbientLight(0x5a4a30, 0.55));
    sceneAdd("house", new THREE.HemisphereLight(0xffd58a, 0x2a1a10, 0.7));
    const houseExit = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.15, 1.6), M.exitPad);
    houseExit.position.set(0, 0.08, H_D / 2 - 1.5);
    sceneAdd("house", houseExit);
    addBox("house", 0, 0, H_D / 2 - 0.3, 4, 5, 0.4, M.doorWood, false);

    // =====================================================================
    // NPCs — silent brothers of the city with dialogue
    // =====================================================================
    type NPC = {
      sceneKey: SceneKey;
      position: THREE.Vector3;
      name: string;
      lines: string[];
      idx: number;
      mesh: THREE.Group;
      wander?: { cx: number; cz: number; r: number; phase: number; speed: number };
    };
    const npcs: NPC[] = [];
    const makeNPC = (
      key: SceneKey, x: number, z: number,
      robe: number, hair: number, name: string, lines: string[],
      wander?: { r: number; speed: number },
    ) => {
      const g = new THREE.Group();
      const bd = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.5, 1.7, 10),
        new THREE.MeshStandardMaterial({ color: robe, roughness: 0.95 }),
      );
      bd.position.y = 0.85; g.add(bd);
      const hd = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xe8c8a8, roughness: 0.8 }),
      );
      hd.position.y = 1.95; g.add(hd);
      const hr = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 10, 8),
        new THREE.MeshStandardMaterial({ color: hair, roughness: 0.9 }),
      );
      hr.position.y = 2.05; hr.scale.y = 0.65; g.add(hr);
      g.position.set(x, 0, z);
      sceneAdd(key, g);
      // Stationary NPCs get a soft collider; wanderers don't (would need per-frame updates)
      if (!wander) {
        colliderSets[key].push({
          box: new THREE.Box3(
            new THREE.Vector3(x - 0.6, 0, z - 0.6),
            new THREE.Vector3(x + 0.6, 2.2, z + 0.6),
          ),
        });
      }
      const npc: NPC = {
        sceneKey: key, position: new THREE.Vector3(x, 1, z), name, lines, idx: 0, mesh: g,
        wander: wander ? { cx: x, cz: z, r: wander.r, phase: Math.random() * Math.PI * 2, speed: wander.speed } : undefined,
      };
      npcs.push(npc);
      return npc;
    };

    // International 4-8818 — your only friend, in the dormitory
    makeNPC("dorm", 6, 0, 0x4a4030, 0x2a1a08, "International 4-8818", [
      "We are International 4-8818. We laugh when no others laugh. They beat us for it.",
      "You hide things, Equality 7-2521. We see. We will say nothing.",
      "If you find what lies beneath the iron grating, we will follow you into the dark.",
    ]);
    // The Teacher — central plaza, recites the creed
    makeNPC("surface", -6, 6, 0x2a3a4a, 0x1a1a1a, "Teacher 0521", [
      "We are nothing. Mankind is all. We exist through, by, and for our brothers.",
      "There is no transgression blacker than to do or think alone.",
      "Why do your eyes wander to the iron grating, street sweeper? Look at the ground.",
    ]);
    // A frightened scholar outside the Council
    makeNPC("surface", -8, -140, 0x6a4a2a, 0x3a2a1a, "Collective 0-0009", [
      "The Council convenes within. Do not approach unless summoned.",
      "Strange — the lamps in the city have flickered since the last storm.",
      "If you bring them a thing not given by the Council… run, brother. Just run.",
    ]);
    // A wanderer at the edge of the field
    makeNPC("surface", 18, 220, 0x3a4a3a, 0x4a3a1a, "Solidarity 9-6347", [
      "The Golden One tends the fields. We are forbidden to look at her.",
      "Some nights she sings without words. The Council does not know.",
    ]);

    // =====================================================================
    // PICKUPS — lantern (required) + 3 hidden forbidden fragments
    // =====================================================================
    type Pickup = {
      kind: "lantern" | "fragment" | "scroll";
      sceneKey: SceneKey;
      position: THREE.Vector3;
      mesh: THREE.Object3D;
      taken: boolean;
      label: string;
      scrollText?: string;
      scrollTitle?: string;
    };
    const pickups: Pickup[] = [];


    // Forge stall near the grate — EMPTY (the lantern is hidden elsewhere now)
    const FORGE_X = GRATE_X - 14, FORGE_Z = GRATE_Z - 4;
    addBox("surface", FORGE_X - 2, 0, FORGE_Z, 0.4, 3.2, 0.4, M.bedFrame);
    addBox("surface", FORGE_X + 2, 0, FORGE_Z, 0.4, 3.2, 0.4, M.bedFrame);
    addBox("surface", FORGE_X, 3.2, FORGE_Z, 5, 0.3, 3, M.roof, false);
    addBox("surface", FORGE_X, 0, FORGE_Z - 1.2, 4, 1.1, 1.8, M.stone3, false); // anvil bench
    // empty peg where the lantern once hung
    addBox("surface", FORGE_X, 2.0, FORGE_Z - 0.3, 0.1, 0.4, 0.1, M.bedFrame, false);
    // forge embers (no lantern, but the coals still burn — fire feel)
    const embers = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.8), M.flame);
    embers.position.set(FORGE_X, 1.25, FORGE_Z - 1.2);
    sceneAdd("surface", embers);
    const emberLight = new THREE.PointLight(0xff5520, 1.2, 10);
    emberLight.position.set(FORGE_X, 1.6, FORGE_Z - 1.2);
    sceneAdd("surface", emberLight);
    flickerLamps.push({ light: emberLight, base: 1.2, cone: embers });
    // a note pinned on the forge bench tells you where the lantern went
    const forgeNote = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xeed9a4, emissive: 0xffe080, emissiveIntensity: 1.0 }));
    forgeNote.position.set(FORGE_X, 1.72, FORGE_Z - 1.2);
    sceneAdd("surface", forgeNote);
    pickups.push({
      kind: "scroll", sceneKey: "surface",
      position: new THREE.Vector3(FORGE_X, 1.7, FORGE_Z - 1.2),
      mesh: forgeNote, taken: false,
      label: "Read the forge note",
      scrollTitle: "Pinned to the empty forge",
      scrollText: "The iron lantern is missing. Brother International borrowed it last night and hid it beneath his cot in the Home of the Street Sweepers. The Council must not see.",
    });

    // The actual lantern — hidden under a cot in the dormitory (must explore)
    const lanternHook = new THREE.Group();
    const lanternBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.55, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x3a2a18, emissive: 0xffb060, emissiveIntensity: 1.6, metalness: 0.5, roughness: 0.5 }),
    );
    lanternHook.add(lanternBody);
    lanternHook.position.set(-10, 0.35, 5); // under the far cot in the dorm
    sceneAdd("dorm", lanternHook);
    const lanternHiddenLight = new THREE.PointLight(0xffb060, 0.9, 6);
    lanternHiddenLight.position.set(-10, 0.5, 5);
    sceneAdd("dorm", lanternHiddenLight);
    pickups.push({
      kind: "lantern", sceneKey: "dorm",
      position: new THREE.Vector3(-10, 0.5, 5),
      mesh: lanternHook, taken: false,
      label: "Take the hidden lantern",
    });

    // 3 forbidden fragments hidden across the world
    const fragMat = new THREE.MeshStandardMaterial({
      color: 0xe8d4a0, emissive: 0xff6020, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.3,
    });
    const placeFragment = (key: SceneKey, x: number, y: number, z: number, hint: string) => {
      const f = new THREE.Mesh(new THREE.TetrahedronGeometry(0.35), fragMat);
      f.position.set(x, y, z);
      sceneAdd(key, f);
      pickups.push({
        kind: "fragment", sceneKey: key,
        position: new THREE.Vector3(x, y, z),
        mesh: f, taken: false,
        label: hint,
      });
    };
    // 1) Behind a building in the city
    placeFragment("surface", 64, 1.2, 36, "Pick up the shard — a relic of the Unmentionable Times");
    // 2) Deep in the forest
    placeFragment("surface", -340, 1.2, 90, "Pick up the shard — a relic of the Unmentionable Times");
    // 3) Tucked in a dead-end underground corridor
    placeFragment("underground", 100, 1.2, 0, "Pick up the shard — a relic of the Unmentionable Times");

    // =====================================================================
    // READABLE SCROLLS — quotes from the novella, scattered across the world
    // =====================================================================
    const scrollMat = new THREE.MeshStandardMaterial({
      color: 0xe8d4a0, emissive: 0x402008, emissiveIntensity: 0.4, roughness: 0.85,
    });
    const placeScroll = (key: SceneKey, x: number, y: number, z: number, title: string, text: string) => {
      const g = new THREE.Group();
      const scroll = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 8), scrollMat);
      scroll.rotation.z = Math.PI / 2;
      g.add(scroll);
      // soft glow
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.18 }),
      );
      g.add(glow);
      g.position.set(x, y, z);
      sceneAdd(key, g);
      pickups.push({
        kind: "scroll", sceneKey: key,
        position: new THREE.Vector3(x, y, z),
        mesh: g, taken: false,
        label: `Read: ${title}`,
        scrollTitle: title,
        scrollText: text,
      });
    };
    placeScroll("dorm", -6, 1.2, 4, "A scrap from the Home of the Students",
      "It is a sin to write this. It is a sin to think words no others think. We know all this, and yet we cannot stop.");
    placeScroll("surface", 26, 1.2, -8, "Charcoal on a cobblestone wall",
      "The word which our ear must never hear, the word our tongue must never speak — the Unspeakable Word — has been lost.");
    placeScroll("council", 0, 1.2, 6, "A page torn from a Council ledger",
      "What is not done collectively cannot be good. There is no transgression blacker than to do or think alone.");
    placeScroll("house", 6, 1.2, -4, "A child's primer from the Unmentionable Times",
      "I owe nothing to my brothers, nor do I gather debts from them. I ask none to live for me, nor do I live for any others. I am. I think. I will.");
    placeScroll("underground", -60, 1.2, 0, "A blackened sheet of iron",
      "Beneath the iron grating lay the tunnels of a forgotten age. We have descended where no man has dared in a hundred years.");

    // =====================================================================
    // EXTRA NPCs — the deformed brother, the weeper, the saint of the pyre
    // =====================================================================
    makeNPC("dorm", -4, -4, 0x3a3a3a, 0x1a1a1a, "Union 5-3992", [
      "Our brain is empty, they say. Our teeth fall out. We do not mind.",
      "You burn the candle when no one sees. We will not tell.",
    ]);
    makeNPC("surface", 40, -40, 0x5a3a3a, 0x2a1a1a, "Fraternity 2-5503", [
      "We weep at night without reason. We do not know why.",
      "It is forbidden, not to be happy. We are guilty.",
    ]);
    makeNPC("surface", -2, -180, 0x6a2a2a, 0x1a1a1a, "Saint of the Pyre", [
      "They burned our tongue out, brother. We spoke the Unspeakable Word.",
      "Look not at us with pity — look, and remember the word.",
      "EGO. Say it once, when you are far from here.",
    ]);

    // Wandering street NPCs — they walk slow circles along the boulevards
    makeNPC("surface", 30, 8, 0x4a3a2a, 0x2a1a08, "Equality 9-1112", [
      "We walk our route. The Council numbered us a Street Sweeper, same as you.",
      "Lift your eyes from the cobbles too often and they note it, brother.",
    ], { r: 10, speed: 0.6 });
    makeNPC("surface", -40, 25, 0x3a4a3a, 0x1a2a1a, "Liberty 11-590", [
      "We carry water for the Home of the Scholars. The pail is heavy. Our brothers are silent.",
      "Once we saw a bird. It flew without permission.",
    ], { r: 14, speed: 0.7 });
    makeNPC("surface", 55, -22, 0x4a3a4a, 0x2a1a2a, "Harmony 7-2342", [
      "Forty years we have swept the south boulevard. Forty.",
      "If you go beyond the wall, do not come back to tell us. We could not bear to know.",
    ], { r: 18, speed: 0.55 });
    makeNPC("surface", -25, -55, 0x5a4a2a, 0x2a1a08, "Council Guard 8-2", [
      "Halt. State your number. ...Pass, then. The Council does not mark you yet.",
      "We watch the iron grating. Do not loiter near it, sweeper.",
    ], { r: 8, speed: 0.45 });
    makeNPC("surface", 20, -80, 0x3a3a5a, 0x1a1a2a, "Similarity 5-0306", [
      "We are like our brothers. Our brothers are like us. There is comfort in that. There must be.",
    ], { r: 12, speed: 0.65 });

    // More fragments hidden across the world (now 5 total)
    placeFragment("surface", -88, 1.2, 110, "Pick up the shard — a relic of the Unmentionable Times");
    placeFragment("house", -8, 1.2, 8, "Pick up the shard — a relic of the Unmentionable Times");

    // More scrolls (more side reading between checkpoints)
    placeScroll("surface", -64, 1.2, 64, "Charcoal on the back of a sweeper's hut",
      "We strive to be like all our brothers, for all men must be alike. ... And yet, in our heart — we have committed the great transgression. We have preferred our own work to that of our brothers.");
    placeScroll("surface", 92, 1.2, -50, "A torn page caught in a lamp post",
      "We loved the Science of Things. We wished to know. We wished to know about all the things which make the earth around us. ... It is not good to feel too much.");
    placeScroll("underground", 0, 1.2, 60, "Carved into a tunnel beam",
      "There were once a great many such tunnels. ... We do not know who made them. The Council does not speak of them. We are not permitted to wonder.");



    // =====================================================================
    // PLAYER-CARRIED LANTERN — point light parented to camera
    // =====================================================================
    // PLAYER LANTERN — bright omni + forward SpotLight cone so it lights the world
    const carriedLantern = new THREE.PointLight(0xffc080, 0.0, 55, 1.3);
    carriedLantern.position.set(0.4, -0.2, -0.2);
    camera.add(carriedLantern);
    const lanternSpot = new THREE.SpotLight(0xffd08a, 0.0, 60, Math.PI / 3.2, 0.55, 1.2);
    lanternSpot.position.set(0.3, -0.1, -0.2);
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0.3, -0.1, -20);
    camera.add(spotTarget);
    lanternSpot.target = spotTarget;
    camera.add(lanternSpot);

    scene.add(camera); // camera must be in scene graph for its children to render


    // =====================================================================
    // DOORS — surface entry points into each interior
    // =====================================================================
    const doors: Door[] = [
      {
        surfacePos: new THREE.Vector3(dormExt.doorX, 1, dormExt.doorZ - 1.2),
        target: "dorm",
        interiorSpawn: new THREE.Vector3(-D_W / 2 + 3.5, 1.7, 0),
        interiorYaw: -Math.PI / 2, // face east (into the hall)
        unlockAfter: -1, // always open (you start inside it)
        label: "Enter the dormitory",
        lockedLabel: "",
        mesh: dormDoor,
      },
      {
        surfacePos: new THREE.Vector3(COUNCIL_CX, 1, COUNCIL_CZ + 19),
        target: "council",
        interiorSpawn: new THREE.Vector3(0, 1.7, C_D / 2 - 3.5),
        interiorYaw: Math.PI, // face north (toward altar)
        unlockAfter: 3, // after meeting the Golden One
        label: "Enter the Council Hall",
        lockedLabel: "The Council door is sealed — meet the Golden One first",
        mesh: councilDoor,
      },
      {
        surfacePos: new THREE.Vector3(HX, 1, HZ + HD / 2 + 1.2),
        target: "house",
        interiorSpawn: new THREE.Vector3(0, 1.7, H_D / 2 - 3.5),
        interiorYaw: Math.PI,
        unlockAfter: 5, // after the forest
        label: "Step into the glass house",
        lockedLabel: "Walk the forest first",
        mesh: houseDoor,
      },
    ];

    // =====================================================================
    // BEACONS (only on surface)
    // =====================================================================
    const beaconForBeat: Record<string, THREE.Mesh> = {};
    const makeBeacon = (id: string, x: number, z: number, color: number, key: SceneKey = "surface") => {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 80, 8, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
      );
      beam.position.set(x, 40, z);
      sceneAdd(key, beam);
      beaconForBeat[id] = beam;
    };
    // start beacon points at your cot inside the dorm (won't show on surface)
    makeBeacon("start", 11, 11, 0xffcc66, "dorm");
    makeBeacon("tunnel_entry", GRATE_X, GRATE_Z, 0xff8844);
    makeBeacon("tunnel_light", CHX, CHZ - 2, 0xfff0aa, "underground");
    makeBeacon("field_meet", 20, 250, 0xffd070);
    makeBeacon("council", COUNCIL_CX, COUNCIL_CZ + 19, 0xffaa66);
    makeBeacon("forest", FOREST_X, FOREST_Z, 0x88ffaa);
    makeBeacon("house", HX, HZ + HD / 2 + 1.2, 0xff88dd);
    makeBeacon("ego", 0, -H_D / 2 + 4, 0xffffff, "house");

    // =====================================================================
    // INTERACTABLES (each tied to a scene)
    // =====================================================================
    const interactables: Interactable[] = [
      { beatId: "start", position: new THREE.Vector3(11, 1, -2), label: "Take the parchment", order: 0, sceneKey: "dorm" },
      // order 1 = grate (special-cased)

      { beatId: "field_meet", position: liberty.position.clone(), label: "Approach the Golden One", order: 3, sceneKey: "surface" },
      { beatId: "council", position: new THREE.Vector3(0, 1, 0), label: "Present the light to the Council", order: 4, sceneKey: "council" },
      { beatId: "forest", position: new THREE.Vector3(FOREST_X, 1, FOREST_Z), label: "Enter the Uncharted Forest", order: 5, sceneKey: "surface" },
      { beatId: "house", position: new THREE.Vector3(0, 1, 0), label: "Look around the house", order: 6, sceneKey: "house" },
      { beatId: "ego", position: new THREE.Vector3(0, 1.5, -H_D / 2 + 4), label: "Open the book", order: 7, sceneKey: "house" },
    ];

    const OBJECTIVES = [
      "Take the parchment from beneath your cot",
      "Step outside — find the iron grating east of the city",
      "Descend into the tunnel — scavenge parts and BUILD the light",
      "Climb out — cross the south wall to meet the Golden One",
      "Return to the Council Hall — present the light",
      "Flee west — enter the Uncharted Forest",
      "Find the glass house deep in the forest",
      "Open the book — discover the sacred word",
    ];
    setObjective(OBJECTIVES[0]);

    // =====================================================================
    // STATE
    // =====================================================================
    let currentScene: SceneKey = "dorm"; // SPAWN INSIDE THE DORMITORY
    groups.surface.visible = false;
    groups.dorm.visible = true;
    applyAmbience(currentScene);

    // Player starts inside the dormitory near the cot.
    // Camera lives in WORLD coords, so we add the scene's X offset.
    camera.position.set(SCENE_OFFSETS.dorm + (-D_W / 2 + 5), 1.7, 0);
    let yaw = -Math.PI / 2;
    let pitch = 0;

    // `spawn` is in LOCAL coords of the target scene; we add the offset here.
    const switchScene = (target: SceneKey, spawn: THREE.Vector3, yawNew: number) => {
      groups[currentScene].visible = false;
      currentScene = target;
      groups[target].visible = true;
      camera.position.set(SCENE_OFFSETS[target] + spawn.x, spawn.y, spawn.z);
      yaw = yawNew;
      sfx.portal();
      applyAmbience(target);
      console.log("[scene]", target, "colliders=", colliderSets[target].length, "spawn", spawn);
    };


    // =====================================================================
    // CONTROLS
    // =====================================================================
    const keys: Record<string, boolean> = {};
    const onKey = (e: KeyboardEvent, down: boolean) => {
      keys[e.code] = down;
      if (e.code === "Space" && document.pointerLockElement === renderer.domElement) e.preventDefault();
      if (down && e.code === "KeyE") tryInteract();
      if (down && e.code === "Escape") { setActiveBeat(null); activeBeatRef.current = null; }
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
      resumeAudio();
      if (activeBeatRef.current) return;
      renderer.domElement.requestPointerLock();
    });


    // =====================================================================
    // INTERACTION
    // =====================================================================
    const advanceTo = (order: number) => {
      progressRef.current = order;
      setProgress(order);
      // Unlock gates that depended on lower order
      for (const g of gates) {
        if (!g.open && order > g.unlockAfter) {
          g.open = true;
          const idx = colliderSets.surface.indexOf(g.collider);
          if (idx >= 0) colliderSets.surface.splice(idx, 1);
          g.mesh.visible = false;
        }
      }
      // Update door visuals (highlight unlocked doors)
      for (const d of doors) {
        if (d.mesh && order - 1 >= d.unlockAfter) {
          (d.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9;
        }
      }
      if (order < OBJECTIVES.length) setObjective(OBJECTIVES[order]);
      if (order >= STORY.length) setFinished(true);
    };

    // Council cutscene → chase scene machinery
    const councilLines: { by: number; line: string }[] = [
      { by: 0, line: "You bring a thing not given by the Council. Explain yourself, street sweeper." },
      { by: 2, line: "It is a light without fire! It will banish the dark from every Home in the city!" },
      { by: 4, line: "How dared you, gutter cleaner, to think that your mind held greater wisdom than the minds of your brothers?" },
      { by: 1, line: "The candle was made by the collective. It is a good thing. Why should you seek to replace it?" },
      { by: 3, line: "You have worked alone. This is the great transgression. There is no crime blacker." },
      { by: 0, line: "Guards! Seize him — the light must be broken and the offender broken with it!" },
    ];
    let cutsceneIdx = 0;
    const spawnGuards = () => {
      // Guards spawn tight against the council doorway, behind the fleeing player.
      for (let i = 0; i < 3; i++) {
        const g = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x502010, roughness: 0.85, emissive: 0x000000, emissiveIntensity: 0.6 });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 1.9, 10), bodyMat);
        body.position.y = 0.95; g.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10),
          new THREE.MeshStandardMaterial({ color: 0x2a1a0a }));
        head.position.y = 2.15; g.add(head);
        const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6),
          new THREE.MeshStandardMaterial({ color: 0x3a2a18 }));
        spear.position.set(0.5, 1.2, 0); g.add(spear);
        // Vision cone hint — a faint translucent wedge at eye height
        const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6, 3, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
        cone.rotation.x = -Math.PI / 2;
        cone.position.set(0, 1.8, 3);
        g.add(cone);
        // Spawn AT the council door, well behind the player's spawn point.
        g.position.set(COUNCIL_CX + (i - 1) * 3, 0, COUNCIL_CZ + 19);
        sceneAdd("surface", g);
        chaseState.guards.push({
          mesh: g, pos: g.position.clone(),
          state: "seek",
          lastSeen: new THREE.Vector3(camera.position.x, 0, camera.position.z),
          searchT: 0, searchDir: Math.random() * Math.PI * 2,
          bodyMat,
          home: g.position.clone(),
          avoidT: 0, avoidSign: 1,
        });
      }
    };
    const startChase = () => {
      chaseState.active = true;
      chaseState.timeLeft = 90;
      chaseState.headStart = 2.0; // seconds before guards begin pursuit
      setChase({ active: true, timeLeft: 90 });
      setObjective("RUN — reach the iron grate! (Council guards are chasing)");
      // Teleport player OUT in front of the council, facing the city (yaw = π = south/-z? no, +z direction).
      // Player must run toward the grate at GRATE_X, GRATE_Z (which is north of city).
      switchScene("surface", new THREE.Vector3(COUNCIL_CX, 1.7, COUNCIL_CZ + 40), 0);
      spawnGuards();
      // Re-request pointer lock in case cutscene overlay dropped it.
      try { renderer.domElement.requestPointerLock(); } catch { /* ignore */ }
      sfx.bell();
    };
    const advanceCouncilCutscene = () => {
      if (cutsceneIdx >= councilLines.length) {
        // Done — start chase
        setNpcLine(null);
        startChase();
        return;
      }
      const l = councilLines[cutsceneIdx++];
      setNpcLine({ name: councilBoard[l.by].name, line: l.line });
      sfx.interact();
    };


    const tryInteract = () => {
      if (activeBeatRef.current) {
        setActiveBeat(null);
        activeBeatRef.current = null;
        return;
      }
      // If council cutscene is running, E advances lines
      if (councilCutscene.active) {
        advanceCouncilCutscene();
        return;
      }
      if (npcLineRef.current) { npcLineRef.current = null; setNpcLine(null); return; }
      const p = camera.position;
      const localP = new THREE.Vector3(p.x - SCENE_OFFSETS[currentScene], p.y, p.z);

      // GARDEN PEDESTAL PUZZLE — press E on pedestals shortest→tallest to open the gate
      if (currentScene === "surface" && !gatePuzzle.solved) {
        for (const ped of pedestals) {
          if (ped.lit) continue;
          if (localP.distanceTo(ped.pos) < 2.2) {
            const expected = correctOrder[gatePuzzle.order.length];
            if (ped.idx === expected) {
              ped.lit = true;
              (ped.flame.material as THREE.MeshStandardMaterial).emissiveIntensity = 3;
              ped.light.intensity = 2.4;
              gatePuzzle.order.push(ped.idx);
              sfx.bell();
              setPuzzleProgress(gatePuzzle.order.length);
              if (gatePuzzle.order.length === correctOrder.length) {
                gatePuzzle.solved = true;
                setNpcLine({ name: "—", line: "The stones hum. The gate rises." });
                // remove collider so player can pass
                const idx = colliderSets.surface.indexOf(gatePuzzle.collider);
                if (idx >= 0) colliderSets.surface.splice(idx, 1);
              } else {
                setNpcLine({ name: "—", line: `A flame answers. (${gatePuzzle.order.length}/3)` });
              }
            } else {
              // reset
              sfx.metal();
              gatePuzzle.order.length = 0;
              for (const p2 of pedestals) {
                p2.lit = false;
                (p2.flame.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
                p2.light.intensity = 0;
              }
              setPuzzleProgress(0);
              setNpcLine({ name: "—", line: "The flames die. The order was wrong. Read the world; try again." });
            }
            return;
          }
        }
      }




      // UNDERGROUND — building the light
      if (currentScene === "underground" && !lightBuild.lit) {
        // scavenge parts
        for (const part of lightPartsArr) {
          if (part.taken) continue;
          if (localP.distanceTo(part.pos) < 2.2) {
            part.taken = true;
            part.mesh.visible = false;
            lightBuild.parts += 1;
            setLightParts(lightBuild.parts);
            sfx.interact();
            setNpcLine({ name: "—", line: `You take ${part.name}. (${lightBuild.parts}/3 parts)` });
            return;
          }
        }
        const benchPos = new THREE.Vector3(CHX, 1, CHZ - 2);
        const dynamoPos = new THREE.Vector3(CHX + 2.2, 1, CHZ - 2);
        // assemble at the bench
        if (!lightBuild.assembled && localP.distanceTo(benchPos) < 2.4) {
          if (lightBuild.parts < 3) {
            setNpcLine({ name: "—", line: `The bench waits. You need parts from the dead-end tunnels — glass, copper, and a jar of lightning. (${lightBuild.parts}/3)` });
            return;
          }
          lightBuild.assembled = true;
          lightBox.visible = true;
          filament.visible = true;
          jar.visible = true;
          for (const w of wires) w.visible = true;
          sfx.metal();
          setNpcLine({ name: "—", line: "Glass seated. Copper wound. Wires bound to the jar. Now — turn the crank. Turn it until the wire catches." });
          return;
        }
        // crank the dynamo — press E repeatedly to build charge
        if (lightBuild.assembled && localP.distanceTo(dynamoPos) < 2.6) {
          lightBuild.cranking = true;
          lightBuild.charge = Math.min(1, lightBuild.charge + 0.13);
          setLightCharge(lightBuild.charge);
          blip(120 + lightBuild.charge * 320, 0.1, "sawtooth", 0.12, 0.2);
          if (lightBuild.charge >= 1) {
            lightBuild.lit = true;
            filamentMat.color.set(0xfff4c0);
            sfx.bell();
            const beat = STORY.find(b => b.id === "tunnel_light")!;
            setActiveBeat(beat); activeBeatRef.current = beat;
            advanceTo(3);
          }
          return;
        }
      }

      // PICKUPS first — they're small and easy to miss
      for (const pk of pickups) {
        if (pk.taken || pk.sceneKey !== currentScene) continue;
        if (localP.distanceTo(pk.position) < 2.2) {
          if (pk.kind === "scroll") {
            sfx.interact();
            setNpcLine({ name: pk.scrollTitle ?? "Scroll", line: pk.scrollText ?? "" });
            return;
          }
          pk.taken = true;
          pk.mesh.visible = false;
          sfx.interact();
          if (pk.kind === "lantern") {
            hasLanternRef.current = true;
            setHasLantern(true);
            carriedLantern.intensity = 3.5; lanternSpot.intensity = 6.5;
          } else {
            fragmentsRef.current += 1;
            setFragments(fragmentsRef.current);
            sfx.bell();
          }
          return;
        }
      }


      // NPCs — cycle through their lines
      for (const n of npcs) {
        if (n.sceneKey !== currentScene) continue;
        if (localP.distanceTo(n.position) < 2.8) {
          const line = n.lines[n.idx % n.lines.length];
          n.idx += 1;
          setNpcLine({ name: n.name, line });
          sfx.interact();
          return;
        }
      }

      // INTERIOR — exit pads
      if (currentScene === "dorm" && localP.distanceTo(dormExit.position) < 2.5) {
        switchScene("surface", new THREE.Vector3(dormExt.doorX, 1.7, dormExt.doorZ - 1.5), 0);
        return;
      }
      if (currentScene === "council" && localP.distanceTo(councilExit.position) < 2.5) {
        switchScene("surface", new THREE.Vector3(COUNCIL_CX, 1.7, COUNCIL_CZ + 21), 0);
        return;
      }
      if (currentScene === "house" && localP.distanceTo(houseExit.position) < 2.5) {
        switchScene("surface", new THREE.Vector3(HX, 1.7, HZ + HD / 2 + 2.5), 0);
        return;
      }
      if (currentScene === "underground" && localP.distanceTo(stair.position) < 2.5) {
        switchScene("surface", new THREE.Vector3(GRATE_X, 1.7, GRATE_Z + 5), Math.PI);
        return;
      }

      // SURFACE — iron grating (open then descend)
      if (currentScene === "surface") {
        const dg = localP.distanceTo(new THREE.Vector3(GRATE_X, 1, GRATE_Z));
        if (dg < 5) {
          if (!grateOpen && progressRef.current === 1) {
            grateOpen = true;
            sfx.metal();
            const beat = STORY.find(b => b.id === "tunnel_entry")!;
            setActiveBeat(beat); activeBeatRef.current = beat;
            sfx.bell();
            advanceTo(2);
            return;
          }

          if (grateOpen) {
            if (!hasLanternRef.current) {
              setNpcLine({ name: "—", line: "The shaft is pitch black. You need a lantern. There is a forge stall nearby." });
              return;
            }
            switchScene("underground", new THREE.Vector3(0, 1.7, 4), Math.PI);
            return;
          }
        }
        // SURFACE — doors (skip during chase!)
        if (!chaseState.active) {
          for (const d of doors) {
            if (localP.distanceTo(d.surfacePos) < 3) {
              if (progressRef.current - 1 >= d.unlockAfter || d.unlockAfter < 0) {
                sfx.door();
                switchScene(d.target, d.interiorSpawn, d.interiorYaw);
                return;
              }
            }
          }
        }

      }

      // Generic interactables in the current scene
      let best: Interactable | null = null;
      let bestD = 5.5;
      for (const it of interactables) {
        if (it.sceneKey !== currentScene) continue;
        if (it.order !== progressRef.current) continue;
        const d = localP.distanceTo(it.position);
        if (d < bestD) { bestD = d; best = it; }
      }
      if (best) {
        // Puzzle gate: Golden One requires the garden gate to be open first
        if (best.beatId === "field_meet" && !gatePuzzle.solved) {
          setNpcLine({ name: "—", line: "The garden gate is sealed. Light the pedestals in order — shortest to tallest." });
          return;
        }
        // Council: run the cutscene instead of instant-advance
        if (best.beatId === "council" && !councilCutscene.active) {
          councilCutscene.active = true;
          cutsceneIdx = 0;
          advanceCouncilCutscene();
          return;
        }
        const beat = STORY.find(b => b.id === best!.beatId)!;
        setActiveBeat(beat); activeBeatRef.current = beat;
        sfx.interact();
        sfx.bell();
        advanceTo(best.order + 1);
      }
    };



    // =====================================================================
    // RENDER LOOP
    // =====================================================================
    const velocity = new THREE.Vector3();
    const tmpForward = new THREE.Vector3();
    const tmpRight = new THREE.Vector3();
    let last = performance.now();
    const startedAt = performance.now();
    let raf = 0;
    let frame = 0;
    let vy = 0;
    let onGround = true;
    const GRAVITY = 22;
    const JUMP_V = 8;
    const STAND_Y = 1.7;
    const CROUCH_Y = 1.05;
    let groundY = STAND_Y;
    let stepAccum = 0;

    // Chase-scene state
    type GuardState = "chase" | "seek" | "search" | "patrol";
    type Guard = {
      mesh: THREE.Group;
      pos: THREE.Vector3;
      state: GuardState;
      lastSeen: THREE.Vector3 | null;
      searchT: number;
      searchDir: number;
      bodyMat: THREE.MeshStandardMaterial;
      home: THREE.Vector3;
      avoidT: number;
      avoidSign: number;
    };
    const chaseState = { active: false, timeLeft: 0, headStart: 0, hadContact: false, guards: [] as Guard[] };
    // Sprint stamina
    const sprint = { value: 1, exhausted: false };
    // Line-of-sight test against the surface colliders (walls, trees, buildings)
    const losRay = new THREE.Ray();
    const losHit = new THREE.Vector3();
    const losDir = new THREE.Vector3();
    const losBlocked = (from: THREE.Vector3, to: THREE.Vector3) => {
      losDir.subVectors(to, from);
      const dist = losDir.length();
      losDir.normalize();
      losRay.origin.copy(from);
      losRay.direction.copy(losDir);
      for (const c of colliderSets.surface) {
        const hit = losRay.intersectBox(c.box, losHit);
        if (hit && hit.distanceTo(from) < dist - 0.4) return true;
      }
      return false;
    };
    // Guard collision probe — same AABB test the player uses
    const guardBlockedAt = (x: number, z: number) => {
      const b = new THREE.Box3(
        new THREE.Vector3(x - 0.45, 0.1, z - 0.45),
        new THREE.Vector3(x + 0.45, 2, z + 0.45),
      );
      return colliderSets.surface.some(c => c.box.intersectsBox(b));
    };
    // Steer a guard toward a target with obstacle avoidance: try the direct
    // heading, then progressively rotated headings (left/right whiskers).
    const guardStep = (g: Guard, target: THREE.Vector3, spd: number, dt: number) => {
      const dx = target.x - g.mesh.position.x;
      const dz = target.z - g.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.2) return dist;
      const baseAng = Math.atan2(dx, dz);
      const step = spd * dt;
      const tryAngles = g.avoidT > 0
        ? [baseAng + g.avoidSign * 0.9, baseAng + g.avoidSign * 1.5, baseAng, baseAng - g.avoidSign * 0.9]
        : [baseAng, baseAng + 0.5, baseAng - 0.5, baseAng + 1.1, baseAng - 1.1, baseAng + 1.8, baseAng - 1.8];
      for (const a of tryAngles) {
        const nx = g.mesh.position.x + Math.sin(a) * step;
        const nz = g.mesh.position.z + Math.cos(a) * step;
        if (!guardBlockedAt(nx, nz)) {
          if (a !== baseAng && g.avoidT <= 0) {
            g.avoidT = 0.6;
            g.avoidSign = a > baseAng ? 1 : -1;
          }
          g.mesh.position.x = nx;
          g.mesh.position.z = nz;
          g.mesh.rotation.y = a;
          return dist;
        }
      }
      return dist;
    };
    // Can this guard see the player? Vision cone + range, shorter if the
    // player crouches; close-range hearing works regardless of facing.
    const guardSees = (g: Guard, crouching: boolean) => {
      const gx = g.mesh.position.x, gz = g.mesh.position.z;
      const px = camera.position.x, pz = camera.position.z;
      const dx = px - gx, dz = pz - gz;
      const dist = Math.hypot(dx, dz);
      const hearR = crouching ? 3 : 7;
      const range = crouching ? 22 : 42;
      if (dist < hearR) return true;
      if (dist > range) return false;
      const facing = g.mesh.rotation.y;
      const angTo = Math.atan2(dx, dz);
      let diff = angTo - facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 1.1) return false; // ~126° cone
      const eye = new THREE.Vector3(gx, 1.8, gz);
      const head = new THREE.Vector3(px, crouching ? 1.0 : 1.6, pz);
      return !losBlocked(eye, head);
    };
    const councilCutscene = { active: false, step: 0, timer: 0 };
    // Surface-material footstep pickers
    const surfaceKind = (): "cobble" | "grass" | "wood" | "stone" | "dirt" => {
      if (currentScene === "dorm" || currentScene === "house") return "wood";
      if (currentScene === "underground" || currentScene === "council") return "stone";
      // surface: grass in field/forest, cobble in city
      const p = camera.position; const lz = p.z, lx = p.x;
      if (lz > 150) return "grass"; // field
      if (lx < -140) return "grass"; // forest
      return "cobble";
    };
    const doFootstep = () => {
      const k = surfaceKind();
      if (k === "grass") noiseBurst(0.12, 380, 3, 0.16, 0.05);
      else if (k === "wood") { noiseBurst(0.09, 260, 6, 0.19, 0.08); blip(140, 0.06, "sine", 0.09, 0.05); }
      else if (k === "stone") noiseBurst(0.08, 500, 10, 0.18, 0.35);
      else /* cobble */ noiseBurst(0.09, 340, 9, 0.2, 0.15);
    };





    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frame++;
      if (frame % 15 === 0) setElapsed(Math.floor((now - startedAt) / 1000));

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
      // Sprint stamina — drains while sprinting, refills at rest. Fully
      // draining it locks sprint out until the bar refills completely.
      const sprintHeld = !!(keys["ShiftLeft"] || keys["ShiftRight"]);
      const wantsMove = move.lengthSq() > 0;
      let sprinting = false;
      if (sprintHeld && wantsMove && !sprint.exhausted && sprint.value > 0) {
        sprinting = true;
        sprint.value -= dt / 4.0;
        if (sprint.value <= 0) {
          sprint.value = 0;
          sprint.exhausted = true;
          noiseBurst(0.4, 300, 2, 0.2, 0.2); // gasp
        }
      } else {
        sprint.value = Math.min(1, sprint.value + dt / 6.0);
        if (sprint.value >= 1 && sprint.exhausted) sprint.exhausted = false;
      }
      if (frame % 6 === 0) { setStamina(sprint.value); setExhausted(sprint.exhausted); }
      const speed = sprinting ? 14 : 7;
      if (wantsMove) move.normalize().multiplyScalar(speed * dt);
      velocity.lerp(move, 0.4);

      const activeColliders = colliderSets[currentScene];
      const ox = SCENE_OFFSETS[currentScene];

      // Collide in LOCAL space (subtract ox from camera.x to get local)
      const lx = camera.position.x - ox, lz = camera.position.z;
      const nextLX = lx + velocity.x;
      const bx = new THREE.Box3(
        new THREE.Vector3(nextLX - 0.4, 0, lz - 0.4),
        new THREE.Vector3(nextLX + 0.4, 2, lz + 0.4),
      );
      if (!activeColliders.some(c => c.box.intersectsBox(bx))) camera.position.x += velocity.x;

      const lx2 = camera.position.x - ox;
      const nextLZ = lz + velocity.z;
      const bz = new THREE.Box3(
        new THREE.Vector3(lx2 - 0.4, 0, nextLZ - 0.4),
        new THREE.Vector3(lx2 + 0.4, 2, nextLZ + 0.4),
      );
      if (!activeColliders.some(c => c.box.intersectsBox(bz))) camera.position.z += velocity.z;

      // crouch — hold Ctrl or C
      const crouching = !!(keys["ControlLeft"] || keys["ControlRight"] || keys["KeyC"]);
      groundY = crouching ? CROUCH_Y : STAND_Y;
      // footstep cadence — surface-based, quieter while crouched
      const horizSpeed = Math.hypot(velocity.x, velocity.z);
      if (onGround && horizSpeed > 0.02 && !crouching) {
        stepAccum += horizSpeed;
        const cadence = sprinting ? 0.55 : 0.85;
        if (stepAccum > cadence) {
          stepAccum = 0;
          doFootstep();
        }
      } else {
        stepAccum = Math.max(0, stepAccum - dt);
      }

      // jump + gravity
      if (keys["Space"] && onGround && !crouching && !activeBeatRef.current && document.pointerLockElement === renderer.domElement) {
        vy = JUMP_V;
        onGround = false;
        blip(320, 0.09, "sine", 0.14, 0.1); noiseBurst(0.08, 620, 5, 0.12, 0.08);
      }
      vy -= GRAVITY * dt;
      camera.position.y += vy * dt;
      if (camera.position.y <= groundY) {
        const wasFalling = !onGround;
        camera.position.y = groundY;
        vy = 0;
        if (wasFalling) sfx.land();
        onGround = true;
      }

      // Chase logic — guards hunt with vision + pathfinding; win by descending
      // the grate, or shake them by breaking line of sight until they give up
      if (chaseState.active && currentScene === "surface") {
        chaseState.timeLeft -= dt;
        if (chaseState.headStart > 0) chaseState.headStart -= dt;
        if (frame % 10 === 0) setChase({ active: true, timeLeft: Math.max(0, chaseState.timeLeft) });
        const guardsMove = chaseState.headStart <= 0;
        // Guards run faster than your walk (7) but slower than your sprint (14)
        const GUARD_SPEED = 9.5;
        const doVision = frame % 6 === 0;
        let anyHunting = false;
        for (const g of chaseState.guards) {
          if (!guardsMove) continue;
          if (g.avoidT > 0) g.avoidT -= dt;
          // --- perception ---
          if (doVision) {
            if (guardSees(g, crouching)) {
              if (g.state !== "chase") sfx.metal();
              g.state = "chase";
              g.lastSeen = new THREE.Vector3(camera.position.x, 0, camera.position.z);
              g.searchT = 0;
            } else if (g.state === "chase") {
              g.state = "seek"; // lost sight — run to last known position
            }
          }
          // --- behavior ---
          if (g.state === "chase") {
            g.lastSeen = new THREE.Vector3(camera.position.x, 0, camera.position.z);
            guardStep(g, g.lastSeen, GUARD_SPEED, dt);
          } else if (g.state === "seek" && g.lastSeen) {
            const d = guardStep(g, g.lastSeen, GUARD_SPEED * 0.9, dt);
            if (d < 1.5) { g.state = "search"; g.searchT = 6; g.searchDir = Math.random() * Math.PI * 2; }
          } else if (g.state === "search") {
            g.searchT -= dt;
            g.searchDir += dt * 1.6; // sweep the area, scanning around
            const sx = g.mesh.position.x + Math.sin(g.searchDir) * 3;
            const sz = g.mesh.position.z + Math.cos(g.searchDir) * 3;
            guardStep(g, new THREE.Vector3(sx, 0, sz), GUARD_SPEED * 0.4, dt);
            if (g.searchT <= 0) { g.state = "patrol"; g.lastSeen = null; }
          } else {
            // patrol — trudge back toward the council doorway
            guardStep(g, g.home, GUARD_SPEED * 0.5, dt);
          }
          if (g.state === "chase" || g.state === "seek") anyHunting = true;
          // alert glow: red while hunting, dark when they've lost you
          g.bodyMat.emissive.set(g.state === "chase" ? 0x801010 : g.state === "seek" || g.state === "search" ? 0x604010 : 0x000000);
          // --- caught? ---
          const distP = Math.hypot(camera.position.x - g.mesh.position.x, camera.position.z - g.mesh.position.z);
          if (g.state === "chase" && distP < 1.3) {
            // Caught → reset player far in front of council with fresh head-start
            camera.position.set(COUNCIL_CX, 1.7, COUNCIL_CZ + 40);
            chaseState.headStart = 2.0;
            chaseState.hadContact = false;
            for (let i = 0; i < chaseState.guards.length; i++) {
              const gi = chaseState.guards[i];
              gi.mesh.position.set(COUNCIL_CX + (i - 1) * 3, 0, COUNCIL_CZ + 19);
              gi.state = "seek";
              gi.lastSeen = new THREE.Vector3(COUNCIL_CX, 0, COUNCIL_CZ + 40);
              gi.searchT = 0;
            }
            setNpcLine({ name: "Guard", line: "Halt! (You have been caught — try again.)" });
            break;
          }
        }
        if (guardsMove) {
          if (anyHunting) chaseState.hadContact = true;
          else if (chaseState.hadContact) {
            chaseState.hadContact = false;
            setNpcLine({ name: "—", line: "The shouts fade behind you. You have lost them — stay out of their sight." });
          }
        }
        const dg2 = Math.hypot(camera.position.x - GRATE_X, camera.position.z - GRATE_Z);
        if (dg2 < 4) {
          chaseState.active = false;
          setChase(null);
          for (const g of chaseState.guards) g.mesh.visible = false;
          chaseState.guards.length = 0;
          setNpcLine({ name: "—", line: "You slip through the grate and vanish into the tunnels. They will not follow." });
          setObjective("Flee through the Uncharted Forest");
        }
        if (chaseState.timeLeft <= 0 && chaseState.active) {
          // Time ran out — full reset (player + guards)
          camera.position.set(COUNCIL_CX, 1.7, COUNCIL_CZ + 40);
          chaseState.timeLeft = 90;
          chaseState.headStart = 2.0;
          chaseState.hadContact = false;
          for (let i = 0; i < chaseState.guards.length; i++) {
            const gi = chaseState.guards[i];
            gi.mesh.position.set(COUNCIL_CX + (i - 1) * 3, 0, COUNCIL_CZ + 19);
            gi.state = "seek";
            gi.lastSeen = new THREE.Vector3(COUNCIL_CX, 0, COUNCIL_CZ + 40);
            gi.searchT = 0;
          }
          setChase({ active: true, timeLeft: 90 });
          setNpcLine({ name: "—", line: "Time's up! The guards have spotted you again. Run!" });
        }
      }

      // Compass — direct DOM update every frame (no React re-render)
      if (compassRibbonRef.current) {
        let tx = 96 + (256 * yaw) / Math.PI;
        tx = ((tx % 512) + 512) % 512 - 512;
        compassRibbonRef.current.style.transform = `translateX(${tx}px)`;
      }

      // Garden gate rising animation
      if (gatePuzzle.solved && gatePuzzle.mesh.position.y < 6.5) {
        gatePuzzle.mesh.position.y = Math.min(6.5, gatePuzzle.mesh.position.y + dt * 1.2);
      }








      // bobs
      const t = now / 600;
      // The light — glow tracks the dynamo charge; decays if you stop cranking
      if (lightBuild.assembled && !lightBuild.lit && lightBuild.charge > 0) {
        lightBuild.charge = Math.max(0, lightBuild.charge - dt * 0.045);
        if (frame % 6 === 0) setLightCharge(lightBuild.charge);
      }
      const glowLvl = lightBuild.lit ? 1 : lightBuild.charge;
      bulbMat.emissiveIntensity = glowLvl * 2.2 + (lightBuild.lit ? Math.sin(t * 3) * 0.2 : 0);
      lbLight.intensity = glowLvl * 3.4 + (lightBuild.lit ? Math.sin(t * 3) * 0.2 + (Math.random() - 0.5) * 0.15 : 0);
      crankWheel.rotation.x += dt * glowLvl * 9;
      if (lightBuild.lit) {
        lightBox.position.y = 1.68 + Math.sin(t) * 0.02;
        filament.position.y = 1.68 + Math.sin(t) * 0.02;
        lightBox.rotation.y += dt * 0.6;
      }
      // tunnel lantern flicker
      if (currentScene === "underground") {
        for (const pl of tunnelFlicker) {
          pl.intensity = 1.25 + Math.sin(now * 0.011 + pl.position.x + pl.position.z) * 0.2 + (Math.random() - 0.5) * 0.12;
        }
      }
      // uncollected light parts bob and spin
      for (const part of lightPartsArr) {
        if (part.taken) continue;
        part.mesh.rotation.y += dt * 1.4;
        part.mesh.position.y = 1.0 + Math.sin(t * 2 + part.pos.x) * 0.08;
      }
      bookGroup.position.y = 1.5 + Math.sin(t * 0.8) * 0.07;
      bookGroup.rotation.y += dt * 0.3;
      parchment.rotation.y += dt * 0.4;
      liberty.rotation.y = Math.sin(t * 0.5) * 0.3;
      for (const g of gates) {
        if (g.open) continue;
        (g.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + Math.sin(t * 2) * 0.2;
      }
      // grate slide
      if (grateOpen && grateSlideT < 1) {
        grateSlideT = Math.min(1, grateSlideT + dt * 1.2);
        grate.position.x = GRATE_X + grateSlideT * 4.2;
        grate.position.y = 0.1 - grateSlideT * 0.05;
        grate.rotation.z = grateSlideT * 0.08;
      }

      // beacons: only the one matching the next beat, in any scene
      const nextBeatId = STORY[progressRef.current]?.id;
      for (const [id, m] of Object.entries(beaconForBeat)) {
        m.visible = id === nextBeatId;
      }

      // nearby prompt
      let near: string | null = null;
      const localPos = new THREE.Vector3(camera.position.x - ox, camera.position.y, camera.position.z);

      if (currentScene === "dorm" && localPos.distanceTo(dormExit.position) < 2.5) near = "Open the door — step outside";
      else if (currentScene === "council" && localPos.distanceTo(councilExit.position) < 2.5) near = "Leave the Council Hall";
      else if (currentScene === "house" && localPos.distanceTo(houseExit.position) < 2.5) near = "Leave the house";
      else if (currentScene === "underground" && localPos.distanceTo(stair.position) < 2.5) near = "Climb back to the surface";
      else if (currentScene === "underground" && !lightBuild.lit) {
        for (const part of lightPartsArr) {
          if (!part.taken && localPos.distanceTo(part.pos) < 2.2) { near = `Take ${part.name}`; break; }
        }
        if (!near) {
          const benchPos = new THREE.Vector3(CHX, 1, CHZ - 2);
          const dynamoPos = new THREE.Vector3(CHX + 2.2, 1, CHZ - 2);
          if (!lightBuild.assembled && localPos.distanceTo(benchPos) < 2.4) {
            near = lightBuild.parts < 3 ? `Inspect the workbench (${lightBuild.parts}/3 parts)` : "Assemble the light";
          } else if (lightBuild.assembled && localPos.distanceTo(dynamoPos) < 2.6) {
            near = "Turn the crank — press E rapidly!";
          }
        }
      }
      else if (currentScene === "surface") {
        const dg = localPos.distanceTo(new THREE.Vector3(GRATE_X, 1, GRATE_Z));
        if (dg < 5) {
          if (!grateOpen && progressRef.current === 1) near = "Lift the iron grating";
          else if (grateOpen) near = hasLanternRef.current ? "Descend into the tunnel" : "Pitch black below — find a lantern first";
        }
        if (!near) {
          for (const d of doors) {
            if (localPos.distanceTo(d.surfacePos) < 3) {
              near = (progressRef.current - 1 >= d.unlockAfter || d.unlockAfter < 0)
                ? d.label : d.lockedLabel;
              break;
            }
          }
        }
      }
      // pickups
      if (!near) {
        for (const pk of pickups) {
          if (pk.taken || pk.sceneKey !== currentScene) continue;
          if (localPos.distanceTo(pk.position) < 2.2) { near = pk.label; break; }
        }
      }
      // NPCs
      if (!near) {
        for (const n of npcs) {
          if (n.sceneKey !== currentScene) continue;
          if (localPos.distanceTo(n.position) < 2.8) { near = `Speak with ${n.name}`; break; }
        }
      }
      if (!near) {
        let nd = 5.5;
        for (const it of interactables) {
          if (it.sceneKey !== currentScene) continue;
          if (it.order !== progressRef.current) continue;
          const d = localPos.distanceTo(it.position);
          if (d < nd) { nd = d; near = it.label; }
        }
      }
      // lantern flicker while carrying
      if (hasLanternRef.current) {
        carriedLantern.intensity = 3.2 + Math.sin(now * 0.012) * 0.4 + (Math.random() - 0.5) * 0.2;
        lanternSpot.intensity = 6.0 + Math.sin(now * 0.014) * 0.6 + (Math.random() - 0.5) * 0.3;

      }
      // pickup bob
      for (const pk of pickups) {
        if (!pk.taken) pk.mesh.rotation.y += dt * 1.2;
      }
      // wandering NPCs walk slow circles + keep position in sync
      const tw = now / 1000;
      for (const n of npcs) {
        if (!n.wander) continue;
        const w = n.wander;
        const ang = w.phase + tw * w.speed * 0.25;
        const wx = w.cx + Math.cos(ang) * w.r;
        const wz = w.cz + Math.sin(ang) * w.r;
        n.mesh.position.x = wx;
        n.mesh.position.z = wz;
        n.position.set(wx, 1, wz);
      }
      // npc face-player (or walking direction if too far)
      for (const n of npcs) {
        if (n.sceneKey !== currentScene) continue;
        const dx = camera.position.x - SCENE_OFFSETS[currentScene] - n.mesh.position.x;
        const dz = camera.position.z - n.mesh.position.z;
        const dist = Math.hypot(dx, dz);
        if (n.wander && dist > 6) {
          // face along walk path
          const ang = n.wander.phase + tw * n.wander.speed * 0.25;
          n.mesh.rotation.y = Math.atan2(-Math.sin(ang), Math.cos(ang)) + Math.PI / 2;
        } else {
          n.mesh.rotation.y = Math.atan2(dx, dz);
        }
      }
      // flicker fire lamps (cheap — small array)
      for (const fl of flickerLamps) {
        if (fl.light) fl.light.intensity = fl.base + Math.sin(now * 0.013 + fl.light.position.x) * 0.15 + (Math.random() - 0.5) * 0.18;
        fl.cone.scale.y = 1 + Math.sin(now * 0.018 + fl.cone.position.z + fl.cone.position.x) * 0.18;
        if (fl.core) fl.core.scale.y = 1 + Math.sin(now * 0.022 + fl.cone.position.x) * 0.22;
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
      try { droneA.stop(); droneB.stop(); droneC.stop(); lfo.stop(); noiseSrc.stop(); } catch { /* already stopped */ }
      actx.close();
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

      {/* Cinematic vignette + subtle warm color grade */}
      {started && (
        <div
          className="pointer-events-none absolute inset-0 z-[5]"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%),' +
              'linear-gradient(180deg, rgba(255,180,110,0.04) 0%, rgba(0,0,0,0) 30%, rgba(20,10,30,0.10) 100%)',
            mixBlendMode: 'multiply',
          }}
        />
      )}

      {!started && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-[#0e0c09]/95">
          <div className="max-w-xl text-center space-y-6">
            <p className="uppercase tracking-[0.4em] text-xs text-[#b8a37a]">A 3D walk through</p>
            <h1 className="text-6xl font-serif tracking-wider">ANTHEM</h1>
            <p className="text-sm text-[#b8a37a] italic">after the novella by Ayn Rand</p>
            <p className="text-sm leading-relaxed text-[#c8b890]">
              You wake on a cot in the Home of the Street Sweepers. Take the parchment, open the door,
              and step into a city of stone where every chapter sleeps behind a locked door.
              Follow the beam of light.
            </p>
            <div className="text-xs text-[#8a7a5a] grid grid-cols-2 gap-2 max-w-sm mx-auto pt-2">
              <div><span className="text-[#e8dcc0]">WASD</span> — walk</div>
              <div><span className="text-[#e8dcc0]">Shift</span> — sprint (drains stamina)</div>
              <div><span className="text-[#e8dcc0]">Space</span> — jump</div>
              <div><span className="text-[#e8dcc0]">Mouse</span> — look</div>
              <div><span className="text-[#e8dcc0]">Ctrl / C</span> — crouch</div>
              <div><span className="text-[#e8dcc0]">E</span> — interact / enter / exit</div>

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
            <div className="pt-2 flex gap-3 text-[10px]">
              <span className={hasLantern ? "text-[#ffb070]" : "text-[#5a5040]"}>
                {hasLantern ? "🏮 Lantern" : "○ No lantern"}
              </span>
              <span className="text-[#e8c870]">✦ Fragments {fragments}/5</span>
              <span className="text-[#c8e870]">✦ Pedestals {puzzleProgress}/3</span>
              {progress === 2 && <span className="text-[#8ac8e8]">⚙ Parts {lightParts}/3</span>}
            </div>
            {/* Stamina bar */}
            <div className="pt-2 w-40">
              <div className="text-[9px] uppercase tracking-widest pb-0.5" style={{ color: exhausted ? "#e05040" : "#8a7a5a" }}>
                {exhausted ? "Exhausted" : "Stamina"}
              </div>
              <div className="h-1.5 w-full bg-black/60 border border-[#c8a84a]/30">
                <div
                  className="h-full transition-[width] duration-150"
                  style={{ width: `${Math.round(stamina * 100)}%`, background: exhausted ? "#e05040" : "#c8a84a" }}
                />
              </div>
            </div>
            {/* Light charge bar — only while building the light */}
            {progress === 2 && lightCharge > 0 && (
              <div className="pt-1 w-40">
                <div className="text-[9px] uppercase tracking-widest text-[#8ac8e8] pb-0.5">Dynamo charge</div>
                <div className="h-1.5 w-full bg-black/60 border border-[#8ac8e8]/30">
                  <div className="h-full bg-[#8ac8e8] transition-[width] duration-150" style={{ width: `${Math.round(lightCharge * 100)}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* Compass — a translating ribbon with duplicated letters */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <div className="relative w-64 h-8 border border-[#c8a84a]/40 bg-black/60 overflow-hidden shadow-[0_0_12px_rgba(0,0,0,0.6)]">
              <div
                ref={compassRibbonRef}
                className="absolute top-0 h-full flex items-center will-change-transform"
                style={{ width: 1024, transform: 'translateX(96px)' }}
              >
                {['N','NE','E','SE','S','SW','W','NW','N','NE','E','SE','S','SW','W','NW'].map((d, i) => (
                  <span key={i} className="text-center text-[11px] uppercase tracking-[0.35em] text-[#e8dcc0]" style={{ width: 64 }}>{d}</span>
                ))}
              </div>
              {/* center tick */}
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#e8c870]" />
              <div className="absolute left-1/2 -translate-x-1/2 top-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#e8c870]" />
            </div>
          </div>

          {/* Chase timer banner */}
          {chase?.active && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 px-4 py-2 border border-red-600 bg-black/70 text-red-300 uppercase tracking-[0.3em] text-xs animate-pulse">
              ⚠ Guards pursuing · {Math.ceil(chase.timeLeft)}s
            </div>
          )}

          <div className="absolute top-4 right-4 z-10 text-right text-xs uppercase tracking-widest text-[#8a7a5a]">
            <div className="pointer-events-none">WASD · Mouse · E</div>
            <div className="text-[#6a5a40] normal-case tracking-normal pt-1 pointer-events-none">Follow the beam of light</div>
            <button
              onClick={() => setMuted(m => !m)}
              className="mt-2 px-3 py-1 border border-[#c8a84a]/40 bg-black/40 text-[#e8dcc0] hover:bg-[#c8a84a]/20 text-[10px]"
            >
              {muted ? "Sound: Off" : "Sound: On"}
            </button>
          </div>


          {locked && !activeBeat && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#e8dcc0]/70 pointer-events-none" />
          )}

          {nearby && !activeBeat && !npcLine && locked && (
            <div className="absolute left-1/2 bottom-24 -translate-x-1/2 z-10 px-4 py-2 border border-[#c8a84a]/40 bg-black/40 text-sm tracking-wide pointer-events-none">
              [E] {nearby}
            </div>
          )}

          {npcLine && !activeBeat && (
            <div
              className="absolute left-1/2 bottom-12 -translate-x-1/2 z-20 max-w-xl w-[90%] px-5 py-4 border border-[#c8a84a]/50 bg-[#15110b]/95 cursor-pointer"
              onClick={() => setNpcLine(null)}
            >
              <div className="text-[10px] uppercase tracking-[0.3em] text-[#c8a84a] mb-1">{npcLine.name}</div>
              <div className="font-serif text-[15px] text-[#e8dcc0] leading-relaxed">"{npcLine.line}"</div>
              <div className="text-[9px] uppercase tracking-widest text-[#6a5a40] pt-2">[E] continue</div>
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
                <h2 className="font-serif text-2xl tracking-wider text-[#e8c870]">{activeBeat.title}</h2>
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
