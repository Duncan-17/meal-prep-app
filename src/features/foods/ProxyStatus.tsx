/**
 * Is the API proxy up, and does it have a key?
 *
 * `/api/health` reports only WHETHER each secret is configured, never its
 * value — so this answers "did my key load?" without anything, or anyone,
 * reading `.dev.vars`.
 */

import { useEffect, useState } from 'react';

import { checkProxyHealth, type ProxyHealth } from '@/features/foods/api';

type State =
  { kind: 'checking' } | { kind: 'up'; health: ProxyHealth } | { kind: 'down'; message: string };

export function ProxyStatus() {
  const [state, setState] = useState<State>({ kind: 'checking' });

  useEffect(() => {
    const controller = new AbortController();

    checkProxyHealth(controller.signal)
      .then((health) => {
        if (!controller.signal.aborted) setState({ kind: 'up', health });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'down',
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => controller.abort();
  }, []);

  if (state.kind === 'checking') {
    return <p className="proxystatus proxystatus--muted">Checking API proxy…</p>;
  }

  if (state.kind === 'down') {
    return (
      <div className="notice notice--warn">
        <p className="notice__title">API proxy not running</p>
        <p className="notice__body">
          Food search needs the Pages Function. In a second terminal run{' '}
          <code>npm run dev:api</code>, then reload.
        </p>
      </div>
    );
  }

  if (!state.health.usdaKeyConfigured) {
    return (
      <div className="notice notice--warn">
        <p className="notice__title">Proxy is up, but there is no USDA key</p>
        <p className="notice__body">
          Add <code>USDA_API_KEY</code> to <code>.dev.vars</code> and restart{' '}
          <code>npm run dev:api</code> — wrangler only reads that file at startup.
        </p>
      </div>
    );
  }

  return (
    <p className="proxystatus proxystatus--ok">
      API proxy up · USDA key loaded
      {state.health.offContactConfigured ? ' · Open Food Facts enabled' : ''}
    </p>
  );
}
