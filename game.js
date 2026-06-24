let socket;
let myId;
let myRole = 'spectator';
let localPlayers = {};
let scene, camera, renderer;
let playersMesh = {};
let houseWalls = [];
let terminalMesh;
let doorMesh;
let isKeypadOpen = false;
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let yaw = 0;
let keysPressed = {};

// Setup Audio synthesis
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, duration) {
    if (myRole === 'deaf') return; // Deaf players hear absolutely nothing!
    
    // Resume context if suspended (browser security)
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.value = freq;
    
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

// 1: High beep, 2: Mid beep, 3: Low beep
function playRoleSound(soundIndex) {
    if (soundIndex === 1) playTone(880, 0.4); // A5
    if (soundIndex === 2) playTone(554.37, 0.4); // C#5
    if (soundIndex === 3) playTone(440, 0.4); // A4
}

function showNotification(text, color = '#007aff') {
    const el = document.getElementById('notification');
    el.innerText = text;
    el.style.backgroundColor = color;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function startGame() {
    document.getElementById('lobby-overlay').style.display = 'none';
    
    // Connect to server
    socket = io();

    // Start 3D environment
    init3D();
    setupSocketEvents();
    animate();
}

function init3D() {
    const container = document.getElementById('game-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111118);
    
    // Ambient and Directional Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 15);
    scene.add(dirLight);

    // Floor (The House)
    const floorGeo = new THREE.PlaneGeometry(40, 40);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x33333b, roughness: 0.8 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // House Walls (Layout)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x555566, roughness: 0.5 });
    
    function createWall(x, z, w, d, h = 4) {
        const geo = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geo, wallMat);
        mesh.position.set(x, h/2, z);
        scene.add(mesh);
        houseWalls.push(mesh);
    }

    // Outer Walls
    createWall(0, -20, 40, 1); // North Wall
    createWall(0, 20, 40, 1);  // South Wall
    createWall(-20, 0, 1, 40); // West Wall
    createWall(20, 0, 1, 40);  // East Wall

    // Inner Rooms Walls (Maze structure inside house)
    createWall(-10, 5, 1, 15);
    createWall(10, -5, 1, 15);
    createWall(0, 10, 20, 1);

    // Interactive Puzzle Terminal Mesh (The Keypad machine)
    const termGeo = new THREE.BoxGeometry(2, 2, 2);
    const termMat = new THREE.MeshStandardMaterial({ color: 0x007aff, emissive: 0x002244 });
    terminalMesh = new THREE.Mesh(termGeo, termMat);
    terminalMesh.position.set(0, 1, -15); // Place it at the far north room
    scene.add(terminalMesh);

    // Visual helper light on Terminal
    const termLight = new THREE.PointLight(0x007aff, 1, 8);
    termLight.position.set(0, 2, -15);
    scene.add(termLight);

    // Exit Door
    const doorGeo = new THREE.BoxGeometry(6, 4, 1);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0x441111 });
    doorMesh = new THREE.Mesh(doorGeo, doorMat);
    doorMesh.position.set(0, 2, 19.5); // South wall exit
    scene.add(doorMesh);

    // Camera setup
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.8, 15); // Start position near entrance

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // Window Resize handling
    window.addEventListener('resize', onWindowResize);

    // Input Handlers
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('click', onSceneClick);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Keyboard controls
function onKeyDown(e) {
    keysPressed[e.code] = true;
    
    if (e.code === 'KeyE') {
        // Interact with terminal
        const dist = camera.position.distanceTo(terminalMesh.position);
        if (dist < 4) {
            if (myRole === 'deaf' || myRole === 'mute') {
                toggleKeypad(true);
            } else {
                showNotification("تۆ کوێریت! ناتوانیت شاشەکە یان دوگمەکان ببینی بۆ چاککردنەکە.", "#ff3b30");
            }
        }
    }
}

function onKeyUp(e) {
    keysPressed[e.code] = false;
}

// Mouse look rotation
function onMouseMove(e) {
    if (document.pointerLockElement === document.body) {
        yaw -= e.movementX * 0.0025;
        camera.rotation.y = yaw;
    }
}

