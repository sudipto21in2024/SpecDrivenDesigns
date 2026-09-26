# Active Context — LogiFlow

> Read this file first at every session start. Position: `tracker current` + this file.

## Current work
- **2026-09-26: LOGI-0008 frontend arm sealed and committed (b570176): AC-11 row actions, EditShipmentDialog fed by GET /shipments/{id}, CancelShipmentDialog confirmation, presence-aware PATCH body, 409 message + row refresh; MSW GET/PATCH /shipments/:id and the BR-6 Driver-cancel 403. Build clean, vitest 69/69.**
  - Active arms: none
  - Recent commits:
    - b570176 feat(LOGI-0008): frontend arm - shipment edit/cancel row actions
    - 38c33fe chore(LOGI-0008): handoff backend->frontend + state refresh
    - b90060b feat(LOGI-0008): backend arm - shipment detail/edit + BR-6 cancel guard
    - 2a7c66b chore(LOGI-0008): tick architect milestone 1 (spec) - plan bookkeeping
    - 9b1f1a9 feat(LOGI-0008): architect arm - F6 edit/cancel spec (spec_approved) + additive contract (GET/PATCH shipments/{id})

## Next action
1. LOGI-0008 qa arm: Playwright specs for the AC-11 row-action matrix (per role and per status), the edit dialog happy path with a per-field 400, the cancel confirmation flow, and the AC-1/AC-8 e2e happy paths against a running stack.
