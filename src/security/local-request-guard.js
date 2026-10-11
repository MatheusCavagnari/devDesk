const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createLocalRequestGuard({ port }) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  return function localRequestGuard(req, res, next) {
    const host = String(req.headers.host || '').toLowerCase();
    if (!allowedHosts.has(host)) {
      return res.status(403).json({ error: 'Host não permitido para o serviço local.' });
    }

    const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
    if (fetchSite === 'cross-site') {
      return res.status(403).json({ error: 'Requisição de outro site bloqueada.' });
    }

    if (MUTATING_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(String(origin).replace(/\/$/, '').toLowerCase())) {
        return res.status(403).json({ error: 'Origem não permitida para alteração de dados.' });
      }
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      const hasBody = Number(req.headers['content-length'] || 0) > 0 || Boolean(req.headers['transfer-encoding']);
      if (req.path.startsWith('/api/') && hasBody && !contentType.startsWith('application/json')) {
        return res.status(415).json({ error: 'As alterações da API exigem Content-Type application/json.' });
      }
    }
    next();
  };
}
