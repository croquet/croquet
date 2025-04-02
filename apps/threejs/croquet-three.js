import * as THREE from "three";
import * as Croquet from "@croquet/croquet";

// all constants used in the simulation must be defined as Croquet.Constants
const C = Croquet.Constants;
C.carSpeed = 0.15;
C.turnSpeed = 0.05;
C.trainSpeed = 0.01;
C.trainRadius = 30;

// Any Croquet app must be split into model and view.
// The model is the shared simulation state.
// The view is the interface between the simulation and the local client.

// The shared simulation model must be entirely self-contained
// and not depend on any state outside of it.
// This is to ensure that all clients have the same simulation state.

class SharedSimulation extends Croquet.Model {

    init() { // Note that models are initialized with "init" instead of "constructor"!

        // randomly generate mountains, trees, and clouds
        this.mountains = this.createMountains(15);
        this.trees = this.createTrees(50);
        this.clouds = this.createClouds(20);

        // synchronize train angle
        this.trainAngle = 0;

        // generate a car for each player
        this.cars = new Map();
        this.subscribe(this.sessionId, "view-join", this.onViewJoin);
        this.subscribe(this.sessionId, "view-exit", this.onViewExit)

        // step the simulation 20 times per second
        this.step(50);
    }

    onViewJoin(viewId) {
        const car = SimCar.create(viewId);
        this.cars.set(viewId, car);
        this.publish("sim", "car-added", car);
    }

    onViewExit(viewId) {
        const car = this.cars.get(viewId);
        this.cars.delete(viewId);
        car.destroy();
        this.publish("sim", "car-removed", car);
    }

    step(ms) {
        const deltaTime = ms / 1000;
        this.moveTrain(deltaTime);
        for (const car of this.cars.values()) {
            car.move(deltaTime);
        }

        this.future(100).step(ms);
    }

    moveTrain(deltaTime) {
        this.trainAngle += C.trainSpeed * (deltaTime * 60); // Normalize speed
        if (this.trainAngle > Math.PI * 2) {
            this.trainAngle -= Math.PI * 2; // Loop the angle
        }
    }

    createMountains(count) {
        const mountains = [];
        for (let i = 0; i < count; i++) {
            const height = Math.random() * 30 + 10;
            const radius = Math.random() * 10 + 5;
            const position = {
                x: (Math.random() - 0.5) * 180, // Spread them out
                z: (Math.random() - 0.5) * 180,
                y: height / 2, // Base on the ground plane
            };
            // Ensure mountains are far from the central road area
            if (Math.abs(position.x) < 20) position.x += Math.sign(position.x) * 20;
            mountains.push({ height, radius, position });
        }
        return mountains;
    }

    createTrees(count) {
        const trees = [];
        for (let i = 0; i < count; i++) {
            const trunkHeight = Math.random() * 3 + 1;
            const trunkRadius = trunkHeight * 0.1;
            const leavesHeight = Math.random() * 4 + 2;
            const leavesRadius = leavesHeight * 0.4;
            // Position the tree randomly, avoiding the road
            const tree = {
                trunk: {
                    height: trunkHeight,
                    radius: trunkRadius,
                },
                leaves: {
                    height: leavesHeight,
                    radius: leavesRadius,
                },
                position: {
                    x: (Math.random() - 0.5) * 150,
                    z: (Math.random() - 0.5) * 150,
                    y: 0,
                },
            };
            // Ensure trees are off the road (road width is 8, give some buffer)
            if (Math.abs(tree.position.x) < 6) {
                tree.position.x += Math.sign(tree.position.x || 1) * 6; // Move it away if too close
            }
            trees.push(tree);
        }
        return trees;
    }

    createClouds(count) {
        const clouds = [];
        for (let i = 0; i < count; i++) {
            const numSpheres = Math.floor(Math.random() * 5) + 3; // 3 to 7 spheres per cloud
            const spheres = [];
            for (let j = 0; j < numSpheres; j++) {
                const radius = Math.random() * 5 + 2;
                // Offset spheres slightly to form cloud shape
                const position = {
                    x: (Math.random() - 0.5) * 10,
                    z: (Math.random() - 0.5) * 5,
                    y: (Math.random() - 0.5) * 3,
                };
                spheres.push({ radius, position });
            }
            // Position the cloud group high up and spread out
            const position = {
                x: (Math.random() - 0.5) * 180,
                z: (Math.random() - 0.5) * 180,
                y: Math.random() * 20 + 30, // Height range
            };
            clouds.push({ spheres, position });
        }
        return clouds;
    }
    // Add more methods to manipulate the simulation state as needed
}
SharedSimulation.register("SharedSimulation");

