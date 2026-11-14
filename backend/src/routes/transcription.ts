import express, { Router, type Request, type Response } from 'express';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const SUPPORTED_AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/flac']);

interface TranscriptionOptions {
  apiKey: string;
  model?: string;
  fetcher?: typeof fetch;
}

export function transcriptionRouter({ apiKey, model = 'gemini-3.5-transcribe', fetcher = fetch }: TranscriptionOptions): Router {
  const router = Router();
  router.post('/transcriptions', express.raw({ type: 'audio/*', limit: MAX_AUDIO_BYTES }), async (req: Request, res: Response) => {
    if (!apiKey) { res.status(503).json({ error: 'transcription_unavailable', message: 'Gemini transcription is not configured.' }); return; }
    const contentType = (req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!SUPPORTED_AUDIO_TYPES.has(contentType)) { res.status(415).json({ error: 'unsupported_audio', message: 'Use a supported audio recording format.' }); return; }
    const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!audio.length) { res.status(400).json({ error: 'empty_audio', message: 'Record audio before requesting a transcription.' }); return; }
    if (audio.length > MAX_AUDIO_BYTES) { res.status(413).json({ error: 'audio_too_large', message: 'Audio recording exceeds the 10 MB limit.' }); return; }

    try {
      const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ parts: [
          { text: 'Transcribe the speech in this audio. Return only the words spoken, without commentary.' },
          { inlineData: { mimeType: contentType, data: audio.toString('base64') } },
        ] }], generationConfig: { audioTranscriptionConfig: { mode: 'VERBATIM', languageCodes: [] } } }),
      });
      if (!response.ok) {
        req.log?.warn({ status: response.status }, 'Gemini transcription request failed');
        res.status(502).json({ error: 'transcription_failed', message: 'Gemini could not transcribe this recording.' }); return;
      }
      const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; text?: string };
      const transcript = (payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text ?? '').join('') ?? payload.text ?? '').trim();
      if (!transcript) { res.status(422).json({ error: 'empty_transcription', message: 'No speech was detected. Try recording again.' }); return; }
      res.json({ transcript });
    } catch (error) {
      req.log?.warn({ err: error }, 'Gemini transcription request failed');
      res.status(502).json({ error: 'transcription_failed', message: 'Gemini transcription is temporarily unavailable.' });
    }
  });
  return router;
}
