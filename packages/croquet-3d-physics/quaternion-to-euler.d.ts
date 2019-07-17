
declare module 'quaternion-to-euler' {
    import { vec3, quat } from 'gl-matrix';
    export default function quatToEuler(quat: [number, number, number, number] | quat): [number, number, number] | vec3;
}