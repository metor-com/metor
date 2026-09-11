// Validate coordinated release metadata and the section used by the release workflow.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const text = file => readFileSync(file, 'utf8');
const version = text('VERSION').trim();
assert.match(version, /^\d+\.\d+\.\d+$/);
for (const project of ['client/desktop', 'client/mobile']) {
  assert.equal(JSON.parse(text(`${project}/package.json`)).version, version, project);
  const lock = JSON.parse(text(`${project}/package-lock.json`));
  assert.equal(lock.version, version); assert.equal(lock.packages[''].version, version);
}
assert.equal(JSON.parse(text('backend/relay/package.json')).version, version);
assert.ok(text('client/mobile/android/app/build.gradle').includes(`versionName "${version}"`));
const ios = [...text('client/mobile/ios/App/App.xcodeproj/project.pbxproj').matchAll(/MARKETING_VERSION = ([^;]+);/g)];
assert.ok(ios.length); for (const [, value] of ios) assert.equal(value, version);
const changelog = text('CHANGELOG.md');
assert.equal([...changelog.matchAll(/^## (?:\[)?Unreleased(?:\])?$/gm)].length, 1);
const heading = `## [${version}] - `;
assert.equal(changelog.split(heading).length, 2);
const notes = changelog.split(heading)[1].split('\n').slice(1).join('\n').split(/^## /m)[0].trim();
assert.ok(notes.length > 100, 'Release notes must not be empty');
const tag = process.env.GITHUB_REF_NAME ?? '';
if (/^(?:desktop-)?v\d/.test(tag)) assert.equal(tag.replace(/^(?:desktop-)?v/, ''), version, 'Tag and VERSION must match');
if (process.argv.includes('--notes')) process.stdout.write(notes + '\n');
else console.log(`Release metadata and notes verified: ${version}`);
