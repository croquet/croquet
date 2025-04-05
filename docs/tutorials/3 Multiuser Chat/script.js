// Croquet Tutorial 3
// Multiuser Chat
// Croquet Labs, 2019

class ChatModel extends Croquet.Model {

  init() {
    this.users = {};
    this.history = [];
    this.subscribe("input", "newPost", this.onNewPost);
    this.subscribe(this.sessionId, "view-join", this.userEnter);
    this.subscribe(this.sessionId, "view-exit", this.userExit);
  }

  userEnter(viewId) {
    const userName = this.randomName();
    this.users[viewId] = userName;
    this.addToHistory(`<i>${userName} has entered the room</i>`);
  }

  userExit(viewId) {
    const userName = this.users[viewId];
    delete this.users[viewId];
    this.addToHistory(`<i>${userName} has exited the room</i>`);
  }

  onNewPost(post) {
    const userName = this.users[post.viewId];
    this.addToHistory(`<b>${userName}:</b> ${this.escape(post.text)}`);
  }

  addToHistory(item){
    this.history.push(item);
    if (this.history.length > 100) this.history.shift();
    this.publish("history", "update", this.history);
  }

  escape(text) { // Clean up text to remove html formatting characters
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
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

ChatModel.register("ChatModel");

class ChatView extends Croquet.View {

  constructor(model) {
    super(model);
    sendButton.onclick = () => this.send();
    this.subscribe("history", "update", this.refreshHistory);
    this.refreshHistory(model.history);
  }

  send() {
    const post = {viewId: this.viewId, text: textIn.value};
    this.publish("input", "newPost", post);
    textIn.value = "";
  }

  refreshHistory(history) {
    textOut.innerHTML = "<b>Welcome to Croquet Chat!</b><br><br>" + history.join("<br>");
    textOut.scrollTop = Math.max(10000, textOut.scrollHeight);
  }
}

Croquet.Session.join("chat", ChatModel, ChatView);
