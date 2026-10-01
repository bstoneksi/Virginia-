# KSI assistant tracker

Executive-assistant tracker template (KSI Family of Brands); each person runs their own instance personalized
from `assistant.config.json`. Start with `README.md` and `ONBOARDING.md`; the build contract is `docs/SPEC.md`;
this instance's decisions are logged in `docs/DECISIONS.md`; the first instance's scoping lives in
`docs/example-instance/` (reference, not the current product intent).
Run `npm run check` (typecheck + tests + build) before calling anything done. Never commit `.env`,
`assistant.config.local.json` or `data/`.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues via the `gh` CLI (repo created by `docs/SETUP-WIZARD.sh`; `gh` not yet installed on this machine). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root (created lazily). See `docs/agents/domain.md`.
