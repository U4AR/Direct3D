Add-Type -AssemblyName System.Speech
$synth=New-Object System.Speech.Synthesis.SpeechSynthesizer
$format=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
try {
 $synth.SetOutputToWaveFile((Join-Path (Get-Location) 'artifacts/modeling-hole.wav'),$format)
 $synth.Speak('Free CAD, cut a circular through hole in the plate at my drawn circle. Radius ten millimeters, along world Z. Keep the plate unchanged. Use a cylinder and subtract it.')
} finally {$synth.Dispose()}
