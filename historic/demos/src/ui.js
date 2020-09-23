import { Model, View } from "@croquet/kit";

export class SpeedSlider extends Model {
    init() {
        super.init();
        this.value = 50;
        this.subscribe(this.id, "changed", value => this.changed(value));
    }

    changed(value) {
        if (this.value === value) return;
        this.value = value;
        this.publish(this.id, "changed", value);
    }
}


export class SpeedSliderView extends View {
    constructor() {
        super();
        this.controllers = new Map();
        this.element = document.getElementById("speed");
        this.element.addEventListener("input", evt => {
            let value = evt.target.value;
            if (Math.abs(value - 50) < 5) value = 50;
            const scale = 2 ** ((value - 50) / 50 * 2);        // 1/4 to 4x
            for (const [model, controller] of this.controllers) {
                this.publish(model.id, "changed", value);
                controller.requestTicks({scale});
            }
        });
    }

    attach(model, controller) {
        this.controllers.set(model, controller);
        this.subscribe(model.id, "changed", value => this.changed(model.id, value));
        this.element.style.display = controller.tickMultiplier ? "none" : "block";
    }

    changed(id, value) {
        this.element.value = value;
    }
}
