// 从两个 HTML 中提取 AI_LOGO_SVG，校验每条 SVG 结构完整且两端一致
const fs = require('fs');
const assert = require('assert');

function extractLogoSvg (file) {
  const html = fs.readFileSync(file, 'utf8');
  const start = html.indexOf('AI_LOGO_SVG = {');
  assert.ok(start > 0, file + ': AI_LOGO_SVG not found');
  const end = html.indexOf('};', start);
  const body = html.slice(html.indexOf('{', start), end + 1);
  const keys = [...body.matchAll(/^\s{2,}(\w+): '/gm)].map((m) => m[1]);
  const out = {};
  for (const key of keys) {
    const re = new RegExp('\\b' + key + ": '([\\s\\S]*?)',?\\r?\\n");
    const m = body.match(re);
    assert.ok(m, file + ': missing ' + key);
    out[key] = m[1];
  }
  return out;
}

for (const file of [
  'src-renderer/ai-assistant/ai-assistant.html',
  'src-renderer/desktop-settings/desktop-settings.html'
]) {
  const logos = extractLogoSvg(file);
  const expected = ['openai', 'deepseek', 'glm', 'kimi', 'mimo', 'huaweipangu', 'qwen', 'sensenova', 'free', 'custom'];
  assert.deepStrictEqual(Object.keys(logos).sort(), [...expected].sort(), file + ': provider keys');
  for (const [key, svg] of Object.entries(logos)) {
    assert.ok(svg.startsWith('<svg'), key + ' starts with <svg');
    assert.ok(svg.endsWith('</svg>'), key + ' ends with </svg>');
    assert.ok(svg.includes('viewBox="0 0 24 24"'), key + ' has viewBox');
    assert.ok(svg.includes('currentColor'), key + ' uses currentColor');
    assert.ok(!svg.includes('<title>'), key + ' has no title');
    assert.ok(!/[']/.test(svg), key + ' no single quotes');
    // 标签配平：开/闭标签数量一致
    const open = (svg.match(/<(path|svg|g|rect|circle)\b/g) || []).length;
    const close = (svg.match(/<\/(path|svg|g|rect|circle)>/g) || []).length + (svg.match(/\/>/g) || []).length;
    assert.strictEqual(open, close, key + ' balanced tags');
    // path 数据无异常截断：每条 path 的 d 属性都以合法字符结尾
    for (const d of [...svg.matchAll(/ d="([^"]*)"/g)].map((m) => m[1])) {
      assert.ok(/[a-zA-Z0-9zZ]$/.test(d.trim()), key + ' path d ends reasonably');
    }
  }
  console.log(file + ': ' + Object.keys(logos).length + ' logos OK (' +
    Object.values(logos).reduce((n, s) => n + s.length, 0) + 'B total)');
}

// 两份定义逐字节一致（避免后续维护漂移）
const a = fs.readFileSync('src-renderer/ai-assistant/ai-assistant.html', 'utf8');
const d = fs.readFileSync('src-renderer/desktop-settings/desktop-settings.html', 'utf8');
const grab = (html) => html.slice(html.indexOf('AI_LOGO_SVG = {'), html.indexOf('};', html.indexOf('AI_LOGO_SVG = {')))
  .replace(/\r/g, '')
  .replace(/^\s*(var|const) /, '')
  .replace(/\n\s*/g, '\n');
const bodyA = grab(a);
const bodyD = grab(d);
assert.strictEqual(bodyA, bodyD, 'AI_LOGO_SVG differs between the two files');
console.log('AI_LOGO_SVG identical in both files');
console.log('ALL LOGO SVG TESTS PASSED');
