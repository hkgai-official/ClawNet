---
name: mark2pdf
description: "Convert Markdown to PDF with guaranteed Chinese character support (no乱码). Uses local Chinese font file, works in Docker containers, no system font dependency."
---

# mark2pdf - Markdown转PDF (中文支持)

简洁高效的Markdown转PDF工具，使用本地中文字体，确保中文不乱码。

## 🎯 核心特性

- ✅ **中文不乱码** - 字体已嵌入PDF，跨平台显示一致
- ✅ **无需下载字体** - 字体文件已包含在技能包中
- ✅ **Docker兼容** - 不依赖系统字体
- ✅ **简单易用** - 单脚本实现，依赖明确

## 🚀 快速开始

### 1. 安装依赖

**Python依赖**：
```bash
pip install weasyprint markdown
```

**系统依赖** (Ubuntu/Debian)：
```bash
sudo apt-get install libpango-1.0-0 libharfbuzz0b libpangoft2-1.0-0
```

**系统依赖** (macOS)：
```bash
brew install pango harfbuzz
```

### 2. 使用技能

```bash
# 基本用法
python scripts/mark2pdf.py document.md

# 指定输出文件
python scripts/mark2pdf.py input.md output.pdf

# 查看帮助
python scripts/mark2pdf.py --help
```

## 📁 文件结构

```
mark2pdf-simple/
├── SKILL.md              # 此文档
├── scripts/
│   └── mark2pdf.py       # 🎯 核心转换脚本
└── fonts/
    └── wqy-microhei/
        └── wqy-microhei.ttc  # 中文字体文件 (5MB)
```

## 🔧 技术说明

### 字体方案
- 使用**文泉驿微米黑**字体 (wqy-microhei.ttc)
- 字体已包含在技能包中，无需额外下载
- 字体嵌入PDF，确保在任何系统正确显示中文

### 依赖说明
- **weasyprint**: PDF生成引擎 (需要系统字体库)
- **markdown**: Markdown解析器
- **系统字体库**: Pango, HarfBuzz (渲染文本)

## ⚠️ 常见问题

### 1. 导入错误 "No module named 'weasyprint'"
```bash
# 安装缺失的Python包
pip install weasyprint
```

### 2. WeasyPrint初始化错误
```bash
# 安装系统依赖 (Ubuntu/Debian)
sudo apt-get install libpango-1.0-0 libharfbuzz0b libpangoft2-1.0-0
```

### 3. 中文显示为方框
- 确保使用本技能的`mark2pdf.py`脚本
- 脚本会自动使用本地字体文件
- 字体已嵌入PDF，应在任何PDF阅读器正确显示

## 📋 使用示例

### 转换中文文档
```bash
python scripts/mark2pdf.py 中文文档.md
# 生成: 中文文档.pdf (中文正确显示)
```

### 转换英文文档
```bash
python scripts/mark2pdf.py README.md report.pdf
# 生成: report.pdf
```

## 🔍 验证输出

```bash
# 检查PDF字体
pdffonts output.pdf

# 应显示:
# LocalChineseFont (已嵌入)
```

## 🎨 输出特点

- **页面尺寸**: A4
- **边距**: 2cm
- **字体**: 文泉驿微米黑 (12pt)
- **编码**: UTF-8
- **格式**: 标准PDF 1.7

## 📦 部署到其他机器

```bash
# 1. 复制整个目录
cp -r mark2pdf-simple /目标路径/

# 2. 安装依赖
pip install weasyprint markdown

# 3. 使用
python /目标路径/mark2pdf-simple/scripts/mark2pdf.py 文档.md
```

## ✅ 优势总结

1. **零配置** - 字体已包含，开箱即用
2. **跨平台** - 字体嵌入PDF，显示一致
3. **轻量级** - 单脚本实现，依赖明确
4. **可靠** - 经过实际测试验证

---
*技能版本: 1.0*
*最后更新: 2026-03-02*