class SimCar extends Croquet.Model {
    init(viewId) {
        this.viewId = viewId;
        this.color = `hsl(${Math.random() * 360}, 100%, 50%)`;
        this.pos = {
            x: Math.random() * 4 - 2,
            z: Math.random() * 4 - 2,
            y: 0.2,
        };
        this.angle = 0;
        this.controls = {
            forward: false,
            backward: false,
            left: false,
            right: false
        };
        // Subscribe to control events from "our" player
        this.subscribe(viewId, "control", this.onControl);
    }

    onControl({ control, value }) {
        this.controls[control] = value;
    }

    get speed() { return this.controls.forward ? 1 : this.controls.backward ? -0.5 : 0; }
    get turn() { return this.controls.left ? this.speed : this.controls.right ? -this.speed : 0; }
    get sim () { return this.wellKnownModel("modelRoot"); }

    move(deltaTime) {
        const turn = C.turnSpeed * this.turn * (deltaTime * 60); // Normalize turn
        this.angle = (this.angle + turn) % (Math.PI * 2); // Loop the angle
        const speed = C.carSpeed * this.speed * (deltaTime * 60); // Normalize speed
        const z = speed * Math.cos(this.angle);
        const x = speed * Math.sin(this.angle);
        this.pos.z += z;
        this.pos.x += x;
        // check collision with other cars
        for (const otherCar of this.sim.cars.values()) {
            if (otherCar !== this && this.distanceTo(otherCar) < 2) {
                otherCar.pos.z += 10 * z;
                otherCar.pos.x += 10 * x;
            }
        }
    }

    distanceTo(otherCar) {
        return Math.sqrt(
            (this.pos.x - otherCar.pos.x) ** 2 +
            (this.pos.z - otherCar.pos.z) ** 2
        );
    }

    destroy() {
        this.unsubscribe(this.viewId, "control");
        this.sim.publish("sim", "car-removed", this);
    }
}
SimCar.register("SimCar");

// Interface between shared simulation and local Three.js scene.
// Any manipulation of the simulation state must be through this interface
// to ensure it stays synchronized across all clients

