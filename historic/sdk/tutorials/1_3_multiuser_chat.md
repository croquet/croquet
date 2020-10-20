Copyright © 2020 Croquet Corporation

This is an example of how to keep track of different users within the same session. It's a simple chat application that maintains a list of all currently connected users. New users are assigned a random nickname.

<p class="codepen" data-height="512" data-theme-id="37190" data-default-tab="result" data-user="croquet" data-slug-hash="NZjLzO" data-editable="true" style="height: 512px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 2px solid; margin: 1em 0; padding: 1em;" data-pen-title="Chat">
  <span>See the Pen <a href="https://codepen.io/croquet/pen/NZjLzO/">
  Chat</a> by Croquet (<a href="https://codepen.io/croquet">@croquet</a>)
  on <a href="https://codepen.io">CodePen</a>.</span>
</p>
<script async src="https://static.codepen.io/assets/embed/ei.js"></script>

## **Try it out!**
The first thing to do is click or scan the QR code above. This will launch a new Codepen instance of this session. Typing a message in either window will post the text to the shared chat screen under a randomly assigned nickname. Other people who are reading this documentation right now can also post messages to the same conversation, so you might find yourself talking to another Croquet developer!

There are five things we will learn here:

1. How to use `"view-join"` and `"view-exit"` events to track connections.
2. How to use the `viewId` to store view-specific information inside the model.
3. How to use the replicated `random()` function in the model.
4. How to directly read from the model without breaking synchronization.
5. How to use `modelOnly()` to prevent accidentally writing to the model.


## Simple Chat Model

  Our Croquet application uses a single Model subclass named `ChatModel`. It does two things: It listens for `"view-join"` and `"view-exit"` events coming from the reflector, and it listens for `"newPost"` events coming from the view.

  A `"newPost"` event is sent by a view when its user enters a chat message. The event is reflected to all models in the session. Each user's model adds it to its chat history, and informs its local view to update its display.

  `"view-join"` and `"view-exit"` are system-generated events. They don't originate inside your application. They come from the Teatime system itself. When a new user joins a session, a `"view-join"` event is sent to everyone in the session (including the user who just joined). Similiarly, whenever a user leaves, a `"view-exit"` event is sent. (The user who just left will not get this event because they are already gone!)

## ChatModel.init()

  ```
  this.views = new Map();
  ```

  `views` holds a list of nicknames indexed by unique view IDs (a map is a standard JavaScript data structure that holds key-data pairs).

  ```
  this.participants = 0;
  ```

  `participants` is the number of currently active views.

  ```
  this.history = [];
  ```

  `history` is an array of chat messages.

   ```
  this.subscribe(this.sessionId, "view-join", this.viewJoin);
  this.subscribe(this.sessionId, "view-exit", this.viewExit);
  ```

  These subscriptions handle users entering or leaving. In both cases the scope is set to `this.sessionId` which is the default scope for all system-generated events. The data passed to both events is a `viewId`, which is a unique identifier for each participant in the session.

  If a user's view leaves due to becoming inactive, then later re-enters (for example, if it is running on a phone that is put to sleep, then re-awakened), the `viewId` on re-entry will be the same as before.  On the other hand, if a user joins the session from multiple browser tabs even on the same device, the `viewId` for each tab will be different.

  **Inside your application you can use `viewID` as a unique identifier for each participant in a session.** You can store data about individual participants using `viewID` as the key. Or you can use `viewID` as the scope of an event to specify who sent it, or limit who receives it.

  ```
  this.subscribe("input", "newPost", this.newPost);
  ```

  This subscription handles new chat posts. It's given the scope "input" as a way to remind us where the event is coming from. (It also means we could use `"newPost"` as a different event somewhere else in our application without the two events being confused with each other.)


