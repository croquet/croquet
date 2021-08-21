# Persistence

You may have noticed that while a Croquet session automatically stores all model data,
whenever you change some model code, everything is lost and initialized from scratch.

To persist Croquet sessions across code changes, the app needs to
construct a JSON description of the model and pass it to
`persistSession()`.

When a session is joined for the first time, the root model's `init` function is
called. If persisted data exists for a previous session of the same name,
it is passed into `init` as second argument.

(Sidenote: Data is stored under a `persistentId` that is derived from the `appId`,
session `name`, and session `options`. The `persistentId` for
a session stays the same independent of code changes. In contrast,
the `sessionId` is derived from the `persistentId` but also the hash of model
code and the Croquet version. When the reflector encounters a never-seen-before
`sessionId`, it will pass the latest persisted data at that moment to the client.)

Most simple apps can use `persistSession()` directly in the root model:

    class SimpleAppRootModel {
        init(options, persisted) {
            /* regular setup */
    ​        ...
            if (persisted) {
                /* use persisted data */
                ...
            }
        }
    ​
        save() {
            this.persistSession(() => {
                const data = { /* collect data to persist - do NOT stringify! */ };
                return data;
            });
        }
    }

**Note that the app *should not* stringify the persisted data**, but pass an object
tree into `persistSession()`. That's because Croquet uses a "stable" stringification
algorithm that ensures the exact same file is produced by different clients. Note also
that unlike Croquet's automatic snapshotting, currently no additional data types but
those allowed by JSON are supported.

For a more complex app, the below is one way to structure the save code.
Note that the only actual Croquet APIs used here are `persistSession()`,
and finding the root model via `wellKnownModel()`.

How the saved data is structured and interpreted is completely up to the
app/framework, and all the methods with "save" in their names are unknown
to Croquet.

The persistent data should be as independent of the current
application structure as possible. In this example, the
persistent data uses "documents" whereas the app uses "submodels". Even
if all classes and properties were renamed in future versions, this
document structure should be simple to interpret and map to new code.

Note also that here we add a `version` property to the persisted data.
Again, this is not interpreted by Croquet in any way, but by the app's
`fromSaveData()` method. This is a forward-thinking way to allow changing
the persistence format later.

    class SubModel {
        init(options, persisted) {
            /* ... regular setup ... */
    ​
            if (persisted) this.fromSaveData(persisted);
        }
    ​
        save() { this.wellKnownModel("modelRoot").save(); }
    ​
        toSaveData() { return { /* ... some data ... */ };  }
    ​
        fromSaveData(data) { /* ... set up from data ... */ }
    }
    ​
    class ComplexAppRootModel {
        init(options, persisted) {
            if (persisted) {
                this.fromSaveData(persisted);
            } else {
                this.submodelA = SubModel.create(subopts);
                this.submodelB = SubModel.create(subopts);
            }
        }
    ​
        save() {
            this.persistSession(this.toSaveData);
        }
    ​
        toSaveData() {
            return {
                version: 1,
                documents: {
                    a: this.submodelA.toSaveData(),
                    b: this.submodelB.toSaveData(),
                }
            }
        }
    ​
        fromSaveData() {
            switch (persisted.version) {
                case 1:
                    const { documents } = persisted;
                    this.submodelA = SubModel.create(subopts, documents.a);
                    this.submodelB = SubModel.create(subopts, documents.b);
                    break;
                default:
                    /* ... */
            }
        }
    }

TODO:

* mention strategies for when to call `persistSession()`
