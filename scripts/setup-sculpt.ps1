$ErrorActionPreference='Stop'
$source='I:/Projects/Draw3d/.cache/native-build/sculptgl-source'
$commit='8e45dafc0f7906e5238dfffc1a2df742bd25f29d'
$env:TEMP='I:/Projects/Draw3d/.cache/native-build/temp'
$env:TMP=$env:TEMP
if (!(Test-Path $source)) {
 git clone https://github.com/stephomi/sculptgl.git $source
 if ($LASTEXITCODE) {throw 'SculptGL clone failed'}
 git -C $source checkout --detach $commit
 if ($LASTEXITCODE) {throw 'SculptGL checkout failed'}
}
if ((git -C $source rev-parse HEAD).Trim() -ne $commit) {throw 'Unexpected SculptGL revision'}
Push-Location $source
try {
 npm install --omit=dev --ignore-scripts --cache I:/Projects/Draw3d/.cache/native-build/npm-cache --no-audit --no-fund
 if ($LASTEXITCODE) {throw 'SculptGL dependencies failed'}
} finally {Pop-Location}
node scripts/bundle-sculpt.mjs
if ($LASTEXITCODE) {throw 'SculptGL bundle failed'}
