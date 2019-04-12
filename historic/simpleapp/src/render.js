import * as THREE from "three";
import PortalViewPart from "./viewParts/portalView";

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
        const contextAttributes = {
            alpha: false,
            depth: true,
            stencil: true,
            antialias: true,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            powerPreference: "default"
        };

        const canvas = document.createElement('canvas');
        const context = canvas.getContext("webgl2", contextAttributes);
        this.renderer = new THREE.WebGLRenderer({canvas, context});
        this.renderer.autoClearStencil = false;
        this.renderer.autoClearDepth = false;
        this.renderer.autoClearColor = false;
        this.renderer.autoClear = false;
        this.renderer.localClippingEnabled = true;
        //this.renderer.setPixelRatio(window.devicePixelRatio);
        this.changeViewportSize(width, height);
        document.body.appendChild(this.renderer.domElement);
        if (this.renderer.context) {
            if (this.renderer.context.constructor === window.WebGLRenderingContext) {
                rendererVersion.renderingContextVersion = '1';
                rendererVersion.shaderLanguageVersion = '100';
            }
        }
    }

    changeViewportSize(width, height) {
        this.renderer.setSize(width, height);
    }

    render(room, allRooms, roomViewManager) {
        const currentRoomView = roomViewManager.expect(room);
        // Portal rendering technique inspired by https://github.com/zadvorsky/three.portals/blob/master/src/THREE.PortalController.js
        const mainScene = currentRoomView.parts.roomScene.threeObj;
        /** @type {THREE.Camera} */
        const mainCamera = currentRoomView.parts.camera.threeObj;

        /** @type {PortalViewPart[]} */
        const portalViewParts = Object.values(currentRoomView.parts.objectViewManager.viewsForObjects)
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
