import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'assets', 'legal');
const NOTICE_PATH = path.join(OUTPUT_DIR, 'THIRD_PARTY_NOTICES.txt');
const BUNDLED_NOTICE_PATH = path.join(OUTPUT_DIR, 'third-party-notices.json');
const SBOM_PATH = path.join(OUTPUT_DIR, 'cyclonedx-sbom.json');
const CHECK_ONLY = process.argv.includes('--check');
const MAX_BUFFER = 20 * 1024 * 1024;
const compareLexically = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0;

function runNpmLs() {
  const args = [
    'ls',
    '--omit=dev',
    '--all',
    '--json',
    '--long',
    '--package-lock-only',
    '--loglevel=silent',
  ];
  const command = process.platform === 'win32' ? process.env.ComSpec : 'npm';
  const commandArgs =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', ['npm.cmd', ...args].join(' ')]
      : args;
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });

  if (result.error || !result.stdout?.trim()) {
    throw new Error(result.error?.message || result.stderr || 'npm ls returned no JSON');
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`npm ls returned invalid JSON: ${error.message}`);
  }
}

function collectInstalledComponents(tree) {
  const components = new Map();

  const walk = (node) => {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      if (child?.version && child.path && child.extraneous !== true) {
        const key = `${name}@${child.version}`;
        if (!components.has(key)) {
          components.set(key, {
            key,
            name,
            version: child.version,
            packagePath: child.path,
            treeLicense: child.license,
            os: child.os,
            cpu: child.cpu,
            resolved: child.resolved,
          });
        }
      }
      walk(child ?? {});
    }
  };
  walk(tree);

  return [...components.values()].sort((a, b) => compareLexically(a.key, b.key));
}

function declaredLicense(pkg, fallback) {
  const value = pkg.license ?? pkg.licenses ?? fallback;
  const values = (Array.isArray(value) ? value : [value])
    .map((item) => (typeof item === 'string' ? item : item?.type))
    .filter(Boolean)
    .map((item) => item.trim());
  const unique = [...new Set(values)];
  if (
    unique.length === 0 ||
    unique.some((item) => /^(?:unknown|unlicensed)$/i.test(item))
  ) {
    return null;
  }
  return unique.join(' OR ');
}

