import { ModelPart } from "../parts";
import Tracking from "../viewParts/tracking";
import PhysicalShape from "../viewParts/physicalShape";
import PhysicalPart from '../modelParts/physical';

export default class PhysicalElement extends ModelPart {
    constructor() {
        super();
        this.parts = {
            spatial: new PhysicalPart()
        };
    }

    naturalViewClass() {
        return Tracking()(PhysicalShape);
    }
}
