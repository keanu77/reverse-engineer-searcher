import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary" role="alert">
          <h2>發生未預期的錯誤</h2>
          <p>應用程式遇到問題，請嘗試重新載入。</p>
          <details style={{ marginTop: '1rem', whiteSpace: 'pre-wrap' }}>
            <summary>錯誤詳情</summary>
            {this.state.error?.message}
          </details>
          <button
            className="btn btn-primary"
            onClick={this.handleReset}
            style={{ marginTop: '1rem' }}
          >
            重試
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
