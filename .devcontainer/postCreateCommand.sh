#!/bin/sh

# Update the underlying (Debian) OS, to make sure we have the latest security patches and libraries like 'GLIBC' 
echo "⚙️ Updating the underlying OS..."
sudo apt-get update  && sudo apt-get -y upgrade

# Give 'node' user access to 'node_modules' folder
sudo chown node node_modules

# Uninstall globally installed PNPM (appropriate version will be installed with corepack)
npm uninstall -g pnpm

# Prevent corepack from prompting user before downloading PNPM 
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Enable corepack 
sudo corepack enable 

# Install the PNPM version defined in the root package.json
echo "⚙️ Installing PNPM..."
sudo corepack prepare --activate

# Install dependencies
echo "⚙️ Installing NPM dependencies..."
pnpm install --frozen-lockfile

