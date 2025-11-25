#!/usr/bin/env bash
set -euo pipefail

: "${EMSDK_VERSION:=4.0.6}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${ROOT_DIR}/build"
INSTALL_DIR="${ROOT_DIR}/wasm"
ALLOWED_FLUIDS_FILE="${ALLOWED_FLUIDS_FILE:-${ROOT_DIR}/allowed_fluids.txt}"

filter_fluids() {
    local fluids_dir="${ROOT_DIR}/coolprop/dev/fluids"
    if [[ ! -f "${ALLOWED_FLUIDS_FILE}" ]]; then
        echo ">>> Allowed fluids list not found at ${ALLOWED_FLUIDS_FILE}; keeping all fluids."
        return
    fi

    mapfile -t allowed_fluids < <(sed 's/#.*//' "${ALLOWED_FLUIDS_FILE}" | tr -d '\r' | awk 'NF')

    if [[ ${#allowed_fluids[@]} -eq 0 ]]; then
        echo ">>> Allowed fluids list is empty; no fluids will be removed."
        return
    fi

    echo ">>> Keeping fluids listed in ${ALLOWED_FLUIDS_FILE}"

    declare -A allowed_paths=()
    for fluid in "${allowed_fluids[@]}"; do
        allowed_paths["${fluids_dir}/${fluid}.json"]=1
    done

    while IFS= read -r -d '' file; do
        if [[ -z "${allowed_paths["${file}"]:-}" ]]; then
            echo "    - Removing ${file##*/}"
            rm -f "${file}"
        fi
    done < <(find "${fluids_dir}" -maxdepth 1 -type f -name '*.json' -print0)

    rm -f "${ROOT_DIR}/coolprop/dev/.fluiddepcache"
    rm -f "${ROOT_DIR}/coolprop/dev/all_fluids.json" \
          "${ROOT_DIR}/coolprop/dev/all_fluids.json.z" \
          "${ROOT_DIR}/coolprop/dev/all_fluids_verbose.json"
}

git config --global --add safe.directory /app
git config --global --add safe.directory /app/coolprop

git submodule update --init --recursive
git -C coolprop fetch --tags
git -C coolprop checkout v6.8.0

filter_fluids

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

git -C coolprop restore .