function normalizeHttpsSource(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) return null;
  let value = rawValue.trim().replace(/^git\+/, '');
  const scpStyle = value.match(/^git@([^:]+):(.+)$/);
  if (scpStyle) value = `https://${scpStyle[1]}/${scpStyle[2]}`;
  if (/^[\w.-]+\/[\w./-]+(?:\.git)?$/.test(value)) {
    value = `https://github.com/${value}`;
  }

  try {
    const parsed = new URL(value);
    if (['git:', 'http:', 'ssh:'].includes(parsed.protocol)) {
      parsed.protocol = 'https:';
    }
    if (parsed.protocol !== 'https:') return null;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function sourceReference(pkg) {
  const repository =
    typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const repositoryUrl = normalizeHttpsSource(repository);
  if (repositoryUrl) return { type: 'vcs', url: repositoryUrl };
  const homepageUrl = normalizeHttpsSource(pkg.homepage);
  return homepageUrl ? { type: 'website', url: homepageUrl } : null;
}

function platformPackageSource(component) {
  const distributionUrl = normalizeHttpsSource(component.resolved);
  if (distributionUrl) return { type: 'distribution', url: distributionUrl };
  return {
    type: 'website',
    url: `https://www.npmjs.com/package/${encodeURIComponent(component.name)}`,
  };
}

function readLicenseMaterials(packagePath) {
  const names = fs
    .readdirSync(packagePath, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort(compareLexically);

  return names.map((name) => ({
    name,
    text: fs
      .readFileSync(path.join(packagePath, name), 'utf8')
      .replace(/\r\n?/g, '\n')
      .trim(),
  }));
}

function packageUrl(name, version) {
  const encodedName = name.startsWith('@')
    ? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function cyclonedxLicense(license) {
  if (/\s(?:AND|OR|WITH)\s|[()]/.test(license)) {
    return { expression: license };
  }
  if (/^SEE LICENSE IN /i.test(license)) {
    return { license: { name: license } };
  }
  return { license: { id: license } };
}

function buildOutputs() {
  const tree = runNpmLs();
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;
  const components = collectInstalledComponents(tree);
  if (components.length < 100) {
    throw new Error(`Production dependency tree is unexpectedly small (${components.length}).`);
  }
  if (components.some((component) => component.name === '@openim/rn-client-sdk')) {
    throw new Error('@openim/rn-client-sdk must not be present in a distributable build.');
  }

  const missing = [];
  const records = components.map((component) => {
    const platformSpecific =
      (Array.isArray(component.os) && component.os.length > 0) ||
      (Array.isArray(component.cpu) && component.cpu.length > 0);
    if (platformSpecific) {
      const license = declaredLicense({}, component.treeLicense);
      if (!license) {
        missing.push(`${component.key}: license metadata missing`);
        return null;
      }
      return {
        ...component,
        license,
        materials: [],
        source: platformPackageSource(component),
        purl: packageUrl(component.name, component.version),
      };
    }
    const packageJsonPath = path.join(component.packagePath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      missing.push(`${component.key}: package.json missing`);
      return null;
    }
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const license = declaredLicense(pkg, component.treeLicense);
    if (!license) {
      missing.push(`${component.key}: license metadata missing`);
      return null;
    }
    return {
      ...component,
      license,
      materials: readLicenseMaterials(component.packagePath),
      source: sourceReference(pkg),
      purl: packageUrl(component.name, component.version),
    };
  });
  if (missing.length > 0) {
    throw new Error(`Third-party notice generation failed:\n${missing.join('\n')}`);
  }

  const validRecords = records.filter(Boolean);
  const noticeSections = validRecords.map((record) => {
    const source = record.source ? `Source: ${record.source.url}\n` : '';
    const materials =
      record.materials.length > 0
        ? record.materials
            .map(
              (material) =>
                `--- ${material.name} ---\n${material.text || '[empty license file]'}`,
            )
            .join('\n\n')
        : 'No license file was included in the installed package; see the declared license metadata above.';
    return `${record.key}\nLicense: ${record.license}\n${source}${materials}`;
  });
  const notices = [
    'WindNote third-party software notices',
    '',
    'This file is generated from the installed production dependency tree.',
    `Components: ${validRecords.length}`,
    '',
    ...noticeSections.flatMap((section) => [
      '='.repeat(80),
      section,
      '',
    ]),
  ].join('\n');

  const sbomComponents = validRecords
    .map((record) => ({
      type: 'library',
      'bom-ref': record.purl,
      name: record.name,
      version: record.version,
      purl: record.purl,
      licenses: [cyclonedxLicense(record.license)],
      ...(record.source
        ? { externalReferences: [record.source] }
        : {}),
    }))
    .sort((a, b) => compareLexically(a['bom-ref'], b['bom-ref']));
  const sbom = {
    $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: app.slug,
        version: app.version,
      },
    },
    components: sbomComponents,
  };

  return {
    [NOTICE_PATH]: notices,
    [BUNDLED_NOTICE_PATH]: `${JSON.stringify({ text: notices }, null, 2)}\n`,
    [SBOM_PATH]: `${JSON.stringify(sbom, null, 2)}\n`,
  };
}

function writeOrCheck(outputs) {
  if (CHECK_ONLY) {
    const stale = Object.entries(outputs)
      .filter(([filePath, expected]) => {
        try {
          return fs.readFileSync(filePath, 'utf8') !== expected;
        } catch {
          return true;
        }
      })
      .map(([filePath]) => path.relative(ROOT, filePath));
    if (stale.length > 0) {
      throw new Error(`Generated legal artifacts are stale: ${stale.join(', ')}`);
    }
    return;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const [filePath, contents] of Object.entries(outputs)) {
    fs.writeFileSync(filePath, contents, 'utf8');
  }
}

try {
  writeOrCheck(buildOutputs());
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
}
