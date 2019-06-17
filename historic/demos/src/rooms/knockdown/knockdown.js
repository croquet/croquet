import { Room, PhysicalElement, PhysicalWorld, PhysicalShape, ColorPart, THREE, ModelPart, ViewPart, Clickable, Tracking, Colored } from '@croquet/kit';
import px from '../../../assets/envMaps/yard/px.png';
import py from '../../../assets/envMaps/yard/py.png';
import pz from '../../../assets/envMaps/yard/pz.png';
import nx from '../../../assets/envMaps/yard/nx.png';
import ny from '../../../assets/envMaps/yard/ny.png';
import nz from '../../../assets/envMaps/yard/nz.png';

export class TinCan extends PhysicalElement {
    naturalViewClass() {
        return Tracking()(TinCanView);
    }
}

class TinCanView extends PhysicalShape {
    constructor(options) {
        super({...options, material: new THREE.MeshStandardMaterial({
            color: "#ffffff", metalness: 0.9, roughness: 0.3,
            envMap: new THREE.CubeTextureLoader().load( [px, nx, py, ny, pz, nz] ),
            envMapIntensity: 1.5
        })});
    }
}

export class Ball extends PhysicalElement {
    constructor(options, id) {
        super(options, id);
        this.parts.color = new ColorPart();
    }

    naturalViewClass() {
        return Tracking()(Colored()(BallView));
    }
}

export class BallView extends PhysicalShape {
    constructor(options) {
        super({...options, material: new THREE.MeshStandardMaterial({
            color: "#ffffff", metalness: 0.0, roughness: 0.7,
        })});
    }
}

export class ShootingWall extends ModelPart {
    init(options, id) {
        super.init(options, id);
        this.room = options.room;
        this.world = options.world;
    }

    shootBall(position, direction, color) {
        const ball = Ball.create({
            spatial: {
                world: this.world,
                type: "sphere",
                position,
                size: new THREE.Vector3(0.3, 0.3, 0.3),
                friction: 0.4,
                restitution: 0.1,
                density: 1.0,
            },
            color
        });

        const force = direction.multiplyScalar(5);

        const body = ball.parts.spatial.body;
        body.applyImpulse(body.getPosition(), force);

        this.room.parts.elements.add(ball);
    }

    naturalViewClass() {
        return ShootingWallView;
    }
}

export class ShootingWallViewGeo extends ViewPart {
    constructor(options) {
        super(options);

        this.threeObj = new THREE.Mesh(
            new THREE.BoxBufferGeometry(80, 5, 1),
            new THREE.MeshStandardMaterial({color: new THREE.Color("#ffffff"), visible: false})
        );

        this.threeObj.position.y = 2.5;
        this.threeObj.position.z = -2.5;
    }
}

const userColor = new THREE.Color().setHSL(Math.random(), 0.8, 0.5);

const ShootingWallView = Clickable({
    onClick: options => at => {
        options.model.future().shootBall(options.cameraSpatial.position, at.clone().sub(options.cameraSpatial.position).normalize(), userColor);
    }
})(ShootingWallViewGeo);

export default function initKnockdown(_options) {
    const room = Room.create();
    room.addElementManipulators = false;
    room.noNavigation = true;

    const world = PhysicalWorld.create({timestep: 1/320, iterations: 4, stepMultiplier: 5});

    for (let y = 0; y <= 3; y++) {
        for (let x = -15; x <= 15 - y; x += 1) {
            const can = TinCan.create({
                spatial: {
                    world,
                    type: "cylinder",
                    position: new THREE.Vector3(x + 0.5 * y, 0.4 + y * 0.7, -10),
                    size: new THREE.Vector3(0.3, 0.7, 0.3),
                    friction: 0.4,
                    restitution: 0.1,
                    density: 0.3,
                }
            });

            room.parts.elements.add(can);
        }
    }

    const ground = PhysicalElement.create({
        spatial: {
            world,
            type: "box",
            position: new THREE.Vector3(0, -2.5 + 0.1, -10),
            size: new THREE.Vector3(40, 5, 3),
            move: false,
        }
    });
    room.parts.elements.add(ground);

    const shootingWall = ShootingWall.create({room, world});
    room.parts.elements.add(shootingWall);

    return { room };
}
