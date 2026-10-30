import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bootstrap } from './main.js';
import { createWsClient } from './ws.js';

/**
 * The spec type of the most recent `tab:issues` subscription request.
 *
 * @returns {string}
 */
function lastIssuesSpecType() {
  const subs = calls.filter(
    (c) => c.type === 'subscribe-list' && c.payload?.id === 'tab:issues'
  );
  return subs.length > 0 ? String(subs[subs.length - 1].payload.type) : '';
}

/**
 * Number of `tab:issues` subscription requests sent so far.
 *
 * @returns {number}
 */
function issuesSubCount() {
  return calls.filter(
    (c) => c.type === 'subscribe-list' && c.payload?.id === 'tab:issues'
  ).length;
}

/**
 * Ids of the currently rendered rows.
 *
 * @returns {string[]}
 */
function rowIds() {
  return Array.from(document.querySelectorAll('#list-root tr.issue-row')).map(
    (el) => el.getAttribute('data-issue-id') || ''
  );
}

/**
 * Let queued microtasks (subscriptions, store notifications) settle.
 */
async function settle() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

const ISSUE_A = {
  id: 'A-1',
  title: 'open one',
  status: 'open',
  created_at: 10,
  updated_at: 10
};
const ISSUE_B = {
  id: 'B-1',
  title: 'blocked one',
  status: 'blocked',
  created_at: 20,
  updated_at: 20
};
const ISSUE_C = {
  id: 'C-1',
  title: 'in progress one',
  status: 'in_progress',
  created_at: 30,
  updated_at: 30
};

/** @type {{ type: string, payload: any }[]} */
const calls = [];
vi.mock('./ws.js', () => {
  /** @type {Record<string, (p: any) => void>} */
  const handlers = {};
  /** @type {((s: string) => void)[]} */
  const conn_handlers = [];
  const singleton = {
    /**
     * @param {import('./protocol.js').MessageType} type
     * @param {any} payload
     */
    async send(type, payload) {
      calls.push({ type, payload });
      return null;
    },
    /**
     * @param {import('./protocol.js').MessageType} type
     * @param {(p: any) => void} handler
     */
    on(type, handler) {
      handlers[type] = handler;
      return () => {
        delete handlers[type];
      };
    },
    /**
     * @param {import('./protocol.js').MessageType} type
     * @param {any} payload
     */
    _trigger(type, payload) {
      if (handlers[type]) {
        handlers[type](payload);
      }
    },
    /**
     * @param {(s: string) => void} handler
     */
    onConnection(handler) {
      conn_handlers.push(handler);
      return () => {};
    },
    /**
     * Test helper: drive the connection state machine.
     *
     * @param {string} state
     */
    _conn(state) {
      for (const fn of conn_handlers) {
        fn(state);
      }
    },
    close() {},
    getState() {
      return 'open';
    }
  };
  return { createWsClient: () => singleton };
});

describe('issues view — reconnect', () => {
  /** @type {any} */
  let client;

  beforeEach(async () => {
    calls.length = 0;
    window.localStorage.clear();
    client = /** @type {any} */ (createWsClient());
    window.location.hash = '#/issues';
    document.body.innerHTML = '<main id="app"></main>';
    const root = /** @type {HTMLElement} */ (document.getElementById('app'));

    bootstrap(root);
    await settle();
  });

  test('a reconnect re-subscribes the issues list', async () => {
    expect(issuesSubCount()).toBe(1);

    client._conn('reconnecting');
    client._conn('open');
    await settle();

    expect(issuesSubCount()).toBe(2);
    expect(lastIssuesSpecType()).toBe('all-issues');
  });

  test('a snapshot from the new socket is applied, not dropped as stale', async () => {
    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 1,
      issues: [ISSUE_A, ISSUE_B, ISSUE_C]
    });
    await settle();
    expect(rowIds()).toEqual(['A-1', 'B-1', 'C-1']);

    client._conn('reconnecting');
    client._conn('open');
    await settle();

    // The new socket restarts its revision counter at 1.
    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 1,
      issues: [ISSUE_A, ISSUE_C]
    });
    await settle();

    expect(rowIds()).toEqual(['A-1', 'C-1']);
  });
});
