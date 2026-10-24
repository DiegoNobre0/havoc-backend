import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyRequest } from 'fastify';
import OpenAI from 'openai';
import { AppError } from '../../shared/errors/AppError.js';

export const CONSULTANT_AUDIO_MAX_BYTES = 5 * 1024 * 1024;

const AUDIO_EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.mp4',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-m4a': '.m4a',
};

export function consultantAudioExtension(mimetype: string) {
  return AUDIO_EXTENSIONS[mimetype.split(';', 1)[0]!.trim().toLowerCase()] ?? null;
}

export function validateConsultantTranscript(value: string) {
  const transcript = value.trim();
  if (!transcript) {
    throw new AppError('Não foi possível compreender o áudio. Tente gravar novamente.', 422);
  }
  if (transcript.length > 500) {
    throw new AppError('A transcrição excede o limite de 500 caracteres.', 422);
  }
  return transcript;
}

export function normalizeConsultantTranscript(value: string) {
  return validateConsultantTranscript(value).replace(/\b(?:3\s*way|three\s+way)\b/gi, '3 whey');
}

export function buildConsultantTranscriptionPrompt(history: string[]) {
  const recentContext = history
    .slice(-6)
    .map((message) => message.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' | ')
    .slice(-700);
  const vocabulary = 'Vocabulário: whey protein, 3 whey, creatina, pré-treino, hipercalórico.';
  return recentContext ? `${vocabulary}\nConversa recente: ${recentContext}` : vocabulary;
}

function mapMultipartError(request: FastifyRequest, error: unknown): never {
  const errors = request.server.multipartErrors;
  if (error instanceof errors.RequestFileTooLargeError) {
    throw new AppError('O áudio deve ter no máximo 5 MB.', 413);
  }
  if (
    error instanceof errors.FilesLimitError ||
    error instanceof errors.PartsLimitError ||
    error instanceof errors.FieldsLimitError
  ) {
    throw new AppError('Envie somente um arquivo no campo audio.', 400);
  }
  if (
    error instanceof errors.InvalidMultipartContentTypeError ||
    error instanceof errors.PrematureCloseError
  ) {
    throw new AppError('Upload de áudio inválido ou incompleto.', 400);
  }
  throw error;
}

export async function saveConsultantAudio(request: FastifyRequest) {
  if (!request.isMultipart()) {
    throw new AppError('Envie o áudio como multipart/form-data.', 400);
  }

  let tempPath: string | undefined;
  try {
    const parts = request.parts({
      limits: { fileSize: CONSULTANT_AUDIO_MAX_BYTES, files: 1, fields: 0, parts: 1 },
    });
    let receivedFile = false;

    for await (const part of parts) {
      if (part.type !== 'file' || part.fieldname !== 'audio' || receivedFile) {
        if (part.type === 'file') part.file.resume();
        throw new AppError('Envie somente um arquivo no campo audio.', 400);
      }

      receivedFile = true;
      const extension = consultantAudioExtension(part.mimetype);
      if (!extension) {
        part.file.resume();
        throw new AppError('Formato de áudio não suportado.', 400);
      }

      tempPath = join(
        tmpdir(),
        `havoc-consultant-${crypto.randomBytes(24).toString('hex')}${extension}`,
      );
      await pipeline(part.file, createWriteStream(tempPath, { flags: 'wx' }));
      if (part.file.truncated) throw new AppError('O áudio deve ter no máximo 5 MB.', 413);
    }

    if (!receivedFile || !tempPath) {
      throw new AppError('Envie um arquivo no campo audio.', 400);
    }
    if ((await stat(tempPath)).size === 0) {
      throw new AppError('O arquivo de áudio está vazio.', 400);
    }
    return tempPath;
  } catch (error) {
    await removeConsultantAudio(tempPath);
    mapMultipartError(request, error);
  }
}

export async function removeConsultantAudio(tempPath: string | undefined) {
  if (tempPath) await unlink(tempPath).catch(() => undefined);
}

export async function transcribeConsultantAudio(tempPath: string, prompt?: string) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError('Transcrição de áudio indisponível no momento.', 503);
  }

  try {
    const openai = new OpenAI({ apiKey });
    const result = await openai.audio.transcriptions.create({
      file: createReadStream(tempPath),
      model: process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'whisper-1',
      language: 'pt',
      ...(prompt ? { prompt } : {}),
    });
    return normalizeConsultantTranscript(result.text);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Não foi possível transcrever o áudio. Tente novamente.', 503);
  }
}
