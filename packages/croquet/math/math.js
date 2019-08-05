/* To rebuild math-dist.js:

    npm i
    mv node_modules/\@stdlib .
    mv \@stdlib/stdlib/lib/node_modules/\@stdlib node_modules/
    rm -r \@stdlib
    npx browserify -p tinyify math.js -o math-dist.js

*/

if (typeof window.CroquetMath === "undefined") window.CroquetMath = {};

window.CroquetMath.acos = require("@stdlib/math/base/special/acos");
window.CroquetMath.acosh = require("@stdlib/math/base/special/acosh");
window.CroquetMath.asin = require("@stdlib/math/base/special/asin");
window.CroquetMath.asinh = require("@stdlib/math/base/special/asinh");
window.CroquetMath.atan = require("@stdlib/math/base/special/atan");
window.CroquetMath.atanh = require("@stdlib/math/base/special/atanh");
window.CroquetMath.atan2 = require("@stdlib/math/base/special/atan2");
window.CroquetMath.cbrt = require("@stdlib/math/base/special/cbrt");
window.CroquetMath.cos = require("@stdlib/math/base/special/cos");
window.CroquetMath.cosh = require("@stdlib/math/base/special/cosh");
window.CroquetMath.exp = require("@stdlib/math/base/special/exp");
window.CroquetMath.expm1 = require("@stdlib/math/base/special/expm1");
window.CroquetMath.log = require("@stdlib/math/base/special/ln");      // ln because stdlib.log() has 2 args
window.CroquetMath.log1p = require("@stdlib/math/base/special/log1p");
window.CroquetMath.log10 = require("@stdlib/math/base/special/log10");
window.CroquetMath.log2 = require("@stdlib/math/base/special/log2");
window.CroquetMath.sin = require("@stdlib/math/base/special/sin");
window.CroquetMath.sinh = require("@stdlib/math/base/special/sinh");
window.CroquetMath.tan = require("@stdlib/math/base/special/tan");
window.CroquetMath.tanh = require("@stdlib/math/base/special/tanh");

// workaround for iOS Safari bug giving inconsistent results for stdlib's pow()
//window.CroquetMath.pow = require("@stdlib/math/base/special/pow");
const mathPow = Math.pow; // the "native" method
function isInfinite(x) { return x === Infinity || x === -Infinity; }
function isInteger(x) { return Number.isInteger(x); }
window.CroquetMath.pow = (x, y) => {
    if (isNaN(x) || isNaN(y)) return NaN;
    if (isInfinite(x) || isInfinite(y)) return mathPow(x, y);
    if (x === 0 || y === 0) return mathPow(x, y);
    if (x < 0 && !isInteger(y)) return NaN;

    // removed:   if (isInteger(x) && isInteger(y)) return mathPow(x, y);
    // ...because it turns out that even on integer cases, the base Math.pow can be inconsistent across browsers (e.g., 5,-4 giving 0.0016 or 0.0015999999999999999).
    // nonetheless, we handle integer powers 1 to 4 explicitly, so that at least these will avoid the rounding errors that tend to emerge when calculating via logs.
    if (y === 1) return x;
    if (y === 2) return x*x;
    if (y === 3) return x*x*x;
    if (y === 4) return x*x*x*x;

    // remaining cases:
    // x -ve, y integer other than those handled above
    // x +ve, y anything other than integers handled above
    let signResult = 1;
    if (x < 0) {
        x *= -1;
        signResult = mathPow(-1, y);
    }
    const absPow = window.CroquetMath.exp(window.CroquetMath.log(x) * y);
    return absPow * signResult;
    };

// if someone can figure out how to make this work properly with exports
// then please change the import in island.js to the proper
// import * as CroquetMath from "@croquet/math";
