# Persistence (as of Croquet 1.0.5)

You may have noticed that while Croquet automatically snapshots and
stores all model data, whenever you change some model code, the model
is initialized from scratch and old application data is lost. This is
because a Croquet session is identified by the combination of
application ID (`appId`), the session name (`name`), and the content
of the model code (as a hashed value) along with the Croquet Library
version. This means that replicated computation will use the identical
code, but also means that even a small change in code creates a new
session, even when the same `appId` and `name` ar specified in
`Session.join()`.

Imagine if you are writing a collaborative shape editor or text editor
to which you will have to fix bugs and add new features over time. You
certainly would wish to keep user-generated contents in this
scenario. In other words, you would like to *persist* the application
data.

Croquet provide a mechanism to support this. This mechanism allows you
to specify what data to save as the essential part of the application
data from the old version of application, and load it into a new
version of application. In addition to the sessionId described above,
Croquet uses a derived ID callled `persistentId`, which is a
combination of `appId` and the session `name`, to identify an
application session independent of code changes.

When a session is joined for the first time (a session with a
never-seen-before sessionId), the root model's `init` function is
called. If persisted data created from a previous session of the same
persistentId, the data is passed into `init` as second argument.

An application specifies when and what ot be saved as persistent data
by calling `persistSession()` method with a function that returns the
data to be saved.

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
                const data = { /* collect data to persist */ };
                return data;
            });
        }
    }

It is importatant to know that `persistSession()` uses a stable JSON
stringification implementation to store data. If you use your own
stringification and return the string from the function passed to
`persisteSession()`, make sure that you use an implementation that is
stable when it is run on different platforms or JS runtime. Also note
that Maps are not handled by the `persisteSession()` directly. If you
use Maps in your model data structrue, you need to handle them by
yourself. Examples of this is available the Virtual DOM framework.

For a more complex app, code below shows one way to structure your
code. Note that the only actual Croquet APIs used here are
`persistSession()`, and finding the root model via `wellKnownModel()`.
How the saved data is structured and interpreted is completely up to
the app/framework, and all the methods with "save" in their names are
unknown to Croquet.

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
        fromSaveData(persisted) {
            switch (persisted.version) {
                case 1:
                    const documents = persisted.documents;
                    this.submodelA = SubModel.create(subopts, documents.a);
                    this.submodelB = SubModel.create(subopts, documents.b);
                    break;
                default:
                    /* ... */
            }
        }
    }

# Best Practices

Below is some best practices we learned from our experiences. You can find code examples in various apps provided by Croquet Corporation.

## When to think about adding the persistnce to your app?
If your application does not need to save long-lasting data (for example, a simple real time multi-player game), then there is no need to persist any data. But once, for example, you want to add a high scroe feature to entice users, chances are that you want to keep the score over different versions of code (your next code change may be a simple bug fix). Note that you *cannot* add the call to persistnce mechansim as an aferthought to a session that already has model data you wish to save, as adding the call changes the model code and thus Croquet treats it as a new session. So  when you add a new model property for a new feature, it is good to ask yourself if you will have to persist it.

## When to call `persistData`?
Once you determine that your application needs to persist data, you need to consider when is the right time to save it. Unlike automatic snapshotting, the application is responsible to decide when call `persistData()`. It is vital to save your important data while keeping the overhead of network and computation low. A common strategy is to trigger 'persistData()` for a *major* data change in the model. For example, adding or deleting a graphical object in the shape editor would be major while movements of a shared cursor is not. Another common strategy is to trigger it on a timer that is started when there are some data updates. In a text editor app, it may be overkill to store persistent data for every keystroke from any user, but you might also like to save persistent data 30 seconds after a burst of edit activity.

## How to test and debug
For testing and debugging purposes, it is important to recall how the persistent mechanism works. That is, *when* a 'never-seen-before sessionId` is encountered, *then* the reflector looks up the persistent data for the persistentId and passes it to Model's `init()` if it is available.

An implication of this is that if your test version of app had a bug and had written an invalid persistent data for a `persistentId`, fixing code afterwards could be too late, as critical user contents could lost already if you cannot find the right combination of code that produces the same sessionId. It is good to safegurding against this:

To do so, you write `init()` as follows:

    init(options, persisted) {
        // ...
        if (persisted) {
         delete this.loadingPersistentDataErrored;
         this.loadingPersistentData = true;
         try {
             this.fromSavedData(persisted);
         } catch (error) {
             console.error("error in loading persistent data", error);
             this.loadingPersistentDataErrored = true;
         } finally {
             delete this.loadingPersistentData;
         }
      }
    }

    save() {
        if (this.loadingPersistentData) {return;}
        if (this.loadingPersistentDataErrored) {return;}
	/* actually call persistData()
    }

where `fromSavedData()` interprets the incoming `persisted` data and sets up the data structure in the model. If that method raises an error, `loadingPersistentDataErrored` property becomes true so that `save()` can skip the call to `persistData()`. The `loadingPersistentData` property above is set to be true during the execution of `fromSavedData()`. It is often the case that the same setter method of the application is used by `fromSavedData()` (i.e., a shape editor may have a method called `addShape(data)`, which may be called during the normal interaction, as well as  by `fromSavedData()` to recreate those shapes from saved data.

You may also encounter the case that your `save()` has a bug and raises an error. This usually is not a problem. If you relaunch the application with your old code (with the same `appId`, `name`, and the same Croquet library version), the reflector will find the snapshot (not persistent data) to start the session. In this case, the user content is not lost.

WHile developing the persitent data mechanism for your app, a common worksflow is as follows:

1. Put a break point in the `toSaveData()` method, and trigger it by a view message.
2. Check the object it returns and make sure that it is structured as you expect. Repeat this step until you are satisfied.
3. If you think it is creating the right object to be saved, let your code run through to get the data to be stored.
4. Modify the model code just a little bit (it could be a change to a `console.log()` call in the model), and relaunch your application with a break point set in  `fromSavedData()`.
5. If loading fails due to a bug, fix it. You might have to go back to step 2 to fix the saving part also.
6. If it appears to load the correct data, try to trigger the persistent data saving logic from the loaded session. this often uncovers some bugs.

If you follow the above code pattern that skips a new persistent data store when it errored, you can start a debugging session with identical persistent data so it is easier to see that you are making a progress.

It is handy to have two deployment of the same application. You would keep your old and working version of application, from which you can create new persistent data. You update the other deployment (could be on your local machine) to try to load the data.

## Debug Options
To log more useful info to the console, you can specify the debug: "session" option in `Session.join()`, or specifiy the equivalent URL options (`debug=session`). You see additional messages when this debug option is specified.

## Consideration for End-to-End Encryption
Because the persistent data is also encrypted, nobody, including the Croquet Corporation, cannot read the content of the data, unless the session password is known...(But there should be more to say about this)


TODO:
* end-to-end encryption of persisted data
