/**
 * データ移行スクリプト
 *
 * heteml 上の data/*.json を Vercel KV へアップロードします。
 *
 * ■ 使い方
 *   1. heteml から data/ フォルダをローカルへダウンロード
 *   2. .env.local に KV の接続情報を設定（vercel env pull .env.local）
 *   3. node scripts/migrate.js
 *
 * ■ 必要な環境変数（.env.local または shell に設定）
 *   KV_REST_API_URL
 *   KV_REST_API_TOKEN
 */

import { createClient } from '@vercel/kv';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { config } from 'dotenv';

// .env.local を読み込む
config({ path: '.env.local' });

const { KV_REST_API_URL, KV_REST_API_TOKEN } = process.env;
if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
  console.error('❌ 環境変数 KV_REST_API_URL / KV_REST_API_TOKEN が未設定です。');
  console.error('   vercel env pull .env.local を実行してから再試行してください。');
  process.exit(1);
}

const kv = createClient({ url: KV_REST_API_URL, token: KV_REST_API_TOKEN });

const dataDir = join(process.cwd(), 'data');
if (!existsSync(dataDir)) {
  console.error('❌ data/ ディレクトリが見つかりません。');
  process.exit(1);
}

const files = readdirSync(dataDir).filter(f => f.endsWith('.json') && !f.startsWith('.'));

if (files.length === 0) {
  console.log('ℹ️  移行対象の JSON ファイルが見つかりませんでした。');
  process.exit(0);
}

console.log(`📦 移行対象: ${files.length} ファイル\n`);

for (const file of files) {
  const filePath = join(dataDir, file);
  let kvKey;

  if (file === 'gantt_data.json') {
    kvKey = 'gantt:default';
  } else {
    // gantt_{projectId}.json → gantt:{projectId}
    const match = file.match(/^gantt_(.+)\.json$/);
    if (!match) {
      console.log(`⏭  スキップ: ${file}（命名規則外）`);
      continue;
    }
    kvKey = `gantt:${match[1]}`;
  }

  try {
    const raw  = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    await kv.set(kvKey, data);
    console.log(`✅ ${file} → ${kvKey}`);
  } catch (err) {
    console.error(`❌ ${file}: ${err.message}`);
  }
}

console.log('\n🎉 移行完了！');
