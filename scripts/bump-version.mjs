import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../package.json', import.meta.url);
const source = readFileSync(path, 'utf8');
const pkg = JSON.parse(source);
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
if (!match) throw new Error(`Cannot bump version "${pkg.version}"`);

const next = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
const pattern = new RegExp(`"version"\\s*:\\s*"${pkg.version}"`);
if (!pattern.test(source)) throw new Error(`Could not find version "${pkg.version}"`);
writeFileSync(path, source.replace(pattern, `"version": "${next}"`));

const splashPath = new URL('../src/platforms/pwa/index.html', import.meta.url);
const splash = readFileSync(splashPath, 'utf8');
const marker = /(<p id="lg-version">)v[\d.]+(<\/p>)/;
if (!marker.test(splash)) throw new Error('Could not find the loading-screen version');
writeFileSync(splashPath, splash.replace(marker, `$1v${next}$2`));
console.log(next);
