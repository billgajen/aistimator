/**
 * Estimator Widget Iframe Loader
 *
 * A lightweight script (~1KB) that creates and manages an iframe-embedded widget.
 * Handles auto-resizing based on content height.
 *
 * Usage:
 * <script
 *   src="https://your-domain.com/iframe-loader.js"
 *   data-tenant-key="tkey_xxx"
 *   data-container="#my-container"
 *   async
 * ></script>
 *
 * Or manually:
 * <div id="estimator-widget"></div>
 * <script src="https://your-domain.com/iframe-loader.js"></script>
 * <script>
 *   EstimatorIframe.init({
 *     tenantKey: 'tkey_xxx',
 *     container: '#estimator-widget'
 *   });
 * </script>
 */

(function() {
  'use strict';

  var WIDGET_ORIGIN = (function() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src;
      if (src && src.indexOf('iframe-loader.js') !== -1) {
        var url = new URL(src);
        return url.origin;
      }
    }
    return window.location.origin;
  })();

  var iframes = {};

  function init(config) {
    if (!config.tenantKey) {
      console.error('[Estimator] tenantKey is required');
      return;
    }

    var containerId = config.container || '#estimator-widget';
    var container = document.querySelector(containerId);

    if (!container) {
      console.error('[Estimator] Container not found:', containerId);
      return;
    }

    // Build iframe URL
    var iframeUrl = WIDGET_ORIGIN + '/embed/' + encodeURIComponent(config.tenantKey);
    if (config.serviceId) {
      iframeUrl += '?serviceId=' + encodeURIComponent(config.serviceId);
    }

    // Create iframe
    var iframe = document.createElement('iframe');
    iframe.src = iframeUrl;
    iframe.style.cssText = 'width:100%;border:none;overflow:hidden;min-height:200px;';
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('title', 'Get a Quote');

    // Store reference
    iframes[config.tenantKey] = iframe;

    // Clear container and add iframe
    container.innerHTML = '';
    container.appendChild(iframe);

    return iframe;
  }

  // Handle messages from iframe
  function handleMessage(event) {
    // Verify origin
    if (event.origin !== WIDGET_ORIGIN) {
      return;
    }

    var data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }

    // Handle resize
    if (data.type === 'estimator-resize' && data.tenantKey && data.height) {
      var iframe = iframes[data.tenantKey];
      if (iframe) {
        iframe.style.height = data.height + 'px';
      }
    }

    // Handle submission (optional callback)
    if (data.type === 'estimator-submitted') {
      var submitEvent = new CustomEvent('estimator:submitted', {
        detail: {
          quoteId: data.quoteId,
          quoteViewUrl: data.quoteViewUrl,
          tenantKey: data.tenantKey
        }
      });
      document.dispatchEvent(submitEvent);
    }
  }

  // Listen for messages
  window.addEventListener('message', handleMessage, false);

  // Auto-init from script tag
  function autoInit() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var script = scripts[i];
      if (script.src && script.src.indexOf('iframe-loader.js') !== -1) {
        var tenantKey = script.getAttribute('data-tenant-key');
        if (tenantKey) {
          init({
            tenantKey: tenantKey,
            container: script.getAttribute('data-container') || '#estimator-widget',
            serviceId: script.getAttribute('data-service-id')
          });
        }
        break;
      }
    }
  }

  // Run auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  // Expose API
  window.EstimatorIframe = {
    init: init,
    iframes: iframes
  };
})();
