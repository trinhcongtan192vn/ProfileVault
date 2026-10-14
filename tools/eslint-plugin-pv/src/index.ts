import { Linter, type Rule } from 'eslint';
import tseslint from 'typescript-eslint';

const forbidden = /^(publish|public|unlisted|schedule|go live|đăng|công khai|lên lịch|veröffentlichen|öffentlich|planen)$/iu;
const interactions = new Set(['click', 'dblclick', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption', 'setInputFiles', 'pressSequentially', 'goto', 'dispatchEvent', 'tap']);
const meta = (description: string): Rule.RuleMetaData => ({ type: 'problem', docs: { description }, schema: [], messages: { denied: description } });
const rule = (description: string, create: Rule.RuleModule['create']): Rule.RuleModule => ({ meta: meta(description), create });
export const rules: Record<string, Rule.RuleModule> = {
  'no-raw-interaction': rule('Mọi thao tác trang phải qua ctx.ui', (context) => ({
    MemberExpression(node) {
      const property = node.property.type === 'Identifier' && !node.computed ? node.property.name : node.property.type === 'Literal' ? String(node.property.value) : null;
      const object = context.sourceCode.getText(node.object);
      if (property && (interactions.has(property) || property === 'keyboard' || property === 'mouse') && object !== 'ctx.ui') context.report({ node, messageId: 'denied' });
    },
  })),
  'no-forbidden-literal': rule('Pack chứa nhãn thao tác bị cấm', (context) => ({
    Literal(node) { if (typeof node.value === 'string' && forbidden.test(node.value.trim())) context.report({ node, messageId: 'denied' }); },
    TemplateLiteral(node) { if (node.quasis.some((q) => forbidden.test(q.value.raw.trim()))) context.report({ node, messageId: 'denied' }); },
  })),
  'no-eval-page': rule('Chỉ cho evaluate bằng hàm tĩnh đọc dữ liệu', (context) => ({
    CallExpression(node) {
      if (node.callee.type !== 'MemberExpression') return;
      const p = node.callee.property;
      if (p.type !== 'Identifier' || !['evaluate', 'evaluateHandle', 'evaluateAll', 'addScriptTag', 'addInitScript'].includes(p.name)) return;
      const fn = node.arguments[0];
      if (p.name !== 'evaluate' && p.name !== 'evaluateAll' || !fn || !['ArrowFunctionExpression', 'FunctionExpression'].includes(fn.type)) context.report({ node, messageId: 'denied' });
      else if (/\b(fetch|XMLHttpRequest|eval|Function|click|dispatchEvent)\b|(?:location|innerHTML)\s*=/.test(context.sourceCode.getText(fn))) context.report({ node, messageId: 'denied' });
    },
  })),
  'no-network': rule('Pack không được truy cập mạng, tiến trình hoặc filesystem', (context) => ({
    ImportDeclaration(node) {
      const source = String(node.source.value);
      if (/^(?:node:)?(?:https?|http2|net|tls|child_process|fs|vm|worker_threads)(?:\/|$)/.test(source) || !source.startsWith('.') && !['@sctech/profilevault-contract', '@sctech/profilevault-runner'].includes(source)) context.report({ node, messageId: 'denied' });
    },
    CallExpression(node) { if (node.callee.type === 'Identifier' && ['fetch', 'require', 'eval', 'Function'].includes(node.callee.name)) context.report({ node, messageId: 'denied' }); },
    ImportExpression(node) { context.report({ node, messageId: 'denied' }); },
    Identifier(node) { if (['process', 'globalThis', 'XMLHttpRequest', 'WebSocket'].includes(node.name)) context.report({ node, messageId: 'denied' }); },
  })),
};
export const plugin = { rules };
export function lintPackSource(code: string, filename = 'flow.ts'): string[] {
  const linter = new Linter();
  const messages = linter.verify(code, [{ files: ['**/*.ts', '**/*.js'], languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: 'module' }, plugins: { pv: plugin }, rules: Object.fromEntries(Object.keys(rules).map((name) => [`pv/${name}`, 'error'])) }], { filename });
  return messages.filter((m) => m.severity === 2).map((m) => `${m.ruleId ?? 'parse'}:${m.line}: ${m.message}`);
}
export default plugin;
