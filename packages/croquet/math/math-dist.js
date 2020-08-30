/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function isnan( x ) {
	return ( x !== x );
}
var main = isnan;

var lib = main;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var sqrt = Math.sqrt;
var main$1 = sqrt;

var lib$1 = main$1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var FOURTH_PI = 7.85398163397448309616e-1;
var lib$2 = FOURTH_PI;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalrational( x ) {
	var ax;
	var s1;
	var s2;
	if ( x === 0.0 ) {
		return 0.16666666666666713;
	}
	if ( x < 0.0 ) {
		ax = -x;
	} else {
		ax = x;
	}
	if ( ax <= 1.0 ) {
		s1 = -8.198089802484825 + (x * (19.562619833175948 + (x * (-16.262479672107002 + (x * (5.444622390564711 + (x * (-0.6019598008014124 + (x * 0.004253011369004428)))))))));
		s2 = -49.18853881490881 + (x * (139.51056146574857 + (x * (-147.1791292232726 + (x * (70.49610280856842 + (x * (-14.740913729888538 + (x * 1.0)))))))));
	} else {
		x = 1.0 / x;
		s1 = 0.004253011369004428 + (x * (-0.6019598008014124 + (x * (5.444622390564711 + (x * (-16.262479672107002 + (x * (19.562619833175948 + (x * -8.198089802484825)))))))));
		s2 = 1.0 + (x * (-14.740913729888538 + (x * (70.49610280856842 + (x * (-147.1791292232726 + (x * (139.51056146574857 + (x * -49.18853881490881)))))))));
	}
	return s1 / s2;
}
var rational_pq = evalrational;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalrational$1( x ) {
	var ax;
	var s1;
	var s2;
	if ( x === 0.0 ) {
		return 0.08333333333333809;
	}
	if ( x < 0.0 ) {
		ax = -x;
	} else {
		ax = x;
	}
	if ( ax <= 1.0 ) {
		s1 = 28.536655482610616 + (x * (-25.56901049652825 + (x * (6.968710824104713 + (x * (-0.5634242780008963 + (x * 0.002967721961301243)))))));
		s2 = 342.43986579130785 + (x * (-383.8770957603691 + (x * (147.0656354026815 + (x * (-21.947795316429207 + (x * 1.0)))))));
	} else {
		x = 1.0 / x;
		s1 = 0.002967721961301243 + (x * (-0.5634242780008963 + (x * (6.968710824104713 + (x * (-25.56901049652825 + (x * 28.536655482610616)))))));
		s2 = 1.0 + (x * (-21.947795316429207 + (x * (147.0656354026815 + (x * (-383.8770957603691 + (x * 342.43986579130785)))))));
	}
	return s1 / s2;
}
var rational_rs = evalrational$1;

var MOREBITS = 6.123233995736765886130e-17;
function asin( x ) {
	var sgn;
	var zz;
	var a;
	var p;
	var z;
	if ( lib( x ) ) {
		return NaN;
	}
	if ( x > 0.0 ) {
		a = x;
	} else {
		sgn = true;
		a = -x;
	}
	if ( a > 1.0 ) {
		return NaN;
	}
	if ( a > 0.625 ) {
		zz = 1.0 - a;
		p = zz * rational_rs( zz );
		zz = lib$1( zz + zz );
		z = lib$2 - zz;
		zz = ( zz*p ) - MOREBITS;
		z -= zz;
		z += lib$2;
	} else {
		if ( a < 1.0e-8 ) {
			return x;
		}
		zz = a * a;
		z = zz * rational_pq( zz );
		z = ( a*z ) + a;
	}
	return ( sgn ) ? -z : z;
}
var asin_1 = asin;

var lib$3 = asin_1;

var MOREBITS$1 = 6.123233995736765886130e-17;
function acos( x ) {
	var z;
	if ( lib( x ) ) {
		return NaN;
	}
	if ( x < -1.0 || x > 1.0 ) {
		return NaN;
	}
	if ( x > 0.5 ) {
		return 2.0 * lib$3( lib$1( 0.5 - (0.5*x) ) );
	}
	z = lib$2 - lib$3( x );
	z += MOREBITS$1;
	z += lib$2;
	return z;
}
var acos_1 = acos;

var lib$4 = acos_1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function hasSymbolSupport() {
	return (
		typeof Symbol === 'function' &&
		typeof Symbol( 'foo' ) === 'symbol'
	);
}
var main$2 = hasSymbolSupport;

var lib$5 = main$2;

var FLG = lib$5();
function hasToStringTagSupport() {
	return ( FLG && typeof Symbol.toStringTag === 'symbol' );
}
var main$3 = hasToStringTagSupport;

var lib$6 = main$3;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var toStr = Object.prototype.toString;
var tostring = toStr;

function nativeClass( v ) {
	return tostring.call( v );
}
var native_class = nativeClass;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var has = Object.prototype.hasOwnProperty;
function hasOwnProp( value, property ) {
	if (
		value === void 0 ||
		value === null
	) {
		return false;
	}
	return has.call( value, property );
}
var main$4 = hasOwnProp;

var lib$7 = main$4;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var toStrTag = ( typeof Symbol === 'function' ) ? Symbol.toStringTag : '';
var tostringtag = toStrTag;

function nativeClass$1( v ) {
	var isOwn;
	var tag;
	var out;
	if ( v === null || v === void 0 ) {
		return tostring.call( v );
	}
	tag = v[ tostringtag ];
	isOwn = lib$7( v, tostringtag );
	try {
		v[ tostringtag ] = void 0;
	} catch ( err ) {
		return tostring.call( v );
	}
	out = tostring.call( v );
	if ( isOwn ) {
		v[ tostringtag ] = tag;
	} else {
		delete v[ tostringtag ];
	}
	return out;
}
var polyfill = nativeClass$1;

var nativeClass$2;
if ( lib$6() ) {
	nativeClass$2 = polyfill;
} else {
	nativeClass$2 = native_class;
}
var lib$8 = nativeClass$2;

var hasUint32Array = ( typeof Uint32Array === 'function' );
function isUint32Array( value ) {
	return (
		( hasUint32Array && value instanceof Uint32Array ) ||
		lib$8( value ) === '[object Uint32Array]'
	);
}
var main$5 = isUint32Array;

var lib$9 = main$5;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var UINT32_MAX = 4294967295;
var lib$a = UINT32_MAX;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var main$6 = ( typeof Uint32Array === 'function' ) ? Uint32Array : null;
var uint32array = main$6;

function hasUint32ArraySupport() {
	var bool;
	var arr;
	if ( typeof uint32array !== 'function' ) {
		return false;
	}
	try {
		arr = [ 1, 3.14, -3.14, lib$a+1, lib$a+2 ];
		arr = new uint32array( arr );
		bool = (
			lib$9( arr ) &&
			arr[ 0 ] === 1 &&
			arr[ 1 ] === 3 &&
			arr[ 2 ] === lib$a-2 &&
			arr[ 3 ] === 0 &&
			arr[ 4 ] === 1
		);
	} catch ( err ) {
		bool = false;
	}
	return bool;
}
var main$7 = hasUint32ArraySupport;

var lib$b = main$7;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var ctor = ( typeof Uint32Array === 'function' ) ? Uint32Array : null;
var uint32array$1 = ctor;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function polyfill$1() {
	throw new Error( 'not implemented' );
}
var polyfill_1 = polyfill$1;

var ctor$1;
if ( lib$b() ) {
	ctor$1 = uint32array$1;
} else {
	ctor$1 = polyfill_1;
}
var lib$c = ctor$1;

var hasFloat64Array = ( typeof Float64Array === 'function' );
function isFloat64Array( value ) {
	return (
		( hasFloat64Array && value instanceof Float64Array ) ||
		lib$8( value ) === '[object Float64Array]'
	);
}
var main$8 = isFloat64Array;

var lib$d = main$8;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var main$9 = ( typeof Float64Array === 'function' ) ? Float64Array : null;
var float64array = main$9;

function hasFloat64ArraySupport() {
	var bool;
	var arr;
	if ( typeof float64array !== 'function' ) {
		return false;
	}
	try {
		arr = new float64array( [ 1.0, 3.14, -3.14, NaN ] );
		bool = (
			lib$d( arr ) &&
			arr[ 0 ] === 1.0 &&
			arr[ 1 ] === 3.14 &&
			arr[ 2 ] === -3.14 &&
			arr[ 3 ] !== arr[ 3 ]
		);
	} catch ( err ) {
		bool = false;
	}
	return bool;
}
var main$a = hasFloat64ArraySupport;

var lib$e = main$a;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var ctor$2 = ( typeof Float64Array === 'function' ) ? Float64Array : null;
var float64array$1 = ctor$2;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function polyfill$2() {
	throw new Error( 'not implemented' );
}
var polyfill_1$1 = polyfill$2;

var ctor$3;
if ( lib$e() ) {
	ctor$3 = float64array$1;
} else {
	ctor$3 = polyfill_1$1;
}
var lib$f = ctor$3;

var hasUint8Array = ( typeof Uint8Array === 'function' );
function isUint8Array( value ) {
	return (
		( hasUint8Array && value instanceof Uint8Array ) ||
		lib$8( value ) === '[object Uint8Array]'
	);
}
var main$b = isUint8Array;

var lib$g = main$b;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var UINT8_MAX = 255|0;
var lib$h = UINT8_MAX;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var main$c = ( typeof Uint8Array === 'function' ) ? Uint8Array : null;
var uint8array = main$c;

