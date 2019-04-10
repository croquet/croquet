import * as THREE from "three";
import { ViewPart } from "../modelView.js";
import { LayoutRoot, LayoutStack, LayoutSlotStretch3D, LayoutSlotText } from "./layout.js";
import TextViewPart from "./text.js";
import { makePointerSensitive, PointerEvents } from "./pointer.js";

export class EntryBackgroundPlane extends ViewPart {
    constructor(options) {
        super();
        this.callback = options.callback;
        this.threeObj = new THREE.Mesh(
            new THREE.PlaneBufferGeometry(1, 1, 1, 1),
            new THREE.MeshBasicMaterial({color: options.color || "#ffffff"})
        );
        makePointerSensitive(this.threeObj, this, 2);
        this.subscribe(PointerEvents.pointerEnter, "onStartHover");
        this.subscribe(PointerEvents.pointerLeave, "onEndHover");
        this.subscribe(PointerEvents.pointerUp, "onClick");
    }

    onStartHover() {
        this.threeObj.material.color = new THREE.Color("#aaaaaa");
    }

    onEndHover() {
        this.threeObj.material.color = new THREE.Color("#ffffff");
    }

    onClick() {
        this.callback();
    }
}

export class Menu extends ViewPart {
    /**
     * @arg {Object} options
     * @arg {[string, () => any][]} options.entries */
    constructor(options) {
        super();

        this.parts = {
            layout: new LayoutRoot({}, {
                flexDirection: "column",
                alignItems: "stretch",
                children: options.entries.map(([entry, callback]) => {
                    return new LayoutStack({}, {
                        minHeight: 1,
                        minWidth: 5.0,
                        children: [
                            new LayoutSlotStretch3D({}, {
                                margin: 0.1,
                                inner: new EntryBackgroundPlane({}, {callback})
                            }),
                            new LayoutSlotText({}, {
                                margin: 0.25,
                                z: 0.05,
                                inner: new TextViewPart({}, {content: entry})
                            })
                        ]
                    });
                })
            })
        };
    }
}

export class ContextMenu extends Menu {
    constructor(options) {
        super(options);

        this.group = new THREE.Group();
        for (const threeObj of this.parts.layout.threeObjs()) {
            this.group.add(threeObj);
        }
        this.threeObj = this.group;
        this.group.visible = false;
    }

    toggleAt(position) {
        if (this.group.visible) {
            this.dismiss();
        } else {
            this.showAt(position);
        }
    }

    showAt(position) {
        this.group.visible = true;
        this.group.position.copy(position);
    }

    dismiss() {
        this.group.visible = false;
    }
}
