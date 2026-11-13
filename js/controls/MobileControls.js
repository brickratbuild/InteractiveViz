// ------------------------------------------------------------------
//  MobileControls.js
//  Virtual joystick (left zone) + touch-drag look (right zone)
//  + fullscreen button.
//
//  Usage:
//    const mobile = new MobileControls(renderer.domElement);
//    fpController.setMobileMode(mobile);
//
//  Each frame the FirstPersonController calls:
//    mobile.getMoveInput()      → { x, z } in [-1, 1]
//    mobile.consumeLookDelta()  → { dx, dy } pixels accumulated since last call
// ------------------------------------------------------------------

const JOYSTICK_MAX_R       = 52;   // max knob displacement from centre (px)
const TOUCH_LOOK_SENS      = 0.005; // radians per pixel of swipe
const LEFT_ZONE_FRACTION   = 0.45; // left 45 % = joystick zone

export class MobileControls {
  constructor(canvas) {
    this._canvas = canvas;

    // Movement output (normalised)
    this._moveInput = { x: 0, z: 0 };

    // Look delta accumulated between frames
    this._lookDelta = { dx: 0, dy: 0 };

    // Joystick touch tracking
    this._joyId     = null; // active touch identifier
    this._joyOrigin = { x: 0, y: 0 };

    // Look touch tracking
    this._lookId   = null;
    this._lookLast = { x: 0, y: 0 };

    // DOM handles
    this._base = document.getElementById('joystick-base');
    this._knob = document.getElementById('joystick-knob');

    // Zone hint handles
    this._hintLeft      = document.getElementById('zone-hint-left');
    this._hintRight     = document.getElementById('zone-hint-right');
    this._hintHideTimer = null;

    this._bindTouchEvents();
    this._bindFullscreen();
  }

  // ------------------------------------------------------------------
  //  Public API — called by FirstPersonController every frame
  // ------------------------------------------------------------------

  /** Returns the current normalised move vector { x, z } ∈ [-1, 1]. */
  getMoveInput() {
    return { x: this._moveInput.x, z: this._moveInput.z };
  }

  /** Returns accumulated look delta and resets it to zero. */
  consumeLookDelta() {
    const d = { dx: this._lookDelta.dx, dy: this._lookDelta.dy };
    this._lookDelta.dx = 0;
    this._lookDelta.dy = 0;
    return d;
  }

  /** Expose look sensitivity so FirstPersonController can read it. */
  getLookSensitivity() {
    return TOUCH_LOOK_SENS;
  }

  /** Release active gestures so returning home cannot continue an old drag. */
  reset() {
    this._joyId = null;
    this._lookId = null;
    this._moveInput.x = 0;
    this._moveInput.z = 0;
    this._lookDelta.dx = 0;
    this._lookDelta.dy = 0;
    this._hideBase();
    this._setKnob(0, 0);
    clearTimeout(this._hintHideTimer);
    this._hintHideTimer = null;
    if (this._hintLeft) this._hintLeft.style.opacity = '0';
    if (this._hintRight) this._hintRight.style.opacity = '0';
  }

  // ------------------------------------------------------------------
  //  Touch event binding
  // ------------------------------------------------------------------

  _isLeftZone(clientX) {
    return clientX < window.innerWidth * LEFT_ZONE_FRACTION;
  }

  _bindTouchEvents() {
    const opts = { passive: false };
    this._canvas.addEventListener('touchstart',  e => this._onStart(e),  opts);
    this._canvas.addEventListener('touchmove',   e => this._onMove(e),   opts);
    this._canvas.addEventListener('touchend',    e => this._onEnd(e),    opts);
    this._canvas.addEventListener('touchcancel', e => this._onEnd(e),    opts);
  }

