import { writeFile } from 'node:fs/promises';
export async function saveBotPackage(name, bytes, choose) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > 40 * 1024 * 1024 || bytes.byteLength < 4) throw Error('Invalid bot package.');
  const data = Buffer.from(bytes);
  if (data.readUInt32LE(0) !== 0x04034b50) throw Error('Invalid ZIP package.');
  const filename = typeof name === 'string' && /^[a-z0-9-]+\.metor-bot\.zip$/.test(name) ? name : 'bot.metor-bot.zip';
  const choice = await choose({ title: 'Export Bot', defaultPath: filename, filters: [{ name: 'Bot package', extensions: ['zip'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
  if (choice.canceled || !choice.filePath) return false;
  await writeFile(choice.filePath, data, { mode: 0o600 });
  return true;
}
