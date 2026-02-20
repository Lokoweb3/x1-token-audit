# Auto-bump - Auto-bump release automation
# Use: node auto-bump.js [minor|major|patch]
# If no argument: auto-detect from commit messages

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pkgPath = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;

console.log(`📦 Current version: v${currentVersion}`);

// Parse version
const [major, minor, patch] = currentVersion.split('.').map(Number);

let newVersion;

if (process.argv[2]) {
  // Manual bump
  switch (process.argv[2]) {
    case 'major':
      newVersion = `${major + 1}.0.0`;
      break;
    case 'minor':
      newVersion = `${major}.${minor + 1}.0`;
      break;
    case 'patch':
      newVersion = `${major}.${minor}.${patch + 1}`;
      break;
    default:
      console.error('Usage: node auto-bump.js [major|minor|patch]');
      process.exit(1);
  }
} else {
  // Auto-detect from commits
  try {
    const log = execSync('git log --oneline -10', { encoding: 'utf8' });
    
    if (log.includes('BREAKING') || log.includes('feat!') || log.includes('fix!')) {
      newVersion = `${major + 1}.0.0`;
      console.log('🔍 Detected: MAJOR (breaking change)');
    } else if (log.includes('feat:')) {
      newVersion = `${major}.${minor + 1}.0`;
      console.log('🔍 Detected: MINOR (new feature)');
    } else {
      newVersion = `${major}.${minor}.${patch + 1}`;
      console.log('🔍 Detected: PATCH (bug fix)');
    }
  } catch (e) {
    // Default to patch
    newVersion = `${major}.${minor}.${patch + 1}`;
  }
}

console.log(`➡️  New version: v${newVersion}`);

// Update package.json
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('📝 Updated package.json');

// Create git tag
console.log('🏷️  Creating tag: v' + newVersion);
execSync(`git tag v${newVersion}`);

// Commit and push
console.log('📤 Pushing changes...');
execSync('git add package.json');
execSync(`git commit -m "chore: bump version to ${newVersion}"`);

// Push to remote
try {
  execSync('git push origin master');
  execSync('git push origin v' + newVersion);
  console.log('✨ Release v' + newVersion + ' created and pushed!');
} catch (e) {
  console.log('⚠️  Push failed - needs GitHub PAT with workflow scope for .github/');
}
