/* Unified keyboard / mouse / touch input. Touch UI feeds virtual state into the same object. */

export class Input {
  keys = new Set<string>();
  private pressedKeys = new Set<string>();
  mouse = [false, false, false];
  private mousePressed = [false, false, false];
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  // touch
  moveX = 0;
  moveY = 0; // +forward
  touchSprint = false;
  lookDX = 0;
  lookDY = 0;
  virtualFire = false;
  private virtualFirePressed = false;

  keyDown(code: string) {
    if (!this.keys.has(code)) this.pressedKeys.add(code);
    this.keys.add(code);
  }
  keyUp(code: string) {
    this.keys.delete(code);
  }
  isDown(code: string) {
    return this.keys.has(code);
  }
  /** edge-triggered, cleared at end of frame */
  pressed(code: string) {
    return this.pressedKeys.has(code);
  }
  mouseButton(i: number, down: boolean) {
    if (down && !this.mouse[i]) this.mousePressed[i] = true;
    this.mouse[i] = down;
  }
  setVirtualFire(down: boolean) {
    if (down && !this.virtualFire) this.virtualFirePressed = true;
    this.virtualFire = down;
  }
  get fireHeld() {
    return this.mouse[0] || this.virtualFire;
  }
  get firePressed() {
    return this.mousePressed[0] || this.virtualFirePressed;
  }
  get aimHeld() {
    return this.mouse[2];
  }
  /** virtual key tap/hold for touch buttons */
  setVirtual(code: string, down: boolean) {
    if (down) this.keyDown(code);
    else this.keyUp(code);
  }
  tap(code: string) {
    this.pressedKeys.add(code);
  }
  addLook(dx: number, dy: number) {
    this.lookDX += dx;
    this.lookDY += dy;
  }
  /** Movement axes combined from keyboard + joystick. x: right+, y: forward+ */
  axes() {
    let x = (this.isDown('KeyD') ? 1 : 0) - (this.isDown('KeyA') ? 1 : 0) + this.moveX;
    let y = (this.isDown('KeyW') ? 1 : 0) - (this.isDown('KeyS') ? 1 : 0) + this.moveY;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    return { x, y, m: Math.min(1, m) };
  }
  endFrame() {
    this.pressedKeys.clear();
    this.mousePressed[0] = this.mousePressed[1] = this.mousePressed[2] = false;
    this.virtualFirePressed = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.wheel = 0;
  }
  releaseAll() {
    this.keys.clear();
    this.pressedKeys.clear();
    this.mouse[0] = this.mouse[1] = this.mouse[2] = false;
    this.virtualFire = false;
    this.moveX = this.moveY = 0;
    this.touchSprint = false;
  }
}
