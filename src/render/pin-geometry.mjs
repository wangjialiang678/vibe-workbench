// prototype SVG pin 的纯几何计算。

export function pinPopoverPosition(pin, viewport, popover, {
  gap = 14,
  margin = 12,
  verticalOffset = 12,
} = {}) {
  const viewportWidth = Math.max(0, Number(viewport?.width) || 0);
  const viewportHeight = Math.max(0, Number(viewport?.height) || 0);
  const popoverWidth = Math.max(0, Number(popover?.width) || 0);
  const popoverHeight = Math.max(0, Number(popover?.height) || 0);
  const pinX = Number(pin?.x) || 0;
  const pinY = Number(pin?.y) || 0;

  let horizontal = 'right';
  let left = pinX + gap;
  if (left + popoverWidth > viewportWidth - margin) {
    horizontal = 'left';
    left = pinX - popoverWidth - gap;
  }
  left = Math.min(
    Math.max(margin, left),
    Math.max(margin, viewportWidth - popoverWidth - margin),
  );

  let vertical = 'below';
  let top = pinY - verticalOffset;
  if (top + popoverHeight > viewportHeight - margin) {
    vertical = 'above';
    top = pinY - popoverHeight - verticalOffset;
  }
  top = Math.min(
    Math.max(margin, top),
    Math.max(margin, viewportHeight - popoverHeight - margin),
  );

  return { left, top, horizontal, vertical };
}

/**
 * 把百分比 pin 换算为容器内浮层坐标。
 * visibleBounds 是视口可见区映射到容器后的边界；滚动时仍返回容器坐标。
 */
export function containerPinPopoverPosition(
  container,
  pin,
  popover,
  { visibleBounds, ...positionOptions } = {},
) {
  const width = Math.max(0, Number(container?.width) || 0);
  const height = Math.max(0, Number(container?.height) || 0);
  const xPct = Math.min(100, Math.max(0, Number(pin?.xPct) || 0));
  const yPct = Math.min(100, Math.max(0, Number(pin?.yPct) || 0));

  const leftBound = Math.min(width, Math.max(0, Number(visibleBounds?.left) || 0));
  const topBound = Math.min(height, Math.max(0, Number(visibleBounds?.top) || 0));
  const rawRight = Number(visibleBounds?.right);
  const rawBottom = Number(visibleBounds?.bottom);
  const rightBound = Math.max(
    leftBound,
    Math.min(width, Number.isFinite(rawRight) ? rawRight : width),
  );
  const bottomBound = Math.max(
    topBound,
    Math.min(height, Number.isFinite(rawBottom) ? rawBottom : height),
  );

  const position = pinPopoverPosition(
    {
      x: (xPct / 100) * width - leftBound,
      y: (yPct / 100) * height - topBound,
    },
    {
      width: rightBound - leftBound,
      height: bottomBound - topBound,
    },
    popover,
    positionOptions,
  );

  return {
    ...position,
    left: position.left + leftBound,
    top: position.top + topBound,
  };
}

export function pinFromPointer(point, rect) {
  const width = Number(rect?.width) || 0;
  const height = Number(rect?.height) || 0;
  const xPct = width ? ((Number(point?.x) - Number(rect?.left)) / width) * 100 : 0;
  const yPct = height ? ((Number(point?.y) - Number(rect?.top)) / height) * 100 : 0;
  return {
    xPct: +Math.min(100, Math.max(0, xPct)).toFixed(2),
    yPct: +Math.min(100, Math.max(0, yPct)).toFixed(2),
  };
}

export function visibleBoundsInContainer(rect, viewport) {
  return {
    left: Math.max(0, -rect.left),
    top: Math.max(0, -rect.top),
    right: Math.min(rect.width, viewport.width - rect.left),
    bottom: Math.min(rect.height, viewport.height - rect.top),
  };
}
