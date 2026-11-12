﻿﻿﻿﻿﻿﻿﻿'use strict';

const $ = (id) => document.getElementById(id);

const STATE_LABEL = {
  connecting: '连接中',
  live: '实时',
  stale: '延迟',
  polling: '轮询',
  offline: '断开'
};

const S = {
  config: null,
  contracts: [],
  place: new Map(),
  prices: new Map(),
  feed: {
    link: 'connecting',
    state: 'connecting',
    detail: '',
    serverUrl: '',
    lastDataAt: 0
  },
  view: 'list',
  version: '',
  expanded: null,
  manual: false,
  limits: { minHeight: 140, maxHeight: 560 },
  flashTimers: new Map()
};

const base = (sym) => sym.replace(/USDT$/, '');

function fmtPrice(price, sym) {
  if (!Number.isFinite(price)) return '--';
  let place = Number(S.place.get(sym));
  if (!Number.isFinite(place)) {
    // 未拿到合约精度时按价格量级保留约 5 位有效数字，避免低价币被截成 0.000005
    place = price >= 1000 ? 2 : price >= 1 ? 4 : 5 - Math.floor(Math.log10(price)) - 1;
  }
  place = Math.max(0, Math.min(Math.round(place), 12));
  return price.toLocaleString('en-US', {
    minimumFractionDigits: place,
    maximumFractionDigits: place
  });
}

