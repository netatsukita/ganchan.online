/**
 * ガンちゃん — 自動クリーンアップ Cron Job
 *
 * 毎日 AM 3:00（JST）に実行され、
 * 365日間更新されていないガントチャートデータを自動削除します。
 *
 * Vercel Cron Job から呼び出されます（vercel.json に設定）。
 * CRON_SECRET 環境変数で不正アクセスを防止します。
 */

import { list, del } from '@vercel/blob';

const RETENTION_DAYS = 365;

export default async function handler(req, res) {
  // ── Vercel Cron からの呼び出しのみ許可 ──────────────────────
  const auth = req.headers['authorization'] ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  let deleted = 0;
  let skipped = 0;
  let cursor;

  try {
    do {
      const result = await list({
        prefix: 'gantt/',
        limit:  100,
        cursor,
        token:  process.env.BLOB_READ_WRITE_TOKEN,
      });

      for (const blob of result.blobs) {
        const lastModified = new Date(blob.uploadedAt);
        if (lastModified < cutoff) {
          await del(blob.url, { token: process.env.BLOB_READ_WRITE_TOKEN });
          console.log(`[cleanup] 削除: ${blob.pathname} (最終更新: ${lastModified.toISOString()})`);
          deleted++;
        } else {
          skipped++;
        }
      }

      cursor = result.cursor;
    } while (cursor);

    console.log(`[cleanup] 完了 — 削除: ${deleted}件 / 保持: ${skipped}件 / 基準日: ${cutoff.toISOString()}`);
    return res.status(200).json({
      ok: true,
      deleted,
      skipped,
      cutoff: cutoff.toISOString(),
    });
  } catch (err) {
    console.error('[cleanup] エラー:', err);
    return res.status(500).json({ error: err.message });
  }
}
