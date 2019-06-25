Copyright © 2019 Croquet Studios

This is an example of how to keep track of different users within the same session. It's a simple chat application that maintains a list of all users who are connected to the session and posts a notification whenever someone joins or leaves. New users are assigned a random nickname.

<p class="codepen" data-height="512" data-theme-id="37190" data-default-tab="js,result" data-user="croquet" data-slug-hash="NZjLzO" data-editable="true" style="height: 512px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 2px solid; margin: 1em 0; padding: 1em;" data-pen-title="Chat">
  <span>See the Pen <a href="https://codepen.io/croquet/pen/NZjLzO/">
  Chat</a> by Croquet (<a href="https://codepen.io/croquet">@croquet</a>)
  on <a href="https://codepen.io">CodePen</a>.</span>
</p>
<script async src="https://static.codepen.io/assets/embed/ei.js"></script>

## **Try it out!**
The first thing to do is click or scan the QR code above. This will launch a new Codepen instance of this session. Typing a message in either window will post the text to the shared chat screen under a randomly assigned nickname. Other people who are reading this documentation right now can also post messages to the same conversation, so you might find yourself talking to another Croquet developer!

There are four things we will learn here:

1. How to use the `"client-enter"` and `"client-exit"` events to keep track of users.
2. How to directly access the model from the view without breaking synchronization.
3. How to use the view's user Id to get user-specific information out of the model.
4. How to use the replicated `random()` function in the model.

## Simple Chat Model

Our Croquet application uses a single Model subclass named `ChatModel`. It does two things: It listens for `"newPost"` events coming from a view, and it listens for `"user-enter"` and `"user-exit"` events coming from the reflector itself.

A `"newPost"` event is sent by the view when the user enters a message. The event is reflected to all clients in the session. Each client's model adds it to its chat history, and informs its local view to update its display.

The `"client-enter"` and `"client-exit"` are system-generated events. They don't originate inside your application. They come from the Teatime system itself. When a new client joins a session, a `"client-enter"` event is sent to everyone in the session (including the client who just joined). Similiarly, whenever a client leaves, a `"client-exit"` event is sent. (The client who just left will not get this event because they are already gone!)

## ChatModel.init()

  ```
  init() {
    this.users = new Map();
    this.history = [];
    this.subscribe("input", "newPost", post => this.onNewPost(post));
    this.subscribe(this.sessionId, "user-enter", userId => this.userEnter(userId));
    this.subscribe(this.sessionId, "user-exit", userId => this.userExit(userId));
  }
  ```

`users` is a list of users stored in a map. (A map is a standard JavaScript data structure that holds key-data pairs.) The user list holds a list of user names indexed by unique user IDs.

`history` is an array of chat messages.
```
this.subscribe("input", "newPost", post => this.onNewPost(post));
```

This is the subscription to handle new chat posts. It's given the scope "input" as a way to remind us where the event is coming from. (It also means we could use `newPost` as a different event somewhere else in our application without the two events being confused with each other.)
```
this.subscribe(this.sessionId, "user-enter", userId => this.userEnter(userId));
this.subscribe(this.sessionId, "user-exit", userId => this.userExit(userId));
```
This is the subscription to handle clients entering or leaving. In both cases the scope is set to `this.sessionId` which is the default scope for all system-generated events. The data passed to both events is a `userId`. It is a unique identifier for each client in the session. Even if the same user joins the session from multiple browser windows or devices, the `userId` will always be different.

## ChatModel.userEnter(userId)
```
  userEnter(userId) {
    const userName = this.randomName();
    this.users.set(userId, userName);
    this.publish("userInfo", "update");
  }
```
When a new user enters, the model generates a random nickname and stores it in the user list. It then publishes an event to the view informing it that the user list has changed. (In this case we're using "userInfo" as our scope. This allows us to use a generic word like "update" as our event.)

## ChatModel.userExit(userId)
```
  userExit(userId) {
    const userName = this.users.get(userId);
    this.users.delete(userId);
    this.publish("userInfo", "update");
  }
```
When a user exits, the model removes its entry from the client list, and publishes the same upate event to the view.

## ChatModel.onNewPost(post)


  onNewPost(post) {
    const userName = this.users.get(post.userId);
    this.addToHistory(`<b>${userName}:</b> ${this.escape(post.text)}`);
  }

  addToHistory(item){
    this.history.push(item);
    if (this.history.length > 100) this.history.shift();
    this.publish("history", "update");
  }

New posts are tagged with the sender's `clientId`. When the model receives a new post, it uses this ID to look up the client's nickname from the client list. It then builds a chat line that includes the sender's nickname and their message and adds it to the chat history. If there are more that 100 entries in the history, it discards the oldest entry to prevent the history from growing too large.

It then publishes an event to the view informing it that the history has changed. (Note that using "history" as our scope, we can use the "update" event for a different purpose.

## ChatModel.randomName()

  ```
  randomName() {
    const names =["Acorn" ..."Zucchini"];
    return names[Math.floor(Math.random() * names.length)];
  })
  ```

When a new client joins, its nickname is picked at a random from an array. This code is running in parallel on all clients. However, since it's executing in the model, each client will "randomly" pick the same name.

Calls to `Math.random()` inside the model are deterministic. They will return exactly the same random number in every instance of the model, insuring that all the copies of the model are always in synch.






_Maybe we should call this `clientId`? It's not actually about users_

TODO:
* talk about user names? the island tracks them but there is no API yet - the model could provide something like `getUserName(userId)`
* mention [this.user]{@link View#user} (or [this.clientId]{@link View#clientId}) and how to connect from view to an avatar inside the model? Or is that another tutorial?
* explain how the [random()]{@link Model#random} call is executed independently on each client but has the exact same result
