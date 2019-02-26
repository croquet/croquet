/** @template {ComponentOwner} T */
export default class Component {
    /**
     * @param {T} owner
     * @param {String} componentName
    */
    constructor(owner, componentName) {
        this.owner = owner;
        this.componentName = componentName;
        owner.addComponent(this);
    }
}

/** @template {Component} T */
export class ComponentOwner {
    constructor() {
        /** @type {{[string]: T}} */
        this.components = {};
    }

    /** @param {T} component */
    addComponent(component) {
        this.components[component.componentName] = component;
    }
}