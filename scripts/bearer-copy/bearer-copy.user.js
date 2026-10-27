// ==UserScript==
// @name         Bearer 快速复制
// @namespace    https://github.com/zidou-kiyn/tampermonkey-scripts
// @version      0.3.0
// @description  从当前页面发出的 fetch/XHR 请求中捕获 Bearer，手动复制到剪贴板
// @author       zidou-kiyn
// @license      MIT
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @noframes
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @homepageURL  https://github.com/zidou-kiyn/tampermonkey-scripts/tree/main/scripts/bearer-copy
// @supportURL   https://github.com/zidou-kiyn/tampermonkey-scripts/issues
// @updateURL    https://raw.githubusercontent.com/zidou-kiyn/tampermonkey-scripts/main/scripts/bearer-copy/bearer-copy.user.js
// @downloadURL  https://raw.githubusercontent.com/zidou-kiyn/tampermonkey-scripts/main/scripts/bearer-copy/bearer-copy.user.js
// ==/UserScript==

(function () {
  'use strict';

  // 只保留最新令牌，不写入存储、不打印、不发送到网络。
  let token = null;
  const page = unsafeWindow;
  let toastHost = null;
  let toastTimer = null;

  function showToast(message, isError = false) {
    if (toastTimer !== null) clearTimeout(toastTimer);
    if (toastHost) toastHost.remove();

    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; position: fixed; top: 24px; right: 24px;
        z-index: 2147483647; pointer-events: none; }
      .toast { display: flex; align-items: center; gap: 10px; max-width: min(360px, calc(100vw - 48px));
        padding: 13px 16px; border: 1px solid rgba(255,255,255,.16); border-radius: 12px;
        background: #202632; color: #f8fafc; box-shadow: 0 8px 28px rgba(0,0,0,.24);
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        animation: enter .2s ease-out; }
      .icon { display: grid; place-items: center; flex: none; width: 22px; height: 22px;
        border-radius: 50%; background: #22c55e; color: #fff; font-weight: 700; }
      .error .icon { background: #f59e0b; }
      @keyframes enter { from { opacity: 0; transform: translateY(-8px); }
        to { opacity: 1; transform: translateY(0); } }
      @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
    `;
    const toast = document.createElement('div');
    toast.className = isError ? 'toast error' : 'toast';
    toast.setAttribute('role', 'status');
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = isError ? '!' : '✓';
    const text = document.createElement('span');
    text.textContent = message;
    toast.append(icon, text);
    shadow.append(style, toast);
    (document.body || document.documentElement).appendChild(host);
    toastHost = host;
    toastTimer = setTimeout(() => {
      host.remove();
      if (toastHost === host) toastHost = null;
      toastTimer = null;
    }, 3000);
  }

  function capture(value) {
    if (typeof value !== 'string') return;
    const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(value);
    if (match) token = match[1];
  }

  GM_registerMenuCommand('复制 Bearer', () => {
    if (!token) {
      showToast('尚未捕获到 Bearer，请刷新或操作页面后重试。', true);
      return;
    }
    GM_setClipboard(`Bearer ${token}`, 'text');
    showToast('Bearer 已复制，请妥善保管。');
  });

  const originalFetch = page.fetch;
  if (typeof originalFetch === 'function') {
    page.fetch = function (input, init) {
      try {
        // init.headers 存在时会覆盖 Request 对象里的 headers。
        const headers = init && init.headers !== undefined
          ? new page.Headers(init.headers)
          : input instanceof page.Request ? input.headers : null;
        if (headers) capture(headers.get('authorization'));
      } catch (_) {
        // 不因检查请求头影响原始请求。
      }
      return originalFetch.apply(this, arguments);
    };
  }

  const xhr = page.XMLHttpRequest && page.XMLHttpRequest.prototype;
  if (xhr) {
    const headersByRequest = new WeakMap();
    const originalOpen = xhr.open;
    const originalSetHeader = xhr.setRequestHeader;
    const originalSend = xhr.send;

    xhr.open = function () {
      const result = originalOpen.apply(this, arguments);
      headersByRequest.delete(this);
      return result;
    };
    xhr.setRequestHeader = function (name, value) {
      const result = originalSetHeader.apply(this, arguments);
      if (String(name).toLowerCase() === 'authorization') {
        headersByRequest.set(this, String(value));
      }
      return result;
    };
    xhr.send = function () {
      capture(headersByRequest.get(this));
      return originalSend.apply(this, arguments);
    };
  }
})();
