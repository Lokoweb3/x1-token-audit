// scripts/publish.js - Publish new release

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

console.log(`🚀 Publishing v${version} to GitHub...`);

// Create annotated tag
execSync(`git tag -a v${version} -m "Release v${version}"`, { stdio: 'inherit' });

// Push branch
console.log('Pushing branch...');
execSync('git push origin master', { stdio: 'inherit' });

// Push tag
console.log('Pushing tag...');
execSync('git push origin v' + version, { stdio: 'inherit' });

console.log(`✨ v${version} published to GitHub!`);
console.log(`🔗 https://github.com/Lokoweb3/x1-token-audit/releases/tag/v${version}`);
