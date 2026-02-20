# scripts/ - Release Automation Scripts

## Available Scripts

### 1. auto-bump.js
Auto-detect and bump version based on commit messages.

```bash
node scripts/auto-bump.js        # Auto-detect from commits
node scripts/auto-bump.js patch  # Manual patch bump
node scripts/auto-bump.js minor  # Manual minor bump
node scripts/auto-bump.js major  # Manual major bump
```

**SemVer Detection:**
- `BREAKING`, `feat!`, `fix!` → **major**
- `feat:` → **minor**
- Default → **patch**

### 2. pack.js
Create npm tarball for distribution.

```bash
node scripts/pack.js
```

Creates: `x1-token-audit@<version>.tgz`

### 3. publish.js
Push release to GitHub.

```bash
node scripts/publish.js
```

Creates annotated tag, pushes branch and tag to GitHub.

### 4. release.sh (Bash)
Alternative bash script for manual releases.

```bash
./scripts/release.sh [major|minor|patch]
```

## Usage in CI/CD

Add to `package.json`:

```json
{
  "scripts": {
    "auto-bump": "node scripts/auto-bump.js",
    "pack": "node scripts/pack.js",
    "publish": "node scripts/publish.js",
    "release": "npm run auto-bump && npm run pack && npm run publish"
  }
}
```

## GitHub Actions Workflow Example

```yaml
name: Release

on:
  push:
    branches: [master]
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run auto-bump
      - run: npm run pack
      - run: npm run publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Version Bump Convention

```
0.0.1 → 0.0.2 (patch)     # Bug fixes
0.0.2 → 0.1.0 (minor)     # New features
0.1.0 → 1.0.0 (major)     # Breaking changes
```

Follow [Semantic Versioning](https://semver.org/).
