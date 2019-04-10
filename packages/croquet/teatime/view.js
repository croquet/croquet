import { ViewPart, currentRealm } from "../../arcos/simpleapp/src/modelView.js";

export default class View extends ViewPart {
    random() { return currentRealm().random(); }
}
