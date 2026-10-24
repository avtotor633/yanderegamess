/**
 * YANDERE SCHOOL 3D — Mobile Browser Prototype
 * Three.js + custom systems: campus, third-person, Senpai, rivals,
 * evil laugh, suspicion, witnesses, simplified eliminations, police.
 * Models are procedural (no external GLB) for offline reliability.
 */

(function () {
  'use strict';

  // ========== CONFIG ==========
  const CONFIG = {
    playerSpeed: 4.2,
    runMultiplier: 1.75,
    crouchMultiplier: 0.45,
    camSens: 1.2,
    gravity: 18,
    jumpForce: 7,
    interactionDist: 2.8,
    witnessDist: 12,
    witnessAngle: Math.PI * 0.55,
    policeArriveTime: 18, // seconds after alarm
    dayLength: 240, // real seconds for full day cycle (sped up)
  };

  // ========== STATE ==========
  let scene, camera, renderer, clock;
  let player, playerMesh, cameraTarget;
  let keys = {};
  let joystick = { active: false, x: 0, y: 0, id: null };
  let camDrag = { active: false, lastX: 0, lastY: 0, yaw: 0, pitch: 0.25 };
  let isRunning = false;
  let isCrouching = false;
  let isPaused = false;
  let gameTime = 8 * 60; // minutes from 00:00
  let reputation = 50;
  let suspicion = 0;
  let currentQuest = 'Найди Сэмпая во дворе и поговори с ним';
  let eventLog = [];
  let audioCtx = null;
  let volume = 0.6;
  let quality = 'medium';
  let policeActive = false;
  let policeTimer = 0;
  let policeEntities = [];
  let lastLaughTime = 0;
  let loadingProgress = 0;

  const npcs = [];
  const buildings = [];
  const colliders = []; // simple AABB

  // ========== UTILS ==========
  function notify(text, type = '') {
    const el = document.createElement('div');
    el.className = 'notif ' + type;
    el.textContent = text;
    document.getElementById('notifications').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function addLog(msg) {
    const t = formatTime(gameTime);
    eventLog.unshift(`[${t}] ${msg}`);
    if (eventLog.length > 40) eventLog.pop();
  }

  function formatTime(mins) {
    const h = Math.floor(mins / 60) % 24;
    const m = Math.floor(mins % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function updateUI() {
    document.getElementById('time-display').textContent = formatTime(gameTime);
    document.getElementById('rep-val').textContent = Math.round(reputation);
    document.getElementById('sus-val').textContent = Math.round(suspicion);
    document.getElementById('quest-text').textContent = currentQuest;
  }

  function setProgress(p, text) {
    loadingProgress = p;
    document.getElementById('loader-progress').style.width = p + '%';
    if (text) document.getElementById('loader-text').textContent = text;
  }

  // ========== AUDIO (procedural) ==========
  function initAudio() {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('Audio unavailable');
    }
  }

  function playTone(freq, dur, type = 'sine', vol = 0.3) {
    if (!audioCtx || volume <= 0) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol * volume, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  }

  function playLaugh() {
    // short descending creepy laugh approximation
    if (!audioCtx) return;
    [440, 380, 320, 280, 240].forEach((f, i) => {
      setTimeout(() => playTone(f, 0.18, 'square', 0.22), i * 90);
    });
  }

  function playFootstep() {
    playTone(90 + Math.random() * 30, 0.06, 'triangle', 0.08);
  }

  function playAlarm() {
    playTone(880, 0.4, 'sawtooth', 0.25);
    setTimeout(() => playTone(660, 0.4, 'sawtooth', 0.25), 450);
  }

  // ========== CHARACTER FACTORY ==========
  function createCharacter(opts) {
    const g = new THREE.Group();
    const skin = opts.skin || 0xffdbac;
    const hair = opts.hair || 0x222222;
    const uniform = opts.uniform || 0x4a6fa5;
    const skirt = opts.skirt || 0xc45c7a;
    const isMale = !!opts.male;

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 10),
      new THREE.MeshLambertMaterial({ color: skin })
    );
    head.position.y = 1.55;
    g.add(head);

    // Hair (simple)
    const hairMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 10, 8),
      new THREE.MeshLambertMaterial({ color: hair })
    );
    hairMesh.position.y = 1.62;
    hairMesh.scale.set(1.05, 0.7, 1.1);
    g.add(hairMesh);

    // Body / torso
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.5, 0.22),
      new THREE.MeshLambertMaterial({ color: uniform })
    );
    torso.position.y = 1.15;
    g.add(torso);

    // Arms
    const armMat = new THREE.MeshLambertMaterial({ color: skin });
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 0.1), armMat);
    leftArm.position.set(-0.28, 1.15, 0);
    g.add(leftArm);
    const rightArm = leftArm.clone();
    rightArm.position.x = 0.28;
    g.add(rightArm);

    // Legs / skirt
    if (isMale) {
      const legMat = new THREE.MeshLambertMaterial({ color: 0x2a3a55 });
      const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.14), legMat);
      leftLeg.position.set(-0.1, 0.55, 0);
      g.add(leftLeg);
      const rightLeg = leftLeg.clone();
      rightLeg.position.x = 0.1;
      g.add(rightLeg);
    } else {
      const skirtMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.32, 0.35, 10),
        new THREE.MeshLambertMaterial({ color: skirt })
      );
      skirtMesh.position.y = 0.75;
      g.add(skirtMesh);
      const legMat = new THREE.MeshLambertMaterial({ color: skin });
      const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), legMat);
      leftLeg.position.set(-0.08, 0.35, 0);
      g.add(leftLeg);
      const rightLeg = leftLeg.clone();
      rightLeg.position.x = 0.08;
      g.add(rightLeg);
    }

    // Eyes (simple)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), eyeMat);
    leftEye.position.set(-0.07, 1.57, 0.19);
    g.add(leftEye);
    const rightEye = leftEye.clone();
    rightEye.position.x = 0.07;
    g.add(rightEye);

    g.userData = {
      name: opts.name || 'NPC',
      role: opts.role || 'student',
      speed: opts.speed || 2.2,
      state: 'idle',
      schedule: opts.schedule || [],
      target: null,
      pathIndex: 0,
      talkCooldown: 0,
      reaction: 0,
      isRival: !!opts.isRival,
      eliminated: false,
      basePos: opts.pos ? opts.pos.clone() : new THREE.Vector3(),
      animPhase: Math.random() * Math.PI * 2,
      lastSeenPlayer: 0,
    };

    if (opts.pos) g.position.copy(opts.pos);
    g.rotation.y = opts.rot || 0;
    return g;
  }

  // ========== CAMPUS BUILD ==========
  function addBox(x, y, z, w, h, d, color, receiveShadow = true) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color })
    );
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = receiveShadow;
    scene.add(mesh);
    colliders.push({
      min: new THREE.Vector3(x - w / 2 - 0.15, 0, z - d / 2 - 0.15),
      max: new THREE.Vector3(x + w / 2 + 0.15, h + 0.5, z + d / 2 + 0.15),
    });
    return mesh;
  }

  function buildCampus() {
    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshLambertMaterial({ color: 0x3a7a3a })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Paths
    const pathMat = new THREE.MeshLambertMaterial({ color: 0xb8a88a });
    const path1 = new THREE.Mesh(new THREE.PlaneGeometry(6, 40), pathMat);
    path1.rotation.x = -Math.PI / 2;
    path1.position.set(0, 0.02, 0);
    scene.add(path1);
    const path2 = new THREE.Mesh(new THREE.PlaneGeometry(50, 5), pathMat);
    path2.rotation.x = -Math.PI / 2;
    path2.position.set(0, 0.02, -15);
    scene.add(path2);

    // Main school building
    addBox(0, 0, -28, 28, 8, 14, 0xe8d8c8);
    // Roof
    addBox(0, 8, -28, 30, 1.2, 16, 0x8b3a4a);
    // Entrance
    addBox(0, 0, -20.5, 4, 3.5, 1.5, 0x5a3a2a);
    // Windows (decorative)
    for (let i = -10; i <= 10; i += 4) {
      addBox(i, 3, -20.9, 1.6, 1.8, 0.2, 0x88ccee, false);
      addBox(i, 6, -20.9, 1.6, 1.4, 0.2, 0x88ccee, false);
    }

    // Side wing (library)
    addBox(-22, 0, -28, 12, 6, 12, 0xd8c8b8);
    addBox(-22, 6, -28, 13, 0.8, 13, 0x6a3a4a);

    // Club rooms
    addBox(20, 0, -22, 10, 5, 10, 0xd0c0b0);

    // Fountain
    const fountainBase = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 3, 0.6, 16),
      new THREE.MeshLambertMaterial({ color: 0xaaaaaa })
    );
    fountainBase.position.set(0, 0.3, 5);
    scene.add(fountainBase);
    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, 0.3, 16),
      new THREE.MeshLambertMaterial({ color: 0x4a9ee8, transparent: true, opacity: 0.7 })
    );
    water.position.set(0, 0.7, 5);
    scene.add(water);

    // Trees
    function addTree(x, z) {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.35, 2.2, 8),
        new THREE.MeshLambertMaterial({ color: 0x5a3a20 })
      );
      trunk.position.set(x, 1.1, z);
      trunk.castShadow = true;
      scene.add(trunk);
      const leaves = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, 8, 6),
        new THREE.MeshLambertMaterial({ color: 0x2d8a3a })
      );
      leaves.position.set(x, 3.2, z);
      leaves.castShadow = true;
      scene.add(leaves);
    }
    addTree(-12, 8);
    addTree(12, 10);
    addTree(-18, 0);
    addTree(15, -5);
    addTree(-8, 18);
    addTree(8, 16);

    // Benches
    function addBench(x, z, rot) {
      const seat = new THREE.Mesh(
        new THREE.BoxGeometry(2, 0.15, 0.5),
        new THREE.MeshLambertMaterial({ color: 0x6a4a2a })
      );
      seat.position.set(x, 0.45, z);
      seat.rotation.y = rot || 0;
      scene.add(seat);
    }
    addBench(-6, 6, 0.3);
    addBench(6, 7, -0.4);
    addBench(0, 12, 0);

    // Sports field
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 12),
      new THREE.MeshLambertMaterial({ color: 0x4a9a4a })
    );
    field.rotation.x = -Math.PI / 2;
    field.position.set(25, 0.03, 5);
    scene.add(field);

    // Lockers area (simple wall)
    addBox(-10, 0, -18, 8, 2.5, 0.4, 0x6a7a8a);

    // Cafeteria outdoor tables
    for (let i = 0; i < 3; i++) {
      const table = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.7, 0.1, 10),
        new THREE.MeshLambertMaterial({ color: 0xc4a070 })
      );
      table.position.set(-15 + i * 3, 0.7, 2);
      scene.add(table);
    }

    // Invisible walls around map
    const wallH = 4;
    colliders.push({ min: new THREE.Vector3(-50, 0, -50), max: new THREE.Vector3(50, wallH, -49) });
    colliders.push({ min: new THREE.Vector3(-50, 0, 49), max: new THREE.Vector3(50, wallH, 50) });
    colliders.push({ min: new THREE.Vector3(-50, 0, -50), max: new THREE.Vector3(-49, wallH, 50) });
    colliders.push({ min: new THREE.Vector3(49, 0, -50), max: new THREE.Vector3(50, wallH, 50) });
  }

  // ========== NPCS ==========
  function createNPCs() {
    // Player (heroine)
    player = createCharacter({
      name: 'Аяно',
      hair: 0x1a1a2e,
      uniform: 0x2a4a7a,
      skirt: 0xc45c7a,
      skin: 0xffdbac,
      pos: new THREE.Vector3(0, 0, 12),
    });
    player.userData.role = 'player';
    scene.add(player);
    playerMesh = player;

    // Senpai
    const senpai = createCharacter({
      name: 'Сэмпай',
      male: true,
      hair: 0x3a2a1a,
      uniform: 0x3a4a6a,
      skin: 0xffe0c0,
      pos: new THREE.Vector3(2, 0, 4),
      schedule: [
        { time: 8 * 60, pos: new THREE.Vector3(2, 0, 4) },
        { time: 9 * 60, pos: new THREE.Vector3(0, 0, -18) }, // class
        { time: 12 * 60, pos: new THREE.Vector3(-12, 0, 3) }, // cafeteria
        { time: 13 * 60, pos: new THREE.Vector3(0, 0, -18) },
        { time: 15 * 60, pos: new THREE.Vector3(0, 0, 8) }, // fountain
        { time: 17 * 60, pos: new THREE.Vector3(20, 0, 5) }, // sports
      ],
    });
    senpai.userData.role = 'senpai';
    scene.add(senpai);
    npcs.push(senpai);

    // Rivals (5 for prototype, expandable to 10)
    const rivalData = [
      { name: 'Осана', hair: 0xff6b9d, skirt: 0xff6b9d, pos: new THREE.Vector3(-5, 0, 6), schedule: [
        { time: 8 * 60, pos: new THREE.Vector3(-5, 0, 6) },
        { time: 9 * 60, pos: new THREE.Vector3(-3, 0, -18) },
        { time: 12 * 60, pos: new THREE.Vector3(-10, 0, 4) },
        { time: 15 * 60, pos: new THREE.Vector3(0, 0, 7) },
      ]},
      { name: 'Амаи', hair: 0xffcc88, skirt: 0xffaa66, pos: new THREE.Vector3(8, 0, 3), schedule: [
        { time: 8 * 60, pos: new THREE.Vector3(8, 0, 3) },
        { time: 9 * 60, pos: new THREE.Vector3(4, 0, -18) },
        { time: 12 * 60, pos: new THREE.Vector3(-14, 0, 2) },
        { time: 15 * 60, pos: new THREE.Vector3(10, 0, 8) },
      ]},
      { name: 'Кизана', hair: 0xaa44ff, skirt: 0x8844cc, pos: new THREE.Vector3(-8, 0, -5), schedule: [
        { time: 8 * 60, pos: new THREE.Vector3(-8, 0, -5) },
        { time: 9 * 60, pos: new THREE.Vector3(-6, 0, -18) },
        { time: 12 * 60, pos: new THREE.Vector3(5, 0, 6) },
        { time: 15 * 60, pos: new THREE.Vector3(-12, 0, 10) },
      ]},
      { name: 'Ока', hair: 0x4488ff, skirt: 0x3366aa, pos: new THREE.Vector3(-20, 0, -25), schedule: [
        { time: 8 * 60, pos: new THREE.Vector3(-20, 0, -25) }, // library
        { time: 12 * 60, pos: new THREE.Vector3(-18, 0, -22) },
        { time: 15 * 60, pos: new THREE.Vector3(-15, 0, 5) },
      ]},
      { name: 'Асу', hair: 0x22cc66, skirt: 0x1a9944, pos: new THREE.Vector3(22, 0, 8), schedule: [
        { time: 8 * 60, pos: new THREE.Vector3(22, 0, 8) }, // sports
        { time: 9 * 60, pos: new THREE.Vector3(8, 0, -18) },
        { time: 12 * 60, pos: new THREE.Vector3(18, 0, 6) },
        { time: 15 * 60, pos: new THREE.Vector3(25, 0, 5) },
      ]},
    ];

    rivalData.forEach((r) => {
      const rival = createCharacter({
        name: r.name,
        hair: r.hair,
        skirt: r.skirt,
        uniform: 0x3a5a8a,
        pos: r.pos,
        schedule: r.schedule,
        isRival: true,
      });
      scene.add(rival);
      npcs.push(rival);
    });

    // Extra students
    for (let i = 0; i < 8; i++) {
      const s = createCharacter({
        name: 'Ученик ' + (i + 1),
        hair: [0x222222, 0x8b4513, 0xffdd99, 0x444466][i % 4],
        skirt: i % 2 === 0 ? 0xc45c7a : 0x4a6fa5,
        male: i % 3 === 0,
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * 30,
          0,
          (Math.random() - 0.5) * 25 + 5
        ),
        schedule: [
          { time: 8 * 60, pos: new THREE.Vector3((Math.random() - 0.5) * 20, 0, 5 + Math.random() * 10) },
          { time: 9 * 60, pos: new THREE.Vector3((Math.random() - 0.5) * 10, 0, -18) },
          { time: 12 * 60, pos: new THREE.Vector3(-10 + Math.random() * 10, 0, 2 + Math.random() * 4) },
          { time: 15 * 60, pos: new THREE.Vector3((Math.random() - 0.5) * 25, 0, 5 + Math.random() * 10) },
        ],
      });
      scene.add(s);
      npcs.push(s);
    }
  }

  // ========== COLLISION ==========
  function resolveCollision(pos, radius = 0.35) {
    let nx = pos.x, nz = pos.z;
    for (const c of colliders) {
      if (nx + radius > c.min.x && nx - radius < c.max.x &&
          nz + radius > c.min.z && nz - radius < c.max.z) {
        // simple push out
        const dx1 = c.min.x - (nx + radius);
        const dx2 = c.max.x - (nx - radius);
        const dz1 = c.min.z - (nz + radius);
        const dz2 = c.max.z - (nz - radius);
        const abs = [Math.abs(dx1), Math.abs(dx2), Math.abs(dz1), Math.abs(dz2)];
        const minI = abs.indexOf(Math.min(...abs));
        if (minI === 0) nx = c.min.x - radius;
        else if (minI === 1) nx = c.max.x + radius;
        else if (minI === 2) nz = c.min.z - radius;
        else nz = c.max.z + radius;
      }
    }
    pos.x = nx;
    pos.z = nz;
  }

  // ========== NPC AI ==========
  function updateNPC(npc, dt) {
    if (npc.userData.eliminated) {
      npc.visible = false;
      return;
    }
    const ud = npc.userData;
    ud.animPhase += dt * 6;

    // Schedule following
    if (ud.schedule && ud.schedule.length) {
      let targetPos = ud.schedule[0].pos;
      for (let i = ud.schedule.length - 1; i >= 0; i--) {
        if (gameTime >= ud.schedule[i].time) {
          targetPos = ud.schedule[i].pos;
          break;
        }
      }
      const dist = npc.position.distanceTo(targetPos);
      if (dist > 0.6) {
        const dir = targetPos.clone().sub(npc.position).normalize();
        npc.position.add(dir.multiplyScalar(ud.speed * dt));
        npc.rotation.y = Math.atan2(dir.x, dir.z);
        // simple leg bob
        npc.children.forEach((ch, idx) => {
          if (idx > 5) ch.position.y += Math.sin(ud.animPhase + idx) * 0.01;
        });
      } else {
        // idle slight sway
        npc.rotation.y += Math.sin(ud.animPhase * 0.3) * 0.002;
      }
    }

    // Reaction states
    if (ud.reaction > 0) {
      ud.reaction -= dt;
      // look at player
      const look = player.position.clone().sub(npc.position);
      npc.rotation.y = Math.atan2(look.x, look.z);
    }

    ud.talkCooldown = Math.max(0, ud.talkCooldown - dt);
  }

  // ========== WITNESS & SUSPICION ==========
  function checkWitnesses(eventPos, eventType) {
    let witnesses = 0;
    npcs.forEach((npc) => {
      if (npc.userData.eliminated || npc.userData.role === 'player') return;
      const dist = npc.position.distanceTo(eventPos);
      if (dist > CONFIG.witnessDist) return;
      // angle check
      const toEvent = eventPos.clone().sub(npc.position).normalize();
      const forward = new THREE.Vector3(Math.sin(npc.rotation.y), 0, Math.cos(npc.rotation.y));
      const angle = forward.angleTo(toEvent);
      if (angle < CONFIG.witnessAngle) {
        witnesses++;
        npc.userData.reaction = 3 + Math.random() * 2;
        if (eventType === 'laugh') {
          if (Math.random() > 0.5) {
            // scared
            notify(`${npc.userData.name}: «Она что, чокнутая?»`);
          } else {
            notify(`${npc.userData.name}: «Почему она так смеётся?»`);
          }
        } else if (eventType === 'eliminate') {
          notify(`${npc.userData.name}: «Что-то произошло?!»`, 'alert');
          npc.userData.state = 'alarm';
        }
      }
    });
    return witnesses;
  }

  function raiseSuspicion(amount, reason) {
    suspicion = Math.min(100, suspicion + amount);
    if (reason) addLog(reason);
    updateUI();
    if (suspicion >= 70 && !policeActive) {
      triggerPolice();
    }
  }

  // ========== EVIL LAUGH ==========
  function doEvilLaugh() {
    const now = performance.now();
    if (now - lastLaughTime < 2500) return; // cooldown
    lastLaughTime = now;

    playLaugh();
    // simple laugh animation: lean back
    player.rotation.x = -0.15;
    setTimeout(() => { player.rotation.x = 0; }, 600);

    const witnesses = checkWitnesses(player.position, 'laugh');
    if (witnesses >= 3) {
      raiseSuspicion(8 + witnesses * 2, 'Много свидетелей услышали зловещий смех');
      notify('Ученики обеспокоены твоим смехом...', 'alert');
    } else if (witnesses > 0) {
      raiseSuspicion(3, 'Кто-то услышал странный смех');
    } else {
      notify('Ты зловеще рассмеялась. Никто не заметил.');
    }
    addLog('Зловещий смех');
  }

  // ========== INTERACTION / ELIMINATION ==========
  function tryInteract() {
    // Find closest interactable
    let closest = null;
    let minD = CONFIG.interactionDist;
    npcs.forEach((npc) => {
      if (npc.userData.eliminated) return;
      const d = player.position.distanceTo(npc.position);
      if (d < minD) {
        minD = d;
        closest = npc;
      }
    });

    if (!closest) {
      notify('Рядом никого нет');
      return;
    }

    const ud = closest.userData;
    if (ud.role === 'senpai') {
      showDialog('Сэмпай', 'О, привет... Ты чего-то хотела? Я как раз шёл в библиотеку позже.');
      reputation = Math.min(100, reputation + 3);
      currentQuest = 'Улучшай отношения с Сэмпаем. Следи за соперницами.';
      addLog('Разговор с Сэмпаем');
      updateUI();
      return;
    }

    if (ud.isRival) {
      // Check witnesses for elimination
      const witnesses = checkWitnesses(closest.position, 'eliminate');
      if (isCrouching && witnesses === 0) {
        // Silent elimination (non-graphic)
        ud.eliminated = true;
        closest.visible = false;
        notify(`${ud.name} исчезла при загадочных обстоятельствах...`, 'alert');
        addLog(`Соперница ${ud.name} устранена (скрытно)`);
        raiseSuspicion(5, 'Соперница пропала');
        reputation = Math.max(0, reputation - 5);
        currentQuest = `Соперница ${ud.name} устранена. Следи за реакциями.`;
        // Friends react later
        setTimeout(() => {
          notify('Друзья соперницы начинают волноваться...', 'alert');
          raiseSuspicion(10, 'Друзья заметили пропажу');
        }, 8000);
      } else if (witnesses > 0) {
        notify('Слишком много свидетелей! Нельзя действовать сейчас.', 'alert');
        raiseSuspicion(12, 'Попытка устранения при свидетелях');
        closest.userData.reaction = 5;
      } else {
        showDialog(ud.name, 'Чего тебе нужно? Не стой так близко...');
      }
      updateUI();
      return;
    }

    // Generic student
    const phrases = [
      'Привет! Как дела?',
      'Ты видела Сэмпая сегодня?',
      'Уроки сегодня такие скучные...',
      'Не подходи слишком близко, ладно?',
    ];
    showDialog(ud.name, phrases[Math.floor(Math.random() * phrases.length)]);
  }

  function showDialog(name, text) {
    document.getElementById('dialog-name').textContent = name;
    document.getElementById('dialog-text').textContent = text;
    document.getElementById('dialog-box').classList.remove('hidden');
  }

  // ========== POLICE ==========
  function triggerPolice() {
    if (policeActive) return;
    policeActive = true;
    policeTimer = CONFIG.policeArriveTime;
    playAlarm();
    notify('ТРЕВОГА! Полиция вызвана!', 'police');
    addLog('Полиция вызвана свидетелями');
    currentQuest = 'Полиция едет! Избегай подозрений или спрячься.';
    updateUI();
  }

  function spawnPolice() {
    notify('Полиция прибыла на территорию школы!', 'police');
    addLog('Полиция появилась у входа');
    for (let i = 0; i < 3; i++) {
      const p = createCharacter({
        name: 'Полицейский',
        male: true,
        hair: 0x111111,
        uniform: 0x1a2a4a,
        skin: 0xffdbac,
        pos: new THREE.Vector3(-4 + i * 4, 0, 22),
      });
      // blue "uniform" override
      p.children[2].material.color.setHex(0x1a3a6a);
      p.userData.role = 'police';
      p.userData.speed = 2.8;
      p.userData.schedule = [
        { time: 0, pos: new THREE.Vector3(-4 + i * 4, 0, 10) },
        { time: 1, pos: new THREE.Vector3((i - 1) * 8, 0, -5) },
        { time: 2, pos: new THREE.Vector3(0, 0, -15) },
      ];
      scene.add(p);
      policeEntities.push(p);
      npcs.push(p);
    }
    // NPCs react
    npcs.forEach((n) => {
      if (n.userData.role !== 'police') n.userData.reaction = 4;
    });
  }

  function updatePolice(dt) {
    if (!policeActive) return;
    if (policeTimer > 0) {
      policeTimer -= dt;
      if (policeTimer <= 0) {
        spawnPolice();
      }
    }
  }

  // ========== PLAYER MOVEMENT ==========
  let footstepTimer = 0;
  function updatePlayer(dt) {
    if (isPaused) return;

    let mx = 0, mz = 0;
    if (joystick.active) {
      mx = joystick.x;
      mz = -joystick.y;
    }
    // keyboard fallback
    if (keys['KeyW'] || keys['ArrowUp']) mz -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) mz += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) mx += 1;

    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }

    let speed = CONFIG.playerSpeed;
    if (isRunning) speed *= CONFIG.runMultiplier;
    if (isCrouching) speed *= CONFIG.crouchMultiplier;

    if (len > 0.1) {
      // move relative to camera yaw
      const yaw = camDrag.yaw;
      const dx = mx * Math.cos(yaw) + mz * Math.sin(yaw);
      const dz = -mx * Math.sin(yaw) + mz * Math.cos(yaw);
      player.position.x += dx * speed * dt;
      player.position.z += dz * speed * dt;
      player.rotation.y = Math.atan2(dx, dz);

      footstepTimer -= dt;
      if (footstepTimer <= 0) {
        playFootstep();
        footstepTimer = isRunning ? 0.28 : 0.45;
      }
    }

    resolveCollision(player.position);

    // Camera follow
    const idealOffset = new THREE.Vector3(
      Math.sin(camDrag.yaw) * 5.5,
      2.8 + camDrag.pitch * 2,
      Math.cos(camDrag.yaw) * 5.5
    );
    const targetCam = player.position.clone().add(idealOffset);
    camera.position.lerp(targetCam, 1 - Math.pow(0.001, dt));
    camera.lookAt(
      player.position.x,
      player.position.y + 1.4,
      player.position.z
    );
  }

  // ========== TIME ==========
  function updateTime(dt) {
    // 1 real second ≈ 0.5 in-game minute for faster cycle
    gameTime += dt * 0.5;
    if (gameTime >= 24 * 60) gameTime -= 24 * 60;
    // simple day color
    const hour = (gameTime / 60) % 24;
    let intensity = 0.7;
    if (hour < 6 || hour > 20) intensity = 0.25;
    else if (hour < 8 || hour > 18) intensity = 0.45;
    if (scene.userData.sun) {
      scene.userData.sun.intensity = intensity;
    }
  }

  // ========== INPUT ==========
  function setupInput() {
    // Joystick
    const base = document.getElementById('joystick-base');
    const knob = document.getElementById('joystick-knob');
    const maxR = 32;

    function joyStart(e) {
      e.preventDefault();
      const t = e.changedTouches ? e.changedTouches[0] : e;
      joystick.active = true;
      joystick.id = t.identifier;
      joyMove(e);
    }
    function joyMove(e) {
      if (!joystick.active) return;
      const t = e.changedTouches
        ? Array.from(e.changedTouches).find((x) => x.identifier === joystick.id) || e.changedTouches[0]
        : e;
      if (!t) return;
      const rect = base.getBoundingClientRect();
      let dx = t.clientX - (rect.left + rect.width / 2);
      let dy = t.clientY - (rect.top + rect.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist > maxR) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      joystick.x = dx / maxR;
      joystick.y = dy / maxR;
    }
    function joyEnd(e) {
      joystick.active = false;
      joystick.x = 0;
      joystick.y = 0;
      knob.style.transform = 'translate(-50%, -50%)';
    }

    base.addEventListener('touchstart', joyStart, { passive: false });
    base.addEventListener('touchmove', joyMove, { passive: false });
    base.addEventListener('touchend', joyEnd);
    base.addEventListener('touchcancel', joyEnd);
    // mouse for desktop testing
    base.addEventListener('mousedown', joyStart);
    window.addEventListener('mousemove', (e) => { if (joystick.active) joyMove(e); });
    window.addEventListener('mouseup', joyEnd);

    // Camera swipe
    const swipe = document.getElementById('camera-swipe-area');
    swipe.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      camDrag.active = true;
      camDrag.lastX = t.clientX;
      camDrag.lastY = t.clientY;
    }, { passive: false });
    swipe.addEventListener('touchmove', (e) => {
      if (!camDrag.active) return;
      e.preventDefault();
      const t = e.changedTouches[0];
      const dx = t.clientX - camDrag.lastX;
      const dy = t.clientY - camDrag.lastY;
      camDrag.yaw -= dx * 0.005 * CONFIG.camSens;
      camDrag.pitch = Math.max(-0.4, Math.min(0.7, camDrag.pitch + dy * 0.004 * CONFIG.camSens));
      camDrag.lastX = t.clientX;
      camDrag.lastY = t.clientY;
    }, { passive: false });
    swipe.addEventListener('touchend', () => { camDrag.active = false; });

    // Buttons
    document.getElementById('btn-run').addEventListener('touchstart', (e) => {
      e.preventDefault();
      isRunning = true;
      document.getElementById('btn-run').classList.add('active');
    });
    document.getElementById('btn-run').addEventListener('touchend', () => {
      isRunning = false;
      document.getElementById('btn-run').classList.remove('active');
    });
    document.getElementById('btn-interact').addEventListener('click', tryInteract);
    document.getElementById('btn-laugh').addEventListener('click', doEvilLaugh);
    document.getElementById('btn-crouch').addEventListener('click', () => {
      isCrouching = !isCrouching;
      document.getElementById('btn-crouch').classList.toggle('active', isCrouching);
      player.scale.y = isCrouching ? 0.75 : 1;
    });
    document.getElementById('btn-look').addEventListener('click', () => {
      notify('Осматриваешь окружение... Ничего необычного.');
    });
    document.getElementById('btn-pause').addEventListener('click', () => {
      isPaused = true;
      document.getElementById('pause-menu').classList.remove('hidden');
    });
    document.getElementById('btn-log').addEventListener('click', () => {
      document.getElementById('log-content').innerHTML = eventLog.map((l) => `<div>${l}</div>`).join('') || 'Пока пусто';
      document.getElementById('log-panel').classList.remove('hidden');
    });
    document.getElementById('btn-map').addEventListener('click', () => {
      drawMinimap();
      document.getElementById('map-panel').classList.remove('hidden');
    });

    document.getElementById('dialog-close').addEventListener('click', () => {
      document.getElementById('dialog-box').classList.add('hidden');
    });
    document.getElementById('resume-btn').addEventListener('click', () => {
      isPaused = false;
      document.getElementById('pause-menu').classList.add('hidden');
    });
    document.getElementById('restart-btn').addEventListener('click', () => location.reload());
    document.getElementById('close-log').addEventListener('click', () => {
      document.getElementById('log-panel').classList.add('hidden');
    });
    document.getElementById('close-map').addEventListener('click', () => {
      document.getElementById('map-panel').classList.add('hidden');
    });

    // Settings
    document.getElementById('cam-sens').addEventListener('input', (e) => {
      CONFIG.camSens = parseFloat(e.target.value);
    });
    document.getElementById('vol-range').addEventListener('input', (e) => {
      volume = parseFloat(e.target.value);
    });
    document.getElementById('quality').addEventListener('change', (e) => {
      quality = e.target.value;
      applyQuality();
    });

    // Keyboard
    window.addEventListener('keydown', (e) => { keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  }

  function drawMinimap() {
    const c = document.getElementById('minimap');
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1a0a12';
    ctx.fillRect(0, 0, 280, 200);
    // buildings approx
    ctx.fillStyle = '#5a3a2a';
    ctx.fillRect(90, 20, 100, 50); // school
    ctx.fillStyle = '#3a7a3a';
    ctx.fillRect(0, 80, 280, 120);
    // player
    const px = 140 + player.position.x * 2.2;
    const pz = 100 + player.position.z * 2.2;
    ctx.fillStyle = '#ff2d6a';
    ctx.beginPath();
    ctx.arc(px, pz, 5, 0, Math.PI * 2);
    ctx.fill();
    // senpai
    const senpai = npcs.find((n) => n.userData.role === 'senpai');
    if (senpai) {
      ctx.fillStyle = '#4a9eff';
      ctx.beginPath();
      ctx.arc(140 + senpai.position.x * 2.2, 100 + senpai.position.z * 2.2, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function applyQuality() {
    if (!renderer) return;
    const pr = quality === 'low' ? 0.6 : quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1;
    renderer.setPixelRatio(pr);
    renderer.shadowMap.enabled = quality !== 'low';
  }

  // ========== MAIN LOOP ==========
  function animate() {
    requestAnimationFrame(animate);
    if (isPaused) return;
    const dt = Math.min(clock.getDelta(), 0.05);

    updatePlayer(dt);
    updateTime(dt);
    updatePolice(dt);
    npcs.forEach((n) => updateNPC(n, dt));
    policeEntities.forEach((p) => updateNPC(p, dt));

    // update UI every ~0.5s
    if (Math.floor(performance.now() / 500) % 2 === 0) updateUI();

    renderer.render(scene, camera);
  }

  // ========== INIT ==========
  function init() {
    setProgress(10, 'Инициализация Three.js...');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87b8e0);
    scene.fog = new THREE.Fog(0x87b8e0, 40, 90);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 120);
    camera.position.set(0, 4, 18);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // Lights
    const amb = new THREE.AmbientLight(0xffe8f0, 0.45);
    scene.add(amb);
    const sun = new THREE.DirectionalLight(0xfff5e6, 0.75);
    sun.position.set(20, 40, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 80;
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    scene.add(sun);
    scene.userData.sun = sun;

    setProgress(30, 'Строим кампус...');
    buildCampus();

    setProgress(55, 'Создаём персонажей...');
    createNPCs();

    setProgress(75, 'Настройка управления...');
    setupInput();
    initAudio();
    clock = new THREE.Clock();

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Unlock audio on first touch
    document.body.addEventListener('touchstart', () => {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    }, { once: true });

    setProgress(100, 'Готово!');
    setTimeout(() => {
      document.getElementById('loading').style.opacity = '0';
      setTimeout(() => {
        document.getElementById('loading').style.display = 'none';
        notify('Добро пожаловать в школу. Найди Сэмпая.');
        addLog('Игра началась');
        animate();
      }, 500);
    }, 400);
  }

  // Start
  try {
    init();
  } catch (err) {
    console.error(err);
    document.getElementById('error-box').classList.remove('hidden');
    document.getElementById('error-box').textContent = 'Ошибка: ' + err.message;
    document.getElementById('loading').style.display = 'none';
  }
})();
