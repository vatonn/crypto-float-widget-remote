'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  width: 320,
  coins: ['BTCUSDT', 'ETHUSDT', 'PEPEUSDT', 'NVDAUSDT'],
  alwaysOnTop: true,
  acrylic: true,
  blur: false,
  manualSize: false,
  size: null,
  panelAlpha: 0.55,
  serverUrl: 'http://127.0.0.1:8787',
  rapidMove: { pct: 1, windowSec: 60, cooldownSec: 300 },
  priceAlerts: {},
  position: null
};

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'config.json');
    this.data = { ...DEFAULTS };
    this.timer = null;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...DEFAULTS, ...raw };
      this.data.rapidMove = { ...DEFAULTS.rapidMove, ...(raw.rapidMove || {}) };
      this.data.priceAlerts = raw.priceAlerts || {};
    } catch {
      this.data = { ...DEFAULTS };
    }
  }

  get(key) {
    return key ? this.data[key] : this.data;
  }

  set(patch) {
    this.data = { ...this.data, ...patch };
    this.save();
    return this.data;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
      } catch (err) {
        console.error('[store] save failed', err.message);
      }
    }, 300);
  }
}

module.exports = Store;