class SimInterface extends Croquet.View {
    constructor(sim) {
        super(sim);
        this.sim = sim;

        // Basic Scene Setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb); // Sky blue
        this.scene.fog = new THREE.Fog(0x87ceeb, 50, 150); // Add fog

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            200
        );
        this.camera.position.set(0, 5, -10); // Initial position slightly behind where the car will be
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true; // Enable shadows
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        // --- Fixed Objects (exist only in Interface) ---

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 50, 25);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.left = -100;
        directionalLight.shadow.camera.right = 100;
        directionalLight.shadow.camera.top = 100;
        directionalLight.shadow.camera.bottom = -100;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 200;
        this.scene.add(directionalLight);

        // Ground
        const groundGeometry = new THREE.PlaneGeometry(200, 200);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x55aa55,
            side: THREE.DoubleSide
        }); // Green
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2; // angleate flat
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Road
        const roadGeometry = new THREE.PlaneGeometry(8, 200); // Narrow and long
        const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 }); // Dark grey
        const road = new THREE.Mesh(roadGeometry, roadMaterial);
        road.rotation.x = -Math.PI / 2;
        road.position.y = 0.01; // Slightly above ground
        road.receiveShadow = true;
        this.scene.add(road);

        // --- Shared Objects (generated in Model) ---

        this.makeMountainsFromSim();
        this.makeTreesFromSim();
        this.makeCloudsFromSim();

        // --- Dynamic Objects (controlled by Model) ---

        this.train = this.createTrain();
        this.train.position.y = 0.2; // Slightly above ground
        this.scene.add(this.train);
        this.trainAngle = this.sim.trainAngle;

        // Create 3D objects for all cars in sim
        this.carObjects = new Map();
        for (const simCar of this.sim.cars.values()) {
            this.onCarAdded(simCar);
        }

        // the car we control
        this.mySimCar = sim.cars.get(this.viewId);

        // Create cars for any new players
        this.subscribe("sim", "car-added", this.onCarAdded);
        this.subscribe("sim", "car-removed", this.onCarRemoved);

        window.onresize = () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        };
    }

    // this is called when the session is interrupted
    detach() {
        this.renderer.dispose();
    }

    onCarAdded(simCar) {
        const carObj = this.createCar(simCar);
        this.carObjects.set(simCar.viewId, carObj);
        this.scene.add(carObj);
        if (simCar === this.mySimCar) myCar = carObj;
    }

    onCarRemoved(simCar) {
        const carObj = this.carObjects.get(simCar.viewId);
        if (carObj) {
            this.scene.remove(carObj);
            this.carObjects.delete(simCar.viewId);
            if (simCar === this.mySimCar) myCar = null;
        }
    }

    update() {
        // lerp the train angle to smooth out the movement
        this.trainAngle = lerpAngle(this.trainAngle, this.sim.trainAngle, 0.1);
        this.updateTrain(this.trainAngle);
        this.updateCars(this.carObjects, this.sim.cars);
        this.updateCamera(this.carObjects.get(this.viewId));

        this.renderer.render(this.scene, this.camera);
    }

    updateTrain(trainAngle) {
        const trainX = Math.cos(trainAngle) * C.trainRadius;
        const trainZ = Math.sin(trainAngle) * C.trainRadius;
        this.train.position.x = trainX;
        this.train.position.z = trainZ;

        // Make train face forward
        const nextAngle = trainAngle + 0.01; // Look slightly ahead
        const nextX = Math.cos(nextAngle) * C.trainRadius;
        const nextZ = Math.sin(nextAngle) * C.trainRadius;
        this.train.lookAt(nextX, this.train.position.y, nextZ);
    }

    updateCars(carObjs, simCars) {
      for (const [id, carObj] of carObjs) {
        const simCar = simCars.get(id);
        if (simCar) {
          // Smoothly interpolate rotation
          let prevAngle = carObj.userData.angle;
          let newAngle = lerpAngle(prevAngle, simCar.angle, 0.1);
          carObj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), newAngle);
          carObj.userData.angle = newAngle;
          // Smoothly interpolate position
          carObj.position.lerp(simCar.pos, 0.1);
        }
      }
    }

    updateCamera(car) {
      if (!car || !car.userData.cameraTarget) return;

      const targetPosition = new THREE.Vector3();
      // Get the world position of the invisible target object added to the car group
      car.userData.cameraTarget.getWorldPosition(targetPosition);

      // Smoothly interpolate camera position towards the target
      this.camera.position.lerp(targetPosition, 0.05);

      // Always look at the car's main body position
      const lookAtPosition = new THREE.Vector3();
      car.getWorldPosition(lookAtPosition); // Get car's world position
      lookAtPosition.y += 0.5; // Look slightly above the car's base
      this.camera.lookAt(lookAtPosition);
    }


    makeMountainsFromSim() {
        // Mountains (randomly generated in the sim model)
        const mountainMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 }); // Brown
        const snowMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff }); // White snow caps
        for (const { height, radius, position } of this.sim.mountains) {
            const mountainGeometry = new THREE.ConeGeometry(radius, height, 8); // Low poly cone
            const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial);
            mountain.position.set(position.x, position.y, position.z);
            mountain.castShadow = true;
            this.scene.add(mountain);

            // Add snow cap
            if (height > 25) {
                const snowHeight = height * 0.3;
                const snowRadius = radius * (snowHeight / height) * 0.8; // Tapered snow cap
                const snowGeometry = new THREE.ConeGeometry(snowRadius, snowHeight, 8);
                const snowCap = new THREE.Mesh(snowGeometry, snowMaterial);
                snowCap.position.y = height - snowHeight * 2; // Position at top
                mountain.add(snowCap); // Add as child
            }
        }
    }

    makeTreesFromSim() {
        // Trees (randomly generated in the sim model)
        const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 }); // Brown
        const leavesMaterial = new THREE.MeshStandardMaterial({ color: 0x228b22 }); // Forest Green
        for (const { trunk, leaves, position } of this.sim.trees) {
            const tree = new THREE.Group();
            // Trunk
            const trunkGeometry = new THREE.CylinderGeometry(
                trunk.radius * 0.7,
                trunk.radius,
                trunk.height,
                8
            );
            const trunkMesh = new THREE.Mesh(trunkGeometry, trunkMaterial);
            trunkMesh.position.set(position.x, trunk.height / 2, position.z);
            trunkMesh.castShadow = true;
            tree.add(trunkMesh);
            // Leaves
            const leavesGeometry = new THREE.ConeGeometry(
                leaves.radius,
                leaves.height,
                6
            );
            const leavesMesh = new THREE.Mesh(leavesGeometry, leavesMaterial);
            leavesMesh.position.set(
                position.x,
                trunk.height + leaves.height / 2 - 0.2, // Sit on top of trunk
                position.z);
            leavesMesh.castShadow = true;
            tree.add(leavesMesh);
            // Add tree to scene
            this.scene.add(tree);
        }
    }

    makeCloudsFromSim() {
        // Clouds (randomly generated in the sim model)
        const cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
        for (const { spheres, position: cloudPosition } of this.sim.clouds) {
            const cloud = new THREE.Group();
            for (const { radius, position: spherePosition } of spheres) {
                const sphereGeometry = new THREE.SphereGeometry(radius, 8, 8);
                const sphereMesh = new THREE.Mesh(sphereGeometry, cloudMaterial);
                sphereMesh.position.copy(spherePosition);
                cloud.add(sphereMesh);
            }
            cloud.position.copy(cloudPosition);
            this.scene.add(cloud);
        }
    }

    createTrain() {
        const trainGroup = new THREE.Group();

        const colors = [0x4444ff, 0xffaa00, 0x44ff44]; // Blue engine, orange, green cars
        const carLength = 5;
        const carWidth = 2;
        const carHeight = 1.8;
        const gap = 0.5;

        for (let i = 0; i < 3; i++) {
            const carGeometry = new THREE.BoxGeometry(carWidth, carHeight, carLength);
            const carMaterial = new THREE.MeshStandardMaterial({ color: colors[i] });
            const trainCar = new THREE.Mesh(carGeometry, carMaterial);
            trainCar.position.z = -(i * (carLength + gap)); // Position cars behind each other
            trainCar.castShadow = true;
            trainCar.receiveShadow = true;
            trainGroup.add(trainCar);

            // Simple wheels for each car
            const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.2, 8);
            const wheelMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
            const wheelPositions = [
                { x: carWidth / 2 + 0.1, z: carLength / 2 - 0.5 },
                { x: carWidth / 2 + 0.1, z: -carLength / 2 + 0.5 },
                { x: -carWidth / 2 - 0.1, z: carLength / 2 - 0.5 },
                { x: -carWidth / 2 - 0.1, z: -carLength / 2 + 0.5 }
            ];
            wheelPositions.forEach((pos) => {
                const wheel = new THREE.Mesh(wheelGeo, wheelMat);
                wheel.rotation.x = Math.PI / 2;
                wheel.position.set(
                pos.x,
                -carHeight / 2 + 0.4,
                trainCar.position.z + pos.z
                );
                wheel.castShadow = true;
                trainGroup.add(wheel);
            });
        }
        return trainGroup;
    }

    createCar(simCar) {
        const carGroup = new THREE.Group();
        carGroup.userData.angle = simCar.angle;
        carGroup.position.copy(simCar.pos);
        carGroup.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), simCar.angle);

        // Body
        const bodyGeometry = new THREE.BoxGeometry(1.5, 0.6, 3);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: simCar.color });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.3;
        body.castShadow = true;
        carGroup.add(body);

        // Cabin
        const cabinGeometry = new THREE.BoxGeometry(1.3, 0.5, 1.5);
        const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc }); // Light grey
        const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
        cabin.position.set(0, 0.75, -0.3); // y = body.y + body.height/2 + cabin.height/2
        cabin.castShadow = true;
        carGroup.add(cabin);

        // Wheels
        const wheelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.3, 16);
        const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 }); // Dark grey/black

        const wheelPositions = [
            { x: 0.8, y: 0, z: 1.0 }, // Front right
            { x: -0.8, y: 0, z: 1.0 }, // Front left
            { x: 0.8, y: 0, z: -1.0 }, // Back right
            { x: -0.8, y: 0, z: -1.0 } // Back left
        ];

        wheelPositions.forEach((pos) => {
            const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
            wheel.rotation.z = Math.PI / 2; // angleate to stand upright
            wheel.position.set(pos.x, pos.y + 0.15, pos.z); // Adjust y based on radius
            wheel.castShadow = true;
            carGroup.add(wheel);
        });

        // Add invisible object for camera tracking point slightly behind the car
        const cameraTarget = new THREE.Object3D();
        cameraTarget.position.set(0, 2, -5); // Behind and slightly above
        carGroup.add(cameraTarget);
        carGroup.userData.cameraTarget = cameraTarget; // Store reference

        return carGroup;
    }
}

