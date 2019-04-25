import * as THREE from "three";
import { urlOptions } from "@croquet/util";
import PortalViewPart from "./viewParts/portalView";

/* eslint-disable global-require */
const THREEx_imports = urlOptions.ar && require("../thirdparty-patched/ARjs/ar");
const cameraData = urlOptions.ar && require("../thirdparty-patched/ARjs/data/camera_para.dat");
const croquetPatternData = urlOptions.ar && require("../thirdparty-patched/ARjs/data/croquet.patt");
//const hiroPatternData = urlOptions.ar && require("../thirdparty-patched/ARjs/data/patt.hiro");
/* eslint-enable global-require */

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
            });
        // init controls for camera
        this.mvmHolder = new THREE.Object3D();
        this.markerControls = new THREEx.ArMarkerControls(this.arToolkitContext, this.mvmHolder, {
            type: 'pattern',
            patternUrl: croquetPatternData, //hiroPatternData,
            changeMatrixMode: 'modelViewMatrix'
            });

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
            mainScene.visible = this.mvmHolder.visible;

            if (mainScene.visible) {
                // copy fov and aspect ratio of the AR camera
                const pmArray = this.arToolkitContext.getProjectionMatrix().elements,
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

                mainCamera.aspect = aspect;
                mainCamera.fov = vFOV;
                mainCamera.updateProjectionMatrix();

                // the mvmHolder will have had its matrix set to the model-view
                // matrix reported by the marker detector
                const mvm = this.mvmHolder.matrix;
                function smoother(fixedProp) {
                    let smoothed = null;
                    const history = [];
                    const maxHistory = 7;
                    const samplePoint = (maxHistory-1)/2; // middle value
                    let total = 0;
                    return (newVal, prop) => {
                        const propNow = fixedProp || prop;
                        history.push(newVal);
                        total += newVal;
                        if (smoothed === null) smoothed = newVal;
                        else {
                            if (history.length > maxHistory) {
                                total -= history.shift();
                                if (!window.noavg) newVal = total/history.length;
                                else {
                                    // don't use the average - unless the candidate is completely out of whack with all other values, in which case use the average of those others
                                    const cand = history[samplePoint];
                                    const avg = (total-cand) / (maxHistory-1); // average of all others
                                    if (avg!==0 && Math.abs((cand-avg)/avg) > (window.thresh || 10)) { // @@ DEBUG HOOK
                                        //console.log("!", cand/avg);
                                        newVal = history[samplePoint] = avg; // replace it
                                        total += avg - cand;
                                    } else newVal = cand;
                                }
                            }
                            smoothed = propNow * newVal + (1-propNow) * smoothed;
                        }
                        return smoothed;
                        };
                }
                function vecSmoother(normalize) {
                    const x = smoother(), y = smoother(), z = smoother();
                    return (newVec, prop) => {
                        //if (newVec.length() > 1000) debugger;
                        newVec.set(x(newVec.x, prop), y(newVec.y, prop), z(newVec.z, prop));
                        if (normalize) newVec.normalize();
                        return newVec;
                        };
                }
                if (!this.smoothnessSmoother) this.smoothnessSmoother = smoother(0.2);
                if (!this.eyeSmoother) this.eyeSmoother = vecSmoother();
                if (!this.sightSmoother) this.sightSmoother = vecSmoother(true);
                if (!this.upSmoother) this.upSmoother = vecSmoother(true);

                const mat3 = new THREE.Matrix3().setFromMatrix4(mvm);
                mat3.transpose();
                const rawSight = new THREE.Vector3(0, 0, 1).applyMatrix3(mat3);
                const thresholdAngle = (window.ang || 10) * Math.PI / 180;
                const thresholdDivergence = Math.sin(thresholdAngle);
                const maxRelevantDivergence = Math.sin(Math.PI / 6);
                const effectiveDivergence = Math.min(Math.abs(rawSight.x), Math.abs(rawSight.z));
                // smoothing ratio is smallest close to an axis, rising to max at 30 degrees
                const proportion = Math.max(0, Math.min(1, (effectiveDivergence - thresholdDivergence) / (maxRelevantDivergence - thresholdDivergence))); // 0 to 1
                const minSmooth = 0.1, maxSmooth = 0.5; // low minSmooth means a gradual blending in of each new value
                const rawSmooth = minSmooth + proportion * (maxSmooth - minSmooth);
                const smooth = this.smoothnessSmoother(rawSmooth); // we don't want the smoothness to be jumpy
                const sight = this.sightSmoother(rawSight, smooth);
                const up = this.upSmoother(new THREE.Vector3(0, 1, 0).applyMatrix3(mat3), smooth);
                const { pos, quat, stepSpec, rotation, translation, matW, posW, quatW, scaleW } = this.positioning;
                matW.getInverse(mvm);
                const eye = this.eyeSmoother(new THREE.Vector3().setFromMatrixPosition(matW), smooth);
                matW.lookAt(eye, new THREE.Vector3().subVectors(eye, sight), up);
                matW.setPosition(eye);

                const dbg = false; // Math.random()<0.02;
                const rnd = v => v.toArray().map(val => val.toFixed(3));
                if (dbg) console.log(rnd(eye), rnd(sight), rnd(up), { rawSmooth: rawSmooth.toFixed(3), smooth: smooth.toFixed(3)}); // rnd(eye), rnd(sight), rnd(up));

                let red = smooth, green = 0.1, blue = 0.1;
                window.boxColor = new THREE.Color(red, green, blue);

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

        let closeToAnyPortal = false;

        for (const portalViewPart of portalViewParts) {

            const portalPart = portalViewPart.clonedPortal;
            const cameraFromPortal = portalPart.worldToLocal(mainCamera.position);
            const closeToThisPortal = cameraFromPortal.length() < 1.0 && cameraFromPortal.z < 0.1;

            if (closeToThisPortal) {
                // we are very close to or inside the portal, ignore stenciling and
                // show the whole other room to work around model/view delay caused flicker
                closeToAnyPortal = true;
                gl.stencilFunc(gl.ALWAYS, 0, 1);
                gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
            } else {
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
            }

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

            if (closeToThisPortal) break;
        }

        // after all portals have been drawn, we can disable the stencil test
        gl.disable(gl.STENCIL_TEST);

        if (!closeToAnyPortal) {
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
}
