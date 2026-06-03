#!/usr/bin/env python3
"""
mark2pdf - 简洁的Markdown转PDF工具
使用本地中文字体，确保中文不乱码
"""

import argparse
import os
import sys
from pathlib import Path

# 检查依赖
try:
    import markdown
except ImportError:
    print("❌ 缺少依赖: markdown")
    print("   安装: pip install markdown")
    sys.exit(1)

try:
    from weasyprint import HTML, CSS
    from weasyprint.text.fonts import FontConfiguration
except ImportError:
    print("❌ 缺少依赖: weasyprint")
    print("   安装: pip install weasyprint")
    print("   系统依赖: libpango-1.0-0 libharfbuzz0b libpangoft2-1.0-0")
    sys.exit(1)


class Mark2PDF:
    """简洁的Markdown转PDF转换器"""
    
    def __init__(self):
        self.font_path = self._get_font_path()
        self.css = self._generate_css()
    
    def _get_font_path(self):
        """获取本地中文字体路径"""
        font_dir = Path(__file__).parent.parent / "fonts"
        font_file = font_dir / "wqy-microhei" / "wqy-microhei.ttc"
        
        if font_file.exists():
            print(f"✅ 使用本地字体: {font_file.name}")
            return font_file
        else:
            print("❌ 未找到中文字体文件")
            print(f"   预期位置: {font_file}")
            sys.exit(1)
    
    def _generate_css(self):
        """生成CSS样式，包含本地字体"""
        font_url = self.font_path.as_uri()
        
        return f"""
        @page {{
            size: A4;
            margin: 2cm;
        }}
        
        @font-face {{
            font-family: 'ChineseFont';
            src: url('{font_url}');
        }}
        
        body {{
            font-family: 'ChineseFont', sans-serif;
            font-size: 12pt;
            line-height: 1.6;
            color: #333;
        }}
        
        h1, h2, h3 {{
            color: #1a365d;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
        }}
        
        h1 {{ font-size: 2em; border-bottom: 2px solid #4299e1; padding-bottom: 0.3em; }}
        h2 {{ font-size: 1.5em; border-bottom: 1px solid #cbd5e0; padding-bottom: 0.2em; }}
        h3 {{ font-size: 1.2em; }}
        
        p {{ margin: 0.8em 0; }}
        ul, ol {{ margin: 1em 0; padding-left: 2em; }}
        li {{ margin: 0.3em 0; }}
        
        code {{
            font-family: 'Courier New', monospace;
            background-color: #f7fafc;
            padding: 0.2em 0.4em;
            border-radius: 3px;
        }}
        
        pre {{
            font-family: 'Courier New', monospace;
            background-color: #f7fafc;
            padding: 1em;
            border-radius: 5px;
            overflow-x: auto;
        }}
        
        table {{
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
        }}
        
        th, td {{
            border: 1px solid #cbd5e0;
            padding: 0.5em;
        }}
        
        th {{ background-color: #edf2f7; }}
        """
    
    def convert(self, input_path, output_path):
        """转换Markdown文件为PDF"""
        try:
            # 读取文件
            with open(input_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            print(f"📖 读取: {Path(input_path).name}")
            
            # 检查中文字符
            chinese_chars = sum(1 for c in content if '\u4e00' <= c <= '\u9fff')
            if chinese_chars > 0:
                print(f"   中文字符: {chinese_chars}")
            
            # 转换为HTML
            html_content = markdown.markdown(content, extensions=['extra'])
            html_doc = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <style>{self.css}</style>
</head>
<body>
{html_content}
</body>
</html>"""
            
            # 生成PDF
            print(f"🖨️  生成: {Path(output_path).name}")
            font_config = FontConfiguration()
            html = HTML(string=html_doc)
            css = CSS(string=self.css, font_config=font_config)
            
            html.write_pdf(output_path, stylesheets=[css], font_config=font_config)
            
            # 验证结果
            if os.path.exists(output_path):
                size = os.path.getsize(output_path)
                print(f"✅ PDF创建成功: {size:,} 字节")
                print(f"   字体: {self.font_path.name} (已嵌入)")
                if chinese_chars > 0:
                    print(f"   ✅ {chinese_chars}个中文字符将正确显示")
                return True
            
            return False
            
        except Exception as e:
            print(f"❌ 转换失败: {e}")
            return False


def main():
    parser = argparse.ArgumentParser(description='mark2pdf - Markdown转PDF (中文支持)')
    parser.add_argument('input', help='输入Markdown文件 (.md)')
    parser.add_argument('output', nargs='?', help='输出PDF文件 (.pdf)，默认同输入文件名')
    
    args = parser.parse_args()
    
    # 验证输入文件
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"❌ 文件不存在: {input_path}")
        sys.exit(1)
    
    # 确定输出路径
    if args.output:
        output_path = Path(args.output)
    else:
        output_path = input_path.with_suffix('.pdf')
    
    # 执行转换
    converter = Mark2PDF()
    success = converter.convert(str(input_path), str(output_path))
    
    if success:
        print(f"\n🎉 转换完成!")
        print(f"   输入: {input_path.name}")
        print(f"   输出: {output_path.name}")
        sys.exit(0)
    else:
        print("\n❌ 转换失败")
        sys.exit(1)


if __name__ == '__main__':
    main()