// Hello World Example
//
// Croquet Studios, 2019
//
// This is an example of a simple chat applicaton. It creates a chatroom where users can
// post messages to a shared conversation.

import { Model, View, startSession } from "@croquet/teatime";
// import { GetUser, getUser } from "@croquet/util/user";

//------------------------------------------------------------------------------------------
// ChatModel
//
// Keeps a list of connected clients. When a post arrives from one of them, adds it to
// the chat history along with their user name.
//------------------------------------------------------------------------------------------

class ChatModel extends Model {

    init() {
        this.users = new Map();
        this.history = "<b>Welcome to Croquet Chat!</b><br><br>";

        this.subscribe(this.sessionId, "user-enter", userID => this.userEnter(userID));
        this.subscribe(this.sessionId, "user-exit", userID => this.userExit(userID));
        this.subscribe("input", "newPost", post => this.newPost(post));
    }

    userEnter(userID) {
        const userName = this.randomName();
        this.users.set(userID, userName);
        this.history += "<i>" + userName + " has entered the room</i><br>";
        this.publish("history", "update");
    }

    userExit(userID) {
        const userName = this.users.get(userID);
        this.users.delete(userID);
        this.history += "<i>" + userName + " has exited the room</i><br>";
        this.publish("history", "update");
    }

    newPost(post) {
        const userName = this.users.get(post.userID);
        this.history += "<b>" + userName + ": </b>" + this.filter(post.text) + "<br>";
        this.publish("history", "update");
    }

    filter(text) { // Clean up text to make sure it doesn't include html formatting characterss.
        let result = text.replace("&", "&amp");
        result = text.replace("<", "&lt");
        result = result.replace(">", "&gt");
        return result;
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

//------------------------------------------------------------------------------------------
// ChatView
//
// Posts messages. If you join as a guest, assigns a random name.
//------------------------------------------------------------------------------------------

class ChatView extends View {

    constructor(model) { // The view gets a reference to the model when the session starts.
        super(model);
        this.model = model;
        this.id = Math.random();
        const sendButton = document.getElementById("sendButton");
        sendButton.addEventListener("click", event => this.onSendClick(event), false);
        this.subscribe("history", "update", () => this.refreshHistory());
        this.refreshHistory();
    }

    onSendClick() {
        const textIn = document.getElementById("textIn");
        const post = {userID: this.user.id, text: textIn.value};
        this.publish("input", "newPost", post);
        textIn.value = "";
    }

    refreshHistory() {
        const textOut = document.getElementById("textOut");
        textOut.innerHTML = this.model.history;
        textOut.scrollTop = textOut.scrollHeight - textOut.clientHeight;
    }

    randomName() {
        const names =["Acorn","Allspice","Almond","Ancho","Anise","Aoli","Apple","Apricot","Arrowroot","Asparagus","Avocado","Baklava","Balsamic",
            "Banana","Barbecue Sauce","Bacon","Basil","Bay Leaf","Bergamot","Blackberry","Blueberry","Broccoli",
            "Buttermilk","Cabbage","Camphor","Canaloupe","Cappuccino","Caramel","Caraway Seed","Cardamom","Catnip","Cauliflower","Cayenne Pepper","Celery Seed","Cherry",
            "Chervil","Chives","Chipotle","Chocolate","Coconut","Cookie Dough","Chicory","Chutney","Cilantro","Cinnamon","Clove",
            "Coriander","Cranberry","Croissant","Cucumber","Cupcake","Cumin","Curry Powder","Dandelion","Dill","Durian","Eclair","Eggplant","Espresso","Felafel","Fennel",
            "Fenugreek","Fig","Garam Masala","Garlic","Gelato","Gumbo","Honeydew","Hyssop","Ghost Pepper",
            "Ginger","Ginseng","Grapefruit","Habanero","Harissa","Hazelnut","Horseradish","Jalepeno","Juniper","Ketchup","Key Lime","Kiwi","Kohlrabi","Kumquat","Latte",
            "Lavender","Lemon Grass","Lemon Zest","Licorice","Macaron","Mango","Maple Syrup","Marjoram","Marshmallow",
            "Matcha","Mayonnaise","Mint","Mulberry","Mustard","Nectarine","Nutmeg","Olive Oil","Orange Peel","Oregano",
            "Papaya","Paprika","Parsley","Parsnip","Peach","Peanut Butter","Pecan","Pennyroyal","Peppercorn","Persimmon",
            "Pineapple","Pistachio","Plum","Pomegranate","Poppy Seed","Pumpkin","Quince","Ragout","Raspberry","Ratatouille","Rosemary","Rosewater","Saffron","Sage","Sassafras",
            "Sea Salt","Sesame Seed","Shiitake","Sorrel","Soy Sauce","Spearmint","Strawberry","Strudel","Sunflower Seed","Sriracha","Tabasco","Tamarind","Tandoori","Tangerine",
            "Tarragon","Thyme","Tofu","Truffle Oil","Tumeric","Valerian","Vanilla","Vinegar","Wasabi","Walnut","Watercress","Watermelon","Wheatgrass","Yarrow","Yuzu","Zucchini"];
        return names[Math.floor(Math.random() * names.length)];
    }

}

//------------------------------------------------------------------------------------------
// Join the Teatime session and spawn our model and view.
//------------------------------------------------------------------------------------------

startSession("chat", ChatModel, ChatView, {step: "auto"});

