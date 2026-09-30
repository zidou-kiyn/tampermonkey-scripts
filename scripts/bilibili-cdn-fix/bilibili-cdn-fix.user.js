// ==UserScript==
// @name         B站坏 CDN 节点绕过
// @namespace    https://github.com/zidou-kiyn/tampermonkey-scripts
// @version      2.0.0
// @description  拦截 playurl 响应，按设置屏蔽 PCDN / 第三方边缘节点，并把官方 upos 源切到测速最快的镜像；带悬浮设置面板
// @author       zidou-kiyn
// @license      MIT
// @homepageURL  https://github.com/zidou-kiyn/tampermonkey-scripts/tree/main/scripts/bilibili-cdn-fix
// @supportURL   https://github.com/zidou-kiyn/tampermonkey-scripts/issues
// @updateURL    https://raw.githubusercontent.com/zidou-kiyn/tampermonkey-scripts/main/scripts/bilibili-cdn-fix/bilibili-cdn-fix.user.js
// @downloadURL  https://raw.githubusercontent.com/zidou-kiyn/tampermonkey-scripts/main/scripts/bilibili-cdn-fix/bilibili-cdn-fix.user.js
// @match        *://www.bilibili.com/*
// @match        *://search.bilibili.com/*
// @match        *://space.bilibili.com/*
// @match        *://t.bilibili.com/*
// @match        *://m.bilibili.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[bili-cdn-fix]';
  const PLAYURL_RE = /\/(x\/player(\/wbi)?\/playurl|pgc\/player\/web(\/v2)?\/playurl|pugv\/player\/web\/playurl)/;

  // 测速候选的 upos 镜像（均为 B 站官方源站，签名不绑定镜像，可互换域名）
  const MIRRORS = [
    'upos-sz-mirror08c.bilivideo.com',
    'upos-sz-mirrorhw.bilivideo.com',
    'upos-sz-mirrorali.bilivideo.com',
    'upos-sz-mirroralio1.bilivideo.com',
    'upos-sz-mirrorcos.bilivideo.com',
    'upos-sz-mirrorcoso1.bilivideo.com',
    'upos-sz-mirrorbd.bilivideo.com',
    'upos-sz-estgoss.bilivideo.com',
    'upos-sz-mirrorhwo1.bilivideo.com',
    'upos-sz-mirrorcosov.bilivideo.com',
  ];
  const REWRITABLE = /^upos-[a-z0-9-]+\.bilivideo\.com$/i;
  const SPEED_TTL = 6 * 3600e3; // 自动测速结果的有效期
  const DEFAULT_CFG = { on: 1, bcache: 1, pcdn: 0, edge: 0, mirror: 'auto' };

  const KIND_NAME = { upos: '官方 upos', bcache: 'B站自建', pcdn: 'PCDN', edge: '第三方边缘' };

  // ===== 工具 =====
  const hostOf = (u) => { try { return new URL(u, location.href).hostname; } catch { return ''; } };
  const short = (h) => (h || '').replace(/^upos-sz-/, '').replace(/\.bilivideo\.com$/, '');
  const withHost = (u, h) => { const x = new URL(u, location.href); x.hostname = h; return x.href; };

  function kindOf(host) {
    if (/^upos-/i.test(host)) return 'upos';
    if (/\.mcdn\.bilivideo\.(cn|com)$|\.szbdyd\.com$/i.test(host)) return 'pcdn';
    if (/^cn-[a-z0-9]+-fx-/i.test(host)) return 'edge';
    if (/^cn-[a-z0-9]+-[a-z0-9]+-.*\.bilivideo\.(com|cn)$/i.test(host)) return 'bcache';
    return 'edge'; // mountaintoys 等其他未知域名
  }

  // ===== 设置（存在 .bilibili.com 的 cookie 里，各子站共享）=====
  function readCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
  }
  function writeCookie(name, val) {
    const domain = /(^|\.)bilibili\.com$/.test(location.hostname) ? '; domain=.bilibili.com' : '';
    document.cookie = `${name}=${encodeURIComponent(JSON.stringify(val))}; path=/; max-age=31536000${domain}; SameSite=Lax`;
  }
  const getCfg = () => Object.assign({}, DEFAULT_CFG, readCookie('bcf_cfg') || {});
  const setCfg = (c) => writeCookie('bcf_cfg', c);
  const getSpeed = () => readCookie('bcf_speed'); // { best, ts, r: { 短名: ms | -1 } }

  function allowed(kind, cfg) {
    return kind === 'upos' || (kind === 'bcache' && cfg.bcache) || (kind === 'pcdn' && cfg.pcdn) || (kind === 'edge' && cfg.edge);
  }
  function targetMirror(cfg) {
    if (cfg.mirror === 'keep') return null;
    if (cfg.mirror === 'auto') { const s = getSpeed(); return s && s.best ? s.best : null; }
    return cfg.mirror;
  }

  // ===== 页面状态（给面板显示）=====
  const stat = { replaced: 0, main: '', origKinds: new Set(), fallback: 0 };
  let ui = { update() {} }; // 面板挂载前的占位，避免首屏 __playinfo__ 处理时报错
  let sampleUpos = null; // 测速用的样本地址（必须是有效签名的 upos 视频地址）

  // ===== 改写单个流条目 =====
  function fixEntry(e, cfg, target, isVideo) {
    if (!e || typeof e !== 'object') return 0;
    const mainKeys = ['baseUrl', 'base_url', 'url'].filter((k) => k in e && e[k]);
    if (!mainKeys.length) return 0;
    const backKeys = ['backupUrl', 'backup_url'].filter((k) => k in e);
    const orig = [e[mainKeys[0]], ...((backKeys.length && e[backKeys[0]]) || [])].filter(Boolean);
    const list = [...new Set(orig)];

    stat.origKinds.add(kindOf(hostOf(orig[0])));
    if (isVideo && !sampleUpos) sampleUpos = list.find((u) => REWRITABLE.test(hostOf(u))) || null;

    let out = list.filter((u) => allowed(kindOf(hostOf(u)), cfg));
    if (!out.length) { stat.fallback++; return 0; } // 没有允许的节点，保持原样，保证能播
    if (target) {
      const i = out.findIndex((u) => REWRITABLE.test(hostOf(u)));
      if (i >= 0 && hostOf(out[i]) !== target) {
        // 最快镜像插在原 upos 地址前面，原地址留作兜底
        out = [...out.slice(0, i), withHost(out[i], target), ...out.slice(i)];
      }
    }
    out = [...new Set(out)];
    if (isVideo) stat.main = hostOf(out[0]);

    if (out.length === orig.length && out.every((u, i) => u === orig[i])) return 0;
    for (const k of mainKeys) e[k] = out[0];
    for (const k of backKeys) e[k] = out.slice(1);
    return 1;
  }

  function fixPlayurl(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    const cfg = getCfg();
    if (!cfg.on) return 0;
    const target = targetMirror(cfg);
    const d = obj.data || obj.result || obj;
    const roots = [d, d && d.video_info].filter(Boolean);
    let n = 0;
    for (const r of roots) {
      const dash = r.dash;
      if (dash) {
        for (const e of dash.video || []) n += fixEntry(e, cfg, target, true);
        for (const e of dash.audio || []) n += fixEntry(e, cfg, target, false);
        for (const e of (dash.dolby && dash.dolby.audio) || []) n += fixEntry(e, cfg, target, false);
        if (dash.flac && dash.flac.audio) n += fixEntry(dash.flac.audio, cfg, target, false);
      }
      for (const e of r.durl || []) n += fixEntry(e, cfg, target, true);
      for (const g of r.durls || []) for (const e of (g && g.durl) || []) n += fixEntry(e, cfg, target, true);
    }
    stat.replaced += n;
    if (n) console.info(TAG, `改写了 ${n} 个流地址，视频源：${stat.main}`);
    maybeAutoTest(cfg);
    ui.update();
    return n;
  }

  // ===== fetch =====
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = async function (input, init) {
      const res = await origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (!PLAYURL_RE.test(url) || !res.ok) return res;
        const j = await res.clone().json();
        if (!fixPlayurl(j)) return res;
        const out = new Response(JSON.stringify(j), { status: res.status, statusText: res.statusText, headers: res.headers });
        try { Object.defineProperty(out, 'url', { value: res.url }); } catch {}
        return out;
      } catch (e) {
        return res;
      }
    };
  }

  // ===== XMLHttpRequest =====
  const XP = XMLHttpRequest.prototype;
  const origOpen = XP.open;
  XP.open = function (method, url) {
    this.__bcfUrl = PLAYURL_RE.test(String(url)) ? String(url) : null;
    this.__bcfDone = false;
    this.__bcfObj = this.__bcfText = undefined;
    return origOpen.apply(this, arguments);
  };
  const dText = Object.getOwnPropertyDescriptor(XP, 'responseText');
  const dResp = Object.getOwnPropertyDescriptor(XP, 'response');

  function patched(xhr) {
    if (xhr.__bcfDone) return;
    xhr.__bcfDone = true;
    try {
      const rt = xhr.responseType;
      if (rt === 'json') {
        const obj = dResp.get.call(xhr);
        fixPlayurl(obj); // 原地修改，同一个对象会被复用
        xhr.__bcfObj = obj;
      } else if (rt === '' || rt === 'text') {
        const t = dText.get.call(xhr);
        const j = JSON.parse(t);
        xhr.__bcfText = fixPlayurl(j) ? JSON.stringify(j) : t;
      }
    } catch (e) { /* 忽略，走原始响应 */ }
  }

  Object.defineProperty(XP, 'responseText', {
    configurable: true,
    enumerable: dText.enumerable,
    get() {
      if (this.__bcfUrl && this.readyState === 4) {
        patched(this);
        if (this.__bcfText !== undefined) return this.__bcfText;
      }
      return dText.get.call(this);
    },
  });
  Object.defineProperty(XP, 'response', {
    configurable: true,
    enumerable: dResp.enumerable,
    get() {
      if (this.__bcfUrl && this.readyState === 4) {
        patched(this);
        if (this.__bcfObj !== undefined) return this.__bcfObj;
        if (this.__bcfText !== undefined) return this.__bcfText;
      }
      return dResp.get.call(this);
    },
  });

  // ===== 测速 =====
  let testing = false;
  let autoScheduled = false;

  async function timeGet(u, from, to) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const t0 = performance.now();
    try {
      const res = await origFetch.call(window, u, { headers: { Range: `bytes=${from}-${to}` }, cache: 'no-store', credentials: 'omit', signal: ctl.signal });
      if (!res.ok) return -1;
      await res.arrayBuffer();
      return performance.now() - t0;
    } catch { return -1; } finally { clearTimeout(timer); }
  }

  // 每个镜像：先取 128KB（含建连，反映起播延迟），再取 512KB（反映带宽），两次耗时相加
  async function speedTest() {
    if (testing || !sampleUpos || !origFetch) return;
    testing = true;
    ui.update();
    const r = {};
    let best = null;
    let bestMs = Infinity;
    for (const m of MIRRORS) {
      const u = withHost(sampleUpos, m);
      const t1 = await timeGet(u, 0, 131071);
      const t2 = t1 < 0 ? -1 : await timeGet(u, 131072, 655359);
      const ms = t1 < 0 || t2 < 0 ? -1 : Math.round(t1 + t2);
      r[short(m)] = ms;
      if (ms >= 0 && ms < bestMs) { bestMs = ms; best = m; }
      ui.update(r);
    }
    testing = false;
    if (best) {
      writeCookie('bcf_speed', { best, ts: Date.now(), r });
      console.info(TAG, `测速完成，最快镜像：${best}（${bestMs}ms）`, r);
    }
    ui.update();
  }

  function maybeAutoTest(cfg) {
    if (autoScheduled || cfg.mirror !== 'auto' || !sampleUpos) return;
    const s = getSpeed();
    if (s && Date.now() - s.ts < SPEED_TTL) return;
    autoScheduled = true;
    // 等视频先起播，错开多个标签页同时测速
    setTimeout(() => {
      const s2 = getSpeed();
      if (s2 && Date.now() - s2.ts < SPEED_TTL) return;
      speedTest();
    }, 6000 + Math.random() * 4000);
  }

  // ===== 视频页首屏内嵌的 window.__playinfo__ =====
  let playinfo = window.__playinfo__;
  if (playinfo) fixPlayurl(playinfo);
  try {
    Object.defineProperty(window, '__playinfo__', {
      configurable: true,
      get() { return playinfo; },
      set(v) { try { fixPlayurl(v); } catch {} playinfo = v; },
    });
  } catch {}

  // ===== 悬浮面板 =====
  ui = (() => {
    let root = null;
    let liveR = null;
    const $ = (s) => root && root.querySelector(s);

    const CSS = `
      :host { all: initial; }
      .fab { position: fixed; right: 0; z-index: 2147483000; width: 36px; height: 22px; line-height: 22px;
        text-align: center; font: 600 11px/22px system-ui, sans-serif; color: #fff; background: rgba(0,0,0,.6);
        border-radius: 11px 0 0 11px; opacity: .35; cursor: pointer; user-select: none; transition: opacity .15s; }
      .fab:hover, .fab.open { opacity: 1; }
      .fab i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 3px; vertical-align: 1px; background: #9499a0; }
      .fab i.ok { background: #3fc45a; }
      .panel { position: fixed; right: 42px; z-index: 2147483001; width: 290px; box-sizing: border-box; padding: 12px 14px;
        background: #fff; color: #18191c; border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,.18);
        font: 13px/1.5 system-ui, -apple-system, "Microsoft YaHei", sans-serif; }
      .panel[hidden] { display: none; }
      .hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-weight: 600; font-size: 14px; }
      .x { cursor: pointer; color: #9499a0; font-size: 18px; line-height: 1; }
      .sec { margin: 10px 0 4px; color: #61666d; font-size: 12px; }
      label { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 1px 0; }
      label.dis { color: #9499a0; cursor: default; }
      input[type=checkbox] { margin: 0; accent-color: #00aeec; }
      select { width: 100%; padding: 3px 4px; border: 1px solid #e3e5e7; border-radius: 4px; font: inherit; background: #fff; color: inherit; }
      button { padding: 2px 8px; border: 1px solid #e3e5e7; border-radius: 4px; background: #f6f7f8; color: #18191c; font-family: inherit; font-size: 12px; line-height: 1.6; cursor: pointer; }
      button:hover:not(:disabled) { border-color: #00aeec; color: #00aeec; }
      button:disabled { opacity: .5; cursor: default; }
      .btns { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
      .muted { color: #9499a0; font-size: 12px; }
      .speed { margin-top: 4px; font-size: 12px; color: #61666d; }
      .speed span { white-space: nowrap; }
      .speed b { color: #00aeec; }
      .stat { font-size: 12px; color: #61666d; }
      .stat code { color: #18191c; font-family: ui-monospace, Consolas, monospace; }
      .foot { margin-top: 10px; display: flex; justify-content: space-between; align-items: center; }
    `;

    const HTML = `
      <div class="fab" title="B站 CDN 节点设置（可上下拖动）"><i></i>CDN</div>
      <div class="panel" hidden>
        <div class="hd"><span>B站 CDN 节点</span><span class="x" title="关闭">×</span></div>
        <label><input type="checkbox" data-k="on"> 启用脚本</label>
        <div class="sec">允许使用的节点</div>
        <label class="dis"><input type="checkbox" checked disabled> 官方源站 upos（始终允许）</label>
        <label><input type="checkbox" data-k="bcache"> B站自建边缘 cn-*</label>
        <label><input type="checkbox" data-k="pcdn"> PCDN（mcdn / szbdyd）</label>
        <label><input type="checkbox" data-k="edge"> 第三方边缘（mountaintoys、fx 等）</label>
        <div class="btns">
          <button data-preset="official">只用官方源（推荐）</button>
          <button data-preset="default">B站默认（不干预）</button>
        </div>
        <div class="sec">upos 镜像</div>
        <select data-k="mirror">
          <option value="auto">自动（测速选最快）</option>
          <option value="keep">不改，用接口分配的</option>
          ${MIRRORS.map((m) => `<option value="${m}">${short(m)}</option>`).join('')}
        </select>
        <div class="speed"></div>
        <div class="btns"><button class="test">立即测速</button></div>
        <div class="sec">本页</div>
        <div class="stat"></div>
        <div class="foot"><span class="muted">改动对之后加载的视频生效</span><button class="reload">刷新页面</button></div>
      </div>`;

    function ago(ts) {
      const m = Math.round((Date.now() - ts) / 60000);
      return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : `${Math.round(m / 60)} 小时前`;
    }

    function fmtResults(r, best) {
      return Object.entries(r)
        .sort((a, b) => (a[1] < 0) - (b[1] < 0) || a[1] - b[1])
        .map(([k, v]) => `<span>${k === short(best) ? `<b>${k} ${v}</b>` : `${k} ${v < 0 ? '✗' : v}`}</span>`)
        .join(' · ');
    }

    function update(partial) {
      if (partial) liveR = partial;
      if (!root) return;
      const cfg = getCfg();
      for (const el of root.querySelectorAll('[data-k]')) {
        if (el.type === 'checkbox') el.checked = !!cfg[el.dataset.k];
        else el.value = cfg[el.dataset.k];
      }
      const s = getSpeed();
      const sp = $('.speed');
      if (testing) {
        sp.innerHTML = `测速中… ${liveR ? fmtResults(liveR, null) : ''}`;
      } else if (s && s.best) {
        sp.innerHTML = `最快：<b>${short(s.best)}</b>（${ago(s.ts)}，单位 ms）<br>${fmtResults(s.r || {}, s.best)}`;
      } else {
        sp.textContent = cfg.mirror === 'auto' ? '尚未测速，打开视频后会自动测一次' : '';
      }
      const tb = $('.test');
      tb.disabled = testing || !sampleUpos;
      tb.title = sampleUpos ? '' : '需要先打开一个视频（用它的地址测速）';

      const kinds = [...stat.origKinds].map((k) => KIND_NAME[k]).join('、');
      $('.stat').innerHTML = stat.main
        ? `视频源：<code>${stat.main}</code><br>B站原本的主地址：${kinds || '—'}<br>已改写 ${stat.replaced} 个流地址${stat.fallback ? `，${stat.fallback} 个无可用节点未改` : ''}`
        : '<span class="muted">本页还没有加载视频</span>';
      $('.fab i').className = cfg.on && stat.main && kindOf(stat.main) === 'upos' ? 'ok' : '';
    }

    function place(top) {
      const fab = $('.fab');
      const panel = $('.panel');
      const t = Math.max(8, Math.min(window.innerHeight - 30, top));
      fab.style.top = t + 'px';
      panel.style.top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, t - 20)) + 'px';
      return t;
    }

    function mount() {
      if (root || window.top !== window) return;
      const host = document.createElement('div');
      host.id = 'bili-cdn-fix-ui';
      root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style>${HTML}`;
      document.documentElement.appendChild(host);

      const fab = $('.fab');
      const panel = $('.panel');
      let top = +localStorage.getItem('bcf_fab_top') || Math.round(window.innerHeight * 0.6);
      place(top);

      const toggle = (open) => {
        panel.hidden = !open;
        fab.classList.toggle('open', open);
        if (open) { update(); place(top); }
      };

      // 拖动（竖直方向）/ 点击
      fab.addEventListener('pointerdown', (ev) => {
        const y0 = ev.clientY;
        const top0 = top;
        let moved = false;
        fab.setPointerCapture(ev.pointerId);
        const move = (e) => {
          if (Math.abs(e.clientY - y0) > 4) moved = true;
          if (moved) top = place(top0 + e.clientY - y0);
        };
        const up = () => {
          fab.removeEventListener('pointermove', move);
          fab.removeEventListener('pointerup', up);
          if (moved) localStorage.setItem('bcf_fab_top', String(top));
          else toggle(panel.hidden);
        };
        fab.addEventListener('pointermove', move);
        fab.addEventListener('pointerup', up);
      });

      $('.x').addEventListener('click', () => toggle(false));
      document.addEventListener('pointerdown', (e) => {
        if (!panel.hidden && !e.composedPath().includes(host)) toggle(false);
      }, true);
      window.addEventListener('resize', () => place(top));

      root.addEventListener('change', (e) => {
        const k = e.target.dataset && e.target.dataset.k;
        if (!k) return;
        const cfg = getCfg();
        cfg[k] = e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value;
        setCfg(cfg);
        update();
      });
      root.addEventListener('click', (e) => {
        const p = e.target.dataset && e.target.dataset.preset;
        if (p === 'official') setCfg({ ...getCfg(), on: 1, bcache: 1, pcdn: 0, edge: 0, mirror: 'auto' });
        if (p === 'default') setCfg({ ...getCfg(), on: 1, bcache: 1, pcdn: 1, edge: 1, mirror: 'keep' });
        if (p) update();
      });
      $('.test').addEventListener('click', () => speedTest());
      $('.reload').addEventListener('click', () => location.reload());
      update();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();

    return { update };
  })();

  console.info(TAG, '已启用', getCfg());
})();
