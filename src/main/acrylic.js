'use strict';

/**
 * Windows 10 亚克力（毛玻璃）背景。
 * Win10 没有 BrowserWindow.setBackgroundMaterial（Win11 才有），
 * 只能通过未文档化的 user32!SetWindowCompositionAttribute 实现。
 * 任何一步失败都返回 false，由渲染层降级为 CSS 半透明玻璃。
 */

const ACCENT_ENABLE_BLURBEHIND = 3;
const ACCENT_ENABLE_ACRYLICBLURBEHIND = 4;
const WCA_ACCENT_POLICY = 19;

let api = null;

function init() {
  if (api) return api;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');

  const ACCENT_POLICY = koffi.struct('ACCENT_POLICY', {
    AccentState: 'uint32',
    AccentFlags: 'uint32',
    GradientColor: 'uint32',
    AnimationId: 'uint32'
  });

  const WINDOWCOMPOSITIONATTRIBDATA = koffi.struct('WINDOWCOMPOSITIONATTRIBDATA', {
    Attrib: 'uint32',
    pvData: 'void *',
    cbData: 'size_t'
  });

  const SetWindowCompositionAttribute = user32.func(
    'bool __stdcall SetWindowCompositionAttribute(uint64 hwnd, WINDOWCOMPOSITIONATTRIBDATA *data)'
  );

  api = { koffi, ACCENT_POLICY, WINDOWCOMPOSITIONATTRIBDATA, SetWindowCompositionAttribute };
  return api;
}

/**
 * @param {import('electron').BrowserWindow} win
 * @param {{ tint?: [number, number, number], alpha?: number, state?: 'acrylic' | 'blur' }} opts
 */
function applyAcrylic(win, opts = {}) {
  const tint = opts.tint || [18, 18, 22];
  const alpha = typeof opts.alpha === 'number' ? opts.alpha : 0x18;

  try {
    const { koffi, ACCENT_POLICY, WINDOWCOMPOSITIONATTRIBDATA, SetWindowCompositionAttribute } = init();
    const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
    if (!hwnd) return false;

    // GradientColor 为 0xAABBGGRR
    const [r, g, b] = tint;
    const gradient = ((alpha & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);

    const policy = {
      AccentState:
        opts.state === 'none'
          ? 0
          : opts.state === 'blur'
            ? ACCENT_ENABLE_BLURBEHIND
            : ACCENT_ENABLE_ACRYLICBLURBEHIND,
      AccentFlags: 2,
      GradientColor: gradient >>> 0,
      AnimationId: 0
    };

    const data = {
      Attrib: WCA_ACCENT_POLICY,
      pvData: koffi.as(policy, 'ACCENT_POLICY *'),
      cbData: koffi.sizeof(ACCENT_POLICY)
    };

    return SetWindowCompositionAttribute(hwnd, data) === true;
  } catch (err) {
    console.warn('[acrylic] unavailable:', err.message);
    return false;
  }
}

module.exports = { applyAcrylic };
