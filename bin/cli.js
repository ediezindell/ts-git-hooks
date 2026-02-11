#!/usr/bin/env node
const path = require('node:path');
const fs = require('node:fs');

const cliPath = path.join(__dirname, '../dist/cli.js');

if (!fs.existsSync(cliPath)) {
  console.error('Error: ts-git-hooks is not built. Please run "npm run build" first.');
  process.exit(1);
}

require(cliPath);
