import * as THREE from 'three';

// Simple Delegate class to replace the original
class Delegate<T> {
    private listeners: ((data: T) => void)[] = [];

    addListener(listener: any, callback: (data: T) => void) {
        this.listeners.push(callback);
    }

    invoke(data: T) {
            this.listeners.forEach(listener => listener(data));
        }
    }


export enum KeyState {
  Down,
  Pressed,
  Up,
  None
}
export enum MouseButton {
  Left = 0,
  Middle = 1,
  Right = 2
}
export enum KeyCode {
  backspace = 8, tab = 9, enter = 13, shift = 16, ctrl = 17, alt = 18, pause = 19, capslock = 20, escape = 27, spacebar = 32, pageup = 33, pagedown = 34, end = 35, home = 36, leftarrow = 37, uparrow = 38, rightarrow = 39, downarrow = 40, insert = 45, delete = 46,
  n0 = 48, n1 = 49, n2 = 50, n3 = 51, n4 = 52, n5 = 53, n6 = 54, n7 = 55, n8 = 56, n9 = 57,
  a = 65, b = 66, c = 67, d = 68, e = 69, f = 70, g = 71, h = 72, i = 73, j = 74, k = 75, l = 76, m = 77, n = 78, o = 79, p = 80, q = 81, r = 82, s = 83, t = 84, u = 85, v = 86, w = 87, x = 88, y = 89, z = 90,
  leftwindowkey = 91, rightwindowkey = 92, selectkey = 93,
  numpad0 = 96, numpad1 = 97, numpad2 = 98, numpad3 = 99, numpad4 = 100, numpad5 = 101, numpad6 = 102, numpad7 = 103, numpad8 = 104, numpad9 = 105,
  multiply = 106, add = 107, subtract = 109, decimalpoint = 110, divide = 111,
  f1 = 112, f2 = 113, f3 = 114, f4 = 115, f5 = 116, f6 = 117, f7 = 118, f8 = 119, f9 = 120, f10 = 121, f11 = 122, f12 = 123,
  numlock = 144, scrolllock = 145, semicolon = 186, equalsign = 187, comma = 188, dash = 189, period = 190, forwardslash = 191, graveaccent = 192, openbracket = 219, backslash = 220, closebraket = 221, singlequote = 222
}

class MouseMoveDelegate extends Delegate<{ evt: MouseEvent; mousePosition: THREE.Vector2; }> { }
class MouseWheelDelegate extends Delegate<{ evt: Event; mousePosition: THREE.Vector2; wheelDelta: number; }> { }


class InputManager {
    mousePosition: THREE.Vector2 = new THREE.Vector2();
    private newMousePosition: THREE.Vector2 = new THREE.Vector2();
    keyStates: { [index: number]: KeyState } = {};
    mouseKeyStates: { [index: number]: KeyState } = {};
    private downKeys: KeyCode[] = [];
    private upKeys: KeyCode[] = [];
    private downMouseKeys: MouseButton[] = [];
    private upMouseKeys: MouseButton[] = [];

    public MouseMoveEvent: MouseMoveDelegate = new MouseMoveDelegate();
    public MouseWheelEvent: MouseWheelDelegate = new MouseWheelDelegate();

    private static keyCodeFromAscii: { [index: number]: KeyCode } = {
        8: KeyCode.backspace, 9: KeyCode.tab, 13: KeyCode.enter, 16: KeyCode.shift, 17: KeyCode.ctrl, 18: KeyCode.alt, 19: KeyCode.pause, 20: KeyCode.capslock, 27: KeyCode.escape, 32: KeyCode.spacebar, 33: KeyCode.pageup, 34: KeyCode.pagedown, 35: KeyCode.end, 36: KeyCode.home, 37: KeyCode.leftarrow, 38: KeyCode.uparrow, 39: KeyCode.rightarrow, 40: KeyCode.downarrow, 45: KeyCode.insert, 46: KeyCode.delete,
        48: KeyCode.n0, 49: KeyCode.n1, 50: KeyCode.n2, 51: KeyCode.n3, 52: KeyCode.n4, 53: KeyCode.n5, 54: KeyCode.n6, 55: KeyCode.n7, 56: KeyCode.n8, 57: KeyCode.n9,
        65: KeyCode.a, 66: KeyCode.b, 67: KeyCode.c, 68: KeyCode.d, 69: KeyCode.e, 70: KeyCode.f, 71: KeyCode.g, 72: KeyCode.h, 73: KeyCode.i, 74: KeyCode.j, 75: KeyCode.k, 76: KeyCode.l, 77: KeyCode.m, 78: KeyCode.n, 79: KeyCode.o, 80: KeyCode.p, 81: KeyCode.q, 82: KeyCode.r, 83: KeyCode.s, 84: KeyCode.t, 85: KeyCode.u, 86: KeyCode.w, 87: KeyCode.x, 88: KeyCode.y, 89: KeyCode.y, 90: KeyCode.z,
        91: KeyCode.leftwindowkey, 92: KeyCode.rightwindowkey, 93: KeyCode.selectkey,
        96: KeyCode.numpad0, 97: KeyCode.numpad1, 98: KeyCode.numpad2, 99: KeyCode.numpad3, 100: KeyCode.numpad4, 101: KeyCode.numpad5, 102: KeyCode.numpad6, 103: KeyCode.numpad7, 104: KeyCode.numpad8, 105: KeyCode.numpad9,
        106: KeyCode.multiply, 107: KeyCode.add, 109: KeyCode.subtract, 110: KeyCode.decimalpoint, 111: KeyCode.divide,
        112: KeyCode.f1, 113: KeyCode.f2, 114: KeyCode.f3, 115: KeyCode.f4, 116: KeyCode.f5, 117: KeyCode.f6, 118: KeyCode.f7, 119: KeyCode.f8, 120: KeyCode.f9, 121: KeyCode.f10, 122: KeyCode.f11, 123: KeyCode.f12,
        144: KeyCode.numlock, 145: KeyCode.scrolllock, 186: KeyCode.semicolon, 187: KeyCode.equalsign, 188: KeyCode.comma, 189: KeyCode.dash, 190: KeyCode.period, 191: KeyCode.forwardslash, 192: KeyCode.graveaccent, 219: KeyCode.openbracket, 220: KeyCode.backslash, 221: KeyCode.closebraket, 222: KeyCode.singlequote
    };

