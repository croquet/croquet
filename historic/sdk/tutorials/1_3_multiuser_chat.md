Copyright © 2019 Croquet Studios

This is an example of how to keep track of different users within the same session. It's a simple chat application that maintains a list of all users who are connected to the session and posts a notification whenever someone joins or leaves. New users are assigned a random nickname.

<div class="codepen" data-height="512" data-theme-id="light" data-default-tab="js,result" data-user="croquet" data-slug-hash="NZjLzO" data-prefill='{"title":"Chat","tags":[],"head":"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">","stylesheets":["https://cdn.jsdelivr.net/npm/toastify-js/src/toastify.min.css"],"scripts":["https://croquet.studio/sdk/croquet-latest.min.js","https://codepen.io/croquet/pen/OemewR"]}'>
  <pre data-lang="html">&lt;div id="chat">
  &lt;div id="textOut">&lt;/div>
  &lt;input id="textIn" type="text" onkeydown="event.keyCode == 13 && sendButton.onclick()"/>
  &lt;input id="sendButton" type="button" value = "Send" />
&lt;/div></pre>
  <pre data-lang="css" >#session { position: fixed; width: 80px; height: 80px; top: 150px; right: 40px; }

html, body, #chat { height: 100%; margin: 0; }
body,input { font: 24px sans-serif; }
#chat { display: flex; flex-flow: row wrap; }
#chat > * { margin: 5px 10px; padding: 10px; border: 1px solid #999; }
#textIn,#sendButton { flex: 1 0 0; }
#textOut { height: calc(100% - 100px); flex: 1 100%;  overflow: auto }
#textIn { flex-grow: 100 }
#sendButton { background-color: #fff; border: 2px solid #000 }
</pre>
  <pre data-lang="js">// Croquet Tutorial 3
// Multiuser Chat
// Croquet Studios, 2019

class ChatModel extends Croquet.Model {

  init() {
    this.users = {};
    this.history = [];
    this.subscribe("input", "newPost", post => this.onNewPost(post));
    this.subscribe(this.sessionId, "user-enter", userId => this.userEnter(userId));
    this.subscribe(this.sessionId, "user-exit", userId => this.userExit(userId));
  }

  userEnter(userId) {
    const userName = this.randomName();
    this.users[userId] = userName;
    this.addToHistory(`&lt;i>${userName} has entered the room&lt;/i>`);
  }

  userExit(userId) {
    const userName = this.users[userId];
    delete this.users[userId];
    this.addToHistory(`&lt;i>${userName} has exited the room&lt;/i>`);
  }

  onNewPost(post) {
    const userName = this.users[post.userId];
    this.addToHistory(`&lt;b>${userName}:&lt;/b> ${this.escape(post.text)}`);
  }

  addToHistory(item){
    this.history.push(item);
    if (this.history.length > 100) this.history.shift();
    this.publish("history", "update", this.history);
  }

  escape(text) { // Clean up text to remove html formatting characters
    return text.replace("&", "&amp;").replace("&lt;", "&lt;").replace(">", "&gt;");
  }

  randomName() {
    const names =["Acorn","Allspice","Almond","Ancho","Anise","Aoli","Apple","Apricot","Arrowroot","Asparagus","Avocado","Baklava","Balsamic",
        "Banana","Barbecue","Bacon","Basil","Bay Leaf","Bergamot","Blackberry","Blueberry","Broccoli",
        "Buttermilk","Cabbage","Camphor","Canaloupe","Cappuccino","Caramel","Caraway","Cardamom","Catnip","Cauliflower","Cayenne","Celery","Cherry",
        "Chervil","Chives","Chipotle","Chocolate","Coconut","Cookie Dough","Chicory","Chutney","Cilantro","Cinnamon","Clove",
        "Coriander","Cranberry","Croissant","Cucumber","Cupcake","Cumin","Curry","Dandelion","Dill","Durian","Eclair","Eggplant","Espresso","Felafel","Fennel",
        "Fenugreek","Fig","Garlic","Gelato","Gumbo","Honeydew","Hyssop","Ghost Pepper",
        "Ginger","Ginseng","Grapefruit","Habanero","Harissa","Hazelnut","Horseradish","Jalepeno","Juniper","Ketchup","Key Lime","Kiwi","Kohlrabi","Kumquat","Latte",
        "Lavender","Lemon Grass","Lemon Zest","Licorice","Macaron","Mango","Maple Syrup","Marjoram","Marshmallow",
        "Matcha","Mayonnaise","Mint","Mulberry","Mustard","Nectarine","Nutmeg","Olive Oil","Orange Peel","Oregano",
        "Papaya","Paprika","Parsley","Parsnip","Peach","Peanut","Pecan","Pennyroyal","Peppercorn","Persimmon",
        "Pineapple","Pistachio","Plum","Pomegranate","Poppy Seed","Pumpkin","Quince","Ragout","Raspberry","Ratatouille","Rosemary","Rosewater","Saffron","Sage","Sassafras",
        "Sea Salt","Sesame Seed","Shiitake","Sorrel","Soy Sauce","Spearmint","Strawberry","Strudel","Sunflower Seed","Sriracha","Tabasco","Tamarind","Tandoori","Tangerine",
                  "Tarragon","Thyme","Tofu","Truffle","Tumeric","Valerian","Vanilla","Vinegar","Wasabi","Walnut","Watercress","Watermelon","Wheatgrass","Yarrow","Yuzu","Zucchini"];
    return names[Math.floor(Math.random() * names.length)];
  }

}

ChatModel.register();

class ChatView extends Croquet.View {

  constructor(model) {
    super(model);
    sendButton.onclick = () => this.send();
    this.subscribe("history", "update", history => this.refreshHistory(history));
    this.refreshHistory(model.history);
  }

  send() {
    const post = {userId: this.user.id, text: textIn.value};
    this.publish("input", "newPost", post);
    textIn.value = "";
  }

  refreshHistory(history) {
    textOut.innerHTML = "&lt;b>Welcome to Croquet Chat!&lt;/b>&lt;br>&lt;br>" + history.join("&lt;br>");
    textOut.scrollTop = Math.max(10000, textOut.scrollHeight);
  }
}

// use fixed session name instead of random so multiple codepen windows find each other
const session = { user: 'GUEST', random: '1234567' };
Croquet.startSession("chat", ChatModel, ChatView, {step: "auto", session});

// Note: the QR code points to our original pen. After forking,
// change the url in the HTML tab to point to your pen so you can easily
// join your own session on a mobile device</pre>
</div>
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
