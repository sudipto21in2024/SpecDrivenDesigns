import { useCallback, useEffect } from 'react';

/**
 * The SPA's navigation vocabulary: which tab an href names, and how the shell turns one into a move.
 *
 * Extracted from `App.tsx` rather than inlined there for a concrete reason, not tidiness: `App.tsx`
 * carries a 158-line size ratchet, and the shell's only job is composition. Keeping the href grammar
 * here means the one place that decides "does this href name a tab we render?" is a named, testable
 * unit instead of a detail buried in a tab-switch expression.
 */

/** The tab values, which are also the path segments the drill-down hrefs use. */
export type TabKey =
  | 'warehouses'
  | 'vehicles'
  | 'drivers'
  | 'shipments'
  | 'routes'
  | 'board'
  | 'dashboard';

/** Every tab, in the order the shell renders them. Also the accepted set of href segments. */
export const TAB_KEYS: readonly TabKey[] = [
  'warehouses',
  'vehicles',
  'drivers',
  'shipments',
  'routes',
  'board',
  'dashboard',
];

/**
 * The tab an href such as `/shipments?status=Pending&routeId=3` selects, or `null` if it names none.
 *
 * `shipmentListHref` builds its href from the same words as the tab values, so the segment is compared
 * directly against `TAB_KEYS` rather than through a second lookup table — a table would be one more
 * place to forget a tab.
 *
 * The QUERY is cut before comparing, and that line is load-bearing rather than defensive: `href` is a
 * full href, not a pathname, so without the split the segment reads `shipments?status=Pending&routeId=3`
 * and matches nothing. The first version of this omitted the split, and the symptom was a drill-down
 * that still did absolutely nothing — a silent no-op, the hardest kind of bug to see.
 */
export function tabForHref(href: string): TabKey | null {
  const [pathname] = href.split('?');
  const segment = pathname.replace(/^\/+/, '').split('/')[0];
  return (TAB_KEYS as readonly string[]).includes(segment) ? (segment as TabKey) : null;
}

/**
 * Moves the SPA to `href`: writes the URL, then switches tab.
 *
 * The ORDER is the contract. `pushState` lands before `setTab` because React mounts the target page
 * during the state change and `ShipmentsPage` reads `window.location.search` in a lazy `useState`
 * initialiser as it mounts — a URL written afterwards would arrive one render too late, and the list
 * would come up unfiltered while the address bar claimed otherwise.
 *
 * `pushState` rather than a real navigation: a full page load would re-run the whole auth bootstrap
 * for a read-only drill-down, and the tab shell is a state machine, not a router.
 */
export function navigateTo(
  href: string,
  setTab: (tab: TabKey) => void,
  history: Pick<History, 'pushState'> = window.history,
): TabKey | null {
  const target = tabForHref(href);
  // An href naming no known section leaves the screen exactly as it is; silently landing somewhere
  // else would be a worse answer than doing nothing.
  if (target == null) return null;
  history.pushState(null, '', href);
  setTab(target);
  return target;
}

/** The tab the current address bar names — the Back/Forward handler's only input. */
export function tabForLocation(location: Pick<Location, 'pathname'> = window.location): TabKey | null {
  return tabForHref(location.pathname);
}

/**
 * The shell's whole navigation surface: a drill-down `navigate`, a Back-aware `popstate` subscription,
 * and a `selectTab` for tabs clicked directly.
 *
 * A hook rather than three loose callbacks because `App.tsx` carries a 158-line size ratchet and its
 * job is composition — this logic is the shell's only reason to know what an href is, and it is far
 * more legible (and testable) as one named unit than as inline handlers in a JSX-returning component.
 */
export function useTabNavigation(
  setTab: (tab: TabKey) => void,
): { navigate: (href: string) => void; selectTab: (tab: TabKey) => void } {
  const navigate = useCallback((href: string) => {
    navigateTo(href, setTab);
  }, [setTab]);

  useEffect(() => {
    const onPopState = () => {
      // Back onto a non-section path (the initial '/') names no tab; keeping the current one is least
      // surprising, and better than blanking the screen.
      const target = tabForLocation();
      if (target != null) setTab(target);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [setTab]);

  const selectTab = (next: TabKey) => {
    // A tab clicked directly is not a drill-down, so a query left by an earlier one is cleared —
    // otherwise the list would re-hydrate `?routeId=3` on an unrelated later visit.
    if (window.location.search !== '') {
      window.history.pushState(null, '', `/${next}`);
    }
    setTab(next);
  };

  return { navigate, selectTab };
}