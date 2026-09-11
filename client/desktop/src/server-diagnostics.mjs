// Public reachability checks only: no credentials, setup links or container logs.
import { lookup } from 'node:dns/promises';
import { connect, isIP } from 'node:net';
import { request } from 'node:https';
const normalize = address => isIP(address) === 6 ? new URL(`http://[${address}]/`).hostname : address;
export async function checkDomain(domain, expected = [], resolve = lookup) {
  let answers, timer;
  try { answers = await Promise.race([resolve(domain, { all: true }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('DNS timeout')), 5000); })]); }
  catch { return { ok: false, message: `DNS does not resolve ${domain}. Create an A or AAAA record pointing to this server and wait for it to propagate.` }; }
  finally { clearTimeout(timer); }
  const addresses = [...new Set(answers.map(a => a.address).filter(isIP))];
  if (!addresses.length) return { ok: false, message: `No A or AAAA records were found for ${domain}.` };
  const known = new Set(expected.filter(isIP).map(normalize));
  const wrong = known.size ? addresses.filter(a => !known.has(normalize(a))) : [];
  if (wrong.length) return { ok: false, addresses, message: `DNS for ${domain} points to ${wrong.join(', ')}, which was not found on this server. Correct or remove stale A/AAAA records. Proxied DNS and NAT need manual verification.` };
  return { ok: true, addresses, message: `DNS resolves ${domain}${known.size ? ' to this server' : ''}.` };
}
export function checkPort(host, port) {
  return new Promise(resolve => {
    const socket = connect({ host, port });
    const finish = ok => { socket.destroy(); resolve(ok); };
    socket.setTimeout(4000, () => finish(false)); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
  });
}
export function checkHttps(domain) {
  return new Promise(resolve => {
    let done = false;
    const finish = result => { if (!done) { done = true; clearTimeout(timer); resolve(result); } };
    const req = request(`https://${domain}/bots/api/version`, { method: 'GET' }, res => {
      let body = '';
      res.on('data', b => { body += b; if (body.length > 65536) { finish({ ok: false, kind: 'response' }); req.destroy(); } });
      res.on('error', () => finish({ ok: false, kind: 'connection' }));
      res.on('end', () => {
        let value; try { value = JSON.parse(body); } catch {}
        finish(res.statusCode === 200 && value?.name === 'metor' ? { ok: true } : { ok: false, kind: 'response', status: res.statusCode });
      });
    });
    const timer = setTimeout(() => { finish({ ok: false, kind: 'timeout' }); req.destroy(); }, 5000);
    req.on('error', error => finish({ ok: false, kind: /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code || '') ? 'certificate' : 'connection' }));
    req.end();
  });
}
export async function explainHttps(domain, expected, last, deps = {}) {
  const dns = await (deps.checkDomain || checkDomain)(domain, expected);
  if (!dns.ok) return dns.message;
  const port = deps.checkPort || checkPort;
  // Report per-address failures, including stale/broken IPv6 alongside working IPv4.
  const probes = await Promise.all(dns.addresses.map(async host => ({ host, http: await port(host, 80), https: await port(host, 443) })));
  const blocked = probes.filter(p => !p.https);
  if (blocked.length) return `HTTPS port 443 is not reachable at ${blocked.map(p => p.host).join(', ')}. Check Caddy and allow inbound TCP 443 in the provider and server firewalls. Retry after correcting the affected A/AAAA record or firewall.`;
  if (last.kind === 'certificate') return `The TLS certificate for ${domain} could not be verified. ${probes.some(p => !p.http) ? 'Port 80 is also unreachable; allow inbound TCP 80 for certificate issuance. ' : ''}Check the domain and Caddy certificate issuance, then retry. Certificate verification remains enabled.`;
  if (last.kind === 'response') return `HTTPS answers at ${domain}, but /bots/api/version does not return a metor Space${last.status ? ` (HTTP ${last.status})` : ''}. Check Caddy routing and the Space container.`;
  return `HTTPS is not ready at ${domain}. Check Caddy and the Space container, then retry. The installed data is retained.`;
}
export async function waitForHttps(domain, expected, progress = () => {}, options = {}) {
  const check = options.check || checkHttps;
  const delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let last = {};
  progress('Waiting for a valid HTTPS connection…');
  for (let i = 0; i < (options.attempts ?? 30); i++) {
    if (options.cancelled?.()) throw Error('The setup window was closed. Reconnect to finish pairing.');
    last = await check(domain); if (last.ok) return;
    if (i < (options.attempts ?? 30) - 1) await delay(2000);
  }
  throw Error(await explainHttps(domain, expected, last, options));
}
