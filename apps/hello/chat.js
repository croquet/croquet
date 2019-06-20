// Hello World Example
//
// Croquet Studios, 2019
//
// This is an example of a simple Teatime applicaton. It creates a counter that counts up once
// per second. Clicking on it resets it to zero. The counter is replicated across the network and
// will respond to clicks from any client connected to the same session. The current value of the
// counter is automatically saved to the cloud.

import { Model, View, startSession } from "@croquet/teatime";
//import { Model, View, startSession } from "../sdk/dist/croquet.min.js";

//------------------------------------------------------------------------------------------
// Define our model. MyModel has a tick method that executes once per second. It updates the value
// of a counter and publishes the value with an event. It also listens for reset events from the view.
// If it receives one, it resets its counter and broadcasts the change.
//------------------------------------------------------------------------------------------

class MyModel extends Model {

    init() { // Note that models are initialized with "init" instead of "constructor"!
        this.history = "<b>Welcome to Croquet Chat!</b><br><br>";
        this.subscribe("input", "newPost", data => this.handleNewPost(data));
    }

    handleNewPost(post) {

        this.history += "<b>" + this.filter(post.nick) + ": </b>" + this.filter(post.text) + "<br>";
        this.publish("history", "update");
    }

    filter(text) {
        let result = text.replace("&", "&amp");
        result = text.replace("<", "&lt");
        result = result.replace(">", "&gt");
        return result;
    }

}

// Register our model class with the serializer
MyModel.register();

//------------------------------------------------------------------------------------------
// Define our view. MyView listens for click events on the window. If it receives one, it
// broadcasts a reset event. It also listens for update events from the model. If it receives
// one, it updates the counter on the screen with the current count.
//------------------------------------------------------------------------------------------

class MyView extends View {

    constructor(model) { // The view gets a reference to the model when the session starts.
        super(model);
        this.model = model;
        this.nick = "UserName";
        const sendButton = document.getElementById("sendButton");
        sendButton.addEventListener("click", event => this.onSendClick(event), false);
        const loginButton = document.getElementById("loginButton");
        loginButton.addEventListener("click", event => this.onLoginClick(event), false);
        this.subscribe("history", "update", () => this.refreshHistory());
        this.refreshHistory();
    }

    onSendClick() {
        const textIn = document.getElementById("textIn");
        const post = {nick: this.nick, text: textIn.value};
        this.publish("input", "newPost", post);
        textIn.value = "";
    }

    onLoginClick() {
        const loginName = document.getElementById("loginName");
        this.nick = loginName.value;
        const loginForm = document.getElementById("loginForm");
        loginForm.style.display = "none";
    }

    refreshHistory() {
        const textOut = document.getElementById("textOut");
        textOut.innerHTML = this.model.history;
    }

}

//------------------------------------------------------------------------------------------
// Join the Teatime session and spawn our model and view. We also enable automatic
// stepping. Each time the window draws an animation frame, the session steps forward
// and executes all pending events in both the model and the view.
//------------------------------------------------------------------------------------------

const session = { user: 'brian', random: '22221' };
startSession("hello", MyModel, MyView, {step: "auto", session});
