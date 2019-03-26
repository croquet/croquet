function _event() {
  var handlers = [];

  var subscribe = function(handler) {
    handlers.push(handler);
  };

  subscribe.fire = function() {
    var args = Array.prototype.slice.call(arguments, 0);
    handlers.forEach(function(handler) {
      handler.apply(null, args);
    });
  };

  return subscribe;
};

function derive(prototype, methods) {
  var properties = {};
  Object.keys(methods).forEach(function(name) {
    properties[name] = { value: methods[name] };
  });
  return Object.create(prototype, properties);
};

export { _event as event, derive };
