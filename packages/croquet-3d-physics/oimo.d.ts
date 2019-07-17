declare module "oimo" {
    export type Shape = {
        type: "box";
        width: number,
        height: number,
        depth: number,
    } | {
        type: "sphere",
        radius: number
    } | {
        type: "cylinder",
        radius: number,
        height: number
    };

    export class Body {
        shapes: Shape;
        getPosition(): [number, number, number];
        getQuaternion(): [number, number, number, number];
    }

    export class World {
        rigidBodies: any;
        constructor(options: any);
        add(options: any): Body;
        step(): void;
    }

    export const SHAPE_BOX = "box"
    export const SHAPE_SPHERE = "sphere"
    export const SHAPE_CYLINDER = "cylinder"
}