// Lock Pointer on canvas click to look around
function onSceneClick() {
    if (!isKeypadOpen && myRole !== 'spectator') {
        document.body.requestPointerLock();
    }

    // Ping system for Mute Player (Left Click to ping in world)
    if (myRole === 'mute') {
        // Cast a ray from camera to ping the location
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
        const intersects = raycaster.intersectObjects(scene.children, true);
        if (intersects.length > 0) {
            const hitPoint = intersects[0].point;
            socket.emit('pingLocation', { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z });
        }
    }
}

function setupSocketEvents() {
    socket.on('init', (data) => {
        myId = data.id;
        myRole = data.role;
        localPlayers = data.players;
        
        applyRoleSettings();

        // Spawn other players already in the server
        for (let id in localPlayers) {
            if (id !== myId) {
                spawnPlayerMesh(localPlayers[id]);
            }
        }
    });

    socket.on('playerJoined', (player) => {
        localPlayers[player.id] = player;
        spawnPlayerMesh(player);
        showNotification(`یاریزانێکی نوێ هاتە ناو یارییەکە وەک: ${player.role}`, "#4cd964");
    });

    socket.on('playerMoved', (player) => {
        if (localPlayers[player.id]) {
            localPlayers[player.id].x = player.x;
            localPlayers[player.id].y = player.y;
            localPlayers[player.id].z = player.z;
            localPlayers[player.id].rotation = player.rotation;

            if (playersMesh[player.id]) {
                playersMesh[player.id].position.set(player.x, player.y, player.z);
                playersMesh[player.id].rotation.y = player.rotation;
            }
        }
    });

    socket.on('playerLeft', (id) => {
        if (playersMesh[id]) {
            scene.remove(playersMesh[id]);
            delete playersMesh[id];
        }
        if (localPlayers[id]) {
            showNotification(`یاریزانێک بەجێی هێشتین: ${localPlayers[id].role}`, "#ff3b30");
            delete localPlayers[id];
        }
    });

    socket.on('chatMessage', (data) => {
        // Deaf player cannot receive incoming text/voice chat cues!
        if (myRole === 'deaf') return;

        addChatMessage(data.role, data.message);
    });

    socket.on('pingVisual', (pos) => {
        // Create a visual glowing sphere at the ping location
        const pingGeo = new THREE.SphereGeometry(0.5, 16, 16);
        const pingMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, wireframe: true });
        const pingSphere = new THREE.Mesh(pingGeo, pingMat);
        pingSphere.position.set(pos.x, pos.y, pos.z);
        scene.add(pingSphere);

        // Sound cue for ping (except Deaf)
        playTone(600, 0.1);
        setTimeout(() => playTone(800, 0.15), 100);

        // Fade and remove
        let scale = 1.0;
        const interval = setInterval(() => {
            scale += 0.1;
            pingSphere.scale.set(scale, scale, scale);
            if (scale > 3) {
                scene.remove(pingSphere);
                clearInterval(interval);
            }
        }, 30);
    });

    socket.on('playSequenceSound', (data) => {
        // Play the 3-beep sound sequence sequentially
        let delay = 0;
        data.sequence.forEach((soundVal) => {
            setTimeout(() => {
                playRoleSound(soundVal);
            }, delay);
            delay += 600;
        });
    });

    socket.on('buttonSuccess', (data) => {
        document.getElementById('puzzle-progress').innerText = `ئاستی کۆدەکە: ${data.step} / ${data.total}`;
        playTone(1000, 0.2); // Green light sound
        showNotification(`دوگمەیەکی ڕاست داگیرا! ${data.step}/${data.total}`, "#4cd964");
    });

    socket.on('buttonWrong', () => {
        document.getElementById('puzzle-progress').innerText = `ئاستی کۆدەکە: 0 / 3`;
        playTone(150, 0.5); // Error buzzer sound
        showNotification("کۆدەکە هەڵەیە! سەرلەنوێ تاقیبکەرەوە.", "#ff3b30");
    });

    socket.on('puzzleSolved', () => {
        showNotification("دەرگا کرایەوە! هەمووتان پێکەوە ڕزگارتان بوو!", "#4cd964");
        doorMesh.position.y = 10; // Raise door to open it
        document.getElementById('puzzle-progress').innerText = "مەتەڵەکە چارەسەرکرا!";
    });
}

