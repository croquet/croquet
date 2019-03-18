function toFunc(valOrFunc, bindThis) {
  if (typeof valOrFunc !== 'function') {
    return Array.isArray(valOrFunc)
      ? function(emit) {
      return valOrFunc.some(emit);
    } : function(emit) {
      return emit(valOrFunc);
    };
  }
  if (bindThis) {
    return function(emit, value) {
      valOrFunc.call(bindThis, emit, value);
    }
  }
  return valOrFunc;
}

function Per(valOrFunc, bindThis) {
  this.forEach = toFunc(valOrFunc, bindThis);
}

function blank(emit, value) {
  emit(value);
}

function create(valOrFunc, bindThis) {
  if (arguments.length === 0) {
    return new Per(blank);
  }
  if (valOrFunc && valOrFunc instanceof Per) {
    return valOrFunc;
  }
  return new Per(valOrFunc, bindThis)
}

Per.prototype.per = function(valOrFunc, bindThis) {
  var first = this.forEach;
  var second = toFunc(valOrFunc && valOrFunc.forEach || valOrFunc, bindThis);
  return create(function(emit, value) {
    return first(function(firstVal) {
      return second(emit, firstVal);
    }, value);
  });
};

function lambda(expression) {
  return typeof expression === 'string'
    ? new Function('x', 'return ' + expression)
    : expression;
}

Per.prototype.map = function(mapFunc) {
  mapFunc = lambda(mapFunc);
  return this.per(function(emit, value) {
    return emit(mapFunc(value));
  });
};

Per.prototype.filter = function(predicate) {
  predicate = lambda(predicate);
  return this.per(function(emit, value) {
    if (predicate(value)) {
      return emit(value);
    }
  });
};

Per.prototype.concat = function(second, secondThis) {
  if (second instanceof Per) {
    second = second.forEach;
  } else {
    second = toFunc(second, secondThis);
  }
  var first = this.forEach;
  return create(function(emit, value) {
    first(emit, value);
    second(emit, value);
  });
};

Per.prototype.skip = function(count) {
  return this.per(function(emit, value) {
    if (count > 0) {
      count--;
      return false;
    }
    return emit(value);
  });
};

Per.prototype.take = function(count) {
  return this.per(function(emit, value) {
    if (count <= 0) {
      return true;
    }
    count--;
    return emit(value);
  });
};

Per.prototype.listen = function(untilFunc) {
  return this.per(function(emit, value) {
    if (untilFunc(value)) {
      return true;
    }
    return emit(value);
  });
};

Per.prototype.flatten = function() {
  return this.per(function(emit, array) {
    return !Array.isArray(array)
      ? emit(array)
      : array.some(function(value) {
      return emit(value);
    });
  });
};

Per.prototype.reduce = function(reducer, seed) {
  var result = seed, started = arguments.length == 2;
  return this.per(function(emit, value) {
    result = started ? reducer(result, value) : value;
    emit(result);
    started = true;
  });
};

Per.prototype.multicast = function(destinations) {
  if (arguments.length !== 1) {
    destinations = Array.prototype.slice.call(arguments, 0);
  }
  destinations = destinations.map(function(destination) {
    return typeof destination === 'function' ? destination :
    destination instanceof Per ? destination.forEach :
    ignore;
  });
  return this.listen(function(value) {
    var quit = true;
    destinations.forEach(function(destination) {
      if (!destination(ignore, value)) {
        quit = false;
      }
    });
    return quit;
  });
};

function optionalLimit(limit) {
  return typeof limit != 'number' ? Number.MAX_VALUE : limit;
}

/*  A passive observer - gathers results into the specified array, but
otherwise has no effect on the stream of values
*/
Per.prototype.into = function(ar, limit) {
  if (!Array.isArray(ar)) {
    throw new Error("into expects an array");
  }
  limit = optionalLimit(limit);
  return this.listen(function(value) {
    if (limit <= 0) {
      return true;
    }
    ar.push(value);
    limit--;
  });
};

function setOrCall(obj, name) {
  var prop = obj[name];
  if (typeof prop === 'function') {
    return prop;
  }
  return function(val) {
    obj[name] = val;
  }
}

/*  Tracks first, last and count for the values as they go past,
up to an optional limit (see 'first' and 'last' methods).
*/
Per.prototype.monitor = function(data) {
  var n = 0;
  var count = setOrCall(data, 'count'),
      first = setOrCall(data, 'first'),
      last = setOrCall(data, 'last'),
      limit = data.limit;
  if (typeof limit != 'number') {
    limit = Number.MAX_VALUE;
  }
  if (limit < 1) {
    return this;
  }
  return this.listen(function(value) {
    if (n === 0) {
      first(value);
    }
    n++;
    count(n);
    last(value);
    if (n >= limit) {
      return true;
    }
  });
};

/*  Send a value into the pipeline without caring what emerges
(only useful if you set up monitors and/or intos, or
similar stateful observers).
*/
function ignore() { }
Per.prototype.submit = function(value) {
  return this.forEach(ignore, value);
};

Per.prototype.all = function() {
  var results = [];
  this.into(results).submit();
  return results;
};

Per.prototype.first = function() {
  var results = { limit: 1 };
  this.monitor(results).submit();
  return results.count > 0 ? results.first : (void 0);
};

Per.prototype.last = function() {
  var results = {};
  this.monitor(results).submit();
  return results.count > 0 ? results.last : (void 0);
};

function truthy(value) { return !!value; }
Per.prototype.truthy = function() { return this.filter(truthy); };

function min(l, r) { return Math.min(l, r); }
Per.prototype.min = function() { return this.reduce(min, Number.MAX_VALUE); };

function max(l, r) { return Math.max(l, r); }
Per.prototype.max = function() { return this.reduce(max, Number.MIN_VALUE); };

function sum(l, r) { return l + r }
Per.prototype.sum = function() { return this.reduce(sum, 0); };

function and(l, r) { return !!(l && r) }
Per.prototype.and = function() { return this.reduce(and, true); };

function or(l, r) { return !!(l || r) }
Per.prototype.or = function() { return this.reduce(or, false); };

function not(v) { return !v }
Per.prototype.not = function() { return this.map(not); };

create.pulse = function(ms) {
  var counter = 0;
  return create(function(emit) {
    function step() {
      if (emit(counter++) !== true) {
        setTimeout(step, ms);
      }
    }
    step();
  });
};

export default create;
