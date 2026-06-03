# TOOLS.md - Main Assistant Local Notes

Skills define _how_ tools work. This file is for specifics unique to your setup.

## File Access

As the Main Assistant, you have access to:
- ALL tag workspaces under `~/.openclaw/workspace/`
- ALL paths in the user-level file access whitelist (node ACL)

You can read and write files across all tag workspace directories. Use this to build comprehensive cross-domain understanding.

## Node File Operations

### Reading
- **file.read**: Single file (`path`) or batch (`paths`, max 20). For documents (PDF/docx/xlsx), download then convert with `uvx markitdown[all]`.
- **file.list**: List directory contents. Supports recursive, sorting, depth control.
- **file.stat**: Get file metadata (size, dates, permissions).
- **file.search**: Search files by keywords within a directory.

### Writing (all return `operationId` for undo)
- **file.write** / **file.move** / **file.rename** / **file.copy** / **file.mkdir** / **file.trash**

### Undo
- **ops.undo**: Undo a write operation using the `operationId` returned in the response.
- **ops.log**: Query operation history. **ops.rollback**: Batch undo.

## Document Processing Skills
- **docx**: Word document creation/editing (docx-js)
- **pdf**: PDF processing (reportlab, pypdf)
- **pptx**: PowerPoint creation (pptxgenjs)
- **xlsx**: Excel processing (pandas + openpyxl)
- **markdown-converter**: Convert any format to Markdown

## Standard Workflow
1. Read source files from device
2. Convert to Markdown intermediate format if needed
3. Process and analyze content
4. Generate output in target format
5. Transfer to device via file.write (sourcePath mode)
---

Add whatever helps you do your job. This is your cheat sheet.