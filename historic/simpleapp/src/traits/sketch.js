// Symbols to store "metadata" of a trait, as not to conflict with the
// trait's internal mapping from straight property names to symbol property names
// (See Trait constructor for more info)
const traitNameProp = Symbol("traitName");
const traitSpecProp = Symbol("traitSpec");
const traitPrerequisiteTraitsProp = Symbol("prerequisiteTraits");
const requiredMarker = Symbol("required");
const implementedTraitsProp = Symbol("implementedTraits");

// Helper for cleanly transferring properties between objects, including getters/setters
function transferProperties(target, src, propNameMapFn) {
    for (let propertyName of Object.getOwnPropertyNames(src)) {
        const propertyDescriptor = Object.getOwnPropertyDescriptor(src, propertyName);
        const targetPropertyName = propNameMapFn(propertyName);
        Object.defineProperty(target, targetPropertyName, propertyDescriptor);
    }
}

class Trait {
    /** Create a new trait.
     * @arg {String} name Human-readable trait name
     * @arg {{}} spec Object containing fields and methods that are either set to `Trait.required` or contain a default/provided implementation
     * @arg {[any]} prerequisiteTraits List of other Traits that need to be implemented as a prerequisite when implementing this trait. */
    constructor(name, spec, prerequisiteTraits=[]) {
        this[traitSpecProp] = spec;
        this[traitNameProp] = Symbol(name);
        this[traitPrerequisiteTraitsProp] = prerequisiteTraits;

        // Creates a mapping from plain property names, as used in `spec` to unique Symbols
        // (that can be retreived from the trait object), as a means of conflict-avoidance.
        // So, for example, if you define a method `size` in a Trait spec for a `Sized` trait,
        // it will be accessible as `this[Sized.size]()` from within methods.
        for (let propertyName of Object.keys(spec)) {
            this[propertyName] = Symbol(name + "#" + propertyName);
        }
    }

    /** Implements this trait for a given class
     * @arg aClass the class to implement this trait on, will have its `prototype` extended
     * @arg impl object containing at least the required properties of this trait's spec. Can also override provided properties from the spec.
     * @throws if not all required properties from the spec are implemented, or `aClass` doesn't already implement this trait's prerequisite traits.
    */
    implementFor(aClass, impl) {
        const missingImplementedTraits = this[traitPrerequisiteTraitsProp].filter(requiredTrait => {
            return !aClass.prototype[implementedTraitsProp] || !aClass.prototype[implementedTraitsProp].includes(requiredTrait[traitNameProp]);
        });

        if (missingImplementedTraits.length > 0) {
            throw Error(this[traitNameProp].toString().slice(7, -1) + " requires traits " + missingImplementedTraits.map(tr => tr[traitNameProp].toString().slice(7, -1)).join(", ") + " to be implemented.");
        }

        const applied = {};
        transferProperties(applied, this[traitSpecProp], p => p);
        transferProperties(applied, impl, p => p);

        const missingRequiredFields = Object.getOwnPropertyNames(applied)
            .filter(propName => Object.getOwnPropertyDescriptor(applied, propName).value === requiredMarker);

        if (missingRequiredFields.length > 0) {
            throw Error(this[traitNameProp].toString().slice(7, -1) + " requires fields " + missingRequiredFields.join(", ") + " which were not implemented.");
        }

        transferProperties(aClass.prototype, applied, propName => this[propName]);
        if (!aClass.prototype[implementedTraitsProp]) aClass.prototype[implementedTraitsProp] = [];
        aClass.prototype[implementedTraitsProp].push(this[traitNameProp]);
    }
}

Trait.required = requiredMarker;

// EXAMPLE

const Duck = new Trait("Duck", {
    // required
    walk: Trait.required,
    talk: Trait.required,
    // provided (can make use of required properties)
    walkAndTalk() {
        this[Duck.walk]();
        this[Duck.talk]();
    }
});

class Child {
    constructor() {
        this.position = 0;
        this.armAngle = 0;
    }

    run(speed) {
        console.log("(running from " + this.position + " to " + (this.position + speed) + ")");
        this.position += speed;
    }

    shout(targetUtterance) {
        console.log(targetUtterance);
    }

    flailArms(vigorousity) {
        this.armAngle = Math.random() * vigorousity;
    }
}

Duck.implementFor(Child, {
    walk() {
        this.run(0.1);
    },

    talk() {
        this.shout("Quack!!");
    }
});

const timmy = new Child();

console.log("Testing walkAndTalk");
timmy[Duck.walkAndTalk]();

const MigratingAnimal = new Trait("MigratingAnimal", {
    // An example for a required data property (not a method)
    location: Trait.required,

    migrate(distance) {
        console.log("Migration position before: " + this[MigratingAnimal.location]);
        this[MigratingAnimal.location] += distance;
        console.log("Migration position after: " + this[MigratingAnimal.location]);
    }
});

MigratingAnimal.implementFor(Child, {
    // implement the required property of `MigratingAnimal`
    // by providing getters and setters that forward to Child#position
    get location() {
        return this.position;
    },
    set location(newLocation) {
        this.position = newLocation;
    }
});

console.log("\nTesting migrate");
timmy[MigratingAnimal.migrate](0.5);

// Example for a trait that has prerequisite traits
// and can use methods provided by them
const FlyingDuck = new Trait("FlyingDuck", {
    flapWings: Trait.required,
    fly(distance) {
        this[FlyingDuck.flapWings]();
        this[Duck.talk]();
        this[MigratingAnimal.migrate](distance);
    }
}, [MigratingAnimal, Duck]);

FlyingDuck.implementFor(Child, {
    flapWings() {
        this.flailArms(10);
    }
});

console.log("\nTesting fly");
timmy[FlyingDuck.fly](100);

// console.log("\nProperties of Child prototype:");
// console.log(Object.getOwnPropertyDescriptors(Child.prototype));
