// SSH remains in the main process. No passwords, host keys or setup tokens are persisted.
import ssh2 from 'ssh2';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
const { Client } = ssh2;
export const fingerprint = key => `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
export const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const hostname = s => typeof s === 'string' && s.length <= 253 && s.split('.').every(p => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(p));
export function target(input) {
  const host = String(input?.host ?? '').trim();
  const port = Number(input?.port ?? 22);
  if ((!isIP(host) && !hostname(host)) || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('Enter a valid server hostname or IP address and SSH port.');
  return { host, port };
}
export function domainName(value) {
  const domain = String(value ?? '').trim().toLowerCase();
  if (!hostname(domain) || !domain.includes('.') || isIP(domain)) throw Error('Enter a domain that points to this server, without https:// or a path.');
  return domain;
}
const preflight = readFileSync(new URL('./server-preflight.sh', import.meta.url), 'utf8');
export function parseServer(out) {
  const line = /^METOR_SERVER:([^\n]+)$/m.exec(out)?.[1];
  if (!line) throw Error('The server check did not return a result.');
  const [os, ...values] = line.split('|');
  const [cpus, ram, disk, memory] = values.map(Number);
  if (values.length !== 4 || ![cpus, ram, disk, memory].every(n => Number.isFinite(n) && n > 0)) throw Error('Invalid server resource report.');
  return { os, cpus, ram, disk, memory };
}
export function run(conn, script, timeout = 120000, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    let output = '', finished = false;
    const finish = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); conn.removeListener('close', closed); error ? reject(error) : resolve(value); };
    const closed = () => finish(Error('The SSH connection was interrupted. Reconnect to retry.'));
    conn.once('close', closed);
    const timer = setTimeout(() => { conn.destroy(); finish(Error('The server operation timed out. Reconnect to retry; existing data is kept.')); }, timeout);
    conn.exec('bash -s', (error, stream) => {
      if (error) return finish(Error('Could not start a command on the server.'));
      const append = b => { output = (output + b.toString()).slice(-2 * 1024 * 1024); onOutput(output); };
      stream.on('data', append); stream.stderr.on('data', append);
      stream.on('error', () => finish(Error('The SSH connection was interrupted. Reconnect to retry.')));
      stream.on('close', code => {
        if (code !== 0) {
          const message = /^METOR_ERROR:([^\n]{1,300})$/m.exec(output)?.[1];
          finish(Error(message || 'The server command failed. Check Docker, network access and available disk space, then retry.'));
        } else finish(null, output);
      });
      stream.end(script);
    });
  });
}
export function probe(input) {
  const address = target(input);
  return new Promise((resolve, reject) => {
    const conn = new Client(); let found = false;
    conn.on('error', () => { if (!found) reject(Error('Cannot reach SSH on this server. Check the address, port and firewall.')); });
    conn.connect({ ...address, username: 'root', readyTimeout: 15000,
      algorithms: { serverHostKey: ['ssh-ed25519'] },
      hostVerifier(key) { found = true; resolve({ ...address, fingerprint: fingerprint(key) }); return false; },
    });
  });
}
export function signInError(error, mismatch = false) {
  if (mismatch) return 'The server identity changed. Verify its fingerprint again before signing in.';
  if (error?.level === 'client-authentication') return 'The server rejected root password login. Check the password and whether SSH password login is enabled. A provider-console login can work even when SSH password login is disabled.';
  if (error?.level === 'client-dns' || error?.code === 'ENOTFOUND') return 'The server address could not be resolved. Check its hostname or use its IP address.';
  if (error?.code === 'ECONNREFUSED') return 'The server refused the SSH connection. Check the SSH port and whether the SSH service is running.';
  if (error?.level === 'client-timeout' || error?.code === 'ETIMEDOUT') return 'The SSH connection timed out. Check the server address, SSH port and provider firewall, then retry.';
  return 'The SSH connection failed before sign-in completed. Check the server connection and retry.';
}
export async function inspect(input) {
  const address = target(input), domain = domainName(input.domain);
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(input.fingerprint ?? '')) throw Error('Verify the server fingerprint first.');
  if (typeof input.password !== 'string' || !input.password || input.password.length > 4096) throw Error('Enter the root password.');
  const conn = new Client(); let mismatch = false;
  try {
    await new Promise((resolve, reject) => {
      conn.on('error', error => reject(Error(signInError(error, mismatch))));
      conn.once('change password', () => reject(Error('The server requires a new root password. Change it in the provider console with passwd, then retry with the new password.')));
      conn.once('ready', resolve);
      conn.connect({ ...address, username: 'root', password: input.password, readyTimeout: 20000,
        keepaliveInterval: 15000, keepaliveCountMax: 3,
        algorithms: { serverHostKey: ['ssh-ed25519'] },
        hostVerifier(key) { mismatch = fingerprint(key) !== input.fingerprint; return !mismatch; },
      });
    });
    // SSH2 only needs the credential for authentication; the connected session is retained briefly.
    if (conn.config) conn.config.password = undefined;
    input.password = '';
    const prefix = `export METOR_DOMAIN=${quote(domain)}\n`;
    const info = parseServer(await run(conn, prefix + preflight));
    return { conn, domain, info };
  } catch (error) { conn.end(); throw error; }
  finally { input.password = ''; }
}
export async function install(session, installer, version, progress = () => {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('This app has no valid release version.');
  const { conn, domain, info } = session;
  progress('Installing Docker and metor. The image download can take several minutes…');
  const script = `export METOR_DOMAIN=${quote(domain)} METOR_MEMORY=${quote(`${info.memory}M`)} METOR_IMAGE=${quote(`ghcr.io/metor-com/metor-box:${version}`)} METOR_APP_INSTALL=yes\n` +
    'exec 9>/run/metor-desktop-install.lock\nflock -n 9 || { echo "METOR_ERROR:Another metor installation is running. Wait before retrying."; exit 1; }\n' +
    preflight + '\n[ "${memory}M" = "$METOR_MEMORY" ] || { echo "METOR_ERROR:Server RAM changed. Check the server again before installing."; exit 1; }\nmkdir -p /opt/metor\numask 077\nprintf "%s" "$METOR_DOMAIN" > /opt/metor/.desktop-install\n' + installer;
  let phase = 0;
  const out = await run(conn, script, 20 * 60 * 1000, output => {
    const markers = ['Pulling ghcr.io/', 'Writing /opt/metor', 'Starting metor', 'Waiting for the gateway'];
    const messages = ['Downloading the metor image…', 'Setting up persistent storage and HTTPS…', 'Starting your Space…', 'Waiting for your Space to become ready…'];
    for (let i = phase; i < markers.length; i++) if (output.includes(markers[i])) { phase = i + 1; progress(messages[i]); }
  });
  const link = /https:\/\/[^\s]+\/bots\/auth\/claim\?token=[\w-]+/.exec(out)?.[0];
  if (!link || new URL(link).origin !== `https://${domain}`) throw Error('The installer did not return a setup link for this domain. Reconnect to retry.');
  progress('Waiting for HTTPS. Check that the domain points to this server and ports 80 and 443 are open…');
  return link;
}
