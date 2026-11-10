export async function readSpeechProgress(response,onTranscript,onRetry) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const value = await response.json();
    if (!response.ok) throw Error(value.error || 'Transcription failed');
    return value;
  }
  let buffer = '', result;
  const reader = response.body.getReader(), decoder = new TextDecoder();
  for (;;) {
    const {done,value} = await reader.read();
    buffer += decoder.decode(value,{stream:!done});
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.error) throw Error(event.error);
      if (event.result) result = event.result;
      else if (event.retry) onRetry?.(event.retry);
      else if (event.transcript) onTranscript(event.transcript);
    }
    if (done) break;
  }
  if (!result) throw Error('Transcription connection closed before the instruction was checked');
  return result;
}
