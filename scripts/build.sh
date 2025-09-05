#!/bin/bash

# Canvas Scraper Build Script
# Builds the extension and copies necessary files to dist/

echo "Building Canvas Scraper extension..."

# Build TypeScript files
npm run build

# Copy HTML files and manifest
echo "Copying HTML files and manifest..."
cp extension/src/popup/popup.html extension/dist/popup/
cp extension/src/options/options.html extension/dist/options/
mkdir -p extension/dist/status
cp extension/src/status/status.html extension/dist/status/
cp extension/manifest.json extension/dist/

# Create icons directory and PNG icons
echo "Creating icons..."
mkdir -p extension/dist/icons

# Create minimal valid PNG files (16x16, 48x48, 128x128)
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x10\x00\x00\x00\x10\x08\x02\x00\x00\x00\x90\x91h6\x00\x00\x00\x0cIDATx\x9cc```\x00\x00\x00\x04\x00\x01\xf5\x1a\xe4\xd8\x00\x00\x00\x00IEND\xaeB`\x82' > extension/dist/icons/icon16.png
cp extension/dist/icons/icon16.png extension/dist/icons/icon48.png
cp extension/dist/icons/icon16.png extension/dist/icons/icon128.png

echo "Build complete! Extension ready in extension/dist/"
echo "Load extension in Chrome: chrome://extensions/ -> Load unpacked -> extension/dist/"