function hasUint8ArraySupport() {
	var bool;
	var arr;
	if ( typeof uint8array !== 'function' ) {
		return false;
	}
	try {
		arr = [ 1, 3.14, -3.14, lib$h+1, lib$h+2 ];
		arr = new uint8array( arr );
		bool = (
			lib$g( arr ) &&
			arr[ 0 ] === 1 &&
			arr[ 1 ] === 3 &&
			arr[ 2 ] === lib$h-2 &&
			arr[ 3 ] === 0 &&
			arr[ 4 ] === 1
		);
	} catch ( err ) {
		bool = false;
	}
	return bool;
}
var main$d = hasUint8ArraySupport;

var lib$i = main$d;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var ctor$4 = ( typeof Uint8Array === 'function' ) ? Uint8Array : null;
var uint8array$1 = ctor$4;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function polyfill$3() {
	throw new Error( 'not implemented' );
}
var polyfill_1$2 = polyfill$3;

var ctor$5;
if ( lib$i() ) {
	ctor$5 = uint8array$1;
} else {
	ctor$5 = polyfill_1$2;
}
var lib$j = ctor$5;

var hasUint16Array = ( typeof Uint16Array === 'function' );
function isUint16Array( value ) {
	return (
		( hasUint16Array && value instanceof Uint16Array ) ||
		lib$8( value ) === '[object Uint16Array]'
	);
}
var main$e = isUint16Array;

var lib$k = main$e;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var UINT16_MAX = 65535|0;
var lib$l = UINT16_MAX;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var main$f = ( typeof Uint16Array === 'function' ) ? Uint16Array : null;
var uint16array = main$f;

function hasUint16ArraySupport() {
	var bool;
	var arr;
	if ( typeof uint16array !== 'function' ) {
		return false;
	}
	try {
		arr = [ 1, 3.14, -3.14, lib$l+1, lib$l+2 ];
		arr = new uint16array( arr );
		bool = (
			lib$k( arr ) &&
			arr[ 0 ] === 1 &&
			arr[ 1 ] === 3 &&
			arr[ 2 ] === lib$l-2 &&
			arr[ 3 ] === 0 &&
			arr[ 4 ] === 1
		);
	} catch ( err ) {
		bool = false;
	}
	return bool;
}
var main$g = hasUint16ArraySupport;

var lib$m = main$g;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var ctor$6 = ( typeof Uint16Array === 'function' ) ? Uint16Array : null;
var uint16array$1 = ctor$6;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function polyfill$4() {
	throw new Error( 'not implemented' );
}
var polyfill_1$3 = polyfill$4;

var ctor$7;
if ( lib$m() ) {
	ctor$7 = uint16array$1;
} else {
	ctor$7 = polyfill_1$3;
}
var lib$n = ctor$7;

var ctors = {
	'uint16': lib$n,
	'uint8': lib$j
};
var ctors_1 = ctors;

var bool;
function isLittleEndian() {
	var uint16view;
	var uint8view;
	uint16view = new ctors_1[ 'uint16' ]( 1 );
	uint16view[ 0 ] = 0x1234;
	uint8view = new ctors_1[ 'uint8' ]( uint16view.buffer );
	return ( uint8view[ 0 ] === 0x34 );
}
bool = isLittleEndian();
var main$h = bool;

var lib$o = main$h;

var HIGH;
if ( lib$o === true ) {
	HIGH = 1;
} else {
	HIGH = 0;
}
var high = HIGH;

var FLOAT64_VIEW = new lib$f( 1 );
var UINT32_VIEW = new lib$c( FLOAT64_VIEW.buffer );
function getHighWord( x ) {
	FLOAT64_VIEW[ 0 ] = x;
	return UINT32_VIEW[ high ];
}
var main$i = getHighWord;

var lib$p = main$i;

var HIGH$1;
if ( lib$o === true ) {
	HIGH$1 = 1;
} else {
	HIGH$1 = 0;
}
var high$1 = HIGH$1;

var FLOAT64_VIEW$1 = new lib$f( 1 );
var UINT32_VIEW$1 = new lib$c( FLOAT64_VIEW$1.buffer );
function setHighWord( x, high ) {
	FLOAT64_VIEW$1[ 0 ] = x;
	UINT32_VIEW$1[ high$1 ] = ( high >>> 0 );
	return FLOAT64_VIEW$1[ 0 ];
}
var main$j = setHighWord;

var lib$q = main$j;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var FLOAT64_PINF = Number.POSITIVE_INFINITY;
var lib$r = FLOAT64_PINF;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var number = Number;

var lib$s = number;

var FLOAT64_NINF = lib$s.NEGATIVE_INFINITY;
var lib$t = FLOAT64_NINF;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var FLOAT64_EXPONENT_BIAS = 1023|0;
var lib$u = FLOAT64_EXPONENT_BIAS;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly( x ) {
	if ( x === 0.0 ) {
		return 0.6666666666666735;
	}
	return 0.6666666666666735 + (x * (0.3999999999940942 + (x * (0.2857142874366239 + (x * (0.22222198432149784 + (x * (0.1818357216161805 + (x * (0.15313837699209373 + (x * 0.14798198605116586)))))))))));
}
var polyval_lp = evalpoly;

var LN2_HI = 6.93147180369123816490e-01;
var LN2_LO = 1.90821492927058770002e-10;
var SQRT2M1 = 4.142135623730950488017e-01;
var SQRT2HALFM1 = -2.928932188134524755992e-01;
var SMALL = 1.862645149230957e-09;
var TINY = 5.551115123125783e-17;
var TWO53 = 9007199254740992;
var TWO_THIRDS = 6.666666666666666666e-01;
function log1p( x ) {
	var hfsq;
	var hu;
	var y;
	var f;
	var c;
	var s;
	var z;
	var R;
	var u;
	var k;
	if ( x < -1.0 || lib( x ) ) {
		return NaN;
	}
	if ( x === -1.0 ) {
		return lib$t;
	}
	if ( x === lib$r ) {
		return x;
	}
	if ( x === 0.0 ) {
		return x;
	}
	if ( x < 0.0 ) {
		y = -x;
	} else {
		y = x;
	}
	k = 1;
	if ( y < SQRT2M1 ) {
		if ( y < SMALL ) {
			if ( y < TINY ) {
				return x;
			}
			return x - ( x*x*0.5 );
		}
		if ( x > SQRT2HALFM1 ) {
			k = 0;
			f = x;
			hu = 1;
		}
	}
	if ( k !== 0 ) {
		if ( y < TWO53 ) {
			u = 1.0 + x;
			hu = lib$p( u );
			k = (hu>>20) - lib$u;
			if ( k > 0 ) {
				c = 1.0 - (u-x);
			} else {
				c = x - (u-1.0);
			}
			c /= u;
		} else {
			u = x;
			hu = lib$p( u );
			k = (hu>>20) - lib$u;
			c = 0;
		}
		hu &= 0x000fffff;
		if ( hu < 434334 ) {
			u = lib$q( u, hu|0x3ff00000 );
		} else {
			k += 1;
			u = lib$q( u, hu|0x3fe00000 );
			hu = (1048576-hu)>>2;
		}
		f = u - 1.0;
	}
	hfsq = 0.5 * f * f;
	if ( hu === 0 ) {
		if ( f === 0.0 ) {
			c += k * LN2_LO;
			return ( k * LN2_HI ) + c;
		}
		R = hfsq * (1.0 - ( TWO_THIRDS*f ) );
		return ( k*LN2_HI ) - ( (R - ( (k*LN2_LO) + c)) - f );
	}
	s = f / (2.0 + f);
	z = s * s;
	R = z * polyval_lp( z );
	if ( k === 0 ) {
		return f - ( hfsq - ( s*(hfsq+R) ) );
	}
	return ( k*LN2_HI ) - ( (hfsq - ( (s*(hfsq+R)) + ((k*LN2_LO) + c))) - f );
}
var log1p_1 = log1p;

var lib$v = log1p_1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var LN2 = 6.93147180559945309417232121458176568075500134360255254120680009493393621969694715605863326996418687542001481021e-01;
var lib$w = LN2;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$1( x ) {
	if ( x === 0.0 ) {
		return 0.3999999999940942;
	}
	return 0.3999999999940942 + (x * (0.22222198432149784 + (x * 0.15313837699209373)));
}
var polyval_p = evalpoly$1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$2( x ) {
	if ( x === 0.0 ) {
		return 0.6666666666666735;
	}
	return 0.6666666666666735 + (x * (0.2857142874366239 + (x * (0.1818357216161805 + (x * 0.14798198605116586)))));
}
var polyval_q = evalpoly$2;

