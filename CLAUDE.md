# CLAUDE.md

Las reglas del proyecto están en AGENTS.md y aplican completas:

@AGENTS.md

## Específico de Claude Code

- **Skills del proyecto** en `.claude/skills/`: `pey-codi`, `ledger-change`, `deploy-check`.
- **Subagentes** en `.claude/agents/`: `ledger-reviewer`, `pey-contract-checker`, `deploy-verifier`. Úsalos cuando el diff toque su área o cuando la persona lo pida.
- Para trabajo en paralelo usa un worktree por sesión. No compartas directorio con Codex ni con Antigravity.
- No hagas commit ni push sin que la persona lo pida.
