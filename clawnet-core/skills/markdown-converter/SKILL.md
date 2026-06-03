---
name: markdown-converter
description: Convert documents and files to Markdown using markitdown. Use when converting PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx, .xls), HTML, CSV, JSON, XML, images (with EXIF/OCR), audio (with transcription), ZIP archives, YouTube URLs, or EPubs to Markdown format for LLM processing or text analysis.
---

# Markdown Converter

Convert files to Markdown using `uvx markitdown[all]` — no installation required.

## Basic Usage

```bash
# Convert to stdout (使用 [all] 支持所有格式)
uvx markitdown[all] input.pdf

# Save to file
uvx markitdown[all] input.pdf -o output.md
uvx markitdown[all] input.docx > output.md

# From stdin
cat input.pdf | uvx markitdown[all]

# 如果镜像已预装 markitdown[all]，可直接使用：
markitdown input.pdf
```

## Supported Formats

- **Documents**: PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx, .xls)
- **Web/Data**: HTML, CSV, JSON, XML
- **Media**: Images (EXIF + OCR), Audio (EXIF + transcription)
- **Other**: ZIP (iterates contents), YouTube URLs, EPub

## Options

```bash
-o OUTPUT      # Output file
-x EXTENSION   # Hint file extension (for stdin)
-m MIME_TYPE   # Hint MIME type
-c CHARSET     # Hint charset (e.g., UTF-8)
-d             # Use Azure Document Intelligence
-e ENDPOINT    # Document Intelligence endpoint
--use-plugins  # Enable 3rd-party plugins
--list-plugins # Show installed plugins
```

## Examples

```bash
# Convert Word document
uvx markitdown[all] report.docx -o report.md

# Convert Excel spreadsheet
uvx markitdown[all] data.xlsx > data.md

# Convert PowerPoint presentation
uvx markitdown[all] slides.pptx -o slides.md

# Convert with file type hint (for stdin)
cat document | uvx markitdown[all] -x .pdf > output.md

# Use Azure Document Intelligence for better PDF extraction
uvx markitdown[all] scan.pdf -d -e "https://your-resource.cognitiveservices.azure.com/"
```

## Notes

- Output preserves document structure: headings, tables, lists, links
- First run caches dependencies; subsequent runs are faster
- For complex PDFs with poor extraction, use `-d` with Azure Document Intelligence