var LN2_HI$1 = 6.93147180369123816490e-01;
var LN2_LO$1 = 1.90821492927058770002e-10;
var TWO54 = 1.80143985094819840000e+16;
var ONE_THIRD = 0.33333333333333333;
var HIGH_SIGNIFICAND_MASK = 0x000fffff|0;
var HIGH_MAX_NORMAL_EXP = 0x7ff00000|0;
var HIGH_MIN_NORMAL_EXP = 0x00100000|0;
var HIGH_BIASED_EXP_0 = 0x3ff00000|0;
function ln( x ) {
	var hfsq;
	var hx;
	var t2;
	var t1;
	var k;
	var R;
	var f;
	var i;
	var j;
	var s;
	var w;
	var z;
	if ( x === 0.0 ) {
		return lib$t;
	}
	if ( lib( x ) || x < 0.0 ) {
		return NaN;
	}
	hx = lib$p( x );
	k = 0|0;
	if ( hx < HIGH_MIN_NORMAL_EXP ) {
		k -= 54|0;
		x *= TWO54;
		hx = lib$p( x );
	}
	if ( hx >= HIGH_MAX_NORMAL_EXP ) {
		return x + x;
	}
	k += ( ( hx>>20 ) - lib$u )|0;
	hx &= HIGH_SIGNIFICAND_MASK;
	i = ( (hx+0x95f64) & 0x100000 )|0;
	x = lib$q( x, hx|(i^HIGH_BIASED_EXP_0) );
	k += ( i>>20 )|0;
	f = x - 1.0;
	if ( (HIGH_SIGNIFICAND_MASK&(2+hx)) < 3 ) {
		if ( f === 0.0 ) {
			if ( k === 0 ) {
				return 0.0;
			}
			return (k * LN2_HI$1) + (k * LN2_LO$1);
		}
		R = f * f * ( 0.5 - (ONE_THIRD*f) );
		if ( k === 0 ) {
			return f - R;
		}
		return (k * LN2_HI$1) - ( (R-(k*LN2_LO$1)) - f );
	}
	s = f / (2.0 + f);
	z = s * s;
	i = ( hx - 0x6147a )|0;
	w = z * z;
	j = ( 0x6b851 - hx )|0;
	t1 = w * polyval_p( w );
	t2 = z * polyval_q( w );
	i |= j;
	R = t2 + t1;
	if ( i > 0 ) {
		hfsq = 0.5 * f * f;
		if ( k === 0 ) {
			return f - ( hfsq - (s * (hfsq+R)) );
		}
		return (k * LN2_HI$1) - ( hfsq - ((s*(hfsq+R))+(k*LN2_LO$1)) - f );
	}
	if ( k === 0 ) {
		return f - (s*(f-R));
	}
	return (k * LN2_HI$1) - ( ( (s*(f-R)) - (k*LN2_LO$1) ) - f );
}
var ln_1 = ln;

var lib$x = ln_1;

var HUGE = 1 << 28;
function acosh( x ) {
	var t;
	if ( lib( x ) ) {
		return NaN;
	}
	if ( x < 1.0 ) {
		return NaN;
	}
	if ( x === 1.0 ) {
		return 0.0;
	}
	if ( x >= HUGE ) {
		return lib$x( x ) + lib$w;
	}
	if ( x > 2.0 ) {
		return lib$x( (2.0*x) - ( 1.0 / ( x + lib$1( (x*x) - 1.0 ) ) ) );
	}
	t = x - 1.0;
	return lib$v( t + lib$1( (2.0*t) + (t*t) ) );
}
var acosh_1 = acosh;

var lib$y = acosh_1;

function isInfinite( x ) {
	return (x === lib$r || x === lib$t);
}
var is_infinite = isInfinite;

var lib$z = is_infinite;

var NEAR_ZERO = 1.0 / (1 << 28);
var HUGE$1 = 1 << 28;
function asinh( x ) {
	var sgn;
	var xx;
	var t;
	if ( lib( x ) || lib$z( x ) ) {
		return x;
	}
	if ( x < 0.0 ) {
		x = -x;
		sgn = true;
	}
	if ( x < NEAR_ZERO ) {
		t = x;
	}
	else if ( x > HUGE$1 ) {
		t = lib$x( x ) + lib$w;
	}
	else if ( x > 2.0 ) {
		t = lib$x( (2.0*x) + ( 1.0 / (lib$1( (x*x) + 1.0 ) + x) ) );
	}
	else {
		xx = x * x;
		t = lib$v( x + ( xx/(1.0 + lib$1(1.0 + xx)) ) );
	}
	return ( sgn ) ? -t : t;
}
var asinh_1 = asinh;

var lib$A = asinh_1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var HALF_PI = 1.5707963267948966;
var lib$B = HALF_PI;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$3( x ) {
	if ( x === 0.0 ) {
		return -64.85021904942025;
	}
	return -64.85021904942025 + (x * (-122.88666844901361 + (x * (-75.00855792314705 + (x * (-16.157537187333652 + (x * -0.8750608600031904)))))));
}
var polyval_p$1 = evalpoly$3;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$4( x ) {
	if ( x === 0.0 ) {
		return 194.5506571482614;
	}
	return 194.5506571482614 + (x * (485.3903996359137 + (x * (432.88106049129027 + (x * (165.02700983169885 + (x * (24.858464901423062 + (x * 1.0)))))))));
}
var polyval_q$1 = evalpoly$4;

var MOREBITS$2 = 6.123233995736765886130e-17;
var T3P8 = 2.41421356237309504880;
function atan( x ) {
	var flg;
	var sgn;
	var y;
	var z;
	if ( lib( x ) || x === 0.0 ) {
		return x;
	}
	if ( x === lib$r ) {
		return lib$B;
	}
	if ( x === lib$t ) {
		return -lib$B;
	}
	if ( x < 0.0 ) {
		sgn = true;
		x = -x;
	}
	flg = 0;
	if ( x > T3P8 ) {
		y = lib$B;
		flg = 1;
		x = -( 1.0/x );
	}
	else if ( x <= 0.66 ) {
		y = 0.0;
	}
	else {
		y = lib$2;
		flg = 2;
		x = (x-1.0) / (x+1.0);
	}
	z = x * x;
	z = z*polyval_p$1( z ) / polyval_q$1( z );
	z = ( x*z ) + x;
	if ( flg === 2 ) {
		z += 0.5 * MOREBITS$2;
	}
	else if ( flg === 1 ) {
		z += MOREBITS$2;
	}
	y += z;
	return ( sgn ) ? -y : y;
}
var atan_1 = atan;

var lib$C = atan_1;

var NEAR_ZERO$1 = 1.0 / (1 << 28);
function atanh( x ) {
	var sgn;
	var t;
	if ( lib( x ) ) {
		return NaN;
	}
	if ( x < -1.0 || x > 1.0 ) {
		return NaN;
	}
	if ( x === 1.0 ) {
		return lib$r;
	}
	if ( x === -1.0 ) {
		return lib$t;
	}
	if ( x < 0.0 ) {
		sgn = true;
		x = -x;
	}
	if ( x < NEAR_ZERO$1 ) {
		return ( sgn ) ? -x : x;
	}
	if ( x < 0.5 ) {
		t = x + x;
		t = 0.5 * lib$v( t + ( t*x/(1-x) ) );
	} else {
		t = 0.5 * lib$v( (x+x) / (1-x) );
	}
	return ( sgn ) ? -t : t;
}
var atanh_1 = atanh;

var lib$D = atanh_1;

var indices;
var HIGH$2;
var LOW;
if ( lib$o === true ) {
	HIGH$2 = 1;
	LOW = 0;
} else {
	HIGH$2 = 0;
	LOW = 1;
}
indices = {
	'HIGH': HIGH$2,
	'LOW': LOW
};
var indices_1 = indices;

var FLOAT64_VIEW$2 = new lib$f( 1 );
var UINT32_VIEW$2 = new lib$c( FLOAT64_VIEW$2.buffer );
var HIGH$3 = indices_1.HIGH;
var LOW$1 = indices_1.LOW;
function toWords( out, x ) {
	FLOAT64_VIEW$2[ 0 ] = x;
	out[ 0 ] = UINT32_VIEW$2[ HIGH$3 ];
	out[ 1 ] = UINT32_VIEW$2[ LOW$1 ];
	return out;
}
var to_words = toWords;

function toWords$1( out, x ) {
	if ( arguments.length === 1 ) {
		return to_words( [ 0, 0 ], out );
	}
	return to_words( out, x );
}
var main$k = toWords$1;

var lib$E = main$k;

var indices$1;
var HIGH$4;
var LOW$2;
if ( lib$o === true ) {
	HIGH$4 = 1;
	LOW$2 = 0;
} else {
	HIGH$4 = 0;
	LOW$2 = 1;
}
indices$1 = {
	'HIGH': HIGH$4,
	'LOW': LOW$2
};
var indices_1$1 = indices$1;

var FLOAT64_VIEW$3 = new lib$f( 1 );
var UINT32_VIEW$3 = new lib$c( FLOAT64_VIEW$3.buffer );
var HIGH$5 = indices_1$1.HIGH;
var LOW$3 = indices_1$1.LOW;
function fromWords( high, low ) {
	UINT32_VIEW$3[ HIGH$5 ] = high;
	UINT32_VIEW$3[ LOW$3 ] = low;
	return FLOAT64_VIEW$3[ 0 ];
}
var main$l = fromWords;

var lib$F = main$l;

var SIGN_MASK = 0x80000000>>>0;
var MAGNITUDE_MASK = 0x7fffffff|0;
var WORDS = [ 0, 0 ];
function copysign( x, y ) {
	var hx;
	var hy;
	lib$E( WORDS, x );
	hx = WORDS[ 0 ];
	hx &= MAGNITUDE_MASK;
	hy = lib$p( y );
	hy &= SIGN_MASK;
	hx |= hy;
	return lib$F( hx, WORDS[ 1 ] );
}
var copysign_1 = copysign;

var lib$G = copysign_1;

function signbit( x ) {
	var high = lib$p( x );
	return ( high >>> 31 ) ? true : false;
}
var main$m = signbit;

var lib$H = main$m;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var PI = 3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679;
var lib$I = PI;

