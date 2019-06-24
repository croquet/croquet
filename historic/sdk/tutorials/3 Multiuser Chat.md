Copyright © 2019 Croquet Studios

This is an example of how to keep track of different users within the same session. It's a simple chat application that maintains a list of all users who are connected to the session and posts a notification whenever someone joins or leaves. New users are assigned a random nickname.

<p class="codepen" data-height="477" data-theme-id="37149" data-default-tab="result" data-user="croquet" data-slug-hash="NZjLzO" style="height: 477px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 2px solid; margin: 1em 0; padding: 1em;" data-pen-title="Multiuser Chat">
  <span>See the Pen <a href="https://codepen.io/croquet/full/NZjLzO">
  MultiuserChat</a> by Croquet (<a href="https://codepen.io/croquet">@croquet</a>)
  on <a href="https://codepen.io">CodePen</a>.</span>
</p>
<script async src="https://static.codepen.io/assets/embed/ei.js"></script>

## **Try it out!**
The first thing to do is click or scan the QR code above. This will launch a new Codepen instance of this session. Typing a message in either window will post the text to the shared chat screen under a randomly assigned nickname. Other people who are reading this documentation right now can also post messages to the same conversation, so you might find yourself talking to another Croquet developer!

There are two things we will learn here:

1. How to use the `"user-enter"` and `"user-exit"` events to keep track of users.
3. How to use the replicated `random()` function

## Simple Chat Model

Our Croquet application uses a single Model subclass named `ChatModel`. It does two things: It listens for `"newPost"` events coming from a view, and it listens for `"user-enter"` and `"user-exit"` events coming from the reflector itself.

The `"newPost"` event is published by a view when the user enters a message. Since the model is subscribed to the message, the event is sent via the reflector to all clients in the session. Each client's model adds it to its `history` array, and informs their views to refresh the history.

The `"user-enter"` and `"user-exit"` are system-generated events. They don't originate inside your application. They come from the Teatime reflector itself.

Whenever a user joins a session, a `"user-enter"` event will be received by everyone in the session (including the client who just joined). Similiarly, whenever a user leaves, a `"user-exit"` event is received. (The client who left will not get this event because they are already gone!)

The data passed in both events is a `userId`. It is a random identifier for each client in the session. Even if the same user joins the session from multiple browser windows or devices,the `userId` will be different.

_Maybe we should call this `clientId`? It's not actually about users_

TODO:
* talk about user names? the island tracks them but there is no API yet - the model could provide something like `getUserName(userId)`
* mention [this.user]{@link View#user} (or [this.clientId]{@link View#clientId}) and how to connect from view to an avatar inside the model? Or is that another tutorial?
* explain how the [random()]{@link Model#random} call is executed independently on each client but has the exact same result
