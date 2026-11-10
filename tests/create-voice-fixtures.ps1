Add-Type -AssemblyName System.Speech
$voiceFolder = Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts'
New-Item -ItemType Directory -Path $voiceFolder -Force | Out-Null
$voiceSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voiceFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
try {
  $voiceSynth.SetOutputToWaveFile((Join-Path $voiceFolder 'direct-audio-cylinder.wav'),$voiceFormat)
  $voiceSynth.Speak('Create one cylinder. The radius is twenty millimeters and the height is sixty millimeters. Place its center at zero, one, minus zero point six meters. Use vertical world Y as its height axis. Do not add anything else.')
  $voiceSynth.SetOutputToWaveFile((Join-Path $voiceFolder 'direct-audio-pause.wav'),$voiceFormat)
  $voiceSynth.Speak('Pause AI.')
  $voiceSynth.SetOutputToWaveFile((Join-Path $voiceFolder 'direct-audio-resume.wav'),$voiceFormat)
  $voiceSynth.Speak('Enable AI.')
} finally { $voiceSynth.Dispose() }
