function isScrollable(el: HTMLElement): boolean {
  const style = getComputedStyle(el)
  const oy = style.overflowY
  const canY = (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1
  const ox = style.overflowX
  const canX = (ox === 'auto' || ox === 'scroll' || ox === 'overlay') && el.scrollWidth > el.clientWidth + 1
  return canY || canX
}

function findScrollable(from: EventTarget | null, boundary: EventTarget | null): HTMLElement | null {
  let el = from as HTMLElement | null
  const root = boundary as HTMLElement | null
  while (el && el !== root?.parentElement) {
    if (el instanceof HTMLElement && isScrollable(el)) return el
    if (el === root) break
    el = el.parentElement
  }
  return root && root instanceof HTMLElement && isScrollable(root) ? root : null
}

export function onFileDialogOverlayWheel(ev: WheelEvent): void {
  ev.stopPropagation()

  if (ev.target === ev.currentTarget) {
    ev.preventDefault()
  }
}

export function onFileDialogScrollableWheel(ev: WheelEvent): void {

  ev.stopPropagation()

  const boundary = ev.currentTarget as HTMLElement
  const scroller = findScrollable(ev.target, boundary)
  if (!scroller) {

    ev.preventDefault()
    return
  }

  const { scrollTop, scrollLeft, scrollHeight, clientHeight, scrollWidth, clientWidth } = scroller
  const atTop = scrollTop <= 0
  const atBottom = scrollTop + clientHeight >= scrollHeight - 1
  const atLeft = scrollLeft <= 0
  const atRight = scrollLeft + clientWidth >= scrollWidth - 1

  const dy = ev.deltaY
  const dx = ev.deltaX
  const verticalBlocked = (dy < 0 && atTop) || (dy > 0 && atBottom)
  const horizontalBlocked = (dx < 0 && atLeft) || (dx > 0 && atRight)

  if (Math.abs(dy) >= Math.abs(dx)) {
    if (verticalBlocked) ev.preventDefault()
  } else if (horizontalBlocked) {
    ev.preventDefault()
  }
}