## ChatModel.viewJoin(viewId)
```
  viewJoin(viewId) {
    const existing = this.views.get(viewId);
    if (!existing) {
      const nickname = this.randomName();
      this.views.set(viewId, nickname);
    }
    this.participants++;
    this.publish("viewInfo", "refresh");
  }
  ```
  When a user joins the session, the model checks whether this `viewId` has already been seen.  If not, it generates a new random nickname and stores it in the view list using the `viewID` as the access key. It then increments the `participants` count and publishes an event that will trigger the view to refresh its display. (In this case we're using "viewInfo" as our scope. This allows us to use a generic word like "refresh" as our event.)

## ChatModel.viewExit(viewId)
  ```
    viewExit(viewId) {
      this.participants--;
      this.publish("viewInfo", "refresh");
    }
  ```
  When a user leaves the session, the model decrements the `participants` count and publishes the same update event.

## ChatModel.newPost(post)
```
  newPost(post) {
    const nickname = this.views.get(post.viewId);
    this.addToHistory(`<b>${nickname}:</b> ${this.escape(post.text)}`);
  }

  addToHistory(item){
    this.history.push(item);
    if (this.history.length > 100) this.history.shift();
    this.publish("history", "refresh");
  }
```
  New posts are tagged with the sender's `viewId`. When the model receives a new post, it uses this ID to look up the user's nickname. It then builds a chat line that includes the nickname and the message, and adds it to the chat history. If there are more than 100 entries in the history, it discards the oldest entry to prevent the array from growing too large.

  `newPost` then publishes an event to the view informing it that the history has changed. (Note that beause we use "history" as our scope, this refresh event won't interfere with the "viewInfo" refresh event.)

## ChatModel.randomName()

  ```
  randomName() {
    const names = ["Acorn" ..."Zucchini"];
    return names[Math.floor(Math.random() * names.length)];
  }
  ```

When a new user joins, their nickname is picked at a random from an array. Note that even though a separate instance of this code is running locally for each user, each of the instances will "randomly" pick the same name. This is because **calls to `Math.random()` from inside the model are deterministic**. They will generate exactly the same sequence of random numbers in every instance of the model, ensuring they all stay in synch.

## ChatView.constructor(model)

```
  this.model = model;
```

We store a reference to the model so that we can use it later to pull data directly.

(Note: This reference is only to the root model that was created during `Croquet.Session.join`. If your root model contains sub-models that you need to read from, you should store references to them inside the root model.)

```
  sendButton.onclick = () => this.send();
```
This is the event handler for the HTML "Send" button. It is called when the user clicks the button.

```
    this.subscribe("history", "refresh", this.refreshHistory);
    this.subscribe("viewInfo", "refresh", this.refreshViewInfo);
```
We subscribe to two different refresh events from the model. One is sent when a new chat message is added to the chat history, and the other is sent when someone joins or exits the session.

    this.refreshHistory();
    this.refreshViewInfo();

The final thing we do when the view starts is to pull the current history from the model and post it to the screen. We do this because when a user joins an existing chat session, there may already be a history of previous chat messages. We want to show this previous history right away instead of waiting for the next new message to refresh.

We need to do the same for refreshing the view info because the model will likely process our own view-join event before the view is constructed, meaning the view will not see the `viewInfo` event generated in response to our joining. Views should always set themselves up completely from the model state before relying on events being processed.

## ChatView.send()
  ```
  send() {
    const post = {viewId: this.viewId, text: textIn.value};
    this.publish("input", "newPost", post);
    textIn.value = "";
  }
  ```

When the user presses the send button, we build a `"newPost"` event to send to the model. The event contains our `viewId` (so the model knows who is posting) along with the text contents of the post.

**Any class that inherits from `View` has `this.viewId` as a member.** It contains the unique `viewId` that was assigned to this user when they joined the session. We can use `this.viewId` whenever we want to tell the model that a particular user has done something.

## ChatView.refreshViewInfo()
```
  refreshViewInfo() {
    nickname.innerHTML = "<b>Nickname:</b> " + this.model.views.get(this.viewId);
    viewCount.innerHTML = "<b>Total Views:</b> " + this.model.participants;
  }
```

Here the view reaches directly into the model and gets information about its nickname and the total number of views currently connected. In the view's constructor we stored a pointer to the model just for this purpose.

**The view is allowed to directly read from the model at any time.** In this case, the view uses `this.viewId` to get its own nickname from `this.model.views`. It then reads `this.model.participants` to determine how many active users there are.

**The view must NEVER directly write to the model!** Because Croquet exposes the model to the view for read access, it is *possible* to author a Croquet application where the view directly writes to the model. However, doing so will break synchronization and prevent the application from functioning properly.

If your view needs to change some information that is held by the model, it must publish an event that the model subscribes to. This will ensure that the change is mirrored by the reflector and executed identically by all instances of the model.

## ChatView.refreshHistory()
```
  refreshHistory() {
    textOut.innerHTML = "<b>Welcome to Croquet Chat!</b><br><br>" + this.model.history.join("<br>");
    textOut.scrollTop = Math.max(10000, textOut.scrollHeight);
  }
```
`refreshHistory()` is similar to `refreshViewInfo()` in that it reads the chat history directly from the model and posts it to the screen. It also makes sure that the chat window scrolls to the bottom when a new message arrives.

`this.model.history.join("<br>")` is a JavaScript string operation that takes all the strings in the history array and concatenates them into a single output string. It inserts a line break between each of the combined strings.

## Model Get/Set Routines & `modelOnly()`

One way to guard against accidentally writing to the model is to create explicit `Get` and `Set` methods for reading and writing. For example:

```
class MyModel extends Croquet.Model {

  init() {
    this.data;
  }

  getData() {
    return this.data;
  }

  setData(newData) {
    this.modelOnly();
    this.data = newData;
  }

}
MyModel.register("MyModel");

```

`Model.modelOnly()` is a utility function that throws an error if called outside normal model execution. You can use it inside a model `Set` method to make sure it doesn't accidentally get called by the view.