function atan2( y, x ) {
	var q;
	if ( lib( x ) || lib( y ) ) {
		return NaN;
	}
	if ( lib$z( x ) ) {
		if ( x === lib$r ) {
			if ( lib$z( y ) ) {
				return lib$G( lib$I / 4.0, y );
			}
			return lib$G( 0.0, y );
		}
		if ( lib$z( y ) ) {
			return lib$G( 3.0*lib$I/4.0, y );
		}
		return lib$G( lib$I, y );
	}
	if ( lib$z( y ) ) {
		return lib$G( lib$I / 2.0, y );
	}
	if ( y === 0.0 ) {
		if ( x >= 0.0 && !lib$H( x ) ) {
			return lib$G( 0.0, y );
		}
		return lib$G( lib$I, y );
	}
	if ( x === 0.0 ) {
		return lib$G( lib$I / 2.0, y );
	}
	q = lib$C( y / x );
	if ( x < 0.0 ) {
		if ( q <= 0.0 ) {
			return q + lib$I;
		}
		return q - lib$I;
	}
	return q;
}
var main$n = atan2;

var lib$J = main$n;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var FLOAT64_SMALLEST_NORMAL = 2.2250738585072014e-308;
var lib$K = FLOAT64_SMALLEST_NORMAL;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$5( x ) {
	if ( x === 0.0 ) {
		return 1.87595182427177;
	}
	return 1.87595182427177 + (x * (-1.8849797954337717 + (x * (1.6214297201053545 + (x * (-0.758397934778766 + (x * 0.14599619288661245)))))));
}
var polyval_p$2 = evalpoly$5;

var SIGN_MASK$1 = 0x80000000|0;
var ABS_MASK = 0x7fffffff|0;
var TWO_54 = 18014398509481984;
var ONE = 0x00000001|0;
var B1 = 715094163|0;
var B2 = 696219795|0;
function cbrt( x ) {
	var high;
	var sgn;
	var hx;
	var r;
	var s;
	var t;
	var w;
	if (
		lib( x ) ||
		lib$z( x ) ||
		x === 0.0
	) {
		return x;
	}
	hx = lib$p( x );
	sgn = hx & SIGN_MASK$1;
	hx &= ABS_MASK;
	t = 0.0;
	if ( x < lib$K ) {
		t = TWO_54;
		t *= x;
		high = lib$p( t );
		high = ( (high&ABS_MASK)/3 ) + B2;
		t = lib$F( sgn|high, 0 );
	} else {
		high = (hx/3) + B1;
		t = lib$q( t, sgn|high );
	}
	r = (t*t) * (t/x);
	t *= polyval_p$2( r );
	high = lib$p( t );
	t = lib$F( high+ONE, 0 );
	s = t * t;
	r = x / s;
	w = t + t;
	r = (r - t) / (w + r);
	t += t * r;
	return t;
}
var cbrt_1 = cbrt;

var lib$L = cbrt_1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$6( x ) {
	if ( x === 0.0 ) {
		return 0.0416666666666666;
	}
	return 0.0416666666666666 + (x * (-0.001388888888887411 + (x * 0.00002480158728947673)));
}
var polyval_c13 = evalpoly$6;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$7( x ) {
	if ( x === 0.0 ) {
		return -2.7557314351390663e-7;
	}
	return -2.7557314351390663e-7 + (x * (2.087572321298175e-9 + (x * -1.1359647557788195e-11)));
}
var polyval_c46 = evalpoly$7;

function kernelCos( x, y ) {
	var hz;
	var r;
	var w;
	var z;
	z = x * x;
	w = z * z;
	r = z * polyval_c13( z );
	r += w * w * polyval_c46( z );
	hz = 0.5 * z;
	w = 1.0 - hz;
	return w + ( ((1.0-w) - hz) + ((z*r) - (x*y)) );
}
var kernel_cos = kernelCos;