  _onStart(e) {
    e.preventDefault();
    // Show zone hints
    clearTimeout(this._hintHideTimer);
    this._hintHideTimer = null;
    if (this._hintLeft)  this._hintLeft.style.opacity  = '0.18';
    if (this._hintRight) this._hintRight.style.opacity = '0.18';

    for (const t of e.changedTouches) {
      if (this._isLeftZone(t.clientX) && this._joyId === null) {
        // Claim this touch as the joystick
        this._joyId     = t.identifier;
        this._joyOrigin = { x: t.clientX, y: t.clientY };
        this._showBase(t.clientX, t.clientY);
        this._setKnob(0, 0);

      } else if (!this._isLeftZone(t.clientX) && this._lookId === null) {
        // Claim this touch as the look drag
        this._lookId   = t.identifier;
        this._lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }

  _onMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {

      // ── Joystick ────────────────────────────────────────────
      if (t.identifier === this._joyId) {
        const dx  = t.clientX - this._joyOrigin.x;
        const dy  = t.clientY - this._joyOrigin.y;
        const len = Math.sqrt(dx * dx + dy * dy);

        if (len === 0) { this._moveInput.x = 0; this._moveInput.z = 0; continue; }

        const clamped = Math.min(len, JOYSTICK_MAX_R);
        const angle   = Math.atan2(dy, dx);
        const norm    = clamped / JOYSTICK_MAX_R;

        // kx/ky are the pixel offsets for the knob visual
        this._setKnob(Math.cos(angle) * clamped, Math.sin(angle) * clamped);

        // Move input: screen-right → strafe right (x+), screen-down → walk back (z+)
        this._moveInput.x = Math.cos(angle) * norm;
        this._moveInput.z = Math.sin(angle) * norm;
      }

      // ── Look drag ───────────────────────────────────────────
      if (t.identifier === this._lookId) {
        this._lookDelta.dx += t.clientX - this._lookLast.x;
        this._lookDelta.dy += t.clientY - this._lookLast.y;
        this._lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }

  _onEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this._joyId) {
        this._joyId       = null;
        this._moveInput.x = 0;
        this._moveInput.z = 0;
        this._hideBase();
      }
      if (t.identifier === this._lookId) {
        this._lookId = null;
      }
    }
    // Fade out hints once all touches are released
    if (this._joyId === null && this._lookId === null) {
      this._hintHideTimer = setTimeout(() => {
        if (this._hintLeft)  this._hintLeft.style.opacity  = '0';
        if (this._hintRight) this._hintRight.style.opacity = '0';
      }, 900);
    }
  }

  // ------------------------------------------------------------------
  //  Joystick DOM helpers
  // ------------------------------------------------------------------

  _showBase(cx, cy) {
    if (!this._base) return;
    // Centre the 140 px base circle on the touch point
    const half = 70;
    this._base.style.left    = (cx - half) + 'px';
    this._base.style.top     = (cy - half) + 'px';
    this._base.style.display = 'block';
  }

  _hideBase() {
    if (this._base) this._base.style.display = 'none';
  }

  /** Move knob by (dx, dy) pixels relative to base centre. */
  _setKnob(dx, dy) {
    if (!this._knob) return;
    this._knob.style.transform =
      `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  // ------------------------------------------------------------------
  //  Fullscreen button
  // ------------------------------------------------------------------

  _bindFullscreen() {
    const btn = document.getElementById('btnFullscreen');
    if (!btn) return;

    btn.addEventListener('click', e => {
      e.stopPropagation(); // don't let it bubble to the tap-to-start handler
      if (!document.fullscreenElement) {
        (document.documentElement.requestFullscreen ||
         document.documentElement.webkitRequestFullscreen ||
         (() => {})).call(document.documentElement).catch(() => {});
      } else {
        (document.exitFullscreen ||
         document.webkitExitFullscreen ||
         (() => {})).call(document).catch(() => {});
      }
    });

    const onFSChange = () => {
      const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
      const iconExpand   = btn.querySelector('.fs-expand');
      const iconCompress = btn.querySelector('.fs-compress');
      if (iconExpand)   iconExpand.style.display   = isFS ? 'none'  : 'block';
      if (iconCompress) iconCompress.style.display = isFS ? 'block' : 'none';
    };
    document.addEventListener('fullscreenchange',       onFSChange);
    document.addEventListener('webkitfullscreenchange', onFSChange);
  }
}
