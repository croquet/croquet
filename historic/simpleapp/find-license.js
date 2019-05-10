let fs = require('fs');
let path = require('path');

function walk(top, base) {
    let results = [];
    let pending = 0;

    let walker = (parent, file, resolve) => {
        let full = path.resolve(parent, file);
        if (file === ".git") {return;}
        pending++;
        fs.stat(full, (err, stats) => {
            if (err) {
                console.error("stat", err);
                throw err;
            }
            if (stats && stats.isDirectory()) {
                fs.readdir(full, (err, list) => {
                    if (err) {
                        console.error(err);
                        throw err;
                    }
                    list.forEach(f => walker(full, f, resolve));
                    pending--;
                    if (pending === 0) {
                        resolve(results);
                    }
                });
            } else {
                if (file === "package.json") {
                    let content = JSON.parse(fs.readFileSync(full, 'utf8'));
                    let index = parent.lastIndexOf("node_modules/");
                    let pack;
                    if (index >= 0) {
                        pack = parent.slice(index + "node_modules/".length);
                    } else {
                        pack = parent.slice(parent.lastIndexOf("simpleapp/"));
                        if (pack === 'p') {
                            pack = 'simpleapp';
                        }
                    }
                    results.push({"package": pack, "license": content.license});
                }
                pending--;
                if (pending === 0) {
                    resolve(results);
                }
            }
        });
    };

    return new Promise((resolve, reject) => {
        try {
            walker(top, base, resolve, reject);
        } catch (e) {
            reject(e);
        }
    });
}

walk(".", ".").then(result => {
    let table = {};
    result.forEach(r => {
        if (r.license === undefined) {
            r.license = "undefined";
        }
        if (!table[r.license]) {
            table[r.license] = [];
        }
        table[r.license].push(r.package);
    });
    let str = [];
    str.push("{\n");
    for (let k in table) {
        str.push('\t"', k, '": [\n');
        let notComma = true;
        table[k].forEach(n => {
            if (notComma) {
                notComma = false;
            } else {
                str.push(",\n");
            }
            str.push('\t\t"', n, '"');
        });
        str.push('],\n');
    }
    str.push("}\n");

    console.log(str.join(""));
});
