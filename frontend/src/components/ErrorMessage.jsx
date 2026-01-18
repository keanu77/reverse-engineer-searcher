import React from 'react';

/**
 * 錯誤訊息組件
 */
function ErrorMessage({ error, errorType }) {
  if (!error) {
    return null;
  }

  const getErrorIcon = (type) => {
    switch (type) {
      case 'network': return '🔌';
      case 'timeout': return '⏱️';
      case 'rate_limit': return '⚠️';
      case 'validation': return '📝';
      case 'not_found': return '🔍';
      case 'server': return '🖥️';
      default: return '❌';
    }
  };

  const getErrorHint = (type) => {
    switch (type) {
      case 'network':
        return '請檢查您的網路連線是否正常';
      case 'rate_limit':
        return '請稍等 30 秒後再試';
      case 'server':
        return '如果問題持續，請稍後再試或聯繫管理員';
      default:
        return null;
    }
  };

  const hint = getErrorHint(errorType);

  return (
    <div
      className={`error-message error-${errorType || 'unknown'}`}
      role="alert"
      aria-live="assertive"
    >
      <span className="error-icon" aria-hidden="true">
        {getErrorIcon(errorType)}
      </span>
      <div className="error-content">
        <span className="error-text">{error}</span>
        {hint && (
          <span className="error-hint">{hint}</span>
        )}
      </div>
    </div>
  );
}

export default ErrorMessage;
