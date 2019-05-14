const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


let id = Array.from(crypto.getRandomValues(new Uint8Array(3)))
    .map(e => e.toString(16).padStart(2, '0'))
    .join('');

export const userID = {id, color: id};
