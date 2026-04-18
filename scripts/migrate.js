/**
 * データ移行スクリプト（heteml → Vercel Blob）
 * 実行: node scripts/migrate.js
 */

import { put } from '@vercel/blob';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: '.env.local' });

const { BLOB_READ_WRITE_TOKEN } = process.env;
if (!BLOB_READ_WRITE_TOKEN) {
  console.error('❌ BLOB_READ_WRITE_TOKEN が未設定です。vercel env pull .env.local を実行してください。');
  process.exit(1);
}

const dataDir = join(process.cwd(), 'data');
if (!existsSync(dataDir)) {
  console.error('❌ data/ ディレクトリが見つかりません。');
  process.exit(1);
}

const files = readdirSync(dataDir).filter(f => f.endsWith('.json') && f.startsWith('gantt_'));

if (files.length === 0) {
  console.log('ℹ️  移行対象のJSONファイルが見つかりませんでした。');
  process.exit(0);
}

console.log(`📦 移行対象: ${files.length} ファイル\n`);

for (const file of files) {
  const filePath = join(dataDir, file);
  let blobPath;

  if (file === 'gantt_data.json') {
    blobPath = 'gantt/default.json';
  } else {
    const match = file.match(/^gantt_(.+)\.json$/);
    if (!match) { console.log(`⏭  スキップ: ${file}`); continue; }
    blobPath = `gantt/${match[1]}.json`;
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    JSON.parse(content); // JSON検証
    await put(blobPath, content, {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      token: BLOB_READ_WRITE_TOKEN,
    });
    console.log(`✅ ${file} → ${blobPath}`);
  } catch (err) {
    console.error(`❌ ${file}: ${err.message}`);
  }
}

console.log('\n🎉 移行完了！');
