---
name: update-docs
description: "Review recent edits and update all documentation including architecture docs, API specs, and edit history. Creates missing docs for new implementations."
---

# Update Documentation

Review recent code changes and update ALL relevant documentation in the `/docs` folder.

## Steps

1. **Read today's edit history**
   - Check `docs/edit-history/` for the current date's session file
   - Identify all files that were modified

2. **Analyze changes**
   - Read the modified files to understand what changed
   - Categorize changes: new features, bug fixes, architecture changes, API changes, config changes

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

6. **Update docs/architecture/ files (IMPORTANT)**
   Review and update all architecture documentation to match current implementation:

   - **01-architecture-overview.md**: Directory structure, service layer, route handlers
   - **02-database-schema.md**: Schema changes, new columns, indexes
   - **03-multi-tenant-encryption.md**: Provisioning flow, deletion, storage setup
   - **04-api-specification.md**: API endpoints, request/response formats, new routes
   - **05-llm-adapter-pattern.md**: LLM provider changes
   - **06-rag-pipeline.md**: RAG flow changes, retrieval updates
   - **07-component-design.md**: UI component changes
   - **08-deployment-guide.md**: Deployment or config changes

   **For each architecture doc:**
   - Check if documented features match actual code implementation
   - Update outdated sections to reflect current code
   - Add NEW sections for features that are implemented but not documented
   - Remove or mark deprecated features that no longer exist
   - Ensure code examples match actual implementation

7. **Create new docs if needed**
   - If a significant new feature or module was added but has no documentation, create appropriate documentation
   - Follow existing documentation style and structure

8. **Report summary**
   - List all documentation files updated
   - Note any new documentation files created
   - Summarize key changes documented
