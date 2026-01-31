/**
 * Widget Styles
 *
 * CSS that gets injected into the page when the widget loads.
 * Uses a unique prefix to avoid conflicts with host page styles.
 */

const CSS = `
/* Reset and base */
.estimator-widget,
.estimator-widget * {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
}

/* Widget container */
.estimator-widget {
  background: #ffffff;
  color: #1a1a1a;
  font-size: 14px;
  line-height: 1.5;
  width: 100%;
  max-width: 400px;
}

.estimator-widget-inline {
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  overflow: hidden;
}

/* Header */
.estimator-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e5e5;
  background: #f9fafb;
}

.estimator-header h2 {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
}

.estimator-close {
  background: none;
  border: none;
  font-size: 24px;
  color: #6b7280;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.estimator-close:hover {
  color: #1a1a1a;
}

/* Body */
.estimator-body {
  padding: 20px;
}

/* Steps */
.estimator-step h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  color: #1a1a1a;
}

/* Services */
.estimator-services {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.estimator-service-btn {
  display: block;
  width: 100%;
  padding: 12px 16px;
  text-align: left;
  background: #ffffff;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  font-size: 14px;
  color: #1a1a1a;
  cursor: pointer;
  transition: all 0.15s ease;
}

.estimator-service-btn:hover {
  background: #f9fafb;
  border-color: #d1d5db;
}

.estimator-service-btn.selected {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #1e40af;
}

/* Form fields */
.estimator-field {
  margin-bottom: 16px;
}

.estimator-field label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

.estimator-field input[type="text"],
.estimator-field input[type="email"],
.estimator-field input[type="tel"],
.estimator-field input[type="number"],
.estimator-field select,
.estimator-field textarea {
  display: block;
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #ffffff;
  color: #1a1a1a;
  transition: border-color 0.15s ease;
}

.estimator-field input:focus,
.estimator-field select:focus,
.estimator-field textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.estimator-field input::placeholder {
  color: #9ca3af;
}

.estimator-required {
  color: #ef4444;
  margin-left: 2px;
}

.estimator-help {
  display: block;
  font-size: 12px;
  color: #6b7280;
  margin-top: 4px;
}

/* Textarea */
.estimator-field textarea {
  resize: vertical;
  min-height: 80px;
}

/* Radio group */
.estimator-radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.estimator-radio {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.estimator-radio input[type="radio"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.estimator-radio span {
  font-size: 14px;
  color: #374151;
}

/* Checkbox group */
.estimator-checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Checkbox */
.estimator-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.estimator-checkbox input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.estimator-checkbox span {
  font-size: 14px;
  color: #374151;
}

/* Field validation errors */
.estimator-field.has-error input,
.estimator-field.has-error select,
.estimator-field.has-error textarea,
.estimator-field input.error,
.estimator-field select.error,
.estimator-field textarea.error {
  border-color: #ef4444;
}

.estimator-field.has-error input:focus,
.estimator-field.has-error select:focus,
.estimator-field.has-error textarea:focus,
.estimator-field input.error:focus,
.estimator-field select.error:focus,
.estimator-field textarea.error:focus {
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
}

.estimator-field-error {
  display: block;
  font-size: 12px;
  color: #ef4444;
  margin-top: 4px;
}

/* Progress indicator */
.estimator-progress {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  margin-bottom: 20px;
  padding: 0 10px;
}

.estimator-progress-item {
  display: flex;
  align-items: center;
  flex: 1;
}

.estimator-progress-item:last-child {
  flex: 0;
}

.estimator-progress-circle {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  background: #e5e7eb;
  color: #6b7280;
  flex-shrink: 0;
}

.estimator-progress-circle.active {
  background: #3b82f6;
  color: #ffffff;
}

.estimator-progress-circle.completed {
  background: #3b82f6;
  color: #ffffff;
}

.estimator-progress-label {
  display: block;
  font-size: 11px;
  color: #6b7280;
  margin-top: 4px;
  text-align: center;
  position: absolute;
  width: 60px;
  left: 50%;
  transform: translateX(-50%);
  top: 32px;
}

.estimator-progress-label.active {
  color: #3b82f6;
  font-weight: 500;
}

.estimator-progress-item {
  position: relative;
  flex-direction: column;
  align-items: center;
}

.estimator-progress-line {
  height: 2px;
  background: #e5e7eb;
  flex: 1;
  margin: 0 8px;
  margin-top: 13px;
  position: absolute;
  left: 36px;
  right: -8px;
  top: 0;
}

.estimator-progress-line.completed {
  background: #3b82f6;
}

/* Buttons */
.estimator-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-decoration: none;
}

.estimator-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.estimator-btn-primary {
  background: #3b82f6;
  color: #ffffff;
  border: none;
}

.estimator-btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.estimator-btn-secondary {
  background: #ffffff;
  color: #374151;
  border: 1px solid #d1d5db;
}

.estimator-btn-secondary:hover:not(:disabled) {
  background: #f9fafb;
}

.estimator-actions {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}

.estimator-actions .estimator-btn-primary {
  flex: 1;
}

/* Loading state */
.estimator-loading {
  text-align: center;
  padding: 40px 20px;
}

.estimator-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e5e5e5;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: estimator-spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

@keyframes estimator-spin {
  to {
    transform: rotate(360deg);
  }
}

.estimator-loading p {
  color: #6b7280;
  font-size: 14px;
}

/* Error state */
.estimator-error {
  text-align: center;
  padding: 40px 20px;
}

.estimator-error-icon {
  width: 48px;
  height: 48px;
  background: #fef2f2;
  color: #ef4444;
  font-size: 24px;
  font-weight: 700;
  line-height: 48px;
  border-radius: 50%;
  margin: 0 auto 16px;
  border: 2px solid #fecaca;
}

.estimator-error p {
  color: #6b7280;
  margin-bottom: 16px;
}

/* Success state */
.estimator-success {
  text-align: center;
  padding: 40px 20px;
}

.estimator-success-icon {
  width: 64px;
  height: 64px;
  background: #10b981;
  color: #ffffff;
  font-size: 32px;
  line-height: 64px;
  border-radius: 50%;
  margin: 0 auto 16px;
}

.estimator-success h3 {
  font-size: 18px;
  margin-bottom: 8px;
}

.estimator-success p {
  color: #6b7280;
  margin-bottom: 20px;
}

.estimator-success .estimator-btn {
  display: block;
  width: 100%;
  margin-bottom: 8px;
}

/* Modal overlay */
.estimator-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 999999;
}

.estimator-modal-content {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  max-height: 90vh;
  overflow-y: auto;
  animation: estimator-modal-in 0.2s ease;
}

@keyframes estimator-modal-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Floating action button */
.estimator-fab {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: #3b82f6;
  color: #ffffff;
  border: none;
  border-radius: 50px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: all 0.2s ease;
  z-index: 999998;
}

.estimator-fab:hover {
  background: #2563eb;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
  transform: translateY(-2px);
}

.estimator-fab-icon {
  font-size: 18px;
}

.estimator-fab-br {
  bottom: 20px;
  right: 20px;
}

.estimator-fab-bl {
  bottom: 20px;
  left: 20px;
}

.estimator-fab-tr {
  top: 20px;
  right: 20px;
}

.estimator-fab-tl {
  top: 20px;
  left: 20px;
}

/* Mobile responsive */
@media (max-width: 480px) {
  .estimator-widget {
    max-width: 100%;
  }

  .estimator-modal-overlay {
    padding: 0;
    align-items: flex-end;
  }

  .estimator-modal-content {
    width: 100%;
    max-height: 95vh;
    border-radius: 12px 12px 0 0;
    animation: estimator-modal-in-mobile 0.3s ease;
  }

  @keyframes estimator-modal-in-mobile {
    from {
      opacity: 0;
      transform: translateY(100%);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .estimator-fab-label {
    display: none;
  }

  .estimator-fab {
    padding: 16px;
    border-radius: 50%;
  }
}
`

let stylesInjected = false

/**
 * Inject widget styles into the page
 */
export function injectStyles() {
  if (stylesInjected) return

  const style = document.createElement('style')
  style.id = 'estimator-widget-styles'
  style.textContent = CSS
  document.head.appendChild(style)

  stylesInjected = true
}
