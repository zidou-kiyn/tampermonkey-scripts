// ==UserScript==
// @name         B站坏 CDN 节点绕过
// @namespace    https://github.com/zidou-kiyn/tampermonkey-scripts
// @version      1.0.0
// @description  拦截 playurl 响应，把不可用的视频节点（默认 cn-*-fx-*）替换成接口自带的 upos 备用节点，解决悬浮预览/播放起播慢
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

  // ===== 配置 =====
  // 视为"坏节点"的域名。默认只处理 fx 类第三方边缘节点。
  // 如果 PCDN 也慢，可以改成：
  // /^cn-[a-z0-9]+-fx-|\.mcdn\.bilivideo\.(cn|com)$|\.szbdyd\.com$/i
  const BAD_HOST = /^cn-[a-z0-9]+-fx-/i;
  // 候选备用节点里优先选的（按顺序），都没有就用第一个非坏节点
  const PREFERRED = ['upos-sz-mirrorcos.bilivideo.com', 'upos-sz-mirrorali.bilivideo.com', 'upos-sz-mirrorhw.bilivideo.com'];
  const PLAYURL_RE = /\/(x\/player(\/wbi)?\/playurl|pgc\/player\/web(\/v2)?\/playurl|pugv\/player\/web\/playurl)/;
  const TAG = '[bili-cdn-fix]';

  const hostOf = (u) => { try { return new URL(u, location.href).hostname; } catch { return ''; } };
  const isBad = (u) => BAD_HOST.test(hostOf(u));

  function pickGood(list) {
    const good = (list || []).filter((u) => u && !isBad(u));
    for (const h of PREFERRED) {
      const hit = good.find((u) => hostOf(u) === h);
      if (hit) return hit;
    }
    return good[0];
  }

  // 处理单个流条目（DASH 的 video/audio 项，或 durl 项）
  function fixEntry(e) {
    if (!e || typeof e !== 'object') return 0;
    const main = e.baseUrl || e.base_url || e.url;
    if (!main || !isBad(main)) return 0;
    const backups = e.backupUrl || e.backup_url || [];
    const good = pickGood(backups);
    if (!good) return 0;
    const rest = backups.filter((u) => u !== good && !isBad(u));
    if ('baseUrl' in e) e.baseUrl = good;
    if ('base_url' in e) e.base_url = good;
    if ('url' in e) e.url = good;
    if ('backupUrl' in e) e.backupUrl = rest;
    if ('backup_url' in e) e.backup_url = rest;
    return 1;
  }

  function fixPlayurl(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    const d = obj.data || obj.result || obj;
    const roots = [d, d && d.video_info].filter(Boolean);
    let n = 0;
    for (const r of roots) {
      const dash = r.dash;
      if (dash) {
        for (const e of dash.video || []) n += fixEntry(e);
        for (const e of dash.audio || []) n += fixEntry(e);
        for (const e of (dash.dolby && dash.dolby.audio) || []) n += fixEntry(e);
        if (dash.flac && dash.flac.audio) n += fixEntry(dash.flac.audio);
      }
      for (const e of r.durl || []) n += fixEntry(e);
      for (const g of r.durls || []) for (const e of (g && g.durl) || []) n += fixEntry(e);
    }
    if (n) console.info(TAG, `替换了 ${n} 个坏节点地址`);
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

  console.info(TAG, '已启用');
})();
