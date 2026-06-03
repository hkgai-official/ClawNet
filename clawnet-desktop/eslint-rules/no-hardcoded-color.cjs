'use strict';

/**
 * Forbids hex / rgb / rgba color literals in component files.
 * Components must reference CSS variables defined in src/renderer/styles/theme.css.
 * Allows: theme.css itself, story files, *.test.* files.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hard-coded color literals in component files; use CSS variable tokens instead.',
    },
    schema: [],
    messages: {
      hex: 'Hard-coded hex color "{{value}}" is forbidden. Use a token from theme.css (e.g., var(--color-brand-500)).',
      rgb: 'Hard-coded rgb()/rgba() color "{{value}}" is forbidden. Use a token from theme.css.',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    if (
      filename.endsWith('theme.css') ||
      filename.includes('/__tests__/') ||
      filename.endsWith('.test.ts') ||
      filename.endsWith('.test.tsx') ||
      filename.endsWith('.stories.tsx')
    ) {
      return {};
    }
    const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
    const RGB = /\brgba?\s*\(/;
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (HEX.test(node.value)) {
          context.report({ node, messageId: 'hex', data: { value: node.value } });
        } else if (RGB.test(node.value)) {
          context.report({ node, messageId: 'rgb', data: { value: node.value } });
        }
      },
      TemplateElement(node) {
        const v = node.value && node.value.raw;
        if (!v) return;
        if (HEX.test(v)) {
          context.report({ node, messageId: 'hex', data: { value: v } });
        } else if (RGB.test(v)) {
          context.report({ node, messageId: 'rgb', data: { value: v } });
        }
      },
    };
  },
};
