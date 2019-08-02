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
window.CroquetMath.pow = require("@stdlib/math/base/special/pow");
window.CroquetMath.sin = require("@stdlib/math/base/special/sin");
window.CroquetMath.sinh = require("@stdlib/math/base/special/sinh");
window.CroquetMath.tan = require("@stdlib/math/base/special/tan");
window.CroquetMath.tanh = require("@stdlib/math/base/special/tanh");

// if someone can figure out how to make this work properly with exports
// then please change the import in island.js to the proper
// import * as CroquetMath from "@croquet/math";