    ListenDomElement(domElement: HTMLElement) {
        document.addEventListener('keydown', (keyEvent: KeyboardEvent) => {
            const keyCode = InputManager.keyCodeFromAscii[keyEvent.keyCode];

            // Do not prevent default behavior for F12
            if (keyCode === KeyCode.f12) {
                return;
            }

            if (this.keyStates[<number>keyCode] !== KeyState.Pressed) {
                this.keyStates[<number>keyCode] = KeyState.Down;
                this.downKeys.push(keyCode);
            }
            keyEvent.preventDefault();
        });

        document.addEventListener('keyup', (keyEvent: KeyboardEvent) => {
            const keyCode = InputManager.keyCodeFromAscii[keyEvent.keyCode];
            this.keyStates[<number>keyCode] = KeyState.Up;
            this.upKeys.push(keyCode);
            console.log("KEY UP: " + keyEvent.keyCode);
            keyEvent.preventDefault();
        });
        
        domElement.addEventListener('mousemove', (ev: MouseEvent) => {
            this.newMousePosition.set(ev.pageX, ev.pageY);
            this.MouseMoveEvent.invoke({ evt: ev, mousePosition: this.newMousePosition });
        });

        domElement.addEventListener('mousedown', (ev: MouseEvent) => {
            const mouseButton = <MouseButton>ev.button;
            if (this.mouseKeyStates[mouseButton] !== KeyState.Pressed) {
                this.mouseKeyStates[ev.button] = KeyState.Down;
                this.downMouseKeys.push(ev.button);
            }
        });

        domElement.addEventListener('mouseup', (ev: MouseEvent) => {
            const mouseButton = <MouseButton>ev.button;
            this.mouseKeyStates[ev.button] = KeyState.Up;
            this.upMouseKeys.push(ev.button);
        });

        domElement.addEventListener('wheel', (ev: WheelEvent) => {
            this.MouseWheelEvent.invoke({ evt: ev, mousePosition: this.mousePosition, wheelDelta: ev.deltaY });
            ev.preventDefault();
        }, { passive: false });
        
        domElement.addEventListener('contextmenu', (event) => event.preventDefault());
    }

    Update() {
        for (const downKey of this.downKeys) {
            this.keyStates[downKey] = KeyState.Pressed;
        }
        this.downKeys = [];

        for (const upKey of this.upKeys) {
            this.keyStates[upKey] = KeyState.None;
        }
        this.upKeys = [];

        for (const downMouseKey of this.downMouseKeys) {
            this.mouseKeyStates[downMouseKey] = KeyState.Pressed;
        }
        this.downMouseKeys = [];

        for (const upMouseKey of this.upMouseKeys) {
            this.mouseKeyStates[upMouseKey] = KeyState.None;
        }
        this.upMouseKeys = [];
    }

    IsMouseButtonDown(button: MouseButton) {
        return this.mouseKeyStates[button] === KeyState.Down || this.mouseKeyStates[button] === KeyState.Pressed;
    }

    IsDown(keycode: KeyCode) {
        return this.keyStates[keycode] === KeyState.Down || this.keyStates[keycode] === KeyState.Pressed;
    }

    IsJustDown(keycode: KeyCode) {
        return this.keyStates[keycode] === KeyState.Down;
    }

    reset() {
        this.keyStates = {};
        this.mouseKeyStates = {};
        this.downKeys = [];
        this.upKeys = [];
        this.downMouseKeys = [];
        this.upMouseKeys = [];
    }
}

export const inputManager = new InputManager();
