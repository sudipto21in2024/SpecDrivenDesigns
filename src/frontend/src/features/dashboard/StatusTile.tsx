import { Card, CardActionArea, CardContent, Typography } from '@mui/material';

export interface StatusTileProps {
  /**
   * The tile's heading — a BR-7 status, or "SLA at risk".
   *
   * This is a LABEL, not an enum member: the at-risk tile is not a seventh shipment status, and typing
   * it as one would let the six-status ordering helpers treat it as a BR-7 value.
   */
  label: string;
  /** A stable, lowercase test id stem (`pending`, `at-risk`). */
  testId: string;
  /** The server's UNTRUNCATED count for the active filters (AC-1). Never a page length. */
  count: number;
  /** An existing endpoint carrying the equivalent filter (AC-6). */
  href: string;
  onNavigate: (href: string) => void;
}

/**
 * One dashboard tile (AC-1, AC-6).
 *
 * Two things are deliberate here:
 *  - the number rendered is the server's full count, never `items.length` from the at-risk page, so
 *    "312 shipments" cannot silently become "20 shipments" because a page happened to be 20 long;
 *  - the tile is a link to an EXISTING list endpoint rather than a dashboard-local result view, so
 *    clicking it shows exactly the rows it counted (AC-6).
 *
 * A zero count still renders. Omitting an empty tile would read as "the dashboard forgot to ask",
 * which is a different and much more alarming statement than "there are none" (AC-1).
 */
export default function StatusTile({ label, testId, count, href, onNavigate }: StatusTileProps) {
  return (
    <Card variant="outlined" data-testid={`tile-${testId}`}>
      {/*
        AC-6: the tile is a REAL anchor with a real href, not a click handler that pretends to be a link.
        A manager who middle-clicks or copies the link address gets the drill-down they were offered, and
        the href is assertable — which is what proves the dashboard defines no query language of its own.
      */}
      <CardActionArea
        component="a"
        href={href}
        onClick={(event) => {
          // Left-click in the SPA is handled by the injected navigator (no full page reload), but the
          // href stays real so the link remains openable, copyable and keyboard-activatable.
          event.preventDefault();
          onNavigate(href);
        }}
        data-testid={`tile-link-${testId}`}
        aria-label={`${count} ${label}`}
      >
        <CardContent>
          <Typography variant="overline" color="text.secondary" component="p">
            {label}
          </Typography>
          <Typography variant="h4" component="p" data-testid={`tile-count-${testId}`}>
            {count}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}