'use strict';

const { EventEmitter } = require('node:events');
const http = require('node:http');
const https = require('node:https');
const WebSocket = require('ws');

const FEED_STATE_LABEL = {
  connecting: '连接中',
  live: '实时',
  stale: '延迟',
  polling: '轮询',
  offline: '断开'
};

/** 接受 1.2.3.4:8787 / http://host:port / ws://host:port，统一成 http(s) 基址 */
function normalizeBase(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  s = s.replace(/^ws(s?):\/\//i, 'http$1://');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s.replace(/\/+$/, '');
}

function wsUrlOf(base) {
  return `${base.replace(/^http/i, 'ws')}/ws`;
}

function requestJson(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      reject(new Error('地址格式不正确'));
      return;
    }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(
      u,
      { timeout, headers: { Accept: 'application/json' } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('响应不是合法 JSON'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

class RemoteFeed extends EventEmitter {
  constructor({ serverUrl = '', coins = [] } = {}) {
    super();
    this.base = normalizeBase(serverUrl);
    this.coins = coins.slice();

    this.ws = null;
    this.link = 'connecting'; // connecting | online | offline（客户端到后端）
    this.state = 'connecting'; // 后端到 Bitget：connecting/live/stale/polling/offline
    this.detail = '';
    this.lastDataAt = 0;
    this.lastMessageAt = 0;

    this.contracts = [];
    this.pricePlace = new Map();

    this.attempt = 0;
    this.stopped = false;

    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.pongTimer = null;
    this.watchTimer = null;
  }

  // ---------- 生命周期 ----------

  get running() {
    return !!(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  async start() {
    this.stopped = false;
    this.attempt = 0;
    this.clearTimers();
    this.connect();
    this.watchTimer = setInterval(() => this.watch(), 1000);
    if (!this.base) this.setLink('offline', '未配置服务器地址');
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    this.cleanupSocket();
  }

  async restart(serverUrl, coins) {
    if (serverUrl !== undefined) this.base = normalizeBase(serverUrl);
    if (coins) this.coins = coins.slice();
    this.stop();
    await this.start();
  }

  clearTimers() {
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.pongTimer);
    clearInterval(this.watchTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.pongTimer = null;
    this.watchTimer = null;
  }

  // ---------- 连接 ----------

  connect() {
    if (this.stopped) return;
    this.cleanupSocket();

    if (!this.base) {
      this.setLink('offline', '未配置服务器地址');
      return;
    }

    this.setLink('connecting');
    const url = wsUrlOf(this.base);
    let ws;
    try {
      ws = new WebSocket(url, { handshakeTimeout: 8000, perMessageDeflate: false });
    } catch (err) {
      this.emit('log', `连接创建失败：${err.message}`);
      this.setLink('offline', err.message);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      this.setLink('online');
      // 重连后需要重新声明自定义订阅；默认订阅由服务端 COINS 提供
      if (this.coins.length) {
        ws.send(JSON.stringify({ op: 'subscribe', symbols: this.coins }));
      }
      this.startHeartbeat();
      this.emit('log', `已连接 ${url}`);
    });

    ws.on('message', (buf) => this.onMessage(buf));

    ws.on('close', () => {
      this.stopHeartbeat();
      this.setLink('offline', '与服务器的连接已断开');
      this.scheduleReconnect();
    });

    ws.on('error', (err) => this.emit('log', `连接错误：${err.message}`));
  }

  cleanupSocket() {
    if (!this.ws) return;
    try {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.terminate();
      }
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  scheduleReconnect() {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    this.attempt = Math.min(this.attempt + 1, 5);
    const delay = Math.min(15000, 1000 * 2 ** (this.attempt - 1)) + Math.floor(Math.random() * 300);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.running) return;
      this.ws.send(JSON.stringify({ op: 'ping' }));
      clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        this.emit('log', '心跳超时，重建连接');
        this.setLink('offline', '服务器无响应');
        this.cleanupSocket();
        this.scheduleReconnect();
      }, 8000);
    }, 20000);
  }

  stopHeartbeat() {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.pongTimer);
    this.heartbeatTimer = null;
    this.pongTimer = null;
  }

  watch() {
    if (this.link !== 'online') return;
    // 长时间没有任何消息（含 prices）说明链路可能已僵死
    if (this.lastMessageAt && Date.now() - this.lastMessageAt > 30000) {
      this.emit('log', '长时间未收到服务器消息，重建连接');
      this.setLink('offline', '服务器长时间无消息');
      this.cleanupSocket();
      this.scheduleReconnect();
    }
  }

  // ---------- 消息 ----------

  onMessage(buf) {
    const text = typeof buf === 'string' ? buf : buf.toString('utf8');
    this.lastMessageAt = Date.now();

    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'snapshot':
        if (msg.state !== undefined) this.applyState(msg);
        if (Array.isArray(msg.contracts) && msg.contracts.length) this.applyContracts(msg.contracts);
        if (Array.isArray(msg.prices)) {
          for (const t of msg.prices) this.applyTicker(t);
        }
        break;

      case 'prices':
        if (Array.isArray(msg.data)) {
          for (const t of msg.data) this.applyTicker(t);
        }
        break;

      case 'state':
        this.applyState(msg);
        if (Array.isArray(msg.contracts) && msg.contracts.length) this.applyContracts(msg.contracts);
        break;

      case 'contracts':
        if (Array.isArray(msg.data)) this.applyContracts(msg.data);
        break;

      case 'pong':
        clearTimeout(this.pongTimer);
        break;

      case 'error':
        this.emit('log', `服务器返回错误：${msg.message}`);
        break;

      default:
        break;
    }
  }

  applyState(msg) {
    if (msg.state && msg.state !== this.state) this.state = msg.state;
    if (typeof msg.detail === 'string') this.detail = msg.detail;
    if (Number.isFinite(msg.lastDataAt)) this.lastDataAt = msg.lastDataAt;
    this.emit('state', this.statePayload());
  }

  applyTicker(t) {
    if (!t || !t.symbol || !Number.isFinite(Number(t.price))) return;
    const price = Number(t.price);
    this.lastDataAt = Math.max(this.lastDataAt, Number(t.ts) || Date.now());
    this.emit('ticker', {
      symbol: t.symbol,
      price,
      change24h: Number(t.change24h),
      high24h: Number(t.high24h),
      low24h: Number(t.low24h),
      ts: Number(t.ts) || Date.now()
    });
  }

  applyContracts(list) {
    this.contracts = list.map((c) => ({
      symbol: c.symbol,
      base: c.base || String(c.symbol).replace(/USDT$/, ''),
      pricePlace: Number(c.pricePlace)
    }));
    this.pricePlace.clear();
    for (const c of this.contracts) this.pricePlace.set(c.symbol, c.pricePlace);
    this.emit('contracts', this.contracts);
  }

  // ---------- 订阅 ----------

  setCoins(next) {
    const before = new Set(this.coins);
    const after = new Set(next);
    const added = next.filter((s) => !before.has(s));
    const removed = this.coins.filter((s) => !after.has(s));
    this.coins = next.slice();
    if (!this.running) return;
    if (added.length) this.ws.send(JSON.stringify({ op: 'subscribe', symbols: added }));
    if (removed.length) this.ws.send(JSON.stringify({ op: 'unsubscribe', symbols: removed }));
  }

  // ---------- HTTP ----------

  async api(pathname) {
    if (!this.base) throw new Error('未配置服务器地址');
    return requestJson(`${this.base}${pathname}`);
  }

  async search(query) {
    const q = String(query || '').trim();
    const json = await this.api(`/api/search?q=${encodeURIComponent(q)}`);
    return Array.isArray(json.data) ? json.data : [];
  }

  // ---------- 状态 ----------

  setLink(link, detail = '') {
    const changed = this.link !== link || (detail && detail !== this.detail);
    this.link = link;
    if (detail) this.detail = detail;
    if (changed) this.emit('state', this.statePayload());
  }

  statePayload() {
    return {
      link: this.link,
      state: this.state,
      detail: this.detail,
      serverUrl: this.base,
      lastDataAt: this.lastDataAt,
      at: Date.now()
    };
  }

  snapshot() {
    return {
      link: this.link,
      state: this.state,
      detail: this.detail,
      serverUrl: this.base,
      lastDataAt: this.lastDataAt,
      coins: this.coins.slice(),
      contracts: this.contracts
    };
  }
}

/** 测试服务器：GET /health，返回可读结果 */
async function testServer(serverUrl) {
  const base = normalizeBase(serverUrl);
  if (!base) return { ok: false, error: '请填写服务器地址' };
  try {
    const health = await requestJson(`${base}/health`, 6000);
    let detail = '';
    let lastDataAt = Number(health.lastDataAt) || 0;
    if (!lastDataAt) {
      try {
        const st = await requestJson(`${base}/api/state`, 6000);
        detail = st.detail || '';
        lastDataAt = Number(st.lastDataAt) || 0;
      } catch {
        /* 详情失败不影响探活结果 */
      }
    }
    return {
      ok: true,
      base,
      state: health.state || 'connecting',
      detail,
      lastDataAt,
      uptimeSec: health.uptimeSec,
      clients: health.clients,
      coins: health.coins || []
    };
  } catch (err) {
    return { ok: false, base, error: err.message || '无法连接' };
  }
}

module.exports = { RemoteFeed, testServer, normalizeBase, wsUrlOf, FEED_STATE_LABEL };
