import { StatePart, currentRealm } from "../../arcos/simpleapp/src/modelView.js";

export default class Model extends StatePart {
    random() { return currentRealm().random(); }
}
