// Explicit, temporary SSH management. No Docker socket or root credential reaches the UI.
import { run, quote, domainName } from './server-setup.mjs';
export function managementGuard(domain) {
  return `set -euo pipefail
fail() { printf 'METOR_ERROR:%s\\n' "$1"; exit 1; }
[ "$(id -u)" = 0 ] || fail 'Sign in as root to manage this server.'
[ -d /opt/metor ] && [ ! -L /opt/metor ] || fail 'No supported metor installation was found.'
cd /opt/metor
[ -f .desktop-install ] && [ "$(cat .desktop-install)" = ${quote(domainName(domain))} ] || fail 'This installation does not belong to this Space domain.'
[ -f compose.yml ] && [ -f .env ] || fail 'The installation files are incomplete. Resume setup first.'
docker info >/dev/null 2>&1 || fail 'Docker is unavailable. Start or repair it on the server.'
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' metor-box)" = /opt/metor ] || fail 'The Space container belongs to another installation.'
`;
}
export async function serverStatus(conn, domain) {
  const out = await run(conn, managementGuard(domain) + `
printf 'METOR_CONTAINER:'
docker inspect -f '{{json .State}}' metor-box
printf 'METOR_IMAGE:'; docker inspect -f '{{.Config.Image}}' metor-box
printf 'METOR_LIMIT:'; docker inspect -f '{{.HostConfig.Memory}}' metor-box
printf 'METOR_RESTARTS:'; docker inspect -f '{{.RestartCount}}' metor-box
printf 'METOR_DISK:'; df -Pm /opt/metor | awk 'NR==2 {print $4}'
printf 'METOR_VERSION:'
docker compose exec -T box curl -fsS --max-time 5 http://127.0.0.1:6010/bots/api/version || true
printf '\\n'
`, 20000);
  return parseStatus(out);
}
export function parseStatus(out) {
  const field = name => new RegExp(`^METOR_${name}:(.*)$`, 'm').exec(out)?.[1];
  let state, version;
  try { state = JSON.parse(field('CONTAINER')); } catch { throw Error('The server did not return its container status.'); }
  try { version = JSON.parse(field('VERSION')); } catch {}
  const image = field('IMAGE') || '';
  return { running: state.Running === true, oomKilled: state.OOMKilled === true,
    health: ['healthy', 'unhealthy', 'starting'].includes(state.Health?.Status) ? state.Health.Status : null,
    image: image.slice(0, 200), version: version?.name === 'metor' && /^\d+\.\d+\.\d+$/.test(version.version) ? version.version : null,
    memory: Number(field('LIMIT')) || 0, restarts: Number(field('RESTARTS')) || 0, disk: Number(field('DISK')) || 0 };
}
export function canUpdate(image, version) {
  const old = /^ghcr\.io\/metor-com\/metor-box:(\d+)\.(\d+)\.(\d+)$/.exec(image);
  if (!old || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const a = old.slice(1).map(Number), b = version.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return b[i] > a[i]; }
  return false;
}
export function updateScript(domain, image, version) {
  if (!canUpdate(image, version)) throw Error('Only an upgrade from an older official release is supported. Update the desktop app first if needed.');
  return managementGuard(domain) + `
exec 9>/run/metor-desktop-install.lock
flock -n 9 || fail 'Another setup or update is running. Wait before retrying.'
[ "$(docker inspect -f '{{.Config.Image}}' metor-box)" = ${quote(image)} ] || fail 'The installed version changed. Check the server again.'
[ "$(sed -n 's/^METOR_IMAGE=//p' .env)" = ${quote(image)} ] || fail 'The saved image differs from the running release. Review the server configuration first.'
[ ! -e .env.before-update ] && [ ! -e compose.yml.before-update ] || fail 'A previous update needs review. Check .env.before-update and compose.yml.before-update on the server before retrying.'
umask 077
docker run --rm --entrypoint cat ${quote(image)} /usr/local/lib/metor/compose.yml > compose.yml.original
cmp -s compose.yml compose.yml.original || fail 'The Compose file has custom changes. Update this server manually to preserve them.'
rm compose.yml.original
printf 'METOR_PHASE:image\\n'
docker pull -q ${quote(`ghcr.io/metor-com/metor-box:${version}`)}
docker run --rm --entrypoint cat ${quote(`ghcr.io/metor-com/metor-box:${version}`)} /usr/local/lib/metor/compose.yml > compose.yml.new
[ -s compose.yml.new ] || fail 'The new image did not provide a Compose file.'
docker compose -f compose.yml.new config -q
cp -p .env .env.before-update
cp -p compose.yml compose.yml.before-update
rollback() {
  trap - ERR
  cp -p .env.before-update .env.new && mv .env.new .env &&
    cp -p compose.yml.before-update compose.yml.new && mv compose.yml.new compose.yml || fail 'Restoring the previous configuration failed. Review the saved update files on the server.'
  if docker compose up -d --no-deps box; then
    rm .env.before-update compose.yml.before-update
    fail 'The update failed. The previous image was restarted. Check the Space before retrying.'
  fi
  fail 'The update and restart of the previous image failed. Review Docker on the server; .env.before-update is retained.'
}
trap rollback ERR
{ awk '!/^METOR_IMAGE=/' .env; printf '%s\\n' ${quote(`METOR_IMAGE=ghcr.io/metor-com/metor-box:${version}`)}; } > .env.new
mv .env.new .env
mv compose.yml.new compose.yml
printf 'METOR_PHASE:start\\n'
docker compose up -d --no-deps box
printf 'METOR_PHASE:gateway\\n'
ready=no
for _ in $(seq 1 60); do
  if docker compose exec -T box node -e ${quote(`fetch('http://127.0.0.1:6010/bots/api/version',{signal:AbortSignal.timeout(5000)}).then(r=>r.json()).then(v=>process.exit(v.name==='metor'&&v.version==='${version}'?0:1)).catch(()=>process.exit(1))`)}; then ready=yes; break; fi
  sleep 2
done
[ "$ready" = yes ] || rollback
trap - ERR
rm .env.before-update compose.yml.before-update
printf 'METOR_PHASE:ready\\n'
`;
}
export async function updateServer(session, version, progress = () => {}) {
  const state = await serverStatus(session.conn, session.domain);
  progress('Downloading the release, then restarting the Space…');
  await run(session.conn, updateScript(session.domain, state.image, version), 20 * 60 * 1000);
  return serverStatus(session.conn, session.domain);
}
