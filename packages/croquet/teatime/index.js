import { displaySessionMoniker, displayQRCode } from "@croquet/util/html";

import Model from "./src/model";
import View from "./src/view";
import Controller from "./src/controller";

export { Model, View, Controller };
export { currentRealm } from "./src/realms";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


export async function startSession(name, ModelRoot=Model, ViewRoot=View, options={}) {

    const controller = new Controller();
    await bootModelView();
    return controller;

    async function bootModelView(snapshot) {
        clear();
        const modelRoot = (await controller.establishSession(name, {snapshot, init: spawnModel, destroyerFn: bootModelView, ...options})).model;
        displaySessionMoniker(controller.id);
        displayQRCode();
        controller.inViewRealm(() => {
            controller.view = new ViewRoot(modelRoot);
        });
    }

    function clear() {
        if (controller.view) {
            controller.view.detach();
            controller.view = null;
        }
        displaySessionMoniker('');
    }

    function spawnModel(opts) {
        const modelRoot = ModelRoot.create(opts);
        return { model: modelRoot };
    }
}
