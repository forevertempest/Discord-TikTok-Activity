import React from 'react';

function isChunkLoadError(error) {
  const message = `${error?.message || ''} ${error?.stack || ''}`;
  return /dynamically imported module|Failed to fetch|Loading chunk|Importing a module script failed|ChunkLoadError/i.test(message);
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[UI ERROR]', error, info);

    if (isChunkLoadError(error)) {
      try {
        const key = 'tiktok:chunk-reload';
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
        }
      } catch (err) {
        window.location.reload();
      }
    }
  }

  componentDidMount() {
    window.setTimeout(() => {
      try {
        sessionStorage.removeItem('tiktok:chunk-reload');
      } catch (err) {
        // Storage can be blocked in embeds.
      }
    }, 3500);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="state-view state-view--error">
        <img className="boot-logo" src="/brand/avatar.png" alt="" />
        <p>Интерфейс восстановился после ошибки. Откройте заново, если экран не обновился автоматически.</p>
        <div style={{ color: '#ff6b6b', fontSize: '13px', margin: '10px 0', wordBreak: 'break-all' }}>
          Error: {this.state.error?.message || 'Unknown error'}
        </div>
        <button type="button" className="ghost-button" onClick={() => window.location.reload()}>
          Открыть заново
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
