$ErrorActionPreference = "Stop"
$cadRoot = "I:/Projects/Draw3d/.cache/native-build"
New-Item -ItemType Directory -Force "$cadRoot/temp" | Out-Null
$env:TEMP = "$cadRoot/temp"
$env:TMP = $env:TEMP
python -m venv "$cadRoot/cad-venv"
if ($LASTEXITCODE -ne 0) { throw "Python environment setup failed" }
& "$cadRoot/cad-venv/Scripts/python.exe" -m pip install --cache-dir "$cadRoot/pip-cache" -r "$PSScriptRoot/../requirements-cad.txt"
if ($LASTEXITCODE -ne 0) { throw "CadQuery installation failed" }
