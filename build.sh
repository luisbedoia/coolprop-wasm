#!/usr/bin/env bash
set -euo pipefail

: "${EMSDK_VERSION:=4.0.6}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${ROOT_DIR}/build"
INSTALL_DIR="${ROOT_DIR}/wasm"

git config --global --add safe.directory /app
git config --global --add safe.directory /app/coolprop

git submodule update --init --recursive
git -C coolprop fetch --tags
git -C coolprop checkout v6.8.0

echo ">>> EMSDK version   : ${EMSDK_VERSION}"
echo ">>> Build dir       : ${BUILD_DIR}"
echo ">>> Install dir     : ${INSTALL_DIR}"

mkdir -p "${BUILD_DIR}"
mkdir -p "${INSTALL_DIR}"

npm install -g typescript

emcmake cmake -B "${BUILD_DIR}" \
    -DCMAKE_BUILD_TYPE=Release

cmake --build "${BUILD_DIR}" -j"$(nproc)"
cmake --install "${BUILD_DIR}"
