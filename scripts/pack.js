#!/usr/bin/env node
// Script to create release tarball

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

console.log(`📦 Creating tarball for v${version}...`);

// Clean up old tarballs
try {
  execSync(`rm -f *.tgz`, { cwd: __dirname, stdio: 'inherit' });
} catch (e) {}

// Create tarball
execSync(`npm pack`, { cwd: path.join(__dirname, '..'), stdio: 'inherit' });

console.log(`✅ Created: x1-token-audit@${version}.tgz`);

// Print manifest
console.log('\n📄 Contents:');
execSync(`tar -tzf x1-token-audit@${version}.tgz | grep -v '^package.json$'`, { 
  cwd: __dirname, 
  stdio: 'inherit' 
});
