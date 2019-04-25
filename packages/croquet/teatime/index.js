const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export { default as Model } from "./src/model";
export { default as View } from "./src/view";
export { default as Controller } from "./src/controller";
export { currentRealm } from "./src/realms";
