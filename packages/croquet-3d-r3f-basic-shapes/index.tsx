import React from 'react';
import {vec3, quat} from 'gl-matrix';

export function Box({position, quaternion, width, height, depth}: {position: vec3, quaternion: quat, width: number, height: number, depth: number}) {
    <mesh position={position} quaternion={quaternion}>
        <boxGeometry attach="geometry" width={width} height={height} depth={depth}></boxGeometry>
    </mesh>
}