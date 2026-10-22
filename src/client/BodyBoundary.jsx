/**
 * Last line of defence around the editor body.
 *
 * A crash inside the body used to leave the document tab blank with no way to tell what
 * happened. This boundary turns that into a readable message (and a log line), so the tab
 * stays usable enough to switch back to the official preview and the failure can be
 * diagnosed from the host log instead of a white screen.
 */
import { Component, createElement } from 'react';

/** Report one failure to the host log; never throws. */
function report(error) {
  try {
    console.error('[dsh-sidebar-editor] body', error);
    const pending = fetch('/api/dsh-sidebar-editor/diag', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'body', message: String(error?.stack ?? error).slice(0, 4000) }),
      credentials: 'same-origin',
    });
    void Promise.resolve(pending).catch(() => {});
  } catch {
    // Diagnostics must never throw on their own path.
  }
}

/**
 * The boundary.
 * @param props - `{ children, t }`.
 * @returns the children, or a failure notice.
 */
export class BodyBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { message: undefined };
  }

  static getDerivedStateFromError(error) {
    return { message: String(error?.message ?? error) };
  }

  componentDidCatch(error) {
    report(error);
  }

  render() {
    if (this.state.message === undefined) return this.props.children;
    const t = this.props.t;
    const label = typeof t === 'function' ? t('bodyCrashed') : '编辑器出错';
    return createElement(
      'div',
      {
        style: {
          padding: '12px',
          fontSize: '12px',
          lineHeight: '1.6',
          whiteSpace: 'pre-wrap',
          color: 'var(--dsw-alias-state-error-primary, #ef4444)',
        },
      },
      `${label}\n${this.state.message}\n\nCtrl/Cmd+Shift+R 重新加载；或在工具栏切回官方预览（下拉里的“代码”）。`,
    );
  }
}
