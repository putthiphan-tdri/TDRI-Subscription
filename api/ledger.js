import { put, del, get } from '@vercel/blob';

const BLOB_PATHNAME = 'ledger-data.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const result = await get(BLOB_PATHNAME, { access: 'private' });
      if (!result || result.statusCode !== 200) {
        return res.status(404).json(null);
      }
      const text = await new Response(result.stream).text();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(text);
    } catch (err) {
      if (err.name === 'BlobNotFoundError') return res.status(404).json(null);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'PUT') {
    try {
      const body =
        typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      // Delete old blob first to avoid accumulating versions
      try { await del(BLOB_PATHNAME); } catch {}
      await put(BLOB_PATHNAME, body, {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
      });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
