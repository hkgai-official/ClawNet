---
title: "TOOLS.md Template"
summary: "Workspace template for TOOLS.md"
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## Node File Operations

### Reading
- **file.read**: Single file (`path`) or batch (`paths`, max 20). For documents (PDF/docx/xlsx), download then convert with `uvx markitdown[all]`.
- **file.list**: List directory contents. Supports recursive, sorting, depth control.
- **file.stat**: Get file metadata (size, dates, permissions).
- **file.search**: Search files by keywords within a directory.

### Writing
- **file.write**: Text mode (`fileContent`) or transfer mode (`sourcePath`, recommended).
- **file.move**: Move file/directory. Params: `source`, `destination`.
- **file.rename**: Rename in place. Params: `path`, `newName`.
- **file.copy**: Copy file/directory (recursive). Params: `source`, `destination`.
- **file.mkdir**: Create directory (recursive by default). Idempotent.
- **file.trash**: Move to recycle bin (`.clawnet/trash/`). Reversible.

All write operations return an `operationId` in the response.

### Undo & History
- **ops.log**: Query operation history. Filter by command, time range, session.
- **ops.undo**: Undo a single operation using `operationId` (returned by write operations).
- **ops.rollback**: Batch undo. Use `dryRun=true` to preview first.

**Quick undo workflow**: write operation → use returned `operationId` → `ops.undo`

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

## File Access

Your file access is limited to paths configured in your tag's node ACL. You can only read/write files within your allowed paths. If you need access to additional files, ask your user to update the tag permissions in Settings.

---

Add whatever helps you do your job. This is your cheat sheet.
