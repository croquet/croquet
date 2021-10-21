# Croquet 🦩

Croquet lets you build real-time multi-user webapps with only **front-end** code:

* can be hosted as a **static website**
* **no server-side** code needed
* **no networking** code needed
* independent of UI framework

You embed your shared code with the front-end code on your website. Instead of being executed on a server, it is executed simultaneously on each browser. Croquet keeps all those browsers in sync automatically, without you having to deploy anything. All you need is an API key to get access to Croquet's reflector network, which provide that synchronization service.

## Get Started

1.
       npm i @croquet/croquet

2. get a free API key at [croquet.io/keys](https://croquet.io/keys/)

3. follow the documentation at [croquet.io/docs](https://croquet.io/docs/croquet/)

## Example

Here is our Hello World example which fits on a postcard. You can see it running at [croquet.io/postcard21](https://croquet.io/postcard21/).

Look at the source code on that page! Everything is there.

This is the shared part that will be executed in sync on all browsers:

    class Counter extends Croquet.Model {
        init() {
            this.n = 0;
            this.subscribe("counter", "set", this.set);
            this.loop();
        }
        set(value) {
            this.n = value;
            this.publish("counter", "changed");
        }
        loop() {
            this.set(this.n + 0.1);
            this.future(100).loop();
        }
    }
    Counter.register("Counter");

The non-shared part talks to the local DOM:

    class Display extends Croquet.View {
        constructor(model) {
            super(model);
            this.model = model;
            this.changed();
            this.subscribe("counter", "changed", this.changed);
            button.onclick = () => this.publish("counter", "set", 0);
        }
        changed() {
            output.innerText = this.model.n.toFixed(1);
        }
    }

The rest is boiler-plate to show the QR code and join a session:

    Croquet.App.messages = true;
    Croquet.App.makeWidgetDock();

    Croquet.Session.join({
        apiKey: 'get your own from croquet.io/keys',
        appId: 'io.croquet.postcard21.counter',
        name: Croquet.App.autoSession(),
        password: Croquet.App.autoPassword(),
        model: Counter,
        view: Display,
    });

That's it!

Croquet picks the reflector with the lowest latency from its global edge reflector fleet for each session, it sends a timing signal to keep all clients in a session synchronized, it distributes pub/sub events to every client, it automatically snapshots and stores the shared model state (securely encrypting it with the session password), it lets new clients join an ongoing session by sending them the latest snapshot, it detects and automatically resumes broken network connections, etc. All without you having to implement or deploy or maintain or scale any servers.

In other words, Croquet takes care of all the things that are not essential to the logic of your multi-user app, so you have more brain cycles left to work on your app. Which as we all know is hard enough, compared to single-user apps.

Happy collaborating!

The Croquet 🦩 Team
