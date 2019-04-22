import * as THREE from "three";
import PortalViewPart from "./viewParts/portalView";
import THREEx_imports from "../thirdparty-patched/ARjs/ar";
import cameraData from "../thirdparty-patched/ARjs/data/camera_para.dat";
import croquetPatternData from "../thirdparty-patched/ARjs/data/croquet.patt";
//import hiroPatternData from "../thirdparty-patched/ARjs/data/patt.hiro";
import urlOptions from "./util/urlOptions";

const THREEx = THREEx_imports && THREEx_imports.THREEx;

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const RENDER_LAYERS = {
    NORMAL: 0,
    ALL_PORTALS: 1,
    INDIVIDUAL_PORTAL: 2,
};

export const rendererVersion = {renderingContextVersion: '2', shaderLanguageVersion: '300'};

export default class Renderer {
    constructor(width, height) {
        this.inAR = urlOptions.ar;
        const contextAttributes = {
            alpha: this.inAR, //false,
            depth: true,
            stencil: true,
            antialias: true,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            powerPreference: "default"
        };

        const canvas = document.createElement('canvas');
        canvas.id = 'qanvas';
        let context = canvas.getContext("webgl2", contextAttributes);
        if (!context) {
            // fallback to webgl1
            rendererVersion.renderingContextVersion = '1';
            rendererVersion.shaderLanguageVersion = '100';
            context = canvas.getContext("webgl", contextAttributes);
        }
        this.renderer = new THREE.WebGLRenderer({canvas, context});
        this.renderer.autoClearStencil = false;
        this.renderer.autoClearDepth = false;
        this.renderer.autoClearColor = false;
        this.renderer.autoClear = false;
        this.renderer.localClippingEnabled = true;
        //this.renderer.setPixelRatio(window.devicePixelRatio);
        this.changeViewportSize(width, height);
        document.body.appendChild(this.renderer.domElement);

        if (this.inAR) this.initAR();
    }