var lib$M = kernel_cos;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*
*
* ## Notice
*
* The following copyright, license, and long comment were part of the original implementation available as part of [FreeBSD]{@link https://svnweb.freebsd.org/base/release/9.3.0/lib/msun/src/k_sin.c}. The implementation follows the original, but has been modified for JavaScript.
*
* ```text
* Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
*
* Developed at SunPro, a Sun Microsystems, Inc. business.
* Permission to use, copy, modify, and distribute this
* software is freely granted, provided that this notice
* is preserved.
* ```
*/
var S1 = -1.66666666666666324348e-01;
var S2 = 8.33333333332248946124e-03;
var S3 = -1.98412698298579493134e-04;
var S4 = 2.75573137070700676789e-06;
var S5 = -2.50507602534068634195e-08;
var S6 = 1.58969099521155010221e-10;
function kernelSin( x, y ) {
	var r;
	var v;
	var w;
	var z;
	z = x * x;
	w = z * z;
	r = S2 + (z * (S3 + (z*S4))) + (z * w * (S5 + (z*S6)));
	v = z * x;
	if ( y === 0.0 ) {
		return x + (v * (S1 + (z*r)));
	}
	return x - (((z*((0.5*y) - (v*r))) - y) - (v*S1));
}
var kernel_sin = kernelSin;

var lib$N = kernel_sin;

var LOW$4;
if ( lib$o === true ) {
	LOW$4 = 0;
} else {
	LOW$4 = 1;
}
var low = LOW$4;

var FLOAT64_VIEW$4 = new lib$f( 1 );
var UINT32_VIEW$4 = new lib$c( FLOAT64_VIEW$4.buffer );
function getLowWord( x ) {
	FLOAT64_VIEW$4[ 0 ] = x;
	return UINT32_VIEW$4[ low ];
}
var main$o = getLowWord;

var lib$O = main$o;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var floor = Math.floor;
var floor_1 = floor;

var lib$P = floor_1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var FLOAT64_MAX_BASE2_EXPONENT = 1023|0;
var lib$Q = FLOAT64_MAX_BASE2_EXPONENT;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var FLOAT64_MAX_BASE2_EXPONENT_SUBNORMAL = -1023|0;
var lib$R = FLOAT64_MAX_BASE2_EXPONENT_SUBNORMAL;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var FLOAT64_MIN_BASE2_EXPONENT_SUBNORMAL = -1074|0;
var lib$S = FLOAT64_MIN_BASE2_EXPONENT_SUBNORMAL;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function abs( x ) {
	if ( x < 0.0 ) {
		return -x;
	}
	if ( x === 0.0 ) {
		return 0.0;
	}
	return x;
}
var abs_1 = abs;

var lib$T = abs_1;

var SCALAR = 4503599627370496;
function normalize( out, x ) {
	if ( lib( x ) || lib$z( x ) ) {
		out[ 0 ] = x;
		out[ 1 ] = 0;
		return out;
	}
	if ( x !== 0.0 && lib$T( x ) < lib$K ) {
		out[ 0 ] = x * SCALAR;
		out[ 1 ] = -52;
		return out;
	}
	out[ 0 ] = x;
	out[ 1 ] = 0;
	return out;
}
var normalize_1 = normalize;

function normalize$1( out, x ) {
	if ( arguments.length === 1 ) {
		return normalize_1( [ 0.0, 0 ], out );
	}
	return normalize_1( out, x );
}
var main$p = normalize$1;

var lib$U = main$p;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var FLOAT64_HIGH_WORD_EXPONENT_MASK = 0x7ff00000;
var lib$V = FLOAT64_HIGH_WORD_EXPONENT_MASK;

function exponent( x ) {
	var high = lib$p( x );
	high = ( high & lib$V ) >>> 20;
	return (high - lib$u)|0;
}
var main$q = exponent;

var lib$W = main$q;

var TWO52_INV = 2.220446049250313e-16;
var CLEAR_EXP_MASK = 0x800fffff>>>0;
var FRAC = [ 0.0, 0.0 ];
var WORDS$1 = [ 0, 0 ];
function ldexp( frac, exp ) {
	var high;
	var m;
	if (
		frac === 0.0 ||
		lib( frac ) ||
		lib$z( frac )
	) {
		return frac;
	}
	lib$U( FRAC, frac );
	frac = FRAC[ 0 ];
	exp += FRAC[ 1 ];
	exp += lib$W( frac );
	if ( exp < lib$S ) {
		return lib$G( 0.0, frac );
	}
	if ( exp > lib$Q ) {
		if ( frac < 0.0 ) {
			return lib$t;
		}
		return lib$r;
	}
	if ( exp <= lib$R ) {
		exp += 52;
		m = TWO52_INV;
	} else {
		m = 1.0;
	}
	lib$E( WORDS$1, frac );
	high = WORDS$1[ 0 ];
	high &= CLEAR_EXP_MASK;
	high |= ((exp+lib$u) << 20);
	return m * lib$F( high, WORDS$1[ 1 ] );
}
var ldexp_1 = ldexp;

var lib$X = ldexp_1;

var IPIO2 = [
	0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62,
	0x95993C, 0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A,
	0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129,
	0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41,
	0x3991D6, 0x398353, 0x39F49C, 0x845F8B, 0xBDF928, 0x3B1FF8,
	0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF,
	0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5,
	0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08,
	0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3,
	0x91615E, 0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880,
	0x4D7327, 0x310606, 0x1556CA, 0x73A8C9, 0x60E27B, 0xC08C6B
];
var PIO2 = [
	1.57079625129699707031e+00,
	7.54978941586159635335e-08,
	5.39030252995776476554e-15,
	3.28200341580791294123e-22,
	1.27065575308067607349e-29,
	1.22933308981111328932e-36,
	2.73370053816464559624e-44,
	2.16741683877804819444e-51
];
var TWO24 = 1.67772160000000000000e+07;
var TWON24 = 5.96046447753906250000e-08;
var F = zero( new Array( 20 ) );
var Q = zero( new Array( 20 ) );
var FQ = zero( new Array( 20 ) );
var IQ = zero( new Array( 20 ) );
function zero( arr ) {
	var len = arr.length;
	var i;
	for ( i = 0; i < len; i++ ) {
		arr[ i ] = 0.0;
	}
	return arr;
}
function compute( x, y, jz, q, q0, jk, jv, jx, f ) {
	var carry;
	var fw;
	var ih;
	var jp;
	var i;
	var k;
	var n;
	var j;
	var z;
	jp = jk;
	z = q[ jz ];
	j = jz;
	for ( i = 0; j > 0; i++ ) {
		fw = ( TWON24 * z )|0;
		IQ[ i ] = ( z - (TWO24*fw) )|0;
		z = q[ j-1 ] + fw;
		j -= 1;
	}
	z = lib$X( z, q0 );
	z -= 8.0 * lib$P( z*0.125 );
	n = z|0;
	z -= n;
	ih = 0;
	if ( q0 > 0 ) {
		i = ( IQ[ jz-1 ] >> (24-q0) );
		n += i;
		IQ[ jz-1 ] -= ( i << (24-q0) );
		ih = ( IQ[ jz-1 ] >> (23-q0) );
	}
	else if ( q0 === 0 ) {
		ih = ( IQ[ jz-1 ] >> 23 );
	}
	else if ( z >= 0.5 ) {
		ih = 2;
	}
	if ( ih > 0 ) {
		n += 1;
		carry = 0;
		for ( i = 0; i < jz; i++ ) {
			j = IQ[ i ];
			if ( carry === 0 ) {
				if ( j !== 0 ) {
					carry = 1;
					IQ[ i ] = 0x1000000 - j;
				}
			} else {
				IQ[ i ] = 0xffffff - j;
			}
		}
		if ( q0 > 0 ) {
			switch ( q0 ) {
			case 1:
				IQ[ jz-1 ] &= 0x7fffff;
				break;
			case 2:
				IQ[ jz-1 ] &= 0x3fffff;
				break;
			}
		}
		if ( ih === 2 ) {
			z = 1.0 - z;
			if ( carry !== 0 ) {
				z -= lib$X( 1.0, q0 );
			}
		}
	}
	if ( z === 0.0 ) {
		j = 0;
		for ( i = jz-1; i >= jk; i-- ) {
			j |= IQ[ i ];
		}
		if ( j === 0 ) {
			for ( k = 1; IQ[ jk-k ] === 0; k++ ) {
			}
			for ( i = jz+1; i <= jz+k; i++ ) {
				f[ jx+i ] = IPIO2[ jv+i ];
				fw = 0.0;
				for ( j = 0; j <= jx; j++ ) {
					fw += x[ j ] * f[ jx + (i-j) ];
				}
				q[ i ] = fw;
			}
			jz += k;
			return compute( x, y, jz, q, q0, jk, jv, jx, f );
		}
	}
	if ( z === 0.0 ) {
		jz -= 1;
		q0 -= 24;
		while ( IQ[ jz ] === 0 ) {
			jz -= 1;
			q0 -= 24;
		}
	} else {
		z = lib$X( z, -q0 );
		if ( z >= TWO24 ) {
			fw = (TWON24*z)|0;
			IQ[ jz ] = ( z - (TWO24*fw) )|0;
			jz += 1;
			q0 += 24;
			IQ[ jz ] = fw;
		} else {
			IQ[ jz ] = z|0;
		}
	}
	fw = lib$X( 1.0, q0 );
	for ( i = jz; i >= 0; i-- ) {
		q[ i ] = fw * IQ[i];
		fw *= TWON24;
	}
	for ( i = jz; i >= 0; i-- ) {
		fw = 0.0;
		for ( k = 0; k <= jp && k <= jz-i; k++ ) {
			fw += PIO2[ k ] * q[ i+k ];
		}
		FQ[ jz-i ] = fw;
	}
	fw = 0.0;
	for ( i = jz; i >= 0; i-- ) {
		fw += FQ[ i ];
	}
	if ( ih === 0 ) {
		y[ 0 ] = fw;
	} else {
		y[ 0 ] = -fw;
	}
	fw = FQ[ 0 ] - fw;
	for ( i = 1; i <= jz; i++ ) {
		fw += FQ[i];
	}
	if ( ih === 0 ) {
		y[ 1 ] = fw;
	} else {
		y[ 1 ] = -fw;
	}
	return ( n & 7 );
}
function kernelRempio2( x, y, e0, nx ) {
	var fw;
	var jk;
	var jv;
	var jx;
	var jz;
	var q0;
	var i;
	var j;
	var m;
	jk = 4;
	jx = nx - 1;
	jv = ( (e0 - 3) / 24 )|0;
	if ( jv < 0 ) {
		jv = 0;
	}
	q0 = e0 - (24 * (jv + 1));
	j = jv - jx;
	m = jx + jk;
	for ( i = 0; i <= m; i++ ) {
		if ( j < 0 ) {
			F[ i ] = 0.0;
		} else {
			F[ i ] = IPIO2[ j ];
		}
		j += 1;
	}
	for ( i = 0; i <= jk; i++ ) {
		fw = 0.0;
		for ( j = 0; j <= jx; j++ ) {
			fw += x[ j ] * F[ jx + (i-j) ];
		}
		Q[ i ] = fw;
	}
	jz = jk;
	return compute( x, y, jz, Q, q0, jk, jv, jx, F );
}
var kernel_rempio2 = kernelRempio2;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var round = Math.round;
var round_1 = round;

var lib$Y = round_1;

var INVPIO2 = 6.36619772367581382433e-01;
var PIO2_1 = 1.57079632673412561417e+00;
var PIO2_1T = 6.07710050650619224932e-11;
var PIO2_2 = 6.07710050630396597660e-11;
var PIO2_2T = 2.02226624879595063154e-21;
var PIO2_3 = 2.02226624871116645580e-21;
var PIO2_3T = 8.47842766036889956997e-32;
var EXPONENT_MASK = 0x7ff|0;
function rempio2Medium( x, ix, y ) {
	var high;
	var n;
	var t;
	var r;
	var w;
	var i;
	var j;
	n = lib$Y( x * INVPIO2 );
	r = x - ( n * PIO2_1 );
	w = n * PIO2_1T;
	j = (ix >> 20)|0;
	y[ 0 ] = r - w;
	high = lib$p( y[0] );
	i = j - ( (high >> 20) & EXPONENT_MASK );
	if ( i > 16 ) {
		t = r;
		w = n * PIO2_2;
		r = t - w;
		w = (n * PIO2_2T) - ((t-r) - w);
		y[ 0 ] = r - w;
		high = lib$p( y[0] );
		i = j - ( (high >> 20) & EXPONENT_MASK );
		if ( i > 49 ) {
			t = r;
			w = n * PIO2_3;
			r = t - w;
			w = (n * PIO2_3T) - ((t-r) - w);
			y[ 0 ] = r - w;
		}
	}
	y[ 1 ] = (r - y[0]) - w;
	return n;
}
var rempio2_medium = rempio2Medium;

var ZERO = 0.00000000000000000000e+00;
var TWO24$1 = 1.67772160000000000000e+07;
var PIO2_1$1 = 1.57079632673412561417e+00;
var PIO2_1T$1 = 6.07710050650619224932e-11;
var TWO_PIO2_1T = 2.0 * PIO2_1T$1;
var THREE_PIO2_1T = 3.0 * PIO2_1T$1;
var FOUR_PIO2_1T = 4.0 * PIO2_1T$1;
var ABS_MASK$1 = 0x7fffffff|0;
var EXPONENT_MASK$1 = 0x7ff00000|0;
var SIGNIFICAND_MASK = 0xfffff|0;
var PI_HIGH_WORD_SIGNIFICAND = 0x921fb|0;
var PIO4_HIGH_WORD = 0x3fe921fb|0;
var THREE_PIO4_HIGH_WORD = 0x4002d97c|0;
var FIVE_PIO4_HIGH_WORD = 0x400f6a7a|0;
var THREE_PIO2_HIGH_WORD = 0x4012d97c|0;
var SEVEN_PIO4_HIGH_WORD = 0x4015fdbc|0;
var TWO_PI_HIGH_WORD = 0x401921fb|0;
var NINE_PIO4_HIGH_WORD = 0x401c463b|0;
var MEDIUM = 0x413921fb|0;
var TX = new Array( 3 );
var TY = new Array( 2 );
function rempio2( x, y ) {
	var low;
	var e0;
	var hx;
	var ix;
	var nx;
	var i;
	var n;
	var z;
	hx = lib$p( x );
	ix = (hx & ABS_MASK$1)|0;
	if ( ix <= PIO4_HIGH_WORD ) {
		y[ 0 ] = x;
		y[ 1 ] = 0.0;
		return 0;
	}
	if ( ix <= FIVE_PIO4_HIGH_WORD ) {
		if ( (ix & SIGNIFICAND_MASK) === PI_HIGH_WORD_SIGNIFICAND ) {
			return rempio2_medium( x, ix, y );
		}
		if ( ix <= THREE_PIO4_HIGH_WORD ) {
			if ( x > 0.0 ) {
				z = x - PIO2_1$1;
				y[ 0 ] = z - PIO2_1T$1;
				y[ 1 ] = (z - y[0]) - PIO2_1T$1;
				return 1;
			}
			z = x + PIO2_1$1;
			y[ 0 ] = z + PIO2_1T$1;
			y[ 1 ] = (z - y[0]) + PIO2_1T$1;
			return -1;
		}
		if ( x > 0.0 ) {
			z = x - ( 2.0*PIO2_1$1 );
			y[ 0 ] = z - TWO_PIO2_1T;
			y[ 1 ] = (z - y[0]) - TWO_PIO2_1T;
			return 2;
		}
		z = x + ( 2.0*PIO2_1$1 );
		y[ 0 ] = z + TWO_PIO2_1T;
		y[ 1 ] = (z - y[0]) + TWO_PIO2_1T;
		return -2;
	}
	if ( ix <= NINE_PIO4_HIGH_WORD ) {
		if ( ix <= SEVEN_PIO4_HIGH_WORD ) {
			if ( ix === THREE_PIO2_HIGH_WORD ) {
				return rempio2_medium( x, ix, y );
			}
			if ( x > 0.0 ) {
				z = x - ( 3.0*PIO2_1$1 );
				y[ 0 ] = z - THREE_PIO2_1T;
				y[ 1 ] = (z - y[0]) - THREE_PIO2_1T;
				return 3;
			}
			z = x + ( 3.0*PIO2_1$1 );
			y[ 0 ] = z + THREE_PIO2_1T;
			y[ 1 ] = (z - y[0]) + THREE_PIO2_1T;
			return -3;
		}
		if ( ix === TWO_PI_HIGH_WORD ) {
			return rempio2_medium( x, ix, y );
		}
		if ( x > 0.0 ) {
			z = x - ( 4.0*PIO2_1$1 );
			y[ 0 ] = z - FOUR_PIO2_1T;
			y[ 1 ] = (z - y[0]) - FOUR_PIO2_1T;
			return 4;
		}
		z = x + ( 4.0*PIO2_1$1 );
		y[ 0 ] = z + FOUR_PIO2_1T;
		y[ 1 ] = (z - y[0]) + FOUR_PIO2_1T;
		return -4;
	}
	if ( ix < MEDIUM ) {
		return rempio2_medium( x, ix, y );
	}
	if ( ix >= EXPONENT_MASK$1 ) {
		y[ 0 ] = NaN;
		y[ 1 ] = NaN;
		return 0.0;
	}
	low = lib$O( x );
	e0 = (ix >> 20) - 1046;
	z = lib$F( ix - ((e0 << 20)|0), low );
	for ( i = 0; i < 2; i++ ) {
		TX[ i ] = z|0;
		z = (z - TX[i]) * TWO24$1;
	}
	TX[ 2 ] = z;
	nx = 3;
	while ( TX[ nx-1 ] === ZERO ) {
		nx -= 1;
	}
	n = kernel_rempio2( TX, TY, e0, nx);
	if ( x < 0.0 ) {
		y[ 0 ] = -TY[ 0 ];
		y[ 1 ] = -TY[ 1 ];
		return -n;
	}
	y[ 0 ] = TY[ 0 ];
	y[ 1 ] = TY[ 1 ];
	return n;
}
var rempio2_1 = rempio2;

var lib$Z = rempio2_1;

var buffer = [ 0.0, 0.0 ];
var HIGH_WORD_ABS_MASK = 0x7fffffff|0;
var HIGH_WORD_PIO4 = 0x3fe921fb|0;
var HIGH_WORD_TWO_NEG_27 = 0x3e400000|0;
var HIGH_WORD_EXPONENT_MASK = 0x7ff00000|0;
function cos( x ) {
	var ix;
	var n;
	ix = lib$p( x );
	ix &= HIGH_WORD_ABS_MASK;
	if ( ix <= HIGH_WORD_PIO4 ) {
		if ( ix < HIGH_WORD_TWO_NEG_27 ) {
			return 1.0;
		}
		return lib$M( x, 0.0 );
	}
	if ( ix >= HIGH_WORD_EXPONENT_MASK ) {
		return NaN;
	}
	n = lib$Z( x, buffer );
	switch ( n & 3 ) {
	case 0:
		return lib$M( buffer[ 0 ], buffer[ 1 ] );
	case 1:
		return -lib$N( buffer[ 0 ], buffer[ 1 ] );
	case 2:
		return -lib$M( buffer[ 0 ], buffer[ 1 ] );
	default:
		return lib$N( buffer[ 0 ], buffer[ 1 ] );
	}
}
var cos_1 = cos;

var lib$_ = cos_1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var ceil = Math.ceil;
var ceil_1 = ceil;

var lib$$ = ceil_1;

function trunc( x ) {
	if ( x < 0.0 ) {
		return lib$$( x );
	}
	return lib$P( x );
}
var trunc_1 = trunc;

var lib$10 = trunc_1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$8( x ) {
	if ( x === 0.0 ) {
		return 0.16666666666666602;
	}
	return 0.16666666666666602 + (x * (-0.0027777777777015593 + (x * (0.00006613756321437934 + (x * (-0.0000016533902205465252 + (x * 4.1381367970572385e-8)))))));
}
var polyval_p$3 = evalpoly$8;

function expmulti( hi, lo, k ) {
	var r;
	var t;
	var c;
	var y;
	r = hi - lo;
	t = r * r;
	c = r - ( t*polyval_p$3( t ) );
	y = 1.0 - ( lo - ( (r*c)/(2.0-c) ) - hi);
	return lib$X( y, k );
}
var expmulti_1 = expmulti;

var LN2_HI$2 = 6.93147180369123816490e-01;
var LN2_LO$2 = 1.90821492927058770002e-10;
var LOG2_E = 1.44269504088896338700e+00;
var OVERFLOW = 7.09782712893383973096e+02;
var UNDERFLOW = -7.45133219101941108420e+02;
var NEARZERO = 1.0 / (1 << 28);
var NEG_NEARZERO = -NEARZERO;
function exp( x ) {
	var hi;
	var lo;
	var k;
	if ( lib( x ) || x === lib$r ) {
		return x;
	}
	if ( x === lib$t ) {
		return 0.0;
	}
	if ( x > OVERFLOW ) {
		return lib$r;
	}
	if ( x < UNDERFLOW ) {
		return 0.0;
	}
	if (
		x > NEG_NEARZERO &&
		x < NEARZERO
	) {
		return 1.0 + x;
	}
	if ( x < 0.0 ) {
		k = lib$10( (LOG2_E*x) - 0.5 );
	} else {
		k = lib$10( (LOG2_E*x) + 0.5 );
	}
	hi = x - (k*LN2_HI$2);
	lo = k * LN2_LO$2;
	return expmulti_1( hi, lo, k );
}
var exp_1 = exp;

var lib$11 = exp_1;

function cosh( x ) {
	if ( lib( x ) ) {
		return x;
	}
	if ( x < 0.0 ) {
		x = -x;
	}
	if ( x > 21.0 ) {
		return lib$11( x ) / 2.0;
	}
	return ( lib$11(x) + lib$11(-x) ) / 2.0;
}
var cosh_1 = cosh;

var lib$12 = cosh_1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var HALF_LN2 = 3.46573590279972654709e-01;
var lib$13 = HALF_LN2;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$9( x ) {
	if ( x === 0.0 ) {
		return -0.03333333333333313;
	}
	return -0.03333333333333313 + (x * (0.0015873015872548146 + (x * (-0.0000793650757867488 + (x * (0.000004008217827329362 + (x * -2.0109921818362437e-7)))))));
}
var polyval_q$2 = evalpoly$9;

var OVERFLOW_THRESHOLD = 7.09782712893383973096e+02;
var LN2_HI$3 = 6.93147180369123816490e-01;
var LN2_LO$3 = 1.90821492927058770002e-10;
var LN2_INV = 1.44269504088896338700e+00;
var LN2x56 = 3.88162421113569373274e+01;
var LN2_HALFX3 = 1.03972077083991796413e+00;
function expm1( x ) {
	var halfX;
	var sign;
	var hi;
	var lo;
	var hx;
	var r1;
	var y;
	var z;
	var c;
	var t;
	var e;
	var k;
	if ( x === lib$r || lib( x ) ) {
		return x;
	}
	if ( x === lib$t ) {
		return -1.0;
	}
	if ( x === 0.0 ) {
		return x;
	}
	if ( x < 0.0 ) {
		sign = true;
		y = -x;
	} else {
		sign = false;
		y = x;
	}
	if ( y >= LN2x56 ) {
		if ( sign ) {
			return -1.0;
		}
		if ( y >= OVERFLOW_THRESHOLD ) {
			return lib$r;
		}
	}
	hx = lib$p( y )|0;
	if ( y > lib$13 ) {
		if ( y < LN2_HALFX3 ) {
			if ( sign ) {
				hi = x + LN2_HI$3;
				lo = -LN2_LO$3;
				k = -1;
			} else {
				hi = x - LN2_HI$3;
				lo = LN2_LO$3;
				k = 1;
			}
		} else {
			if ( sign ) {
				k = (LN2_INV*x) - 0.5;
			} else {
				k = (LN2_INV*x) + 0.5;
			}
			k |= 0;
			t = k;
			hi = x - (t*LN2_HI$3);
			lo = t * LN2_LO$3;
		}
		x = hi - lo;
		c = (hi-x) - lo;
	}
	else if ( hx < 1016070144 ) {
		return x;
	}
	else {
		k = 0;
	}
	halfX = 0.5 * x;
	z = x * halfX;
	r1 = 1.0 + ( z * polyval_q$2( z ) );
	t = 3.0 - (r1*halfX);
	e = z * ( (r1-t) / (6.0 - (x*t)) );
	if ( k === 0 ) {
		return x - ( (x*e) - z );
	}
	e = ( x * (e-c) ) - c;
	e -= z;
	if ( k === -1 ) {
		return ( 0.5*(x-e) )- 0.5;
	}
	if ( k === 1 ) {
		if ( x < -0.25 ) {
			return -2.0 * ( e - (x+0.5) );
		}
		return 1 + ( 2.0 * (x-e) );
	}
	if ( k <= -2 || k > 56 ) {
		y = 1.0 - (e-x);
		hi = (lib$p( y ) + (k<<20))|0;
		y = lib$q( y, hi );
		return y - 1.0;
	}
	t = 1.0;
	if ( k < 20 ) {
		hi = (1072693248 - (0x200000>>k))|0;
		t = lib$q( t, hi );
		y = t - (e-x);
	} else {
		hi = ( (lib$u-k)<<20 )|0;
		t = lib$q( t, hi );
		y = x - (e+t);
		y += 1.0;
	}
	hi = (lib$p( y ) + (k<<20))|0;
	return lib$q( y, hi );
}
var expm1_1 = expm1;

var lib$14 = expm1_1;

var LOW$5;
if ( lib$o === true ) {
	LOW$5 = 0;
} else {
	LOW$5 = 1;
}
var low$1 = LOW$5;

var FLOAT64_VIEW$5 = new lib$f( 1 );
var UINT32_VIEW$5 = new lib$c( FLOAT64_VIEW$5.buffer );
function setLowWord( x, low ) {
	FLOAT64_VIEW$5[ 0 ] = x;
	UINT32_VIEW$5[ low$1 ] = ( low >>> 0 );
	return FLOAT64_VIEW$5[ 0 ];
}
var main$r = setLowWord;

var lib$15 = main$r;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$a( x ) {
	if ( x === 0.0 ) {
		return 0.3999999999940942;
	}
	return 0.3999999999940942 + (x * (0.22222198432149784 + (x * 0.15313837699209373)));
}
var polyval_p$4 = evalpoly$a;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$b( x ) {
	if ( x === 0.0 ) {
		return 0.6666666666666735;
	}
	return 0.6666666666666735 + (x * (0.2857142874366239 + (x * (0.1818357216161805 + (x * 0.14798198605116586)))));
}
var polyval_q$3 = evalpoly$b;

var HIGH_SIGNIFICAND_MASK$1 = 0x000fffff|0;
var ONE_THIRD$1 = 0.33333333333333333;
function klog( x ) {
	var hfsq;
	var t1;
	var t2;
	var hx;
	var f;
	var s;
	var z;
	var R;
	var w;
	var i;
	var j;
	hx = lib$p( x );
	f = x - 1.0;
	if ( ( HIGH_SIGNIFICAND_MASK$1 & (2+hx) ) < 3 ) {
		if ( f === 0.0 ) {
			return 0.0;
		}
		return f * f * ( (ONE_THIRD$1*f) - 0.5 );
	}
	s = f / ( 2.0 + f );
	z = s * s;
	hx &= HIGH_SIGNIFICAND_MASK$1;
	i = (hx - 0x6147a)|0;
	w = z * z;
	j = (0x6b851 - hx)|0;
	t1 = w * polyval_p$4( w );
	t2 = z * polyval_q$3( w );
	i |= j;
	R = t2 + t1;
	if ( i > 0 ) {
		hfsq = 0.5 * f * f;
		return ( s * (hfsq+R) ) - hfsq;
	}
	return s * (R-f);
}
var klog_1 = klog;

var TWO54$1 = 1.80143985094819840000e+16;
var IVLN10HI = 4.34294481878168880939e-01;
var IVLN10LO = 2.50829467116452752298e-11;
var LOG10_2HI = 3.01029995663611771306e-01;
var LOG10_2LO = 3.69423907715893078616e-13;
var HIGH_SIGNIFICAND_MASK$2 = 0x000fffff|0;
var HIGH_MAX_NORMAL_EXP$1 = 0x7ff00000|0;
var HIGH_MIN_NORMAL_EXP$1 = 0x00100000|0;
var HIGH_BIASED_EXP_0$1 = 0x3ff00000|0;
function log10( x ) {
	var hi;
	var hx;
	var lo;
	var f;
	var i;
	var k;
	var y;
	var z;
	if ( lib( x ) || x < 0.0 ) {
		return NaN;
	}
	if ( x === 0.0 ) {
		return lib$t;
	}
	hx = lib$p( x );
	k = 0|0;
	if ( hx < HIGH_MIN_NORMAL_EXP$1 ) {
		k -= 54|0;
		x *= TWO54$1;
		hx = lib$p( x );
	}
	if ( hx >= HIGH_MAX_NORMAL_EXP$1 ) {
		return x + x;
	}
	k += ((hx>>20) - lib$u)|0;
	hx &= HIGH_SIGNIFICAND_MASK$2;
	i = ( (hx+0x95f64)&0x100000 )|0;
	x = lib$q( x, hx|(i^HIGH_BIASED_EXP_0$1) );
	k += (i>>20)|0;
	y = k;
	f = klog_1( x );
	x -= 1;
	hi = lib$15( x, 0.0 );
	lo = x - hi;
	z = (y*LOG10_2LO) + ( (x+f)*IVLN10LO );
	z += ( (lo+f)*IVLN10HI ) + ( hi*IVLN10HI );
	return z + ( y*LOG10_2HI );
}
var log10_1 = log10;

var lib$16 = log10_1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$c( x ) {
	if ( x === 0.0 ) {
		return 0.3999999999940942;
	}
	return 0.3999999999940942 + (x * (0.22222198432149784 + (x * 0.15313837699209373)));
}
var polyval_p$5 = evalpoly$c;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$d( x ) {
	if ( x === 0.0 ) {
		return 0.6666666666666735;
	}
	return 0.6666666666666735 + (x * (0.2857142874366239 + (x * (0.1818357216161805 + (x * 0.14798198605116586)))));
}
var polyval_q$4 = evalpoly$d;

var HIGH_SIGNIFICAND_MASK$3 = 0x000fffff|0;
var ONE_THIRD$2 = 0.33333333333333333;
function klog$1( x ) {
	var hfsq;
	var t1;
	var t2;
	var hx;
	var f;
	var s;
	var z;
	var R;
	var w;
	var i;
	var j;
	hx = lib$p( x );
	f = x - 1.0;
	if ( ( HIGH_SIGNIFICAND_MASK$3 & (2+hx) ) < 3 ) {
		if ( f === 0.0 ) {
			return 0.0;
		}
		return f * f * ( ( ONE_THIRD$2*f )- 0.5 );
	}
	s = f / ( 2.0 + f );
	z = s * s;
	hx &= HIGH_SIGNIFICAND_MASK$3;
	i = ( hx - 0x6147a )|0;
	w = z * z;
	j = ( 0x6b851 - hx )|0;
	t1 = w * polyval_p$5( w );
	t2 = z * polyval_q$4( w );
	i |= j;
	R = t2 + t1;
	if ( i > 0 ) {
		hfsq = 0.5 * f * f;
		return ( s * (hfsq+R) ) - hfsq;
	}
	return s * (R-f);
}
var klog_1$1 = klog$1;

var TWO54$2 = 1.80143985094819840000e+16;
var IVLN2HI = 1.44269504072144627571e+00;
var IVLN2LO = 1.67517131648865118353e-10;
var HIGH_SIGNIFICAND_MASK$4 = 0x000fffff|0;
var HIGH_MAX_NORMAL_EXP$2 = 0x7ff00000|0;
var HIGH_MIN_NORMAL_EXP$2 = 0x00100000|0;
var HIGH_BIASED_EXP_0$2 = 0x3ff00000|0;
var ABS_MASK$2 = 0x7fffffff|0;
var WORDS$2 = [ 0|0, 0|0 ];
function log2( x ) {
	var hi;
	var lo;
	var hx;
	var lx;
	var f;
	var i;
	var k;
	if ( lib( x ) || x < 0.0 ) {
		return NaN;
	}
	lib$E( WORDS$2, x );
	hx = WORDS$2[ 0 ];
	lx = WORDS$2[ 1 ];
	k = 0|0;
	if ( hx < HIGH_MIN_NORMAL_EXP$2 ) {
		if ( ( (hx&ABS_MASK$2) | lx ) === 0 ) {
			return lib$t;
		}
		k -= 54|0;
		x *= TWO54$2;
		hx = lib$p( x );
	}
	if ( hx >= HIGH_MAX_NORMAL_EXP$2 ) {
		return x + x;
	}
	k += ( (hx>>20) - lib$u )|0;
	hx &= HIGH_SIGNIFICAND_MASK$4;
	i = ( ( hx+0x95f64 ) & 0x100000 )|0;
	x = lib$q( x, hx|(i^HIGH_BIASED_EXP_0$2) );
	k += (i>>20)|0;
	f = klog_1$1( x );
	x -= 1;
	hi = lib$15( x, 0 );
	lo = x - hi;
	return ( (x+f)*IVLN2LO ) + ( (lo+f)*IVLN2HI ) + ( hi*IVLN2HI ) + k;
}
var log2_1 = log2;

var lib$17 = log2_1;

var ABS_MASK$3 = 0x7fffffff|0;
var EXPONENT_MASK$2 = 0x7ff00000|0;
var PIO4_HIGH_WORD$1 = 0x3fe921fb|0;
var SMALL_HIGH_WORD = 0x3e500000|0;
var Y = [ 0.0, 0.0 ];
function sin( x ) {
	var ix;
	var n;
	ix = lib$p( x );
	ix &= ABS_MASK$3;
	if ( ix <= PIO4_HIGH_WORD$1 ) {
		if ( ix < SMALL_HIGH_WORD ) {
			return x;
		}
		return lib$N( x, 0.0 );
	}
	if ( ix >= EXPONENT_MASK$2 ) {
		return NaN;
	}
	n = lib$Z( x, Y );
	switch ( n & 3 ) {
	case 0:
		return lib$N( Y[ 0 ], Y[ 1 ] );
	case 1:
		return lib$M( Y[ 0 ], Y[ 1 ] );
	case 2:
		return -lib$N( Y[ 0 ], Y[ 1 ] );
	default:
		return -lib$M( Y[ 0 ], Y[ 1 ] );
	}
}
var sin_1 = sin;

var lib$18 = sin_1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalrational$2( x ) {
	var ax;
	var s1;
	var s2;
	if ( x === 0.0 ) {
		return 0.16666666666666666;
	}
	if ( x < 0.0 ) {
		ax = -x;
	} else {
		ax = x;
	}
	if ( ax <= 1.0 ) {
		s1 = -351754.9648081514 + (x * (-11561.443576500522 + (x * (-163.72585752598383 + (x * -0.789474443963537)))));
		s2 = -2110529.7888489086 + (x * (36157.827983443196 + (x * (-277.7110814206028 + (x * 1.0)))));
	} else {
		x = 1.0 / x;
		s1 = -0.789474443963537 + (x * (-163.72585752598383 + (x * (-11561.443576500522 + (x * -351754.9648081514)))));
		s2 = 1.0 + (x * (-277.7110814206028 + (x * (36157.827983443196 + (x * -2110529.7888489086)))));
	}
	return s1 / s2;
}
var rational_pq$1 = evalrational$2;

var MAXLOG = 7.09782712893383996843e2;
var MINLOG = -7.08396418532264106224e2;
var POS_OVERFLOW = MAXLOG + lib$w;
var NEG_OVERFLOW = MINLOG - lib$w;
var LARGE = MAXLOG - lib$w;
function sinh( x ) {
	var a;
	if ( x === 0.0 ) {
		return x;
	}
	a = lib$T( x );
	if ( x > POS_OVERFLOW || x < NEG_OVERFLOW ) {
		return ( x > 0.0 ) ? lib$r : lib$t;
	}
	if ( a > 1.0 ) {
		if ( a >= LARGE ) {
			a = lib$11( 0.5*a );
			a *= 0.5 * a;
			if ( x < 0.0 ) {
				a = -a;
			}
			return a;
		}
		a = lib$11( a );
		a = (0.5*a) - (0.5/a);
		if ( x < 0.0 ) {
			a = -a;
		}
		return a;
	}
	a *= a;
	return x + ( x*a*rational_pq$1( a ) );
}
var sinh_1 = sinh;

var lib$19 = sinh_1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$e( x ) {
	if ( x === 0.0 ) {
		return 0.13333333333320124;
	}
	return 0.13333333333320124 + (x * (0.021869488294859542 + (x * (0.0035920791075913124 + (x * (0.0005880412408202641 + (x * (0.00007817944429395571 + (x * -0.000018558637485527546)))))))));
}
var polyval_t_odd = evalpoly$e;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalpoly$f( x ) {
	if ( x === 0.0 ) {
		return 0.05396825397622605;
	}
	return 0.05396825397622605 + (x * (0.0088632398235993 + (x * (0.0014562094543252903 + (x * (0.0002464631348184699 + (x * (0.00007140724913826082 + (x * 0.00002590730518636337)))))))));
}
var polyval_t_even = evalpoly$f;

var PIO4 = 7.85398163397448278999e-01;
var PIO4LO = 3.06161699786838301793e-17;
var T0 = 3.33333333333334091986e-01;
var HIGH_WORD_ABS_MASK$1 = 0x7fffffff|0;
function kernelTan( x, y, k ) {
	var hx;
	var ix;
	var a;
	var r;
	var s;
	var t;
	var v;
	var w;
	var z;
	hx = lib$p( x );
	ix = (hx & HIGH_WORD_ABS_MASK$1)|0;
	if ( ix >= 0x3FE59428 ) {
		if ( x < 0 ) {
			x = -x;
			y = -y;
		}
		z = PIO4 - x;
		w = PIO4LO - y;
		x = z + w;
		y = 0.0;
	}
	z = x * x;
	w = z * z;
	r = polyval_t_odd( w );
	v = z * polyval_t_even( w );
	s = z * x;
	r = y + (z * ((s * (r + v)) + y));
	r += T0 * s;
	w = x + r;
	if ( ix >= 0x3FE59428 ) {
		v = k;
		return ( 1.0 - ( (hx >> 30) & 2 ) ) * ( v - (2.0 * (x - ((w * w / (w + v)) - r)) ));
	}
	if ( k === 1 ) {
		return w;
	}
	z = w;
	lib$15( z, 0 );
	v = r - (z - x);
	a = -1.0 / w;
	t = a;
	lib$15( t, 0 );
	s = 1.0 + (t * z);
	return t + (a * (s + (t * v)));
}
var kernel_tan = kernelTan;

var lib$1a = kernel_tan;

var buffer$1 = [ 0.0, 0.0 ];
var HIGH_WORD_ABS_MASK$2 = 0x7fffffff|0;
var HIGH_WORD_PIO4$1 = 0x3fe921fb|0;
var HIGH_WORD_EXPONENT_MASK$1 = 0x7ff00000|0;
var HIGH_WORD_TWO_NEG_27$1 = 0x3e400000|0;
function tan( x ) {
	var ix;
	var n;
	ix = lib$p( x );
	ix &= HIGH_WORD_ABS_MASK$2;
	if ( ix <= HIGH_WORD_PIO4$1 ) {
		if ( ix < HIGH_WORD_TWO_NEG_27$1 ) {
			return x;
		}
		return lib$1a( x, 0.0, 1 );
	}
	if ( ix >= HIGH_WORD_EXPONENT_MASK$1 ) {
		return NaN;
	}
	n = lib$Z( x, buffer$1 );
	return lib$1a( buffer$1[ 0 ], buffer$1[ 1 ], 1-((n&1)<<1) );
}
var tan_1 = tan;

var lib$1b = tan_1;

/**
* @license Apache-2.0
*
* Copyright (c) 2018 The Stdlib Authors.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
function evalrational$3( x ) {
	var ax;
	var s1;
	var s2;
	if ( x === 0.0 ) {
		return -0.3333333333333332;
	}
	if ( x < 0.0 ) {
		ax = -x;
	} else {
		ax = x;
	}
	if ( ax <= 1.0 ) {
		s1 = -1614.6876844170845 + (x * (-99.28772310019185 + (x * (-0.9643991794250523 + (x * 0.0)))));
		s2 = 4844.063053251255 + (x * (2235.4883906010045 + (x * (112.81167849163293 + (x * 1.0)))));
	} else {
		x = 1.0 / x;
		s1 = 0.0 + (x * (-0.9643991794250523 + (x * (-99.28772310019185 + (x * -1614.6876844170845)))));
		s2 = 1.0 + (x * (112.81167849163293 + (x * (2235.4883906010045 + (x * 4844.063053251255)))));
	}
	return s1 / s2;
}
var rational_pq$2 = evalrational$3;

var MAXLOG$1 = 8.8029691931113054295988e+01;
function tanh( x ) {
	var s;
	var z;
	z = lib$T( x );
	if ( z > 0.5*MAXLOG$1 ) {
		return ( x < 0.0 ) ? -1.0 : 1.0;
	}
	if ( z >= 0.625 ) {
		s = lib$11( 2.0 * z );
		z = 1.0 - ( 2.0/(s+1.0) );
		if ( x < 0.0 ) {
			z = -z;
		}
	} else {
		if ( x === 0.0 ) {
			return x;
		}
		s = x * x;
		z = x + ( x*s*rational_pq$2( s ) );
	}
	return z;
}
var tanh_1 = tanh;

var lib$1c = tanh_1;

if (typeof window.CroquetMath === "undefined") window.CroquetMath = {};
Object.assign(window.CroquetMath, { acos: lib$4, acosh: lib$y, asin: lib$3, asinh: lib$A, atan: lib$C, atanh: lib$D, atan2: lib$J, cbrt: lib$L, cos: lib$_, cosh: lib$12, exp: lib$11, expm1: lib$14, log: lib$x, log1p: lib$v, log10: lib$16, log2: lib$17, sin: lib$18, sinh: lib$19, tan: lib$1b, tanh: lib$1c });
const mathPow = Math.pow;
function isInfinite$1(x) { return x === Infinity || x === -Infinity; }
function isInteger(x) { return Number.isInteger(x); }
window.CroquetMath.pow = (x, y) => {
    if (isNaN(x) || isNaN(y)) return NaN;
    if (isInfinite$1(x) || isInfinite$1(y)) return mathPow(x, y);
    if (x === 0 || y === 0) return mathPow(x, y);
    if (x < 0 && !isInteger(y)) return NaN;
    if (y === 1) return x;
    if (y === 2) return x*x;
    if (y === 3) return x*x*x;
    if (y === 4) return x*x*x*x;
    let signResult = 1;
    if (x < 0) {
        x *= -1;
        signResult = mathPow(-1, y);
    }
    const absPow = window.CroquetMath.exp(window.CroquetMath.log(x) * y);
    return absPow * signResult;
    };
