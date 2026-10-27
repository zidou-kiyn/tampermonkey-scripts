// ==UserScript==
// @name         Bearer 快速复制
// @namespace    https://github.com/zidou-kiyn/tampermonkey-scripts
// @version      0.2.0
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

  function capture(value) {
    if (typeof value !== 'string') return;
    const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(value);
    if (match) token = match[1];
  }

  GM_registerMenuCommand('复制 Bearer', () => {
    if (!token) {
      alert('尚未捕获到 Bearer。请刷新页面或操作页面以触发请求，再试一次。');
      return;
    }
    GM_setClipboard(`Bearer ${token}`, 'text');
    alert('完整 Authorization 值已复制。请妥善保管。');
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
