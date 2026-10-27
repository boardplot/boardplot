import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const block = text => `\`\`\`text\n${text.trimEnd()}\n\`\`\`\n`;

// Use only inputs that contribute bytes. An imported but removed dependency
// does not ship; an external dependency carries its own package notices.
export function bundledPackageNotices(root, metafile) {
  if (!metafile) throw new Error('third-party notices: build metadata is missing');
  const directories = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, contribution] of Object.entries(output.inputs)) {
      if (contribution.bytesInOutput === 0) continue;
      const path = input.replaceAll('\\', '/');
      const marker = 'node_modules/';
      const index = path.lastIndexOf(marker);
      if (index < 0 || (index > 0 && path[index - 1] !== '/')) continue;
      const name = path.slice(index + marker.length).match(/^(?:@[^/]+\/)?[^/]+/)[0];
      directories.add(resolve(root, path.slice(0, index + marker.length) + name));
    }
  }
  return [...directories].map(directory => packageNotice(root, directory)).sort().join('\n');
}

function packageNotice(root, directory) {
  const metadata = readJson(join(directory, 'package.json'));
  const { name, version, license } = metadata;
  const files = readdirSync(directory).filter(file =>
    /^(licen[cs]e|copying|notice|copyright(?:notice)?)(?:[-.][^.]+)?$/i.test(file)).sort();
  const fallback = join(root, 'scripts/third-party', `${name.replaceAll('/', '-')}-${version}.md`);
  if (!files.some(file => /^(licen[cs]e|copying)(?:[-.]|$)/i.test(file)) && !existsSync(fallback)) {
    throw new Error(`third-party notices: ${name}@${version} has no licence text; add its exact-version source`);
  }
  let body = `## ${name} ${version} (${license ?? 'see licence text'})\n\n`;
  body += `Package source: https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz\n\n`;
  for (const file of files) {
    body += `Installed package file: \`${name}/${file}\`.\n\n${block(readFileSync(join(directory, file), 'utf8'))}\n`;
  }
  if (existsSync(fallback)) body += readFileSync(fallback, 'utf8').trimEnd() + '\n';
  return body;
}

// The width tables were measured from these exact font versions, so their
// licence texts are frozen here and do not follow later package updates.
export function fontNotices(root) {
  return `## Font width tables\n\nThese notices cover the source fonts used to measure the bundled width tables.\nNo font file is included in the package.\n\n` +
    ['geist-5.3.0.md', 'liberation-sans-2.1.5.md', 'stixgeneral-1.1.0.md'].map(file =>
      readFileSync(join(root, 'scripts/third-party', file), 'utf8').trimEnd() + '\n').join('\n');
}

export function thirdPartyNoticesPlugin(root) {
  return {
    name: 'third-party-notices',
    setup(build) {
      build.initialOptions.metafile = true;
      build.onEnd(result => {
        if (result.errors.length) return;
        const software = bundledPackageNotices(root, result.metafile);
        const body = '# Third-party notices\n\n' +
          'Generated from the build metadata and the installed package versions.\n' +
          'The software sections cover third-party code compiled into the JavaScript.\n' +
          'External npm dependencies carry their own notices. See NOTICE.md for data notices.\n\n' +
          software + '\n' + fontNotices(root);
        writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), body);
      });
    },
  };
}
