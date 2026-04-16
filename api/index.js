/**
 * ガンちゃん v2.15 — Backend API（Vercel Serverless Function + Vercel Blob）
 */

import { put, list } from '@vercel/blob';

const APP_VER = 'v2.15';
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5MB

export default async function handler(req, res) {
  // ── セキュリティHTTPヘッダー ──────────────────────────────────
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  // ── CSRF: Originチェック（POST のみ） ─────────────────────────
  if (req.method === 'POST') {
    const origin  = req.headers['origin']  ?? '';
    const referer = req.headers['referer'] ?? '';
    const host    = req.headers['host']    ?? '';
    const originOk  = origin  === '' || origin.includes(host);
    const refererOk = referer === '' || referer.includes(host);
    if (!originOk && !refererOk) {
      return res.status(403).json({ error: 'Forbidden: Invalid origin' });
    }
  }

  // ── プロジェクトID → Blobパス ──────────────────────────────────
  const p = (req.query.p ?? '').replace(/[^a-zA-Z0-9_\-]/g, '');
  const blobPath = `gantt/${p !== '' ? p : 'default'}.json`;

  // ── アクション（ホワイトリスト） ───────────────────────────────
  const action = (req.query.action ?? '').trim();
  if (!['load', 'save'].includes(action)) {
    return res.status(400).json({ error: '不明なアクション' });
  }

  try {
    // ════════════════════════════════════════════════════════════
    //  LOAD
    // ════════════════════════════════════════════════════════════
    if (action === 'load') {
      const { blobs } = await list({
        prefix: blobPath,
        limit: 1,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      const blob = blobs.find(b => b.pathname === blobPath);

      if (blob) {
        // privateブロブは downloadUrl（署名付きURL）で取得
        const resp = await fetch(blob.downloadUrl);
        if (!resp.ok) throw new Error(`Blob fetch failed: ${resp.status}`);
        const data = await resp.json();
        return res.status(200).json(data);
      }

      // 新規プロジェクトの初期値
      const today   = todayStr();
      const endDate = offsetDate(today, 90);
      return res.status(200).json({
        project:        { name: '新規プロジェクト', start_date: today, end_date: endDate },
        tasks:          [],
        lightning_date: today,
        sl:             false,
        coColors:       {},
      });
    }

    // ════════════════════════════════════════════════════════════
    //  SAVE
    // ════════════════════════════════════════════════════════════
    if (action === 'save') {
      const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
      if (contentLength > MAX_PAYLOAD_BYTES) {
        return res.status(413).json({ error: 'データサイズが大きすぎます（上限5MB）' });
      }

      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: '不正なJSONデータ' });
      }

      // ── 入力バリデーション ────────────────────────────────────
      const pjName    = sanitizeStr(body?.project?.name        ?? '', 200);
      const startDate = validateDate(body?.project?.start_date ?? '');
      const endDate   = validateDate(body?.project?.end_date   ?? '');
      const ld        = validateDate(body?.lightning_date      ?? '');

      const rawTasks = body.tasks ?? [];
      if (!Array.isArray(rawTasks)) return res.status(400).json({ error: 'tasksが不正' });
      if (rawTasks.length > 500)   return res.status(400).json({ error: 'タスク数が上限（500件）を超えています' });

      const cleanTasks = rawTasks
        .filter(t => t && typeof t === 'object')
        .map(t => {
          const rawParentId = t.parentId ?? null;
          return {
            id:            (String(t.id ?? '')).replace(/[^a-z0-9_\-]/gi, ''),
            name:          sanitizeStr(t.name      ?? '', 200),
            company:       sanitizeStr(t.company   ?? '', 100),
            assignee:      sanitizeStr(t.assignee  ?? '', 100),
            planned_start: validateDate(t.planned_start ?? ''),
            planned_end:   validateDate(t.planned_end   ?? ''),
            progress:      Math.max(0, Math.min(100, parseInt(t.progress ?? 0, 10))),
            color:         /^#[0-9a-fA-F]{6}$/.test(t.color ?? '') ? t.color : '#005bc4',
            memo:          sanitizeStr(t.memo ?? '', 500),
            parentId:      (typeof rawParentId === 'string' && /^[a-z0-9_\-]+$/i.test(rawParentId))
                             ? rawParentId.slice(0, 64) : null,
            _collapsed:    !!t._collapsed,
          };
        })
        .filter(t => t.id !== '');

      // coColors 検証
      const coColors = {};
      if (body.coColors && typeof body.coColors === 'object' && !Array.isArray(body.coColors)) {
        for (const [k, v] of Object.entries(body.coColors)) {
          const ck = sanitizeStr(String(k), 100);
          if (ck && /^#[0-9a-fA-F]{6}$/.test(String(v))) {
            coColors[ck] = String(v);
          }
        }
      }

      const cleanData = {
        project:        { name: pjName, start_date: startDate, end_date: endDate },
        tasks:          cleanTasks,
        lightning_date: ld,
        sl:             !!body.sl,
        coColors,
        _savedAt:       new Date().toISOString(),
        _version:       APP_VER,
      };

      // addRandomSuffix: false → 毎回同じパスに上書き保存
      await put(blobPath, JSON.stringify(cleanData), {
        access:          'private',
        contentType:     'application/json',
        addRandomSuffix: false,
        allowOverwrite:  true,
        token:           process.env.BLOB_READ_WRITE_TOKEN,
      });

      const ts = jstNow();
      return res.status(200).json({ success: true, timestamp: ts, taskCount: cleanTasks.length });
    }
  } catch (err) {
    console.error('[ガンちゃん API Error]', err);
    return res.status(500).json({ error: 'サーバーエラーが発生しました', detail: err.message });
  }
}

// ── ヘルパー ──────────────────────────────────────────────────────

function sanitizeStr(s, maxLen) {
  return String(s).replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

function validateDate(d) {
  return /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(String(d)) ? d : '';
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function offsetDate(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function jstNow() {
  return new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}
