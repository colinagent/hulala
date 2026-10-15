import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ConversationMessageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    // Keep diagnostics useful without copying message text or attachment data
    // from a thrown value into the log.
    console.error('[conversation] Message rendering failed', info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="hulala-activity-error" role="alert">
        <span>This message could not be displayed.</span>
        {' '}
        <button type="button" className="hulala-activity-window-control" onClick={() => this.setState({ failed: false })}>Retry display</button>
      </div>
    );
  }
}
