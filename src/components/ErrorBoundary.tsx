import React from 'react'

type State = { hasError: boolean; error?: Error; info?: React.ErrorInfo }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: any) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ hasError: true, error, info })
    try {
      if (typeof window !== 'undefined' && (window as any).api?.logError) {
        ;(window as any).api.logError({ message: String(error), stack: (error && error.stack) || '', info })
      }
    } catch {}
    // ensure visible console output for developers
    // eslint-disable-next-line no-console
    console.error('Unhandled error caught by ErrorBoundary:', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children as React.ReactElement

    const err = this.state.error
    return (
      <div style={{ padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ maxWidth: 900, margin: '48px auto', textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#6b7280', marginBottom: 16 }}>An unexpected error occurred while rendering the app.</p>
          {err && (
            <pre style={{ textAlign: 'left', whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 12, borderRadius: 8, color: '#111827' }}>
              {err.message}
              {err.stack ? '\n\n' + err.stack : ''}
            </pre>
          )}
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={() => window.location.reload()} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff' }}>
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
