/**
 * Estimator Widget Loader (unified, all mount modes)
 *
 * A small dependency-free loader. Every mode renders the hosted embed page
 * (/embed/{tenantKey}) in an iframe, so the widget UI always ships with the
 * platform deploy — there is no bundled UI to go stale — and styling is
 * isolated from the host page by the iframe boundary.
 *
 * Usage:
 * <script
 *   src="https://your-domain.com/widget.js"
 *   data-tenant-key="tkey_xxx"
 *   data-mode="floating"                     (floating | inline | iframe)
 *   data-display-mode="form"                 (form | conversational)
 *   data-container="#my-container"           (inline/iframe modes)
 *   data-service-id="svc_xxx"                (optional: preselect a service)
 *   data-button-text="Get an instant quote"  (floating button label)
 *   data-accent="#205E56"                    (floating button colour)
 *   async
 * ></script>
 *
 * Programmatic: EstimatorWidget.init({ tenantKey, mode, ... });
 * Floating mode also exposes EstimatorWidget.open() / .close().
 * Successful submissions dispatch an 'estimator:submitted' CustomEvent
 * on document with { quoteId, quoteViewUrl, tenantKey }.
 */

(function () {
  'use strict';

  var WIDGET_ORIGIN = (function () {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src;
      if (src && src.indexOf('widget.js') !== -1) {
        try {
          return new URL(src).origin;
        } catch (e) {
          /* ignore malformed src */
        }
      }
    }
    return window.location.origin;
  })();

  var DEFAULT_ACCENT = '#205E56'; // juniper
  var Z_INDEX = 2147483000;

  var inlineIframes = {}; // tenantKey -> iframe (resize target)
  var floating = null;

  function buildEmbedUrl(config) {
    var url = WIDGET_ORIGIN + '/embed/' + encodeURIComponent(config.tenantKey);
    var params = [];
    if (config.serviceId) params.push('serviceId=' + encodeURIComponent(config.serviceId));
    if (config.displayMode === 'conversational') params.push('mode=conversational');
    if (params.length > 0) url += '?' + params.join('&');
    return url;
  }

  function createIframe(config, fillPanel) {
    var iframe = document.createElement('iframe');
    iframe.src = buildEmbedUrl(config);
    iframe.style.cssText = fillPanel
      ? 'width:100%;height:100%;border:none;display:block;'
      : 'width:100%;border:none;overflow:hidden;min-height:200px;display:block;';
    if (!fillPanel) iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('title', 'Get a Quote');
    return iframe;
  }

  /* ---------- inline / iframe modes: iframe in a host container ---------- */

  function initInline(config) {
    var selector = config.container || '#estimator-widget';
    var container = document.querySelector(selector);
    if (!container) {
      console.error('[Estimator] Container not found:', selector);
      return null;
    }
    var iframe = createIframe(config, false);
    inlineIframes[config.tenantKey] = iframe;
    container.innerHTML = '';
    container.appendChild(iframe);
    return iframe;
  }

  /* ---------- floating mode: launcher button + slide-over panel ---------- */

  function initFloating(config) {
    var accent = config.accent || DEFAULT_ACCENT;
    var label = config.buttonText || 'Get an instant quote';

    var button = document.createElement('button');
    button.type = 'button';
    button.id = 'estimator-floating-launcher';
    button.setAttribute('aria-label', label);
    button.textContent = label;
    button.style.cssText =
      'position:fixed;bottom:24px;right:24px;z-index:' + Z_INDEX + ';' +
      'padding:14px 22px;border:none;border-radius:999px;cursor:pointer;' +
      'background:' + accent + ';color:#fff;font-size:15px;font-weight:600;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      'box-shadow:0 6px 24px rgba(27,40,35,0.28);transition:transform .15s ease;';
    button.onmouseenter = function () { button.style.transform = 'translateY(-2px)'; };
    button.onmouseleave = function () { button.style.transform = ''; };

    var overlay = document.createElement('div');
    overlay.id = 'estimator-floating-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:' + (Z_INDEX + 1) + ';display:none;' +
      'background:rgba(27,40,35,0.4);';

    var panel = document.createElement('div');
    var isMobile = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
    panel.style.cssText = isMobile
      ? 'position:fixed;inset:0;background:#FAF9F6;display:flex;flex-direction:column;'
      : 'position:fixed;top:24px;right:24px;bottom:24px;width:420px;max-width:calc(100vw - 48px);' +
        'background:#FAF9F6;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;' +
        'box-shadow:0 24px 64px rgba(27,40,35,0.35);';

    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '&times;';
    close.style.cssText =
      'position:absolute;top:10px;right:10px;z-index:2;width:32px;height:32px;' +
      'border:none;border-radius:999px;cursor:pointer;background:rgba(27,40,35,0.08);' +
      'color:#1B2823;font-size:20px;line-height:1;';

    panel.appendChild(close);
    overlay.appendChild(panel);

    var state = { iframe: null, isOpen: false };

    state.open = function () {
      if (!state.iframe) {
        state.iframe = createIframe(config, true);
        panel.appendChild(state.iframe);
      }
      overlay.style.display = 'block';
      button.style.display = 'none';
      state.isOpen = true;
    };

    state.close = function () {
      overlay.style.display = 'none';
      button.style.display = '';
      state.isOpen = false;
    };

    button.onclick = state.open;
    close.onclick = state.close;
    overlay.onclick = function (event) {
      if (event.target === overlay) state.close();
    };

    floating = state;
    document.body.appendChild(button);
    document.body.appendChild(overlay);
    return state;
  }

  /* ---------- messages from the embed page ---------- */

  window.addEventListener('message', function (event) {
    if (event.origin !== WIDGET_ORIGIN) return;
    var data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'estimator-resize' && data.tenantKey && data.height) {
      var iframe = inlineIframes[data.tenantKey];
      if (iframe) iframe.style.height = data.height + 'px';
    }

    if (data.type === 'estimator-submitted') {
      document.dispatchEvent(
        new CustomEvent('estimator:submitted', {
          detail: {
            quoteId: data.quoteId,
            quoteViewUrl: data.quoteViewUrl,
            tenantKey: data.tenantKey,
          },
        })
      );
    }
  }, false);

  /* ---------- init ---------- */

  function init(config) {
    if (!config || !config.tenantKey) {
      console.error('[Estimator] tenantKey is required');
      return null;
    }
    var mode = config.mode || 'floating';
    if (mode === 'inline' || mode === 'iframe') return initInline(config);
    if (mode === 'floating') return initFloating(config);
    console.error('[Estimator] Unknown mode:', mode);
    return null;
  }

  function autoInit() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var script = scripts[i];
      if (!script.src || script.src.indexOf('widget.js') === -1) continue;
      var tenantKey = script.getAttribute('data-tenant-key');
      if (tenantKey) {
        init({
          tenantKey: tenantKey,
          mode: script.getAttribute('data-mode') || 'floating',
          displayMode: script.getAttribute('data-display-mode') || 'form',
          container: script.getAttribute('data-container'),
          serviceId: script.getAttribute('data-service-id'),
          buttonText: script.getAttribute('data-button-text') || script.getAttribute('data-button-label'),
          accent: script.getAttribute('data-accent'),
        });
      }
      break;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  window.EstimatorWidget = {
    init: init,
    open: function () { if (floating) floating.open(); },
    close: function () { if (floating) floating.close(); },
  };
})();
