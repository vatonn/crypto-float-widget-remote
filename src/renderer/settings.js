'use strict';

const $ = (id) => document.getElementById(id);

const FEED_LABEL = {
  connecting: '连接中',
  live: '实时',
  stale: '延迟',
  polling: '轮询',
  offline: '断开'
};

const S = {
  config: null,
  version: '',
  feed: { link: 'connecting', state: 'connecting', detail: '', serverUrl: '', lastDataAt: 0 }
};

const base = (sym) => sym.replace(/USDT$/, '');

function syncHeight() {
  requestAnimationFrame(() => {
    const h = Math.ceil($('app').getBoundingClientRect().height);
    window.api.settingsResize(h);
  });
}

function coinItems(cfg) {
  return cfg.coins
    .map(
      (sym) =>
        `<span class="coin-item">${base(sym)}<button data-remove="${sym}" title="移除">×</button></span>`
    )
    .join('');
}

function alertRows(cfg) {
  return cfg.coins
    .map(
      (sym) => `
      <span class="sym">${base(sym)}</span>
      <input type="number" data-above="${sym}" placeholder="高于" value="${
        cfg.priceAlerts?.[sym]?.above || ''
      }" />
      <input type="number" data-below="${sym}" placeholder="低于" value="${
        cfg.priceAlerts?.[sym]?.below || ''
      }" />`
    )
    .join('');
}

function dotClass(feed) {
  const link = feed.link || 'connecting';
  if (link === 'offline') return 'offline';
  if (link === 'connecting') return 'connecting';
  return feed.state === 'live' ? 'live' : feed.state === 'offline' ? 'offline' : 'stale';
}

function statusLabel(feed) {
  const link = feed.link || 'connecting';
  if (link === 'offline') return '未连接';
  if (link === 'connecting') return '连接中…';
  return `已连接 · 行情${FEED_LABEL[feed.state] || feed.state}`;
}

function render() {
  const cfg = S.config;

  $('ver').textContent = S.version ? ` v${S.version}` : '';

  $('body').innerHTML = `
    <div class="set-row">
      <label>面板不透明度</label>
      <div class="control"><input type="range" id="optAlpha" min="15" max="100" value="${Math.round(
        (cfg.panelAlpha ?? 0.55) * 100
      )}" /></div>
    </div>
    <div class="set-row">
      <label>桌面模糊（圆角外会有灰边）</label>
      <div class="control"><input type="checkbox" id="optBlur" ${cfg.blur ? 'checked' : ''} /></div>
    </div>
    <div class="set-row">
      <label>窗口大小</label>
      <div class="control"><span class="value">${
        cfg.manualSize ? '手动拖拽' : '自适应内容'
      }</span></div>
    </div>
    <button class="btn" id="sizeAuto">恢复自适应大小</button>

    <div class="set-block">
      <div class="set-title">服务器</div>
      <div class="srv-row">
        <input type="text" id="optServer" placeholder="http://192.168.1.10:8787" value="${
          cfg.serverUrl || ''
        }" spellcheck="false" />
        <button class="btn" id="btnApply">连接</button>
      </div>
      <div class="srv-status">
        <span class="dot ${dotClass(S.feed)}" id="srvDot"></span>
        <span id="srvText">${statusLabel(S.feed)}</span>
        <span class="value" id="srvData"></span>
      </div>
      <div class="hint" id="srvHint"></div>
    </div>

    <div class="set-row">
      <label>急涨急跌阈值（60 秒内）</label>
      <div class="control"><input type="number" id="optRapid" step="0.1" min="0.1" value="${
        cfg.rapidMove?.pct ?? 1
      }" /> %</div>
    </div>

    <div class="set-block">
      <div class="set-title">已显示币种</div>
      <div class="coin-manage" id="coinManage">${coinItems(cfg)}</div>
      <button class="btn" id="manageAdd">＋ 添加币种</button>
    </div>

    <div class="set-block">
      <div class="set-title">价格提醒（留空表示不提醒）</div>
      <div class="alert-grid" id="alertGrid">${alertRows(cfg)}</div>
    </div>
  `;

  bind();
  refreshStatus();
  syncHeight();
}

