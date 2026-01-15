---
name: update-docs
description: "Review recent edits and update all relevant documentation. Updates edit-history, CLAUDE.md, and README.md based on code changes."
---

# Update Documentation

Review recent code changes and update all relevant documentation.

## Steps

1. **Read today's edit history**
   - Check `docs/edit-history/` for the current date's session file
   - Identify all files that were modified

2. **Analyze changes**
   - Read the modified files to understand what changed
   - Categorize changes: new features, bug fixes, architecture changes, config changes

3. **Update edit-history session file**
   - Add a summary section at the top describing what was accomplished
   - Group related changes under descriptive headings
   - Add any missing context about why changes were made

4. **Update CLAUDE.md if needed**
   - New commands or scripts added
   - Architecture or key modules changed
   - New environment variables required
   - New routes or endpoints added

5. **Update docs/README.md if needed**
   - New features or capabilities
   - Changed setup instructions
   - Updated project overview

6. **Report summary**
   - List all documentation files updated
   - Summarize key changes documented
