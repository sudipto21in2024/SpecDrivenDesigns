# LogiFlow `contracts/v1/` — OpenAPI authorship folder (LOGI-0015)

**Rule: humans edit ONLY `contracts/v1/*.yaml`.**
`contracts/v1-openapi.yaml` is a GENERATED bundle artifact — never hand-edit.

## Layout

- `head.yaml` — `openapi/info/servers/tags` (top headers only)
- `foot.yaml` — root `security:` (2 lines)
- `paths/*.yaml` — one file per resource; each holds verbatim `  /path:` blocks
  - `shipments.yaml` = `/shipments` + `/shipments/{id}`
  - `shipments-lifecycle.yaml` = `/status-transitions` + `/status-history`
- `components/security.yaml` — `BearerAuth` body (under `securitySchemes:`)
- `components/schemas/*.yaml` — schema bodies (`common` = Health/ProblemDetails;
  `routes.yaml` also holds shared `PagedResponse` at the end, matching original key order)
- `components/responses.yaml` — `ValidationProblem/Unauthorized/...` bodies
- `components/extensions.yaml` — `x-role-sets` + `x-conventions` bodies

## Workflow

```bash
# after editing any contracts/v1/*.yaml fragment:
node tools/contract/bundle.mjs          # regenerate the artifact
node tools/contract/bundle.mjs --check  # drift gate (CI runs this)
npx --yes @stoplight/spectral-cli lint contracts/v1-openapi.yaml --ruleset contracts/.spectral.yaml
node tools/contract/check-size.mjs --staged   # 150-line rigid gate
```

Bundle key order is fixed in `tools/contract/bundle.mjs` to match the original
file, so regenerated diffs stay minimal. Every fragment must stay ≤150 lines.
