/**
 * Two extra rows in a dock tab's context menu: close the other tabs, or all of them.
 *
 * The shipped menu (`ui-dockkit`'s `TabMenu`) offers one item — close this tab — and
 * then renders whatever `sidebar.right.tab.menu.item` contributes. That slot is the
 * only bulk-close extension point in the product: the public `ctx.sidebarRight` face
 * can close one tab at a time (`close(tabId)`) but has no `closeAll`, and no command
 * or shortcut offers one either.
 *
 * Everything the rows need comes from the service:
 *  - `mounted` names the Session on screen, so a bulk close never reaches into a
 *    Session the user is not looking at;
 *  - `tabsIn(sessionId)` lists that Session's committed tabs (falling back to the
 *    public `openTabs` inventory if the controller method is absent);
 *  - `close(tabId)` runs the same path as the chip's own close button, so the kit's
 *    rules still apply: the last tab of a docked surface folds the column, and a sole
 *    guide tab refuses to close.
 *
 * The rows are plain `role="menuitem"` buttons because dockkit hides a menu that holds
 * no menu item, and its CSS module cannot be imported from here — the class below is
 * reproduced from `dockkit.module.css` and styled by our own stylesheet.
 */
import { createElement } from 'react';

/** dockkit's `.menuItem`, reproduced: its module class is not reachable from a plugin. */
const ROW = {
  padding: '4px 7px',
  width: '100%',
  color: 'var(--dsw-alias-label-primary, #1f2328)',
  fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
  fontFamily: 'inherit',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--dsw-radius-md, 6px)',
  cursor: 'pointer',
};

/**
 * How many times this component may report why it rendered nothing.
 *
 * The tab menu opens on every right-click, so an unbounded log line would grow with
 * use. A handful of samples is enough to tell "service missing" from "slot never
 * reached us" from "only one tab".
 */
const REPORT_LIMIT = 8;
let reportsSent = 0;

/**
 * Report one diagnostic sample, if there is budget left.
 * @param report - the host `diag` sender, when the plugin passed one.
 * @param payload - the sample.
 */
function sample(report, payload) {
  if (typeof report !== 'function' || reportsSent >= REPORT_LIMIT) return;
  reportsSent += 1;
  report(payload);
}

/**
 * The tabs of one Session that may be closed.
 * @param sidebarRight - the `ctx.sidebarRight` service, when it exists.
 * @param sessionId - the Session on screen.
 * @returns `{ id }` records, in the order the layout holds them.
 */
function closableTabs(sidebarRight, sessionId) {
  if (sidebarRight === undefined || sessionId === undefined) return [];
  try {
    const committed = sidebarRight.tabsIn?.(sessionId);
    if (Array.isArray(committed)) {
      return committed.filter((record) => typeof record?.id === 'string').map((record) => ({ id: record.id }));
    }
  } catch {
    /* the controller shape differs; the published inventory still answers */
  }
  try {
    const all = sidebarRight.openTabs?.getSnapshot?.() ?? [];
    return all
      .filter((record) => record?.sessionId === sessionId && typeof record?.tabId === 'string')
      .map((record) => ({ id: record.tabId }));
  } catch {
    return [];
  }
}

/**
 * The menu rows.
 * @param props - the slot's `{ tab, dismiss }` plus `t` and the service getter.
 * @returns the rows, or nothing when there is nothing to batch-close.
 */
export function CloseTabItems(props) {
  const { tab, dismiss, t } = props;
  const sidebarRight = typeof props.getSidebarRight === 'function' ? props.getSidebarRight() : undefined;
  const sessionId = sidebarRight?.mounted?.getSnapshot?.();
  const tabs = closableTabs(sidebarRight, sessionId);
  // A single tab has nothing to batch-close: the kit's own item already closes it.
  // Either way the reason is reported once, because "the rows are missing" is
  // otherwise indistinguishable from "the slot never rendered us".
  if (sidebarRight === undefined || tabs.length < 2) {
    sample(props.report, {
      kind: 'tab-menu',
      stage: 'render',
      skipped: sidebarRight === undefined ? 'no-service' : 'too-few-tabs',
      tabs: tabs.length,
      sessionId: typeof sessionId === 'string' ? 'present' : 'missing',
    });
    return null;
  }
  sample(props.report, { kind: 'tab-menu', stage: 'render', rendered: 2, tabs: tabs.length });

  /**
   * Close every tab but `keep` (and, with `keep === undefined`, every tab).
   * @param keep - the tab the menu was opened on, for "close the others".
   */
  const close = (keep) => {
    const doomed = tabs.map((record) => record.id).filter((id) => id !== keep);
    // Dismiss first: the rows unmount with the menu, and a tab that closes the
    // surface under them must not be followed by a setState on a dead node.
    if (typeof dismiss === 'function') dismiss();
    for (const id of doomed) {
      try {
        sidebarRight.close(id);
      } catch (error) {
        console.error('[dsh-sidebar-editor] closing a tab failed', error);
      }
    }
  };

  return [
    createElement(
      'button',
      {
        key: 'others',
        type: 'button',
        role: 'menuitem',
        className: 'dsh-se-tab-menu-item',
        style: ROW,
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          close(tab?.id);
        },
      },
      typeof t === 'function' ? t('closeOtherTabs') : '关闭其他标签',
    ),
    createElement(
      'button',
      {
        key: 'all',
        type: 'button',
        role: 'menuitem',
        className: 'dsh-se-tab-menu-item',
        style: ROW,
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          close(undefined);
        },
      },
      typeof t === 'function' ? t('closeAllTabs') : '关闭全部标签',
    ),
  ];
}
