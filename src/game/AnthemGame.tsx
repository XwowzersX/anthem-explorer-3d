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
  const [flowers, setFlowers] = useState(0);
  const [npcLine, setNpcLine] = useState<{ name: string; line: string } | null>(null);
  const [compass, setCompass] = useState<{ yaw: number; targetAngle: number | null; label: string | null }>({ yaw: 0, targetAngle: null, label: null });
  const [chase, setChase] = useState<{ active: boolean; timeLeft: number } | null>(null);
  const mutedRef = useRef(false);
  const masterGainRef = useRef<GainNode | null>(null);
  const hasLanternRef = useRef(false);
  const fragmentsRef = useRef(0);
  const flowersRef = useRef(0);
  const npcLineRef = useRef<{ name: string; line: string } | null>(null);
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
    scene.fog = new THREE.Fog(0x4a4858, 90, 520);

    const camera = new THREE.PerspectiveCamera(74, mount.clientWidth / mount.clientHeight, 0.05, 900);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = false; // perf: shadows were the biggest cost
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
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
      plaster: noiseTex(128, 128, [120, 108, 84], 30, undefined, { color: "#3a3020", count: 80, size: 2 }, 2),
      plasterDark: noiseTex(128, 128, [78, 68, 50], 28, undefined, { color: "#2a2418", count: 80, size: 2 }, 2),
      roof: noiseTex(128, 128, [42, 38, 30], 22, { color: "#15110c", every: 16, thick: 2, horiz: true }, undefined, 3),
      grass: noiseTex(256, 256, [120, 108, 56], 60, undefined, { color: "#c8a84a", count: 400, size: 2 }, 40),
      iron: noiseTex(128, 128, [70, 64, 52], 40, { color: "#1a1612", every: 12, thick: 2 }, { color: "#a08050", count: 30, size: 2 }, 1),
      tunnel: noiseTex(128, 128, [38, 32, 26], 26, undefined, { color: "#0a0806", count: 100, size: 2 }, 3),
      bark: noiseTex(64, 256, [44, 32, 22], 24, { color: "#1a1208", every: 8, thick: 1, horiz: true }, undefined, 2),
      leaves: noiseTex(128, 128, [40, 70, 44], 50, undefined, { color: "#1a3a20", count: 200, size: 2 }, 2),
      gold: noiseTex(128, 128, [220, 190, 110], 30, undefined, { color: "#fff0a0", count: 80, size: 2 }, 1),
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
      plaster: new THREE.MeshStandardMaterial({ map: T.plaster, color: 0xc8b890, roughness: 0.95 }),
      plasterDark: new THREE.MeshStandardMaterial({ map: T.plasterDark, color: 0x9a8a6a, roughness: 0.95 }),
      roof: new THREE.MeshStandardMaterial({ map: T.roof, color: 0x4a4238, roughness: 0.9 }),
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
    // SURFACE — THE CITY (18th-century plaster + timber, pitched roofs)
    // =====================================================================
    const facadeMats = [M.plaster, M.plasterDark, M.plaster, M.stone3];
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
        const dd = 8 + rand() * 4;
        const h = 4.5 + rand() * 4.5; // squat 18th-century scale
        const mat = facadeMats[Math.floor(rand() * 4)];
        addBox("surface", x, 0, z, w, h, dd, mat);
        // exposed timber bands (Tudor-ish)
        if (rand() > 0.4) {
          const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.3, dd + 0.05), M.timber);
          band.position.set(x, h * 0.55, z);
          sceneAdd("surface", band);
        }
        // pitched gable roof — wider than building, like overhanging eaves
        const roofGeo = new THREE.ConeGeometry(Math.max(w, dd) * 0.78, 2.6 + rand() * 1.4, 4);
        const roofMesh = new THREE.Mesh(roofGeo, M.roof);
        roofMesh.rotation.y = Math.PI / 4;
        roofMesh.position.set(x, h + 1.3, z);
        sceneAdd("surface", roofMesh);
        // chimney
        if (rand() > 0.55) {
          addBox("surface", x + (rand() - 0.5) * w * 0.5, h + 0.4, z + (rand() - 0.5) * dd * 0.5,
            0.6, 1.6, 0.6, M.stone3, false);
        }
        // warm window — emissive only
        if (rand() > 0.3) {
          const face = j > 0 ? "north" : j < 0 ? "south" : i > 0 ? "west" : "east";
          const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), M.window);
          const wy = 1.5 + rand() * (h - 3);
          if (face === "south") { win.position.set(x, wy, z + dd / 2 + 0.03); }
          else if (face === "north") { win.position.set(x, wy, z - dd / 2 - 0.03); win.rotation.y = Math.PI; }
          else if (face === "east") { win.position.set(x + w / 2 + 0.03, wy, z); win.rotation.y = Math.PI / 2; }
          else { win.position.set(x - w / 2 - 0.03, wy, z); win.rotation.y = -Math.PI / 2; }
          sceneAdd("surface", win);
        }
      }
    }

    // Fire-burning street lamps along boulevards — every lamp animated
    const lampGeo = new THREE.CylinderGeometry(0.08, 0.12, 4.5, 6);
    const flameGeo = new THREE.ConeGeometry(0.28, 0.7, 6);
    const flameCoreGeo = new THREE.ConeGeometry(0.14, 0.45, 6);
    const flickerLamps: { light: THREE.PointLight | null; base: number; cone: THREE.Mesh; core: THREE.Mesh }[] = [];
    for (let k = -GRID; k <= GRID; k++) {
      if (k === 0) continue;
      for (const [lx, lz] of [[-5, k * 17], [5, k * 17], [k * 17, -5], [k * 17, 5]] as const) {
        const post = new THREE.Mesh(lampGeo, M.timber);
        post.position.set(lx, 2.25, lz);
        sceneAdd("surface", post);
        // wrought-iron cap
        addBox("surface", lx, 4.55, lz, 0.4, 0.15, 0.4, M.bedFrame, false);
        // flame
        const flame = new THREE.Mesh(flameGeo, M.flame);
        flame.position.set(lx, 5.0, lz);
        sceneAdd("surface", flame);
        const core = new THREE.Mesh(flameCoreGeo, M.flameCore);
        core.position.set(lx, 4.95, lz);
        sceneAdd("surface", core);
        // real PointLight only on every 3rd (perf), but ALL flames animate
        const hasLight = (Math.abs(k) + (lx > 0 ? 0 : 1)) % 3 === 0;
        let pl: THREE.PointLight | null = null;
        if (hasLight) {
          pl = new THREE.PointLight(0xff8030, 1.4, 18);
          pl.position.set(lx, 5.2, lz);
          sceneAdd("surface", pl);
        }
        flickerLamps.push({ light: pl, base: 1.4, cone: flame, core });
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
    // SURFACE — FIELD (south, beyond a low wall with a gap at center)
    // =====================================================================
    for (let x = -140; x <= 140; x += 5) {
      if (Math.abs(x) < 5) continue;
      addBox("surface", x, 0, 150, 4.5, 2.4, 1.2, M.plasterDark);
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
    // SURFACE — COUNCIL HALL EXTERIOR
    // =====================================================================
    const COUNCIL_CX = 0, COUNCIL_CZ = -160;
    // Exterior shell — no door gap, the door is a mesh you press E on
    addBox("surface", COUNCIL_CX, 0, COUNCIL_CZ + 18, 50, 16, 0.5, M.plaster); // front
    addBox("surface", COUNCIL_CX, 0, COUNCIL_CZ - 18, 50, 16, 0.5, M.plaster); // back
    addBox("surface", COUNCIL_CX + 25, 0, COUNCIL_CZ, 0.5, 16, 36, M.plaster);
    addBox("surface", COUNCIL_CX - 25, 0, COUNCIL_CZ, 0.5, 16, 36, M.plaster);
    // pillars in front of council
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      addBox("surface", COUNCIL_CX + i * 8, 0, COUNCIL_CZ + 22, 1.6, 13, 1.6, M.pillarDark);
    }
    // roof slab
    const councilRoof = new THREE.Mesh(new THREE.BoxGeometry(52, 0.6, 38), M.roof);
    councilRoof.position.set(COUNCIL_CX, 16.3, COUNCIL_CZ);
    sceneAdd("surface", councilRoof);
    // Door
    const councilDoor = new THREE.Mesh(new THREE.BoxGeometry(6, 9, 0.3), M.doorWood);
    councilDoor.position.set(COUNCIL_CX, 4.5, COUNCIL_CZ + 18.2);
    sceneAdd("surface", councilDoor);

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
      // lanterns (emissive only, with sparse PointLights)
      const lanternCount = Math.max(1, Math.floor(len / 18));
      for (let i = 0; i < lanternCount; i++) {
        const tx = -len / 2 + (i + 0.5) * (len / lanternCount);
        const lx = cx + Math.cos(angle) * tx;
        const lz = cz + Math.sin(angle) * tx;
        const lan = new THREE.Mesh(G.lamp, M.lantern);
        lan.position.set(lx, height - 0.5, lz);
        sceneAdd("underground", lan);
        // only every other lantern gets a real light
        if (i % 2 === 0) {
          const pl = new THREE.PointLight(0xffaa55, 1.3, 22);
          pl.position.set(lx, height - 0.5, lz);
          sceneAdd("underground", pl);
        }
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
    // Altar and the glass light box
    const lbAltar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 1.6), M.altar);
    lbAltar.position.set(CHX, 0.35, CHZ - 2);
    sceneAdd("underground", lbAltar);
    const lightBox = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xfff8dd, emissive: 0xfff0aa, emissiveIntensity: 2.0 }));
    lightBox.position.set(CHX, 1.15, CHZ - 2);
    sceneAdd("underground", lightBox);
    const lbLight = new THREE.PointLight(0xffeeaa, 3, 35);
    lbLight.position.set(CHX, 2.5, CHZ - 2);
    sceneAdd("underground", lbLight);

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
    const carriedLantern = new THREE.PointLight(0xffb070, 0.0, 22);
    carriedLantern.position.set(0.4, -0.2, -0.3);
    camera.add(carriedLantern);
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
      { beatId: "tunnel_light", position: new THREE.Vector3(CHX, 1, CHZ - 2), label: "Touch the light without fire", order: 2, sceneKey: "underground" },
      { beatId: "field_meet", position: liberty.position.clone(), label: "Approach the Golden One", order: 3, sceneKey: "surface" },
      { beatId: "council", position: new THREE.Vector3(0, 1, 0), label: "Present the light to the Council", order: 4, sceneKey: "council" },
      { beatId: "forest", position: new THREE.Vector3(FOREST_X, 1, FOREST_Z), label: "Enter the Uncharted Forest", order: 5, sceneKey: "surface" },
      { beatId: "house", position: new THREE.Vector3(0, 1, 0), label: "Look around the house", order: 6, sceneKey: "house" },
      { beatId: "ego", position: new THREE.Vector3(0, 1.5, -H_D / 2 + 4), label: "Open the book", order: 7, sceneKey: "house" },
    ];

    const OBJECTIVES = [
      "Take the parchment from beneath your cot",
      "Step outside — find the iron grating east of the city",
      "Descend into the tunnel — find the glowing box",
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

    const tryInteract = () => {
      if (activeBeatRef.current) {
        setActiveBeat(null);
        activeBeatRef.current = null;
        return;
      }
      if (npcLineRef.current) { npcLineRef.current = null; setNpcLine(null); return; }
      const p = camera.position;
      const localP = new THREE.Vector3(p.x - SCENE_OFFSETS[currentScene], p.y, p.z);

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
            carriedLantern.intensity = 2.2;
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
        // SURFACE — doors
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
    const GROUND_Y = 1.7;
    let stepAccum = 0;




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
      const speed = keys["ShiftLeft"] || keys["ShiftRight"] ? 14 : 7;
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);
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

      // footstep cadence
      const horizSpeed = Math.hypot(velocity.x, velocity.z);
      if (onGround && horizSpeed > 0.02) {
        stepAccum += horizSpeed;
        const cadence = (keys["ShiftLeft"] || keys["ShiftRight"]) ? 0.55 : 0.85;
        if (stepAccum > cadence) {
          stepAccum = 0;
          sfx.footstep();
        }
      } else {
        stepAccum = Math.max(0, stepAccum - dt);
      }

      // jump + gravity
      if (keys["Space"] && onGround && !activeBeatRef.current && document.pointerLockElement === renderer.domElement) {
        vy = JUMP_V;
        onGround = false;
        sfx.jump();
      }
      vy -= GRAVITY * dt;
      camera.position.y += vy * dt;
      if (camera.position.y <= GROUND_Y) {
        const wasFalling = !onGround;
        camera.position.y = GROUND_Y;
        vy = 0;
        if (wasFalling) sfx.land();
        onGround = true;
      }


      // bobs
      const t = now / 600;
      lightBox.position.y = 1.15 + Math.sin(t) * 0.08;
      lightBox.rotation.y += dt * 0.6;
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
        carriedLantern.intensity = 1.9 + Math.sin(now * 0.012) * 0.25 + (Math.random() - 0.5) * 0.15;
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
        fl.light.intensity = fl.base + Math.sin(now * 0.013 + fl.light.position.x) * 0.15 + (Math.random() - 0.5) * 0.18;
        fl.cone.scale.y = 1 + Math.sin(now * 0.018 + fl.light.position.z) * 0.12;
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
              <div><span className="text-[#e8dcc0]">Shift</span> — run</div>
              <div><span className="text-[#e8dcc0]">Space</span> — jump</div>
              <div><span className="text-[#e8dcc0]">Mouse</span> — look</div>
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
            </div>
          </div>
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
