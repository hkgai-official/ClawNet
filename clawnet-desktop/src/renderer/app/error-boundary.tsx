import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer error:', error, info);
  }
  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div role="alert" style={{ padding: 24, fontFamily: 'var(--font-sans)' }}>
          <h2 style={{ margin: 0, marginBottom: 8 }}>Something went wrong</h2>
          <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
