import { describe, expect, it } from 'vitest';
import { navigateTo, tabForHref, tabForLocation, type TabKey } from './appNavigation';

/** A `history` stand-in that records what was pushed, so the ORDER of pushState vs setTab is testable. */
function recordingHistory() {
  const pushed: string[] = [];
  return { pushed, pushState: (_s: unknown, _t: string, href: string) => void pushed.push(href) };
}

describe('appNavigation', () => {
  // LOGI-0012 AC-6
  it('maps a drill-down href to the tab it names // LOGI-0012 AC-6', () => {
    expect(tabForHref('/shipments?status=Pending&routeId=3')).toBe('shipments');
    expect(tabForHref('/shipments')).toBe('shipments');
    expect(tabForHref('/vehicles?status=Available')).toBe('vehicles');
    expect(tabForHref('/drivers?status=Active')).toBe('drivers');
    expect(tabForHref('/dashboard')).toBe('dashboard');
  });

  // LOGI-0012 AC-6
  it('does not let the query string defeat the match // LOGI-0012 AC-6', () => {
    // Regression: the segment used to be read off the WHOLE href, so every drill-down resolved to null
    // and the click silently did nothing. Any query must be cut before the segment is compared.
    for (const q of ['?status=Pending', '?routeId=3', '?a=1&b=2&c=3', '?']) {
      expect(tabForHref(`/shipments${q}`), `query ${q} must not change the tab`).toBe('shipments');
    }
  });

  // LOGI-0012 AC-6
  it('returns null for a path that names no tab, rather than guessing // LOGI-0012 AC-6', () => {
    expect(tabForHref('/')).toBeNull();
    expect(tabForHref('/nope?status=Pending')).toBeNull();
    expect(tabForHref('')).toBeNull();
    // A prefix must not match: /shipments-archive is not the shipments tab.
    expect(tabForHref('/shipments-archive')).toBeNull();
  });

  // LOGI-0012 AC-6
  it('writes the URL BEFORE switching tab, because the list hydrates on mount // LOGI-0012 AC-6', () => {
    const history = recordingHistory();
    const order: string[] = [];
    navigateTo(
      '/shipments?status=Pending&routeId=3',
      () => order.push(`setTab after ${history.pushed.length} push`),
      history,
    );
    expect(history.pushed).toEqual(['/shipments?status=Pending&routeId=3']);
    expect(order).toEqual(['setTab after 1 push']);
  });

  // LOGI-0012 AC-6
  it('leaves the screen untouched for an href naming no tab // LOGI-0012 AC-6', () => {
    const history = recordingHistory();
    let switches = 0;
    const result = navigateTo('/nowhere?x=1', () => void switches++, history);
    expect(result).toBeNull();
    expect(switches).toBe(0);
    expect(history.pushed).toEqual([]);
  });

  // LOGI-0012 AC-6
  it('reads the Back-button tab from the location, ignoring any query // LOGI-0012 AC-6', () => {
    expect(tabForLocation({ pathname: '/shipments' })).toBe('shipments');
    expect(tabForLocation({ pathname: '/' })).toBeNull();
  });

  // LOGI-0012 AC-6
  it('covers every tab the shell renders, so no href can name a tab the shell lacks // LOGI-0012 AC-6', () => {
    const tabs: TabKey[] = [
      'warehouses',
      'vehicles',
      'drivers',
      'shipments',
      'routes',
      'board',
      'dashboard',
    ];
    for (const tab of tabs) expect(tabForHref(`/${tab}`)).toBe(tab);
  });
});