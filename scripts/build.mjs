/**
 * 生产构建：src/ → dist/
 *  - 语法检查全部 JS（按 ES Module 解析）
 *  - 静态资源内容指纹（cache-busting），重写 index.html 与模块间引用
 *  - 校验产物引用完整性，输出 manifest.json
 * 失败时以非零退出码结束。
 */
import { mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

const JS_FILES = ['flow.js', 'examples.js', 'app.js'];
const HASHED_FILES = ['flow.js', 'examples.js', 'app.js', 'styles.css'];
const PLAIN_FILES = ['healthz'];

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);
const hashedName = (file, h) => file.replace(/(\.[^.]+)$/, `.${h}$1`);

function fail(msg) {
  console.error(`✗ 生产构建失败：${msg}`);
  process.exit(1);
}

async function syntaxCheck(file) {
  const tmp = path.join(dist, `.check-${file}.mjs`);
  await copyFile(path.join(src, file), tmp);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  await rm(tmp, { force: true });
  if (r.status !== 0) fail(`${file} 语法检查未通过\n${r.stderr}`);
}

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  for (const f of JS_FILES) await syntaxCheck(f);

  const nameMap = {};
  const manifest = { generatedAt: new Date().toISOString(), files: {} };

  // 第一遍：内容稳定的资源（被 app.js / index.html 引用）
  for (const f of HASHED_FILES.filter((x) => x !== 'app.js')) {
    const buf = await readFile(path.join(src, f));
    const h = hash(buf);
    nameMap[f] = hashedName(f, h);
    await writeFile(path.join(dist, nameMap[f]), buf);
    manifest.files[f] = { name: nameMap[f], sha256: h };
  }

  // 第二遍：app.js（需重写对其它模块的引用后再指纹）
  let appJs = await readFile(path.join(src, 'app.js'), 'utf8');
  for (const [orig, hashed] of Object.entries(nameMap)) {
    appJs = appJs.split(`./${orig}`).join(`./${hashed}`);
  }
  nameMap['app.js'] = hashedName('app.js', hash(Buffer.from(appJs)));
  await writeFile(path.join(dist, nameMap['app.js']), appJs);
  manifest.files['app.js'] = { name: nameMap['app.js'], sha256: hash(Buffer.from(appJs)) };

  // 第三遍：index.html（重写全部资源引用）
  let html = await readFile(path.join(src, 'index.html'), 'utf8');
  for (const [orig, hashed] of Object.entries(nameMap)) {
    html = html.split(`./${orig}`).join(`./${hashed}`);
  }
  await writeFile(path.join(dist, 'index.html'), html);
  manifest.files['index.html'] = { name: 'index.html', sha256: hash(Buffer.from(html)) };

  for (const f of PLAIN_FILES) {
    await copyFile(path.join(src, f), path.join(dist, f));
    manifest.files[f] = { name: f, sha256: hash(await readFile(path.join(src, f))) };
  }

  // 引用完整性校验：index.html 的 src/href 与 app.js 的 import 都必须落在产物内
  const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]);
  const imports = [...appJs.matchAll(/from\s+'\.\/([^']+)'/g)].map((m) => m[1]);
  for (const ref of [...refs, ...imports]) {
    if (!existsSync(path.join(dist, ref))) fail(`产物缺少被引用的资源 ${ref}`);
  }

  await writeFile(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`✓ 生产构建完成：dist/（${Object.keys(nameMap).length + PLAIN_FILES.length + 2} 个文件，含内容指纹与 manifest）`);
}

await main();
