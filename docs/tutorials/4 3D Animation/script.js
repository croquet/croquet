// Croquet Tutorial 4
// 3D Animation
// Croquet Labs, 2019

const Q = Croquet.Constants;
Q.NUM_BALLS = 25;            // number of bouncing balls
Q.BALL_RADIUS = 0.25;
Q.CENTER_SPHERE_RADIUS = 1;  // a large sphere to bounce off
Q.CONTAINER_SIZE = 4;        // edge length of invisible containing cube
Q.STEP_MS = 1000 / 20;       // step time in ms
Q.SPEED = 1;                 // max speed on a dimension, in units/s

class MyModel extends Croquet.Model {

    init(options) {
        super.init(options);
        this.centerSphereRadius = Q.CENTER_SPHERE_RADIUS;
        this.children = [];
        for (let i = 0; i < Q.NUM_BALLS; i++) this.children.push(BallModel.create({ sceneModel: this }));
    }
}

MyModel.register("MyModel");

class BallModel extends Croquet.Model {

    init(options={}) {
        super.init();

        const rand = range => Math.floor(range * this.random()); // integer random less than range
        this.radius = Q.BALL_RADIUS;
        this.color = `hsl(${rand(360)},${rand(50)+50}%,50%)`;
        this.reset();

        this.subscribe(options.sceneModel.id, "reset", this.reset);

        this.future(Q.STEP_MS).step();
    }

    reset() {
        const srand = range => range * 2 * (this.random() - 0.5); // float random between -range and +range
        this.pos = [0, 0, 0];
        const speedRange = Q.SPEED * Q.STEP_MS / 1000; // max speed per step
        this.speed = [ srand(speedRange), srand(speedRange), srand(speedRange) ];
    }

    moveTo(pos) {
        this.pos = pos;
        this.publish(this.id, 'pos-changed', this.pos);
    }

    bounceOffCenterSphere() {
        // sphere is assumed to be at the origin
        const pos = this.pos;
        const speed = this.speed;
        const distFromCenter = ([x, y, z]) => Math.sqrt(x*x + y*y + z*z);
        const distBefore = distFromCenter(pos);
        const distAfter = distFromCenter([ pos[0] + speed[0], pos[1] + speed[1], pos[2] + speed[2] ]);
        const movingIn = distAfter < distBefore;
        if (distAfter < Q.CENTER_SPHERE_RADIUS + this.radius && movingIn) {
            const unitToCenter = pos.map(v => v/distBefore);
            const speedAcrossBoundary = speed[0] * unitToCenter[0] + speed[1] * unitToCenter[1] + speed[2] * unitToCenter[2];
            this.speed = this.speed.map((v, i) => v - 2 * speedAcrossBoundary * unitToCenter[i]);
        }
    }

    bounceOffContainer() {
        const pos = this.pos;
        const speed = this.speed;
        pos.forEach((p, i) => {
            if (Math.abs(p) > Q.CONTAINER_SIZE/2 - this.radius) speed[i] = Math.abs(speed[i]) * -Math.sign(p);
            });
    }

    moveBounce() {
        this.bounceOffCenterSphere();
        this.bounceOffContainer();
        const pos = this.pos;
        const speed = this.speed;
        this.moveTo([ pos[0] + speed[0], pos[1] + speed[1], pos[2] + speed[2] ]);
    }

    step() {
        this.moveBounce();
        this.future(Q.STEP_MS).step();
    }
}

BallModel.register("BallModel");

function setUpScene() {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const light = new THREE.PointLight(0xffffff, 1);
    light.position.set(50, 50, 50);
    scene.add(light);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
    camera.position.set(0, 0, 4);
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("three") });
    renderer.setClearColor(0xaa4444);

    function onWindowResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener('resize', onWindowResize, false);
    onWindowResize();

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    function onPointerDown(event) {
        // modeled after https://threejs.org/docs/#api/en/core/Raycaster
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(scene.children);
	      for (let i = 0; i < intersects.length; i++) {
            const threeObj = intersects[i].object;
            if (threeObj.onPointerDown) threeObj.onPointerDown();
        }
	  }
    window.addEventListener('mousedown', onPointerDown, false);

    function animate() {
       requestAnimationFrame(animate);
       renderer.render(scene, camera);
    }
    animate();

    return scene;
}

class MyView extends Croquet.View {

    constructor(model) {
        super(model);
        this.scene = setUpScene();
        this.centerSphere = new THREE.Mesh(
          new THREE.SphereGeometry(model.centerSphereRadius, 16, 16),
          new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.75 }));
        this.scene.add(this.centerSphere);
        this.centerSphere.onPointerDown = () => this.publish(model.id, "reset");

        model.children.forEach(childModel => this.attachChild(childModel));
    }

    attachChild(childModel) {
        this.scene.add(new BallView(childModel).object3D);
    }
}

class BallView extends Croquet.View {

    constructor(model) {
        super(model);
        this.object3D = new THREE.Mesh(
          new THREE.SphereGeometry(model.radius, 12, 12),
          new THREE.MeshStandardMaterial({ color: model.color })
          );
        this.move(model.pos);
        this.subscribe(model.id, { event: 'pos-changed', handling: "oncePerFrame" }, this.move);
    }

    move(pos) {
        this.object3D.position.fromArray(pos);
    }
}

Croquet.Session.join("3D Animation", MyModel, MyView);
