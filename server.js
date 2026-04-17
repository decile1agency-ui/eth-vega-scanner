import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Proxy Binance APIs to avoid CORS
const PROXIES = {
  '/api/binance/options': 'https://eapi.binance.com/eapi/v1',
  '/api/binance/spot': 'https://api.binance.com/api/v3',
};

// Generic proxy handler
app.use('/api/binance', async (req, res) => {
  let targetUrl;
  if (req.path.startsWith('/binance/options/')) {
    const endpoint = req.path.replace('/binance/options/', '');
    targetUrl = `https://eapi.binance.com/eapi/v1/${endpoint}`;
  } else if (req.path.startsWith('/binance/spot/')) {
    const endpoint = req.path.replace('/binance/spot/', '');
    targetUrl = `https://api.binance.com/api/v3/${endpoint}`;
  } else {
    return res.status(404).json({ error: 'Unknown proxy route' });
  }

  // Forward query params
  const qs = new URLSearchParams(req.query).toString();
  if (qs) targetUrl += `?${qs}`;

  try {
    const response = await fetch(targetUrl, {
      headers: { 'User-Agent': 'VegaScan/0.2' },
    });
    const data = await response.text();
    res.set('Content-Type', response.headers.get('content-type') || 'application/json');
    res.status(response.status).send(data);
  } catch (err) {
    console.error(`Proxy error [${targetUrl}]:`, err.message);
    res.status(502).json({ error: 'Upstream fetch failed', detail: err.message });
  }
});

// Serve static Vite build
app.use(express.static(join(__dirname, 'dist')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VegaScan server listening on port ${PORT}`);
});
