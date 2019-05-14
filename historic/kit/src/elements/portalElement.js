import PortalPart from "../modelParts/portal";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

// PortalPart can directly be used as an Element, since it has a SpatialPart
export default PortalPart;
