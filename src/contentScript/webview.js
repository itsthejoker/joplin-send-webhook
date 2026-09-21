(function() {
  'use strict';

  var GENERIC_ERROR = 'The webhook request could not be completed.';
  var ATTACHED_MARKER = 'webhookControlAttached';

  function decodeSource(encoded) {
    if (typeof encoded !== 'string' || encoded.length === 0) throw new Error('Invalid webhook source');

    var binary = atob(encoded);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

    var source;
    if (typeof TextDecoder !== 'undefined') {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } else {
      var escaped = '';
      for (var byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
        escaped += '%' + ('0' + bytes[byteIndex].toString(16)).slice(-2);
      }
      source = decodeURIComponent(escaped);
    }

    if (source.length === 0) throw new Error('Invalid webhook source');
    return source;
  }

  function isPresentation(value) {
    return value && typeof value === 'object'
      && typeof value.printResponse === 'boolean'
      && typeof value.successConfetti === 'boolean';
  }

  function isResponseResult(value) {
    return value && typeof value === 'object'
      && value.kind === 'response'
      && typeof value.ok === 'boolean'
      && typeof value.status === 'number'
      && Number.isFinite(value.status)
      && typeof value.statusText === 'string'
      && typeof value.body === 'string'
      && isPresentation(value.presentation);
  }

  function isErrorResult(value) {
    return value && typeof value === 'object'
      && value.kind === 'error'
      && typeof value.message === 'string'
      && value.message.length > 0
      && isPresentation(value.presentation);
  }

  function clearResponses(control) {
    var existing = control.querySelectorAll('.webhook-response');
    for (var index = 0; index < existing.length; index += 1) existing[index].remove();
  }

  function setStatus(status, message, className) {
    status.textContent = message;
    status.classList.remove('webhook-success', 'webhook-error');
    if (className) status.classList.add(className);
  }

  function appendResponse(control, result) {
    var output = control.ownerDocument.createElement('pre');
    output.className = 'webhook-response';
    output.textContent = String(result.status) + ' ' + result.statusText + '\n'
      + (result.body === '' ? '(empty response body)' : result.body);
    control.appendChild(output);
  }

  function prefersReducedMotion() {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function addConfetti(control) {
    if (prefersReducedMotion()) return;

    var layer = control.ownerDocument.createElement('span');
    layer.className = 'webhook-confetti';
    layer.setAttribute('aria-hidden', 'true');
    for (var index = 0; index < 18; index += 1) {
      var piece = control.ownerDocument.createElement('i');
      piece.style.setProperty('--webhook-confetti-index', String(index));
      layer.appendChild(piece);
    }
    control.appendChild(layer);
    setTimeout(function() { layer.remove(); }, 1400);
  }

  function renderGenericError(control, status) {
    clearResponses(control);
    setStatus(status, GENERIC_ERROR, 'webhook-error');
  }

  function renderResult(control, status, result) {
    clearResponses(control);
    if (isErrorResult(result)) {
      setStatus(status, result.message, 'webhook-error');
      return;
    }
    if (!isResponseResult(result)) {
      renderGenericError(control, status);
      return;
    }

    setStatus(
      status,
      result.ok ? 'Sent successfully.' : 'Request failed: ' + result.status + ' ' + result.statusText,
      result.ok ? 'webhook-success' : 'webhook-error',
    );
    if (result.presentation.printResponse) appendResponse(control, result);
    if (result.ok && result.presentation.successConfetti) addConfetti(control);
  }

  function attachWebhookControls(root, bridge) {
    if (!root || typeof root.querySelectorAll !== 'function') return;

    var controls = root.querySelectorAll('.webhook-control');
    for (var index = 0; index < controls.length; index += 1) {
      (function(control) {
        var button = control.querySelector('.webhook-button');
        var status = control.querySelector('.webhook-status');
        if (!button || !status || button.disabled || button.dataset[ATTACHED_MARKER]) return;

        button.dataset[ATTACHED_MARKER] = 'true';
        button.addEventListener('click', async function() {
          if (button.disabled) return;

          var originalLabel = button.textContent;
          button.disabled = true;
          button.textContent = 'Sending…';
          clearResponses(control);
          setStatus(status, '', '');

          try {
            var source = decodeSource(control.getAttribute('data-webhook-settings'));
            var result = await bridge.postMessage({ type: 'sendWebhook', source: source });
            renderResult(control, status, result);
          } catch (_error) {
            renderGenericError(control, status);
          } finally {
            button.textContent = originalLabel;
            button.disabled = false;
          }
        });
      })(controls[index]);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { attachWebhookControls: attachWebhookControls };
  }

  if (typeof document !== 'undefined' && typeof webviewApi !== 'undefined') {
    attachWebhookControls(document, webviewApi);
  }
})();