function refreshStatus() {
  const dot = $('srvDot');
  const text = $('srvText');
  const data = $('srvData');
  if (!dot || !text) return;
  dot.className = `dot ${dotClass(S.feed)}`;
  text.textContent = statusLabel(S.feed);
  if (data) {
    data.textContent = S.feed.lastDataAt
      ? `最近数据 ${new Date(S.feed.lastDataAt).toLocaleTimeString('zh-CN', { hour12: false })}`
      : '';
  }
}

function bind() {
  $('btnClose').onclick = () => window.api.closeSettings();

  $('optAlpha').oninput = (e) => {
    const v = Number(e.target.value) / 100;
    document.documentElement.style.setProperty('--panel-alpha', String(v));
    window.api.setConfig({ panelAlpha: v });
  };

  $('optBlur').onchange = (e) => window.api.setConfig({ blur: e.target.checked });

  $('sizeAuto').onclick = async () => {
    await window.api.setConfig({ manualSize: false });
    render();
  };

  $('btnApply').onclick = async () => {
    const input = $('optServer');
    const btn = $('btnApply');
    const hint = $('srvHint');
    const url = input.value.trim();

    if (!url) {
      hint.className = 'hint bad';
      hint.textContent = '请填写服务器地址';
      return;
    }

    btn.disabled = true;
    btn.textContent = '连接中';
    hint.className = 'hint';
    hint.textContent = '正在测试服务器…';

    const r = await window.api.testServer(url);
    if (r && r.ok) {
      const saved = r.base || url;
      await window.api.setConfig({ serverUrl: saved });
      input.value = saved;
      hint.className = 'hint ok';
      hint.textContent = `服务器可用（行情${FEED_LABEL[r.state] || r.state}），已保存并连接`;
    } else {
      hint.className = 'hint bad';
      hint.textContent = `连接失败：${r?.error || '无法访问服务器'}，地址未保存`;
    }

    btn.disabled = false;
    btn.textContent = '连接';
    syncHeight();
  };

  $('optServer').onkeydown = (e) => {
    if (e.key === 'Enter') $('btnApply').click();
  };

  $('optRapid').onchange = (e) => {
    const pct = Math.max(0.1, Number(e.target.value) || 1);
    window.api.setConfig({ rapidMove: { ...S.config.rapidMove, pct } });
  };

  $('manageAdd').onclick = () => {
    window.api.openSearch();
    window.api.closeSettings();
  };

  $('coinManage').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    if (S.config.coins.length <= 1) return;
    window.api.remove(btn.dataset.remove);
  });

  document.querySelectorAll('#alertGrid input').forEach((input) => {
    input.onchange = () => {
      const sym = input.dataset.above || input.dataset.below;
      const above = document.querySelector(`input[data-above="${sym}"]`).value;
      const below = document.querySelector(`input[data-below="${sym}"]`).value;
      window.api.setAlert({ symbol: sym, above, below });
    };
  });
}

function updateCoins() {
  const manage = $('coinManage');
  if (manage) manage.innerHTML = coinItems(S.config);
  const grid = $('alertGrid');
  if (grid) grid.innerHTML = alertRows(S.config);
  syncHeight();
}

(async function init() {
  const boot = await window.api.boot();
  S.config = boot.config;
  S.version = boot.version || '';
  if (boot.snapshot) {
    S.feed = {
      link: boot.snapshot.link || 'connecting',
      state: boot.snapshot.state || 'connecting',
      detail: boot.snapshot.detail || '',
      serverUrl: boot.snapshot.serverUrl || S.config.serverUrl || '',
      lastDataAt: Number(boot.snapshot.lastDataAt) || 0
    };
  }
  document.documentElement.style.setProperty(
    '--panel-alpha',
    String(S.config.panelAlpha ?? 0.55)
  );
  render();

  window.api.onConfig((cfg) => {
    const coinsChanged =
      JSON.stringify(cfg.coins) !== JSON.stringify(S.config?.coins || []);
    S.config = cfg;
    if (coinsChanged) updateCoins();
  });

  window.api.onState((s) => {
    S.feed = { ...S.feed, ...s };
    refreshStatus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.api.closeSettings();
  });
})();
