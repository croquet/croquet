import * as three from 'three';

export const THREE = three;

export { ModelPart, ViewPart } from './parts';
export { default as Room } from './room/roomModel';
export { default as RoomView } from './room/roomView';

export { default as PortalElement } from './elements/portalElement';
export { default as TextElement } from './elements/textElement';
export { default as PhysicalElement } from './elements/physicalElement';

export { default as SpatialPart } from './modelParts/spatial';
export { default as Inertial } from './modelParts/inertial';
export { default as ChildrenPart, ChildEvents } from './modelParts/children';
export { PhysicalWorld } from './modelParts/physical';

export { default as Tracking, Facing } from './viewParts/tracking';
export { default as Clickable } from './viewParts/clickable';
export { default as Draggable } from './viewParts/draggable';
export { default as EditableTextViewPart } from './viewParts/textView';
export { default as PhysicalShape } from './viewParts/physicalShape';
export { LayoutRoot, LayoutContainer, LayoutSlotStretch3D, LayoutSlotText, MinFromBBox } from './viewParts/layout';

// only necessary to be exported for custom entrypoints
export { default as Renderer } from './render';
export { default as RoomViewManager } from './room/roomViewManager';
export { theKeyboardManager } from './domKeyboardManager';

export { Model, View, Controller } from '@croquet/teatime';
