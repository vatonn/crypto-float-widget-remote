'use strict';

/** 鼠标左键是否按住（用于自绘的窗口缩放）。 */
let GetAsyncKeyState = null;

function load() {
  if (GetAsyncKeyState) return;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)');
}

function isLeftButtonDown() {
  try {
    load();
    return GetAsyncKeyState(0x01) < 0;
  } catch {
    return false;
  }
}

module.exports = { isLeftButtonDown };
