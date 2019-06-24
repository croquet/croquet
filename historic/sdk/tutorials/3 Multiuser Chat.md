Copyright © 2019 Croquet Studios

This is an example of how to keep track of different users within the same session. It's a simple chat application that maintains a list of all users who are connected to the session and posts a notification whenever someone joins or leaves. New users are assigned a random nickname.

<p class="codepen" data-height="477" data-theme-id="37149" data-default-tab="js,result" data-user="bbupton" data-slug-hash="YoVwQV" style="height: 477px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 2px solid; margin: 1em 0; padding: 1em;" data-pen-title="Multiuser Chat">
  <span>See the Pen <a href="https://codepen.io/bbupton/pen/YoVwQV">
  MultiuserChat</a> by Croquet (<a href="https://codepen.io/croquet">@croquet</a>)
  on <a href="https://codepen.io">CodePen</a>.</span>
</p>
<script async src="https://static.codepen.io/assets/embed/ei.js"></script>

## **Try it out!**
The first thing to do is click or scan the QR code above. This will launch a new Codepen instance of this session. Typing a message in either window will post the text to the shared chat screen under a randomly assigned nickname. Other people who are reading this documentation right now can also post messages to the same conversation, so you might find yourself talking to another Croquet developer!

There are two things we will learn here:

1. How to use the `user-enter` and `user-exit` events to keep track of users.
3. How to remove old users from a restored snapshot

## Simple Chat Model

Our Croquet application uses a single Model subclass named `ChatModel`. 'ChatModel' does two things. It listens for `newPost` events coming from a view. And it listens for `user-enter` and `user-exit` events coming from the reflector itself.

`User-enter` and `user-exit` are special **reflector events**. Reflector events don't originate inside your application. They come from the Teatime reflector system itself.

Whenever a user joins a session, the reflector will broadcast a `user-enter` event to everyone in the session (including the client who just joined). Similiarly, whenever a user leaves, the reflector will broadcast a `user-exit` event. (The client who left will not get this event because they are already gone!)

If a large number of users enter or leave at the same time, the reflector will bundle them all into a single event for efficeincy. So the data passed with the event will be an array of users, not just a single reference.


