/**
 * Sign a build through AMO's unlisted channel, so it installs permanently.
 *
 * Why this exists: an unsigned add-on can only be loaded temporarily, and it disappears when
 * Firefox closes. `xpinstall.signatures.required=false` is the answer the internet gives and it
 * does not work -- Release and Beta builds ignore that pref deliberately. So the only way to a
 * permanent install in an ordinary Firefox is a signature, and AMO's *unlisted* channel signs
 * automatically in a couple of minutes without waiting for a human review.
 *
 * The listed submission is untouched by this. An add-on can carry versions in both channels;
 * this just gets a usable, permanent build into your own browser while the store listing works
 * its way through review.
 *
 * ## What you need first
 *
 * Credentials of your own, from https://addons.mozilla.org/en-US/developers/addon/api/key/
 * Put them in `C:\Projects\.env` -- the same file the GitHub token lives in, which is already
 * gitignored:
 *
 *     AMO_JWT_ISSUER=user:12345678:123
 *     AMO_JWT_SECRET=...
 *
 * They are read from that file at run time and never printed, never passed on a command line
 * where they would land in shell history, and never written anywhere else.
 *
 * ## Running it
 *
 *     node tools/sign.mjs
 *
 * It bumps nothing. Set the version yourself first -- AMO rejects a version number it has
 * already seen in either channel, so this cannot reuse the one the listed submission is using.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENV_FILE = 'C:/Projects/.env';

/** Read one key out of the env file without echoing anything from it. */
function secret(name) {
  if (!existsSync(ENV_FILE)) {
    throw new Error(`${ENV_FILE} does not exist. See the comment at the top of this file.`);
  }
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at > 0 && line.slice(0, at).trim() === name) {
      const value = line.slice(at + 1).trim();
      if (value) return value;
    }
  }
  throw new Error(
    `${name} is not set in ${ENV_FILE}.\n` +
      'Create an API key at https://addons.mozilla.org/en-US/developers/addon/api/key/ and add:\n' +
      `  ${name}=...`,
  );
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;

if (!existsSync(join('dist', 'manifest.json'))) {
  throw new Error('dist/ is missing. Run: node --experimental-strip-types build.ts');
}
const built = JSON.parse(readFileSync(join('dist', 'manifest.json'), 'utf8')).version;
if (built !== version) {
  throw new Error(
    `dist/ holds ${built} but package.json says ${version}. Rebuild before signing, or the ` +
      'signed file will not be the version you think it is.',
  );
}

console.log(`\nsigning ${pkg.name} ${version} through the unlisted channel`);
console.log('this takes a couple of minutes; AMO signs unlisted builds without a human review\n');

const issuer = secret('AMO_JWT_ISSUER');
const secretKey = secret('AMO_JWT_SECRET');

try {
  execFileSync(
    'node',
    [
      join('node_modules', 'web-ext', 'bin', 'web-ext.js'),
      'sign',
      '--source-dir',
      'dist',
      '--artifacts-dir',
      'web-ext-artifacts',
      '--channel',
      'unlisted',
      '--no-config-discovery',
    ],
    {
      stdio: 'inherit',
      // Passed as environment rather than as arguments, so neither value can appear in a
      // process listing or in shell history.
      env: {
        ...process.env,
        WEB_EXT_API_KEY: issuer,
        WEB_EXT_API_SECRET: secretKey,
      },
    },
  );
} catch {
  console.error(
    '\nSigning failed. The two usual reasons:\n' +
      `  - AMO has already seen version ${version}. Bump it, rebuild, run this again.\n` +
      '  - The API key is wrong or expired. Make a fresh one at the URL above.\n' +
      'Anything else: the output above is from web-ext and says what AMO objected to.\n',
  );
  process.exit(1);
}

console.log(
  '\nDone. The signed .xpi is in web-ext-artifacts/.\n' +
    'To install it permanently: open about:addons, click the gear, "Install Add-on From File",\n' +
    'and pick that .xpi. It survives closing Firefox, and it updates itself from AMO.\n',
);
