import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error: error?.message || String(error) };
  }

  componentDidCatch(error, info) {
    try { console.error('[ErrorBoundary] caught:', error, info?.componentStack || ''); } catch (_) {}
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    try { window.location.reload(); } catch (_) {}
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#060606',
          color: 'rgba(255,255,255,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          <div style={{
            maxWidth: '480px',
            padding: '32px',
            borderRadius: '12px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <h1 style={{
              fontFamily: 'Orbitron, Equinox, sans-serif',
              fontSize: '14px',
              letterSpacing: '0.12em',
              margin: '0 0 12px',
              color: 'rgba(255,255,255,0.9)',
            }}>
              WARRANTY VAULT
            </h1>
            <p style={{ margin: '0 0 8px', fontSize: '15px', lineHeight: 1.5 }}>
              Something went wrong while rendering this page.
            </p>
            <p style={{
              margin: '0 0 20px',
              fontSize: '12px',
              color: 'rgba(255,255,255,0.4)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              wordBreak: 'break-word',
            }}>
              {this.state.error || 'Unknown error'}
            </p>
            <button
              onClick={this.handleReset}
              style={{
                width: '100%',
                padding: '11px 20px',
                background: '#fff',
                color: '#000',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
