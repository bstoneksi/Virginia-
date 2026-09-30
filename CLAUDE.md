# Virginia

Brandon Stone's executive-assistant tracker (KSI Family of Brands). Start with `README.md`;
the build contract is `docs/SPEC.md`, product intent is `docs/PRODUCT-SPEC.md` and `docs/SCOPE.md`.
Run `npm run check` (typecheck + tests + build) before calling anything done.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues via the `gh` CLI (repo created by `docs/SETUP-WIZARD.sh`; `gh` not yet installed on this machine). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root (created lazily). See `docs/agents/domain.md`.