    initAR() {
        this.arCamera = new THREE.Camera();

        this.arToolkitSource = new THREEx.ArToolkitSource({
            // to read from the webcam
            sourceType: 'webcam'
            });
        this.arToolkitSource.init(() => {
            this.onResize();
            });
        // create atToolkitContext
        this.arToolkitContext = new THREEx.ArToolkitContext({
            cameraParametersUrl: cameraData,
            detectionMode: 'mono',
            });
        // initialize it
        this.arToolkitContext.init(() => {
            // copy projection matrix to camera
            this.arCamera.projectionMatrix.copy(this.arToolkitContext.getProjectionMatrix());
            });
        // init controls for camera
        this.markerControls = new THREEx.ArMarkerControls(this.arToolkitContext, this.arCamera, {
            type: 'pattern',
            patternUrl: croquetPatternData, //hiroPatternData,
            // as we controls the camera, set changeMatrixMode: 'cameraTransformMatrix'
            changeMatrixMode: 'cameraTransformMatrix'
            });

// NOT USED
function smoother() {
    const samples = 10;
    let total = 0;
    let array = [];
    return newVal => {
        array.push(newVal);
        total += newVal;
        if (array.length > samples) total -= array.shift();
        return total / array.length;
        };
}

        this.posQuatHistory = [];
        const maxHistory = 10;
        this.addToHistory = (pos, quat) => {
            const history = this.posQuatHistory;
            const spec = history.length > maxHistory ? history.shift() : { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
            spec.pos.copy(pos);
            spec.quat.copy(quat);
            history.push(spec);
            };
        this.checkWithinEpsilon = (refSpec, otherSpec) => {
            // if refSpec and otherSpec are very close, return null
            // otherwise return the refSpec, with any property that *is* close nulled out.
            const { pos, quat } = refSpec;
            let someChange = false;
            if (pos) {
                const posEpsilon = otherSpec.pos.length() * (window.eps || 0.1); // @@ DEBUG HOOK
                if (pos.distanceTo(otherSpec.pos) <= posEpsilon) refSpec.pos = null;
                else someChange = true;
            }
            if (quat) {
                const angleEpsilon = (window.aeps || 4) * Math.PI / 180; // @@ DEBUG HOOK
                if (quat.angleTo(otherSpec.quat) <= angleEpsilon) refSpec.quat = null;
                else someChange = true;
            }
            return someChange ? refSpec : null;
            };
        this.checkStability = refSpec => {
            // refSpec can have a non-falsy pos, or quat, or both.
            // return true iff recent history is stable wrt the properties set in refSpec.
            const history = this.posQuatHistory;
            const stableHistory = window.stab || 4; // @@ DEBUG HOOK
            if (history.length < stableHistory) return false;
            // if there is any non-null answer from checkWithinEpsilon, the state is not stable
            return !history.slice(-stableHistory).some(spec => this.checkWithinEpsilon(Object.assign({}, refSpec), spec));
            };

        this.stablePos = null;
        this.stableQuat = null;

        this.positioning = {
            pos: new THREE.Vector3(),
            quat: new THREE.Quaternion(),
            stepSpec: { posDelta: new THREE.Vector3(), angleDelta: 0, remainingSteps: 0 },
            rotation: new THREE.Matrix4().makeRotationX(Math.PI / 2),
            translation: new THREE.Matrix4().makeTranslation(0, 0.5, -2.5),
            matW: new THREE.Matrix4(),
            posW: new THREE.Vector3(),
            quatW: new THREE.Quaternion(),
            scaleW: new THREE.Vector3(),
//smoothers: { x: smoother(), y: smoother(), z: smoother() },
            };
    }

    onResize() {
        if (!this.arToolkitSource) return;

        this.arToolkitSource.onResizeElement();
        this.arToolkitSource.copyElementSizeTo(this.renderer.domElement);
        if (this.arToolkitContext.arController !== null) {
            this.arToolkitSource.copyElementSizeTo(this.arToolkitContext.arController.canvas);
        }
    }

    changeViewportSize(width, height) {
        this.renderer.setSize(width, height);
        this.onResize();
    }

    render(room, allRooms, roomViewManager) {
        const inAR = this.inAR;

        const currentRoomView = roomViewManager.expect(room);
        // Portal rendering technique inspired by https://github.com/zadvorsky/three.portals/blob/master/src/THREE.PortalController.js
        const mainScene = currentRoomView.parts.roomScene.threeObj;
        /** @type {THREE.Camera} */
        const mainCamera = currentRoomView.parts.camera.threeObj;

        if (inAR) {
            if (this.arToolkitSource.ready === false) return;

            this.arToolkitContext.update(this.arToolkitSource.domElement);
            mainScene.visible = this.arCamera.visible;

            if (mainScene.visible) {
                // transfer camera settings and position from dedicated AR camera to the one being used to render the scene
                const pmArray = this.arCamera.projectionMatrix.elements,
                    //a = pmArray[10],
                    //b = pmArray[14],
                    //near = b / (a - 1),
                    //far = b / (a + 1),
                    tanHalfVFOV = 1 / pmArray[5],
                    vFOV = Math.atan(tanHalfVFOV)*2*180/Math.PI,
                    renderWidth = parseInt(this.renderer.domElement.style.width, 10),
                    renderHeight = parseInt(this.renderer.domElement.style.height, 10),
                    aspect = renderWidth / renderHeight;
                    //tanHalfHFOV = tanHalfVFOV * aspect,

                //mainCamera.near = near;
                //mainCamera.far = far;
                mainCamera.aspect = aspect;
                mainCamera.fov = vFOV;
                mainCamera.updateProjectionMatrix();

                const { pos, quat, stepSpec, rotation, translation, matW, posW, quatW, scaleW } = this.positioning;
                const camPos = this.arCamera.position, camQuat = this.arCamera.quaternion;
                if (window.nostable) { // @@ DEBUG HOOK
                    pos.copy(camPos);
                    quat.copy(camQuat);
                } else {
                    if (!this.stablePos) {
                        this.stablePos = new THREE.Vector3().copy(camPos);
                        this.stableQuat = new THREE.Quaternion().copy(camQuat);
                        // jump the current position to the camera
                        pos.copy(camPos);
                        quat.copy(camQuat);
                    } else {
                        const changed = this.checkWithinEpsilon({ pos: camPos, quat: camQuat }, { pos: this.stablePos, quat: this.stableQuat });
                        // if changed is non-null, it indicates that either pos or quat (or both)
                        // is out of range of the current stable value.  if there's a new, stable
                        // value for the one(s) that have changed, adopt the new pos/quat pair.
                        if (changed && this.checkStability(changed)) {
                            // set up posDelta to add to changing pos; angleDelta to edge towards new quat
                            const numSteps = window.steps || 4; // @@ DEBUG HOOK
                            stepSpec.posDelta.subVectors(camPos, pos).divideScalar(numSteps);
                            stepSpec.angleDelta = quat.angleTo(camQuat) / numSteps;
                            stepSpec.remainingSteps = numSteps;
                            // set up the camera's position as the new "stable" state, that we'll now be moving towards
                            this.stablePos.copy(camPos);
                            this.stableQuat.copy(camQuat);
                        }
                    }
                    this.addToHistory(camPos, camQuat);

                    if (stepSpec.remainingSteps) {
                        pos.add(stepSpec.posDelta);
                        quat.rotateTowards(this.stableQuat, stepSpec.angleDelta);
                        stepSpec.remainingSteps--;
                    }
                }

                matW.makeRotationFromQuaternion(quat);
                matW.setPosition(pos);
                matW.premultiply(rotation);
                matW.premultiply(translation);
                matW.decompose(posW, quatW, scaleW);

                const cameraSpatial = currentRoomView.cameraSpatial;
                cameraSpatial.moveTo(posW);
                cameraSpatial.rotateTo(quatW);
                mainCamera.updateMatrixWorld(true);
            }

            this.renderer.setClearColor(0xffffff, 0);
        }

        /** @type {PortalViewPart[]} */
        const portalViewParts = Object.values(currentRoomView.parts.elementViewManager.viewsForElements)
            .map(wrappingView => wrappingView.parts.inner)
            .filter(viewPart => viewPart instanceof PortalViewPart);

        const gl = this.renderer.context;

        // full clear (color, depth and stencil)
        this.renderer.clear(true, true, true);

        // enable stencil test
        gl.enable(gl.STENCIL_TEST);
        // disable stencil mask
        gl.stencilMask(0xFF);

        for (const portalViewPart of portalViewParts) {
            portalViewPart.enableLayersAsIndividual();
            mainCamera.layers.disable(RENDER_LAYERS.NORMAL);
            mainCamera.layers.enable(RENDER_LAYERS.INDIVIDUAL_PORTAL);

            // disable color + depth
            // only the stencil buffer will be drawn into
            gl.colorMask(false, false, false, false);
            gl.depthMask(false);

            // the stencil test will always fail (this is cheaper to compute)
            gl.stencilFunc(gl.NEVER, 1, 0xFF);
            // fragments where the portal is drawn will have a stencil value of 1
            // other fragments will retain a stencil value of 0
            gl.stencilOp(gl.REPLACE, gl.KEEP, gl.KEEP);

            // render the portal shape using the settings above
            this.renderer.render(mainScene, mainCamera);

            portalViewPart.disableLayersAsIndividual();
            mainCamera.layers.enable(RENDER_LAYERS.NORMAL);
            mainCamera.layers.disable(RENDER_LAYERS.INDIVIDUAL_PORTAL);

            // enable color + depth
            gl.colorMask(true, true, true, true);
            gl.depthMask(true);

            // fragments with a stencil value of 1 will be rendered
            gl.stencilFunc(gl.EQUAL, 1, 0xff);
            // stencil buffer is not changed
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

            const portalPart = portalViewPart.clonedPortal;
            const portalTargetRoomView = roomViewManager.requestPassive(portalPart.there, allRooms);

            if (portalTargetRoomView) {
                const portalTargetScene = portalTargetRoomView.parts.roomScene.threeObj;
                /** @type {THREE.Camera} */
                const portalTargetCamera = portalTargetRoomView.parts.camera.threeObj;

                const {targetPosition, targetQuaternion} = portalPart.projectThroughPortal(mainCamera.position, mainCamera.quaternion);
                portalTargetCamera.position.copy(targetPosition);
                portalTargetCamera.quaternion.copy(targetQuaternion);

                // render the view through the portal
                this.renderer.render(portalTargetScene, portalTargetCamera);
            }

            // clear the stencil buffer for the next portal
            this.renderer.clear(false, false, true);
        }

        // after all portals have been drawn, we can disable the stencil test
        gl.disable(gl.STENCIL_TEST);

        // clear the depth buffer to remove the portal views' depth from the current scene
        this.renderer.clear(false, true, false);

        // all the current scene portals will be drawn this time
        mainCamera.layers.disable(RENDER_LAYERS.NORMAL);
        mainCamera.layers.enable(RENDER_LAYERS.ALL_PORTALS);

        // disable color
        gl.colorMask(false, false, false, false);
        // draw the portal shapes into the depth buffer
        // this will make the portals appear as flat shapes
        this.renderer.render(mainScene, mainCamera);

        mainCamera.layers.enable(RENDER_LAYERS.NORMAL);
        mainCamera.layers.disable(RENDER_LAYERS.ALL_PORTALS);

        // enable color
        gl.colorMask(true, true, true, true);

        // finally, render the current scene
        this.renderer.render(mainScene, mainCamera);
    }
}