function fmtChange(v) {
  if (!Number.isFinite(v)) return '--';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

// ---------- 渲染 ----------

function renderCoins() {
  const rows = $('rows');
  rows.innerHTML = S.config.coins
    .map(
      (sym) => `
      <div class="row" data-sym="${sym}">
        <div class="sym">${base(sym)}<span class="quote">USDT</span></div>
        <div class="price">--</div>
        <div class="chg">--</div>
      </div>`
    )
    .join('');
  const view = combinedState();
  $('list').classList.toggle('stale', view.cls !== 'live');
  $('list').classList.toggle('link-off', (S.feed.link || '') === 'offline');
  for (const sym of S.config.coins) {
    const t = S.prices.get(sym);
    if (t) paint(sym, t, false);
  }
  renderDetail();
}

function detailInner(sym) {
  const t = S.prices.get(sym);
  if (!t) return '<span>等待行情…</span>';
  return `<span>24h 高 <b>${fmtPrice(t.high24h, sym)}</b></span><span>24h 低 <b>${fmtPrice(
    t.low24h,
    sym
  )}</b></span>`;
}

function renderDetail() {
  document.querySelectorAll('.detail').forEach((n) => n.remove());
  document.querySelectorAll('.row.active').forEach((n) => n.classList.remove('active'));
  if (!S.expanded) return;
  const row = document.querySelector(`.row[data-sym="${S.expanded}"]`);
  if (!row) {
    S.expanded = null;
    return;
  }
  row.classList.add('active');
  row.insertAdjacentHTML(
    'afterend',
    `<div class="detail" data-detail="${S.expanded}">${detailInner(S.expanded)}</div>`
  );
}

function paint(sym, t, animate = true) {
  const row = document.querySelector(`.row[data-sym="${sym}"]`);
  if (!row) return;
  const prev = S.prices.get(sym);
  const priceEl = row.querySelector('.price');
  const chgEl = row.querySelector('.chg');
  if (!priceEl) return;

  priceEl.textContent = fmtPrice(t.price, sym);
  chgEl.textContent = fmtChange(t.change24h);
  chgEl.classList.toggle('up', t.change24h > 0);
  chgEl.classList.toggle('down', t.change24h < 0);

  if (animate && prev && Number.isFinite(prev.price) && t.price !== prev.price) {
    const cls = t.price > prev.price ? 'flash-up' : 'flash-down';
    row.classList.remove('flash-up', 'flash-down');
    void row.offsetWidth;
    row.classList.add(cls);
    clearTimeout(S.flashTimers.get(sym));
    S.flashTimers.set(
      sym,
      setTimeout(() => row.classList.remove('flash-up', 'flash-down'), 480)
    );
  }

  const detail = document.querySelector(`.detail[data-detail="${sym}"]`);
  if (detail) detail.innerHTML = detailInner(sym);
}

// 综合「客户端到服务器」和「服务器到上游」两层状态
function combinedState() {
  const link = S.feed.link || 'connecting';
  const st = S.feed.state || 'connecting';
  if (link === 'offline') return { cls: 'offline', text: '服务不可达' };
  if (link === 'connecting') return { cls: 'connecting', text: '连接服务器' };
  if (st === 'live') return { cls: 'live', text: '实时' };
  if (st === 'offline') return { cls: 'offline', text: '上游断开' };
  return { cls: st === 'polling' ? 'polling' : 'stale', text: STATE_LABEL[st] || st };
}

function renderStatus() {
  const view = combinedState();
  const dot = $('dot');
  dot.className = `dot ${view.cls}`;
  $('statusText').textContent = view.text;

  const parts = [];
  if (S.feed.serverUrl) parts.push(`服务器 ${S.feed.serverUrl}`);
  parts.push(`行情 ${STATE_LABEL[S.feed.state] || S.feed.state}`);
  if (S.feed.lastDataAt) {
    parts.push(
      `最近数据 ${new Date(S.feed.lastDataAt).toLocaleTimeString('zh-CN', { hour12: false })}`
    );
  }
  if (S.feed.detail) parts.push(S.feed.detail);
  dot.title = parts.join('｜');

  $('list').classList.toggle('stale', view.cls !== 'live');
  $('list').classList.toggle('link-off', (S.feed.link || '') === 'offline');
}

function syncHeight() {
  if (S.manual) return;
  requestAnimationFrame(() => {
    if (S.manual) return;
    const app = $('app');
    const rows = $('rows');
    rows.style.maxHeight = '';
    rows.style.overflowY = 'hidden';
    // 先去掉 min-height:100%，否则量到的是当前窗口高度而不是内容高度，窗口只能长不能缩
    app.style.minHeight = '0';

    let h = Math.ceil(app.getBoundingClientRect().height);
    const max = S.limits.maxHeight || 560;

    if (h > max) {
      const rowsH = rows.getBoundingClientRect().height;
      const fixed = h - rowsH;
      rows.style.maxHeight = `${Math.max(60, Math.round(max - fixed))}px`;
      rows.style.overflowY = 'auto';
      h = Math.ceil(app.getBoundingClientRect().height);
    }

    app.style.minHeight = '';
    window.api.resize(Math.max(S.limits.minHeight || 140, h));
  });
}

function setView(view) {
  S.view = view;
  $('list').classList.toggle('hidden', view !== 'list');
  $('searchView').classList.toggle('hidden', view !== 'search');
  syncHeight();
}

// ---------- 搜索 ----------

function showSearch() {
  setView('search');
  $('q').value = '';
  runSearch('');
  $('q').focus();
}

let searchTimer = null;

async function runSearch(q) {
  const list = await window.api.search(q);
  const box = $('results');
  if (!list.length) {
    box.innerHTML = '<div class="empty">没有匹配的 USDT 合约</div>';
    return;
  }
  box.innerHTML = list
    .map(
      (c) => `<button class="result" data-add="${c.symbol}">
        <span class="name">${c.base}</span>
        <span class="full">${c.symbol}</span>
      </button>`
    )
    .join('');
  syncHeight();
}


// ---------- 事件 ----------

function flashAlert(a) {
  const row = document.querySelector(`.row[data-sym="${a.symbol}"]`);
  if (!row) return;
  row.classList.add(a.kind === 'up' ? 'alert-up' : 'alert-down');
  setTimeout(() => row.classList.remove('alert-up', 'alert-down'), 3000);
}

function bind() {
  $('btnAdd').onclick = () => (S.view === 'search' ? setView('list') : showSearch());
  $('btnSet').onclick = () => window.api.toggleSettings();
  $('btnClose').onclick = () => window.api.close();
  $('btnPin').onclick = () => {
    const next = !S.config.alwaysOnTop;
    S.config.alwaysOnTop = next;
    $('btnPin').classList.toggle('active', next);
    window.api.setConfig({ alwaysOnTop: next });
  };
  $('btnPin').classList.toggle('active', !!S.config.alwaysOnTop);

  $('results').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    window.api.add(btn.dataset.add);
    setView('list');
  });

  $('q').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => runSearch(v), 120);
  });

  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setView('list');
  });

  $('searchBack').onclick = () => setView('list');

  $('grip').addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.api.resizeStart();
  });

  // 行：单击展开详情，按住上下拖动排序
  let press = null;

  $('rows').addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const row = e.target.closest('.row');
    if (!row) return;
    press = { row, y: e.clientY, moved: false, sym: row.dataset.sym };
  });

  document.addEventListener('mousemove', (e) => {
    if (!press) return;
    if (!press.moved && Math.abs(e.clientY - press.y) > 6) {
      press.moved = true;
      if (S.expanded) {
        S.expanded = null;
        renderDetail();
      }
      press.row.classList.add('dragging');
    }
    if (!press.moved) return;

    const list = $('rows');
    const others = Array.from(list.querySelectorAll('.row')).filter((r) => r !== press.row);
    let ref = null;
    for (const r of others) {
      const box = r.getBoundingClientRect();
      if (e.clientY < box.top + box.height / 2) {
        ref = r;
        break;
      }
    }
    list.insertBefore(press.row, ref);
  });

  document.addEventListener('mouseup', () => {
    if (!press) return;
    const { row, moved, sym } = press;
    row.classList.remove('dragging');
    press = null;

    if (moved) {
      const order = Array.from($('rows').querySelectorAll('.row')).map((r) => r.dataset.sym);
      window.api.reorder(order);
      syncHeight();
    } else {
      S.expanded = S.expanded === sym ? null : sym;
      renderDetail();
      syncHeight();
    }
  });

  ['mousedown', 'click'].forEach((type) => {
    document.addEventListener(
      type,
      (e) => {
        const t = e.target || {};
        window.api.diag({
          type,
          x: e.clientX,
          y: e.clientY,
          el: t.id || t.className || t.tagName || ''
        });
      },
      true
    );
  });

  window.api.onPrices((batch) => {
    for (const t of batch) {
      S.prices.set(t.symbol, t);
      paint(t.symbol, t, true);
    }
  });

  window.api.onState((s) => {
    S.feed = { ...S.feed, ...s };
    renderStatus();
  });

  window.api.onContracts((list) => {
    S.contracts = list;
    S.place.clear();
    for (const c of list) S.place.set(c.symbol, c.pricePlace);
    for (const sym of S.config.coins) {
      const t = S.prices.get(sym);
      if (t) paint(sym, t, false);
    }
  });

  window.api.onConfig((cfg) => {
    const coinsChanged =
      JSON.stringify(cfg.coins) !== JSON.stringify(S.config?.coins || []);
    S.config = cfg;
    document.documentElement.style.setProperty(
      '--panel-alpha',
      String(cfg.panelAlpha ?? 0.55)
    );
    S.manual = !!cfg.manualSize;
    $('app').classList.toggle('manual', S.manual);
    if (S.manual) {
      $('rows').style.maxHeight = '';
      $('rows').style.overflowY = '';
    }
    if (coinsChanged) {
      renderCoins();
      syncHeight();
    }
    $('btnPin').classList.toggle('active', !!cfg.alwaysOnTop);
  });

  window.api.onAlert((a) => flashAlert(a));

  window.api.onSettingsVisible((visible) => {
    $('btnSet').classList.toggle('active', visible);
  });

  window.api.onOpenSearch(() => showSearch());
}

// ---------- 启动 ----------

(async function init() {
  const boot = await window.api.boot();
  S.config = boot.config;
  S.version = boot.version || '';
  if (boot.limits) S.limits = boot.limits;
  S.manual = !!boot.config.manualSize;
  $('app').classList.toggle('manual', S.manual);
  if (boot.snapshot) {
    S.feed = {
      link: boot.snapshot.link || 'connecting',
      state: boot.snapshot.state || 'connecting',
      detail: boot.snapshot.detail || '',
      serverUrl: boot.snapshot.serverUrl || boot.config.serverUrl || '',
      lastDataAt: Number(boot.snapshot.lastDataAt) || 0
    };
    if (boot.snapshot.contracts?.length) {
      S.contracts = boot.snapshot.contracts;
      for (const c of S.contracts) S.place.set(c.symbol, c.pricePlace);
    }
  }
  for (const t of boot.prices) S.prices.set(t.symbol, t);

  document.documentElement.style.setProperty(
    '--panel-alpha',
    String(S.config.panelAlpha ?? 0.55)
  );

  bind();
  renderCoins();
  renderStatus();
  syncHeight();
})();
