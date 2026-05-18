#!/usr/bin/env node
/**
 * 生成符合 Y-Nav 脚本库的 PBKDF2-SHA256 密码哈希。
 *
 * 用法：
 *   node scripts/hash-password.mjs            # 交互输入
 *   echo 'pwd' | node scripts/hash-password.mjs
 *
 * 输出格式： pbkdf2$<iter>$<saltB64>$<hashB64>
 * 把它写进 wrangler secret:
 *   wrangler secret put SNIPPETS_PASSWORD_HASH
 */
import { webcrypto as crypto } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const ITER = 200_000; // 单次 ~50ms on M-class hardware
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function toB64(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/=+$/, '');
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    key,
    HASH_BYTES * 8,
  );
  return `pbkdf2$${ITER}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
}

async function main() {
  let password = '';
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    password = await rl.question('Password: ');
    rl.close();
  } else {
    password = await new Promise((resolve) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => (data += chunk));
      process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
    });
  }
  if (!password) {
    process.stderr.write('密码不能为空\n');
    process.exit(1);
  }
  const hash = await hashPassword(password);
  process.stdout.write(hash + '\n');
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + '\n');
  process.exit(1);
});
