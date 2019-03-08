import { defaultFormatting } from './runs.js';


var nbsp = String.fromCharCode(160);
var enter = nbsp; // String.fromCharCode(9166);
var cachedMeasureText = createCachedMeasureText();
var externalMeasurementFunc;

export {
  enter, nbsp, cachedMeasureText,

  getFontString,
  applyRunStyle,
  prepareContext,
  getRunStyle,
  createCachedMeasureText, 
  measureText,
  measure, draw,
  setCachedMeasureText
}

function setCachedMeasureText(func) {
    cachedMeasureText = createCachedMeasureText();
    externalMeasurementFunc = func;
}

// Returns a font CSS/Canvas string based on the settings in a run
function getFontString(run) {
  var size = (run && run.size) || defaultFormatting.size;

  if (run) {
    switch (run.script) {
      case 'super':
      case 'sub':
        size *= 0.8;
        break;
    }
  }

  return (run && run.italic ? 'italic ' : '') +
    (run && run.bold ? 'bold ' : '') + ' ' +
    size + 'pt ' +
    ((run && run.font) || defaultFormatting.font);
}

/*  Applies the style of a run to the canvas context
*/
function applyRunStyle(ctx, run) {
  ctx.fillStyle = (run && run.color) || defaultFormatting.color;
  ctx.font = getFontString(run);
}

function prepareContext(ctx) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/* Generates the value for a CSS style attribute
*/
function getRunStyle(run) {
  var parts = [
    'font: ', getFontString(run),
    '; color: ', ((run && run.color) || defaultFormatting.color)
  ];

  if (run) {
    switch (run.script) {
      case 'super':
        parts.push('; vertical-align: super');
        break;
      case 'sub':
        parts.push('; vertical-align: sub');
        break;
    }
  }

  return parts.join('');
}


/*  Returns width, height, ascent, descent in pixels for the specified text and font.
The ascent and descent are measured from the baseline. Note that we add/remove
all the DOM elements used for a measurement each time - this is not a significant
part of the cost, and if we left the hidden measuring node in the DOM then it
would affect the dimensions of the whole page.
*/
function measureText(text, style) {
  var span, block, div;

  span = document.createElement('span');
  block = document.createElement('div');
  div = document.createElement('div');

  block.style.display = 'inline-block';
  block.style.width = '1px';
  block.style.height = '0';

  div.style.visibility = 'hidden';
  div.style.position = 'absolute';
  div.style.top = '0';
  div.style.left = '0';
  div.style.width = '500px';
  div.style.height = '200px';

  div.appendChild(span);
  div.appendChild(block);
  document.body.appendChild(div);
  try {
    span.setAttribute('style', style);

    span.innerHTML = '';
    span.appendChild(document.createTextNode(text.replace(/\s/g, nbsp)));

    var result = {};
    block.style.verticalAlign = 'baseline';
    result.ascent = (block.offsetTop - span.offsetTop);
    block.style.verticalAlign = 'bottom';
    result.height = (block.offsetTop - span.offsetTop);
    result.descent = result.height - result.ascent;
    result.width = span.offsetWidth;
  } finally {
    div.parentNode.removeChild(div);
    div = null;
  }
  return result;
}

/*  Create a function that works like measureText except it caches every result for every
unique combination of (text, style) - that is, it memoizes measureText.

So for example:

var measure = cachedMeasureText();

Then you can repeatedly do lots of separate calls to measure, e.g.:

var m = measure('Hello, world', 'font: 12pt Arial');
console.log(m.ascent, m.descent, m.width);

A cache may grow without limit if the text varies a lot. However, during normal interactive
editing the growth rate will be slow. If memory consumption becomes a problem, the cache
can be occasionally discarded, although of course this will cause a slow down as the cache
has to build up again (text measuring is by far the most costly operation we have to do).
*/
function createCachedMeasureText() {
  var cache = {};
  return function(text, formatting) {
    if (externalMeasurementFunc) {
	return externalMeasurementFunc(text, formatting);
    }
    var style = getRunStyle(formatting);
    var key = style + '<>!&%' + text;
    var result = cache[key];
    if (!result) {
      cache[key] = result = measureText(text, style);
    }
    return result;
  };
}

function measure(str, formatting) {
  return cachedMeasureText(str, formatting)
}

function draw(ctx, str, formatting, left, baseline, width, ascent, descent) {
  prepareContext(ctx);
  applyRunStyle(ctx, formatting);
  switch (formatting.script) {
    case 'super':
      baseline -= (ascent * (1/3));
      break;
    case 'sub':
      baseline += (descent / 2);
      break;
  }
  ctx.fillText(str === '\n' ? enter : str, left, baseline);
  if (formatting.underline) {
    ctx.fillRect(left, 1 + baseline, width, 1);
  }
  if (formatting.strikeout) {
    ctx.fillRect(left, 1 + baseline - (ascent/2), width, 1);
  }
}
