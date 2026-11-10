$ErrorActionPreference = "Stop"
$buildRoot = "I:/Projects/Draw3d/.cache/native-build"
$source = "$buildRoot/openzcad-source"
$toolchain = "$buildRoot/cad-toolchain"
$commit = "ae6553b498d5ba04d8c7b5cc43d97682bd5f94a3"
$env:TEMP = "$buildRoot/temp"
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
if (!(Test-Path "$toolchain/node_modules/node/bin/node.exe")) {
  npm install --prefix $toolchain --cache "$buildRoot/npm-cache" node@22.23.3 pnpm@10.8.0
  if ($LASTEXITCODE) { throw "CAD toolchain installation failed" }
}
$node = "$toolchain/node_modules/node/bin/node.exe"
$pnpm = "$toolchain/node_modules/pnpm/bin/pnpm.cjs"
$env:Path = "$toolchain/node_modules/node/bin;$toolchain/node_modules/.bin;" + $env:Path
if (!(Test-Path $source)) {
  git clone --no-checkout --depth 1 https://github.com/esaueng/OpenZCAD.git $source
  if ($LASTEXITCODE) { throw "CAD source download failed" }
  git -C $source fetch --depth 1 origin $commit
  if ($LASTEXITCODE) { throw "Pinned CAD revision download failed" }
  git -C $source checkout --detach $commit
  if ($LASTEXITCODE) { throw "CAD checkout failed" }
}
if ((git -C $source rev-parse HEAD).Trim() -ne $commit) { throw "Existing CAD source has another revision. Preserve it and set up the pinned source separately." }
Push-Location $source
try {
  & $node $pnpm install --frozen-lockfile --store-dir "$buildRoot/pnpm-store"
  if ($LASTEXITCODE) { throw "CAD dependencies failed" }
  & $node scripts/verify-remus-artifacts.mjs
  if ($LASTEXITCODE) { throw "CAD WASM verification failed" }
  & $node "I:/Projects/Draw3d/scripts/build-cad-agent.mjs"
  if ($LASTEXITCODE) { throw "CAD build failed" }
  & $node scripts/report-bundle-sizes.mjs --check > "$buildRoot/cad-bundle-check.json"
  if ($LASTEXITCODE) { throw "CAD bundle check failed" }
} finally { Pop-Location }
& $node scripts/bundle-cad.mjs
if ($LASTEXITCODE) { throw "CAD packaging failed" }
