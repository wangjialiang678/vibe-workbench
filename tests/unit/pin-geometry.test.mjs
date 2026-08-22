import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containerPinPopoverPosition, pinFromPointer, visibleBoundsInContainer } from '../../src/render/pin-geometry.mjs';

test('pinFromPointer 转换为百分比并在容器边界钳制', () => {
  assert.deepEqual(pinFromPointer({ x: 150, y: 75 }, { left: 50, top: 25, width: 200, height: 100 }), { xPct: 50, yPct: 50 });
  assert.deepEqual(pinFromPointer({ x: -1, y: 999 }, { left: 0, top: 0, width: 100, height: 100 }), { xPct: 0, yPct: 100 });
  assert.deepEqual(pinFromPointer({ x: 10, y: 10 }, { left: 0, top: 0, width: 0, height: 0 }), { xPct: 0, yPct: 0 });
});

test('visibleBoundsInContainer 映射视口可见边界', () => {
  assert.deepEqual(visibleBoundsInContainer({ left: -30, top: 20, width: 300, height: 200 }, { width: 200, height: 150 }), {
    left: 30, top: 0, right: 230, bottom: 130,
  });
});

test('containerPinPopoverPosition 保留已有翻转与越界钳制', () => {
  assert.deepEqual(containerPinPopoverPosition(
    { width: 400, height: 200 }, { xPct: 95, yPct: 95 }, { width: 120, height: 60 },
  ), { left: 246, top: 118, horizontal: 'left', vertical: 'above' });
});
