// 提取 HTML 内联 <script> 做语法检查（不执行）
const fs = require('fs');
const vm = require('vm');

const files = process.argv.slice(2);
let failed = false;

for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let i = 0;
  while ((match = re.exec(html)) !== null) {
    i++;
    const code = match[1];
    if (!code.trim()) continue;
    try {
      new vm.Script(code, {filename: `${file}#script${i}`});
    } catch (err) {
      failed = true;
      const line = err.stack.split('\n')[0];
      console.error(`FAIL ${file} <script #${i}>: ${line}`);
      const m = /:(\d+)$/.exec(err.stack.split('\n')[1] || '');
      if (m) {
        const lines = code.split('\n');
        const ln = Number(m[1]);
        console.error('  >> ' + (lines[ln - 2] || '').trim());
        console.error('  >> ' + (lines[ln - 1] || '').trim());
      }
    }
  }
  console.log(`checked ${file}: ${i} script block(s)`);
}
process.exit(failed ? 1 : 0);
