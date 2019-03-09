export function isAttached(element) {
  var ancestor = element;
  while(ancestor.parentNode) {
    ancestor = ancestor.parentNode;
  }
  return !!ancestor.body;
};

export function clear(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
};

export function setText(element, text) {
  clear(element);
  element.appendChild(document.createTextNode(text));
};

export function handleEvent(element, name, handler) {
  element.addEventListener(name, function(ev) {
    if (handler(ev) === false) {
      ev.preventDefault();
    }
  });
};

export function handleMouseEvent(element, name, handler) {
  handleEvent(element, name, function(ev) {
    var rect = element.getBoundingClientRect();
    return handler(ev, ev.clientX - rect.left, ev.clientY - rect.top);
  });
};

export function effectiveStyle(element, name) {
  return document.defaultView.getComputedStyle(element).getPropertyValue(name);
};