function applyRoleSettings() {
    const roleBadge = document.getElementById('my-role');
    roleBadge.className = `role-badge role-${myRole}`;
    
    if (myRole === 'deaf') {
        roleBadge.innerText = 'کەر (Deaf)';
        document.getElementById('chat-container').style.display = 'flex'; // Can type chat
    } else if (myRole === 'mute') {
        roleBadge.innerText = 'لال (Mute)';
        document.getElementById('chat-container').style.display = 'none'; // Cannot use chat!
        showNotification("تۆ لالی! تەنها بە کلیک کردن دەتوانیت ئاماژە دروست بکەیت.", "#ff9500");
    } else if (myRole === 'blind') {
        roleBadge.innerText = 'کوێر (Blind)';
        document.getElementById('chat-container').style.display = 'flex'; // Can chat
        document.getElementById('blind-overlay').style.display = 'block';
        document.getElementById('blind-instructions').style.display = 'block';
        document.getElementById('sound-player-panel').style.display = 'block';
    }
}

function spawnPlayerMesh(player) {
    let color = 0x007aff;
    if (player.role === 'mute') color = 0xff9500;
    if (player.role === 'blind') color = 0xff3b30;

    const geo = new THREE.CapsuleGeometry(0.5, 1.5, 4, 8);
    const mat = new THREE.MeshStandardMaterial({ color: color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(player.x, player.y, player.z);
    
    scene.add(mesh);
    playersMesh[player.id] = mesh;
}

function toggleKeypad(show) {
    isKeypadOpen = show;
    const overlay = document.getElementById('keypad-overlay');
    if (show) {
        overlay.style.display = 'block';
        document.exitPointerLock();
    } else {
        overlay.style.display = 'none';
    }
}

function pressKey(num) {
    socket.emit('pressButton', num);
}

// Sound request for Blind Player
document.getElementById('play-sequence-btn').addEventListener('click', () => {
    socket.emit('requestSequencePlay');
});

// Chat send handler
document.getElementById('chat-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (msg) {
        socket.emit('chatMessage', msg);
        input.value = '';
    }
}

function addChatMessage(role, message) {
    const list = document.getElementById('chat-messages');
    const li = document.createElement('li');
    let roleText = 'کەسێک';
    if (role === 'deaf') roleText = 'کەر';
    if (role === 'blind') roleText = 'کوێر';
    
    li.innerHTML = `<strong class="role-${role}" style="padding: 2px 5px; border-radius:3px;">${roleText}:</strong> ${message}`;
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
}

function animate() {
    requestAnimationFrame(animate);

    // Character controls and basic movement physics
    if (myRole !== 'spectator' && document.pointerLockElement === document.body) {
        const speed = 0.15;
        const dir = new THREE.Vector3();
        
        if (keysPressed['KeyW'] || keysPressed['ArrowUp']) dir.z -= 1;
        if (keysPressed['KeyS'] || keysPressed['ArrowDown']) dir.z += 1;
        if (keysPressed['KeyA'] || keysPressed['ArrowLeft']) dir.x -= 1;
        if (keysPressed['KeyD'] || keysPressed['ArrowRight']) dir.x += 1;

        dir.normalize();
        dir.applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
        
        // Save old position
        const oldPos = camera.position.clone();

        camera.position.addScaledVector(dir, speed);

        // Simple Collision boundaries with outer walls
        if (camera.position.x < -19) camera.position.x = -19;
        if (camera.position.x > 19) camera.position.x = 19;
        if (camera.position.z < -19) camera.position.z = -19;
        if (camera.position.z > 19) camera.position.z = 19;

        // Inner walls basic collision detection
        houseWalls.forEach(wall => {
            const bbox = new THREE.Box3().setFromObject(wall);
            const playerBox = new THREE.Box3(
                new THREE.Vector3(camera.position.x - 0.5, 0, camera.position.z - 0.5),
                new THREE.Vector3(camera.position.x + 0.5, 2, camera.position.z + 0.5)
            );

            if (bbox.intersectsBox(playerBox)) {
                camera.position.copy(oldPos); // Collision! Reset to previous position
            }
        });

        // Show interact button when near terminal
        const dist = camera.position.distanceTo(terminalMesh.position);
        if (dist < 4) {
            document.getElementById('interaction-prompt').style.display = 'block';
        } else {
            document.getElementById('interaction-prompt').style.display = 'none';
        }

        // Send movement to server
        socket.emit('move', {
            x: camera.position.x,
            y: camera.position.y - 0.8, // Model capsule offset
            z: camera.position.z,
            rotation: yaw
        });
    }

    renderer.render(scene, camera);
}
