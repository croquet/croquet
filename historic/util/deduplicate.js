// work around https://github.com/parcel-bundler/parcel/issues/1838

deduplicateImports();

function deduplicateImports() {
    // find duplicates of modules by comparing source code
    const parcel = module.bundle;
    const names = {};
    const sources = {};
    const duplicates = {};
    for (const [dupe, m] of Object.entries(parcel.modules)) {
        const source = "" + parcel.modules[dupe][0];
        const id = sources[source];
        if (id) duplicates[dupe] = id;
        else sources[source] = dupe;
        for (const [n, d] of Object.entries(m[1])) (names[d] || (names[d] = new Set())).add(n);
    }
    const nameOf = k => names[k] ? `${[...names[k]].sort().join('" and "')}` : "top-level";
    // replace references to duplicates with the actual modules
    const later = {};
    const fixed = [];
    for (const [k, m] of Object.entries(parcel.modules)) {
        for (const [n, dupe] of Object.entries(m[1])) {
            const id = duplicates[dupe];
            if (id) {
                if (parcel.cache[dupe]) later[id] = dupe;      // dupe already loaded
                else {
                    m[1][n] = id;                              // use id
                    delete parcel.modules[dupe];               // delete dupe
                    fixed.push(`"${n}" in "${nameOf(k)}" (${k})`);
                }
            }
        }
    }
    for (const [k, m] of Object.entries(parcel.modules)) {
        for (const [n, id] of Object.entries(m[1])) {
            const dupe = later[id];
            if (dupe) {
                if (parcel.cache[id]) {
                    // both duplicate and original already loaded
                    console.warn(`Could not deduplicate import "${n}" in "${nameOf(k)}" (to fix, import "${nameOf(module.id)}" earlier)`);
                } else {
                    m[1][n] = dupe;                                 // use dupe
                    delete parcel.modules[id];                      // delete id
                    fixed.push(`"${n}" in "${nameOf(k)}" (${k})`);
                }
            }
        }
    }
    for (const fix of fixed.sort()) console.log("Deduplicated import", fix);
}