function lerpAngle(a, b, t) {
    if (a - b > Math.PI) a -= Math.PI * 2;
    if (a - b < -Math.PI) a += Math.PI * 2;
    return a + (b - a) * t;
}

// User Input published via view

const myControls = {
    forward: false,
    backward: false,
    left: false,
    right: false,

    set(control, value) {
        if (this[control] === value) return; // No change
        this[control] = value;
        const { view } = ThisSession;
        if (view) {
            view.publish(view.viewId, "control", { control, value });
        }
    }
};

// This is the interface between the user and the simulation
function setupControls() {
    const btnFwd = document.getElementById("btn-fwd");
    const btnBwd = document.getElementById("btn-bwd");
    const btnLeft = document.getElementById("btn-left");
    const btnRight = document.getElementById("btn-right");

    const touchStartHandler = (control) => (e) => {
        e.preventDefault();
        myControls.set(control, true);
    };
    const touchEndHandler = (control) => (e) => {
        // Check if any remaining touches are on the *same* button
        let stillTouching = false;
        if (e.touches) {
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].target === e.target) {
                    stillTouching = true;
                    break;
                }
            }
        }
        if (!stillTouching) {
            myControls.set(control, false);
        }
    };

    btnFwd.addEventListener("touchstart", touchStartHandler("forward"), { passive: false });
    btnBwd.addEventListener("touchstart", touchStartHandler("backward"), { passive: false });
    btnLeft.addEventListener("touchstart", touchStartHandler("left"), { passive: false });
    btnRight.addEventListener("touchstart", touchStartHandler("right"), { passive: false });
    btnFwd.addEventListener("touchend", touchEndHandler("forward"));
    btnBwd.addEventListener("touchend", touchEndHandler("backward"));
    btnLeft.addEventListener("touchend", touchEndHandler("left"));
    btnRight.addEventListener("touchend", touchEndHandler("right"));
    btnFwd.addEventListener("touchcancel", touchEndHandler("forward"));
    btnBwd.addEventListener("touchcancel", touchEndHandler("backward"));
    btnLeft.addEventListener("touchcancel", touchEndHandler("left"));
    btnRight.addEventListener("touchcancel", touchEndHandler("right"));

    // Prevent scrolling on the controls themselves
    document.querySelector(".controls").addEventListener(
        "touchmove",
        (e) => {  e.preventDefault();  },
        { passive: false }
    );

    const keys = {
        w: "forward",  "arrowup": "forward",
        a: "left",     "arrowleft": "left",
        s: "backward", "arrowdown": "backward",
        d: "right",    "arrowright": "right",
    };
    window.addEventListener("keydown", (e) => {
        const dir = keys[e.key.toLowerCase()];
        if (dir) myControls.set(dir, true);
    });
    window.addEventListener("keyup", (e) => {
        const dir = keys[e.key.toLowerCase()];
        if (dir) myControls.set(dir, false);
    });
}

const ThisSession = await Croquet.Session.join({
    apiKey: "234567_Paste_Your_Own_API_Key_Here_7654321",
    appId: "io.croquet.threejs",
    model: SharedSimulation,
    view: SimInterface,
});

setupControls();
